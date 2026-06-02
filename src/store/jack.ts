import type {
  CapturedScreenshot,
  JackGenStatus,
  JackSessionState,
  ProviderKeys,
  SelectedModels,
  TargetFramework,
  TargetLanguage,
} from "../core/types"
import type { LangCode } from "../core/i18n"
import {
  compressDataUrl,
  deleteScreenshot,
  getScreenshot,
  putScreenshot
} from "../lib/screenshotStorage"
import { getVideoDataUrl, deleteVideo } from "../lib/videoStorage"

const MAX_SCREENSHOTS_PER_SITE = 12

export function emptyJackSession(): JackSessionState {
  return { recordedActions: [], testIdeas: [], generatedFiles: [], screenshots: [] }
}

export function getSessionKeyFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab
}

export async function resolveActiveSessionKey(): Promise<string | null> {
  const tab = await getActiveTab()
  return getSessionKeyFromUrl(tab?.url)
}

export async function getScreenshotDataUrl(
  sessionKey: string,
  shot: CapturedScreenshot
): Promise<string | undefined> {
  return getScreenshot(sessionKey, shot.id)
}

export async function loadScreenshotsWithData(
  sessionKey: string,
  shots: CapturedScreenshot[]
): Promise<Array<CapturedScreenshot & { dataUrl: string }>> {
  const loaded = await Promise.all(
    shots.map(async (shot) => {
      const dataUrl = await getScreenshot(sessionKey, shot.id)
      return dataUrl ? { ...shot, dataUrl } : null
    })
  )
  return loaded.filter((s): s is CapturedScreenshot & { dataUrl: string } => s !== null)
}

async function pruneScreenshots(
  sessionKey: string,
  screenshots: CapturedScreenshot[]
): Promise<CapturedScreenshot[]> {
  if (screenshots.length <= MAX_SCREENSHOTS_PER_SITE) return screenshots
  const drop = screenshots.slice(0, screenshots.length - MAX_SCREENSHOTS_PER_SITE)
  await Promise.all(drop.map((s) => deleteScreenshot(sessionKey, s.id)))
  return screenshots.slice(-MAX_SCREENSHOTS_PER_SITE)
}

export async function addScreenshot(
  sessionKey: string,
  rawDataUrl: string
): Promise<CapturedScreenshot> {
  const dataUrl = await compressDataUrl(rawDataUrl)
  const shot: CapturedScreenshot = { id: crypto.randomUUID(), createdAt: Date.now() }
  await putScreenshot(sessionKey, shot.id, dataUrl)

  const sessions = await getAllTabSessions()
  const current = sessions[sessionKey] ?? emptyJackSession()
  let screenshots = [...current.screenshots, shot]
  screenshots = await pruneScreenshots(sessionKey, screenshots)

  sessions[sessionKey] = {
    ...current,
    screenshots,
    screenshotDataUrl: dataUrl,
    mediaDescription: undefined
  }
  await setAllTabSessions(sessions)
  return shot
}

export async function updateScreenshotData(
  sessionKey: string,
  screenshotId: string,
  rawDataUrl: string
): Promise<void> {
  const dataUrl = await compressDataUrl(rawDataUrl)
  await putScreenshot(sessionKey, screenshotId, dataUrl)

  const sessions = await getAllTabSessions()
  const current = sessions[sessionKey] ?? emptyJackSession()
  sessions[sessionKey] = {
    ...current,
    screenshotDataUrl: dataUrl,
    mediaDescription: undefined
  }
  await setAllTabSessions(sessions)
}

// -----------------------------------------------------------------------------
// Provider keys

export async function getStoredProviderModels(): Promise<Partial<Record<string, string[]>>> {
  const r = await chrome.storage.local.get("jackProviderModels")
  return (r.jackProviderModels as Partial<Record<string, string[]>>) ?? {}
}

export async function setStoredProviderModels(
  models: Partial<Record<string, string[]>>
): Promise<void> {
  await chrome.storage.local.set({ jackProviderModels: models })
}

export async function getProviderKeys(): Promise<ProviderKeys> {
  const r = await chrome.storage.local.get("jackProviderKeys")
  const defaults: ProviderKeys = {
    openaiKey: null,
    geminiKey: null,
    groqKey: null,
    openrouterKey: null,
    grokKey: null,
    openaiModel: null,
    geminiModel: null,
    groqModel: null,
    openrouterModel: null,
    grokModel: null
  }
  return Object.assign(defaults, r.jackProviderKeys)
}

export async function setProviderKeys(update: Partial<ProviderKeys>): Promise<void> {
  const current = await getProviderKeys()
  await chrome.storage.local.set({ jackProviderKeys: { ...current, ...update } })
}

// -----------------------------------------------------------------------------
// Selected models and target settings

export interface JackSettings {
  selectedModels: SelectedModels
  targetFramework: TargetFramework
  targetLanguage: TargetLanguage
  uiLanguage: LangCode
}

export async function getSettings(): Promise<JackSettings | null> {
  const r = await chrome.storage.local.get("jackSettings")
  return r.jackSettings ?? null
}

export async function getUiLanguage(): Promise<LangCode> {
  const s = await getSettings()
  return s?.uiLanguage ?? "uk"
}

export async function setSettings(settings: JackSettings): Promise<void> {
  await chrome.storage.local.set({ jackSettings: settings })
}

// -----------------------------------------------------------------------------
// Per-site session metadata (chrome.storage.local — screenshots stored separately)

type TabSessions = Record<string, JackSessionState>

async function getAllTabSessions(): Promise<TabSessions> {
  const r = await chrome.storage.local.get("jackTabSessions")
  return (r.jackTabSessions as TabSessions) ?? {}
}

async function setAllTabSessions(sessions: TabSessions): Promise<void> {
  await chrome.storage.local.set({ jackTabSessions: sessions })
}

export interface JackAnnotateContext {
  sessionKey: string
  returnTabId: number
  returnWindowId: number
  screenshotId: string
}

export async function getAnnotateContext(): Promise<JackAnnotateContext | null> {
  const r = await chrome.storage.session.get("jackAnnotateContext")
  return r.jackAnnotateContext ?? null
}

export async function setAnnotateContext(ctx: JackAnnotateContext): Promise<void> {
  await chrome.storage.session.set({ jackAnnotateContext: ctx })
}

export async function clearAnnotateContext(): Promise<void> {
  await chrome.storage.session.remove("jackAnnotateContext")
}

export async function setLastSessionKey(key: string): Promise<void> {
  await chrome.storage.session.set({ jackLastSessionKey: key })
}

export async function getRecordingTabId(): Promise<number | null> {
  const r = await chrome.storage.session.get("jackRecordingTabId")
  return r.jackRecordingTabId ?? null
}

export async function setRecordingTabId(tabId: number | null): Promise<void> {
  if (tabId !== null) {
    await chrome.storage.session.set({ jackRecordingTabId: tabId })
  } else {
    await chrome.storage.session.remove("jackRecordingTabId")
  }
}

export async function getLastSessionKey(): Promise<string | null> {
  const r = await chrome.storage.session.get("jackLastSessionKey")
  return r.jackLastSessionKey ?? null
}

async function resolveSessionKey(explicit?: string): Promise<string | null> {
  if (explicit) return explicit
  const last = await getLastSessionKey()
  if (last) return last
  return resolveActiveSessionKey()
}

export async function getSessionState(sessionKey?: string): Promise<JackSessionState | null> {
  const key = await resolveSessionKey(sessionKey)
  if (!key) return null
  const sessions = await getAllTabSessions()
  return sessions[key] ?? null
}

export async function getSessionVideoDataUrl(sessionKey: string): Promise<string | undefined> {
  const state = await getSessionState(sessionKey)
  if (state?.hasVideo) return getVideoDataUrl(sessionKey)
  return state?.videoDataUrl
}

export async function markSessionVideoSaved(
  sessionKey: string,
  mimeType: string
): Promise<void> {
  await updateSessionState(
    { hasVideo: true, videoMimeType: mimeType, videoDataUrl: undefined, mediaDescription: undefined },
    sessionKey
  )
}

export async function setSessionState(
  state: JackSessionState,
  sessionKey?: string
): Promise<void> {
  const key = await resolveSessionKey(sessionKey)
  if (!key) return
  const sessions = await getAllTabSessions()
  sessions[key] = state
  await setAllTabSessions(sessions)
}

export async function updateSessionState(
  patch: Partial<JackSessionState>,
  sessionKey?: string
): Promise<void> {
  const key = await resolveSessionKey(sessionKey)
  if (!key) return
  const sessions = await getAllTabSessions()
  const current = sessions[key] ?? emptyJackSession()
  const next: JackSessionState = { ...emptyJackSession(), ...current, ...patch }
  sessions[key] = next
  await setAllTabSessions(sessions)
}

export async function deleteSessionScreenshot(
  sessionKey: string,
  screenshotId: string
): Promise<void> {
  await deleteScreenshot(sessionKey, screenshotId)
  const sessions = await getAllTabSessions()
  const current = sessions[sessionKey] ?? emptyJackSession()
  const remaining = current.screenshots.filter((s) => s.id !== screenshotId)
  sessions[sessionKey] = {
    ...current,
    screenshots: remaining,
    screenshotDataUrl: remaining.length === 0 ? undefined : current.screenshotDataUrl,
    mediaDescription: undefined,
  }
  await setAllTabSessions(sessions)
}

export async function deleteSessionVideo(sessionKey: string): Promise<void> {
  await deleteVideo(sessionKey)
  const sessions = await getAllTabSessions()
  const current = sessions[sessionKey] ?? emptyJackSession()
  sessions[sessionKey] = {
    ...current,
    hasVideo: false,
    videoDataUrl: undefined,
    videoMimeType: undefined,
    mediaDescription: undefined,
  }
  await setAllTabSessions(sessions)
}

// -----------------------------------------------------------------------------
// Background generation status

export async function getGenStatus(): Promise<JackGenStatus> {
  const r = await chrome.storage.local.get("jackGenStatus")
  return (r.jackGenStatus as JackGenStatus) ?? { phase: "idle" }
}

export async function setGenStatus(status: JackGenStatus): Promise<void> {
  await chrome.storage.local.set({ jackGenStatus: status })
}

export async function clearSessionState(sessionKey?: string): Promise<void> {
  const key = await resolveSessionKey(sessionKey)
  if (!key) return
  const sessions = await getAllTabSessions()
  const removed = sessions[key]
  if (removed?.screenshots) {
    await Promise.all(removed.screenshots.map((s) => deleteScreenshot(key, s.id)))
  }
  if (removed?.hasVideo) {
    await deleteVideo(key)
  }
  delete sessions[key]
  await setAllTabSessions(sessions)
}

export async function finishAnnotate(
  annotatedDataUrl: string | null,
  annotateTabId?: number
): Promise<void> {
  const ctx = await getAnnotateContext()
  if (ctx) {
    if (annotatedDataUrl) {
      await updateScreenshotData(ctx.sessionKey, ctx.screenshotId, annotatedDataUrl)
    } else {
      // User cancelled — remove the screenshot that was pre-added before annotation
      await deleteSessionScreenshot(ctx.sessionKey, ctx.screenshotId)
    }
  }
  await clearAnnotateContext()

  if (ctx) {
    try {
      await chrome.windows.update(ctx.returnWindowId, { focused: true })
      await chrome.tabs.update(ctx.returnTabId, { active: true })
    } catch {
      // tab/window may already be closed
    }
  }

  if (annotateTabId) {
    try {
      await chrome.tabs.remove(annotateTabId)
    } catch {
      // already closed
    }
  }
}
