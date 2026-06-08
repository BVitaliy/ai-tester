import crypto from "node:crypto"

// Application Knowledge Graph. The central application model: it connects
// Feature → Screen → Action → Result, and carries business flows, entities,
// auth states and risks. Built from the app map plus the analysis layers; can be
// extended continuously as more is discovered.

function featureId(type) {
  return `feat-${type}`
}

function shortId(prefix) {
  return `${prefix}-${crypto.randomBytes(3).toString("hex")}`
}

// Extract candidate domain entities (nouns the app deals with) from screen names
// and form field labels — used to describe what the app is "about".
function discoverEntities(appMap, perScreen) {
  const counts = new Map()
  const add = (value) => {
    const v = String(value || "").trim()
    if (v.length < 3 || v.length > 30) return
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  for (const s of appMap.screens ?? []) add(s.name)
  for (const ps of perScreen ?? []) for (const f of ps.form?.fields ?? []) add(f.label)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }))
}

// Build a Feature → Screen → Action → Result business flow per discovered
// feature, using transitions to infer the "result" of the primary action.
function buildBusinessFlows(appMap, features, perScreen) {
  const screenById = new Map((appMap.screens ?? []).map((s) => [s.id, s]))
  const flows = []

  for (const feature of features) {
    const screens = (feature.screenIds ?? []).map((id) => screenById.get(id)).filter(Boolean)
    if (!screens.length) continue
    // Prefer a screen with a form for action-bearing features.
    const formScreen =
      screens.find((s) => perScreen.find((p) => p.screenId === s.id)?.form?.isForm) || screens[0]

    const transition = (formScreen.transitions ?? [])[0]
    const resultScreen = transition?.toScreenId ? screenById.get(transition.toScreenId) : null
    const primaryAction =
      perScreen.find((p) => p.screenId === formScreen.id)?.form?.submitLabel ||
      transition?.action?.label ||
      "Primary action"

    flows.push({
      id: shortId("flow"),
      feature: feature.label,
      featureType: feature.featureType,
      confidence: feature.confidence,
      steps: [
        { node: "Feature", value: feature.label },
        { node: "Screen", value: formScreen.name },
        { node: "Action", value: primaryAction },
        { node: "Result", value: resultScreen?.name || "(expected post-action state)" }
      ]
    })
  }
  return flows
}

export function buildKnowledgeGraph(input) {
  const {
    appMap,
    features = [],
    perScreen = [],
    risks = [],
    duplicateScreens = [],
    authRequirement = null
  } = input

  const featNodes = features.map((f) => ({
    id: featureId(f.featureType),
    type: f.featureType,
    name: f.label,
    confidence: f.confidence,
    screenIds: f.screenIds ?? [],
    evidence: f.evidence ?? []
  }))

  const screenFeatureIndex = new Map()
  for (const f of featNodes) for (const sid of f.screenIds) {
    const arr = screenFeatureIndex.get(sid) ?? []
    arr.push(f.id)
    screenFeatureIndex.set(sid, arr)
  }

  const screenNodes = (appMap.screens ?? []).map((s) => {
    const ps = perScreen.find((p) => p.screenId === s.id)
    return {
      id: s.id,
      name: s.name,
      featureIds: screenFeatureIndex.get(s.id) ?? [],
      authState: ps?.authState ?? "unknown",
      form: ps?.form ? { isForm: ps.form.isForm, fieldCount: ps.form.fieldCount, requiredCount: ps.form.requiredCount } : null,
      visualIssueCount: ps?.visualIssues?.length ?? 0,
      transitionCount: s.transitions?.length ?? 0
    }
  })

  const edges = []
  for (const s of appMap.screens ?? []) {
    for (const t of s.transitions ?? []) {
      edges.push({
        from: s.id,
        to: t.toScreenId,
        action: t.action?.label ?? "",
        kind: t.action?.kind ?? "element"
      })
    }
  }

  const flows = buildBusinessFlows(appMap, features, perScreen)
  const entities = discoverEntities(appMap, perScreen)

  return {
    app: {
      appId: appMap.appId,
      platform: appMap.platform,
      generatedAt: new Date().toISOString()
    },
    features: featNodes,
    screens: screenNodes,
    edges,
    flows,
    entities,
    authRequirement,
    duplicateScreens,
    risks,
    stats: {
      featureCount: featNodes.length,
      screenCount: screenNodes.length,
      edgeCount: edges.length,
      flowCount: flows.length,
      duplicateGroups: duplicateScreens.length
    }
  }
}

// Renders the graph as a feature → screen tree for the report.
export function renderGraphTree(graph) {
  const lines = []
  const screensById = new Map(graph.screens.map((s) => [s.id, s]))
  const claimed = new Set()

  for (const feature of graph.features) {
    lines.push(feature.name)
    const screens = feature.screenIds.map((id) => screensById.get(id)).filter(Boolean)
    screens.forEach((s, i) => {
      claimed.add(s.id)
      lines.push(`${i === screens.length - 1 ? "└─" : "├─"} ${s.name}`)
    })
  }

  const unclaimed = graph.screens.filter((s) => !claimed.has(s.id))
  if (unclaimed.length) {
    lines.push("Other / Uncategorised")
    unclaimed.forEach((s, i) => {
      lines.push(`${i === unclaimed.length - 1 ? "└─" : "├─"} ${s.name}`)
    })
  }
  return lines.join("\n")
}
