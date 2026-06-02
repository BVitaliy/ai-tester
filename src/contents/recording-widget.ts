import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://www.plasmo.com/*"],
  run_at: "document_end"
}

function safeSend(msg: Record<string, unknown>): void {
  try {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage(msg).catch(() => {})
  } catch {
    // extension context invalidated
  }
}

const WIDGET_KEY = "__jackRecordingWidget"

type WidgetStatus = "recording" | "paused"

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function mountWidget(): void {
  if ((globalThis as Record<string, unknown>)[WIDGET_KEY]) return
  ;(globalThis as Record<string, unknown>)[WIDGET_KEY] = true

  let status: WidgetStatus = "recording"
  let startedAt = Date.now()
  let pausedAt = 0
  let pausedTotal = 0

  const root = document.createElement("div")
  root.id = "jack-recording-widget"
  root.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "bottom:24px",
    "right:24px",
    "font-family:system-ui,sans-serif",
    "font-size:13px",
    "color:#f9fafb",
    "background:#1e2533",
    "border:1px solid #b91c1c",
    "border-radius:10px",
    "box-shadow:0 8px 24px rgba(0,0,0,.45)",
    "padding:10px 12px",
    "min-width:200px",
    "cursor:grab",
    "user-select:none"
  ].join(";")

  const header = document.createElement("div")
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px"

  const dot = document.createElement("span")
  dot.style.cssText =
    "width:10px;height:10px;border-radius:50%;background:#ef4444;flex-shrink:0"
  const timer = document.createElement("span")
  timer.style.fontWeight = "600"
  timer.textContent = "0:00"
  const label = document.createElement("span")
  label.style.cssText = "color:#f87171;font-size:11px"
  label.textContent = "Запись вкладки"

  header.append(dot, timer, label)

  const row = document.createElement("div")
  row.style.cssText = "display:flex;gap:6px"

  const mkBtn = (text: string, bg: string) => {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = text
    b.style.cssText = [
      "flex:1",
      "border:none",
      "border-radius:6px",
      "padding:6px 8px",
      "cursor:pointer",
      "font-size:12px",
      "font-weight:600",
      `background:${bg}`,
      "color:#fff"
    ].join(";")
    return b
  }

  const pauseBtn = mkBtn("Пауза", "#475569")
  const resumeBtn = mkBtn("Продолжить", "#475569")
  resumeBtn.style.display = "none"
  const stopBtn = mkBtn("Завершить", "#b91c1c")

  row.append(pauseBtn, resumeBtn, stopBtn)
  root.append(header, row)
  document.documentElement.appendChild(root)

  let drag: { dx: number; dy: number } | null = null
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return
    drag = { dx: e.clientX - root.offsetLeft, dy: e.clientY - root.offsetTop }
    root.style.cursor = "grabbing"
    root.setPointerCapture(e.pointerId)
  })
  root.addEventListener("pointermove", (e) => {
    if (!drag) return
    root.style.left = `${e.clientX - drag.dx}px`
    root.style.top = `${e.clientY - drag.dy}px`
    root.style.right = "auto"
    root.style.bottom = "auto"
  })
  const endDrag = () => {
    drag = null
    root.style.cursor = "grab"
  }
  root.addEventListener("pointerup", endDrag)
  root.addEventListener("pointercancel", endDrag)

  const tick = () => {
    const elapsed =
      status === "paused"
        ? pausedAt - startedAt - pausedTotal
        : Date.now() - startedAt - pausedTotal
    timer.textContent = formatElapsed(Math.max(0, elapsed))
    dot.style.background = status === "paused" ? "#f59e0b" : "#ef4444"
    label.textContent = status === "paused" ? "Пауза" : "Запись вкладки"
    pauseBtn.style.display = status === "recording" ? "block" : "none"
    resumeBtn.style.display = status === "paused" ? "block" : "none"
  }
  const interval = window.setInterval(tick, 500)
  tick()

  pauseBtn.onclick = () => {
    safeSend({ type: "TAB_VIDEO_PAUSE" })
  }
  resumeBtn.onclick = () => {
    safeSend({ type: "TAB_VIDEO_RESUME" })
  }
  stopBtn.onclick = () => {
    stopBtn.disabled = true
    pauseBtn.disabled = true
    resumeBtn.disabled = true
    label.textContent = "Сохранение…"
    safeSend({ type: "TAB_VIDEO_STOP" })
  }

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "VIDEO_WIDGET_SYNC") {
        status = message.status
        startedAt = message.startedAt ?? startedAt
        if (status === "recording" && pausedAt) {
          pausedTotal += Date.now() - pausedAt
          pausedAt = 0
        }
        if (status === "paused" && !pausedAt) pausedAt = Date.now()
        tick()
      }
      if (message.type === "VIDEO_WIDGET_HIDE") {
        window.clearInterval(interval)
        root.remove()
        delete (globalThis as Record<string, unknown>)[WIDGET_KEY]
      }
    })
  } catch {
    // extension context invalidated
  }
}

mountWidget()
