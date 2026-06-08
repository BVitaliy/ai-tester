// Risk engine. Turns discovered features, forms and actions into a prioritised
// risk register with severity / likelihood / impact and an overall level.

const FEATURE_RISK = {
  payments: { category: "Payments", severity: 3, impact: 3, likelihood: 2 },
  subscriptions: { category: "Subscriptions", severity: 3, impact: 3, likelihood: 2 },
  checkout: { category: "Payments", severity: 3, impact: 3, likelihood: 2 },
  authentication: { category: "Authentication", severity: 3, impact: 3, likelihood: 2 },
  registration: { category: "Authentication", severity: 2, impact: 2, likelihood: 2 },
  "password-recovery": { category: "Authentication", severity: 2, impact: 3, likelihood: 2 },
  profile: { category: "Authorization", severity: 2, impact: 2, likelihood: 1 },
  "file-upload": { category: "Security", severity: 2, impact: 2, likelihood: 2 },
  documents: { category: "Privacy", severity: 2, impact: 2, likelihood: 1 },
  messaging: { category: "Privacy", severity: 2, impact: 2, likelihood: 1 },
  maps: { category: "Privacy", severity: 1, impact: 2, likelihood: 1 }
}

const DESTRUCTIVE_RE = /\b(delete|remove|deactivate|close account|видалити|вилучити|деактив)\b/i
const LOGOUT_RE = /\b(logout|log out|sign out|вийти|вихід)\b/i

function levelFromScore(score) {
  if (score >= 7) return "High"
  if (score >= 4) return "Medium"
  return "Low"
}

function risk(category, { severity, likelihood, impact }, rationale, evidence = []) {
  const score = severity + likelihood + impact
  return {
    category,
    severity,
    likelihood,
    impact,
    score,
    level: levelFromScore(score),
    rationale,
    evidence: evidence.slice(0, 6)
  }
}

export function assessRisks({ features = [], appMap, forms = [], skippedDangerous = [] }) {
  const risks = []
  const screens = appMap?.screens ?? []

  // Feature-driven risks.
  for (const f of features) {
    const profile = FEATURE_RISK[f.featureType]
    if (!profile) continue
    risks.push(
      risk(
        profile.category,
        profile,
        `${f.label} present (confidence ${f.confidence}); needs focused QA for correctness, error handling and security.`,
        f.evidence
      )
    )
  }

  // Destructive / logout actions encountered.
  const destructive = []
  const logout = []
  for (const screen of screens) {
    for (const el of screen.clickableElements ?? []) {
      const label = el.label || el.text || ""
      if (DESTRUCTIVE_RE.test(label)) destructive.push(label)
      if (LOGOUT_RE.test(label)) logout.push(label)
    }
  }
  for (const s of skippedDangerous ?? []) {
    if (DESTRUCTIVE_RE.test(s.label)) destructive.push(s.label)
    if (LOGOUT_RE.test(s.label)) logout.push(s.label)
  }
  if (destructive.length) {
    risks.push(
      risk("Destructive Actions", { severity: 3, likelihood: 2, impact: 3 },
        "Destructive actions exist and must be guarded with confirmation and undo where possible.",
        Array.from(new Set(destructive)))
    )
  }
  if (logout.length) {
    risks.push(
      risk("Authentication", { severity: 2, likelihood: 2, impact: 2 },
        "Logout present; verify session is fully cleared and protected screens become inaccessible.",
        Array.from(new Set(logout)))
    )
  }

  // Forms without obvious validation surface.
  const formScreens = forms.filter((f) => f.form?.isForm)
  for (const { screenId, screenName, form } of formScreens) {
    if (form.requiredCount > 0) {
      risks.push(
        risk("Forms", { severity: 2, likelihood: 2, impact: 2 },
          `Form on "${screenName}" has ${form.requiredCount} required field(s); validate empty/invalid/boundary input handling.`,
          form.fields.map((f) => f.label))
      )
    }
  }

  // Navigation dead-ends (screens with no outgoing transitions discovered).
  const deadEnds = screens.filter((s) => (s.transitions?.length ?? 0) === 0)
  if (deadEnds.length > Math.max(1, screens.length * 0.4)) {
    risks.push(
      risk("Navigation", { severity: 1, likelihood: 2, impact: 1 },
        `${deadEnds.length}/${screens.length} screens had no discovered outgoing navigation; verify they are reachable and have a way back.`,
        deadEnds.slice(0, 6).map((s) => s.name))
    )
  }

  // Dedupe by category+rationale, keep highest score first.
  const seen = new Set()
  return risks
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      const key = `${r.category}::${r.rationale}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function summarizeRisks(risks) {
  const byLevel = { High: 0, Medium: 0, Low: 0 }
  for (const r of risks) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1
  return { total: risks.length, byLevel }
}
