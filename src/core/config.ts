export const API_BASE_URL =
  process.env.PLASMO_PUBLIC_API_BASE_URL ??
  "https://documentation.redstone.studio"

export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta"
export const GEMINI_MODEL = "gemini-3.1-flash-lite"

export const GEMINI_MODELS = [
  { id: "gemini-3.1-flash-lite", label: "3.1 Flash Lite" },
  { id: "gemini-3-flash-preview", label: "3 Flash" },
  { id: "gemini-2.5-flash-lite", label: "2.5 Flash Lite" },
  { id: "gemini-2.5-flash", label: "2.5 Flash" },
  { id: "gemini-2.0-flash", label: "2.0 Flash" }
] as const

export const MOCK_MODE = process.env.PLASMO_PUBLIC_MOCK_MODE === "true"

export const SEARCH_DEBOUNCE_MS = 300
