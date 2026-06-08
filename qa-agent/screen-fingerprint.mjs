import crypto from "node:crypto"

// Screen fingerprinting: turns a UI tree (the { xml, elements, focusedWindow }
// shape produced by server.mjs dumpUi) into a stable signature so the crawler
// can tell whether the current screen is new or already known.

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

// Strip volatile content (digits, times, counters) so the same screen with a
// changing badge count or clock still fingerprints identically.
function stabilizeText(value = "") {
  return normalizeText(value)
    .replace(/\d+[:.]\d+(?:[:.]\d+)?/g, "#time")
    .replace(/\d+/g, "#")
    .trim()
}

export function extractVisibleTexts(uiTree) {
  const elements = uiTree?.elements ?? []
  const seen = new Set()
  const texts = []
  for (const element of elements) {
    const candidate = element.text || element.contentDesc || ""
    const clean = normalizeText(candidate)
    if (!clean) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    texts.push(candidate.trim())
  }
  return texts
}

export function extractClickableElements(uiTree) {
  const elements = uiTree?.elements ?? []
  return elements
    .filter((element) => element.clickable && element.enabled !== false)
    .map((element) => ({
      id: element.id,
      label: element.label ?? "",
      text: element.text ?? "",
      contentDesc: element.contentDesc ?? "",
      resourceId: element.resourceId ?? "",
      className: element.className ?? "",
      bounds: element.bounds
        ? {
            centerX: element.bounds.centerX,
            centerY: element.bounds.centerY,
            width: element.bounds.width,
            height: element.bounds.height
          }
        : null
    }))
}

// A reduced, order-stable structural view of the hierarchy. We can't see the
// real tree depth from the flat element list, so we approximate "structure"
// with the multiset of class names + identifiers, which is stable across runs.
export function normalizeUiTree(uiTree) {
  const elements = uiTree?.elements ?? []
  const structure = elements
    .map((element) => {
      const idPart =
        element.resourceId || element.contentDesc || element.className || ""
      return `${element.className || "?"}|${stabilizeText(idPart)}|${element.clickable ? "c" : ""}`
    })
    .filter(Boolean)
    .sort()

  return {
    classCounts: countBy(elements.map((e) => e.className || "?")),
    identifiers: Array.from(
      new Set(
        elements
          .map((e) => e.resourceId || e.contentDesc)
          .filter(Boolean)
          .map(normalizeText)
      )
    ).sort(),
    structure
  }
}

function countBy(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

export function hashScreenData(data) {
  const serialized = typeof data === "string" ? data : JSON.stringify(data)
  return crypto.createHash("sha1").update(serialized).digest("hex").slice(0, 16)
}

// Build the fingerprint. We hash on the things that identify "which screen am I
// on": the focused activity/window, the set of stable identifiers, the stable
// visible texts, and the clickable label set. Volatile values are stripped via
// stabilizeText so dynamic counters don't fork the screen identity.
export function createScreenFingerprint(uiTree, screenshotPath, extraMeta = {}) {
  const normalized = normalizeUiTree(uiTree)
  const visibleTexts = extractVisibleTexts(uiTree)
  const clickableElements = extractClickableElements(uiTree)

  const focusedWindow = normalizeFocused(uiTree?.focusedWindow ?? "")

  const signatureSource = {
    focusedWindow,
    identifiers: normalized.identifiers,
    stableTexts: visibleTexts.map(stabilizeText).filter(Boolean).sort(),
    clickableLabels: clickableElements
      .map((e) => stabilizeText(e.label))
      .filter(Boolean)
      .sort(),
    classCounts: normalized.classCounts
  }

  const fingerprint = hashScreenData(signatureSource)

  return {
    fingerprint,
    focusedWindow,
    visibleTexts,
    clickableElements,
    normalized,
    screenshotPath: screenshotPath ?? null,
    meta: extraMeta
  }
}

// The Android focused-window string contains activity names; keep the activity
// component but drop trailing hashes/ids Android appends.
function normalizeFocused(value = "") {
  const match = String(value).match(/([\w.]+\/[\w.$]+)/)
  if (match) return match[1]
  return normalizeText(value)
}
