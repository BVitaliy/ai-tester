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
    throw new Error(
      (err as any)?.error?.message ?? `API error ${res.status} from ${baseUrl}`
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
