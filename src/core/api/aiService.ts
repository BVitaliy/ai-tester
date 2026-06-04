import type { GeneratedFile, JackSessionState, TestCaseIdea } from "../types"
import { getProviderKeys } from "../../store/jack"

// ── Low-level helpers ─────────────────────────────────────────────────────────

type AIChunk = { text: string; truncated: boolean }

const CONTINUE_MSG = "Continue exactly from where you stopped. Do not repeat any code already written."

async function getKey(provider: string): Promise<string | null> {
  const keys = await getProviderKeys()
  return ((keys as unknown as Record<string, unknown>)[`${provider}Key`] as string | null) ?? null
}

async function callOpenAICompatOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  extraHeaders: Record<string, string> | undefined,
  maxTokens: number
): Promise<AIChunk> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const apiError = (err as any)?.error
    const metadata = apiError?.metadata
    const detail = [
      metadata?.raw,
      metadata?.message,
      metadata?.provider_name ? `upstream provider: ${metadata.provider_name}` : null,
      apiError?.code ? `code: ${apiError.code}` : null
    ].filter(Boolean).join(" | ")
    const message = apiError?.message ?? `API error ${res.status} from ${baseUrl}`
    throw new Error(
      detail ? `${message}: ${detail}` : message
    )
  }
  const data = await res.json()
  const choice = (data as any).choices?.[0]
  return {
    text: choice?.message?.content ?? "",
    truncated: choice?.finish_reason === "length",
  }
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  contents: object[],
  maxTokens: number
): Promise<AIChunk> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg: string = (err as any)?.error?.message ?? `Gemini API error ${res.status}`
    if (/no longer available|not found for API version/i.test(msg)) {
      throw new Error(
        `Модель "${model}" устарела или недоступна. Откройте Настройки → нажмите "Тест" у Gemini → выберите другую модель.`
      )
    }
    throw new Error(msg)
  }
  const data = await res.json()
  const candidate = (data as any).candidates?.[0]
  return {
    text: candidate?.content?.parts?.[0]?.text ?? "",
    truncated: candidate?.finishReason === "MAX_TOKENS",
  }
}

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  grok: "https://api.x.ai/v1",
}

const MAX_CONTINUATIONS = 3

async function callAI(
  provider: string,
  model: string,
  systemPrompt: string,
  userContent: unknown,
  maxTokens = 3000
): Promise<string> {
  const key = await getKey(provider)
  if (!key) throw new Error(`API ключ для ${provider} не настроен — добавьте его в Настройках`)

  if (provider === "gemini") {
    const initialParts =
      typeof userContent === "string"
        ? [{ text: userContent }]
        : (userContent as object[])

    let contents: object[] = [{ role: "user", parts: initialParts }]
    let accumulated = ""

    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const chunk = await callGeminiOnce(key, model, systemPrompt, contents, maxTokens)
      accumulated += chunk.text
      if (!chunk.truncated) break
      contents = [
        ...contents,
        { role: "model", parts: [{ text: chunk.text }] },
        { role: "user", parts: [{ text: CONTINUE_MSG }] },
      ]
    }

    return accumulated
  }

  const baseUrl = PROVIDER_URLS[provider]
  if (!baseUrl) throw new Error(`Неизвестный провайдер: ${provider}`)

  const extraHeaders: Record<string, string> | undefined =
    provider === "openrouter"
      ? { "HTTP-Referer": "chrome-extension://jack-qa", "X-Title": "Jack QA" }
      : undefined

  let messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]
  let accumulated = ""

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const chunk = await callOpenAICompatOnce(baseUrl, key, model, messages, extraHeaders, maxTokens)
    accumulated += chunk.text
    if (!chunk.truncated) break
    messages = [
      ...messages,
      { role: "assistant", content: chunk.text },
      { role: "user", content: CONTINUE_MSG },
    ]
  }

  return accumulated
}

// ── JSON parse helpers ────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  // Strip markdown fences if present
  const stripped = raw.replace(/```(?:json)?/g, "").trim()
  // Find first [ or {
  const start = stripped.search(/[[\{]/)
  const end = Math.max(stripped.lastIndexOf("]"), stripped.lastIndexOf("}"))
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
}

function parseIdeas(raw: string): TestCaseIdea[] {
  const parsed = extractJson(raw)
  if (Array.isArray(parsed)) {
    return parsed
      .filter((item: any) => typeof item?.text === "string" && item.text.trim())
      .map((item: any) => ({ id: crypto.randomUUID(), text: item.text.trim() }))
  }
  // Fallback: split by newlines, strip numbers/bullets
  return raw
    .split("\n")
    .map((line) => line.replace(/^[\s\d.\-*)]+/, "").trim())
    .filter((line) => line.length > 10)
    .map((text) => ({ id: crypto.randomUUID(), text }))
}

function parseFiles(raw: string): GeneratedFile[] {
  const parsed = extractJson(raw)
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (f: any) => typeof f?.path === "string" && typeof f?.content === "string"
    )
  }
  return []
}

type MobileStepAction = "tap" | "input" | "assertVisible" | "assertNotVisible" | "wait" | "scroll"

export interface GeneratedMobileStep {
  id: string
  ideaId?: string
  action: MobileStepAction
  target?: string
  value?: string
  timeoutMs?: number
  description: string
}

function parseMobileSteps(raw: string): GeneratedMobileStep[] {
  const parsed = extractJson(raw)
  if (!Array.isArray(parsed)) return []
  const allowed = new Set(["tap", "input", "assertVisible", "assertNotVisible", "wait", "scroll"])
  const invalidTargets = new Set([
    "test",
    "check",
    "verify",
    "треба",
    "перевір",
    "перевірити",
    "користувач",
    "додаток",
    "екран",
    "форма",
    "поле",
    "кнопка",
    "перейти",
    "перейди",
    "navigate",
    "go"
  ])
  return parsed
    .filter((step: any) => allowed.has(step?.action) && typeof step?.description === "string")
    .filter((step: any) => {
      if (step.action === "wait" || step.action === "scroll") return true
      if (typeof step.target !== "string" || !step.target.trim()) return false
      const target = step.target.trim()
      if (invalidTargets.has(target.toLowerCase())) return false
      // Reject targets that are sentences, not element identifiers
      if (target.length > 55) return false
      if (target.split(/\s+/).length > 6) return false
      if (/^(на будь|будь-який|будь який|будь |після |коли |якщо |де |що ж|як |перевіри|перевірит|any |some |every |all |each |check |verify |make sure)/i.test(target)) return false
      return true
    })
    .map((step: any, index) => ({
      id: typeof step.id === "string" && step.id ? step.id : `step-${index + 1}`,
      ideaId: typeof step.ideaId === "string" ? step.ideaId : undefined,
      action: step.action as MobileStepAction,
      target: typeof step.target === "string" ? step.target.trim() : undefined,
      value: typeof step.value === "string" ? step.value : undefined,
      timeoutMs: typeof step.timeoutMs === "number" ? step.timeoutMs : undefined,
      description: step.description.trim()
    }))
}

const MOBILE_TARGET_STOP_WORDS = new Set([
  "test",
  "case",
  "check",
  "verify",
  "should",
  "треба",
  "перевір",
  "перевірити",
  "користувач",
  "додаток",
  "екран",
  "форма",
  "форму",
  "поле",
  "поля",
  "кнопка",
  "кнопку",
  "заповнити",
  "відправити",
  "запит",
  "перейде",
  "сторінку",
  "успіху"
])

function extractQuotedTarget(value: string): string | null {
  const match = value.match(/["'«“](.+?)["'»”]/)
  return match?.[1]?.trim() || null
}

function extractLikelyTarget(value: string): string | null {
  const quoted = extractQuotedTarget(value)
  if (quoted) return quoted

  const tokens = value
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter(Boolean)

  const appLike = tokens.find((token) => /[A-ZА-ЯІЇЄҐ][\p{L}\p{N}_-]{3,}/u.test(token) && !MOBILE_TARGET_STOP_WORDS.has(token.toLowerCase()))
  if (appLike) return appLike

  const technical = tokens.find((token) => /[_-]/.test(token) && token.length >= 4 && !MOBILE_TARGET_STOP_WORDS.has(token.toLowerCase()))
  if (technical) return technical

  return null
}

function normalizeMobileText(value: string) {
  return value.toLowerCase().replace(/[’`]/g, "'").replace(/ʼ/g, "'")
}

function looksLikeMobileFlow(value: string) {
  return /(клікн|перейти|перейди|заповнити|ввести|натисн|погодит|реєстрац|зареєстру|register|sign up|fill|tap|click|submit)/iu.test(value)
}

function extractVisibleTargetsFromContext(context: string): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  for (const line of context.split("\n")) {
    const match = line.match(/^\s*\d+\.\s*(.+)$/)
    if (!match) continue
    for (const rawPart of match[1].split("|")) {
      const part = rawPart.trim()
      if (!part || part === "clickable" || /^XCUIElementType/i.test(part) || /^android\./i.test(part)) continue
      const value = part.replace(/^(resource-id|content-desc)=/i, "").trim()
      const key = normalizeMobileText(value)
      if (value && !seen.has(key)) {
        seen.add(key)
        targets.push(value)
      }
    }
  }
  return targets
}

function findVisibleTarget(targets: string[], keywords: string[]) {
  const normalizedKeywords = keywords.map(normalizeMobileText)
  return targets.find((target) => {
    const normalized = normalizeMobileText(target)
    return normalizedKeywords.some((keyword) => normalized.includes(keyword))
  }) ?? null
}

function valueAfter(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim().replace(/[,.]$/, "") || null
}

function submitTargetFromText(text: string) {
  return text.match(/(?:кнопк[ауи]?|натиснути|клікнути)\s+([A-ZА-ЯІЇЄҐ][^,.]+)/iu)?.[1]?.trim() ?? null
}

function userIconTargetFromText(text: string) {
  if (!/(юзер|користувач|профіль|акаунт|account|profile|user|login|логін|увійти|вхід)/iu.test(text)) return null
  return "user"
}

function buildFallbackMobileFlowSteps(ideas: TestCaseIdea[], context: string): GeneratedMobileStep[] {
  const targets = extractVisibleTargetsFromContext(context)
  const steps: GeneratedMobileStep[] = []

  for (const idea of ideas) {
    const text = idea.text
    if (!looksLikeMobileFlow(text)) continue

    const normalized = normalizeMobileText(text)
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "test123@example.com"
    const firstName = valueAfter(text, /(?:ім[ʼ'’`]?я|name|first name)\s+([^,\s]+)/iu) ?? "Test"
    const lastName = valueAfter(text, /(?:прізвище|surname|last name)\s+([^,\s]+)/iu) ?? "User"
    const password = valueAfter(text, /(?:пароль|password)\s+([^,\s]+)/iu) ?? "Test12345"
    const confirmPassword = valueAfter(text, /(?:підтвердження пароля|повторіть пароль|confirm password)\s+([^,\s]+)/iu) ?? password

    const wantsFirstName = /ім[ʼ'’`]?я|first name|name/iu.test(text)
    const wantsLastName = /прізвище|surname|last name/iu.test(text)
    const wantsEmail = /email|e-mail|пошт/iu.test(text)
    const wantsPassword = /пароль|password/iu.test(text)
    const wantsConfirmPassword = /підтвердження пароля|повторіть пароль|confirm password/iu.test(text)
    const wantsRules = /погод|правил|terms|privacy/iu.test(text)
    const wantsSubmit = /натисн|клікн|зареєстру|submit|register|sign up/iu.test(text)
    const wantsLoginPage = /логін|логіну|увійти|вхід|login|sign in/iu.test(text)
    const wantsRegistrationPage = /реєстрац|зареєстру|register|sign up/iu.test(text)

    const loginTarget =
      findVisibleTarget(targets, ["увійти", "логін", "вхід", "login", "sign in"]) ??
      findVisibleTarget(targets, ["profile", "account", "user", "профіль", "акаунт", "користувач"]) ??
      userIconTargetFromText(text)
    const registrationLinkTarget =
      findVisibleTarget(targets, ["зареєстр", "реєстрац", "sign up", "register", "створити", "обліковий"]) ??
      (wantsRegistrationPage ? "Зареєструватись" : null)
    const firstNameTarget = findVisibleTarget(targets, ["ім'я", "ваше ім", "first name"]) ?? (wantsFirstName ? "Ваше ім" : null)
    const lastNameTarget = findVisibleTarget(targets, ["прізвище", "surname", "last name"]) ?? (wantsLastName ? "Ваше прізвище" : null)
    const emailTarget = findVisibleTarget(targets, ["email", "e-mail", "пошта"]) ?? (wantsEmail ? "Email" : null)
    const confirmPasswordTarget = findVisibleTarget(targets, ["повтор", "підтвер", "confirm password"]) ?? (wantsConfirmPassword ? "Повторіть пароль" : null)
    const passwordTarget = findVisibleTarget(targets, ["введіть пароль", "пароль", "password"]) ?? (wantsPassword ? "Введіть Пароль" : null)
    const rulesTarget = findVisibleTarget(targets, ["погодж", "правил", "terms", "privacy"]) ?? (wantsRules ? "Правилами Користування" : null)
    const submitTarget = findVisibleTarget(targets, ["зареєстр", "register", "sign up", "submit"]) ?? (wantsSubmit ? submitTargetFromText(text) ?? "Зареєструватись" : null)

    const hasRegistrationFields = Boolean(firstNameTarget || lastNameTarget || emailTarget || passwordTarget)
    if (!hasRegistrationFields) {
      if (wantsLoginPage && loginTarget) {
        steps.push({
          id: `${idea.id}-open-login`,
          ideaId: idea.id,
          action: "tap",
          target: loginTarget,
          timeoutMs: 10000,
          description: "Перейти на екран логіну через іконку користувача або кнопку входу"
        })
        steps.push({
          id: `${idea.id}-wait-login`,
          ideaId: idea.id,
          action: "wait",
          timeoutMs: 1200,
          description: "Дочекатися відкриття екрана логіну"
        })
      }

      const navigationTarget = registrationLinkTarget
      if (wantsRegistrationPage && navigationTarget) {
        steps.push({
          id: `${idea.id}-open-registration`,
          ideaId: idea.id,
          action: "tap",
          target: navigationTarget,
          timeoutMs: 10000,
          description: "Перейти на екран реєстрації"
        })
        steps.push({
          id: `${idea.id}-wait-registration`,
          ideaId: idea.id,
          action: "wait",
          timeoutMs: 1200,
          description: "Дочекатися відкриття екрана реєстрації"
        })
      }
    }

    if (firstNameTarget) {
      steps.push({ id: `${idea.id}-first-name`, ideaId: idea.id, action: "input", target: firstNameTarget, value: firstName, timeoutMs: 10000, description: `Ввести ім'я ${firstName}` })
    }
    if (lastNameTarget) {
      steps.push({ id: `${idea.id}-last-name`, ideaId: idea.id, action: "input", target: lastNameTarget, value: lastName, timeoutMs: 10000, description: `Ввести прізвище ${lastName}` })
    }
    if (emailTarget) {
      steps.push({ id: `${idea.id}-email`, ideaId: idea.id, action: "input", target: emailTarget, value: email, timeoutMs: 10000, description: `Ввести email ${email}` })
    }
    if (passwordTarget) {
      steps.push({ id: `${idea.id}-password`, ideaId: idea.id, action: "input", target: passwordTarget, value: password, timeoutMs: 10000, description: "Ввести пароль" })
    }
    if (confirmPasswordTarget && confirmPasswordTarget !== passwordTarget) {
      steps.push({ id: `${idea.id}-confirm-password`, ideaId: idea.id, action: "input", target: confirmPasswordTarget, value: confirmPassword, timeoutMs: 10000, description: "Підтвердити пароль" })
    }
    if (rulesTarget && wantsRules) {
      steps.push({ id: `${idea.id}-terms`, ideaId: idea.id, action: "tap", target: rulesTarget, timeoutMs: 10000, description: "Погодитися з правилами" })
    }
    if (submitTarget && wantsSubmit) {
      steps.push({ id: `${idea.id}-submit`, ideaId: idea.id, action: "tap", target: submitTarget, timeoutMs: 10000, description: "Натиснути кнопку реєстрації" })
    }
  }

  return steps
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function validateKey(provider: string, key: string): Promise<boolean> {
  if (!key || key.trim().length < 10) return false
  try {
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      )
      return res.ok
    }
    const base = PROVIDER_URLS[provider]
    if (!base) return key.length > 10
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchProviderModels(
  provider: string,
  key: string
): Promise<string[]> {
  if (!key) return []
  try {
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      )
      if (!res.ok) return []
      const data = await res.json()
      const GEMINI_SKIP = /preview|deprecated|aqa|embed|bison|gecko|text\-/i
      return ((data as any).models ?? [])
        .filter(
          (m: any) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes("generateContent") &&
            !GEMINI_SKIP.test(m.name as string) &&
            !/(deprecated|no longer available)/i.test((m.description ?? "") as string)
        )
        .map((m: any) => (m.name as string).replace(/^models\//, ""))
        .sort()
    }

    const base = PROVIDER_URLS[provider]
    if (!base) return []
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    const items: any[] = (data as any).data ?? []

    if (provider === "openai") {
      const CHAT_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "o4"]
      return items
        .map((m) => m.id as string)
        .filter((id) => CHAT_PREFIXES.some((p) => id.startsWith(p)))
        .sort()
    }
    if (provider === "openrouter") {
      return items
        .map((m) => (m.id ?? m.name) as string)
        .filter(Boolean)
        .sort()
    }
    // Groq, Grok — return all non-audio models
    return items
      .map((m) => m.id as string)
      .filter((id) => !id.includes("whisper") && !id.includes("tts"))
      .sort()
  } catch {
    return []
  }
}

export async function mediaToText(opts: {
  screenshotDataUrl?: string
  videoDataUrl?: string
  provider: string
  model: string
  lang?: string
}): Promise<string> {
  const { provider, model, screenshotDataUrl, videoDataUrl, lang = "uk" } = opts
  const langNote = lang === "en" ? "in English" : "in Ukrainian"
  const systemPrompt = `You are a QA engineer analyzing a web application UI.
Describe what you see for the purpose of generating automated E2E test cases.
Include: page type, visible UI elements (forms, buttons, navigation, tables, modals, lists),
current state, error messages, and user interaction patterns visible.
Be concise and specific. Write ${langNote}.`

  if (screenshotDataUrl) {
    const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, "")
    const mimeType = screenshotDataUrl.match(/^data:(image\/\w+)/)?.[1] ?? "image/png"

    if (provider === "gemini") {
      return callAI(provider, model, systemPrompt, [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: "Опиши UI на этом скриншоте для целей QA-тестирования." },
      ])
    }
    // OpenAI-compatible vision
    return callAI(provider, model, systemPrompt, [
      {
        type: "image_url",
        image_url: { url: screenshotDataUrl, detail: "low" },
      },
      {
        type: "text",
        text: "Опиши UI на этом скриншоте для целей QA-тестирования.",
      },
    ])
  }

  if (videoDataUrl) {
    return callAI(
      provider,
      model,
      systemPrompt,
      "Описание видеозаписи экрана: пользователь взаимодействует с веб-интерфейсом. Опиши UI-компоненты и действия для QA-тестирования."
    )
  }

  return ""
}

function buildIdeasSystem(lang: string): string {
  const langNote = lang === "en" ? "in English" : "in Ukrainian"
  return `You are a senior QA automation engineer.
Generate E2E test case ideas based on the provided context about a web or mobile application.

Rules:
- Generate 5-8 specific, actionable test case ideas
- Each idea is one sentence describing what to test
- Cover: happy paths, edge cases, input validation, navigation, error states, boundary conditions
- Ideas must be specific to what is described in the context — not generic
- Write all idea text ${langNote}
- Return ONLY a valid JSON array, no markdown, no code fences:
[{"text": "Test case description"}, ...]`
}

export async function generateTestIdeas(opts: {
  context: string
  provider: string
  model: string
  lang?: string
}): Promise<TestCaseIdea[]> {
  const lang = opts.lang ?? "uk"
  const fallback = lang === "en" ? "Web application without additional context" : "Веб-застосунок без додаткового контексту"
  const raw = await callAI(
    opts.provider,
    opts.model,
    buildIdeasSystem(lang),
    opts.context || fallback
  )
  const ideas = parseIdeas(raw)
  if (ideas.length === 0) throw new Error("AI вернул пустой список идей. Попробуйте ещё раз.")
  return ideas
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```$/, "")
    .trim()
}

export async function generateCode(opts: {
  ideas: TestCaseIdea[]
  context: JackSessionState
  framework: string
  language: string
  provider: string
  model: string
}): Promise<GeneratedFile[]> {
  const { framework, language, ideas, context, provider, model } = opts
  const isPlaywright = framework === "playwright"
  const isTS = language === "typescript"
  const isDotNet = language === "dotnet"
  const isJava = language === "java"
  const ext = isTS ? "ts" : isDotNet ? "cs" : isJava ? "java" : "js"

  const ideasText = ideas.map((idea, i) => `${i + 1}. ${idea.text}`).join("\n")

  // Build rich context including real selectors from recorded actions
  const selectorContext = context.recordedActions?.length
    ? `Recorded user actions with CSS selectors:\n${context.recordedActions
        .map((a) => {
          if (a.type === "click") return `  click: ${a.selector}`
          if (a.type === "input") return `  fill: ${a.selector} with "${a.value}"`
          if (a.type === "navigate") return `  navigate to: ${a.url}`
          return ""
        })
        .filter(Boolean)
        .join("\n")}`
    : null

  const contextText = [
    context.mediaDescription,
    context.htmlContext ? `Selected element HTML:\n${context.htmlContext}` : null,
    selectorContext,
    context.customPrompt ? `User context: ${context.customPrompt}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const baseInstructions = `Framework: ${framework} | Language: ${language}

CRITICAL: Write COMPLETE test implementations. NEVER write "// TODO: implement".
Every test() body MUST contain actual test steps: goto, locator().click(), fill(), expect().
Use selectors from the context when available. If selector is unknown, use a descriptive
data-testid placeholder like page.locator('[data-testid="submit-btn"]') and add a comment.`

  const specSystem = isPlaywright
    ? `You are a senior QA engineer writing Playwright ${language} tests.
${baseInstructions}

Imports must be:
${isTS ? "import { test, expect, type Page } from '@playwright/test'" : "const { test, expect } = require('@playwright/test')"}

Use test.describe() + test.beforeEach(goto) + individual test() blocks.
Return ONLY the spec file content, no markdown fences, no explanation.`
    : `You are a senior QA engineer writing Cypress ${language} tests.
${baseInstructions}

Use describe() + beforeEach(cy.visit) + individual it() blocks.
Cypress commands: cy.visit, cy.get, cy.contains, cy.type, cy.click, cy.should.
Return ONLY the spec file content, no markdown fences, no explanation.`

  const pomSystem = isPlaywright
    ? `You are a senior QA engineer. Write a Playwright Page Object class in ${language}.
Include methods for the main UI actions found in the context.
Use correct ${language} syntax with proper ${isTS ? "types" : "JSDoc"}.
Return ONLY the class file content, no markdown fences, no explanation.`
    : `You are a senior QA engineer. Write a Cypress Page Object class in ${language}.
Include methods for the main UI actions found in the context.
Return ONLY the class file content, no markdown fences, no explanation.`

  const specUserMessage = `Test cases to implement:\n${ideasText}\n\n${contextText || "Generic web application"}`
  const pomUserMessage = `UI context for page object:\n${contextText || "Generic web application"}`

  try {
    const [specRaw, pomRaw] = await Promise.all([
      callAI(provider, model, specSystem, specUserMessage, 8192),
      callAI(provider, model, pomSystem, pomUserMessage, 8192),
    ])

    const specContent = stripCodeFences(specRaw)
    const pomContent = stripCodeFences(pomRaw)

    if (specContent.length < 50) throw new Error("spec too short")

    const specPath = isPlaywright
      ? `tests/app.spec.${ext}`
      : isDotNet ? `Tests/AppTests.cs` : isJava ? `tests/AppTest.java` : `cypress/e2e/app.spec.${ext}`

    const pomPath = isPlaywright
      ? `pages/App.page.${ext}`
      : isDotNet ? `Pages/AppPage.cs` : isJava ? `pages/AppPage.java` : `cypress/pages/App.page.${ext}`

    return [
      { path: pomPath, content: pomContent },
      { path: specPath, content: specContent },
      {
        path: ".cursorrules",
        content: `Framework: ${framework}, Language: ${language}.\nTests generated by Jack QA. POM pattern.\nRun: ${isPlaywright ? "npx playwright test" : "npx cypress run"}`,
      },
    ]
  } catch (err) {
    console.warn("[generateCode] AI failed, using stub:", err)
    return generateCodeStub(opts)
  }
}

export async function generateMobileCode(opts: {
  ideas: TestCaseIdea[]
  context: JackSessionState
  provider: string
  model: string
}): Promise<GeneratedFile[]> {
  const { ideas, context, provider, model } = opts
  const ideasText = ideas.map((idea, i) => `${i + 1}. ${idea.text}`).join("\n")
  const contextText = [
    context.mediaDescription,
    context.htmlContext ? `Selected element context:\n${context.htmlContext}` : null,
    context.customPrompt ? `Mobile QA context:\n${context.customPrompt}` : null,
  ].filter(Boolean).join("\n\n")

  const systemPrompt = `You are a senior QA automation engineer writing mobile E2E tests.
Generate Appium WebdriverIO TypeScript tests for Android/iOS mobile apps.

Rules:
- Write COMPLETE test implementations. Do not leave TODO-only test bodies.
- Prefer accessibility id, Flutter Semantics labels, Android resource-id, iOS accessibility id/name, visible text, and content-desc.
- Avoid raw coordinate taps unless the context explicitly says there is no stable locator.
- Support both Android package names and iOS bundle ids when mentioned.
- Use async WebdriverIO/Appium syntax: $, $$, expect, click, setValue, waitForDisplayed.
- Return ONLY a valid JSON array of files, no markdown:
[
  {"path":"pages/MobileApp.screen.ts","content":"..."},
  {"path":"tests/mobile.appium.spec.ts","content":"..."},
  {"path":"README.md","content":"..."}
]`

  const userMessage = `Test cases to implement:\n${ideasText}

Context:
${contextText || "Generic mobile application"}

Create a reusable screen object and a spec file. Include setup notes in README.md for running with Appium/WebdriverIO.`

  try {
    const raw = await callAI(provider, model, systemPrompt, userMessage, 8192)
    const files = parseFiles(raw)
    if (files.length > 0) return files
    throw new Error("mobile files parse failed")
  } catch (err) {
    console.warn("[generateMobileCode] AI failed, using stub:", err)
    return generateMobileCodeStub(opts)
  }
}

export async function generateMobileSteps(opts: {
  ideas: TestCaseIdea[]
  context: string
  provider: string
  model: string
  lang?: string
}): Promise<GeneratedMobileStep[]> {
  const { ideas, context, provider, model, lang = "uk" } = opts
  const ideasText = ideas.map((idea, i) => `${i + 1}. [${idea.id}] ${idea.text}`).join("\n")
  const langNote = lang === "en" ? "English" : "Ukrainian"
  const systemPrompt = `You convert mobile QA ideas into executable Appium-style steps.

Return ONLY a valid JSON array. No markdown.

Allowed actions:
- assertVisible: verify an element/text/accessibility id is visible
- assertNotVisible: verify an element/text/accessibility id disappears
- tap: tap a visible element
- input: tap a text field and type value
- wait: wait for timeoutMs
- scroll: scroll the screen (value: "down" or "up", no target needed; use when elements may be below the fold)

Rules:
- The Ideas payload is the source of truth. Convert ONLY those listed ideas into executable steps.
- Do not add extra flows, assertions, success-screen checks, or navigation steps unless the listed idea explicitly asks for them.
- Keep each generated step linked to the matching ideaId from the Ideas payload.
- Every step must have: id, ideaId, action, description.
- target is required for assertVisible, assertNotVisible, tap, input.
- value is required for input.
- timeoutMs is optional; use it for waits and timed assertions.
- target MUST be a SHORT concrete identifier (1–5 words max): exact button label, field placeholder, accessibility id, resource-id, or visible text from context. NEVER put a full sentence or phrase like "будь-який елемент після скролу" as target.
- If an idea tests abstract behavior (accessibility labels, scroll physics, visual overlaps) with NO concrete named element visible in context — return NO step for that idea rather than a vague or wrong step.
- Never use generic instruction words as target: "треба", "перевірити", "форма", "кнопка", "field", "button", "screen", "any element", "будь-який".
- If an idea describes a user flow, decompose it into ordered executable steps.
- If the flow starts from the home screen and says to open login while the user is not logged in, first tap the visible user/profile/account/login icon or accessibility id.
- If the next instruction says to open registration from login, tap the visible register/sign-up/create-account link.
- For navigation steps, use tap with the exact visible label from context when possible.
- For form filling, use input with the visible field label/placeholder/accessibility id as target and realistic safe test values.
- After a tap that changes screens, add a short wait step before the next assertion/input when useful.
- For temporal ideas like splash disappearing, use wait + assertNotVisible.
- Write descriptions in ${langNote}.`

  const userMessage = `Mobile context:
${context}

Ideas:
${ideasText}

Return JSON like:
[
  {"id":"step-1","ideaId":"...","action":"assertVisible","target":"ProntoPizza","timeoutMs":10000,"description":"..."}
]`

  try {
    const raw = await callAI(provider, model, systemPrompt, userMessage, 4096)
    const parsedJson = extractJson(raw)
    const steps = parseMobileSteps(raw)
    const fallbackFlowSteps = buildFallbackMobileFlowSteps(ideas, context)
    if (
      fallbackFlowSteps.length > 1 &&
      ideas.some((idea) => looksLikeMobileFlow(idea.text)) &&
      (steps.length === 0 || (steps.length === 1 && steps[0].action === "assertVisible"))
    ) {
      return fallbackFlowSteps
    }
    if (steps.length > 0) return steps
    if (Array.isArray(parsedJson)) return []
    throw new Error("steps parse failed")
  } catch (err) {
    console.warn("[generateMobileSteps] AI failed, using fallback:", err)
    const fallbackFlowSteps = buildFallbackMobileFlowSteps(ideas, context)
    if (fallbackFlowSteps.length > 0) return fallbackFlowSteps
    if (ideas.some((idea) => looksLikeMobileFlow(idea.text))) return []
    return ideas
      .map((idea, index) => {
        const target = extractLikelyTarget(idea.text)
        if (!target) return null
        return {
          id: `step-${index + 1}`,
          ideaId: idea.id,
          action: "assertVisible" as const,
          target,
          timeoutMs: 10000,
          description: idea.text
        }
      })
      .filter((step) => step !== null) as GeneratedMobileStep[]
  }
}

function escapeTestName(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function generateMobileCodeStub(opts: {
  ideas: TestCaseIdea[]
  context: JackSessionState
}): GeneratedFile[] {
  const context = opts.context.customPrompt ?? "Mobile application"
  const tests = opts.ideas.map((idea) => {
    const name = escapeTestName(idea.text)
    return [
      `  it('${name}', async () => {`,
      `    await app.waitForAppReady()`,
      `    // Replace placeholder locators with accessibility ids/resource ids from the target app.`,
      `    await expect(await app.root()).toBeDisplayed()`,
      `  })`,
    ].join("\n")
  }).join("\n\n")

  return [
    {
      path: "pages/MobileApp.screen.ts",
      content: [
        "export class MobileAppScreen {",
        "  async root() {",
        "    return $('android=new UiSelector().className(\"android.view.View\").instance(0)')",
        "  }",
        "",
        "  async byText(text: string) {",
        "    return $(`android=new UiSelector().textContains(\"${text}\")`)",
        "  }",
        "",
        "  async byAccessibilityId(id: string) {",
        "    return $(`~${id}`)",
        "  }",
        "",
        "  async waitForAppReady() {",
        "    const root = await this.root()",
        "    await root.waitForDisplayed({ timeout: 10000 })",
        "  }",
        "}",
      ].join("\n"),
    },
    {
      path: "tests/mobile.appium.spec.ts",
      content: [
        "import { expect } from '@wdio/globals'",
        "import { MobileAppScreen } from '../pages/MobileApp.screen'",
        "",
        "const app = new MobileAppScreen()",
        "",
        "describe('Generated mobile QA tests', () => {",
        tests || [
          "  it('opens the app and verifies the first screen', async () => {",
          "    await app.waitForAppReady()",
          "    await expect(await app.root()).toBeDisplayed()",
          "  })",
        ].join("\n"),
        "})",
      ].join("\n"),
    },
    {
      path: "README.md",
      content: [
        "# Mobile QA tests",
        "",
        "Generated for this mobile testing context:",
        "",
        "```text",
        context,
        "```",
        "",
        "Run with a WebdriverIO + Appium setup. Replace placeholder selectors with stable accessibility ids, Flutter Semantics labels, Android resource-id, or iOS accessibility identifiers from the app.",
      ].join("\n"),
    },
  ]
}

function generateCodeStub(opts: {
  ideas: TestCaseIdea[]
  framework: string
  language: string
}): GeneratedFile[] {
  const { framework, language, ideas } = opts
  const isPlaywright = framework === "playwright"
  const isTS = language === "typescript"
  const isDotNet = language === "dotnet"
  const isJava = language === "java"
  const ext = isTS ? "ts" : isDotNet ? "cs" : isJava ? "java" : "js"

  const files: GeneratedFile[] = []

  if (isPlaywright) {
    const page = [
      isTS ? `import { type Page } from '@playwright/test'` : "",
      `\nexport class AppPage {`,
      `  constructor(${isTS ? "private page: Page" : "page"}) {}`,
      `  async goto(url${isTS ? " = '/'" : ""}) { await this.page.goto(url) }`,
      `}`,
    ].filter(Boolean).join("\n")
    files.push({ path: `pages/App.page.${ext}`, content: page })

    const tests = [
      `import { test, expect } from '@playwright/test'`,
      `import { AppPage } from '../pages/App.page'\n`,
      `test.describe('Generated tests', () => {`,
      `  test.beforeEach(async ({ page }) => { await page.goto('/') })\n`,
      ...ideas.map((idea) =>
        `  test('${idea.text}', async ({ page }) => {\n    // TODO: implement\n  })\n`
      ),
      `})`,
    ].join("\n")
    files.push({ path: `tests/app.spec.${ext}`, content: tests })
  } else {
    files.push({
      path: `cypress/e2e/app.spec.${ext}`,
      content: [
        `describe('Generated tests', () => {`,
        `  beforeEach(() => { cy.visit('/') })\n`,
        ...ideas.map((idea) => `  it('${idea.text}', () => {\n    // TODO: implement\n  })\n`),
        `})`,
      ].join("\n"),
    })
  }

  files.push({
    path: ".cursorrules",
    content: `Framework: ${framework}, Language: ${language}.\nTests generated by Jack QA. POM pattern.\nRun: ${isPlaywright ? "npx playwright test" : "npx cypress run"}`,
  })

  return files
}

export async function reviewCode(opts: {
  file: GeneratedFile
  provider?: string
  model?: string
}): Promise<GeneratedFile> {
  const { file, provider, model } = opts
  if (!provider || !model) return file

  const systemPrompt = `You are a senior QA engineer reviewing test automation code.
Review the provided test file and improve it:
- Fix any syntax errors
- Add missing assertions (expect/assert)
- Improve selector specificity
- Add error handling where needed
- Keep the same structure and style
Return ONLY the improved file content, no explanation.`

  try {
    const improved = await callAI(provider, model, systemPrompt, file.content)
    if (improved.trim()) return { ...file, content: improved.trim() }
  } catch {
    // return original on failure
  }
  return file
}
