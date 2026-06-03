import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  LABEL,
  buildPlist,
  guiDomain,
  launchAgentsDir,
  logsDir,
  plistPath,
  serverPath,
  serviceTarget,
  stderrLog,
  stdoutLog
} from "./agent-service-common.mjs"

const execFileAsync = promisify(execFile)

async function exists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function unloadExisting() {
  await execFileAsync("launchctl", ["bootout", guiDomain(), plistPath]).catch(() => {})
  await execFileAsync("launchctl", ["remove", LABEL]).catch(() => {})
}

async function main() {
  if (!(await exists(serverPath))) {
    throw new Error(`qa-agent server not found: ${serverPath}`)
  }

  await fs.mkdir(launchAgentsDir, { recursive: true })
  await fs.mkdir(logsDir, { recursive: true })
  await unloadExisting()

  const nodePath = process.execPath
  await fs.writeFile(plistPath, buildPlist({ nodePath }), "utf8")

  await execFileAsync("launchctl", ["bootstrap", guiDomain(), plistPath])
  await execFileAsync("launchctl", ["enable", serviceTarget()]).catch(() => {})
  await execFileAsync("launchctl", ["kickstart", "-k", serviceTarget()])

  console.log(`Installed ${LABEL}`)
  console.log(`Plist: ${plistPath}`)
  console.log(`Node: ${nodePath}`)
  console.log(`Logs: ${stdoutLog}`)
  console.log(`Errors: ${stderrLog}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
