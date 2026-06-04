import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const HOST_NAME = "studio.redstone.rdqa_companion"
const DEFAULT_EXTENSION_ID = "idkbpgklhhdahkkloklhjmodpdahimmb"
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname)
const nodePath = process.execPath
const companionPath = path.join(projectRoot, "companion", "companion.mjs")
const chromeHostDir = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
const manifestPath = path.join(chromeHostDir, `${HOST_NAME}.json`)
const launcherPath = path.join(chromeHostDir, `${HOST_NAME}.sh`)

function extensionIds() {
  const raw =
    process.argv[2] ??
    process.env.RDQA_EXTENSION_ID ??
    DEFAULT_EXTENSION_ID
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

async function main() {
  const ids = extensionIds()
  if (!ids.length) throw new Error("Extension id is required")

  await fs.mkdir(chromeHostDir, { recursive: true })
  await fs.access(companionPath)

  const launcher = `#!/bin/zsh
exec ${JSON.stringify(nodePath)} ${JSON.stringify(companionPath)} --native
`
  await fs.writeFile(launcherPath, launcher, { mode: 0o755 })
  await fs.chmod(launcherPath, 0o755)

  const manifest = {
    name: HOST_NAME,
    description: "RDQA Companion native host",
    path: launcherPath,
    type: "stdio",
    allowed_origins: ids.map((id) => `chrome-extension://${id}/`)
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")

  console.log(`Installed native host: ${HOST_NAME}`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Launcher: ${launcherPath}`)
  console.log(`Allowed origins: ${manifest.allowed_origins.join(", ")}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
