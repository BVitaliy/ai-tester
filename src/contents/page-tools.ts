import type { PlasmoCSConfig } from "plasmo"

/*
 * Bundled for chrome.scripting.executeScript only (see tabMessage.ts).
 * Must be declared inline — Plasmo ignores re-exported config objects.
 */

export const config: PlasmoCSConfig = {
  matches: ["https://www.plasmo.com/*"],
  run_at: "document_end"
}

// Safely send a runtime message — no-op when context is invalidated.
function safeSend(msg: Record<string, unknown>): void {
  try {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage(msg).catch(() => {})
  } catch {
    // extension context invalidated — ignore
  }
}

// Internal state
type Mode = "dormant" | "inspector" | "recording"
let mode: Mode = "dormant"
let recordedActions: any[] = [] as any[]
let lastUrl = window.location.href

let highlight: HTMLDivElement | null = null

function ensureHighlight(): HTMLDivElement {
  if (highlight) return highlight
  const el = document.createElement("div")
  el.style.position = "absolute"
  el.style.zIndex = "2147483647"
  el.style.pointerEvents = "none"
  el.style.border = "2px solid #DC2626"
  el.style.backgroundColor = "rgba(220, 38, 38, 0.12)"
  el.style.display = "none"
  document.documentElement.appendChild(el)
  highlight = el
  return el
}

// Helper: compute a unique CSS selector for the given element.  Prefer
// id's if present; otherwise build a path using tag names and nth-child.
function computeSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const parts: string[] = []
  let current: Element | null = el
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    const tag = current.tagName.toLowerCase()
    let selector = tag
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === tag)
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1
        selector += `:nth-of-type(${index})`
      }
    }
    parts.unshift(selector)
    current = current.parentElement
  }
  return parts.join(" > ")
}

// Event handlers for inspector mode
function onMouseOver(e: MouseEvent) {
  if (mode !== "inspector") return
  const target = e.target as Element
  if (!target || !(target instanceof Element)) return
  const box = ensureHighlight()
  const rect = target.getBoundingClientRect()
  box.style.display = "block"
  box.style.left = `${rect.left + window.scrollX}px`
  box.style.top = `${rect.top + window.scrollY}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

function onMouseOut(_e: MouseEvent) {
  if (mode !== "inspector") return
  ensureHighlight().style.display = "none"
}

function onClick(e: MouseEvent) {
  if (mode !== "inspector") return
  e.preventDefault()
  e.stopPropagation()
  const target = e.target as Element
  if (!target || !(target instanceof Element)) return
  const selector = computeSelector(target)
  const outerHTML = target.outerHTML
  // Clean up
  deactivateInspector()
  // Send result back to extension
  safeSend({ type: "ELEMENT_SELECTED", selector, outerHTML })
}

function activateInspector() {
  mode = "inspector"
  document.addEventListener("mouseover", onMouseOver, true)
  document.addEventListener("mouseout", onMouseOut, true)
  document.addEventListener("click", onClick, true)
}

function deactivateInspector() {
  mode = "dormant"
  if (highlight) highlight.style.display = "none"
  document.removeEventListener("mouseover", onMouseOver, true)
  document.removeEventListener("mouseout", onMouseOut, true)
  document.removeEventListener("click", onClick, true)
}

// Event handlers for recording mode
function recordClick(e: MouseEvent) {
  if (mode !== "recording") return
  const target = e.target as Element
  if (!target || !(target instanceof Element)) return
  const selector = computeSelector(target)
  recordedActions.push({ type: "click", selector, timestamp: Date.now() })
}

function recordInput(e: Event) {
  if (mode !== "recording") return
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | any
  if (!target) return
  const selector = computeSelector(target as Element)
  const value = (target as any).value
  recordedActions.push({ type: "input", selector, value, timestamp: Date.now() })
}

function checkNavigation() {
  if (mode !== "recording") return
  const currentUrl = window.location.href
  if (currentUrl !== lastUrl) {
    recordedActions.push({ type: "navigate", selector: "", url: currentUrl, timestamp: Date.now() })
    lastUrl = currentUrl
  }
}

function activateRecorder() {
  mode = "recording"
  recordedActions = []
  lastUrl = window.location.href
  window.addEventListener("click", recordClick, true)
  window.addEventListener("input", recordInput, true)
  // Poll for navigation changes every second
  navInterval = window.setInterval(checkNavigation, 1000)
}

function deactivateRecorder() {
  mode = "dormant"
  window.removeEventListener("click", recordClick, true)
  window.removeEventListener("input", recordInput, true)
  window.clearInterval(navInterval)
}

let navInterval: number | undefined

// ── Voice dictation ──────────────────────────────────────────────────────────

let dictationRecognition: SpeechRecognition | null = null

function startDictation(lang: string): void {
  const Ctor: (new () => SpeechRecognition) | undefined =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (!Ctor) {
    safeSend({ type: "DICTATION_ERROR", error: "not_supported" })
    return
  }
  dictationRecognition?.stop()
  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = true
  recognition.interimResults = true
  dictationRecognition = recognition

  recognition.onresult = (e: SpeechRecognitionEvent) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      safeSend({
        type: "DICTATION_RESULT",
        text: e.results[i][0].transcript,
        isFinal: e.results[i].isFinal,
      })
    }
  }
  recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
    safeSend({ type: "DICTATION_ERROR", error: e.error })
  }
  recognition.onend = () => {
    dictationRecognition = null
    safeSend({ type: "DICTATION_ENDED" })
  }
  recognition.start()
}

function stopDictation(): void {
  dictationRecognition?.stop()
  dictationRecognition = null
}

// ── Message listener ─────────────────────────────────────────────────────────

const MESSAGE_LISTENER_KEY = "__jackQaOverlayListener"

if (!(globalThis as Record<string, unknown>)[MESSAGE_LISTENER_KEY]) {
  ;(globalThis as Record<string, unknown>)[MESSAGE_LISTENER_KEY] = true
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "START_INSPECT") {
      activateInspector()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === "STOP_INSPECT") {
      deactivateInspector()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === "START_RECORDER") {
      activateRecorder()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === "STOP_RECORDER") {
      const actions = recordedActions.slice()
      deactivateRecorder()
      safeSend({ type: "RECORDER_RESULTS", actions })
      sendResponse({ ok: true })
      return true
    }
    if (message.type === "START_DICTATION") {
      startDictation(message.lang ?? "uk-UA")
      sendResponse({ ok: true })
      return true
    }
    if (message.type === "STOP_DICTATION") {
      stopDictation()
      sendResponse({ ok: true })
      return true
    }
  })
}