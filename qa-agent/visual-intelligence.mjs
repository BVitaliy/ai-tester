// Visual intelligence. Detects layout/UX issues that the UI tree reveals on its
// own (blank screens, overlapping content, hidden/zero-size buttons, probable
// loading loops). A screenshot + vision model can enrich this later via the
// optional `visionHook`, but the heuristics below need no model.

function area(b) {
  return b && b.width > 0 && b.height > 0 ? b.width * b.height : 0
}

function overlap(a, b) {
  if (!a || !b) return 0
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return x * y
}

function isProgress(el) {
  return /progress|activityindicator|spinner|loading/i.test(`${el.className ?? ""} ${el.label ?? ""}`)
}

// `screen` is an app-map screen (clickableElements + visibleTexts); `uiTree` is
// the optional richer dump ({ elements }) saved per screen.
export function analyzeVisual(screen, uiTree) {
  const issues = []
  const elements = uiTree?.elements ?? screen?.clickableElements ?? []
  const visibleTexts = screen?.visibleTexts ?? []

  // Blank / near-empty screen.
  if (visibleTexts.length === 0 && elements.filter((e) => area(e.bounds) > 0).length <= 1) {
    issues.push({
      type: "blank-screen",
      severity: "high",
      detail: "Screen exposes no readable text and almost no rendered elements.",
      evidence: []
    })
  }

  // Hidden / zero-size interactive elements.
  const hidden = elements.filter(
    (e) => (e.clickable || /button/i.test(e.className ?? "")) && e.bounds && area(e.bounds) === 0
  )
  if (hidden.length) {
    issues.push({
      type: "hidden-buttons",
      severity: "medium",
      detail: `${hidden.length} interactive element(s) have zero rendered size (possibly hidden/unreachable).`,
      evidence: hidden.slice(0, 5).map((e) => e.label || e.className).filter(Boolean)
    })
  }

  // Significant overlap between interactive elements.
  const withBounds = elements.filter((e) => area(e.bounds) > 0)
  let overlapPairs = 0
  const overlapEvidence = []
  for (let i = 0; i < withBounds.length && overlapPairs < 6; i++) {
    for (let j = i + 1; j < withBounds.length; j++) {
      const a = withBounds[i].bounds
      const b = withBounds[j].bounds
      const ov = overlap(a, b)
      if (ov > 0 && ov > 0.6 * Math.min(area(a), area(b))) {
        overlapPairs++
        if (overlapEvidence.length < 5) {
          overlapEvidence.push(`${withBounds[i].label || "?"} ∩ ${withBounds[j].label || "?"}`)
        }
        break
      }
    }
  }
  if (overlapPairs >= 2) {
    issues.push({
      type: "overlapping-content",
      severity: "medium",
      detail: `${overlapPairs}+ interactive elements substantially overlap (possible broken layout).`,
      evidence: overlapEvidence
    })
  }

  // Probable loading indicator on screen.
  const progress = elements.filter(isProgress)
  if (progress.length) {
    issues.push({
      type: "loading-indicator",
      severity: "low",
      detail: "A loading/progress indicator is present; verify the screen finishes loading (no spinner loop).",
      evidence: progress.slice(0, 3).map((e) => e.label || e.className).filter(Boolean)
    })
  }

  return issues
}

// Optional vision enrichment. `visionHook(screenshotPath, uiSummary)` may return
// extra issues from a screenshot+model; absent or failing, we just return [].
export async function analyzeVisualWithVision(screen, uiTree, visionHook) {
  const base = analyzeVisual(screen, uiTree)
  if (typeof visionHook !== "function" || !screen?.screenshotPath) return base
  try {
    const extra = await visionHook(screen.screenshotPath, { visibleTexts: screen.visibleTexts })
    return base.concat(Array.isArray(extra) ? extra : [])
  } catch {
    return base
  }
}
