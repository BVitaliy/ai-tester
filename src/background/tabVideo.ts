import { injectRecordingWidget, isInspectableTabUrl, sendTabMessage } from "../lib/tabMessage"

export type TabVideoStatus = "recording" | "paused"

export interface TabVideoState {
  tabId: number
  windowId: number
  sessionKey: string
  status: TabVideoStatus
  startedAt: number
  recorderTabId: number
}

const RECORDER_PAGE = "tabs/tab-recorder.html"

function recorderPageUrl(): string {
  return chrome.runtime.getURL(RECORDER_PAGE)
}

export async function getTabVideoState(): Promise<TabVideoState | null> {
  const r = await chrome.storage.session.get("jackTabVideoState")
  return r.jackTabVideoState ?? null
}

async function setTabVideoState(state: TabVideoState | null): Promise<void> {
  if (state) {
    await chrome.storage.session.set({ jackTabVideoState: state })
    chrome.action.setBadgeText({ text: "REC" })
    chrome.action.setBadgeBackgroundColor({ color: "#DC2626" })
  } else {
    await chrome.storage.session.remove("jackTabVideoState")
    chrome.action.setBadgeText({ text: "" })
  }
}

async function waitForRecorderTab(recorderTabId: number): Promise<void> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const res = await chrome.tabs.sendMessage(recorderTabId, { type: "RECORDER_PING" })
      if (res?.ok) return
    } catch {
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  throw new Error("recorder_tab_not_ready")
}

async function ensureRecorderTab(): Promise<number> {
  const url = recorderPageUrl()
  const existing = await chrome.tabs.query({ url })
  if (existing[0]?.id) {
    await waitForRecorderTab(existing[0].id)
    return existing[0].id
  }
  const tab = await chrome.tabs.create({
    url,
    active: false,
    pinned: true
  })
  if (!tab.id) throw new Error("recorder_tab_create_failed")
  await waitForRecorderTab(tab.id)
  return tab.id
}

async function sendRecorder(
  recorderTabId: number,
  message: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; sessionKey?: string; mimeType?: string }> {
  return chrome.tabs.sendMessage(recorderTabId, message)
}

async function syncWidget(tabId: number, status: TabVideoStatus, startedAt: number): Promise<void> {
  try {
    await sendTabMessage(tabId, {
      type: "VIDEO_WIDGET_SYNC",
      status,
      startedAt
    })
  } catch {
    await injectRecordingWidget(tabId)
    await sendTabMessage(tabId, {
      type: "VIDEO_WIDGET_SYNC",
      status,
      startedAt
    })
  }
}

export async function startTabVideoRecording(opts: {
  tabId: number
  windowId: number
  sessionKey: string
  streamId?: string
}): Promise<{ ok: boolean; error?: string }> {
  const current = await getTabVideoState()
  if (current) {
    return { ok: false, error: "already_recording" }
  }

  const tab = await chrome.tabs.get(opts.tabId)
  if (!tab.url || !isInspectableTabUrl(tab.url)) {
    return { ok: false, error: "not_allowed" }
  }

  try {
    const streamId =
      opts.streamId ??
      (await new Promise<string>((resolve) =>
        chrome.tabCapture.getMediaStreamId({ targetTabId: opts.tabId }, resolve)
      ))
    const recorderTabId = await ensureRecorderTab()
    const res = await sendRecorder(recorderTabId, {
      type: "OFFSCREEN_START_RECORD",
      streamId,
      sessionKey: opts.sessionKey
    })
    if (!res?.ok) {
      return { ok: false, error: res?.error ?? "recorder_start_failed" }
    }

    const startedAt = Date.now()
    await setTabVideoState({
      tabId: opts.tabId,
      windowId: opts.windowId,
      sessionKey: opts.sessionKey,
      status: "recording",
      startedAt,
      recorderTabId
    })
    await injectRecordingWidget(opts.tabId)
    await syncWidget(opts.tabId, "recording", startedAt)
    return { ok: true }
  } catch (err) {
    await setTabVideoState(null)
    return { ok: false, error: String(err) }
  }
}

export async function pauseTabVideoRecording(): Promise<void> {
  const state = await getTabVideoState()
  if (!state || state.status === "paused") return
  await sendRecorder(state.recorderTabId, { type: "OFFSCREEN_PAUSE_RECORD" })
  const next = { ...state, status: "paused" as const }
  await setTabVideoState(next)
  await syncWidget(state.tabId, "paused", state.startedAt)
}

export async function resumeTabVideoRecording(): Promise<void> {
  const state = await getTabVideoState()
  if (!state || state.status === "recording") return
  await sendRecorder(state.recorderTabId, { type: "OFFSCREEN_RESUME_RECORD" })
  const next = { ...state, status: "recording" as const }
  await setTabVideoState(next)
  await syncWidget(state.tabId, "recording", state.startedAt)
}

export async function stopTabVideoRecording(): Promise<{
  ok: boolean
  sessionKey?: string
  mimeType?: string
  tabId?: number
  windowId?: number
  error?: string
}> {
  const state = await getTabVideoState()
  if (!state) return { ok: false, error: "not_recording" }

  try {
    const res = await sendRecorder(state.recorderTabId, { type: "OFFSCREEN_STOP_RECORD" })
    await setTabVideoState(null)
    try {
      await sendTabMessage(state.tabId, { type: "VIDEO_WIDGET_HIDE" })
    } catch {
      // tab may be gone
    }
    if (!res?.ok) return { ok: false, error: res?.error ?? "stop_failed" }
    return {
      ok: true,
      sessionKey: res.sessionKey,
      mimeType: res.mimeType,
      tabId: state.tabId,
      windowId: state.windowId
    }
  } catch (err) {
    await setTabVideoState(null)
    return { ok: false, error: String(err) }
  }
}

export function registerTabVideoCleanup(): void {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getTabVideoState()
    if (state?.tabId === tabId) {
      await stopTabVideoRecording()
    }
  })
}

export async function isVideoRecordingForOrigin(origin: string | null): Promise<boolean> {
  const state = await getTabVideoState()
  if (!state || !origin) return false
  return state.sessionKey === origin
}
