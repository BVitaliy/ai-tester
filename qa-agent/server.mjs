import { execFile, spawn } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { URL } from "node:url"

const HOST = process.env.QA_AGENT_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QA_AGENT_PORT ?? 17321)
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

async function hasCommand(command, args = ["--version"]) {
  try {
    await run(command, args, { timeout: 4000 })
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

async function captureScreenshot(deviceId) {
  requireDeviceId(deviceId)
  const { stdout } = await runBuffer("adb", adbArgs(deviceId, ["exec-out", "screencap", "-p"]))
  return `data:image/png;base64,${Buffer.from(stdout).toString("base64")}`
}

async function dumpUi(deviceId) {
  requireDeviceId(deviceId)
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
  if (!element?.bounds) throw new Error("element bounds are required")
  await run("adb", adbArgs(deviceId, [
    "shell",
    "input",
    "tap",
    String(element.bounds.centerX),
    String(element.bounds.centerY)
  ]))
}

function recordingKey(deviceId) {
  return deviceId || "default"
}

function startScreenRecording(deviceId) {
  requireDeviceId(deviceId)
  const key = recordingKey(deviceId)
  if (activeScreenRecordings.has(key)) throw new Error("screen recording already active")

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
  const { stdout } = await run("adb", adbArgs(deviceId, ["shell", "pm", "list", "packages", "-3"]))
  return parsePackages(stdout)
}

async function startApp(deviceId, packageName) {
  await run("adb", adbArgs(deviceId, [
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1"
  ]))
}

async function startEmulator(name) {
  const child = spawn("emulator", ["-avd", name], {
    detached: true,
    stdio: "ignore"
  })
  child.unref()
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
        appium: await hasCommand("appium", ["--version"])
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/devices") {
      const [connected, availableEmulators] = await Promise.all([
        listConnectedDevices(),
        listAvailableEmulators()
      ])
      json(res, 200, { connected, availableEmulators })
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
      json(res, 200, { ok: true, ...startScreenRecording(body.deviceId ?? "") })
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
