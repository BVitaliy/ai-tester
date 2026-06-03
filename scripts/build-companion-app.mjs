import fs from "node:fs/promises"
import path from "node:path"

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname)
const distDir = path.join(projectRoot, "dist")
const appDir = path.join(distDir, "RDQA Companion.app")
const contentsDir = path.join(appDir, "Contents")
const macosDir = path.join(contentsDir, "MacOS")
const resourcesDir = path.join(contentsDir, "Resources")

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>rdqa-companion</string>
  <key>CFBundleIdentifier</key>
  <string>studio.redstone.rdqa-companion</string>
  <key>CFBundleName</key>
  <string>RDQA Companion</string>
  <key>CFBundleDisplayName</key>
  <string>RDQA Companion</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
`
}

const launcher = `#!/bin/zsh
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$APP_DIR/Resources"
exec "$RESOURCES/node/node" "$RESOURCES/companion.mjs"
`

async function copyFile(source, target, mode) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  if (mode) await fs.chmod(target, mode)
}

async function main() {
  await fs.rm(appDir, { recursive: true, force: true })
  await fs.mkdir(macosDir, { recursive: true })
  await fs.mkdir(resourcesDir, { recursive: true })

  await fs.writeFile(path.join(contentsDir, "Info.plist"), plist(), "utf8")
  await fs.writeFile(path.join(macosDir, "rdqa-companion"), launcher, { mode: 0o755 })

  await copyFile(process.execPath, path.join(resourcesDir, "node", "node"), 0o755)
  await copyFile(path.join(projectRoot, "companion", "companion.mjs"), path.join(resourcesDir, "companion.mjs"))
  await copyFile(path.join(projectRoot, "qa-agent", "server.mjs"), path.join(resourcesDir, "qa-agent", "server.mjs"))

  console.log(`Built ${appDir}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
