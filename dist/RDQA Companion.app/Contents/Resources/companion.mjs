import { execFile } from "node:child_process"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const LABEL = "studio.redstone.rdqa-agent"
const PORT = "17321"
const resourcesDir = path.dirname(fileURLToPath(import.meta.url))
const nodePath = process.execPath
const bundledServerPath = path.join(resourcesDir, "qa-agent", "server.mjs")
const sourceServerPath = path.resolve(resourcesDir, "..", "qa-agent", "server.mjs")
const serverPath = fsSync.existsSync(bundledServerPath) ? bundledServerPath : sourceServerPath
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents")
const logsDir = path.join(os.homedir(), "Library", "Logs")
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`)
const stdoutLog = path.join(logsDir, `${LABEL}.out.log`)
const stderrLog = path.join(logsDir, `${LABEL}.err.log`)
const androidHome = path.join(os.homedir(), "Library", "Android", "sdk")
const nvmNodeBin = path.join(os.homedir(), ".nvm", "versions", "node", process.version, "bin")

function guiDomain() {
  return `gui/${process.getuid()}`
}

function serviceTarget() {
  return `${guiDomain()}/${LABEL}`
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function servicePath() {
  return [
    path.dirname(nodePath),
    nvmNodeBin,
    path.join(androidHome, "platform-tools"),
    path.join(androidHome, "emulator"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":")
}

function buildPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(resourcesDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>QA_AGENT_HOST</key>
    <string>127.0.0.1</string>
    <key>QA_AGENT_PORT</key>
    <string>${xmlEscape(PORT)}</string>
    <key>ANDROID_HOME</key>
    <string>${xmlEscape(androidHome)}</string>
    <key>PATH</key>
    <string>${xmlEscape(servicePath())}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrLog)}</string>
</dict>
</plist>
`
}

async function run(command, args) {
  return execFileAsync(command, args)
}

async function dialog(message, buttons = ["Install / Restart", "Uninstall", "Quit"], defaultButton = "Install / Restart") {
  const script = [
    `display dialog ${JSON.stringify(message)} buttons {${buttons.map((button) => JSON.stringify(button)).join(", ")}} default button ${JSON.stringify(defaultButton)} with title "RDQA Companion"`,
    "button returned of result"
  ].join("\n")
  const { stdout } = await run("osascript", ["-e", script])
  return stdout.trim()
}

function healthRequest() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:17321/health", (res) => {
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => {
        data += chunk
      })
      res.on("end", () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ ok: false, error: "Invalid health response" })
        }
      })
    })
    req.on("error", (error) => resolve({ ok: false, error: error.message }))
    req.setTimeout(5000, () => {
      req.destroy()
      resolve({ ok: false, error: "Health check timeout" })
    })
  })
}

async function unloadExisting() {
  await run("launchctl", ["bootout", guiDomain(), plistPath]).catch(() => {})
  await run("launchctl", ["remove", LABEL]).catch(() => {})
}

async function installService() {
  await fs.mkdir(launchAgentsDir, { recursive: true })
  await fs.mkdir(logsDir, { recursive: true })
  await unloadExisting()
  await fs.writeFile(plistPath, buildPlist(), "utf8")
  await run("launchctl", ["bootstrap", guiDomain(), plistPath])
  await run("launchctl", ["enable", serviceTarget()]).catch(() => {})
  await run("launchctl", ["kickstart", "-k", serviceTarget()])
}

async function uninstallService() {
  await unloadExisting()
  await fs.rm(plistPath, { force: true })
}

function formatHealth(health) {
  if (!health?.ok) return `Agent is not reachable.\n${health?.error ?? ""}`.trim()
  return [
    "Agent is running.",
    `adb: ${health.adb ? "ok" : "missing"}`,
    `emulator: ${health.emulator ? "ok" : "missing"}`,
    `appium: ${health.appium ? "ok" : "missing"}`
  ].join("\n")
}

function readNativeMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    let done = false
    const cleanup = () => {
      process.stdin.off("data", onData)
      process.stdin.off("end", onEnd)
      process.stdin.off("error", onError)
    }
    const finish = (value) => {
      if (done) return
      done = true
      cleanup()
      resolve(value)
    }
    const fail = (error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }
    const tryRead = () => {
      if (buffer.length < 4) {
        return
      }
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const payload = buffer.subarray(4, 4 + length).toString("utf8")
      try {
        finish(JSON.parse(payload))
      } catch (error) {
        fail(error)
      }
    }
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      tryRead()
    }
    const onEnd = () => finish(null)
    const onError = (error) => fail(error)
    process.stdin.on("data", onData)
    process.stdin.on("end", onEnd)
    process.stdin.on("error", onError)
  })
}

function writeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  process.stdout.write(Buffer.concat([header, payload]))
}

async function runNativeHost() {
  try {
    const message = await readNativeMessage()
    const action = message?.action ?? "health"

    if (action === "health") {
      writeNativeMessage({ ok: true, action, health: await healthRequest() })
      return
    }

    if (action === "install" || action === "start" || action === "restart") {
      if (!(await fs.stat(serverPath).catch(() => null))) {
        writeNativeMessage({ ok: false, action, error: `qa-agent server was not found: ${serverPath}` })
        return
      }
      await installService()
      await new Promise((resolve) => setTimeout(resolve, 1200))
      writeNativeMessage({ ok: true, action, health: await healthRequest() })
      return
    }

    if (action === "uninstall") {
      await uninstallService()
      writeNativeMessage({ ok: true, action, health: await healthRequest() })
      return
    }

    writeNativeMessage({ ok: false, action, error: `Unknown action: ${action}` })
  } catch (error) {
    writeNativeMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function main() {
  if (process.argv.includes("--native")) {
    await runNativeHost()
    return
  }

  if (!(await fs.stat(serverPath).catch(() => null))) {
    await dialog(`qa-agent server was not found:\n${serverPath}`, ["Quit"], "Quit")
    return
  }

  if (process.argv.includes("--install")) {
    await installService()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    console.log(JSON.stringify(await healthRequest()))
    return
  }

  if (process.argv.includes("--uninstall")) {
    await uninstallService()
    console.log("uninstalled")
    return
  }

  if (process.argv.includes("--health")) {
    console.log(JSON.stringify(await healthRequest()))
    return
  }

  let keepOpen = true
  while (keepOpen) {
    const choice = await dialog(formatHealth(await healthRequest()))
    if (choice === "Install / Restart") {
      await installService()
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await dialog(`RDQA Agent installed.\n\n${formatHealth(await healthRequest())}`, ["OK"], "OK")
    } else if (choice === "Uninstall") {
      await uninstallService()
      await dialog("RDQA Agent uninstalled.", ["OK"], "OK")
    } else {
      keepOpen = false
    }
  }
}

main().catch(async (error) => {
  await dialog(error instanceof Error ? error.message : String(error), ["Quit"], "Quit").catch(() => {})
  process.exit(1)
})
