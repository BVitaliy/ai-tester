// Authentication explorer. Detects authentication state and capabilities, and
// plans (never brute-forces) a login using *configured test credentials*. Real
// credentials must be supplied explicitly via env or options; nothing is guessed.

import { analyzeForm } from "./form-intelligence.mjs"

function haystack(screen) {
  return [
    ...(screen.visibleTexts ?? []),
    ...((screen.clickableElements ?? []).map((e) => e.label || e.text || e.contentDesc || ""))
  ]
    .filter(Boolean)
    .join("  ")
    .toLowerCase()
}

const LOGIN_RE = /\b(log\s?in|sign\s?in|увійти|вхід|логін)\b/
const REGISTER_RE = /\b(register|sign\s?up|зареєстр|реєстрац)\b/
const FORGOT_RE = /\b(forgot|reset password|відновити пароль|забули)\b/
const OTP_RE = /\b(otp|verification code|one-time|код підтвердж|sms код)\b/
const BIOMETRIC_RE = /\b(face id|touch id|biometric|fingerprint|відбиток)\b/
const SOCIAL_RE = /\b(continue with|google|apple|facebook)\b/
const AUTHED_RE = /\b(logout|log out|sign out|вийти|my profile|мій профіль|кабінет|dashboard)\b/

export function detectAuthCapabilities(screen) {
  const hay = haystack(screen)
  return {
    login: LOGIN_RE.test(hay),
    register: REGISTER_RE.test(hay),
    forgotPassword: FORGOT_RE.test(hay),
    otp: OTP_RE.test(hay),
    biometric: BIOMETRIC_RE.test(hay),
    socialLogin: SOCIAL_RE.test(hay)
  }
}

// 'authenticated' | 'unauthenticated' | 'partial' | 'unknown'
export function detectAuthState(screen) {
  const hay = haystack(screen)
  const form = analyzeForm(screen)
  const authedMarker = AUTHED_RE.test(hay)
  const loginMarker = LOGIN_RE.test(hay) || REGISTER_RE.test(hay)

  if (authedMarker && !loginMarker) return "authenticated"
  if (OTP_RE.test(hay) || (form.hasPassword && !form.fields.some((f) => f.type === "email"))) return "partial"
  if (loginMarker || form.hasPassword) return "unauthenticated"
  return "unknown"
}

// App-level: is auth required to get past the entry screens?
export function detectAuthRequirement(appMap) {
  const screens = appMap?.screens ?? []
  const states = screens.map((s) => detectAuthState(s))
  const unauth = states.filter((s) => s === "unauthenticated").length
  const authed = states.filter((s) => s === "authenticated").length
  return {
    likelyRequiresAuth: unauth > 0 && authed === 0,
    states,
    unauthenticatedScreens: unauth,
    authenticatedScreens: authed
  }
}

// Reads configured test credentials. Precedence: explicit options, then env.
export function getTestCredentials(options = {}) {
  const email = options.email ?? process.env.QA_TEST_EMAIL ?? null
  const password = options.password ?? process.env.QA_TEST_PASSWORD ?? null
  return email && password ? { email, password } : null
}

// Plans a login on a given screen using the form fields + configured creds.
// Returns null when no credentials are configured (we never invent data).
export function planLogin(screen, options = {}) {
  const creds = getTestCredentials(options)
  if (!creds) return { ok: false, reason: "no-credentials", steps: [] }

  const form = analyzeForm(screen)
  const emailField = form.fields.find((f) => f.type === "email") || form.fields.find((f) => f.type === "text" || f.type === "name")
  const passwordField = form.fields.find((f) => f.type === "password")
  if (!emailField || !passwordField) {
    return { ok: false, reason: "login-fields-not-found", steps: [] }
  }

  const steps = [
    { action: "input", target: emailField.label, value: creds.email, description: "Enter test login/email" },
    { action: "input", target: passwordField.label, value: creds.password, description: "Enter test password" }
  ]
  if (form.submitLabel) {
    steps.push({ action: "tap", target: form.submitLabel, description: `Submit login via "${form.submitLabel}"` })
  }
  return { ok: true, steps }
}
