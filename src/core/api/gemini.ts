import { getAiKeys } from "../../store/session"
import { GEMINI_API_URL, GEMINI_MODEL, MOCK_MODE } from "../config"
import type { AiResult, AiSubmitPayload } from "../types"
import { delay } from "./mock-data"

const GEMINI_SYSTEM_PROMPT = `You are a technical documentation writer for web admin panels.
You receive an annotated screenshot and a voice transcription describing what is shown.
Write documentation in Ukrainian for a content field in a web admin panel.

Rules:
- Output ONLY the HTML fragment — no markdown, no code fences, no wrapping tags
- Allowed tags: <p>, <ol>, <ul>, <li>, <strong>, <em>
- Reference visual annotations (arrows, labels, rectangles) naturally in the text
- Tone: clear, step-by-step, concise technical documentation
- Do not include an <img> tag — the caller inserts it separately
- Language: Ukrainian`

const GEMINI_VIDEO_SYSTEM_PROMPT = `You are a technical documentation writer for web admin panels.
You receive a screen-recorded video with microphone audio narration describing what is shown.
Write documentation in Ukrainian for a content field in a web admin panel.

Rules:
- Output ONLY the HTML fragment — no markdown, no code fences, no wrapping tags
- Allowed tags: <p>, <ol>, <ul>, <li>, <strong>, <em>
- Base your documentation on what the narrator describes and what is visible in the video
- Tone: clear, step-by-step, concise technical documentation
- Do not include an <img> or <video> tag
- Language: Ukrainian`

async function waitForGeminiFile(
  fileName: string,
  apiKey: string,
  signal?: AbortSignal,
  maxAttempts = 20,
  intervalMs = 2000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    signal?.throwIfAborted()
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      { headers: { "x-goog-api-key": apiKey }, signal }
    )
    if (!res.ok) throw new Error("Не вдалося перевірити статус файлу Gemini")
    const data = await res.json()
    if (data?.state === "ACTIVE") return
    if (data?.state === "FAILED")
      throw new Error("Обробка відео файлу Gemini завершилась з помилкою")
    await delay(intervalMs)
  }
  throw new Error("Файл Gemini не став активним вчасно")
}

export async function uploadVideoToGemini(
  videoBlob: Blob,
  mimeType: string
): Promise<string> {
  if (MOCK_MODE) {
    await delay(1000)
    return `https://generativelanguage.googleapis.com/v1beta/files/mock-${Date.now()}`
  }

  const { geminiKey } = await getAiKeys()
  if (!geminiKey)
    throw new Error(
      "Gemini API key не встановлено. Відкрийте popup розширення та введіть ключ."
    )

  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoBlob.size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey
      },
      body: JSON.stringify({ file: { display_name: `QA-${Date.now()}` } })
    }
  )

  if (!initRes.ok)
    throw new Error("Не вдалося ініціалізувати завантаження відео")

  const uploadUrl = initRes.headers.get("X-Goog-Upload-URL")
  if (!uploadUrl) throw new Error("Upload URL не отримано від Gemini")

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(videoBlob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType
    },
    body: videoBlob
  })

  if (!uploadRes.ok) throw new Error("Не вдалося завантажити відео до Gemini")

  const fileData = await uploadRes.json()
  const fileUri = fileData?.file?.uri
  const fileName = fileData?.file?.name
  if (!fileUri || !fileName) throw new Error("URI файлу не отримано від Gemini")

  await waitForGeminiFile(fileName, geminiKey)

  return fileUri
}

export async function translateHtml(
  html: string,
  targetLanguage: string,
  signal?: AbortSignal
): Promise<string> {
  if (MOCK_MODE) {
    await delay(1500)
    return `<p>[${targetLanguage}] ${html}</p>`
  }

  const { geminiKey, geminiModel } = await getAiKeys()
  if (!geminiKey)
    throw new Error(
      "Gemini API key не встановлено. Відкрийте popup розширення та введіть ключ."
    )
  const model = geminiModel ?? GEMINI_MODEL

  const systemPrompt = `You are a technical HTML translator.
Translate the following HTML fragment to ${targetLanguage}.
Keep all HTML tags and attributes intact — translate only the visible text content.
Output ONLY the translated HTML fragment — no markdown, no code fences, no wrapping tags.`

  const res = await fetch(
    `${GEMINI_API_URL}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey
      },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: html }] }]
      })
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message ?? "Не вдалося отримати переклад від Gemini"
    )
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
}

export async function submitToAi(
  payload: AiSubmitPayload,
  _token: string,
  signal?: AbortSignal
): Promise<AiResult> {
  const { geminiKey, geminiModel } = await getAiKeys()
  if (!geminiKey)
    throw new Error(
      "Gemini API key не встановлено. Відкрийте popup розширення та введіть ключ."
    )
  const model = geminiModel ?? GEMINI_MODEL

  let parts: object[]
  if (payload.videoBase64) {
    const textPart = payload.transcript
      ? `Додатковий опис: ${payload.transcript}\n\nКонтекст: ${payload.context}`
      : `Контекст: ${payload.context}`
    parts = [
      {
        inline_data: {
          mime_type: payload.videoMimeType ?? "video/webm",
          data: payload.videoBase64
        }
      },
      { text: textPart }
    ]
  } else if (payload.videoFileUri) {
    const textPart = payload.transcript
      ? `Додатковий опис: ${payload.transcript}\n\nКонтекст: ${payload.context}`
      : `Контекст: ${payload.context}`
    parts = [
      {
        file_data: {
          mime_type: payload.videoMimeType ?? "video/webm",
          file_uri: payload.videoFileUri
        }
      },
      { text: textPart }
    ]
  } else {
    const base64Image = payload.imageDataUrl!.replace(
      /^data:image\/\w+;base64,/,
      ""
    )
    parts = [
      { inline_data: { mime_type: "image/png", data: base64Image } },
      {
        text: `Транскрипція: ${payload.transcript ?? ""}\n\nКонтекст: ${payload.context}`
      }
    ]
  }

  const res = await fetch(
    `${GEMINI_API_URL}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey
      },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                payload.videoBase64 || payload.videoFileUri
                  ? GEMINI_VIDEO_SYSTEM_PROMPT
                  : GEMINI_SYSTEM_PROMPT
            }
          ]
        },
        contents: [{ parts }]
      })
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message ?? "Не вдалося отримати відповідь від Gemini"
    )
  }

  const data = await res.json()
  const contentHtml = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  return { contentHtml }
}
