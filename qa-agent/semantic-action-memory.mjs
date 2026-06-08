import { getElementLabel } from "./safe-actions.mjs"

// Semantic action memory. Instead of remembering "tapped element #4", it
// remembers the *intent* of an action ("open a product card") and a *signature*
// that groups equivalent actions, so the agent can recognise that 100 product
// cards are the same intent and stop after sampling a couple.

const INTENT_RULES = [
  { intent: "auth-login", re: /\b(log\s?in|sign\s?in|увійти|вхід|логін)\b/i },
  { intent: "auth-register", re: /\b(register|sign\s?up|create account|реєстрац|зареєстр)\b/i },
  { intent: "auth-forgot", re: /\b(forgot|reset password|recover|відновити пароль|забули)\b/i },
  { intent: "auth-social", re: /\b(google|apple|facebook|continue with)\b/i },
  { intent: "submit", re: /\b(submit|save|continue|next|done|apply|надіслати|зберегти|далі|готово|продовжити)\b/i },
  { intent: "search", re: /\b(search|find|пошук|знайти)\b/i },
  { intent: "settings", re: /\b(settings|preferences|налаштування)\b/i },
  { intent: "back", re: /\b(back|cancel|close|назад|закрити|скасувати)\b/i },
  { intent: "open-detail", re: /\b(details|view|open|детальніше|відкрити|переглянути)\b/i }
]

function normalize(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim()
}

// A structural class hint used to group list/grid items regardless of their text.
function kindOf(element) {
  const cn = normalize(element.className)
  if (/tab/.test(cn)) return "tab"
  if (/menuitem|menu/.test(cn)) return "menu"
  if (/cell|card|listitem|collectionviewcell|recyclerview/.test(cn)) return "item"
  if (/button/.test(cn)) return "button"
  if (/edittext|textfield|securetextfield|searchfield/.test(cn)) return "input"
  return "element"
}

export function actionIntent(element) {
  const label = getElementLabel(element)
  const norm = normalize(label)
  const kind = kindOf(element)

  for (const rule of INTENT_RULES) {
    if (rule.re.test(norm)) {
      return { intent: rule.intent, kind, signature: `${rule.intent}` }
    }
  }

  if (kind === "tab") return { intent: "navigate-tab", kind, signature: `navigate-tab:${norm}` }
  if (kind === "menu") return { intent: "navigate-menu", kind, signature: `navigate-menu:${norm}` }
  // List/grid items: signature deliberately ignores the label so every card in a
  // list collapses to one signature (open-item in <list>).
  if (kind === "item") return { intent: "open-item", kind, signature: `open-item:${element.className || "?"}` }
  if (kind === "input") return { intent: "edit-field", kind, signature: `edit-field:${norm}` }
  if (kind === "button") return { intent: "tap-button", kind, signature: `tap-button:${norm}` }
  return { intent: "tap", kind, signature: `tap:${norm}` }
}

export function createSemanticMemory(options = {}) {
  const maxPerSignature = options.maxPerSignature ?? 2
  const counts = new Map()
  return {
    maxPerSignature,
    record(signature) {
      counts.set(signature, (counts.get(signature) ?? 0) + 1)
      return counts.get(signature)
    },
    seenCount(signature) {
      return counts.get(signature) ?? 0
    },
    // True once we have already explored this intent-signature enough times.
    isSaturated(signature) {
      return (counts.get(signature) ?? 0) >= maxPerSignature
    },
    snapshot() {
      return Object.fromEntries(counts)
    }
  }
}

// Structural signature of a whole screen: the multiset of element kinds + class
// names. Used to detect duplicate screens (e.g. 50 product-detail screens).
export function screenStructuralSignature(screen) {
  const counts = {}
  for (const el of screen.clickableElements ?? []) {
    const key = `${kindOf(el)}:${el.className || "?"}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}x${v}`)
    .join("|")
}

// Groups screens that are structurally identical (same kinds of elements, same
// transition shape) — i.e. instances of one template reached many times.
export function detectDuplicateScreens(appMap) {
  const groups = new Map()
  for (const screen of appMap?.screens ?? []) {
    const sig = screenStructuralSignature(screen)
    const arr = groups.get(sig) ?? []
    arr.push(screen.id)
    groups.set(sig, arr)
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length >= 3)
    .map(([signature, screenIds]) => ({ signature, screenIds, count: screenIds.length }))
}

// Summarises the distinct intents available on a screen, collapsing duplicate
// list items into a single representative entry.
export function summarizeScreenIntents(screen) {
  const bySignature = new Map()
  for (const el of screen.clickableElements ?? []) {
    const meta = actionIntent(el)
    if (!bySignature.has(meta.signature)) {
      bySignature.set(meta.signature, { ...meta, label: getElementLabel(el), count: 0 })
    }
    bySignature.get(meta.signature).count += 1
  }
  return [...bySignature.values()]
}
