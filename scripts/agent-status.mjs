import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { LABEL, plistPath, serviceTarget, stderrLog, stdoutLog } from "./agent-service-common.mjs"

const execFileAsync = promisify(execFile)

async function health() {
  try {
    const res = await fetch("http://127.0.0.1:17321/health")
    return await res.json()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function tail(path) {
  try {
    const data = await fs.readFile(path, "utf8")
    return data.split("\n").slice(-8).filter(Boolean).join("\n")
  } catch {
    return ""
  }
}

async function main() {
  const launchctl = await execFileAsync("launchctl", ["print", serviceTarget()])
    .then(({ stdout }) => stdout)
    .catch((error) => error.stderr || error.message)

  console.log(`Service: ${LABEL}`)
  console.log(`Plist: ${plistPath}`)
  console.log(`Health: ${JSON.stringify(await health())}`)
  console.log("")
  console.log("launchctl:")
  console.log(launchctl.trim())

  const out = await tail(stdoutLog)
  const err = await tail(stderrLog)
  if (out) {
    console.log("")
    console.log(`Last stdout (${stdoutLog}):`)
    console.log(out)
  }
  if (err) {
    console.log("")
    console.log(`Last stderr (${stderrLog}):`)
    console.log(err)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
