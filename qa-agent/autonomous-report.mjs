import { renderGraphTree } from "./application-knowledge-graph.mjs"
import { summarizeRisks } from "./risk-engine.mjs"

// Autonomous QA report. Reads like a senior QA engineer wrote it: it explains
// reasoning, not just results. Produces Markdown (the format the user already
// opens) plus a coverage estimate and a confidence score.

function computeCoverage(graph, design) {
  const totalScreens = graph.screens.length || 1
  const screensInFlows = new Set()
  for (const flow of graph.flows) for (const f of graph.features) {
    if (f.name === flow.feature) for (const sid of f.screenIds) screensInFlows.add(sid)
  }
  const featuresWithTests = new Set(design.suites.map((s) => s.featureType))
  const featureCoverage = graph.features.length
    ? Math.round((featuresWithTests.size / graph.features.length) * 100)
    : 0
  const screenCoverage = Math.round((screensInFlows.size / totalScreens) * 100)
  return { featureCoverage, screenCoverage, screensInFlows: screensInFlows.size, totalScreens }
}

function computeConfidence(graph) {
  if (!graph.features.length) return 30
  const avg = graph.features.reduce((s, f) => s + f.confidence, 0) / graph.features.length
  // Blend feature confidence with how much of the app we actually traversed.
  const traversal = Math.min(1, graph.stats.edgeCount / Math.max(4, graph.screens.length))
  return Math.round((avg * 0.7 + traversal * 0.3) * 100)
}

function bullet(items) {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- _None detected_"
}

export function buildAutonomousReport({ graph, design, risks, perScreen = [], appLabel }) {
  const riskSummary = summarizeRisks(risks)
  const coverage = computeCoverage(graph, design)
  const confidence = computeConfidence(graph)

  const visualIssues = []
  for (const ps of perScreen) {
    for (const issue of ps.visualIssues ?? []) {
      visualIssues.push({ screen: ps.screenName, ...issue })
    }
  }
  const detected = visualIssues.filter((i) => i.severity === "high")
  const potential = visualIssues.filter((i) => i.severity !== "high")

  const formScreens = perScreen.filter((p) => p.form?.isForm)

  const lines = []
  lines.push(`# Autonomous QA Report — ${appLabel || graph.app.appId}`)
  lines.push("")
  lines.push(`_Platform: ${graph.app.platform} · Generated: ${new Date(graph.app.generatedAt).toLocaleString()} · Agent confidence: ${confidence}%_`)
  lines.push("")

  // 1. Application Summary
  lines.push("## Application Summary")
  lines.push("")
  lines.push(
    `The agent explored **${graph.stats.screenCount} screens** with **${graph.stats.edgeCount} navigation paths** and identified **${graph.stats.featureCount} features** and **${graph.flows.length} business flows**. ` +
    `Below is my reasoning as if reviewing this build before release.`
  )
  lines.push("")
  if (graph.entities.length) {
    lines.push(`The app appears to deal primarily with: ${graph.entities.slice(0, 8).map((e) => `**${e.name}**`).join(", ")}.`)
    lines.push("")
  }

  // 2. Features Found
  lines.push("## Features Found")
  lines.push("")
  lines.push("```")
  lines.push(renderGraphTree(graph))
  lines.push("```")
  lines.push("")
  for (const f of graph.features) {
    lines.push(`- **${f.name}** — confidence ${Math.round(f.confidence * 100)}%, seen on ${f.screenIds.length} screen(s). Evidence: ${f.evidence.slice(0, 5).join(", ") || "—"}`)
  }
  lines.push("")

  // 3. Authentication Analysis
  lines.push("## Authentication Analysis")
  lines.push("")
  if (graph.authRequirement) {
    const ar = graph.authRequirement
    lines.push(
      ar.likelyRequiresAuth
        ? `The app **likely requires authentication** — ${ar.unauthenticatedScreens} screen(s) gate access and no authenticated-only surface was reached without logging in.`
        : `Authentication is present but does not appear to fully gate the app (${ar.authenticatedScreens} authenticated-style screen(s) were reachable).`
    )
    lines.push("")
    lines.push("**Why it matters:** auth is the highest-leverage area — broken login/registration blocks the entire product and is a common source of security defects (session handling, error leakage, brute-force).")
  } else {
    lines.push("No authentication surface was detected in the explored area.")
  }
  lines.push("")

  // 4. Navigation Analysis
  lines.push("## Navigation Analysis")
  lines.push("")
  const deadEnds = graph.screens.filter((s) => s.transitionCount === 0)
  lines.push(`- Reachable screens: ${graph.stats.screenCount}`)
  lines.push(`- Navigation paths discovered: ${graph.stats.edgeCount}`)
  lines.push(`- Screens with no outgoing navigation: ${deadEnds.length}`)
  if (graph.duplicateScreens.length) {
    lines.push(`- Repeated screen templates detected: ${graph.duplicateScreens.length} group(s) (the agent sampled representatives instead of every instance).`)
  }
  lines.push("")

  // 5. Forms Analysis
  lines.push("## Forms Analysis")
  lines.push("")
  if (formScreens.length) {
    for (const fs of formScreens) {
      const f = fs.form
      lines.push(`- **${fs.screenName}** — ${f.fieldCount} field(s) (${f.requiredCount} required)${f.hasPassword ? ", contains a password field" : ""}. Fields: ${f.fields.map((x) => `${x.label}:${x.type}`).join(", ")}`)
    }
    lines.push("")
    lines.push("**Why it matters:** forms are where invalid input, weak validation and confusing errors hurt users most. The agent generated valid/invalid/boundary cases for each.")
  } else {
    lines.push("No data-entry forms were detected in the explored area.")
  }
  lines.push("")

  // 6. Risk Analysis
  lines.push("## Risk Analysis")
  lines.push("")
  lines.push(`Total risks: **${riskSummary.total}** — High: ${riskSummary.byLevel.High || 0}, Medium: ${riskSummary.byLevel.Medium || 0}, Low: ${riskSummary.byLevel.Low || 0}.`)
  lines.push("")
  lines.push("| Level | Category | Why | Evidence |")
  lines.push("|---|---|---|---|")
  for (const r of risks.slice(0, 15)) {
    lines.push(`| ${r.level} | ${r.category} | ${r.rationale} | ${(r.evidence || []).slice(0, 3).join(", ")} |`)
  }
  lines.push("")

  // 7. Business Flows
  lines.push("## Business Flows")
  lines.push("")
  for (const flow of graph.flows) {
    lines.push(`- **${flow.feature}**: ${flow.steps.map((s) => `${s.node}(${s.value})`).join(" → ")}`)
  }
  if (!graph.flows.length) lines.push("- _No multi-step business flows reconstructed yet._")
  lines.push("")

  // 8. Detected Issues
  lines.push("## Detected Issues")
  lines.push("")
  lines.push(bullet(detected.map((i) => `**${i.type}** on _${i.screen}_ — ${i.detail}`)))
  lines.push("")

  // 9. Potential Issues
  lines.push("## Potential Issues")
  lines.push("")
  lines.push(bullet([
    ...potential.map((i) => `**${i.type}** on _${i.screen}_ — ${i.detail}`),
    ...risks.filter((r) => r.level !== "High").slice(0, 6).map((r) => `${r.category}: ${r.rationale}`)
  ]))
  lines.push("")

  // 10. Suggested Manual Tests
  lines.push("## Suggested Manual Tests")
  lines.push("")
  const manual = []
  for (const f of graph.features) {
    if (f.type === "authentication") manual.push("Try login with wrong password, locked account, and verify error messaging is clear but not leaky.")
    if (f.type === "payments" || f.type === "checkout") manual.push("Attempt payment with declined/expired card; verify no charge on error and a clear retry path.")
    if (f.type === "registration") manual.push("Register with an already-used email; verify graceful handling.")
    if (f.type === "password-recovery") manual.push("Request password reset for unknown and known emails; verify identical, non-enumerating responses.")
  }
  manual.push("Rotate device orientation and font scaling on key screens to catch layout breakage.")
  lines.push(bullet(Array.from(new Set(manual))))
  lines.push("")

  // 11. Suggested Automation
  lines.push("## Suggested Automation")
  lines.push("")
  lines.push(`The agent designed **${design.summary.total} automated cases** across ${design.summary.suites} feature suite(s):`)
  lines.push("")
  for (const [kind, count] of Object.entries(design.summary.byKind)) {
    lines.push(`- ${kind}: ${count}`)
  }
  lines.push("")
  lines.push("Run these via **Generate Tests From App Map** / **Run Critical Flows**. High-priority happy-path and negative auth/payment cases should be automated first.")
  lines.push("")

  // 12. Coverage & Confidence
  lines.push("## Coverage Estimate")
  lines.push("")
  lines.push(`- Feature coverage (features with designed tests): **${coverage.featureCoverage}%**`)
  lines.push(`- Screen coverage (screens reached in flows): **${coverage.screenCoverage}%** (${coverage.screensInFlows}/${coverage.totalScreens})`)
  lines.push(`- Overall agent confidence: **${confidence}%**`)
  lines.push("")
  lines.push("> Confidence reflects feature-detection certainty and how much of the app was actually traversed. It is not a guarantee of correctness — it estimates how much I was able to understand.")
  lines.push("")

  return { markdown: lines.join("\n"), coverage, confidence, riskSummary }
}
