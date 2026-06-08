import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  addOrUpdateScreen,
  addTransition,
  APP_MAPS_DIR,
  assignScreenNames,
  createEmptyAppMap,
  findScreenByFingerprint,
  saveAppMap,
  summarizeAppMap
} from "./app-map-store.mjs"
import { createScreenFingerprint } from "./screen-fingerprint.mjs"
import { getElementLabel, getSafeClickableActions } from "./safe-actions.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOTS_DIR = path.join(__dirname, "output", "app-maps", "screenshots")
const UITREES_DIR = path.join(__dirname, "output", "app-maps", "uitrees")

// The crawler depends only on these device helpers, injected by server.mjs so we
// reuse its existing adb/Appium implementations without refactoring it.
//   deps = { dumpUi, captureScreenshot, tapElement, scrollScreen, startApp,
//            pressBack, isIosSimulator, sleep }
//
// Resume model: exploration progress is persisted *inside the app map* on each
// screen record (`fullyExplored`). A resumed scan re-walks the tree, skips
// fully-explored subtrees immediately, and continues unfinished ones — so it
// picks up where a stopped scan left off. Stop is cooperative: `shouldStop()`
// is checked before every action and between screens.

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stableFilePath(appId, platform) {
  const safeApp = String(appId || "app").replace(/[^\w.-]+/g, "_")
  return path.join(APP_MAPS_DIR, `${safeApp}-${platform}.json`)
}

async function saveScreenshot(dataUrl, fingerprint) {
  if (!dataUrl || typeof dataUrl !== "string") return null
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "")
  if (!base64) return null
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true })
  const filePath = path.join(SCREENSHOTS_DIR, `${fingerprint}.png`)
  await fs.writeFile(filePath, Buffer.from(base64, "base64"))
  return filePath
}

async function saveUiTree(uiTree, fingerprint) {
  await fs.mkdir(UITREES_DIR, { recursive: true })
  const filePath = path.join(UITREES_DIR, `${fingerprint}.json`)
  await fs.writeFile(
    filePath,
    JSON.stringify({ elements: uiTree.elements, focusedWindow: uiTree.focusedWindow }, null, 2),
    "utf8"
  )
  return filePath
}

function deriveScreenName(fp) {
  const firstText = fp.visibleTexts.find((t) => t && t.length <= 40)
  if (firstText) return firstText
  if (fp.focusedWindow) {
    const activity = fp.focusedWindow.split("/").pop()
    if (activity) return activity
  }
  return `Screen ${fp.fingerprint.slice(0, 6)}`
}

async function captureAndStore(deps, deviceId, appMap) {
  const uiTree = await deps.dumpUi(deviceId)
  const screenshotDataUrl = await deps.captureScreenshot(deviceId).catch(() => null)
  const fp = createScreenFingerprint(uiTree)

  const wasKnown = !!findScreenByFingerprint(appMap, fp.fingerprint)
  const screenshotPath = await saveScreenshot(screenshotDataUrl, fp.fingerprint).catch(() => null)
  const uiTreePath = await saveUiTree(uiTree, fp.fingerprint).catch(() => null)

  const screen = addOrUpdateScreen(appMap, {
    fingerprint: fp.fingerprint,
    name: deriveScreenName(fp),
    screenshotPath,
    uiTreePath,
    focusedWindow: fp.focusedWindow,
    visibleTexts: fp.visibleTexts,
    clickableElements: fp.clickableElements
  })

  return { screen, fp, isNew: !wasKnown }
}

export async function scanAppStructure(deps, options = {}) {
  const {
    deviceId,
    platform = "android",
    appId,
    maxDepth = 3,
    maxScreens = 30,
    maxActionsPerScreen = 8,
    waitAfterActionMs = 1200,
    avoidDangerousActions = true,
    onProgress,
    shouldStop,
    appMap: providedAppMap,
    filePath: providedFilePath
  } = options

  if (!deviceId) throw new Error("deviceId is required")
  if (!appId) throw new Error("appId is required")

  const sleep = deps.sleep ?? defaultSleep
  const events = []
  const skippedDangerous = []
  let stopped = false
  const activeStack = new Set()

  const emit = (event) => {
    events.push(event)
    if (typeof onProgress === "function") {
      try {
        onProgress(event)
      } catch {}
    }
  }

  const isStopRequested = () => {
    if (typeof shouldStop === "function" && shouldStop()) {
      stopped = true
      return true
    }
    return false
  }

  const appMap = providedAppMap ?? createEmptyAppMap({ appId, platform, deviceId })
  const filePath = providedFilePath ?? stableFilePath(appId, platform)
  const resuming = !!providedAppMap && appMap.screens.length > 0
  const persist = () => saveAppMap(filePath, appMap).catch(() => {})

  emit({ type: "launch", appId, resuming })
  await deps.startApp(deviceId, appId)
  await sleep(Math.max(1500, waitAfterActionMs))

  if (!isStopRequested()) {
    const root = await captureAndStore(deps, deviceId, appMap)
    emit({ type: "screen", screenId: root.screen.id, name: root.screen.name, isNew: root.isNew, depth: 0 })
    await persist()
    await explore(root.screen.id, root.fp, 0)
  }

  assignScreenNames(appMap)
  await persist()
  const summary = summarizeAppMap(appMap)
  emit({ type: stopped ? "stopped" : "done", filePath, summary, stopped })

  return { appMap, filePath, summary, events, skippedDangerous, stopped }

  async function explore(screenId, screenFp, depth) {
    if (depth >= maxDepth) return
    if (appMap.screens.length >= maxScreens) return
    if (isStopRequested()) return

    const record = appMap.screens.find((s) => s.id === screenId)
    if (!record) return
    if (record.fullyExplored) return
    if (activeStack.has(screenId)) return
    activeStack.add(screenId)

    const { actions, skipped } = getSafeClickableActions(
      { clickableElements: screenFp.clickableElements },
      { maxActionsPerScreen, avoidDangerousActions }
    )

    for (const item of skipped) {
      const entry = { screenId, label: item.label, reason: item.reason }
      skippedDangerous.push(entry)
      emit({ type: "skip", ...entry })
    }

    for (const action of actions) {
      if (isStopRequested()) break
      if (appMap.screens.length >= maxScreens) break

      const label = action.label || getElementLabel(action.element)
      emit({ type: "action", screenId, label, kind: action.kind })

      try {
        await deps.tapElement(deviceId, action.element)
      } catch (error) {
        emit({ type: "action-error", screenId, label, error: String(error?.message ?? error) })
        continue
      }
      await sleep(waitAfterActionMs)

      const next = await captureAndStore(deps, deviceId, appMap)

      if (next.fp.fingerprint === screenFp.fingerprint) {
        emit({ type: "no-transition", screenId, label })
        continue
      }

      addTransition(appMap, screenId, { label, elementId: action.element.id, kind: action.kind }, next.screen.id)
      emit({
        type: "transition",
        from: screenId,
        to: next.screen.id,
        name: next.screen.name,
        label,
        isNewScreen: next.isNew,
        depth: depth + 1
      })
      await persist()

      // Recurse always; explore() itself skips fully-explored / in-progress
      // screens, which is what makes resume and cycle handling correct.
      await explore(next.screen.id, next.fp, depth + 1)

      await navigateBackToFingerprint(screenFp)
    }

    activeStack.delete(screenId)
    if (!stopped) {
      record.fullyExplored = true
      await persist()
    }
  }

  async function navigateBackToFingerprint(targetFp, attempts = 2) {
    for (let i = 0; i < attempts; i++) {
      if (isStopRequested()) return false
      await deps.pressBack(deviceId)
      await sleep(waitAfterActionMs)
      const uiTree = await deps.dumpUi(deviceId).catch(() => null)
      if (!uiTree) continue
      const fp = createScreenFingerprint(uiTree)
      if (fp.fingerprint === targetFp.fingerprint) return true
    }
    return false
  }
}
