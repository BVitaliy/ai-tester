import type { AuthState, CaptureFlow, Destination, WPPost } from "../core/types"

// ── Persisted: chrome.storage.local ──────────────────────────────────────────

export async function getAuth(): Promise<AuthState> {
  const r = await chrome.storage.local.get("auth")
  return r.auth ?? { token: null, user: null }
}
export async function setAuth(auth: AuthState): Promise<void> {
  await chrome.storage.local.set({ auth })
}
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove("auth")
}

export async function getLastDestination(): Promise<Destination | null> {
  const r = await chrome.storage.local.get("lastDestination")
  return r.lastDestination ?? null
}
export async function setLastDestination(destination: Destination | null): Promise<void> {
  await chrome.storage.local.set({ lastDestination: destination })
}

export async function getLastPost(): Promise<WPPost | null> {
  const r = await chrome.storage.local.get("lastPost")
  return r.lastPost ?? null
}
export async function setLastPost(post: WPPost | null): Promise<void> {
  await chrome.storage.local.set({ lastPost: post })
}

export async function getAiKeys(): Promise<{ geminiKey: string | null; geminiModel: string | null }> {
  const r = await chrome.storage.local.get("aiKeys")
  return {
    geminiKey: r.aiKeys?.geminiKey ?? null,
    geminiModel: r.aiKeys?.geminiModel ?? null,
  }
}
export async function setAiKeys(keys: { geminiKey: string; geminiModel?: string }): Promise<void> {
  const r = await chrome.storage.local.get("aiKeys")
  await chrome.storage.local.set({ aiKeys: { ...r.aiKeys, ...keys } })
}

// ── Session: chrome.storage.session ──────────────────────────────────────────

export async function getCaptureFlow(): Promise<CaptureFlow | null> {
  const r = await chrome.storage.session.get("captureFlow")
  return r.captureFlow ?? null
}
export async function setCaptureFlow(flow: CaptureFlow): Promise<void> {
  await chrome.storage.session.set({ captureFlow: flow })
}
export async function updateCaptureFlow(patch: Partial<CaptureFlow>): Promise<void> {
  const current = await getCaptureFlow()
  if (!current) return
  await chrome.storage.session.set({ captureFlow: { ...current, ...patch } })
}
export async function clearCaptureFlow(): Promise<void> {
  await chrome.storage.session.remove("captureFlow")
}

export async function getEditorWindowId(): Promise<number | null> {
  const r = await chrome.storage.session.get("editorWindowId")
  return r.editorWindowId ?? null
}
export async function setEditorWindowId(id: number | null): Promise<void> {
  await chrome.storage.session.set({ editorWindowId: id })
}

export async function getOverlayTabId(): Promise<number | null> {
  const r = await chrome.storage.session.get("overlayTabId")
  return r.overlayTabId ?? null
}
export async function setOverlayTabId(id: number | null): Promise<void> {
  await chrome.storage.session.set({ overlayTabId: id })
}

export async function getEditorTabId(): Promise<number | null> {
  const r = await chrome.storage.session.get("editorTabId")
  return r.editorTabId ?? null
}
export async function setEditorTabId(id: number | null): Promise<void> {
  await chrome.storage.session.set({ editorTabId: id })
}
