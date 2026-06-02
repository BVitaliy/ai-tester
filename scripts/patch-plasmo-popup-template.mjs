import fs from "node:fs"
import path from "node:path"

const templatePaths = [
  path.join("node_modules", "plasmo", "templates", "static", "react18", "index.tsx"),
  path.join("node_modules", "plasmo", "templates", "static", "react17", "index.tsx"),
  path.join("node_modules", "plasmo", "templates", "static", "react19", "index.tsx")
]

const from = 'import * as Component from "__plasmo_import_module__"'
const to = 'import * as Component from "~popup"'

for (const templatePath of templatePaths) {
  if (!fs.existsSync(templatePath)) continue
  const current = fs.readFileSync(templatePath, "utf8")
  if (current.includes(to)) continue
  if (!current.includes(from)) continue
  fs.writeFileSync(templatePath, current.replace(from, to))
  console.log(`[patch-plasmo] patched ${templatePath}`)
}
