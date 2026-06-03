import os from "node:os"
import path from "node:path"

export const LABEL = "studio.redstone.rdqa-agent"
export const PORT = "17321"
export const projectRoot = path.resolve(new URL("..", import.meta.url).pathname)
export const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents")
export const logsDir = path.join(os.homedir(), "Library", "Logs")
export const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`)
export const stdoutLog = path.join(logsDir, `${LABEL}.out.log`)
export const stderrLog = path.join(logsDir, `${LABEL}.err.log`)
export const serverPath = path.join(projectRoot, "qa-agent", "server.mjs")

export function guiDomain() {
  return `gui/${process.getuid()}`
}

export function serviceTarget() {
  return `${guiDomain()}/${LABEL}`
}

export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function buildPlist({ nodePath }) {
  const nodeBin = path.dirname(nodePath)
  const androidHome = path.join(os.homedir(), "Library", "Android", "sdk")
  const servicePath = [
    nodeBin,
    path.join(androidHome, "platform-tools"),
    path.join(androidHome, "emulator"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":")

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
  <string>${xmlEscape(projectRoot)}</string>

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
    <string>${xmlEscape(servicePath)}</string>
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
