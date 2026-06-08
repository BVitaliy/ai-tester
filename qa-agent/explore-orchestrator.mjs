import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildKnowledgeGraph } from "./application-knowledge-graph.mjs"
import { assignScreenNames } from "./app-map-store.mjs"
import { buildAutonomousReport } from "./autonomous-report.mjs"
import { designTests } from "./autonomous-test-design.mjs"
import { detectAuthCapabilities, detectAuthRequirement, detectAuthState } from "./auth-explorer.mjs"
import { discoverFeatures } from "./feature-discovery-engine.mjs"
import { analyzeForm } from "./form-intelligence.mjs"
import { assessRisks } from "./risk-engine.mjs"
import { detectDuplicateScreens } from "./semantic-action-memory.mjs"
import { analyzeVisualWithVision } from "./visual-intelligence.mjs"

// The autonomous "Explore Application" orchestrator. Given an app map (already
// discovered by the crawler), it runs the full understanding pipeline — feature
// discovery, per-screen form/visual/auth analysis, risk assessment, knowledge
// graph, autonomous test design and a senior-QA report. Pure and offline: needs
// no device, so it can re-analyse any saved map.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UITREES_DIR = path.join(__dirname, "output", "app-maps", "uitrees")

async function loadUiTree(fingerprint) {
  try {
    const raw = await fs.readFile(path.join(UITREES_DIR, `${fingerprint}.json`), "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function exploreApplication({ appMap, appLabel, visionHook }) {
  if (!appMap || !Array.isArray(appMap.screens)) {
    throw new Error("appMap with screens is required")
  }
  assignScreenNames(appMap)

  const features = discoverFeatures(appMap)

  // Per-screen analysis. Prefer the richer saved UI tree (it includes
  // non-clickable inputs) and fall back to the app-map clickable elements.
  const perScreen = []
  for (const screen of appMap.screens) {
    const uiTree = await loadUiTree(screen.fingerprint)
    const form = analyzeForm(uiTree ?? screen)
    const visualIssues = await analyzeVisualWithVision(screen, uiTree, visionHook)
    perScreen.push({
      screenId: screen.id,
      screenName: screen.name,
      authState: detectAuthState(screen),
      authCapabilities: detectAuthCapabilities(screen),
      form,
      visualIssues
    })
  }

  const duplicateScreens = detectDuplicateScreens(appMap)
  const authRequirement = detectAuthRequirement(appMap)

  const formInfos = perScreen
    .filter((p) => p.form?.isForm)
    .map((p) => ({ screenId: p.screenId, screenName: p.screenName, form: p.form }))

  const risks = assessRisks({ features, appMap, forms: formInfos })

  const graph = buildKnowledgeGraph({
    appMap,
    features,
    perScreen,
    risks,
    duplicateScreens,
    authRequirement
  })

  const design = designTests({ appMap, features, perScreen })
  const report = buildAutonomousReport({ graph, design, risks, perScreen, appLabel })

  return { graph, features, perScreen, risks, design, report, authRequirement }
}
