// Feature discovery. Reasons about *features* (Authentication, Checkout, …) from
// the evidence captured per screen (visible text, clickable labels, nav patterns)
// rather than just listing screens. Heuristic core with optional AI enrichment
// upstream; always works offline.

const FEATURE_PATTERNS = [
  { type: "authentication", label: "Authentication", weight: 0.5,
    keywords: ["login", "log in", "sign in", "увійти", "вхід", "логін", "password", "пароль", "authenticate"] },
  { type: "registration", label: "Registration", weight: 0.5,
    keywords: ["register", "sign up", "create account", "реєстрація", "зареєструватися", "зареєструватись", "створити акаунт"] },
  { type: "password-recovery", label: "Password Recovery", weight: 0.6,
    keywords: ["forgot password", "reset password", "recover", "відновити пароль", "забули пароль", "скинути пароль"] },
  { type: "profile", label: "Profile", weight: 0.4,
    keywords: ["profile", "my account", "account", "профіль", "акаунт", "кабінет", "мій профіль"] },
  { type: "search", label: "Search", weight: 0.5,
    keywords: ["search", "find", "пошук", "знайти", "шукати"] },
  { type: "settings", label: "Settings", weight: 0.4,
    keywords: ["settings", "preferences", "налаштування", "параметри"] },
  { type: "notifications", label: "Notifications", weight: 0.4,
    keywords: ["notification", "alerts", "сповіщення", "повідомлення"] },
  { type: "orders", label: "Orders", weight: 0.5,
    keywords: ["orders", "order history", "my orders", "замовлення", "мої замовлення"] },
  { type: "cart", label: "Cart", weight: 0.6,
    keywords: ["cart", "basket", "кошик", "корзина"] },
  { type: "checkout", label: "Checkout", weight: 0.7,
    keywords: ["checkout", "place order", "оформити замовлення", "оформлення"] },
  { type: "payments", label: "Payments", weight: 0.8,
    keywords: ["payment", "pay", "card number", "credit card", "оплата", "оплатити", "картка", "платіж"] },
  { type: "subscriptions", label: "Subscriptions", weight: 0.8,
    keywords: ["subscription", "subscribe", "plan", "premium", "підписка", "підписатися", "тариф", "преміум"] },
  { type: "messaging", label: "Messaging / Chat", weight: 0.5,
    keywords: ["chat", "message", "messages", "inbox", "чат", "повідомлення", "написати"] },
  { type: "maps", label: "Maps / Location", weight: 0.5,
    keywords: ["map", "location", "address", "directions", "карта", "локація", "адреса", "маршрут"] },
  { type: "booking", label: "Booking", weight: 0.6,
    keywords: ["book", "booking", "reserve", "appointment", "забронювати", "бронювання", "запис"] },
  { type: "media", label: "Media", weight: 0.4,
    keywords: ["play", "video", "audio", "gallery", "відео", "аудіо", "галерея", "переглянути"] },
  { type: "file-upload", label: "File Upload", weight: 0.6,
    keywords: ["upload", "attach", "choose file", "завантажити", "прикріпити", "додати файл"] },
  { type: "documents", label: "Documents", weight: 0.5,
    keywords: ["document", "pdf", "certificate", "документ", "сертифікат", "довідка"] },
  { type: "onboarding", label: "Onboarding", weight: 0.3,
    keywords: ["get started", "welcome", "skip", "next", "почати", "вітаємо", "пропустити"] }
]

function screenHaystack(screen) {
  return [
    ...(screen.visibleTexts ?? []),
    ...((screen.clickableElements ?? []).map((e) => e.label || e.text || e.contentDesc || ""))
  ]
    .filter(Boolean)
    .map((t) => String(t).toLowerCase())
}

function hasInputs(screen) {
  return (screen.clickableElements ?? []).some((el) =>
    /edittext|textfield|securetextfield|searchfield/i.test(el.className ?? "")
  )
}

export function detectScreenFeatures(screen) {
  const haystack = screenHaystack(screen)
  const joined = haystack.join("  ")
  const results = []

  for (const pattern of FEATURE_PATTERNS) {
    const evidence = []
    for (const kw of pattern.keywords) {
      if (joined.includes(kw)) evidence.push(kw)
    }
    if (!evidence.length) continue
    let confidence = Math.min(1, 0.3 + evidence.length * pattern.weight)
    // Auth/registration are much more credible when input fields are present.
    if (["authentication", "registration", "search", "payments"].includes(pattern.type) && hasInputs(screen)) {
      confidence = Math.min(1, confidence + 0.2)
    }
    results.push({
      featureType: pattern.type,
      label: pattern.label,
      confidence: Number(confidence.toFixed(2)),
      evidence: Array.from(new Set(evidence)).slice(0, 6)
    })
  }

  return results.sort((a, b) => b.confidence - a.confidence)
}

// App-level aggregation: merge per-screen detections into one feature list with
// the screens that contributed and the strongest confidence.
export function discoverFeatures(appMap) {
  const byType = new Map()
  for (const screen of appMap?.screens ?? []) {
    for (const f of detectScreenFeatures(screen)) {
      const existing = byType.get(f.featureType)
      if (existing) {
        existing.confidence = Math.max(existing.confidence, f.confidence)
        existing.screenIds.add(screen.id)
        for (const e of f.evidence) existing.evidence.add(e)
      } else {
        byType.set(f.featureType, {
          featureType: f.featureType,
          label: f.label,
          confidence: f.confidence,
          screenIds: new Set([screen.id]),
          evidence: new Set(f.evidence)
        })
      }
    }
  }

  return [...byType.values()]
    .map((f) => ({
      featureType: f.featureType,
      label: f.label,
      confidence: f.confidence,
      screenIds: [...f.screenIds],
      evidence: [...f.evidence].slice(0, 8)
    }))
    .sort((a, b) => b.confidence - a.confidence)
}
