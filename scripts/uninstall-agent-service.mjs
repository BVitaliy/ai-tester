import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { LABEL, guiDomain, plistPath } from "./agent-service-common.mjs"

const execFileAsync = promisify(execFile)

async function main() {
  await execFileAsync("launchctl", ["bootout", guiDomain(), plistPath]).catch(() => {})
  await execFileAsync("launchctl", ["remove", LABEL]).catch(() => {})
  await fs.rm(plistPath, { force: true })
  console.log(`Uninstalled ${LABEL}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
