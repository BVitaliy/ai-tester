import { actionIntent, createSemanticMemory } from "./semantic-action-memory.mjs"
import { detectScreenFeatures } from "./feature-discovery-engine.mjs"
import { getElementLabel, getSafeClickableActions } from "./safe-actions.mjs"

// Goal-driven exploration. Rather than tapping in arbitrary order, the explorer
// infers the screen's purpose and the user goals it affords, then ranks actions
// by how central they are to those goals — and uses semantic memory to skip
// already-saturated intents (e.g. the 50th identical product card).

const INTENT_PRIORITY = {
  "auth-login": 100,
  "auth-register": 90,
  "auth-forgot": 85,
  submit: 80,
  "navigate-tab": 70,
  "navigate-menu": 65,
  search: 60,
  "open-detail": 50,
  "open-item": 40,
  "tap-button": 35,
  settings: 30,
  "auth-social": 25,
  tap: 20,
  back: 5
}

export function inferGoals(screen) {
  const features = detectScreenFeatures(screen)
  const goals = []
  for (const f of features) {
    switch (f.featureType) {
      case "authentication":
        goals.push("Authenticate (log in)")
        break
      case "registration":
        goals.push("Create an account")
        break
      case "password-recovery":
        goals.push("Recover password")
        break
      case "search":
        goals.push("Search content")
        break
      case "checkout":
      case "payments":
        goals.push("Complete a purchase")
        break
      default:
        goals.push(`Use ${f.label}`)
    }
  }
  if (!goals.length) goals.push("Navigate deeper into the app")
  return Array.from(new Set(goals)).slice(0, 5)
}

// Ranks the safe actions of a screen. `memory` (optional) is a semantic memory;
// saturated intents are dropped so we don't re-explore duplicates.
export function rankActions(screen, options = {}) {
  const { memory, maxActionsPerScreen = 8, avoidDangerousActions = true } = options
  const { actions, skipped } = getSafeClickableActions(
    { clickableElements: screen.clickableElements },
    { maxActionsPerScreen: 1000, avoidDangerousActions }
  )

  const ranked = []
  for (const a of actions) {
    const meta = actionIntent(a.element)
    if (memory && memory.isSaturated(meta.signature)) continue
    const priority = INTENT_PRIORITY[meta.intent] ?? 20
    ranked.push({
      element: a.element,
      label: a.label || getElementLabel(a.element),
      intent: meta.intent,
      signature: meta.signature,
      kind: meta.kind,
      score: priority
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  return { actions: ranked.slice(0, maxActionsPerScreen), skipped }
}

// Adapter for the crawler's `selectActions` hook. Holds its own semantic memory
// across the whole scan so saturated intents (duplicate cards/lists) stop being
// re-explored. Returns elements in goal-priority order.
export function makeActionPlanner(options = {}) {
  const memory = options.memory ?? createSemanticMemory(options)
  return function selectActions(screenFp) {
    const screen = { clickableElements: screenFp.clickableElements }
    const { actions } = rankActions(screen, { ...options, memory })
    for (const a of actions) memory.record(a.signature)
    return actions.map((a) => ({ element: a.element, label: a.label, kind: a.kind, intent: a.intent }))
  }
}
