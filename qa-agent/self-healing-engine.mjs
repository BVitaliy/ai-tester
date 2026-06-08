// Self-healing locators. Test steps reference *intent* ("the login button")
// rather than a brittle exact string, so when "Login" becomes "Sign In" or
// "Continue" becomes "Next" the step still resolves. An intent locator captures
// stable hints (resource-id, role, synonyms) and resolves against the live UI by
// scoring candidates.

const SYNONYM_GROUPS = [
  ["login", "log in", "sign in", "увійти", "вхід", "логін"],
  ["register", "sign up", "create account", "зареєструватися", "зареєструватись", "реєстрація"],
  ["continue", "next", "proceed", "далі", "продовжити"],
  ["submit", "save", "apply", "надіслати", "зберегти", "застосувати"],
  ["forgot password", "reset password", "recover", "відновити пароль", "забули пароль"],
  ["back", "cancel", "close", "назад", "скасувати", "закрити"],
  ["ok", "confirm", "done", "готово", "підтвердити"],
  ["search", "find", "пошук", "знайти"],
  ["profile", "account", "профіль", "акаунт", "кабінет"],
  ["settings", "preferences", "налаштування"]
]

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function labelOf(el) {
  return el.label || el.text || el.contentDesc || el.resourceId || el.className || ""
}

function synonymsFor(text) {
  const norm = normalize(text)
  const out = new Set([norm])
  for (const group of SYNONYM_GROUPS) {
    if (group.some((g) => norm.includes(g) || g.includes(norm))) {
      group.forEach((g) => out.add(g))
    }
  }
  return [...out].filter(Boolean)
}

// Capture a durable descriptor from a concrete element seen during exploration.
export function buildIntentLocator(element) {
  const text = labelOf(element)
  return {
    text,
    resourceId: element.resourceId || null,
    contentDesc: element.contentDesc || null,
    role: element.className || null,
    synonyms: synonymsFor(text)
  }
}

function scoreCandidate(el, descriptor) {
  let score = 0
  const elText = normalize(labelOf(el))

  if (descriptor.resourceId && el.resourceId && el.resourceId === descriptor.resourceId) score += 6
  if (descriptor.contentDesc && el.contentDesc && normalize(el.contentDesc) === normalize(descriptor.contentDesc)) score += 4

  const target = normalize(descriptor.text)
  if (target && elText === target) score += 5
  else if (target && elText.includes(target)) score += 3
  else if (target && target.includes(elText) && elText.length >= 3) score += 2

  for (const syn of descriptor.synonyms ?? []) {
    if (syn && elText.includes(syn)) {
      score += 2
      break
    }
  }

  // Prefer same role/class when known.
  if (descriptor.role && el.className && el.className === descriptor.role) score += 1
  return score
}

// Resolve a descriptor against the current elements. Returns the best element
// plus the score and whether it required "healing" (i.e. the exact text changed).
export function resolveLocator(elements, descriptor, minScore = 3) {
  let best = null
  let bestScore = 0
  for (const el of elements ?? []) {
    const score = scoreCandidate(el, descriptor)
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best || bestScore < minScore) return { element: null, score: bestScore, healed: false }
  const exact = normalize(labelOf(best)) === normalize(descriptor.text)
  return { element: best, score: bestScore, healed: !exact }
}
