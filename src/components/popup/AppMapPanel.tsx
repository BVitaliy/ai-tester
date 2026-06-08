import React, { useEffect, useRef, useState } from "react"
import { Boxes, Download, FileSearch, Map as MapIcon, Play, RotateCcw, ScanSearch, Square } from "lucide-react"

import {
  appMapScreenshotUrl,
  generateTestsFromMap,
  getAppMap,
  getScanStatus,
  runMobileSteps,
  startAppScan,
  stopAppScan,
  type AppMap,
  type AppMapResult,
  type GeneratedFlow,
  type GeneratedFlowsResult,
  type MobileTestRunResult,
  type ScanEvent,
  type ScanJob
} from "../../core/api/mobileAgent"

interface Props {
  deviceId: string
  packageName: string
  appLabel?: string
}

interface FlowRun {
  flow: GeneratedFlow
  result: MobileTestRunResult
}

const card: React.CSSProperties = {
  background: "#1c1c1f",
  border: "1px solid #2c2c30",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10
}

const btn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #3a3a40",
  background: "#26262b",
  color: "#e5e5e5",
  cursor: "pointer"
}

function flowPriorityColor(priority: string) {
  if (priority === "high") return "#dc2626"
  if (priority === "medium") return "#d97706"
  return "#64748b"
}

function statusColor(status?: string) {
  switch (status) {
    case "running":
    case "stopping":
      return "#38bdf8"
    case "done":
      return "#22c55e"
    case "stopped":
      return "#f59e0b"
    case "error":
      return "#f87171"
    default:
      return "#64748b"
  }
}

function eventLine(e: ScanEvent): string | null {
  switch (e.type) {
    case "launch":
      return e.resuming ? "Resuming scan…" : "Launching app…"
    case "screen":
      return `Screen: ${e.name ?? e.screenId ?? ""}`
    case "action":
      return `Tap: ${e.label ?? ""}`
    case "transition":
      return `→ ${e.name ?? e.to ?? ""} (via "${e.label ?? ""}")`
    case "no-transition":
      return `No change after "${e.label ?? ""}"`
    case "skip":
      return `Skipped unsafe: ${e.label ?? ""}`
    case "action-error":
      return `Tap failed: ${e.label ?? ""}`
    case "done":
      return "Scan complete"
    case "stopped":
      return "Scan stopped"
    default:
      return null
  }
}

export function AppMapPanel({ deviceId, packageName, appLabel }: Props) {
  const [busy, setBusy] = useState<null | "map" | "tests" | "run" | "report">(null)
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [job, setJob] = useState<ScanJob | null>(null)
  const [appMap, setAppMap] = useState<AppMap | null>(null)
  const [flows, setFlows] = useState<GeneratedFlowsResult | null>(null)
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])

  const ready = !!deviceId && !!packageName
  const scanning = job?.status === "running" || job?.status === "stopping"
  const pollRef = useRef<number | null>(null)

  // Re-attach to an in-flight (or finished) scan when the popup reopens or the
  // selected device/app changes. The job lives in the agent process, so progress
  // is never lost just because the popup was closed.
  useEffect(() => {
    setJob(null)
    if (!ready) return
    let cancelled = false
    getScanStatus(deviceId, packageName)
      .then((r) => {
        if (cancelled) return
        if (r.job) setJob(r.job)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [deviceId, packageName])

  // Poll while a scan is active; load the map once it finishes.
  useEffect(() => {
    if (!scanning || !ready) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await getScanStatus(deviceId, packageName)
        if (!r.job) return
        setJob(r.job)
        if (r.job.status !== "running" && r.job.status !== "stopping") {
          const m = await getAppMap({ appId: packageName }).catch(() => null)
          if (m) setAppMap(m.appMap)
        }
      } catch {}
    }, 1200)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [scanning, deviceId, packageName])

  const handleScan = async (resume: boolean) => {
    if (!ready) return
    setError("")
    setStatus("")
    try {
      const started = await startAppScan(deviceId, packageName, { resume })
      setJob(started)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleStop = async () => {
    if (!ready) return
    try {
      const stopped = await stopAppScan(deviceId, packageName)
      setJob(stopped)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleViewMap = async () => {
    setBusy("map")
    setError("")
    try {
      const result: AppMapResult = await getAppMap({ appId: packageName })
      setAppMap(result.appMap)
      setStatus(
        `Loaded map: ${result.summary.screenCount} screens, ${result.summary.transitionCount} transitions.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleGenerateTests = async () => {
    setBusy("tests")
    setError("")
    try {
      const result = await generateTestsFromMap(appMap ? { appMap } : { appId: packageName })
      setFlows(result)
      setStatus(`Generated ${result.summary.total} test flows.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRunCriticalFlows = async () => {
    if (!ready || !flows) return
    setBusy("run")
    setError("")
    const runnable = flows.flows.filter(
      (flow) => !flow.placeholder && flow.priority === "high" && flow.steps.length
    )
    const runs: FlowRun[] = []
    try {
      for (let i = 0; i < runnable.length; i++) {
        const flow = runnable[i]
        setStatus(`Running critical flow ${i + 1}/${runnable.length}: ${flow.title}`)
        const result = await runMobileSteps(deviceId, packageName, flow.steps)
        runs.push({ flow, result })
        setFlowRuns([...runs])
      }
      const passed = runs.filter((r) => r.result.summary.failed === 0).length
      setStatus(`Ran ${runs.length} critical flows — ${passed} passed, ${runs.length - passed} with failures.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadReport = async () => {
    if (!appMap) return
    setBusy("report")
    setError("")
    try {
      const html = await buildAppMapReport(appMap, flows, flowRuns, appLabel)
      const blob = new Blob([html], { type: "text/html;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      chrome.downloads.download({
        url,
        filename: `app-map-report-${Date.now()}.html`,
        saveAs: true
      })
      setStatus("App map report downloaded.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const scanButton = scanning ? (
    <button style={{ ...btn, borderColor: "#7f1d1d", background: "#3a1f1f" }} onClick={handleStop}>
      <Square size={13} /> {job?.status === "stopping" ? "Stopping…" : "Stop Scan"}
    </button>
  ) : job?.resumable ? (
    <button style={{ ...btn, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => handleScan(true)}>
      <RotateCcw size={13} /> Resume Scan
    </button>
  ) : (
    <button style={{ ...btn, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => handleScan(false)}>
      <ScanSearch size={13} /> Scan App Structure
    </button>
  )

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#e5e5e5", fontSize: 12, fontWeight: 700 }}>
        <Boxes size={14} /> App Structure (AI Map)
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
        Automatically explore the selected app, build a screen map, and generate runnable tests.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {scanButton}
        <button style={{ ...btn, opacity: !busy && !scanning ? 1 : 0.5 }} disabled={!!busy || scanning} onClick={handleViewMap}>
          <MapIcon size={13} /> View App Map
        </button>
        <button style={{ ...btn, opacity: !busy && !scanning ? 1 : 0.5 }} disabled={!!busy || scanning} onClick={handleGenerateTests}>
          <FileSearch size={13} /> Generate Tests From App Map
        </button>
        <button
          style={{ ...btn, opacity: ready && flows && !busy && !scanning ? 1 : 0.5 }}
          disabled={!ready || !flows || !!busy || scanning}
          onClick={handleRunCriticalFlows}>
          <Play size={13} /> Run Critical Flows
        </button>
        <button
          style={{ ...btn, opacity: appMap && !busy && !scanning ? 1 : 0.5 }}
          disabled={!appMap || !!busy || scanning}
          onClick={handleDownloadReport}>
          <Download size={13} /> Download App Map Report
        </button>
      </div>

      {job && <ScanProgress job={job} />}

      {status && <div style={{ fontSize: 10, color: "#a3a3a3" }}>{status}</div>}
      {error && <div style={{ fontSize: 10, color: "#f87171" }}>{error}</div>}

      {appMap && <AppMapScreens appMap={appMap} />}

      {flows && <GeneratedFlows flows={flows} flowRuns={flowRuns} />}
    </div>
  )
}

const FLOW_TYPE_META: Record<string, { label: string; hint: string; color: string }> = {
  smoke: { label: "Smoke", hint: "App launches and the main screen loads", color: "#22c55e" },
  navigation: { label: "Navigation", hint: "Tap a path and verify the destination screen opens", color: "#38bdf8" },
  "form-validation": { label: "Form validation", hint: "Submit forms with empty fields; expect validation", color: "#f59e0b" },
  auth: { label: "Auth", hint: "Login / register screens and their fields", color: "#a78bfa" },
  "deep-link": { label: "Deep link", hint: "Placeholder until the app declares deep links", color: "#64748b" }
}

const FLOW_TYPE_ORDER = ["smoke", "auth", "form-validation", "navigation", "deep-link"]

function GeneratedFlows({ flows, flowRuns }: { flows: GeneratedFlowsResult; flowRuns: FlowRun[] }) {
  const groups = new Map<string, GeneratedFlow[]>()
  for (const flow of flows.flows) {
    const arr = groups.get(flow.type) ?? []
    arr.push(flow)
    groups.set(flow.type, arr)
  }
  const orderedTypes = [...groups.keys()].sort(
    (a, b) => FLOW_TYPE_ORDER.indexOf(a) - FLOW_TYPE_ORDER.indexOf(b)
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>
        Generated flows ({flows.summary.total})
      </div>
      {orderedTypes.map((type) => {
        const meta = FLOW_TYPE_META[type] ?? { label: type, hint: "", color: "#64748b" }
        const list = groups.get(type) ?? []
        const shown = list.slice(0, 12)
        return (
          <div key={type} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#0f0f11", background: meta.color, borderRadius: 4, padding: "1px 6px", textTransform: "uppercase" }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>{list.length}</span>
              <span style={{ fontSize: 9, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {meta.hint}
              </span>
            </div>
            {shown.map((flow) => {
              const run = flowRuns.find((r) => r.flow.id === flow.id)
              return (
                <div key={flow.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, paddingLeft: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 6, background: flowPriorityColor(flow.priority), flexShrink: 0 }} />
                  <span style={{ color: "#d4d4d4", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={flow.title}>
                    {flow.title}
                  </span>
                  <span style={{ color: "#64748b", flexShrink: 0 }}>{flow.steps.length} steps</span>
                  {run && (
                    <span style={{ color: run.result.summary.failed === 0 ? "#22c55e" : "#f87171", fontWeight: 600, flexShrink: 0 }}>
                      {run.result.summary.failed === 0 ? "PASS" : `FAIL (${run.result.summary.failed})`}
                    </span>
                  )}
                </div>
              )
            })}
            {list.length > shown.length && (
              <div style={{ fontSize: 9, color: "#64748b", paddingLeft: 4 }}>+{list.length - shown.length} more…</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ScanProgress({ job }: { job: ScanJob }) {
  const active = job.status === "running" || job.status === "stopping"
  const phase =
    job.current?.phase ||
    (job.status === "done" ? "Done" : job.status === "stopped" ? "Stopped" : "")
  const detail = job.current?.name || job.current?.action || ""
  const lines = job.events
    .map(eventLine)
    .filter((l): l is string => !!l)
    .slice(-6)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#161618", border: "1px solid #2c2c30", borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 8,
            background: statusColor(job.status),
            boxShadow: active ? `0 0 6px ${statusColor(job.status)}` : "none"
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 600, color: "#e5e5e5", textTransform: "capitalize" }}>{job.status}</span>
        <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {phase}
          {detail ? `: ${detail}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10 }}>
        <Stat label="Screens" value={job.counts.screens} color="#22c55e" />
        <Stat label="Transitions" value={job.counts.transitions} color="#38bdf8" />
        <Stat label="Skipped (unsafe)" value={job.counts.skipped} color="#f59e0b" />
      </div>

      {job.skippedDangerous.length > 0 && (
        <div style={{ fontSize: 9, color: "#f59e0b" }}>
          ⚠ Skipped: {Array.from(new Set(job.skippedDangerous.map((s) => s.label))).slice(0, 8).join(", ")}
        </div>
      )}

      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#64748b", display: "flex", flexDirection: "column", gap: 2 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: i === lines.length - 1 ? "#cbd5e1" : "#64748b" }}>
            {line}
          </div>
        ))}
      </div>

      {job.error && <div style={{ fontSize: 10, color: "#f87171" }}>{job.error}</div>}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "#26262b", borderRadius: 8, padding: "6px 10px" }}>
      <strong style={{ color, fontSize: 14 }}>{value}</strong>
      <span style={{ color: "#94a3b8" }}>{label}</span>
    </div>
  )
}

function AppMapScreens({ appMap }: { appMap: AppMap }) {
  const nameById = new Map(appMap.screens.map((s) => [s.id, s.name || s.id] as [string, string]))
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {appMap.screens.map((screen) => (
        <div key={screen.id} style={{ display: "flex", gap: 8, background: "#161618", border: "1px solid #2c2c30", borderRadius: 8, padding: 8 }}>
          <img
            src={appMapScreenshotUrl(screen.fingerprint)}
            alt={screen.name}
            style={{ width: 54, height: 96, objectFit: "cover", borderRadius: 4, background: "#000", flexShrink: 0 }}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.visibility = "hidden"
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#e5e5e5" }}>{screen.name || screen.id}</div>
            {screen.purpose && <div style={{ fontSize: 9, color: "#94a3b8" }}>{screen.purpose}</div>}
            <div style={{ fontSize: 9, color: "#64748b" }}>
              {screen.visibleTexts.slice(0, 4).join(" · ") || "—"}
            </div>
            <div style={{ fontSize: 9, color: "#64748b" }}>
              {screen.clickableElements.length} clickable · {screen.transitions.length} transitions
            </div>
            {screen.transitions.length > 0 && (
              <div style={{ fontSize: 9, color: "#38bdf8" }}>
                {screen.transitions
                  .slice(0, 4)
                  .map((t) => `${t.action?.label || "?"} → ${nameById.get(t.toScreenId ?? "") ?? "?"}`)
                  .join("; ")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function screenshotDataUrl(fingerprint: string): Promise<string | null> {
  try {
    const res = await fetch(appMapScreenshotUrl(fingerprint))
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function buildAppMapReport(
  appMap: AppMap,
  flows: GeneratedFlowsResult | null,
  flowRuns: FlowRun[],
  appLabel?: string
): Promise<string> {
  const nameById = new Map(appMap.screens.map((s) => [s.id, s.name || s.id] as [string, string]))
  const transitionCount = appMap.screens.reduce((sum, s) => sum + s.transitions.length, 0)

  const screenCards = await Promise.all(
    appMap.screens.map(async (screen) => {
      const img = await screenshotDataUrl(screen.fingerprint)
      const transitions = screen.transitions
        .map((t) => `<li>${escapeHtml(t.action?.label || "?")} → ${escapeHtml(nameById.get(t.toScreenId ?? "") ?? "?")}</li>`)
        .join("")
      const elements = screen.clickableElements
        .slice(0, 12)
        .map((el) => `<span class="chip">${escapeHtml(el.label || el.text || el.resourceId || "?")}</span>`)
        .join("")
      return `
        <div class="screen">
          ${img ? `<img src="${img}" alt="${escapeHtml(screen.name)}" />` : `<div class="noimg">no screenshot</div>`}
          <div class="screen-body">
            <h3>${escapeHtml(screen.name || screen.id)}</h3>
            ${screen.purpose ? `<p class="purpose">${escapeHtml(screen.purpose)}</p>` : ""}
            <p class="texts">${escapeHtml(screen.visibleTexts.slice(0, 12).join(" · "))}</p>
            <div class="chips">${elements}</div>
            ${transitions ? `<p class="label">Transitions</p><ul>${transitions}</ul>` : ""}
          </div>
        </div>`
    })
  )

  const flowSection = flows
    ? `<h2>Generated test flows (${flows.summary.total})</h2>` +
      flows.flows
        .map((flow) => {
          const run = flowRuns.find((r) => r.flow.id === flow.id)
          const badge = run
            ? `<span class="badge ${run.result.summary.failed === 0 ? "pass" : "fail"}">${run.result.summary.failed === 0 ? "PASS" : "FAIL"}</span>`
            : ""
          const steps = flow.steps
            .map((s) => `<li>${escapeHtml(s.action)}${s.target ? `: ${escapeHtml(s.target)}` : ""} — ${escapeHtml(s.description)}</li>`)
            .join("")
          return `<div class="flow"><h3>${escapeHtml(flow.title)} ${badge}</h3><ul>${steps}</ul></div>`
        })
        .join("")
    : ""

  const failedSteps = flowRuns
    .flatMap((run) => run.result.results.filter((r) => r.status === "failed").map((r) => ({ run, r })))
    .map(
      ({ run, r }) => `
      <div class="failed">
        <strong>${escapeHtml(run.flow.title)}</strong>: ${escapeHtml(r.title)} — ${escapeHtml(r.message)}
        ${r.screenshotDataUrl ? `<br/><img src="${r.screenshotDataUrl}" alt="failure" />` : ""}
      </div>`
    )
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"/><title>App Map Report</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0f11;color:#e5e5e5;margin:0;padding:24px}
    h1{font-size:20px}h2{font-size:16px;margin-top:28px;border-bottom:1px solid #2c2c30;padding-bottom:6px}
    .summary{display:flex;gap:12px;margin:12px 0}
    .card{background:#1c1c1f;border:1px solid #2c2c30;border-radius:8px;padding:10px 16px;text-align:center}
    .card strong{display:block;font-size:20px}
    .screen{display:flex;gap:12px;background:#161618;border:1px solid #2c2c30;border-radius:10px;padding:12px;margin-bottom:12px}
    .screen img{width:120px;border-radius:6px;background:#000}
    .noimg{width:120px;height:200px;display:flex;align-items:center;justify-content:center;color:#555;border:1px dashed #333;border-radius:6px}
    .screen-body h3{margin:0 0 6px}.purpose{color:#93c5fd;margin:2px 0}.texts{color:#94a3b8;font-size:12px}
    .label{color:#64748b;font-size:11px;text-transform:uppercase;margin:8px 0 2px}
    .chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
    .chip{background:#26262b;border:1px solid #3a3a40;border-radius:6px;padding:2px 6px;font-size:11px}
    ul{margin:4px 0;padding-left:18px;font-size:12px;color:#cbd5e1}
    .flow{background:#1c1c1f;border:1px solid #2c2c30;border-radius:8px;padding:10px;margin-bottom:8px}
    .badge{font-size:11px;padding:2px 8px;border-radius:6px}
    .badge.pass{background:#16a34a}.badge.fail{background:#dc2626}
    .failed{background:#2a1515;border:1px solid #5b2121;border-radius:8px;padding:10px;margin-bottom:8px;font-size:12px}
    .failed img{max-width:200px;margin-top:6px;border-radius:6px}
  </style></head><body>
    <h1>App Map Report</h1>
    <div>App: ${escapeHtml(appLabel || appMap.appId)} (${escapeHtml(appMap.appId)})</div>
    <div>Platform: ${escapeHtml(appMap.platform)}</div>
    <div>Generated: ${escapeHtml(new Date().toLocaleString())}</div>
    <div class="summary">
      <div class="card"><strong>${appMap.screens.length}</strong>screens</div>
      <div class="card"><strong>${transitionCount}</strong>transitions</div>
      <div class="card"><strong>${flows?.summary.total ?? 0}</strong>flows</div>
    </div>
    <h2>Discovered screens</h2>
    ${screenCards.join("")}
    ${flowSection}
    ${failedSteps ? `<h2>Failed steps</h2>${failedSteps}` : ""}
  </body></html>`
}
