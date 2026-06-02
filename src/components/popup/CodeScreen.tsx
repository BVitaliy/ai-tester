import React, { useEffect, useMemo, useState } from "react"
import { ChevronLeft, Download, RefreshCw, ShieldCheck, ChevronRight, ChevronDown, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"
import javascript from "highlight.js/lib/languages/javascript"
import java from "highlight.js/lib/languages/java"
import csharp from "highlight.js/lib/languages/csharp"
import xml from "highlight.js/lib/languages/xml"
import cssLang from "highlight.js/lib/languages/css"
import jsonLang from "highlight.js/lib/languages/json"
import type { GeneratedFile, JackGenStatus, JackSessionState, SelectedModels } from "../../core/types"
import {
  getGenStatus,
  getLastSessionKey,
  getSessionState,
  getSettings,
  updateSessionState,
} from "../../store/jack"
import { reviewCode } from "../../core/api/aiService"
import { useLanguage } from "../../contexts/LanguageContext"
import JSZip from "jszip"

hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("java", java)
hljs.registerLanguage("csharp", csharp)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("css", cssLang)
hljs.registerLanguage("json", jsonLang)

interface Props {
  onBack: () => void
}

const FRAMEWORKS = ["playwright", "cypress"] as const
const LANGUAGES = ["typescript", "javascript", "dotnet", "java"] as const

const HLJS_THEME = `
.vsc-code .hljs-keyword,.vsc-code .hljs-built_in{color:#569CD6}
.vsc-code .hljs-string,.vsc-code .hljs-template-string,.vsc-code .hljs-template-tag{color:#CE9178}
.vsc-code .hljs-comment{color:#6A9955;font-style:italic}
.vsc-code .hljs-number{color:#B5CEA8}
.vsc-code .hljs-title.class_{color:#4EC9B0}
.vsc-code .hljs-title.function_,.vsc-code .hljs-function{color:#DCDCAA}
.vsc-code .hljs-params{color:#9CDCFE}
.vsc-code .hljs-variable,.vsc-code .hljs-attr{color:#9CDCFE}
.vsc-code .hljs-property{color:#9CDCFE}
.vsc-code .hljs-meta{color:#D4D4D4}
.vsc-code .hljs-literal{color:#569CD6}
.vsc-code .hljs-tag{color:#569CD6}
.vsc-code .hljs-name{color:#4EC9B0}
.vsc-code .hljs-selector-class{color:#D7BA7D}
.vsc-code .hljs-regexp{color:#D16969}
`

type FileIconCfg = { badge: string; color: string; fg?: string }

const FILE_ICONS: Record<string, FileIconCfg> = {
  ts:   { badge: "TS", color: "#3178C6" },
  tsx:  { badge: "TS", color: "#3178C6" },
  js:   { badge: "JS", color: "#F7DF1E", fg: "#1a1a1a" },
  jsx:  { badge: "JS", color: "#F7DF1E", fg: "#1a1a1a" },
  java: { badge: "JV", color: "#B07219" },
  cs:   { badge: "C#", color: "#9B59B6" },
  py:   { badge: "PY", color: "#3572A5" },
  css:  { badge: "SS", color: "#264DE4" },
  html: { badge: "HT", color: "#E34C26" },
  json: { badge: "{}", color: "#F0A30A", fg: "#1a1a1a" },
  md:   { badge: "MD", color: "#219EBC" },
}
const CURSOR_ICON: FileIconCfg = { badge: "✦", color: "#DC2626" }

function getExt(path: string) {
  const p = path.split(".")
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ""
}

function getLang(ext: string) {
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", java: "java", cs: "csharp", css: "css", html: "xml", json: "json" } as Record<string, string>)[ext] ?? "plaintext"
}

function applyHighlight(code: string, ext: string) {
  const lang = getLang(ext)
  try {
    if (lang === "plaintext") return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    return hljs.highlight(code, { language: lang }).value
  } catch {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

function FileIcon({ path }: { path: string }) {
  const name = path.split("/").pop() ?? path
  const ext = getExt(path)
  const cfg = name === ".cursorrules" ? CURSOR_ICON : (FILE_ICONS[ext] ?? { badge: (ext.slice(0, 2).toUpperCase() || "?"), color: "#6E7681" })
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 3, background: cfg.color, color: cfg.fg ?? "#fff", fontSize: 7, fontWeight: 800, fontFamily: "monospace", flexShrink: 0, letterSpacing: -0.5 }}>
      {cfg.badge}
    </span>
  )
}

function buildTree(files: GeneratedFile[]): Array<{ dir: string; files: GeneratedFile[] }> {
  const map = new Map<string, GeneratedFile[]>()
  for (const f of files) {
    const parts = f.path.split("/")
    const dir = parts.length > 1 ? parts[0] : ""
    if (!map.has(dir)) map.set(dir, [])
    map.get(dir)!.push(f)
  }
  return Array.from(map.entries()).map(([dir, files]) => ({ dir, files }))
}

export function CodeScreen({ onBack }: Props) {
  const { t } = useLanguage()
  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<JackSessionState | null>(null)
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<SelectedModels | null>(null)
  const [framework, setFramework] = useState("playwright")
  const [language, setLanguage] = useState("typescript")
  const [reviewLoading, setReviewLoading] = useState(false)
  const [genStatus, setGenStatus] = useState<JackGenStatus>({ phase: "idle" })
  const [explorerOpen, setExplorerOpen] = useState(true)

  useEffect(() => {
    getLastSessionKey().then(async (key) => {
      setSessionKey(key)
      const state = key ? await getSessionState(key) : await getSessionState()
      if (state) {
        setSession(state)
        const f = state.generatedFiles ?? []
        setFiles(f)
        if (f.length > 0) { setSelectedPath(f[0].path); setOpenTabs([f[0].path]) }
      }
    })
    getSettings().then((s) => {
      if (s) { setSelectedModels(s.selectedModels); setFramework(s.targetFramework); setLanguage(s.targetLanguage) }
    })
    getGenStatus().then(setGenStatus)

    const onStorage = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== "local") return
      if (changes.jackGenStatus) {
        const next: JackGenStatus = changes.jackGenStatus.newValue ?? { phase: "idle" }
        setGenStatus(next)
      }
      if (changes.jackTabSessions) {
        getLastSessionKey().then(async (key) => {
          if (!key) return
          const state = await getSessionState(key)
          if (state) {
            const f = state.generatedFiles ?? []
            setFiles(f)
            if (f.length > 0) { setSelectedPath(f[0].path); setOpenTabs([f[0].path]) }
          }
        })
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [])

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null
  const tree = useMemo(() => buildTree(files), [files])

  const openFile = (path: string) => {
    setSelectedPath(path)
    setOpenTabs((prev) => prev.includes(path) ? prev : [...prev, path])
  }

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = openTabs.filter((t) => t !== path)
    setOpenTabs(next)
    if (selectedPath === path) setSelectedPath(next[next.length - 1] ?? null)
  }

  const toggleDir = (dir: string) =>
    setCollapsedDirs((prev) => { const n = new Set(prev); n.has(dir) ? n.delete(dir) : n.add(dir); return n })

  const handleRegen = () => {
    if (!sessionKey) return
    chrome.runtime.sendMessage({ type: "JACK_GENERATE_CODE", sessionKey }).catch(() => {})
  }

  const handleRetry = () => {
    if (!sessionKey) return
    chrome.runtime.sendMessage({ type: "JACK_RETRY", sessionKey, failedPhase: "code" }).catch(() => {})
  }

  const handleReview = async () => {
    if (!selectedFile || !selectedModels?.reviewProvider) return
    setReviewLoading(true)
    try {
      const reviewed = await reviewCode({ file: selectedFile, provider: selectedModels.reviewProvider, model: selectedModels.reviewModel })
      const next = files.map((f) => f.path === reviewed.path ? reviewed : f)
      setFiles(next); if (sessionKey) await updateSessionState({ generatedFiles: next }, sessionKey)
    } catch (err) { console.error(err) } finally { setReviewLoading(false) }
  }

  const handleDownload = async () => {
    if (!files.length) return
    const zip = new JSZip()
    files.forEach((f) => zip.file(f.path, f.content))
    const blob = await zip.generateAsync({ type: "blob" })
    chrome.downloads.download({ url: URL.createObjectURL(blob), filename: "jack-qa-tests.zip", saveAs: true })
  }

  const highlightedCode = useMemo(() => selectedFile ? applyHighlight(selectedFile.content, getExt(selectedFile.path)) : "", [selectedFile])
  const lineCount = useMemo(() => (selectedFile?.content ?? "").split("\n").length, [selectedFile])
  const reviewEnabled = Boolean(selectedModels?.reviewProvider)

  const selStyle: React.CSSProperties = { background: "#3c3c3c", border: "1px solid #555", borderRadius: 4, padding: "2px 6px", fontSize: 11, color: "#ccc", outline: "none", cursor: "pointer" }
  const iconBtn = (disabled: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, background: "rgba(255,255,255,0.07)", border: "1px solid #444", borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, flexShrink: 0 })

  return (
    <div style={{ width: 600, height: 580, backgroundColor: "#1e1e1e", color: "#d4d4d4", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "system-ui,sans-serif" }}>
      <style>{HLJS_THEME}</style>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#2d2d2d", borderBottom: "1px solid #3e3e3e", flexShrink: 0, overflow: "hidden" }}>
        <button onClick={onBack} style={{ color: "#aaa", display: "flex", background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 12, color: "#ccc", flexShrink: 0 }}>{t("codeTitle")}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selStyle}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l === "dotnet" ? ".Net" : l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
        </select>
        <select value={framework} onChange={(e) => setFramework(e.target.value)} style={selStyle}>
          {FRAMEWORKS.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
        </select>

        {/* Gen status — flex shrinks before buttons */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {genStatus.phase !== "idle" && genStatus.phase !== "error" && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#f87171", overflow: "hidden" }}>
              <Loader2 size={10} className="animate-spin" style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {genStatus.phase === "generating-code" ? "Генерація..." : "Обробка..."}
              </span>
            </span>
          )}
          {genStatus.phase === "error" && (
            <button onClick={handleRetry} style={{ fontSize: 10, color: "#f87171", background: "rgba(220,38,38,0.2)", border: "none", borderRadius: 3, padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap" }}>
              ✕ Повторити
            </button>
          )}
        </div>

        {/* Action buttons — never shrink */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
          <button onClick={handleRegen} disabled={genStatus.phase === "generating-code"} title={t("regenerate")} style={iconBtn(genStatus.phase === "generating-code")}>
            {genStatus.phase === "generating-code" ? <Loader2 size={12} className="animate-spin" color="#ccc" /> : <RefreshCw size={12} color="#ccc" />}
          </button>
          <button onClick={handleReview} disabled={!reviewEnabled || reviewLoading} title={t("reviewTask")} style={iconBtn(!reviewEnabled || reviewLoading)}>
            {reviewLoading ? <Loader2 size={12} className="animate-spin" color="#ccc" /> : <ShieldCheck size={12} color={reviewEnabled ? "#ccc" : "#555"} />}
          </button>
          <button onClick={handleDownload} style={{ display: "flex", alignItems: "center", gap: 4, background: "#DC2626", border: "none", borderRadius: 4, padding: "3px 9px", fontSize: 11, color: "#fff", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
            <Download size={11} />{files.length}
          </button>
        </div>
      </div>

      {/* Body: Explorer + Code */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* Explorer — 160px, collapsible */}
        <div style={{ width: explorerOpen ? 160 : 0, minWidth: 0, background: "#252526", borderRight: explorerOpen ? "1px solid #1a1a1a" : "none", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden", transition: "width 0.18s ease" }}>
          <div style={{ padding: "7px 10px 4px", fontSize: 9, fontWeight: 700, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>EXPLORER</span>
            <button
              onClick={() => setExplorerOpen(false)}
              title="Сховати"
              style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", lineHeight: 1 }}>
              <PanelLeftClose size={13} />
            </button>
          </div>
          <div className="jack-scroll" style={{ flex: 1, overflowY: "auto" }}>
            {tree.map(({ dir, files: dirFiles }) => (
              <div key={dir}>
                {dir ? (
                  <button onClick={() => toggleDir(dir)} style={{ display: "flex", alignItems: "center", gap: 3, width: "100%", padding: "2px 8px", background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 11 }}>
                    {collapsedDirs.has(dir) ? <ChevronRight size={11} style={{ flexShrink: 0 }} /> : <ChevronDown size={11} style={{ flexShrink: 0 }} />}
                    <span style={{ fontSize: 11 }}>📁</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir}</span>
                  </button>
                ) : null}
                {!collapsedDirs.has(dir) && dirFiles.map((file) => {
                  const name = file.path.split("/").pop() ?? file.path
                  const isActive = selectedPath === file.path
                  return (
                    <button key={file.path} onClick={() => openFile(file.path)}
                      style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: `2px 8px 2px ${dir ? 18 : 8}px`, background: isActive ? "rgba(220,38,38,0.15)" : "none", border: "none", borderLeft: `2px solid ${isActive ? "#DC2626" : "transparent"}`, cursor: "pointer", color: isActive ? "#e5e7eb" : "#aaa", fontSize: 11, textAlign: "left" }}>
                      <FileIcon path={file.path} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Code panel — flex:1 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Tab bar: optional open-explorer btn + file tabs */}
          <div className="jack-scroll" style={{ display: "flex", alignItems: "stretch", background: "#2d2d2d", borderBottom: "1px solid #1a1a1a", flexShrink: 0, overflowX: "auto" }}>
            {/* Open-explorer button inline — only when collapsed */}
            {!explorerOpen && (
              <button
                onClick={() => setExplorerOpen(true)}
                title="Показати дерево"
                style={{ display: "flex", alignItems: "center", padding: "0 8px", background: "none", border: "none", borderRight: "1px solid #3e3e3e", cursor: "pointer", color: "#6b7280", flexShrink: 0 }}>
                <PanelLeftOpen size={13} />
              </button>
            )}
            {openTabs.map((path) => {
              const name = path.split("/").pop() ?? path
              const isActive = selectedPath === path
              return (
                <div key={path}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap", borderBottom: `2px solid ${isActive ? "#DC2626" : "transparent"}`, background: isActive ? "#1e1e1e" : "transparent", color: isActive ? "#d4d4d4" : "#777", fontSize: 11, flexShrink: 0 }}
                  onClick={() => setSelectedPath(path)}>
                  <FileIcon path={path} />
                  <span>{name}</span>
                  <span
                    onClick={(e) => { e.stopPropagation(); closeTab(path, e as any) }}
                    style={{ marginLeft: 2, fontSize: 14, lineHeight: 1, color: isActive ? "#888" : "#444", cursor: "pointer", display: "flex", alignItems: "center" }}>
                    ×
                  </span>
                </div>
              )
            })}
          </div>

          {/* Breadcrumb */}
          {selectedFile && (
            <div style={{ padding: "2px 10px", fontSize: 10, color: "#555", background: "#252526", borderBottom: "1px solid #1a1a1a", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedFile.path}
            </div>
          )}

          {/* Code + line numbers */}
          {selectedFile ? (
            <div className="jack-scroll" style={{ flex: 1, overflow: "auto", display: "flex", background: "#1e1e1e", minHeight: 0 }}>
              <div style={{ padding: "12px 0", minWidth: 34, textAlign: "right", fontSize: 11, lineHeight: "19px", color: "#4a4a4a", background: "#1e1e1e", userSelect: "none", flexShrink: 0, fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace" }}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} style={{ paddingRight: 8 }}>{i + 1}</div>
                ))}
              </div>
              <pre
                className="vsc-code"
                style={{ flex: 1, margin: 0, padding: "12px 12px", fontSize: 11, lineHeight: "19px", fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", color: "#d4d4d4", background: "#1e1e1e", whiteSpace: "pre", overflow: "visible" }}
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
              {t("selectFile")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
