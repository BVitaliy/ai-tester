import { assignScreenNames } from "./app-map-store.mjs"
import { getElementLabel, isDangerousAction } from "./safe-actions.mjs"

// Generates executable test flows from a discovered app map. Output steps are
// compatible with the existing runner (/tests/mobile/steps): each step is
// { id, action, target?, value?, timeoutMs?, description }. The runner launches
// the app itself, so flows assume a fresh app start.

const SUBMIT_HINTS = ["login", "sign in", "увійти", "вхід", "register", "sign up", "зареєстр", "continue", "далі", "submit", "надіслати", "next", "ok", "готово"]
const INPUT_CLASS_RE = /edittext|textfield|securetextfield|searchfield|input/i

let stepCounter = 0
function step(action, extra = {}) {
  stepCounter += 1
  return {
    id: `gen-step-${stepCounter}`,
    action,
    target: extra.target,
    value: extra.value,
    timeoutMs: extra.timeoutMs,
    description: extra.description ?? action
  }
}

function signatureText(screen) {
  // Prefer the (distinctive) screen name if it is actually visible on the
  // screen, so assertions check something specific rather than app chrome.
  if (screen.name && (screen.visibleTexts ?? []).includes(screen.name)) return screen.name
  const text = (screen.visibleTexts ?? []).find((t) => t && t.length <= 32)
  return text || screen.name || ""
}

function truncate(value, max = 60) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function buildAdjacency(appMap) {
  const byId = new Map(appMap.screens.map((s) => [s.id, s]))
  return { byId }
}

// BFS shortest path of transition labels from root to targetId.
function pathToScreen(appMap, rootId, targetId) {
  if (rootId === targetId) return []
  const queue = [[rootId, []]]
  const visited = new Set([rootId])
  while (queue.length) {
    const [currentId, labels] = queue.shift()
    const current = appMap.screens.find((s) => s.id === currentId)
    if (!current) continue
    for (const transition of current.transitions ?? []) {
      if (!transition.toScreenId || visited.has(transition.toScreenId)) continue
      const nextLabels = [...labels, transition.action?.label ?? ""]
      if (transition.toScreenId === targetId) return nextLabels
      visited.add(transition.toScreenId)
      queue.push([transition.toScreenId, nextLabels])
    }
  }
  return null
}

function navigationSteps(labels) {
  const steps = []
  for (const label of labels) {
    if (!label) continue
    steps.push(step("tap", { target: label, description: `Tap "${label}"` }))
    steps.push(step("wait", { timeoutMs: 1200, description: "Wait for the screen to settle" }))
  }
  return steps
}

function screenHasInputs(screen) {
  return (screen.clickableElements ?? []).some((el) => INPUT_CLASS_RE.test(el.className ?? ""))
}

function findSubmitLabel(screen) {
  for (const el of screen.clickableElements ?? []) {
    const label = getElementLabel(el)
    if (!label) continue
    if (isDangerousAction(el)) continue
    if (SUBMIT_HINTS.some((h) => label.toLowerCase().includes(h))) return label
  }
  return null
}

function looksLikeAuth(screen) {
  const haystack = [...(screen.visibleTexts ?? []), ...(screen.clickableElements ?? []).map((e) => e.label)]
    .join(" ")
    .toLowerCase()
  return /login|sign in|увійти|вхід|password|пароль|register|sign up|реєстрац|зареєстр/.test(haystack)
}

// Exposed so the autonomous test designer can reuse the same BFS pathing.
export function navStepsToScreen(appMap, targetId) {
  const root = appMap?.screens?.[0]
  if (!root || targetId === root.id) return []
  const labels = pathToScreen(appMap, root.id, targetId)
  return labels ? navigationSteps(labels) : []
}

export function generateTestsFromAppMap(appMap, options = {}) {
  stepCounter = 0
  const flows = []
  const screens = appMap?.screens ?? []
  if (!screens.length) {
    return { flows, summary: { total: 0, byType: {} }, packageName: appMap?.appId, platform: appMap?.platform }
  }

  // Ensure screen names are distinctive even for maps saved before this logic.
  assignScreenNames(appMap)

  const root = screens[0]
  const rootSig = signatureText(root)

  // 1. Smoke test — launch and confirm the entry screen plus scroll.
  flows.push({
    id: "flow-smoke",
    type: "smoke",
    title: "Smoke: app launches and main screen loads",
    priority: "high",
    steps: [
      ...(rootSig ? [step("assertVisible", { target: rootSig, description: `Verify entry screen shows "${rootSig}"` })] : []),
      step("scroll", { value: "down", description: "Scroll down the main screen" }),
      step("scroll", { value: "up", description: "Scroll back up" })
    ]
  })

  // 2. Navigation tests — verify each major transition reaches its destination.
  // Title shows the actual tap path so each flow is self-explanatory rather than
  // a wall of identically-named "reach X" entries.
  const reachable = screens.filter((s) => s.id !== root.id)
  for (const target of reachable) {
    const labels = pathToScreen(appMap, root.id, target.id)
    if (!labels || !labels.length) continue
    const pathLabels = labels.filter(Boolean)
    const targetSig = signatureText(target)
    const steps = navigationSteps(labels)
    if (targetSig) {
      steps.push(step("assertVisible", { target: targetSig, description: `Verify "${targetSig}" screen is reached` }))
    }
    if (steps.length) {
      const title = pathLabels.length
        ? `Navigation: ${truncate(pathLabels.join(" → "))}`
        : `Navigation: reach "${target.name || targetSig || target.id}"`
      flows.push({
        id: `flow-nav-${target.id}`,
        type: "navigation",
        title,
        target: target.name || targetSig,
        priority: "medium",
        steps
      })
    }
  }

  // 3. Form validation tests — screens with inputs: submit empty, expect to stay.
  for (const screen of screens) {
    if (!screenHasInputs(screen)) continue
    const submitLabel = findSubmitLabel(screen)
    if (!submitLabel) continue
    const labels = screen.id === root.id ? [] : pathToScreen(appMap, root.id, screen.id)
    if (labels === null) continue
    const sig = signatureText(screen)
    const steps = [
      ...navigationSteps(labels),
      step("tap", { target: submitLabel, description: `Tap "${submitLabel}" with empty fields` }),
      step("wait", { timeoutMs: 1200, description: "Wait for validation" }),
      ...(sig ? [step("assertVisible", { target: sig, description: "Verify the form did not proceed (validation blocked submit)" })] : [])
    ]
    flows.push({
      id: `flow-form-${screen.id}`,
      type: "form-validation",
      title: `Form validation: empty submit on "${screen.name || sig || screen.id}"`,
      priority: "high",
      steps
    })
  }

  // 4. Auth tests — login/register screens detected.
  for (const screen of screens) {
    if (!looksLikeAuth(screen)) continue
    const labels = screen.id === root.id ? [] : pathToScreen(appMap, root.id, screen.id)
    if (labels === null) continue
    const fieldLabels = (screen.clickableElements ?? [])
      .filter((el) => INPUT_CLASS_RE.test(el.className ?? "") || /email|password|пароль|логін|пошта/i.test(getElementLabel(el)))
      .map((el) => getElementLabel(el))
      .filter(Boolean)
      .slice(0, 3)
    const steps = [
      ...navigationSteps(labels),
      ...fieldLabels.map((label) => step("assertVisible", { target: label, description: `Verify auth field "${label}" is present` }))
    ]
    if (steps.length) {
      flows.push({
        id: `flow-auth-${screen.id}`,
        type: "auth",
        title: `Auth: login/register screen "${screen.name || screen.id}"`,
        priority: "high",
        steps
      })
    }
  }

  // 5. Deep link placeholder — kept inert until the app declares deep links.
  flows.push({
    id: "flow-deeplink-placeholder",
    type: "deep-link",
    title: "Deep link (placeholder)",
    priority: "low",
    placeholder: true,
    steps: [
      step("wait", { timeoutMs: 500, description: "Placeholder: add deep link target (e.g. adb am start -d <uri>) when the app exposes deep links" })
    ]
  })

  // Drop flows that ended up identical (same path → same title).
  const seenTitles = new Set()
  const deduped = flows.filter((flow) => {
    if (seenTitles.has(flow.title)) return false
    seenTitles.add(flow.title)
    return true
  })

  const byType = {}
  for (const flow of deduped) byType[flow.type] = (byType[flow.type] ?? 0) + 1

  return {
    flows: deduped,
    summary: { total: deduped.length, byType },
    packageName: appMap.appId,
    platform: appMap.platform
  }
}
