import fs from "node:fs"
import path from "node:path"

const FALLBACK_MATCH = "https://www.plasmo.com/*"
const STALE_PERMISSIONS = new Set(["offscreen"])

export function fixDevManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return false

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  let changed = false

  for (const entry of manifest.content_scripts ?? []) {
    if (!entry.matches?.length) {
      entry.matches = [FALLBACK_MATCH]
      delete entry.exclude_matches
      changed = true
    }
  }

  if (manifest.permissions?.length) {
    const next = manifest.permissions.filter((p) => !STALE_PERMISSIONS.has(p))
    if (next.length !== manifest.permissions.length) {
      manifest.permissions = next
      changed = true
    }
  }

  if (changed) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  }

  return changed
}

const isCli =
  path.basename(process.argv[1] ?? "") === path.basename(new URL(import.meta.url).pathname)

if (isCli) {
  const manifestPath = path.join("build", "chrome-mv3-dev", "manifest.json")
  if (fixDevManifest(manifestPath)) {
    console.log("[fix-dev-manifest] repaired chrome-mv3-dev/manifest.json")
  }
}
