import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Persistent app-map storage. An app map captures the discovered screens of an
// app plus the transitions between them, so it can be replayed/analyzed and
// turned into runnable test flows.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_MAPS_DIR = path.join(__dirname, "output", "app-maps")

function nowIso() {
  return new Date().toISOString()
}

function shortId(prefix = "screen") {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`
}

export function createEmptyAppMap({ appId, platform, deviceId }) {
  const ts = nowIso()
  return {
    appId: appId ?? "",
    platform: platform ?? "android",
    deviceId: deviceId ?? "",
    createdAt: ts,
    updatedAt: ts,
    screens: []
  }
}

export function findScreenByFingerprint(appMap, fingerprint) {
  if (!appMap || !fingerprint) return null
  return appMap.screens.find((screen) => screen.fingerprint === fingerprint) ?? null
}

// Adds a new screen or merges into the existing screen with the same
// fingerprint. Returns the screen record (always the stored object).
export function addOrUpdateScreen(appMap, screenData) {
  const existing = findScreenByFingerprint(appMap, screenData.fingerprint)
  appMap.updatedAt = nowIso()

  if (existing) {
    if (screenData.name && !existing.name) existing.name = screenData.name
    if (screenData.purpose && !existing.purpose) existing.purpose = screenData.purpose
    if (screenData.screenshotPath) existing.screenshotPath = screenData.screenshotPath
    if (screenData.uiTreePath) existing.uiTreePath = screenData.uiTreePath
    if (Array.isArray(screenData.visibleTexts) && screenData.visibleTexts.length) {
      existing.visibleTexts = screenData.visibleTexts
    }
    if (Array.isArray(screenData.clickableElements) && screenData.clickableElements.length) {
      existing.clickableElements = screenData.clickableElements
    }
    if (screenData.focusedWindow && !existing.focusedWindow) {
      existing.focusedWindow = screenData.focusedWindow
    }
    return existing
  }

  const screen = {
    id: screenData.id ?? shortId(),
    fingerprint: screenData.fingerprint,
    name: screenData.name ?? "",
    purpose: screenData.purpose ?? "",
    screenshotPath: screenData.screenshotPath ?? null,
    uiTreePath: screenData.uiTreePath ?? null,
    focusedWindow: screenData.focusedWindow ?? "",
    visibleTexts: screenData.visibleTexts ?? [],
    clickableElements: screenData.clickableElements ?? [],
    transitions: []
  }
  appMap.screens.push(screen)
  return screen
}

// Records a transition fromScreenId --action--> toScreenId. Deduped by
// (action label + target screen). `action` is an object: { label, elementId,
// kind }.
export function addTransition(appMap, fromScreenId, action, toScreenId) {
  const from = appMap.screens.find((screen) => screen.id === fromScreenId)
  if (!from) return null
  const actionLabel = typeof action === "string" ? action : action?.label ?? ""
  const existing = from.transitions.find(
    (t) => t.action?.label === actionLabel && t.toScreenId === toScreenId
  )
  if (existing) return existing

  const transition = {
    action: typeof action === "string" ? { label: action } : action,
    toScreenId: toScreenId ?? null
  }
  from.transitions.push(transition)
  appMap.updatedAt = nowIso()
  return transition
}

function appMapFileName(appMap) {
  const safeApp = String(appMap.appId || "app").replace(/[^\w.-]+/g, "_")
  return `${safeApp}-${appMap.platform}-${Date.now()}.json`
}

export async function saveAppMap(filePath, appMap) {
  const target =
    filePath ?? path.join(APP_MAPS_DIR, appMapFileName(appMap))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(appMap, null, 2), "utf8")
  return target
}

export async function loadAppMap(filePath) {
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

// Finds the latest saved app map, optionally filtered by appId/platform/deviceId.
export async function findLatestAppMap(filter = {}) {
  let entries
  try {
    entries = await fs.readdir(APP_MAPS_DIR)
  } catch {
    return null
  }
  const jsonFiles = entries.filter((name) => name.endsWith(".json"))
  if (!jsonFiles.length) return null

  const withStats = await Promise.all(
    jsonFiles.map(async (name) => {
      const full = path.join(APP_MAPS_DIR, name)
      const stat = await fs.stat(full).catch(() => null)
      return stat ? { full, mtime: stat.mtimeMs } : null
    })
  )

  const sorted = withStats
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)

  for (const { full } of sorted) {
    const map = await loadAppMap(full).catch(() => null)
    if (!map) continue
    if (filter.appId && map.appId !== filter.appId) continue
    if (filter.platform && map.platform !== filter.platform) continue
    if (filter.deviceId && map.deviceId !== filter.deviceId) continue
    return { filePath: full, appMap: map }
  }
  return null
}

// Renames screens to something distinctive. Many apps repeat the same chrome
// (app title, nav bar labels) on every screen, so the first visible text is
// often useless ("Smarton" on all screens). We treat text that appears on most
// screens as chrome and pick the first screen-specific text instead.
export function assignScreenNames(appMap) {
  const screens = appMap?.screens ?? []
  if (screens.length === 0) return appMap

  const freq = new Map()
  for (const screen of screens) {
    for (const text of new Set(screen.visibleTexts ?? [])) {
      freq.set(text, (freq.get(text) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(screens.length * 0.5))
  const chrome = new Set(
    [...freq.entries()].filter(([, count]) => count >= threshold).map(([text]) => text)
  )

  // The label of the action that first opened a screen — used to name screens
  // whose own text is all shared chrome (e.g. only the app title is visible).
  const incomingLabel = new Map()
  for (const screen of screens) {
    for (const transition of screen.transitions ?? []) {
      const target = transition.toScreenId
      const label = transition.action?.label
      if (target && label && !incomingLabel.has(target)) incomingLabel.set(target, label)
    }
  }

  const used = new Map()
  screens.forEach((screen, index) => {
    // The launch screen is clearest labelled as the entry point.
    if (index === 0) {
      screen.name = "Home"
      used.set("Home", 1)
      return
    }
    const distinctive =
      (screen.visibleTexts ?? []).find((t) => t && t.length <= 40 && !chrome.has(t)) ||
      incomingLabel.get(screen.id) ||
      (screen.visibleTexts ?? []).find((t) => t && t.length <= 40) ||
      screen.name ||
      `Screen ${screen.fingerprint.slice(0, 6)}`
    // Disambiguate collisions (e.g. two list screens with the same first item).
    const seen = used.get(distinctive) ?? 0
    used.set(distinctive, seen + 1)
    screen.name = seen === 0 ? distinctive : `${distinctive} (${seen + 1})`
  })
  return appMap
}

export function summarizeAppMap(appMap) {
  const transitions = appMap.screens.reduce(
    (sum, screen) => sum + (screen.transitions?.length ?? 0),
    0
  )
  return {
    appId: appMap.appId,
    platform: appMap.platform,
    deviceId: appMap.deviceId,
    createdAt: appMap.createdAt,
    updatedAt: appMap.updatedAt,
    screenCount: appMap.screens.length,
    transitionCount: transitions,
    screens: appMap.screens.map((screen) => ({
      id: screen.id,
      name: screen.name,
      purpose: screen.purpose,
      fingerprint: screen.fingerprint,
      visibleTextCount: screen.visibleTexts?.length ?? 0,
      clickableCount: screen.clickableElements?.length ?? 0,
      transitionCount: screen.transitions?.length ?? 0
    }))
  }
}
