import { submitToAi } from "./core/api"
import type { Destination, EditorScreen } from "./core/types"
import { isInspectableTabUrl, sendTabMessage } from "./lib/tabMessage"
import { generateCode, generateMobileCode, generateTestIdeas, mediaToText } from "./core/api/aiService"
import {
  finishAnnotate,
  getGenStatus,
  getSessionKeyFromUrl,
  getSessionState,
  getSessionVideoDataUrl,
  getSettings,
  markSessionVideoSaved,
  setGenStatus,
  setLastSessionKey,
  updateSessionState
} from "./store/jack"
import {
  pauseTabVideoRecording,
  registerTabVideoCleanup,
  resumeTabVideoRecording,
  startTabVideoRecording,
  stopTabVideoRecording
} from "./background/tabVideo"
import {
  clearCaptureFlow,
  getCaptureFlow,
  getEditorTabId,
  getEditorWindowId,
  getOverlayTabId,
  setCaptureFlow,
  setEditorTabId,
  setEditorWindowId,
  setOverlayTabId,
  updateCaptureFlow
} from "./store/session"

const EDITOR_URL = chrome.runtime.getURL("tabs/editor.html")
const WINDOW_WIDTH = 520
const WINDOW_HEIGHT = 760

let aiAbortController: AbortController | null = null

function startAiAbortController(): AbortSignal {
  aiAbortController?.abort()
  aiAbortController = new AbortController()
  return aiAbortController.signal
}

function abortAi(): void {
  aiAbortController?.abort()
  aiAbortController = null
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPEN_EDITOR_WINDOW") {
    openOrFocusEditor(message.screen ?? "post-selector").then(sendResponse)
    return true
  }

  if (message.type === "START_CAPTURE_FLOW") {
    startCaptureFlow(message as Destination).then(sendResponse)
    return true
  }

  if (message.type === "CROP_SELECTED") {
    handleCropSelected(message)
      .then(sendResponse)
      .catch((error) => {
        console.error("Failed to process CROP_SELECTED", error)
        sendResponse({ ok: false, error: "crop_failed" })
      })
    return true
  }

  if (message.type === "ANNOTATION_DONE") {
    updateCaptureFlow({
      annotatedDataUrl: message.annotatedDataUrl,
      annotations: message.annotations
    }).then(() => navigateEditor("audio-recorder").then(sendResponse))
    return true
  }

  if (message.type === "AUDIO_DONE") {
    updateCaptureFlow({ transcript: message.transcript })
      .then(() => navigateEditor("ai-processing"))
      .then(() => runAiSubmission(message.annotatedDataUrl, startAiAbortController()))
      .then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "START_VIDEO_FLOW") {
    startVideoFlow(message as Destination).then(sendResponse)
    return true
  }

  if (message.type === "VIDEO_DONE") {
    const descriptionUpdate = message.description
      ? updateCaptureFlow({ transcript: message.description })
      : Promise.resolve()
    descriptionUpdate
      .then(() => navigateEditor("ai-processing"))
      .then(() =>
        runVideoAiSubmission(message.videoBase64, message.videoMimeType, startAiAbortController())
      )
      .then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "RETRY_AI") {
    getCaptureFlow().then(async (flow) => {
      await updateCaptureFlow({ aiError: undefined })
      await navigateEditor("ai-processing")
      const signal = startAiAbortController()
      if (flow?.flowType === "video") {
        await runVideoAiSubmission(undefined, undefined, signal)
      } else {
        await runAiSubmission(undefined, signal)
      }
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === "CANCEL_AI") {
    abortAi()
    sendResponse({ ok: true })
  }

  if (message.type === "CLOSE_EDITOR_WINDOW") {
    abortAi()
    getEditorWindowId().then(async (windowId) => {
      if (windowId) await chrome.windows.remove(windowId)
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === "UPDATE_BADGE") {
    chrome.action.setBadgeText({ text: message.text ?? "" })
    chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" })
    sendResponse({ ok: true })
  }

  if (message.type === "ELEMENT_SELECTED") {
    const key = getSessionKeyFromUrl(_sender.tab?.url)
    if (key) {
      updateSessionState(
        { htmlContext: message.outerHTML, targetSelector: message.selector },
        key
      ).then(() => sendResponse({ ok: true }))
    } else sendResponse({ ok: false })
    return true
  }

  if (message.type === "RECORDER_RESULTS") {
    const key = getSessionKeyFromUrl(_sender.tab?.url)
    if (key) {
      updateSessionState({ recordedActions: message.actions }, key).then(() =>
        sendResponse({ ok: true })
      )
    } else sendResponse({ ok: false })
    return true
  }

  if (message.type === "ANNOTATE_DONE") {
    finishAnnotate(message.annotatedDataUrl, _sender.tab?.id).then(() =>
      sendResponse({ ok: true })
    )
    return true
  }

  if (message.type === "ANNOTATE_CANCEL") {
    finishAnnotate(null, _sender.tab?.id).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "START_TAB_VIDEO") {
    startTabVideoRecording({
      tabId: message.tabId,
      windowId: message.windowId,
      sessionKey: message.sessionKey,
      streamId: message.streamId
    }).then(sendResponse)
    return true
  }

  if (message.type === "TAB_VIDEO_PAUSE") {
    pauseTabVideoRecording().then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "TAB_VIDEO_RESUME") {
    resumeTabVideoRecording().then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "TAB_VIDEO_STOP") {
    stopTabVideoRecording().then(async (result) => {
      if (result.ok && result.sessionKey) {
        await markSessionVideoSaved(result.sessionKey, result.mimeType ?? "video/webm")
        await setLastSessionKey(result.sessionKey)
        if (result.windowId && result.tabId) {
          try {
            await chrome.windows.update(result.windowId, { focused: true })
            await chrome.tabs.update(result.tabId, { active: true })
          } catch {
            // ignore
          }
        }
      }
      sendResponse(result)
    })
    return true
  }

  if (message.type === "RESIZE_WINDOW") {
    getEditorWindowId().then(async (windowId) => {
      if (windowId) {
        const display = await getDisplayBounds()
        const left = display.width - message.width - 16
        await chrome.windows.update(windowId, {
          width: message.width,
          left: Math.max(0, left)
        })
      }
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === "JACK_GENERATE_IDEAS") {
    runJackGenerateIdeas(message.sessionKey).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "JACK_GENERATE_CODE") {
    runJackGenerateCode(message.sessionKey).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "JACK_GENERATE_MOBILE_CODE") {
    runJackGenerateMobileCode(message.sessionKey).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === "JACK_RETRY") {
    const { failedPhase, sessionKey } = message
    const fn = failedPhase === "code" ? runJackGenerateCode : runJackGenerateIdeas
    fn(sessionKey).then(() => sendResponse({ ok: true }))
    return true
  }
})

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await getEditorWindowId()
  if (stored === windowId) {
    abortAi()
    await setEditorWindowId(null)
    await setEditorTabId(null)
  }
})

// ── Capture flow ──────────────────────────────────────────────────────────────

async function startCaptureFlow(
  destination: Destination
): Promise<{ ok: boolean }> {
  await setCaptureFlow({ destination })

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  })
  if (!activeTab?.id) return { ok: false }

  await setOverlayTabId(activeTab.id)
  if (!activeTab.url || !isInspectableTabUrl(activeTab.url)) return { ok: false }
  await sendTabMessage(activeTab.id, { type: "ACTIVATE_OVERLAY" })
  return { ok: true }
}

async function handleCropSelected(message: {
  cancelled?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  startScrollY?: number
}): Promise<{ ok: boolean }> {
  const overlayTabId = await getOverlayTabId()

  if (message.cancelled) {
    await clearCaptureFlow()
    await setOverlayTabId(null)
    const editorId = await getEditorWindowId()
    if (editorId) await chrome.windows.update(editorId, { focused: true })
    return { ok: true }
  }

  if (!overlayTabId || message.x == null) return { ok: false }

  const croppedDataUrl = await captureVisibleTabWithScroll(overlayTabId, {
    x: message.x!,
    y: message.y!,
    width: message.width!,
    height: message.height!,
    startScrollY: message.startScrollY ?? message.y!
  })

  await updateCaptureFlow({ rawDataUrl: croppedDataUrl })
  await setOverlayTabId(null)
  await openOrFocusEditor("annotator")
  return { ok: true }
}

async function scrollTabTo(tabId: number, scrollY: number): Promise<number> {
  // Returns the actual scrollY the browser settled on (may differ if near page bottom)
  const res = await chrome.tabs.sendMessage(tabId, { type: "SCROLL_FOR_CAPTURE", scrollY })
  return (res as { scrollY?: number })?.scrollY ?? scrollY
}

async function captureVisibleTabWithScroll(
  tabId: number,
  clip: { x: number; y: number; width: number; height: number; startScrollY: number }
): Promise<string> {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.windowId) throw new Error("no windowId")

  // Scroll to the position the user had at selection start, then capture
  const actualStartScrollY = await scrollTabTo(tabId, clip.startScrollY)

  // First capture to determine real pixel dimensions
  const firstDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "png" })
  const firstBmp = await createImageBitmap(await (await fetch(firstDataUrl)).blob())
  // bmp dimensions are in physical pixels; tab.width is CSS px
  const pxW = firstBmp.width
  const pxH = firstBmp.height
  const cssW = tab.width ?? pxW
  const dpr = pxW / cssW
  const vh = Math.round(pxH / dpr) // CSS viewport height in px

  // How far into the first capture the selection starts (in CSS px)
  // clip.y is document coord; actualStartScrollY is where browser actually scrolled
  const selectionOffsetInViewport = clip.y - actualStartScrollY // CSS px from viewport top

  const slices: string[] = []

  // Helper: crop a horizontal strip from a bitmap and return base64
  const cropBmp = async (
    bmp: ImageBitmap,
    cssFromTop: number,   // CSS px from viewport top
    cssHeight: number     // CSS px height to take
  ): Promise<string> => {
    const canvas = new OffscreenCanvas(Math.round(clip.width * dpr), Math.round(cssHeight * dpr))
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(
      bmp,
      Math.round(clip.x * dpr), Math.round(cssFromTop * dpr),
      Math.round(clip.width * dpr), Math.round(cssHeight * dpr),
      0, 0,
      Math.round(clip.width * dpr), Math.round(cssHeight * dpr)
    )
    const blob = await canvas.convertToBlob({ type: "image/png" })
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve((reader.result as string).split(",")[1])
      reader.readAsDataURL(blob)
    })
  }

  // First slice: from selectionOffsetInViewport to end of viewport (or end of selection)
  const firstSliceH = Math.min(clip.height, vh - selectionOffsetInViewport)
  slices.push(await cropBmp(firstBmp, selectionOffsetInViewport, firstSliceH))
  firstBmp.close()

  let captured = firstSliceH

  // Subsequent slices: scroll so the next chunk of the selection lands at selectionOffsetInViewport
  // (same position as the selection start). This keeps fixed elements like the admin bar in the
  // same screen position they were during the first capture — they never enter the crop area.
  while (captured < clip.height) {
    // Scroll target: put document Y (clip.y + captured) at viewport row selectionOffsetInViewport
    const targetScrollY = clip.y + captured - selectionOffsetInViewport
    const actualScrollY = await scrollTabTo(tabId, targetScrollY)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "png" })
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob())
    // Use actual scroll position to compute the crop offset — if the browser couldn't scroll
    // to targetScrollY (e.g. near page bottom), the content lands at a different viewport row.
    const cropOffsetInViewport = clip.y + captured - actualScrollY
    const remaining = clip.height - captured
    const sliceH = Math.min(remaining, vh - cropOffsetInViewport)
    slices.push(await cropBmp(bmp, cropOffsetInViewport, sliceH))
    bmp.close()
    captured += sliceH
  }

  if (slices.length === 1) {
    return `data:image/png;base64,${slices[0]}`
  }
  return stitchSlices(slices)
}

async function stitchSlices(slicesB64: string[]): Promise<string> {
  const bitmaps = await Promise.all(
    slicesB64.map((b64) =>
      fetch(`data:image/png;base64,${b64}`)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
    )
  )
  const totalH = bitmaps.reduce((s, b) => s + b.height, 0)
  const w = bitmaps[0].width
  const canvas = new OffscreenCanvas(w, totalH)
  const ctx = canvas.getContext("2d")!
  let y = 0
  for (const bmp of bitmaps) {
    ctx.drawImage(bmp, 0, y)
    y += bmp.height
  }
  const outBlob = await canvas.convertToBlob({ type: "image/png" })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(outBlob)
  })
}

async function startVideoFlow(
  destination: Destination
): Promise<{ ok: boolean }> {
  await setCaptureFlow({ destination, flowType: "video" })
  await openOrFocusEditor("video-recorder")
  return { ok: true }
}

async function runVideoAiSubmission(
  videoBase64?: string,
  videoMimeType?: string,
  signal?: AbortSignal
): Promise<void> {
  const flow = await getCaptureFlow()
  const post = await chrome.storage.local.get("lastPost")
  const context = post.lastPost?.title?.rendered ?? ""
  const transcript = flow?.transcript

  const payload = videoBase64
    ? { videoBase64, videoMimeType: videoMimeType ?? "video/webm", context, transcript }
    : flow?.videoFileUri
      ? {
          videoFileUri: flow.videoFileUri,
          videoMimeType: flow.videoMimeType,
          context,
          transcript
        }
      : null

  if (!payload) {
    console.warn("[docshot] runVideoAiSubmission: missing video data")
    await updateCaptureFlow({ aiError: "Відсутні дані відео для обробки" })
    await navigateEditor("ai-processing")
    return
  }

  try {
    const authData = await chrome.storage.local.get("auth")
    const token: string = authData.auth?.token ?? ""
    const result = await submitToAi(payload, token, signal)
    await updateCaptureFlow({ generatedHtml: result.contentHtml })
    await navigateEditor("content-review")
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return
    console.error("[docshot] runVideoAiSubmission error:", err)
    const message = err instanceof Error ? err.message : String(err)
    await updateCaptureFlow({ aiError: message })
    await navigateEditor("ai-processing")
  }
}

async function runAiSubmission(
  annotatedDataUrlArg?: string,
  signal?: AbortSignal
): Promise<void> {
  const flow = await getCaptureFlow()
  const annotatedDataUrl = annotatedDataUrlArg ?? flow?.annotatedDataUrl
  const transcript = flow?.transcript

  if (!annotatedDataUrl || !transcript) {
    console.warn("[docshot] runAiSubmission: missing annotatedDataUrl or transcript")
    await updateCaptureFlow({ aiError: "Відсутні дані зображення або транскрипт" })
    await navigateEditor("ai-processing")
    return
  }

  const post = await chrome.storage.local.get("lastPost")
  const context = post.lastPost?.title?.rendered ?? ""

  try {
    const authData = await chrome.storage.local.get("auth")
    const token: string = authData.auth?.token ?? ""

    const result = await submitToAi(
      { imageDataUrl: annotatedDataUrl, transcript, context },
      token,
      signal
    )
    await updateCaptureFlow({ generatedHtml: result.contentHtml })
    await navigateEditor("content-review")
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return
    console.error("[docshot] runAiSubmission error:", err)
    const message = err instanceof Error ? err.message : String(err)
    await updateCaptureFlow({ aiError: message })
    await navigateEditor("ai-processing")
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForEditorReady(tabId: number): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PING" })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

async function navigateEditor(screen: EditorScreen): Promise<void> {
  const windowId = await getEditorWindowId()
  if (!windowId) return

  let tabId = await getEditorTabId()
  if (!tabId) {
    const tabs = await chrome.tabs.query({ windowId })
    tabId = tabs[0]?.id ?? null
    if (tabId) await setEditorTabId(tabId)
  }

  if (screen === "annotator") {
    await chrome.windows.update(windowId, { state: "maximized" })
  } else {
    const display = await getDisplayBounds()
    const left = display.width - WINDOW_WIDTH - 16
    await chrome.windows.update(windowId, {
      state: "normal",
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      left,
      top: 0
    })
  }

  // Runtime messaging reaches extension pages (editor tab).
  // Keep an init-screen fallback for cases where the editor is still mounting.
  await chrome.storage.session.set({ editorInitScreen: screen })
  await chrome.runtime.sendMessage({ type: "NAVIGATE", screen }).catch(() => {})
}

async function openOrFocusEditor(
  screen: EditorScreen
): Promise<{ ok: boolean }> {
  const storedId = await getEditorWindowId()

  if (storedId !== null) {
    try {
      await chrome.windows.update(storedId, { focused: true })
      const tabs = await chrome.tabs.query({ windowId: storedId })
      const tabId = tabs[0]?.id
      if (tabId) await waitForEditorReady(tabId)
      await navigateEditor(screen)
      return { ok: true }
    } catch {
      await setEditorWindowId(null)
    }
  }

  const display = await getDisplayBounds()
  const isAnnotator = screen === "annotator"
  const left = isAnnotator ? 0 : display.width - WINDOW_WIDTH - 16

  const win = await chrome.windows.create({
    url: EDITOR_URL,
    type: "popup",
    ...(isAnnotator
      ? { state: "maximized" }
      : {
          state: "normal",
          width: WINDOW_WIDTH,
          height: WINDOW_HEIGHT,
          left,
          top: 0
        })
  })

  if (win.id !== undefined) {
    await setEditorWindowId(win.id)
    const tabId = win.tabs?.[0]?.id
    if (tabId) await setEditorTabId(tabId)
    await chrome.storage.session.set({ editorInitScreen: screen })
    await waitForEditorReady(tabId)
    await navigateEditor(screen)
  }

  return { ok: true }
}

async function getDisplayBounds(): Promise<{ width: number; height: number }> {
  return {
    width: self.screen?.width ?? 1440,
    height: self.screen?.height ?? 900
  }
}

// ── Jack QA background generation ────────────────────────────────────────────

async function runJackGenerateIdeas(sessionKey: string): Promise<void> {
  try {
    const session = await getSessionState(sessionKey)
    if (!session) throw new Error("Session not found")

    const settings = await getSettings()
    const selected = settings?.selectedModels
    const analysisProvider = selected?.mediaAnalysisProvider ?? "openai"
    const analysisModel = selected?.mediaAnalysisModel ?? "gpt-4o-mini"
    const genProvider = selected?.codeGenProvider ?? "openai"
    const genModel = selected?.codeGenModel ?? "gpt-4o-mini"
    const uiLang = settings?.uiLanguage ?? "uk"

    let mediaDescription = session.mediaDescription
    if (!mediaDescription) {
      await setGenStatus({ phase: "analyzing-media", sessionKey })
      const videoDataUrl = session.hasVideo
        ? await getSessionVideoDataUrl(sessionKey)
        : session.videoDataUrl
      const desc = await mediaToText({
        screenshotDataUrl: session.screenshotDataUrl,
        videoDataUrl,
        provider: analysisProvider,
        model: analysisModel,
        lang: uiLang,
      })
      await updateSessionState({ mediaDescription: desc }, sessionKey)
      mediaDescription = desc
    }

    await setGenStatus({ phase: "generating-ideas", sessionKey })

    const contextParts: string[] = []
    if (mediaDescription) contextParts.push(mediaDescription)
    if (session.htmlContext) contextParts.push(`HTML: ${session.htmlContext}`)
    if (session.recordedActions?.length) {
      const steps = session.recordedActions
        .map((a) => {
          if (a.type === "click") return `click ${a.selector}`
          if (a.type === "input") return `input "${a.value}" → ${a.selector}`
          if (a.type === "navigate") return `navigate ${a.url}`
          return ""
        })
        .join("; ")
      contextParts.push(`Actions: ${steps}`)
    }
    if (session.customPrompt) contextParts.push(`Context: ${session.customPrompt}`)

    const ideas = await generateTestIdeas({
      context: contextParts.join("\n") || "Web application",
      provider: genProvider,
      model: genModel,
      lang: uiLang,
    })
    await updateSessionState({ testIdeas: ideas }, sessionKey)
    await setGenStatus({ phase: "idle" })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await chrome.storage.local.set({
      jackGenStatus: { phase: "error", sessionKey, error, failedPhase: "ideas" },
    })
  }
}

async function runJackGenerateCode(sessionKey: string): Promise<void> {
  try {
    await setGenStatus({ phase: "generating-code", sessionKey })
    const session = await getSessionState(sessionKey)
    if (!session) throw new Error("Session not found")

    const settings = await getSettings()
    const selected = settings?.selectedModels
    const files = await generateCode({
      ideas: session.testIdeas,
      context: session,
      framework: settings?.targetFramework ?? "playwright",
      language: settings?.targetLanguage ?? "typescript",
      provider: selected?.codeGenProvider ?? "openai",
      model: selected?.codeGenModel ?? "gpt-4o-mini",
    })
    await updateSessionState({ generatedFiles: files }, sessionKey)
    await setGenStatus({ phase: "idle" })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await chrome.storage.local.set({
      jackGenStatus: { phase: "error", sessionKey, error, failedPhase: "code" },
    })
  }
}

async function runJackGenerateMobileCode(sessionKey: string): Promise<void> {
  try {
    await setGenStatus({ phase: "generating-code", sessionKey })
    const session = await getSessionState(sessionKey)
    if (!session) throw new Error("Session not found")

    const settings = await getSettings()
    const selected = settings?.selectedModels
    const files = await generateMobileCode({
      ideas: session.testIdeas,
      context: session,
      provider: selected?.codeGenProvider ?? "openai",
      model: selected?.codeGenModel ?? "gpt-4o-mini",
    })
    await updateSessionState({ generatedFiles: files }, sessionKey)
    await setGenStatus({ phase: "idle" })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await chrome.storage.local.set({
      jackGenStatus: { phase: "error", sessionKey, error, failedPhase: "code" },
    })
  }
}

registerTabVideoCleanup()
