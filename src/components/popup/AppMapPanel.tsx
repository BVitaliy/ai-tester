import React, { useEffect, useRef, useState } from "react"
import { Boxes, Download, FileSearch, FileText, Map as MapIcon, Play, RotateCcw, ScanSearch, Sparkles, Square } from "lucide-react"

import {
  appMapScreenshotUrl,
  exploreApplication,
  generateTestsFromMap,
  getAppMap,
  getScanStatus,
  runMobileSteps,
  startAppScan,
  stopAppScan,
  type AppMap,
  type AppMapResult,
  type ExploreResult,
  type ExploreRisk,
  type GeneratedFlow,
  type GeneratedFlowsResult,
  type MobileTestRunResult,
  type ScanEvent,
  type ScanJob
} from "../../core/api/mobileAgent"
import { useLanguage } from "../../contexts/LanguageContext"
import type { StringKey } from "../../core/i18n"

type T = (key: StringKey, params?: Record<string, string | number>) => string

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

function statusLabel(t: T, status?: string) {
  switch (status) {
    case "running":
      return t("amStatusRunning")
    case "stopping":
      return t("amStatusStopping")
    case "stopped":
      return t("amStatusStopped")
    case "done":
      return t("amStatusDone")
    case "error":
      return t("amStatusError")
    default:
      return status ?? ""
  }
}

// Server emits English phase strings; map the known ones to localized labels.
function phaseLabel(t: T, phase?: string) {
  switch (phase) {
    case "Launching app…":
      return t("amEvLaunching")
    case "Resuming scan…":
      return t("amEvResuming")
    case "Reading screen":
      return t("amPhaseReading")
    case "Tapping":
      return t("amPhaseTapping")
    case "Opened":
      return t("amPhaseOpened")
    case "Stopped":
      return t("amStatusStopped")
    case "Done":
      return t("amStatusDone")
    case "Error":
      return t("amStatusError")
    default:
      return phase ?? ""
  }
}

function levelLabel(t: T, level: string) {
  if (level === "High") return t("amLevelHigh")
  if (level === "Medium") return t("amLevelMedium")
  if (level === "Low") return t("amLevelLow")
  return level
}

function featLabel(t: T, type: string, fallback: string) {
  const camel = type
    .split("-")
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("")
  const key = ("feat" + camel.charAt(0).toUpperCase() + camel.slice(1)) as StringKey
  const value = t(key)
  return value === key ? fallback : value
}

function flowTypeMeta(t: T, type: string): { label: string; hint: string; color: string } {
  switch (type) {
    case "smoke":
      return { label: t("amTypeSmoke"), hint: t("amTypeSmokeHint"), color: "#22c55e" }
    case "navigation":
      return { label: t("amTypeNavigation"), hint: t("amTypeNavigationHint"), color: "#38bdf8" }
    case "form-validation":
      return { label: t("amTypeForm"), hint: t("amTypeFormHint"), color: "#f59e0b" }
    case "auth":
      return { label: t("amTypeAuth"), hint: t("amTypeAuthHint"), color: "#a78bfa" }
    case "deep-link":
      return { label: t("amTypeDeeplink"), hint: t("amTypeDeeplinkHint"), color: "#64748b" }
    default:
      return { label: type, hint: "", color: "#64748b" }
  }
}

const FLOW_TYPE_ORDER = ["smoke", "auth", "form-validation", "navigation", "deep-link"]

function eventLine(t: T, e: ScanEvent): string | null {
  switch (e.type) {
    case "launch":
      return e.resuming ? t("amEvResuming") : t("amEvLaunching")
    case "screen":
      return t("amEvScreen", { name: e.name ?? e.screenId ?? "" })
    case "action":
      return t("amEvTap", { label: e.label ?? "" })
    case "transition":
      return t("amEvTransition", { name: e.name ?? e.to ?? "", label: e.label ?? "" })
    case "no-transition":
      return t("amEvNoChange", { label: e.label ?? "" })
    case "skip":
      return t("amEvSkipped", { label: e.label ?? "" })
    case "action-error":
      return t("amEvTapFailed", { label: e.label ?? "" })
    case "done":
      return t("amEvDone")
    case "stopped":
      return t("amEvStopped")
    default:
      return null
  }
}

export function AppMapPanel({ deviceId, packageName, appLabel }: Props) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState<null | "map" | "tests" | "run" | "report">(null)
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [job, setJob] = useState<ScanJob | null>(null)
  const [appMap, setAppMap] = useState<AppMap | null>(null)
  const [flows, setFlows] = useState<GeneratedFlowsResult | null>(null)
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])
  const [exploring, setExploring] = useState(false)
  const [explore, setExplore] = useState<ExploreResult | null>(null)

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

  const waitForScanTerminal = async (timeoutMs = 240000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const r = await getScanStatus(deviceId, packageName).catch(() => null)
      if (r?.job) {
        setJob(r.job)
        if (r.job.status !== "running" && r.job.status !== "stopping") return r.job
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return null
  }

  // The headline autonomous action: understand the whole app, then report.
  const handleExplore = async () => {
    if (!ready) return
    setError("")
    setStatus("")
    setExploring(true)
    try {
      let result: ExploreResult
      try {
        result = await exploreApplication({ appId: packageName, deviceId, appLabel })
      } catch {
        setStatus(t("amNoMapScanning"))
        const started = await startAppScan(deviceId, packageName, { options: { goalDriven: true } })
        setJob(started)
        await waitForScanTerminal()
        result = await exploreApplication({ appId: packageName, deviceId, appLabel })
      }
      setExplore(result)
      const m = await getAppMap({ appId: packageName }).catch(() => null)
      if (m) setAppMap(m.appMap)
      setStatus(
        t("amExplored", {
          features: result.features.length,
          risks: result.riskSummary.total,
          confidence: result.confidence
        })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExploring(false)
    }
  }

  const handleDownloadQaReport = () => {
    if (!explore) return
    const blob = new Blob([explore.reportMarkdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    chrome.downloads.download({
      url,
      filename: `qa-report-${packageName}-${Date.now()}.md`,
      saveAs: true
    })
  }

  const handleViewMap = async () => {
    setBusy("map")
    setError("")
    try {
      const result: AppMapResult = await getAppMap({ appId: packageName })
      setAppMap(result.appMap)
      setStatus(
        t("amLoadedMap", {
          screens: result.summary.screenCount,
          transitions: result.summary.transitionCount
        })
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
      setStatus(t("amGeneratedFlows", { n: result.summary.total }))
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
        setStatus(t("amRunningFlow", { i: i + 1, n: runnable.length, title: flow.title }))
        const result = await runMobileSteps(deviceId, packageName, flow.steps)
        runs.push({ flow, result })
        setFlowRuns([...runs])
      }
      const passed = runs.filter((r) => r.result.summary.failed === 0).length
      setStatus(t("amRanFlows", { n: runs.length, passed, failed: runs.length - passed }))
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
      setStatus(t("amMapReportDownloaded"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const scanButton = scanning ? (
    <button style={{ ...btn, borderColor: "#7f1d1d", background: "#3a1f1f" }} onClick={handleStop}>
      <Square size={13} /> {job?.status === "stopping" ? t("amStopping") : t("amStopScan")}
    </button>
  ) : job?.resumable ? (
    <button style={{ ...btn, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => handleScan(true)}>
      <RotateCcw size={13} /> {t("amResumeScan")}
    </button>
  ) : (
    <button style={{ ...btn, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => handleScan(false)}>
      <ScanSearch size={13} /> {t("amScan")}
    </button>
  )

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#e5e5e5", fontSize: 12, fontWeight: 700 }}>
        <Boxes size={14} /> {t("amTitle")}
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>{t("amSubtitle")}</div>

      <button
        style={{
          ...btn,
          justifyContent: "center",
          width: "100%",
          background: "linear-gradient(90deg,#6d28d9,#2563eb)",
          borderColor: "#6d28d9",
          color: "#fff",
          opacity: ready && !exploring && !scanning ? 1 : 0.6,
          padding: "9px 10px"
        }}
        disabled={!ready || exploring || scanning}
        onClick={handleExplore}>
        <Sparkles size={14} /> {exploring ? t("amExploring") : t("amExplore")}
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {scanButton}
        <button style={{ ...btn, opacity: !busy && !scanning ? 1 : 0.5 }} disabled={!!busy || scanning} onClick={handleViewMap}>
          <MapIcon size={13} /> {t("amViewMap")}
        </button>
        <button style={{ ...btn, opacity: !busy && !scanning ? 1 : 0.5 }} disabled={!!busy || scanning} onClick={handleGenerateTests}>
          <FileSearch size={13} /> {t("amGenerateTests")}
        </button>
        <button
          style={{ ...btn, opacity: ready && flows && !busy && !scanning ? 1 : 0.5 }}
          disabled={!ready || !flows || !!busy || scanning}
          onClick={handleRunCriticalFlows}>
          <Play size={13} /> {t("amRunFlows")}
        </button>
        <button
          style={{ ...btn, opacity: appMap && !busy && !scanning ? 1 : 0.5 }}
          disabled={!appMap || !!busy || scanning}
          onClick={handleDownloadReport}>
          <Download size={13} /> {t("amDownloadMapReport")}
        </button>
      </div>

      {job && <ScanProgress job={job} />}

      {status && <div style={{ fontSize: 10, color: "#a3a3a3" }}>{status}</div>}
      {error && <div style={{ fontSize: 10, color: "#f87171" }}>{error}</div>}

      {explore && <ExploreResults result={explore} onDownloadReport={handleDownloadQaReport} />}

      {appMap && <AppMapScreens appMap={appMap} />}

      {flows && <GeneratedFlows flows={flows} flowRuns={flowRuns} />}
    </div>
  )
}

function riskLevelColor(level: string) {
  if (level === "High") return "#dc2626"
  if (level === "Medium") return "#d97706"
  return "#64748b"
}

function ExploreResults({ result, onDownloadReport }: { result: ExploreResult; onDownloadReport: () => void }) {
  const { t } = useLanguage()
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#141417", border: "1px solid #3a2c5a", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Sparkles size={14} color="#a78bfa" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e5e5" }}>{t("amFindings")}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#a78bfa" }}>{t("amConfidence", { n: result.confidence })}</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10 }}>
        <Stat label={t("amFeatures")} value={result.stats.featureCount} color="#a78bfa" />
        <Stat label={t("amScreens")} value={result.stats.screenCount} color="#22c55e" />
        <Stat label={t("amFlows")} value={result.flows.length} color="#38bdf8" />
        <Stat label={t("amTests")} value={result.design.summary.total} color="#e5e5e5" />
      </div>

      <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
        <span style={{ color: "#dc2626", fontWeight: 600 }}>{levelLabel(t, "High")} {result.riskSummary.byLevel.High || 0}</span>
        <span style={{ color: "#d97706", fontWeight: 600 }}>{levelLabel(t, "Medium")} {result.riskSummary.byLevel.Medium || 0}</span>
        <span style={{ color: "#64748b", fontWeight: 600 }}>{levelLabel(t, "Low")} {result.riskSummary.byLevel.Low || 0}</span>
        <span style={{ marginLeft: "auto", color: "#94a3b8" }}>
          {t("amCoverage", { feat: result.coverage.featureCoverage, screens: result.coverage.screenCoverage })}
        </span>
      </div>

      {result.authRequirement?.likelyRequiresAuth && (
        <div style={{ fontSize: 9, color: "#f59e0b" }}>{t("amAuthRequired")}</div>
      )}

      <Section title={t("amSecFeatures")}>
        {result.features.map((f) => (
          <Row key={f.id} left={featLabel(t, f.type, f.name)} right={`${Math.round(f.confidence * 100)}%`} rightColor="#a78bfa" />
        ))}
      </Section>

      <Section title={t("amSecFlows")}>
        {result.flows.map((flow) => (
          <div key={flow.id} style={{ fontSize: 9, color: "#cbd5e1", paddingLeft: 4 }}>
            <b style={{ color: "#e5e5e5" }}>{featLabel(t, flow.featureType, flow.feature)}:</b> {flow.steps.map((s) => s.value).join(" → ")}
          </div>
        ))}
      </Section>

      <Section title={t("amSecRisks", { n: result.riskSummary.total })}>
        {result.risks.slice(0, 6).map((r: ExploreRisk, i) => (
          <div key={i} style={{ display: "flex", gap: 6, fontSize: 9, paddingLeft: 4, alignItems: "baseline" }}>
            <span style={{ color: riskLevelColor(r.level), fontWeight: 700, minWidth: 56 }}>{levelLabel(t, r.level)}</span>
            <span style={{ color: "#94a3b8", minWidth: 70 }}>{r.category}</span>
            <span style={{ color: "#cbd5e1", flex: 1 }}>{r.rationale}</span>
          </div>
        ))}
      </Section>

      <button style={{ ...btn, justifyContent: "center" }} onClick={onDownloadReport}>
        <FileText size={13} /> {t("amDownloadQaReport")}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  )
}

function Row({ left, right, rightColor }: { left: string; right: string; rightColor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, paddingLeft: 4 }}>
      <span style={{ color: "#d4d4d4", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</span>
      <span style={{ color: rightColor, fontWeight: 600 }}>{right}</span>
    </div>
  )
}

function ScanProgress({ job }: { job: ScanJob }) {
  const { t } = useLanguage()
  const active = job.status === "running" || job.status === "stopping"
  const phase = phaseLabel(t, job.current?.phase)
  const detail = job.current?.name || job.current?.action || ""
  const lines = job.events
    .map((e) => eventLine(t, e))
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
        <span style={{ fontSize: 11, fontWeight: 600, color: "#e5e5e5" }}>{statusLabel(t, job.status)}</span>
        <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {phase}
          {detail ? `: ${detail}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10 }}>
        <Stat label={t("amScreens")} value={job.counts.screens} color="#22c55e" />
        <Stat label={t("amTransitions")} value={job.counts.transitions} color="#38bdf8" />
        <Stat label={t("amSkippedUnsafe")} value={job.counts.skipped} color="#f59e0b" />
      </div>

      {job.skippedDangerous.length > 0 && (
        <div style={{ fontSize: 9, color: "#f59e0b" }}>
          {t("amSkippedPrefix")}{Array.from(new Set(job.skippedDangerous.map((s) => s.label))).slice(0, 8).join(", ")}
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

function GeneratedFlows({ flows, flowRuns }: { flows: GeneratedFlowsResult; flowRuns: FlowRun[] }) {
  const { t } = useLanguage()
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
      <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>{t("amGenFlowsTitle", { n: flows.summary.total })}</div>
      {orderedTypes.map((type) => {
        const meta = flowTypeMeta(t, type)
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
                  <span style={{ color: "#64748b", flexShrink: 0 }}>{t("amSteps", { n: flow.steps.length })}</span>
                  {run && (
                    <span style={{ color: run.result.summary.failed === 0 ? "#22c55e" : "#f87171", fontWeight: 600, flexShrink: 0 }}>
                      {run.result.summary.failed === 0 ? t("amPass") : t("amFail", { n: run.result.summary.failed })}
                    </span>
                  )}
                </div>
              )
            })}
            {list.length > shown.length && (
              <div style={{ fontSize: 9, color: "#64748b", paddingLeft: 4 }}>{t("amMore", { n: list.length - shown.length })}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AppMapScreens({ appMap }: { appMap: AppMap }) {
  const { t } = useLanguage()
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
              {t("amClickable", { c: screen.clickableElements.length, t: screen.transitions.length })}
            </div>
            {screen.transitions.length > 0 && (
              <div style={{ fontSize: 9, color: "#38bdf8" }}>
                {screen.transitions
                  .slice(0, 4)
                  .map((tr) => `${tr.action?.label || "?"} → ${nameById.get(tr.toScreenId ?? "") ?? "?"}`)
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
