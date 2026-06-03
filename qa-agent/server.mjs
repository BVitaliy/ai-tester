import { execFile, spawn } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { URL } from "node:url"

const HOST = process.env.QA_AGENT_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QA_AGENT_PORT ?? 17321)
const APPIUM_HOST = process.env.APPIUM_HOST ?? "127.0.0.1"
const APPIUM_PORT = Number(process.env.APPIUM_PORT ?? 4723)
const APPIUM_URL = `http://${APPIUM_HOST}:${APPIUM_PORT}`
const DEFAULT_ANDROID_HOME = path.join(os.homedir(), "Library", "Android", "sdk")
const ANDROID_HOME = process.env.ANDROID_HOME || DEFAULT_ANDROID_HOME

process.env.ANDROID_HOME = ANDROID_HOME
process.env.PATH = [
  path.join(ANDROID_HOME, "platform-tools"),
  path.join(ANDROID_HOME, "emulator"),
  process.env.PATH ?? ""
].join(path.delimiter)

const activeScreenRecordings = new Map()
const activeActionRecordings = new Map()
const activeAppiumSessions = new Map()
const lastStartedApps = new Map()
let appiumServerProcess = null

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"))
        req.destroy()
      }
    })
    req.on("end", () => {
      if (!data) resolve({})
      else {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error("Invalid JSON body"))
        }
      }
    })
    req.on("error", reject)
  })
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000, ...options }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(stderr?.trim() || error.message)
        wrapped.code = error.code
        reject(wrapped)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function runBuffer(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 20000, encoding: "buffer", maxBuffer: 50 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          const wrapped = new Error(stderr?.toString()?.trim() || error.message)
          wrapped.code = error.code
          reject(wrapped)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

async function hasCommand(command, args = ["--version"], options = {}) {
  try {
    await run(command, args, { timeout: 4000, ...options })
    return true
  } catch {
    return false
  }
}

function parseAdbDevices(output) {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, state, ...rest] = line.split(/\s+/)
      const details = Object.fromEntries(
        rest
          .map((item) => item.split(":"))
          .filter(([key, value]) => key && value)
          .map(([key, value]) => [key, value])
      )
      return {
        id,
        name: details.model || id,
        state,
        type: id.startsWith("emulator-") ? "emulator" : "usb",
        details
      }
    })
}

function parsePackages(output) {
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^package:/, ""))
    .filter(Boolean)
    .map((packageName) => ({ packageName, label: packageName }))
}

function parseIosApps(output) {
  const apps = []
  const blockRe = /"([^"]+)"\s*=\s*\{([\s\S]*?)\n\s{4}\};/g
  let match

  while ((match = blockRe.exec(output))) {
    const [, bundleId, block] = match
    if (!/ApplicationType\s*=\s*User;/.test(block)) continue
    const displayName =
      block.match(/CFBundleDisplayName\s*=\s*"([^"]+)";/)?.[1] ??
      block.match(/CFBundleDisplayName\s*=\s*([^;\n]+);/)?.[1]?.trim() ??
      block.match(/CFBundleName\s*=\s*"([^"]+)";/)?.[1] ??
      block.match(/CFBundleName\s*=\s*([^;\n]+);/)?.[1]?.trim() ??
      bundleId
    apps.push({ packageName: bundleId, label: displayName })
  }

  return apps.sort((a, b) => a.label.localeCompare(b.label))
}

async function listConnectedDevices() {
  try {
    const { stdout } = await run("adb", ["devices", "-l"])
    return parseAdbDevices(stdout)
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

async function listAvailableEmulators() {
  try {
    const { stdout } = await run("emulator", ["-list-avds"])
    return stdout
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }))
  } catch {
    return []
  }
}

async function listIosSimulators({ bootedOnly = false } = {}) {
  try {
    const args = ["simctl", "list", "devices"]
    if (bootedOnly) args.push("booted")
    args.push("-j")
    const { stdout } = await run("xcrun", args, { maxBuffer: 10 * 1024 * 1024 })
    const data = JSON.parse(stdout)
    const result = []

    for (const [runtime, devices] of Object.entries(data.devices ?? {})) {
      for (const device of devices) {
        if (!device.isAvailable) continue
        if (bootedOnly && device.state !== "Booted") continue
        result.push({
          id: device.udid,
          name: device.name,
          state: device.state,
          type: "simulator",
          platform: "ios",
          details: { runtime }
        })
      }
    }

    return result
  } catch {
    return []
  }
}

async function isIosSimulator(deviceId) {
  if (!deviceId) return false
  const simulators = await listIosSimulators()
  return simulators.some((device) => device.id === deviceId)
}

async function getIosSimulator(deviceId) {
  if (!deviceId) return null
  const simulators = await listIosSimulators()
  return simulators.find((device) => device.id === deviceId) ?? null
}

function adbArgs(deviceId, args) {
  return deviceId ? ["-s", deviceId, ...args] : args
}

function requireDeviceId(deviceId) {
  if (!deviceId) throw new Error("deviceId is required")
}

function decodeXml(value = "") {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function parseBounds(bounds = "") {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!match) return null
  const [, x1, y1, x2, y2] = match.map(Number)
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
    centerX: Math.round((x1 + x2) / 2),
    centerY: Math.round((y1 + y2) / 2),
    raw: bounds
  }
}

function parseUiElements(xml) {
  const elements = []
  const nodeRe = /<node\b([^>]*)\/>/g
  let match

  while ((match = nodeRe.exec(xml))) {
    const attrs = {}
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = decodeXml(attr[2])
    }

    const text = attrs.text ?? ""
    const contentDesc = attrs["content-desc"] ?? ""
    const resourceId = attrs["resource-id"] ?? ""
    const clickable = attrs.clickable === "true"
    const enabled = attrs.enabled !== "false"
    const focusable = attrs.focusable === "true"
    const bounds = parseBounds(attrs.bounds)

    if (!bounds) continue
    if (!text && !contentDesc && !resourceId && !clickable && !focusable) continue

    const id = `${elements.length + 1}`
    const label = text || contentDesc || resourceId || attrs.class || `Element ${id}`

    elements.push({
      id,
      text,
      contentDesc,
      resourceId,
      className: attrs.class ?? "",
      packageName: attrs.package ?? "",
      clickable,
      enabled,
      focusable,
      bounds,
      label
    })
  }

  return elements
}

function parseIosElements(xml) {
  const elements = []
  const nodeRe = /<XCUIElementType[\w]+\b([^>]*)>/g
  let match

  while ((match = nodeRe.exec(xml))) {
    const attrs = {}
    for (const attr of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = decodeXml(attr[2])
    }

    const type = attrs.type ?? ""
    const label = attrs.label || attrs.name || attrs.value || type || `Element ${elements.length + 1}`
    const x = Number(attrs.x)
    const y = Number(attrs.y)
    const width = Number(attrs.width)
    const height = Number(attrs.height)
    const hasBounds = [x, y, width, height].every(Number.isFinite)
    const enabled = attrs.enabled !== "false"
    const visible = attrs.visible !== "false"
    const accessible = attrs.accessible === "true"
    const clickable =
      accessible ||
      /Button|Cell|Link|TextField|SecureTextField|Switch|Slider|Picker|Image|StaticText/.test(type)

    if (!hasBounds || width <= 0 || height <= 0) continue
    if (!visible && !accessible && !attrs.name && !attrs.label && !attrs.value) continue

    const id = `${elements.length + 1}`
    elements.push({
      id,
      text: attrs.value ?? "",
      contentDesc: attrs.label || attrs.name || "",
      resourceId: attrs.name ?? "",
      className: type,
      packageName: "",
      clickable,
      enabled,
      focusable: clickable,
      bounds: {
        x,
        y,
        width,
        height,
        centerX: Math.round(x + width / 2),
        centerY: Math.round(y + height / 2),
        raw: `[${x},${y}][${x + width},${y + height}]`
      },
      label
    })
  }

  return elements
}

async function getFocusedWindow(deviceId) {
  try {
    const { stdout } = await run("adb", adbArgs(deviceId, ["shell", "dumpsys", "window", "windows"]))
    const line =
      stdout
        .split("\n")
        .find((item) => item.includes("mCurrentFocus") || item.includes("mFocusedApp")) ?? ""
    return line.trim()
  } catch {
    return ""
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function appiumRequest(method, pathname, body, timeoutMs = 15000) {
  const res = await fetchWithTimeout(`${APPIUM_URL}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = data?.value?.message ?? data?.message ?? `Appium request failed: ${res.status}`
    throw new Error(message)
  }
  return data.value ?? data
}

async function isAppiumReady() {
  try {
    await appiumRequest("GET", "/status", undefined, 3000)
    return true
  } catch {
    return false
  }
}

async function ensureAppiumServer() {
  if (await isAppiumReady()) return
  if (!appiumServerProcess || appiumServerProcess.exitCode !== null) {
    appiumServerProcess = spawn("appium", [
      "--address",
      APPIUM_HOST,
      "--port",
      String(APPIUM_PORT),
      "--base-path",
      "/"
    ], {
      stdio: "ignore"
    })
    appiumServerProcess.unref()
  }

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await isAppiumReady()) return
    await sleep(600)
  }
  throw new Error("Appium server did not become ready")
}

function appiumSessionKey(deviceId, bundleId) {
  return `${deviceId}:${bundleId || ""}`
}

async function createIosAppiumSession(deviceId, bundleId) {
  await ensureAppiumServer()
  const simulator = await getIosSimulator(deviceId)
  const capabilities = {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": deviceId,
    "appium:deviceName": simulator?.name ?? "iOS Simulator",
    "appium:noReset": true,
    "appium:newCommandTimeout": 180,
    "appium:connectHardwareKeyboard": false,
    "appium:shouldTerminateApp": false
  }
  if (bundleId) capabilities["appium:bundleId"] = bundleId

  const value = await appiumRequest("POST", "/session", {
    capabilities: {
      alwaysMatch: capabilities,
      firstMatch: [{}]
    }
  }, 180000)
  const sessionId = value.sessionId ?? value?.value?.sessionId
  if (!sessionId) throw new Error("Appium did not return a sessionId")
  return { sessionId, deviceId, bundleId, createdAt: Date.now() }
}

async function getIosAppiumSession(deviceId, bundleId = "") {
  const key = appiumSessionKey(deviceId, bundleId)
  const existing = activeAppiumSessions.get(key)
  if (existing) return existing
  const session = await createIosAppiumSession(deviceId, bundleId)
  activeAppiumSessions.set(key, session)
  return session
}

async function deleteAppiumSession(session) {
  if (!session?.sessionId) return
  await appiumRequest("DELETE", `/session/${session.sessionId}`, undefined, 8000).catch(() => {})
  activeAppiumSessions.delete(appiumSessionKey(session.deviceId, session.bundleId))
}

async function withIosAppiumSession(deviceId, fn) {
  const bundleId = lastStartedApps.get(deviceId) ?? ""
  let session = await getIosAppiumSession(deviceId, bundleId)
  try {
    return await fn(session)
  } catch (error) {
    await deleteAppiumSession(session)
    session = await getIosAppiumSession(deviceId, bundleId)
    return fn(session)
  }
}

async function dumpIosUi(deviceId) {
  return withIosAppiumSession(deviceId, async (session) => {
    const xml = await appiumRequest("GET", `/session/${session.sessionId}/source`, undefined, 60000)
    return {
      xml,
      elements: parseIosElements(xml),
      focusedWindow: lastStartedApps.get(deviceId) ?? ""
    }
  })
}

async function tapIosElement(deviceId, element) {
  if (!element?.bounds) throw new Error("element bounds are required")
  return withIosAppiumSession(deviceId, async (session) => {
    await appiumRequest("POST", `/session/${session.sessionId}/execute/sync`, {
      script: "mobile: tap",
      args: [{ x: element.bounds.centerX, y: element.bounds.centerY }]
    }, 20000)
  })
}

async function captureScreenshot(deviceId) {
  requireDeviceId(deviceId)
  if (await isIosSimulator(deviceId)) {
    const { stdout } = await runBuffer("xcrun", ["simctl", "io", deviceId, "screenshot", "-"])
    return `data:image/png;base64,${Buffer.from(stdout).toString("base64")}`
  }
  const { stdout } = await runBuffer("adb", adbArgs(deviceId, ["exec-out", "screencap", "-p"]))
  return `data:image/png;base64,${Buffer.from(stdout).toString("base64")}`
}

async function dumpUi(deviceId) {
  requireDeviceId(deviceId)
  if (await isIosSimulator(deviceId)) {
    return dumpIosUi(deviceId)
  }
  const remotePath = `/sdcard/window-${Date.now()}.xml`
  await run("adb", adbArgs(deviceId, ["shell", "uiautomator", "dump", remotePath]))
  const { stdout } = await run("adb", adbArgs(deviceId, ["exec-out", "cat", remotePath]), {
    maxBuffer: 10 * 1024 * 1024
  })
  await run("adb", adbArgs(deviceId, ["shell", "rm", "-f", remotePath])).catch(() => {})
  return {
    xml: stdout,
    elements: parseUiElements(stdout),
    focusedWindow: await getFocusedWindow(deviceId)
  }
}

async function tapElement(deviceId, element) {
  requireDeviceId(deviceId)
  if (await isIosSimulator(deviceId)) {
    await tapIosElement(deviceId, element)
    return
  }
  if (!element?.bounds) throw new Error("element bounds are required")
  await run("adb", adbArgs(deviceId, [
    "shell",
    "input",
    "tap",
    String(element.bounds.centerX),
    String(element.bounds.centerY)
  ]))
}

function escapeAdbText(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\s/g, "%s")
    .replace(/[&|;<>()$`"'*?[#~=%]/g, "\\$&")
}

async function typeText(deviceId, value) {
  requireDeviceId(deviceId)
  if (await isIosSimulator(deviceId)) {
    await withIosAppiumSession(deviceId, async (session) => {
      await appiumRequest("POST", `/session/${session.sessionId}/keys`, {
        text: String(value ?? ""),
        value: Array.from(String(value ?? ""))
      }, 20000)
    })
    return
  }
  await run("adb", adbArgs(deviceId, ["shell", "input", "text", escapeAdbText(value)]))
}

function recordingKey(deviceId) {
  return deviceId || "default"
}

async function startScreenRecording(deviceId) {
  requireDeviceId(deviceId)
  const key = recordingKey(deviceId)
  if (activeScreenRecordings.has(key)) throw new Error("screen recording already active")

  if (await isIosSimulator(deviceId)) {
    const localPath = path.join(os.tmpdir(), `qa-agent-ios-recording-${Date.now()}.mp4`)
    const child = spawn("xcrun", ["simctl", "io", deviceId, "recordVideo", localPath], {
      stdio: "ignore"
    })

    activeScreenRecordings.set(key, {
      child,
      localPath,
      platform: "ios",
      startedAt: Date.now()
    })

    child.on("exit", () => {
      const active = activeScreenRecordings.get(key)
      if (active?.child === child) active.exited = true
    })

    return { localPath }
  }

  const remotePath = `/sdcard/qa-agent-recording-${Date.now()}.mp4`
  const child = spawn("adb", adbArgs(deviceId, [
    "shell",
    "screenrecord",
    "--time-limit",
    "180",
    remotePath
  ]), {
    stdio: "ignore"
  })

  activeScreenRecordings.set(key, {
    child,
    remotePath,
    platform: "android",
    startedAt: Date.now()
  })

  child.on("exit", () => {
    const active = activeScreenRecordings.get(key)
    if (active?.child === child) active.exited = true
  })

  return { remotePath }
}

async function stopScreenRecording(deviceId) {
  requireDeviceId(deviceId)
  const key = recordingKey(deviceId)
  const active = activeScreenRecordings.get(key)
  if (!active) throw new Error("screen recording is not active")

  if (!active.exited) {
    active.child.kill("SIGINT")
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  if (active.platform === "ios") {
    const data = await fs.readFile(active.localPath)
    await fs.unlink(active.localPath).catch(() => {})
    activeScreenRecordings.delete(key)

    return {
      mimeType: "video/mp4",
      dataUrl: `data:video/mp4;base64,${data.toString("base64")}`,
      durationMs: Date.now() - active.startedAt
    }
  }

  const localPath = path.join(os.tmpdir(), `qa-agent-recording-${Date.now()}.mp4`)
  await run("adb", adbArgs(deviceId, ["pull", active.remotePath, localPath]), {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024
  })
  await run("adb", adbArgs(deviceId, ["shell", "rm", "-f", active.remotePath])).catch(() => {})
  activeScreenRecordings.delete(key)

  const data = await fs.readFile(localPath)
  await fs.unlink(localPath).catch(() => {})

  return {
    mimeType: "video/mp4",
    dataUrl: `data:video/mp4;base64,${data.toString("base64")}`,
    durationMs: Date.now() - active.startedAt
  }
}

async function startActionRecording(deviceId) {
  requireDeviceId(deviceId)
  const key = recordingKey(deviceId)
  if (activeActionRecordings.has(key)) throw new Error("action recording already active")
  const before = await dumpUi(deviceId)
  activeActionRecordings.set(key, {
    startedAt: Date.now(),
    before
  })
  return {
    startedAt: activeActionRecordings.get(key).startedAt,
    beforeElementCount: before.elements.length,
    focusedWindow: before.focusedWindow
  }
}

async function stopActionRecording(deviceId) {
  requireDeviceId(deviceId)
  const key = recordingKey(deviceId)
  const active = activeActionRecordings.get(key)
  if (!active) throw new Error("action recording is not active")

  const after = await dumpUi(deviceId)
  const screenshotDataUrl = await captureScreenshot(deviceId).catch(() => null)
  activeActionRecordings.delete(key)

  const beforeLabels = new Set(active.before.elements.map((element) => element.label).filter(Boolean))
  const newElements = after.elements
    .filter((element) => element.label && !beforeLabels.has(element.label))
    .slice(0, 12)

  return {
    startedAt: active.startedAt,
    stoppedAt: Date.now(),
    durationMs: Date.now() - active.startedAt,
    beforeElementCount: active.before.elements.length,
    afterElementCount: after.elements.length,
    beforeFocusedWindow: active.before.focusedWindow,
    afterFocusedWindow: after.focusedWindow,
    newElements,
    screenshotDataUrl
  }
}

async function listApps(deviceId) {
  if (await isIosSimulator(deviceId)) {
    const { stdout } = await run("xcrun", ["simctl", "listapps", deviceId], {
      maxBuffer: 25 * 1024 * 1024
    })
    return parseIosApps(stdout)
  }

  const { stdout } = await run("adb", adbArgs(deviceId, ["shell", "pm", "list", "packages", "-3"]))
  return parsePackages(stdout)
}

async function startApp(deviceId, packageName) {
  if (await isIosSimulator(deviceId)) {
    await run("xcrun", ["simctl", "launch", deviceId, packageName])
    lastStartedApps.set(deviceId, packageName)
    return
  }

  await run("adb", adbArgs(deviceId, [
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1"
  ]))
  lastStartedApps.set(deviceId, packageName)
}

async function startEmulator(name) {
  const child = spawn("emulator", ["-avd", name], {
    detached: true,
    stdio: "ignore"
  })
  child.unref()
}

async function startIosSimulator(deviceId) {
  await run("xcrun", ["simctl", "boot", deviceId]).catch((error) => {
    if (!String(error.message).includes("Unable to boot device in current state: Booted")) {
      throw error
    }
  })
  await run("open", ["-a", "Simulator"]).catch(() => {})
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const IDEA_STOP_WORDS = new Set([
  "test",
  "case",
  "should",
  "check",
  "verify",
  "user",
  "flow",
  "app",
  "application",
  "screen",
  "button",
  "field",
  "перевір",
  "перевірити",
  "користувач",
  "додаток",
  "екран",
  "кнопка",
  "поле",
  "має",
  "повинен",
  "повинна",
  "після",
  "коли",
  "для",
  "щоб",
  "with",
  "from",
  "that",
  "this",
  "when",
  "after"
])

function textTokens(value = "") {
  return Array.from(
    new Set(
      normalizeSearchText(value)
        .replace(/[^\p{L}\p{N}_-]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !IDEA_STOP_WORDS.has(token))
    )
  ).slice(0, 16)
}

function result(id, title, status, details = {}) {
  return {
    id,
    title,
    status,
    message: details.message ?? "",
    evidence: details.evidence ?? [],
    error: details.error
  }
}

function summarizeResults(results) {
  return {
    passed: results.filter((item) => item.status === "passed").length,
    failed: results.filter((item) => item.status === "failed").length,
    blocked: results.filter((item) => item.status === "blocked").length
  }
}

function evaluateIdeaAgainstUi(idea, ui) {
  const text = typeof idea === "string" ? idea : idea?.text ?? ""
  const id = typeof idea === "object" && idea?.id ? idea.id : `idea-${Math.random().toString(36).slice(2)}`
  const tokens = textTokens(text)
  const searchableElements = (ui?.elements ?? []).map((element) => ({
    label: [
      element.label,
      element.text,
      element.contentDesc,
      element.resourceId,
      element.className
    ].filter(Boolean).join(" "),
    element
  }))
  const haystack = searchableElements.map((item) => item.label.toLowerCase()).join("\n")
  const matchedTokens = tokens.filter((token) => haystack.includes(token))
  const evidence = searchableElements
    .filter((item) => matchedTokens.some((token) => item.label.toLowerCase().includes(token)))
    .slice(0, 5)
    .map((item) => item.element.label)
    .filter(Boolean)

  if (tokens.length === 0) {
  return result(id, text || "Untitled mobile idea", "blocked", {
      message: "Not executed: idea is too broad. Add visible text, accessibility id, or record the flow.",
      evidence
    })
  }

  const requiredMatches = Math.max(1, Math.min(3, Math.ceil(tokens.length * 0.3)))
  if (matchedTokens.length >= requiredMatches) {
    return result(id, text, "passed", {
      message: `Found current-screen UI evidence for: ${matchedTokens.join(", ")}`,
      evidence
    })
  }

  return result(id, text, "blocked", {
    message: "Not executed automatically: no matching current-screen UI evidence. Record this flow or add stable selectors.",
    evidence
  })
}

function elementSearchText(element) {
  return normalizeSearchText([
    element.label,
    element.text,
    element.contentDesc,
    element.resourceId,
    element.className
  ].filter(Boolean).join(" "))
}

function normalizeSearchText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/\*/g, "")
    .replace(/[“”«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function targetAlternatives(target = "") {
  const normalized = normalizeSearchText(target)
  const alternatives = new Set([normalized])

  for (const part of normalized.split(/[\/|,;]/g)) {
    const clean = normalizeSearchText(part)
    if (clean) alternatives.add(clean)
  }

  const add = (...values) => values.forEach((value) => {
    const clean = normalizeSearchText(value)
    if (clean) alternatives.add(clean)
  })

  if (/(user|profile|account|профіль|акаунт|користувач|юзер)/i.test(normalized)) {
    add("user", "profile", "account", "профіль", "акаунт", "користувач")
  }
  if (/(вхід|увійти|логін|login|sign in)/i.test(normalized)) {
    add("увійти", "вхід", "логін", "login", "sign in")
  }
  if (/(реєстрац|зареєстр|register|sign up)/i.test(normalized)) {
    add("зареєструватись", "зареєструватися", "реєстрація", "register", "sign up")
  }
  if (/(підтвердження пароля|confirm password|повтор)/i.test(normalized)) {
    add("повторіть пароль", "підтвердження пароля", "confirm password")
  }
  if (/(погод|правил|terms|privacy)/i.test(normalized)) {
    add("я погоджуюсь", "погоджуюсь", "правилами користування", "правила", "terms", "privacy")
  }
  if (/(домівка|home|головна)/i.test(normalized)) {
    add("домівка", "головна", "home")
  }

  return Array.from(alternatives).filter(Boolean)
}

function findElementByTarget(ui, target = "") {
  const alternatives = targetAlternatives(target)
  if (!alternatives.length) return null
  const elements = ui?.elements ?? []
  for (const normalized of alternatives) {
    const exact = elements.find((element) =>
      [element.label, element.text, element.contentDesc, element.resourceId]
        .filter(Boolean)
        .some((value) => normalizeSearchText(value) === normalized)
    )
    if (exact) return exact
  }

  for (const normalized of alternatives) {
    const contains = elements.find((element) => elementSearchText(element).includes(normalized))
    if (contains) return contains
  }

  const tokens = textTokens(alternatives.join(" "))
  if (!tokens.length) return null
  const scored = elements
    .map((element) => ({
      element,
      score: tokens.filter((token) => elementSearchText(element).includes(token)).length
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.element ?? null
}

async function waitForElement(deviceId, target, timeoutMs = 10000, shouldExist = true) {
  const deadline = Date.now() + Math.max(500, timeoutMs)
  let lastUi = null
  let lastElement = null

  while (Date.now() <= deadline) {
    lastUi = await dumpUi(deviceId)
    lastElement = findElementByTarget(lastUi, target)
    if (shouldExist && lastElement) return { ui: lastUi, element: lastElement }
    if (!shouldExist && !lastElement) return { ui: lastUi, element: null }
    await sleep(500)
  }

  return { ui: lastUi, element: lastElement }
}

async function executeMobileStep(deviceId, step) {
  const startedAt = Date.now()
  const id = step.id || `step-${startedAt}`
  const title = step.description || `${step.action} ${step.target ?? ""}`.trim()
  const timeoutMs = Number(step.timeoutMs ?? 10000)

  try {
    if (step.action === "wait") {
      await sleep(Math.max(0, Math.min(timeoutMs, 30000)))
      return result(id, title, "passed", { message: `Waited ${timeoutMs}ms` })
    }

    if (step.action === "assertVisible") {
      const { element } = await waitForElement(deviceId, step.target, timeoutMs, true)
      if (!element) {
        return result(id, title, "failed", {
          message: `Expected visible target was not found: ${step.target}`
        })
      }
      return result(id, title, "passed", {
        message: `Found visible target: ${step.target}`,
        evidence: [element.label].filter(Boolean)
      })
    }

    if (step.action === "assertNotVisible") {
      const { element } = await waitForElement(deviceId, step.target, timeoutMs, false)
      if (element) {
        return result(id, title, "failed", {
          message: `Target is still visible: ${step.target}`,
          evidence: [element.label].filter(Boolean)
        })
      }
      return result(id, title, "passed", {
        message: `Target is not visible: ${step.target}`
      })
    }

    if (step.action === "tap" || step.action === "input") {
      const { element } = await waitForElement(deviceId, step.target, timeoutMs, true)
      if (!element) {
        return result(id, title, "failed", {
          message: `Target was not found: ${step.target}`
        })
      }
      await tapElement(deviceId, element)
      if (step.action === "input") {
        await sleep(300)
        await typeText(deviceId, step.value ?? "")
      }
      return result(id, title, "passed", {
        message: step.action === "input"
          ? `Typed into target: ${step.target}`
          : `Tapped target: ${step.target}`,
        evidence: [element.label].filter(Boolean)
      })
    }

    return result(id, title, "blocked", {
      message: `Unsupported step action: ${step.action}`
    })
  } catch (error) {
    return result(id, title, "failed", {
      message: `Step failed: ${step.action}`,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function runMobileSteps({ deviceId, packageName, steps = [] }) {
  requireDeviceId(deviceId)
  if (!packageName) throw new Error("packageName is required")

  const startedAt = Date.now()
  const platform = (await isIosSimulator(deviceId)) ? "ios" : "android"
  const results = []
  let screenshotDataUrl = null
  let ui = null
  let launchOk = false

  try {
    await startApp(deviceId, packageName)
    await sleep(1200)
    launchOk = true
    results.push(result("launch-app", "Launch selected app", "passed", {
      message: `${packageName} launched on ${platform}`
    }))
  } catch (error) {
    results.push(result("launch-app", "Launch selected app", "failed", {
      message: "Could not launch selected app",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  if (!launchOk) {
    for (const step of steps) {
      results.push(result(step.id || `step-${results.length}`, step.description || `${step.action} ${step.target ?? ""}`.trim(), "blocked", {
        message: "Not executed because the selected app did not launch."
      }))
    }
    const finishedAt = Date.now()
    return {
      ok: true,
      platform,
      packageName,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      focusedWindow: "",
      elementCount: 0,
      screenshotDataUrl,
      results,
      summary: summarizeResults(results)
    }
  }

  try {
    ui = await dumpUi(deviceId)
    results.push(result("read-ui-tree", "Read UI tree", ui.elements.length > 0 ? "passed" : "failed", {
      message: ui.elements.length > 0
        ? `Read ${ui.elements.length} UI elements via ${platform === "ios" ? "Appium XCUITest" : "Android uiautomator"}`
        : "UI tree is empty",
      evidence: ui.elements.slice(0, 8).map((element) => element.label).filter(Boolean)
    }))
  } catch (error) {
    results.push(result("read-ui-tree", "Read UI tree", "failed", {
      message: "Could not read UI tree",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  for (const step of steps) {
    results.push(await executeMobileStep(deviceId, step))
  }

  try {
    screenshotDataUrl = await captureScreenshot(deviceId)
    results.push(result("capture-screenshot", "Capture final screenshot", "passed", {
      message: "Final screenshot captured"
    }))
  } catch (error) {
    results.push(result("capture-screenshot", "Capture final screenshot", "failed", {
      message: "Could not capture final screenshot",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  const finishedAt = Date.now()
  return {
    ok: true,
    platform,
    packageName,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    focusedWindow: ui?.focusedWindow ?? "",
    elementCount: ui?.elements?.length ?? 0,
    screenshotDataUrl,
    results,
    summary: summarizeResults(results)
  }
}

async function runMobileTests({ deviceId, packageName, ideas = [] }) {
  requireDeviceId(deviceId)
  if (!packageName) throw new Error("packageName is required")

  const startedAt = Date.now()
  const platform = (await isIosSimulator(deviceId)) ? "ios" : "android"
  const results = []
  let screenshotDataUrl = null
  let ui = null

  try {
    await startApp(deviceId, packageName)
    await sleep(1800)
    results.push(result("launch-app", "Launch selected app", "passed", {
      message: `${packageName} launched on ${platform}`
    }))
  } catch (error) {
    results.push(result("launch-app", "Launch selected app", "failed", {
      message: "Could not launch selected app",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  try {
    screenshotDataUrl = await captureScreenshot(deviceId)
    results.push(result("capture-screenshot", "Capture app screenshot", "passed", {
      message: "Screenshot captured"
    }))
  } catch (error) {
    results.push(result("capture-screenshot", "Capture app screenshot", "failed", {
      message: "Could not capture screenshot",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  try {
    ui = await dumpUi(deviceId)
    results.push(result("read-ui-tree", "Read UI tree", ui.elements.length > 0 ? "passed" : "failed", {
      message: ui.elements.length > 0
        ? `Read ${ui.elements.length} UI elements via ${platform === "ios" ? "Appium XCUITest" : "Android uiautomator"}`
        : "UI tree is empty",
      evidence: ui.elements.slice(0, 8).map((element) => element.label).filter(Boolean)
    }))
  } catch (error) {
    results.push(result("read-ui-tree", "Read UI tree", "blocked", {
      message: platform === "ios"
        ? "Could not read iOS UI tree through Appium XCUITest yet."
        : "Could not read Android UI tree.",
      error: error instanceof Error ? error.message : String(error)
    }))
  }

  for (const idea of ideas) {
    const title = typeof idea === "string" ? idea : idea?.text ?? "Untitled mobile idea"
    if (!ui) {
      results.push(result(typeof idea === "object" && idea?.id ? idea.id : `idea-${results.length}`, title, "blocked", {
        message: platform === "ios"
          ? "Not executed: Appium XCUITest UI tree was not available for this run."
          : "Not executed: UI tree was not available."
      }))
      continue
    }
    results.push(evaluateIdeaAgainstUi(idea, ui))
  }

  const finishedAt = Date.now()
  return {
    ok: true,
    platform,
    packageName,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    focusedWindow: ui?.focusedWindow ?? "",
    elementCount: ui?.elements?.length ?? 0,
    screenshotDataUrl,
    results,
    summary: summarizeResults(results)
  }
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {})
    return
  }

  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`)

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const [adb, emulator] = await Promise.all([
        hasCommand("adb", ["version"]),
        hasCommand("emulator", ["-version"])
      ])
      json(res, 200, {
        ok: true,
        version: "0.1.0",
        adb,
        emulator,
        appium: await hasCommand("appium", ["--version"], { timeout: 12000 })
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/devices") {
      const [androidDevices, iosBootedSimulators, availableEmulators, availableIosSimulators] = await Promise.all([
        listConnectedDevices(),
        listIosSimulators({ bootedOnly: true }),
        listAvailableEmulators(),
        listIosSimulators()
      ])
      json(res, 200, {
        connected: [
          ...androidDevices.map((device) => ({ ...device, platform: "android" })),
          ...iosBootedSimulators
        ],
        availableEmulators,
        availableIosSimulators
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/apps") {
      const deviceId = url.searchParams.get("deviceId") ?? ""
      json(res, 200, { apps: await listApps(deviceId) })
      return
    }

    if (req.method === "POST" && url.pathname === "/apps/start") {
      const body = await readBody(req)
      if (!body.packageName) {
        json(res, 400, { ok: false, error: "packageName is required" })
        return
      }
      await startApp(body.deviceId ?? "", body.packageName)
      json(res, 200, { ok: true })
      return
    }

    if (req.method === "POST" && url.pathname === "/capture/screenshot") {
      const body = await readBody(req)
      json(res, 200, {
        ok: true,
        dataUrl: await captureScreenshot(body.deviceId ?? "")
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/ui/elements") {
      const deviceId = url.searchParams.get("deviceId") ?? ""
      json(res, 200, await dumpUi(deviceId))
      return
    }

    if (req.method === "POST" && url.pathname === "/ui/tap") {
      const body = await readBody(req)
      await tapElement(body.deviceId ?? "", body.element)
      json(res, 200, { ok: true })
      return
    }

    if (req.method === "POST" && url.pathname === "/screenrecord/start") {
      const body = await readBody(req)
      json(res, 200, { ok: true, ...(await startScreenRecording(body.deviceId ?? "")) })
      return
    }

    if (req.method === "POST" && url.pathname === "/screenrecord/stop") {
      const body = await readBody(req)
      json(res, 200, { ok: true, ...(await stopScreenRecording(body.deviceId ?? "")) })
      return
    }

    if (req.method === "POST" && url.pathname === "/actions/start") {
      const body = await readBody(req)
      json(res, 200, { ok: true, ...(await startActionRecording(body.deviceId ?? "")) })
      return
    }

    if (req.method === "POST" && url.pathname === "/actions/stop") {
      const body = await readBody(req)
      json(res, 200, { ok: true, ...(await stopActionRecording(body.deviceId ?? "")) })
      return
    }

    if (req.method === "POST" && url.pathname === "/emulators/start") {
      const body = await readBody(req)
      if (!body.name) {
        json(res, 400, { ok: false, error: "name is required" })
        return
      }
      await startEmulator(body.name)
      json(res, 200, { ok: true })
      return
    }

    if (req.method === "POST" && url.pathname === "/simulators/ios/start") {
      const body = await readBody(req)
      if (!body.deviceId) {
        json(res, 400, { ok: false, error: "deviceId is required" })
        return
      }
      await startIosSimulator(body.deviceId)
      json(res, 200, { ok: true })
      return
    }

    if (req.method === "POST" && url.pathname === "/tests/mobile/run") {
      const body = await readBody(req)
      json(res, 200, await runMobileTests({
        deviceId: body.deviceId ?? "",
        packageName: body.packageName ?? "",
        ideas: Array.isArray(body.ideas) ? body.ideas : []
      }))
      return
    }

    if (req.method === "POST" && url.pathname === "/tests/mobile/steps") {
      const body = await readBody(req)
      json(res, 200, await runMobileSteps({
        deviceId: body.deviceId ?? "",
        packageName: body.packageName ?? "",
        steps: Array.isArray(body.steps) ? body.steps : []
      }))
      return
    }

    json(res, 404, { ok: false, error: "Not found" })
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const server = http.createServer(route)

server.listen(PORT, HOST, () => {
  console.log(`[qa-agent] listening on http://${HOST}:${PORT}`)
})
