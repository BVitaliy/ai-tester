// Safe-action filtering for the crawler. Decides which clickable elements are
// safe to tap during automated exploration, avoiding destructive / costly
// actions (delete, logout, payment, etc.) and preferring navigation.

const DANGEROUS_PATTERNS = [
  "delete",
  "remove",
  "logout",
  "log out",
  "sign out",
  "signout",
  "payment",
  "pay now",
  "pay ",
  "subscribe",
  "subscription",
  "purchase",
  "buy",
  "checkout",
  "confirm",
  "unsubscribe",
  "deactivate",
  "close account",
  "delete account",
  // Ukrainian equivalents (this project's apps are UA-first)
  "видалити",
  "вилучити",
  "вийти",
  "вихід",
  "оплата",
  "оплатити",
  "сплатити",
  "придбати",
  "купити",
  "підписка",
  "підписатися",
  "підтвердити",
  "видалити акаунт"
]

const NAVIGATION_HINTS = [
  "tab",
  "menu",
  "home",
  "back",
  "next",
  "more",
  "settings",
  "profile",
  "card",
  "open",
  "view",
  "details",
  "категор",
  "меню",
  "домівка",
  "головна",
  "налаштування",
  "профіль",
  "далі",
  "відкрити",
  "детальніше"
]

function normalize(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim()
}

export function getElementLabel(element) {
  if (!element) return ""
  return (
    element.label ||
    element.text ||
    element.contentDesc ||
    element.resourceId ||
    element.className ||
    ""
  ).trim()
}

function elementHaystack(element) {
  return normalize(
    [
      element.label,
      element.text,
      element.contentDesc,
      element.resourceId
    ]
      .filter(Boolean)
      .join(" ")
  )
}

export function isDangerousAction(element) {
  const haystack = elementHaystack(element)
  if (!haystack) return false
  return DANGEROUS_PATTERNS.some((pattern) => haystack.includes(pattern))
}

function navigationScore(element) {
  const haystack = elementHaystack(element)
  let score = 0
  for (const hint of NAVIGATION_HINTS) {
    if (haystack.includes(hint)) score += 2
  }
  // Prefer elements that carry a readable label over icon-only ones.
  if (getElementLabel(element).replace(/[^\p{L}\p{N}]/gu, "").length >= 3) score += 1
  // Class-based navigation hints.
  const className = normalize(element.className)
  if (/tab|cell|card|button|menuitem|listitem/.test(className)) score += 1
  return score
}

// Returns the safe, deduped, prioritized list of clickable actions for a screen.
// `screen` is expected to expose `clickableElements` (the fingerprint shape).
export function getSafeClickableActions(screen, options = {}) {
  const {
    maxActionsPerScreen = 8,
    avoidDangerousActions = true,
    excludeLabels = []
  } = options

  const elements = screen?.clickableElements ?? []
  const excluded = new Set(excludeLabels.map(normalize))
  const seen = new Set()
  const candidates = []

  for (const element of elements) {
    const label = getElementLabel(element)
    const key = normalize(label) || `el-${element.id}`
    if (seen.has(key)) continue
    if (excluded.has(normalize(label))) continue
    if (!element.bounds || element.bounds.centerX == null) continue

    const dangerous = isDangerousAction(element)
    if (avoidDangerousActions && dangerous) {
      candidates.push({ element, label, skipped: true, reason: "dangerous" })
      continue
    }
    seen.add(key)
    candidates.push({
      element,
      label,
      skipped: false,
      score: navigationScore(element),
      kind: classifyKind(element)
    })
  }

  const safe = candidates
    .filter((c) => !c.skipped)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxActionsPerScreen)

  const skipped = candidates.filter((c) => c.skipped)

  return { actions: safe, skipped }
}

function classifyKind(element) {
  const className = normalize(element.className)
  if (/tab/.test(className)) return "tab"
  if (/menuitem|menu/.test(className)) return "menu"
  if (/cell|card|listitem/.test(className)) return "card"
  if (/button/.test(className)) return "button"
  return "element"
}
