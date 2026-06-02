const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:",
  "chrome-search://",
  "chrome-devtools://"
]

export function isInspectableTabUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith("https://chrome.google.com/webstore")) return false
  return !RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix))
}

function getPageToolsScriptFiles(): string[] {
  const entries = chrome.runtime.getManifest().content_scripts ?? []
  for (const cs of entries) {
    const file = cs.js?.find((f) => f.includes("page-tools"))
    if (file) return [file]
  }
  return []
}

export async function injectPageTools(tabId: number): Promise<void> {
  const files = getPageToolsScriptFiles()
  if (!files.length) {
    throw new Error("page-tools content script not found in manifest")
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files
  })
}

function getRecordingWidgetScriptFiles(): string[] {
  const entries = chrome.runtime.getManifest().content_scripts ?? []
  for (const cs of entries) {
    const file = cs.js?.find((f) => f.includes("recording-widget"))
    if (file) return [file]
  }
  return []
}

export async function injectRecordingWidget(tabId: number): Promise<void> {
  const files = getRecordingWidgetScriptFiles()
  if (!files.length) {
    throw new Error("recording-widget content script not found in manifest")
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files
  })
}

export async function sendTabMessage<T = unknown>(
  tabId: number,
  message: unknown
): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch {
    try {
      await injectPageTools(tabId)
      return (await chrome.tabs.sendMessage(tabId, message)) as T
    } catch (err) {
      throw new Error(
        "Нет доступа к вкладке. Откройте попап через иконку расширения на этой вкладке и нажмите кнопку снова.",
        { cause: err }
      )
    }
  }
}
