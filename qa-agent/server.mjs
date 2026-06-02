import { execFile, spawn } from "node:child_process"
import http from "node:http"
import { URL } from "node:url"

const HOST = process.env.QA_AGENT_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QA_AGENT_PORT ?? 17321)

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
