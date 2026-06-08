import { buildFormSteps } from "./form-intelligence.mjs"
import { generateTestsFromAppMap, navStepsToScreen } from "./test-generator.mjs"

// Autonomous test design. Generates tests from *business flows* (not only
// screens): for each feature/flow it produces Smoke, Happy Path, Negative,
// Boundary and Risk-Based cases, reusing form intelligence + navigation pathing.
// Output steps are runner-compatible ({ action, target, value, description }).

const RISKY_FEATURES = new Set(["authentication", "registration", "payments", "checkout", "subscriptions", "password-recovery"])

function caseObj(kind, title, priority, steps) {
  return { kind, title, priority, steps }
}

export function designTests({ appMap, features = [], perScreen = [] }) {
  const suites = []

  // Base smoke + navigation coverage from the existing generator.
  const base = generateTestsFromAppMap(appMap)

  const screenById = new Map((appMap.screens ?? []).map((s) => [s.id, s]))

  for (const feature of features) {
    const cases = []
    const screens = (feature.screenIds ?? []).map((id) => screenById.get(id)).filter(Boolean)
    if (!screens.length) continue

    const formScreenInfo = perScreen.find(
      (p) => feature.screenIds.includes(p.screenId) && p.form?.isForm
    )
    const targetScreen = formScreenInfo
      ? screenById.get(formScreenInfo.screenId)
      : screens[0]
    const nav = navStepsToScreen(appMap, targetScreen.id)
    const sig = (targetScreen.visibleTexts ?? []).find((t) => t && t.length <= 32) || targetScreen.name

    // Smoke: reach the feature's main screen.
    cases.push(
      caseObj("smoke", `Smoke: open ${feature.label}`, "high", [
        ...nav,
        ...(sig ? [{ action: "assertVisible", target: sig, description: `Verify ${feature.label} screen is shown` }] : [])
      ])
    )

    if (formScreenInfo?.form?.isForm) {
      const form = formScreenInfo.form
      cases.push(
        caseObj("happy-path", `Happy path: submit valid ${feature.label} form`, "high", [
          ...nav,
          ...buildFormSteps(form, "valid")
        ])
      )
      cases.push(
        caseObj("negative", `Negative: ${feature.label} form rejects invalid input`, "high", [
          ...nav,
          ...buildFormSteps(form, "invalid"),
          ...(sig ? [{ action: "assertVisible", target: sig, description: "Verify form did not proceed on invalid input" }] : [])
        ])
      )
      cases.push(
        caseObj("boundary", `Boundary: ${feature.label} form at limits`, "medium", [
          ...nav,
          ...buildFormSteps(form, "boundary")
        ])
      )
      // Empty-submit (validation) case.
      if (form.submitLabel) {
        cases.push(
          caseObj("negative", `Negative: ${feature.label} empty submit`, "high", [
            ...nav,
            { action: "tap", target: form.submitLabel, description: `Submit "${form.submitLabel}" with empty fields` },
            ...(sig ? [{ action: "assertVisible", target: sig, description: "Verify validation blocked empty submit" }] : [])
          ])
        )
      }
    }

    // Risk-based: explicit attention for sensitive features.
    if (RISKY_FEATURES.has(feature.featureType)) {
      cases.push(
        caseObj("risk-based", `Risk-based: ${feature.label} error handling & security`, "high", [
          ...nav,
          { action: "wait", timeoutMs: 800, description: "Observe error/edge handling" },
          ...(sig ? [{ action: "assertVisible", target: sig, description: `Confirm ${feature.label} surface is stable under edge conditions` }] : [])
        ])
      )
    }

    suites.push({
      feature: feature.label,
      featureType: feature.featureType,
      confidence: feature.confidence,
      cases
    })
  }

  const byKind = {}
  for (const suite of suites) for (const c of suite.cases) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
  for (const f of base.flows) byKind[f.type] = (byKind[f.type] ?? 0) + 1

  const total = base.flows.length + suites.reduce((n, s) => n + s.cases.length, 0)

  return {
    suites,
    baseFlows: base.flows,
    summary: { total, suites: suites.length, byKind },
    packageName: appMap.appId,
    platform: appMap.platform
  }
}
