import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fixDevManifest } from "./fix-dev-manifest.mjs"

const manifestPath = path.join("build", "chrome-mv3-dev", "manifest.json")

function repairManifest() {
  if (fixDevManifest(manifestPath)) {
    console.log("[dev] repaired invalid content_scripts.matches in chrome-mv3-dev")
  }
}

function watchManifest() {
  const dir = path.dirname(manifestPath)
  if (!fs.existsSync(dir)) return

  let debounce = null
  const schedule = () => {
    clearTimeout(debounce)
    debounce = setTimeout(repairManifest, 50)
  }

  try {
    fs.watch(dir, (event, file) => {
      if (file === "manifest.json") schedule()
    })
  } catch {
    // fallback below
  }

  const timer = setInterval(() => {
    if (fs.existsSync(manifestPath)) repairManifest()
  }, 400)

  return () => {
    clearInterval(timer)
    clearTimeout(debounce)
  }
}

const plasmo = spawn("pnpm", ["exec", "plasmo", "dev"], {
  stdio: "inherit",
  shell: true
})

const stopWatch = watchManifest()
repairManifest()

plasmo.on("exit", (code) => {
  stopWatch()
  process.exit(code ?? 0)
})

process.on("SIGINT", () => plasmo.kill("SIGINT"))
process.on("SIGTERM", () => plasmo.kill("SIGTERM"))
