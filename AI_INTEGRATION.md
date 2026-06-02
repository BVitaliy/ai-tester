# AI Integration

Docshot uses two free/cheap AI services:

| Step | Service | Cost |
|---|---|---|
| Transcription | Web Speech API (Chrome built-in) | Free |
| HTML generation | Gemini 2.0 Flash | Free tier: 1500 req/day |

## Setup

### 1. Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key** → **Create API key**
4. Copy the key (starts with `AIza…`)

No payment method required for the free tier.

### 2. Enter the key in the extension

1. Open the Docshot popup
2. Click **⚙ Gemini API ключ** to expand the settings
3. Paste your key and click **Зберегти**
4. A green ✓ confirms the key is stored

The key is saved in `chrome.storage.local` on your device only — it is never sent anywhere except directly to `generativelanguage.googleapis.com`.

## How it works

```
AudioRecorderScreen
  └── webkitSpeechRecognition (lang: uk-UA, continuous, interimResults)
      └── live transcript shown during recording
          └── onConfirm(transcript) → AUDIO_DONE message

background.ts
  └── runAiSubmission()
      └── submitToAi({ imageDataUrl, transcript, context })
          └── POST generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
              └── returns HTML fragment → stored in CaptureFlow.generatedHtml
                  └── NAVIGATE → content-review
```

## Mock mode

Set `PLASMO_PUBLIC_MOCK_MODE=true` in `.env.development`. No API key needed — `submitToAi` returns a hardcoded HTML response after 1.5 s.

## Migrating to server-side (future)

When the AI key moves to the WP backend:

1. Create a WP REST endpoint: `POST /wp-json/docshot/v1/generate`
   - Accepts `{ imageDataUrl, transcript, context }`
   - Calls Gemini internally using a server-stored key
   - Returns `{ contentHtml }`

2. In `src/core/api.ts`, replace the `submitToAi` implementation:

```ts
export async function submitToAi(payload: AiSubmitPayload, token: string): Promise<AiResult> {
  if (MOCK_MODE) { /* unchanged */ }
  const res = await fetch(`${API_BASE_URL}/wp-json/docshot/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error("Не вдалося отримати відповідь від AI")
  return res.json()
}
```

No other files need to change.

## Free tier limits

Gemini 2.0 Flash free tier (as of 2025):
- 15 requests / minute
- 1 500 requests / day
- 1 000 000 tokens / minute

For a documentation team this is more than sufficient. If limits are hit, upgrade to pay-as-you-go at ~$0.10 / 1M input tokens.
