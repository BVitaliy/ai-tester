// Screen analysis: derive a human-readable understanding of a screen (name,
// purpose, risks, suggested tests). Uses a server-side AI key if configured via
// env vars, otherwise falls back to a deterministic heuristic so the feature
// always works offline.
//
// AI providers (optional):
//   GEMINI_API_KEY  -> Google Generative Language (gemini-2.0-flash)
//   OPENAI_API_KEY  -> OpenAI-compatible chat completions
//                      (OPENAI_BASE_URL, OPENAI_MODEL override defaults)

const LOGIN_HINTS = ["login", "sign in", "увійти", "вхід", "логін", "password", "пароль"]
const REGISTER_HINTS = ["register", "sign up", "реєстрац", "зареєстр", "create account"]
const SEARCH_HINTS = ["search", "пошук", "знайти"]

function normalize(value = "") {
  return String(value).toLowerCase()
}

function hasInputs(clickableElements = [], uiElements = []) {
  const pool = uiElements.length ? uiElements : clickableElements
  return pool.some((el) =>
    /edittext|textfield|securetextfield|input|searchfield/i.test(el.className ?? "")
  )
}

export function analyzeScreenHeuristic(input) {
  const visibleTexts = input.visibleTexts ?? []
  const clickableElements = input.clickableElements ?? []
  const uiElements = input.uiTree?.elements ?? []
  const haystack = normalize([...visibleTexts, ...clickableElements.map((e) => e.label)].join(" "))

  const isLogin = LOGIN_HINTS.some((h) => haystack.includes(h))
  const isRegister = REGISTER_HINTS.some((h) => haystack.includes(h))
  const isSearch = SEARCH_HINTS.some((h) => haystack.includes(h))
  const inputsPresent = hasInputs(clickableElements, uiElements)

  let purpose = "General content screen"
  if (isRegister) purpose = "User registration screen"
  else if (isLogin) purpose = "Authentication / login screen"
  else if (isSearch) purpose = "Search screen"
  else if (inputsPresent) purpose = "Form / data entry screen"
  else if (clickableElements.length > 6) purpose = "Navigation / list screen"

  const screenName =
    visibleTexts.find((t) => t && t.length <= 32) ||
    (isLogin ? "Login" : isRegister ? "Register" : "Screen")

  const importantElements = clickableElements
    .map((e) => e.label)
    .filter(Boolean)
    .slice(0, 10)

  const possibleUserFlows = []
  if (isLogin) possibleUserFlows.push("Enter credentials and log in")
  if (isRegister) possibleUserFlows.push("Fill registration form and submit")
  if (isSearch) possibleUserFlows.push("Type a query and view results")
  if (clickableElements.length) possibleUserFlows.push("Navigate to a sub-section via a tab/card/button")

  const risks = []
  if (inputsPresent) risks.push("Empty/invalid form submission may not be validated")
  if (isLogin || isRegister) risks.push("Auth errors and edge cases (wrong password, existing account)")
  if (!visibleTexts.length) risks.push("Screen exposes no readable text; may rely on icons only")

  const suggestedTests = []
  if (inputsPresent) {
    suggestedTests.push({
      title: "Submit form with empty fields",
      priority: "high",
      steps: [{ action: "assertVisible", target: screenName }]
    })
  }
  if (isLogin) {
    suggestedTests.push({
      title: "Login with invalid credentials shows error",
      priority: "high",
      steps: []
    })
  }
  if (importantElements.length) {
    suggestedTests.push({
      title: `Navigate using "${importantElements[0]}"`,
      priority: "medium",
      steps: [{ action: "tap", target: importantElements[0] }]
    })
  }

  return {
    screenName,
    purpose,
    importantElements,
    possibleUserFlows,
    risks,
    suggestedTests,
    source: "heuristic"
  }
}

function buildPrompt(input) {
  const visibleTexts = (input.visibleTexts ?? []).slice(0, 40)
  const clickable = (input.clickableElements ?? []).map((e) => e.label).filter(Boolean).slice(0, 40)
  return [
    "You are a mobile QA expert. Analyze one app screen and return STRICT JSON only.",
    "Schema:",
    '{ "screenName": string, "purpose": string, "importantElements": string[], "possibleUserFlows": string[], "risks": string[], "suggestedTests": [{ "title": string, "priority": "high"|"medium"|"low", "steps": [{ "action": string, "target"?: string, "value"?: string }] }] }',
    "Use the same language as the screen texts where possible.",
    `Visible texts: ${JSON.stringify(visibleTexts)}`,
    `Clickable element labels: ${JSON.stringify(clickable)}`,
    input.focusedWindow ? `Focused window/activity: ${input.focusedWindow}` : ""
  ]
    .filter(Boolean)
    .join("\n")
}

function extractJson(raw) {
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callGemini(prompt, apiKey) {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  })
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
}

async function callOpenAI(prompt, apiKey) {
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  })
  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ""
}

export function hasAiKey() {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)
}

export async function analyzeScreen(input) {
  const geminiKey = process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!geminiKey && !openaiKey) {
    return analyzeScreenHeuristic(input)
  }

  try {
    const prompt = buildPrompt(input)
    const raw = geminiKey
      ? await callGemini(prompt, geminiKey)
      : await callOpenAI(prompt, openaiKey)
    const parsed = extractJson(raw)
    if (!parsed || !parsed.screenName) throw new Error("AI returned no usable JSON")
    return {
      screenName: parsed.screenName,
      purpose: parsed.purpose ?? "",
      importantElements: parsed.importantElements ?? [],
      possibleUserFlows: parsed.possibleUserFlows ?? [],
      risks: parsed.risks ?? [],
      suggestedTests: parsed.suggestedTests ?? [],
      source: geminiKey ? "gemini" : "openai"
    }
  } catch (error) {
    const fallback = analyzeScreenHeuristic(input)
    fallback.aiError = error instanceof Error ? error.message : String(error)
    return fallback
  }
}
