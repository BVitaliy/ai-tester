import React, { useEffect, useMemo, useState } from "react"
import { ChevronLeft, Play, Plus, RefreshCw, Rocket, Settings, Smartphone, Trash2, Zap } from "lucide-react"

import {
  captureMobileScreenshot,
  getMobileAgentHealth,
  getMobileApps,
  getMobileDevices,
  getMobileElements,
  runMobileSteps,
  startAndroidEmulator,
  startIosSimulator,
  startMobileActionRecording,
  startMobileApp,
  startMobileScreenRecording,
  stopMobileActionRecording,
  stopMobileScreenRecording,
  tapMobileElement,
  type AvailableEmulator,
  type MobileActionRecordingResult,
  type MobileAgentHealth,
  type MobileApp,
  type MobileDevice,
  type MobileElement,
  type MobileExecutableStep,
  type MobileTestResultItem,
  type MobileTestRunResult,
  type MobileTestStatus
} from "../../core/api/mobileAgent"
import { generateMobileSteps, generateTestIdeas } from "../../core/api/aiService"
import type { TestCaseIdea } from "../../core/types"
import { useLanguage } from "../../contexts/LanguageContext"
import type { StringKey } from "../../core/i18n"
import { cn } from "../../lib/cn"
import { compressDataUrl } from "../../lib/screenshotStorage"
import { getSettings, setLastSessionKey, updateSessionState } from "../../store/jack"
import redstoneIcon from "data-base64:~../assets/icon2.png"
import { ActionCard } from "./ActionCard"
import { Button } from "../ui/Button"
import { CameraIcon, CrosshairIcon, RecordActionsIcon, VideoIcon } from "../ui/icons"
import { VoiceInput } from "../ui/VoiceInput"

interface Props {
  onBack?: () => void
  onOpenCode: () => void
  onOpenSettings?: () => void
}

const MOBILE_TESTING_DRAFT_KEY = "mobileTestingDraft"

interface MobileTestingDraft {
  selectedDeviceId?: string
  selectedPackage?: string
  selectedEmulatorName?: string
  selectedIosSimulatorId?: string
  prompt?: string
  ideas?: TestCaseIdea[]
  mobileSteps?: MobileExecutableStep[]
  recordedFlowSteps?: MobileExecutableStep[]
  mobileScreenshot?: string | null
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 12,
  padding: "8px 9px",
  outline: "none"
}

const panelStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--card)",
  padding: 10
}

function statusText(
  health: MobileAgentHealth | null,
  error: string | null,
  t: (key: StringKey, params?: Record<string, string | number>) => string
) {
  if (error) return error
  if (!health) return t("mCheckingAgent")
  if (!health.adb) return t("mAdbMissing")
  return `qa-agent ${health.version}: adb ${health.adb ? t("mOk") : t("mMissing")}, emulator ${health.emulator ? t("mOk") : t("mMissing")}, appium ${health.appium ? t("mOk") : t("mMissing")}`
}

function mobileSessionKey(deviceId: string, packageName: string) {
  return `mobile:${deviceId || "device"}:${packageName || "app"}`
}

function testStatusColor(status: MobileTestStatus) {
  if (status === "passed") return "#22c55e"
  if (status === "failed") return "#ef4444"
  return "#f59e0b"
}

function testStatusLabel(
  status: MobileTestStatus,
  t: (key: StringKey) => string
) {
  if (status === "passed") return t("mPassed")
  if (status === "failed") return t("mFailed")
  return t("mNeedsSupport")
}

function stepActionLabel(
  action: MobileExecutableStep["action"],
  t: (key: StringKey) => string
) {
  if (action === "tap") return t("mActionTap")
  if (action === "input") return t("mActionInput")
  if (action === "assertVisible") return t("mActionAssertVisible")
  if (action === "assertNotVisible") return t("mActionAssertHidden")
  if (action === "wait") return t("mActionWait")
  return t("mActionScroll")
}

function resultTitleLabel(
  id: string,
  fallback: string,
  t: (key: StringKey) => string
) {
  if (id === "launch-app") return t("mSetupLaunchApp")
  if (id === "read-ui-tree") return t("mSetupReadUi")
  if (id === "capture-screenshot") return t("mSetupScreenshot")
  return fallback
}

function resultMessageLabel(
  message: string,
  t: (key: StringKey, params?: Record<string, string | number>) => string
) {
  let match = message.match(/^Waited (\d+)ms$/)
  if (match) return t("mMsgWaited", { ms: match[1] })
  match = message.match(/^Found visible target: (.+)$/)
  if (match) return t("mMsgFoundVisible", { target: match[1] })
  match = message.match(/^Expected visible target was not found: (.+)$/)
  if (match) return t("mMsgExpectedNotFound", { target: match[1] })
  match = message.match(/^Tapped target: (.+)$/)
  if (match) return t("mMsgTapped", { target: match[1] })
  match = message.match(/^Typed into target: (.+)$/)
  if (match) return t("mMsgTyped", { target: match[1] })
  match = message.match(/^Target was not found: (.+)$/)
  if (match) return t("mMsgTargetNotFound", { target: match[1] })
  match = message.match(/^Final screenshot captured$/)
  if (match) return t("mMsgFinalScreenshot")
  match = message.match(/^Could not read UI tree$/)
  if (match) return t("mMsgCouldNotReadUi")
  match = message.match(/^UI tree is empty$/)
  if (match) return t("mMsgUiEmpty")
  match = message.match(/^Read (\d+) UI elements/)
  if (match) return t("mMsgReadUiElements", { n: match[1] })
  match = message.match(/^(.+) launched on (.+)$/)
  if (match) return t("mMsgLaunchedOn", { app: match[1], platform: match[2] })
  match = message.match(/^Could not launch selected app$/)
  if (match) return t("mMsgCouldNotLaunch")
  return message
}

const setupResultIds = new Set(["launch-app", "capture-screenshot", "read-ui-tree"])

type TestProgressPhase =
  | "idle"
  | "generating-steps"
  | "launching-app"
  | "reading-ui"
  | "executing-steps"
  | "collecting-report"
  | "done"
  | "error"

interface TestProgressState {
  phase: TestProgressPhase
  label: string
  total: number
  current: number
}

function progressPercent(progress: TestProgressState) {
  if (progress.phase === "idle") return 0
  if (progress.phase === "done") return 100
  if (progress.total <= 0) return Math.min(95, progress.current)
  return Math.min(95, Math.round((progress.current / progress.total) * 100))
}

function progressStepStatus(index: number, progress: TestProgressState) {
  if (progress.phase === "done") return "done"
  if (progress.phase === "executing-steps") {
    if (index < progress.current) return "done"
    if (index === progress.current) return "running"
  }
  return "queued"
}

function progressStatusColor(status: string) {
  if (status === "done") return "#22c55e"
  if (status === "running") return "#f59e0b"
  return "#64748b"
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function reportStatusColor(status: MobileTestStatus) {
  if (status === "passed") return "#16a34a"
  if (status === "failed") return "#dc2626"
  return "#d97706"
}

function elementTarget(element: MobileElement) {
  return element.resourceId || element.contentDesc || element.text || element.label
}

function elementLabel(element: MobileElement) {
  return element.text || element.contentDesc || element.resourceId || element.label
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildHtmlReport(opts: {
  lang: string
  title: string
  device: string
  app: string
  platform: string
  duration: string
  summary: { passed: number; failed: number; blocked: number }
  ideas: TestCaseIdea[]
  steps: MobileExecutableStep[]
  results: MobileTestResultItem[]
  t: (key: StringKey, params?: Record<string, string | number>) => string
}) {
  const { lang, title, device, app, platform, duration, summary, ideas, steps, results, t } = opts
  const resultsById = new Map(results.map((item) => [item.id, item]))

  const setupRows = results
    .filter((item) => setupResultIds.has(item.id))
    .map((item) => `
      <li>
        <span class="dot" style="background:${reportStatusColor(item.status)}"></span>
        <strong>${escapeHtml(resultTitleLabel(item.id, item.title, t))}</strong>
        <span>${escapeHtml(resultMessageLabel(item.message, t))}</span>
      </li>
    `).join("")

  const stepRows = steps.map((step, index) => {
    const item = resultsById.get(step.id)
    const status = item?.status ?? "blocked"
    const screenshot = item?.screenshotDataUrl
      ? `<img class="shot" src="${item.screenshotDataUrl}" alt="Screenshot for step ${index + 1}" />`
      : `<div class="no-shot">${escapeHtml(item?.screenshotError ?? "No screenshot captured")}</div>`
    return `
      <article class="step">
        <div class="step-head">
          <span class="num">${index + 1}</span>
          <div>
            <h3>${escapeHtml(step.description)}</h3>
            <p>${escapeHtml(stepActionLabel(step.action, t))}${step.target ? ` -> ${escapeHtml(step.target)}` : ""}${step.value ? ` = ${escapeHtml(step.value)}` : ""}</p>
          </div>
          <span class="badge" style="background:${reportStatusColor(status)}">${escapeHtml(testStatusLabel(status, t))}</span>
        </div>
        ${item?.message ? `<p class="message">${escapeHtml(resultMessageLabel(item.message, t))}</p>` : ""}
        ${item?.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ""}
        ${item?.evidence?.length ? `<p class="evidence">${escapeHtml(t("mEvidence"))}: ${item.evidence.map(escapeHtml).join(", ")}</p>` : ""}
        ${screenshot}
      </article>`
  }).join("")

  const unlinkedRows = results
    .filter((item) => !setupResultIds.has(item.id) && !steps.some((step) => step.id === item.id))
    .map((item, index) => `
      <article class="step">
        <div class="step-head">
          <span class="num">${index + 1}</span>
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(resultMessageLabel(item.message, t))}</p>
          </div>
          <span class="badge" style="background:${reportStatusColor(item.status)}">${escapeHtml(testStatusLabel(item.status, t))}</span>
        </div>
        ${item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ""}
        ${item.screenshotDataUrl ? `<img class="shot" src="${item.screenshotDataUrl}" alt="Screenshot" />` : ""}
      </article>
    `).join("")

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --bg:#f9fafb; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--fg); background:var(--bg); }
    main { max-width:1040px; margin:0 auto; padding:28px; }
    header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:22px; }
    h1 { margin:0 0 8px; font-size:26px; }
    h2 { margin:24px 0 12px; font-size:17px; }
    h3 { margin:0 0 4px; font-size:14px; }
    p { margin:0; }
    .meta { color:var(--muted); font-size:13px; line-height:1.6; }
    .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; min-width:330px; }
    .card, .step, .panel { background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px; }
    .card strong { display:block; font-size:24px; }
    .card span { color:var(--muted); font-size:12px; }
    ol { margin:0; padding-left:22px; line-height:1.55; }
    .setup { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
    .setup li { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; }
    .dot { width:9px; height:9px; border-radius:99px; flex:none; }
    .timeline { display:grid; gap:12px; }
    .step-head { display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:start; }
    .num { width:26px; height:26px; border-radius:7px; background:#111827; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
    .badge { color:#fff; border-radius:999px; padding:4px 8px; font-size:11px; font-weight:700; white-space:nowrap; }
    .step-head p, .message, .evidence, .no-shot { color:var(--muted); font-size:12px; line-height:1.5; }
    .message { margin-top:10px; }
    .error { margin-top:8px; color:#dc2626; font-size:12px; }
    .evidence { margin-top:8px; }
    .shot { display:block; width:100%; max-height:760px; object-fit:contain; background:#000; border:1px solid var(--line); border-radius:8px; margin-top:12px; }
    .no-shot { border:1px dashed var(--line); border-radius:8px; padding:12px; margin-top:12px; }
    @media (max-width:760px) { main { padding:16px; } header { display:block; } .cards { grid-template-columns:1fr; min-width:0; margin-top:16px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          <div>${escapeHtml(t("mReportDevice"))}: ${escapeHtml(device)}</div>
          <div>${escapeHtml(t("mReportApp"))}: ${escapeHtml(app)}</div>
          <div>${escapeHtml(t("mReportPlatform"))}: ${escapeHtml(platform)}</div>
          <div>${escapeHtml(t("mReportDuration"))}: ${escapeHtml(duration)}</div>
        </div>
      </div>
      <div class="cards">
        <div class="card"><strong style="color:#16a34a">${summary.passed}</strong><span>${escapeHtml(t("mPassed"))}</span></div>
        <div class="card"><strong style="color:#dc2626">${summary.failed}</strong><span>${escapeHtml(t("mFailed"))}</span></div>
        <div class="card"><strong style="color:#d97706">${summary.blocked}</strong><span>${escapeHtml(t("mNeedsSupport"))}</span></div>
      </div>
    </header>
    <section class="panel">
      <h2>${escapeHtml(t("mReportIdeas"))}</h2>
      <ol>${ideas.map((idea) => `<li>${escapeHtml(idea.text)}</li>`).join("")}</ol>
    </section>
    <h2>${escapeHtml(t("mSetupChecks"))}</h2>
    <ul class="setup">${setupRows}</ul>
    <h2>${escapeHtml(t("mReportSteps"))}</h2>
    <div class="timeline">${stepRows || unlinkedRows || `<div class="panel">${escapeHtml(t("mNoExecutableSteps"))}</div>`}</div>
  </main>
</body>
</html>`
}

export function MobileTestingScreen({ onBack, onOpenCode, onOpenSettings }: Props) {
  const { lang, t } = useLanguage()
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [health, setHealth] = useState<MobileAgentHealth | null>(null)
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [emulators, setEmulators] = useState<AvailableEmulator[]>([])
  const [iosSimulators, setIosSimulators] = useState<MobileDevice[]>([])
  const [apps, setApps] = useState<MobileApp[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [selectedPackage, setSelectedPackage] = useState("")
  const [selectedEmulatorName, setSelectedEmulatorName] = useState("")
  const [selectedIosSimulatorId, setSelectedIosSimulatorId] = useState("")
  const [prompt, setPrompt] = useState("")
  const [ideas, setIdeas] = useState<TestCaseIdea[]>([])
  const [mobileSteps, setMobileSteps] = useState<MobileExecutableStep[]>([])
  const [recordedFlowSteps, setRecordedFlowSteps] = useState<MobileExecutableStep[]>([])
  const [flowInputValue, setFlowInputValue] = useState("")
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null)
  const [newIdeaText, setNewIdeaText] = useState("")
  const [loading, setLoading] = useState(false)
  const [appsLoading, setAppsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [agentStarting, setAgentStarting] = useState(false)
  const [activeRunMode, setActiveRunMode] = useState<"ideas" | "prompt" | "recorded" | null>(null)
  const [testProgress, setTestProgress] = useState<TestProgressState>({
    phase: "idle",
    label: "",
    total: 0,
    current: 0
  })
  const [error, setError] = useState<string | null>(null)
  const [mobileScreenshot, setMobileScreenshot] = useState<string | null>(null)
  const [mobileVideoUrl, setMobileVideoUrl] = useState<string | null>(null)
  const [screenRecording, setScreenRecording] = useState(false)
  const [actionRecording, setActionRecording] = useState(false)
  const [actionSummary, setActionSummary] = useState<MobileActionRecordingResult | null>(null)
  const [elements, setElements] = useState<MobileElement[]>([])
  const [selectedElementId, setSelectedElementId] = useState("")
  const [focusedWindow, setFocusedWindow] = useState("")
  const [testRun, setTestRun] = useState<MobileTestRunResult | null>(null)

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  )

  const selectedApp = useMemo(
    () => apps.find((app) => app.packageName === selectedPackage) ?? null,
    [apps, selectedPackage]
  )

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedElementId) ?? null,
    [elements, selectedElementId]
  )

  const setupResults = useMemo(
    () => testRun?.results.filter((item) => setupResultIds.has(item.id)) ?? [],
    [testRun]
  )

  const ideaResults = useMemo(
    () => testRun?.results.filter((item) => !setupResultIds.has(item.id)) ?? [],
    [testRun]
  )

  const ideaSummary = useMemo(
    () => ({
      passed: ideaResults.filter((item) => item.status === "passed").length,
      failed: ideaResults.filter((item) => item.status === "failed").length,
      blocked: ideaResults.filter((item) => item.status === "blocked").length
    }),
    [ideaResults]
  )

  const runnableIdeaCoverage = useMemo(() => {
    const covered = new Set(
      mobileSteps
        .map((step) => step.ideaId)
        .filter((ideaId): ideaId is string => Boolean(ideaId))
    )
    return {
      covered: ideas.filter((idea) => covered.has(idea.id)).length,
      total: ideas.length
    }
  }, [ideas, mobileSteps])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextHealth, nextDevices] = await Promise.all([
        getMobileAgentHealth(),
        getMobileDevices()
      ])
      setHealth(nextHealth)
      setDevices(nextDevices.connected)
      setEmulators(nextDevices.availableEmulators)
      setIosSimulators(nextDevices.availableIosSimulators ?? [])
      const firstReady = nextDevices.connected.find((device) => device.state === "device")
      setSelectedDeviceId((prev) =>
        prev && nextDevices.connected.some((device) => device.id === prev)
          ? prev
          : firstReady?.id ?? nextDevices.connected[0]?.id ?? ""
      )
    } catch (err) {
      setHealth(null)
      setDevices([])
      setEmulators([])
      setIosSimulators([])
      setApps([])
      setError(
        err instanceof Error
          ? `${err.message}. ${t("mRunAgent")}`
          : t("mErrConnect")
      )
    } finally {
      setLoading(false)
    }
  }

  const loadDevicesSnapshot = async () => {
    const [nextHealth, nextDevices] = await Promise.all([
      getMobileAgentHealth(),
      getMobileDevices()
    ])
    setHealth(nextHealth)
    setDevices(nextDevices.connected)
    setEmulators(nextDevices.availableEmulators)
    setIosSimulators(nextDevices.availableIosSimulators ?? [])
    return nextDevices
  }

  const waitForDevice = async (
    match: (device: MobileDevice) => boolean,
    attempts = 12
  ) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const snapshot = await loadDevicesSnapshot()
      const device = snapshot.connected.find(match)
      if (device) {
        setSelectedDeviceId(device.id)
        return device
      }
      await delay(2500)
    }
    return null
  }

  const handleStartAgent = async () => {
    setAgentStarting(true)
    setError(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: "RDQA_AGENT_CONTROL",
        action: health?.ok ? "restart" : "start"
      })
      if (!response?.ok) {
        throw new Error(response?.error ?? t("mErrStartAgent"))
      }
      if (response.health) setHealth(response.health)
      window.setTimeout(refresh, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrStartAgent"))
    } finally {
      setAgentStarting(false)
    }
  }

  useEffect(() => {
    chrome.storage.local
      .get(MOBILE_TESTING_DRAFT_KEY)
      .then((result) => {
        const draft = result[MOBILE_TESTING_DRAFT_KEY] as MobileTestingDraft | undefined
        if (!draft) return
        setSelectedDeviceId(draft.selectedDeviceId ?? "")
        setSelectedPackage(draft.selectedPackage ?? "")
        setSelectedEmulatorName(draft.selectedEmulatorName ?? "")
        setSelectedIosSimulatorId(draft.selectedIosSimulatorId ?? "")
        setPrompt(draft.prompt ?? "")
        if (Array.isArray(draft.ideas)) setIdeas(draft.ideas)
        if (Array.isArray(draft.mobileSteps)) setMobileSteps(draft.mobileSteps)
        if (Array.isArray(draft.recordedFlowSteps)) setRecordedFlowSteps(draft.recordedFlowSteps)
        setMobileScreenshot(draft.mobileScreenshot ?? null)
      })
      .finally(() => setDraftLoaded(true))

    refresh()
  }, [])

  useEffect(() => {
    if (!draftLoaded) return
    chrome.storage.local
      .set({
        [MOBILE_TESTING_DRAFT_KEY]: {
          selectedDeviceId,
          selectedPackage,
          selectedEmulatorName,
          selectedIosSimulatorId,
          prompt,
          ideas,
          mobileSteps,
          recordedFlowSteps,
          mobileScreenshot
        } satisfies MobileTestingDraft
      })
      .catch(() => {})
  }, [draftLoaded, selectedDeviceId, selectedPackage, selectedEmulatorName, selectedIosSimulatorId, prompt, ideas, mobileSteps, recordedFlowSteps, mobileScreenshot])

  useEffect(() => {
    setSelectedEmulatorName((prev) =>
      prev && emulators.some((emulator) => emulator.name === prev)
        ? prev
        : emulators[0]?.name ?? ""
    )
  }, [emulators])

  useEffect(() => {
    setSelectedIosSimulatorId((prev) =>
      prev && iosSimulators.some((simulator) => simulator.id === prev)
        ? prev
        : iosSimulators.find((simulator) => simulator.state !== "Booted")?.id ?? iosSimulators[0]?.id ?? ""
    )
  }, [iosSimulators])

  useEffect(() => {
    if (!selectedDeviceId) {
      setApps([])
      setSelectedPackage("")
      return
    }

    setAppsLoading(true)
    setError(null)
    getMobileApps(selectedDeviceId)
      .then((result) => {
        setApps(result.apps)
        setSelectedPackage((prev) =>
          prev && result.apps.some((app) => app.packageName === prev)
            ? prev
            : result.apps[0]?.packageName ?? ""
        )
      })
      .catch((err) => {
        setApps([])
        setError(err instanceof Error ? err.message : t("mErrLoadApps"))
      })
      .finally(() => setAppsLoading(false))
  }, [selectedDeviceId])

  const handleStartApp = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    setError(null)
    setLoading(true)
    try {
      await startMobileApp(selectedDeviceId, selectedPackage)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrStartApp"))
    } finally {
      setLoading(false)
    }
  }

  const handleStartEmulator = async (name: string) => {
    setError(null)
    setLoading(true)
    try {
      await startAndroidEmulator(name)
      const device = await waitForDevice(
        (candidate) =>
          candidate.platform === "android" &&
          candidate.type === "emulator" &&
          candidate.state === "device",
        18
      )
      if (!device) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrStartEmulator"))
    } finally {
      setLoading(false)
    }
  }

  const handleStartIosSimulator = async (deviceId: string) => {
    setError(null)
    setLoading(true)
    try {
      await startIosSimulator(deviceId)
      const device = await waitForDevice(
        (candidate) => candidate.platform === "ios" && candidate.id === deviceId && candidate.state === "Booted",
        8
      )
      if (!device) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrStartSimulator"))
    } finally {
      setLoading(false)
    }
  }

  const handleScreenshot = async () => {
    if (!selectedDeviceId) return
    setError(null)
    setLoading(true)
    try {
      const result = await captureMobileScreenshot(selectedDeviceId)
      const compressed = await compressDataUrl(result.dataUrl, 1200, 0.82).catch(() => result.dataUrl)
      setMobileScreenshot(compressed)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrScreenshot"))
    } finally {
      setLoading(false)
    }
  }

  const toggleScreenRecording = async () => {
    if (!selectedDeviceId) return
    setError(null)
    setLoading(true)
    try {
      if (!screenRecording) {
        await startMobileScreenRecording(selectedDeviceId)
        setScreenRecording(true)
      } else {
        const result = await stopMobileScreenRecording(selectedDeviceId)
        setMobileVideoUrl(result.dataUrl)
        setScreenRecording(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrVideo"))
      setScreenRecording(false)
    } finally {
      setLoading(false)
    }
  }

  const toggleActionRecording = async () => {
    if (!selectedDeviceId) return
    setError(null)
    setLoading(true)
    try {
      if (!actionRecording) {
        const result = await startMobileActionRecording(selectedDeviceId)
        setActionSummary(result)
        setActionRecording(true)
      } else {
        const result = await stopMobileActionRecording(selectedDeviceId)
        setActionSummary(result)
        if (result.screenshotDataUrl) {
          const compressed = await compressDataUrl(result.screenshotDataUrl, 1200, 0.82).catch(() => result.screenshotDataUrl!)
          setMobileScreenshot(compressed)
        }
        setActionRecording(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrActions"))
      setActionRecording(false)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectElement = async () => {
    if (!selectedDeviceId) return
    setError(null)
    setLoading(true)
    try {
      const result = await getMobileElements(selectedDeviceId)
      const actionable = result.elements.filter(
        (element) => element.enabled && (element.clickable || element.text || element.contentDesc || element.resourceId)
      )
      setElements(actionable)
      setFocusedWindow(result.focusedWindow)
      setSelectedElementId(actionable[0]?.id ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrReadUI"))
    } finally {
      setLoading(false)
    }
  }

  const handleTapSelectedElement = async () => {
    if (!selectedDeviceId || !selectedElement) return
    setError(null)
    setLoading(true)
    try {
      await tapMobileElement(selectedDeviceId, selectedElement)
      setTimeout(handleSelectElement, 700)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrTapElement"))
    } finally {
      setLoading(false)
    }
  }

  const addRecordedFlowStep = (action: MobileExecutableStep["action"]) => {
    if (!selectedElement) return
    const target = elementTarget(selectedElement).trim()
    if (!target) {
      setError(t("mErrNoTarget"))
      return
    }
    const value = action === "input" ? flowInputValue.trim() : undefined
    if (action === "input" && !value) {
      setError(t("mErrInputEmpty"))
      return
    }

    const label = elementLabel(selectedElement)
    const description =
      action === "tap"
        ? t("mStepTapDesc", { label })
        : action === "input"
          ? t("mStepInputDesc", { label })
          : action === "assertNotVisible"
            ? t("mStepAssertHiddenDesc", { label })
            : t("mStepAssertVisibleDesc", { label })

    setError(null)
    setTestRun(null)
    setRecordedFlowSteps((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        action,
        target,
        value,
        description
      }
    ])
    if (action === "input") setFlowInputValue("")
  }

  const addScrollStep = (direction: "down" | "up") => {
    setTestRun(null)
    setRecordedFlowSteps((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        action: "scroll" as const,
        value: direction,
        description: direction === "down" ? t("mScrollDownDesc") : t("mScrollUpDesc")
      }
    ])
  }

  const deleteRecordedFlowStep = (id: string) => {
    setTestRun(null)
    setRecordedFlowSteps((prev) => prev.filter((step) => step.id !== id))
  }

  const buildMobileContext = (mode: "ideas" | "prompt" | "generate" | "code" = "generate") => [
    "Target: mobile application testing.",
    selectedDevice
      ? `Device: ${selectedDevice.name} (${selectedDevice.platform ?? "android"} ${selectedDevice.type}, ${selectedDevice.id}, state: ${selectedDevice.state})`
      : "Device is not selected.",
    selectedApp
      ? `App package/bundle id: ${selectedApp.packageName}. App label: ${selectedApp.label}.`
      : "App package is not selected.",
    mobileScreenshot ? "A mobile screenshot was captured and is available in the session preview." : null,
    mobileVideoUrl ? "A mobile screen recording was captured and is available in the session preview." : null,
    focusedWindow ? `Focused window/activity: ${focusedWindow}` : null,
    elements.length
      ? `Visible mobile elements:\n${elements
          .slice(0, 60)
          .map((element, index) =>
            `${index + 1}. ${[
              element.label,
              element.className,
              element.resourceId ? `resource-id=${element.resourceId}` : null,
              element.contentDesc ? `content-desc=${element.contentDesc}` : null,
              element.clickable ? "clickable" : null
            ].filter(Boolean).join(" | ")}`
          )
          .join("\n")}`
      : null,
    selectedElement
      ? `Selected mobile element: ${[
          selectedElement.label,
          selectedElement.className,
          selectedElement.resourceId ? `resource-id=${selectedElement.resourceId}` : null,
          selectedElement.contentDesc ? `content-desc=${selectedElement.contentDesc}` : null,
          selectedElement.bounds ? `bounds=${selectedElement.bounds.raw}` : null
        ].filter(Boolean).join(" | ")}`
      : null,
    actionSummary
      ? `Manual mobile interaction recording: before elements=${actionSummary.beforeElementCount}, after elements=${actionSummary.afterElementCount ?? "recording"}, before focus=${actionSummary.beforeFocusedWindow ?? actionSummary.focusedWindow ?? ""}, after focus=${actionSummary.afterFocusedWindow ?? ""}. New visible elements: ${(actionSummary.newElements ?? []).map((element) => element.label).join(", ")}`
      : null,
    "Automation plan: generate Appium/WebdriverIO or Maestro-style mobile tests. Prefer accessibility identifiers, Flutter Semantics identifiers, Android resource-id, iOS accessibility id, text/content-desc/name, and avoid raw coordinates unless no better locator exists.",
    mode === "ideas"
      ? "Execution source: use ONLY the listed Ideas payload as the test instructions. The prompt field is not part of this run."
      : prompt.trim()
        ? `User goal:\n${prompt.trim()}`
        : "User goal: discover core app flows and propose QA ideas."
  ].filter(Boolean).join("\n\n")

  const handleGenerateIdeas = async () => {
    setGenerating(true)
    setError(null)
    setTestRun(null)
    setMobileSteps([])
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      setIdeas(await generateTestIdeas({ context: buildMobileContext("generate"), provider, model, lang }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrGenerateIdeas"))
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateTests = async () => {
    if (!ideas.length) return
    setError(null)
    try {
      const sessionKey = mobileSessionKey(selectedDeviceId, selectedPackage)
      await setLastSessionKey(sessionKey)
      await updateSessionState({
        testIdeas: ideas,
        customPrompt: buildMobileContext("code"),
        screenshotDataUrl: mobileScreenshot ?? undefined,
        mediaDescription: mobileScreenshot ? "Mobile app screenshot was captured for this QA session." : undefined,
        recordedActions: [],
        generatedFiles: []
      }, sessionKey)
      chrome.runtime.sendMessage({ type: "JACK_GENERATE_MOBILE_CODE", sessionKey }).catch(() => {})
      onOpenCode()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrGenerateCode"))
    }
  }

  const runExecutableSteps = async (steps: MobileExecutableStep[], emptyError: string) => {
    let progressTimer: number | undefined
    setTestRun(null)
    setMobileSteps(steps)
    if (!steps.length) {
      setTestProgress({
        phase: "error",
        label: t("mNoExecutableSteps"),
        total: 1,
        current: 0
      })
      setError(emptyError)
      return
    }

    const total = Math.max(steps.length + 3, 3)
    setTestProgress({
      phase: "launching-app",
      label: t("mProgressLaunching"),
      total,
      current: 1
    })
    window.setTimeout(() => {
      setTestProgress((prev) =>
        prev.phase === "launching-app"
          ? { ...prev, phase: "reading-ui", label: t("mProgressReadingUI"), current: Math.min(prev.current + 1, prev.total) }
          : prev
      )
    }, 900)
    window.setTimeout(() => {
      setTestProgress((prev) =>
        prev.phase === "reading-ui"
          ? { ...prev, phase: "executing-steps", label: t("mProgressExecuting"), current: Math.min(prev.current + 1, prev.total) }
          : prev
      )
    }, 2200)
    progressTimer = window.setInterval(() => {
      setTestProgress((prev) => {
        if (prev.phase !== "executing-steps") return prev
        return { ...prev, current: Math.min(prev.current + 1, Math.max(prev.total - 1, 1)) }
      })
    }, 1800)

    try {
      const result = await runMobileSteps(selectedDeviceId, selectedPackage, steps)
      window.clearInterval(progressTimer)
      setTestProgress({
        phase: "collecting-report",
        label: t("mProgressCollecting"),
        total,
        current: Math.max(total - 1, 1)
      })
      if (result.screenshotDataUrl) {
        const compressed = await compressDataUrl(result.screenshotDataUrl, 1200, 0.82).catch(() => result.screenshotDataUrl!)
        result.screenshotDataUrl = compressed
        setMobileScreenshot(compressed)
      }
      setTestRun(result)
      setTestProgress({
        phase: "done",
        label: t("mProgressDone"),
        total,
        current: total
      })
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer)
    }
  }

  const handleRunMobileTests = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    const ideasToTest = ideas.map((idea) => ({ ...idea }))
    if (!ideasToTest.length) return
    setTesting(true)
    setActiveRunMode("ideas")
    setError(null)
    setTestRun(null)
    setMobileSteps([])
    setTestProgress({
      phase: "generating-steps",
      label: t("mProgressGenerating"),
      total: Math.max(ideasToTest.length, 1),
      current: 0
    })
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      const generatedSteps: MobileExecutableStep[] = []
      const context = buildMobileContext("ideas")
      for (let index = 0; index < ideasToTest.length; index += 1) {
        const idea = ideasToTest[index]
        setTestProgress((prev) => ({
          ...prev,
          current: index,
          label: `${t("mProgressGenerating")} ${index + 1}/${ideasToTest.length}`
        }))
        const stepsForIdea = await generateMobileSteps({
          ideas: [idea],
          context,
          provider,
          model,
          lang
        })
        generatedSteps.push(
          ...stepsForIdea.map((step, stepIndex) => ({
            ...step,
            id: step.id || `${idea.id}-step-${stepIndex + 1}`,
            ideaId: idea.id
          }))
        )
        setMobileSteps([...generatedSteps])
      }
      const steps = generatedSteps
      setMobileSteps(steps)
      if (!steps.length) {
        setTestProgress({
          phase: "error",
          label: t("mProgressError"),
          total: 1,
          current: 0
        })
        setError(t("mErrNoSteps"))
        return
      }
      await runExecutableSteps(steps, t("mErrNoSteps"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrNoSteps"))
      setTestProgress((prev) => ({ ...prev, phase: "error", label: t("mProgressError") }))
    } finally {
      setTesting(false)
      setActiveRunMode(null)
    }
  }

  const handleRunPromptFlow = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    const text = prompt.trim()
    if (!text) {
      setError(t("mErrNoPrompt"))
      return
    }
    const promptIdea: TestCaseIdea = { id: crypto.randomUUID(), text }
    setTesting(true)
    setActiveRunMode("prompt")
    setError(null)
    setTestRun(null)
    setIdeas([promptIdea])
    setMobileSteps([])
    setTestProgress({
      phase: "generating-steps",
      label: t("mProgressGenerating"),
      total: 1,
      current: 0
    })
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      const steps = await generateMobileSteps({
        ideas: [promptIdea],
        context: buildMobileContext("prompt"),
        provider,
        model,
        lang
      })
      if (!steps.length) {
        setTestProgress({
          phase: "error",
          label: t("mProgressError"),
          total: 1,
          current: 0
        })
        setError(t("mErrNoStepsPrompt"))
        return
      }
      await runExecutableSteps(steps, t("mErrNoStepsPrompt"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mErrNoStepsPrompt"))
      setTestProgress((prev) => ({ ...prev, phase: "error", label: t("mProgressError") }))
    } finally {
      setTesting(false)
      setActiveRunMode(null)
    }
  }

  const handleRunRecordedFlow = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    setTesting(true)
    setActiveRunMode("recorded")
    setError(null)
    setTestRun(null)
    try {
      await runExecutableSteps(
        recordedFlowSteps,
        t("mRecordedFlowEmpty")
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mProgressError"))
      setTestProgress((prev) => ({ ...prev, phase: "error", label: t("mProgressError") }))
    } finally {
      setTesting(false)
      setActiveRunMode(null)
    }
  }

  useEffect(() => {
    if (!testing || !selectedDeviceId) return
    const interval = window.setInterval(async () => {
      try {
        const shot = await captureMobileScreenshot(selectedDeviceId)
        const compressed = await compressDataUrl(shot.dataUrl, 1200, 0.82).catch(() => shot.dataUrl)
        setMobileScreenshot(compressed)
      } catch {
        // ignore poll errors during test execution
      }
    }, 2500)
    return () => window.clearInterval(interval)
  }, [testing, selectedDeviceId])

  const handleEditIdea = (id: string, text: string) => {
    setTestRun(null)
    setMobileSteps([])
    setIdeas((prev) => prev.map((idea) => idea.id === id ? { ...idea, text } : idea))
  }

  const handleDeleteIdea = (id: string) => {
    setTestRun(null)
    setMobileSteps([])
    setIdeas((prev) => prev.filter((idea) => idea.id !== id))
    if (editingIdeaId === id) setEditingIdeaId(null)
  }

  const handleAddIdea = () => {
    setTestRun(null)
    setMobileSteps([])
    const text = newIdeaText.trim()
    const idea: TestCaseIdea = { id: crypto.randomUUID(), text: text || t("mNewIdeaDefault") }
    setIdeas((prev) => [...prev, idea])
    setNewIdeaText("")
    if (!text) setEditingIdeaId(idea.id)
  }

  const handleDownloadReport = () => {
    if (!testRun) return
    const html = buildHtmlReport({
      lang,
      title: t("mReportTitle"),
      device: selectedDevice?.name ?? selectedDeviceId,
      app: `${selectedApp?.label ?? selectedPackage} (${selectedPackage})`,
      platform: testRun.platform,
      duration: `${Math.round(testRun.durationMs / 100) / 10}s`,
      summary: ideaSummary,
      ideas,
      steps: mobileSteps,
      results: testRun.results,
      t
    })
    const blob = new Blob([html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    chrome.downloads.download({
      url,
      filename: `mobile-qa-report-${Date.now()}.html`,
      saveAs: true
    })
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  return (
    <div
      style={{
        width: 440,
        maxHeight: 580,
        backgroundColor: "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column"
      }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--card)"
        }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{ color: "var(--fg)", opacity: 0.6, display: "flex" }}
            className="hover:opacity-100 transition-opacity">
            <ChevronLeft size={18} />
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <a
            href="https://redstone.agency/"
            target="_blank"
            rel="noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, textDecoration: "none" }}>
            <img
              src={redstoneIcon}
              alt="REDSTONE QA"
              style={{ width: 22, height: 22, display: "block", borderRadius: 6, flexShrink: 0 }}
            />
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
              <span style={{ color: "#ffffff", fontSize: 13, lineHeight: 1, fontWeight: 800, letterSpacing: "0.04em" }}>REDSTONE</span>
              <span style={{ color: "#c2c2c2", fontSize: 13, lineHeight: 1, fontWeight: 700, letterSpacing: "0.02em" }}>QA</span>
            </div>
          </a>
          <span style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
          <Smartphone size={15} style={{ color: "#f87171", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>{t("mMobileTitle")}</span>
        </div>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            style={{ marginLeft: "auto", color: "var(--fg)", opacity: 0.65, display: "flex" }}
            className="hover:opacity-100 transition-opacity">
            <Settings size={15} />
          </button>
        )}
        <button
          onClick={refresh}
          disabled={loading}
          style={{ marginLeft: onOpenSettings ? 0 : "auto", color: "#f87171", opacity: loading ? 0.5 : 0.85 }}
          className="hover:opacity-100 transition-opacity">
          <RefreshCw size={15} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      <div className="jack-scroll" style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={panelStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: error ? "#f87171" : "#c2c2c2", lineHeight: 1.45, minWidth: 0 }}>
              {agentStarting ? t("mAgentStarting") : statusText(health, error, t)}
            </div>
            <Button
              size="sm"
              className="whitespace-nowrap"
              disabled={agentStarting}
              loading={agentStarting}
              onClick={handleStartAgent}>
              <Rocket size={12} />
              {health?.ok ? t("mRestartAgent") : t("mStartAgent")}
            </Button>
          </div>
        </div>

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>{t("mDevice")}</label>
          <select
            value={selectedDeviceId}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
            style={selectStyle}
            disabled={!devices.length}>
            {!devices.length && <option value="">{t("mNoDevices")}</option>}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} - {device.platform ?? "android"} {device.type} - {device.state}
              </option>
            ))}
          </select>
        </div>

        {(emulators.length > 0 || iosSimulators.length > 0) && (
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 7 }}>{t("mLaunchSim")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: iosSimulators.length ? 7 : 0 }}>
              <select
                value={selectedEmulatorName}
                onChange={(event) => setSelectedEmulatorName(event.target.value)}
                style={selectStyle}
                disabled={!emulators.length || loading}>
                {!emulators.length && <option value="">{t("mNoAndroidEmus")}</option>}
                {emulators.map((emulator) => (
                  <option key={emulator.name} value={emulator.name}>{emulator.name}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                className="w-[96px]"
                disabled={!selectedEmulatorName || loading}
                onClick={() => handleStartEmulator(selectedEmulatorName)}>
                <Rocket size={13} />
                {t("mBtnAndroid")}
              </Button>
            </div>
            {iosSimulators.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                <select
                  value={selectedIosSimulatorId}
                  onChange={(event) => setSelectedIosSimulatorId(event.target.value)}
                  style={selectStyle}
                  disabled={!iosSimulators.length || loading}>
                  {iosSimulators.map((simulator) => (
                    <option key={simulator.id} value={simulator.id}>
                      {simulator.name} - {simulator.state}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-[96px]"
                  disabled={
                    !selectedIosSimulatorId ||
                    loading ||
                    iosSimulators.find((simulator) => simulator.id === selectedIosSimulatorId)?.state === "Booted"
                  }
                  onClick={() => handleStartIosSimulator(selectedIosSimulatorId)}>
                  <Rocket size={13} />
                  {t("mBtnIos")}
                </Button>
              </div>
            )}
          </div>
        )}

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>{t("mAppPackage")}</label>
          <select
            value={selectedPackage}
            onChange={(event) => setSelectedPackage(event.target.value)}
            style={selectStyle}
            disabled={!apps.length || appsLoading}>
            {appsLoading && <option value="">{t("mLoadingApps")}</option>}
            {!appsLoading && !apps.length && <option value="">{t("mNoApps")}</option>}
            {!appsLoading &&
              apps.map((app) => (
                <option key={app.packageName} value={app.packageName}>
                  {app.label}
                </option>
              ))}
          </select>
          <Button
            className="mt-2 w-full"
            size="sm"
            disabled={!selectedDeviceId || !selectedPackage || loading}
            onClick={handleStartApp}>
            <Play size={13} />
            {t("mStartApp")}
          </Button>
        </div>

        <div style={panelStyle}>
          <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 4 }}>{t("mContextTitle")}</div>
          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45, marginBottom: 8 }}>{t("mContextHint")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <ActionCard
              icon={<CameraIcon className="w-9 h-9" />}
              label={t("mAppScreenshot")}
              onClick={handleScreenshot}
              disabled={!selectedDeviceId || loading}
            />
            <ActionCard
              icon={<CrosshairIcon className="w-9 h-9" />}
              label={t("mSelectElement")}
              onClick={handleSelectElement}
              disabled={!selectedDeviceId || loading}
            />
            <ActionCard
              icon={<RecordActionsIcon className="w-9 h-9" />}
              label={actionRecording ? t("mActionsStop") : t("mActionsStart")}
              onClick={toggleActionRecording}
              danger={actionRecording}
              disabled={!selectedDeviceId || loading}
            />
            <ActionCard
              icon={<VideoIcon className="w-9 h-9" />}
              label={screenRecording ? t("mVideoStop") : t("mVideoStart")}
              onClick={toggleScreenRecording}
              danger={screenRecording}
              disabled={!selectedDeviceId || loading}
            />
          </div>
        </div>

        {(mobileScreenshot || mobileVideoUrl || actionSummary) && (
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#c2c2c2" }}>{t("mContextTitle")}</span>
              <button
                onClick={() => {
                  setMobileScreenshot(null)
                  setMobileVideoUrl(null)
                  setActionSummary(null)
                }}
                style={{ color: "#f87171", opacity: 0.8 }}
                className="hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            </div>
            {mobileScreenshot && (
              <div style={{ position: "relative", marginBottom: mobileVideoUrl || actionSummary ? 8 : 0 }}>
                <img
                  src={mobileScreenshot}
                  alt="Mobile screenshot"
                  style={{
                    width: "100%",
                    maxHeight: 220,
                    objectFit: "contain",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "#000",
                    display: "block"
                  }}
                />
                {testing && (
                  <div style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: "2px 5px",
                    letterSpacing: "0.05em"
                  }}>
                    {t("mLive")}
                  </div>
                )}
              </div>
            )}
            {mobileVideoUrl && (
              <video
                src={mobileVideoUrl}
                controls
                style={{
                  width: "100%",
                  maxHeight: 220,
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "#000",
                  display: "block",
                  marginBottom: actionSummary ? 8 : 0
                }}
              />
            )}
            {actionSummary && (
              <div style={{ color: "#c2c2c2", fontSize: 11, lineHeight: 1.45 }}>
                <div>{t("mBeforeElements", { n: actionSummary.beforeElementCount })}</div>
                {actionSummary.afterElementCount !== undefined && <div>{t("mAfterElements", { n: actionSummary.afterElementCount })}</div>}
                {(actionSummary.afterFocusedWindow || actionSummary.focusedWindow) && (
                  <div style={{ wordBreak: "break-word" }}>{t("mFocusWindow", { w: String(actionSummary.afterFocusedWindow ?? actionSummary.focusedWindow ?? "") })}</div>
                )}
              </div>
            )}
          </div>
        )}

        {elements.length > 0 && (
          <div style={panelStyle}>
            <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>
              {t("mElementLabel")}{focusedWindow ? ` — ${focusedWindow}` : ""}
            </label>
            <select
              value={selectedElementId}
              onChange={(event) => setSelectedElementId(event.target.value)}
              style={selectStyle}>
              {elements.slice(0, 80).map((element) => (
                <option key={element.id} value={element.id}>
                  {element.label.slice(0, 80)} {element.clickable ? `- ${t("mClickable")}` : ""}
                </option>
              ))}
            </select>
            {selectedElement && (
              <div style={{ color: "#c2c2c2", fontSize: 11, lineHeight: 1.45, marginTop: 7, wordBreak: "break-word" }}>
                <div>{selectedElement.className}</div>
                {selectedElement.resourceId && <div>{t("mElementId")}: {selectedElement.resourceId}</div>}
                {selectedElement.contentDesc && <div>{t("mElementDesc")}: {selectedElement.contentDesc}</div>}
                <div>{t("mElementBounds")}: {selectedElement.bounds.raw}</div>
              </div>
            )}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={!selectedElement || loading}
              onClick={handleTapSelectedElement}>
              <Play size={13} />
              {t("mTapElement")}
            </Button>
            <div
              style={{
                marginTop: 9,
                paddingTop: 9,
                borderTop: "1px solid var(--border)"
              }}>
              <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 3 }}>
                {t("mFlowBuilderTitle")}
              </div>
              <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.4, marginBottom: 7 }}>
                {t("mFlowBuilderHint")}
              </div>
              <input
                value={flowInputValue}
                onChange={(event) => setFlowInputValue(event.target.value)}
                placeholder={t("mInputValue")}
                style={{
                  width: "100%",
                  minWidth: 0,
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 12,
                  padding: "7px 8px",
                  outline: "none",
                  marginBottom: 6
                }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Button
                  size="sm"
                  disabled={!selectedElement || loading}
                  onClick={() => addRecordedFlowStep("tap")}>
                  <Plus size={13} />
                  {t("mAddTap")}
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || !flowInputValue.trim() || loading}
                  onClick={() => addRecordedFlowStep("input")}>
                  <Plus size={13} />
                  {t("mAddInput")}
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || loading}
                  onClick={() => addRecordedFlowStep("assertVisible")}>
                  <Plus size={13} />
                  {t("mAssertVisible")}
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || loading}
                  onClick={() => addRecordedFlowStep("assertNotVisible")}>
                  <Plus size={13} />
                  {t("mAssertHidden")}
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedDeviceId || loading}
                  onClick={() => addScrollStep("down")}>
                  <Plus size={13} />
                  {t("mScrollDown")}
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedDeviceId || loading}
                  onClick={() => addScrollStep("up")}>
                  <Plus size={13} />
                  {t("mScrollUp")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#c2c2c2" }}>{t("mRecordedFlowTitle")}</span>
            {recordedFlowSteps.length > 0 && (
              <button
                onClick={() => {
                  setRecordedFlowSteps([])
                  setTestRun(null)
                }}
                style={{ color: "#f87171", opacity: 0.8 }}
                className="hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {recordedFlowSteps.length === 0 && (
            <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>
              {t("mRecordedFlowEmpty")}
            </div>
          )}
          {recordedFlowSteps.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
              {recordedFlowSteps.map((step, index) => (
                <div
                  key={step.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    padding: "6px 7px"
                  }}>
                  <span style={{ color: "#f87171", fontSize: 10, fontWeight: 700, minWidth: 16 }}>{index + 1}</span>
                  <div style={{ minWidth: 0, flex: 1, color: "#9ca3af", fontSize: 10, lineHeight: 1.35, wordBreak: "break-word" }}>
                    <span style={{ color: "#d1d5db", fontWeight: 600 }}>{stepActionLabel(step.action, t)}</span>
                    {step.target ? ` → ${step.target}` : ""}
                    {step.value ? ` = ${step.value}` : ""}
                    <div style={{ color: "#64748b", marginTop: 2 }}>{step.description}</div>
                  </div>
                  <button
                    onClick={() => deleteRecordedFlowStep(step.id)}
                    style={{ color: "#f87171", opacity: 0.75, paddingTop: 1 }}
                    className="hover:opacity-100 transition-opacity">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            className="w-full"
            size="sm"
            disabled={!selectedDeviceId || !selectedPackage || !recordedFlowSteps.length || testing}
            loading={testing && activeRunMode === "recorded"}
            onClick={handleRunRecordedFlow}>
            <Play size={13} />
            {t("mRunRecordedFlow")}
          </Button>
        </div>

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>{t("mPromptLabel")}</label>
          <VoiceInput
            value={prompt}
            onChange={setPrompt}
            placeholder={t("mPromptPlaceholder")}
          />
          <Button
            className="mt-2 w-full"
            disabled={!selectedDeviceId || !selectedPackage || !prompt.trim() || testing}
            loading={testing && activeRunMode === "prompt"}
            onClick={handleRunPromptFlow}>
            <Play size={13} />
            {t("mRunPrompt")}
          </Button>
          {prompt.trim() && elements.length === 0 && !testing && (
            <div style={{
              marginTop: 6,
              padding: "6px 9px",
              borderRadius: 7,
              background: "#1c1917",
              border: "1px solid #78350f",
              color: "#fbbf24",
              fontSize: 10,
              lineHeight: 1.4
            }}>
              {t("mHintSelectBeforePrompt")}
            </div>
          )}
          <Button
            className="mt-2 w-full"
            disabled={generating}
            loading={generating}
            onClick={handleGenerateIdeas}>
            <Zap size={13} />
            {t("mGenerateIdeas")}
          </Button>
        </div>

        <div style={panelStyle}>
          <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 8 }}>{t("mIdeasTitle")}</div>
          {ideas.length === 0 && (
            <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>
              {t("mIdeasEmpty")}
            </div>
          )}
          {ideas.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ideas.map((idea, index) => (
                <div
                  key={idea.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    padding: 8
                  }}>
                  <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700, minWidth: 18 }}>{index + 1}</span>
                  {editingIdeaId === idea.id ? (
                    <textarea
                      value={idea.text}
                      onChange={(event) => handleEditIdea(idea.id, event.target.value)}
                      onBlur={() => setEditingIdeaId(null)}
                      rows={2}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        resize: "vertical",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "#d1d5db",
                        fontSize: 12,
                        lineHeight: 1.45,
                        fontFamily: "inherit"
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setEditingIdeaId(idea.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        color: "#d1d5db",
                        fontSize: 12,
                        lineHeight: 1.45,
                        wordBreak: "break-word"
                      }}>
                      {idea.text}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteIdea(idea.id)}
                    style={{ color: "#f87171", opacity: 0.75, paddingTop: 1 }}
                    className="hover:opacity-100 transition-opacity">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 8 }}>
              <textarea
                value={newIdeaText}
                onChange={(event) => setNewIdeaText(event.target.value)}
                rows={2}
                placeholder={t("mAddIdeaHint")}
                style={{
                  width: "100%",
                  minWidth: 0,
                  resize: "vertical",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  padding: "7px 8px",
                  outline: "none",
                  fontFamily: "inherit"
                }}
              />
              <Button
                size="sm"
                onClick={handleAddIdea}>
                <Plus size={13} />
              </Button>
            </div>
            {mobileSteps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>{t("mRunnableSteps")}</div>
                {ideas.length > 0 && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 5 }}>
                    {t("mRunnableCoverage", {
                      done: runnableIdeaCoverage.covered,
                      total: runnableIdeaCoverage.total
                    })}
                    {runnableIdeaCoverage.covered < runnableIdeaCoverage.total && (
                      <span style={{ color: "#fbbf24" }}>
                        {" "}
                        {t("mRunnableNeedsSupport", {
                          n: runnableIdeaCoverage.total - runnableIdeaCoverage.covered
                        })}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {mobileSteps.slice(0, 12).map((step, index) => (
                    <div
                      key={step.id}
                      style={{
                        borderRadius: 7,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "#9ca3af",
                        fontSize: 10,
                        lineHeight: 1.35,
                        padding: "5px 7px"
                      }}>
                      <span style={{ color: "#f87171", fontWeight: 700 }}>{index + 1}. {stepActionLabel(step.action, t)}</span>
                      {step.target ? ` → ${step.target}` : ""}
                      {step.value ? ` = ${step.value}` : ""}
                      <div style={{ color: "#64748b", marginTop: 2 }}>{step.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ideas.length > 0 && elements.length === 0 && !testing && (
              <div style={{
                marginTop: 8,
                padding: "7px 9px",
                borderRadius: 7,
                background: "#1c1917",
                border: "1px solid #78350f",
                color: "#fbbf24",
                fontSize: 11,
                lineHeight: 1.45
              }}>
                {t("mHintSelectBeforeIdeas")}
              </div>
            )}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={!selectedDeviceId || !selectedPackage || !ideas.length || testing}
              loading={testing && activeRunMode === "ideas"}
              onClick={handleRunMobileTests}>
              <Play size={13} />
              {t("mRunIdeas")}
            </Button>
            {(testing || testProgress.phase === "done" || testProgress.phase === "error") && testProgress.phase !== "idle" && (
              <div
                style={{
                  marginTop: 8,
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  padding: 8
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <span style={{ color: "#d1d5db", fontSize: 11, lineHeight: 1.35 }}>{testProgress.label}</span>
                  <span style={{ color: "#9ca3af", fontSize: 10 }}>{progressPercent(testProgress)}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: "#1f2937", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${progressPercent(testProgress)}%`,
                      height: "100%",
                      borderRadius: 99,
                      background: testProgress.phase === "error" ? "#ef4444" : "#f87171",
                      transition: "width 0.25s ease"
                    }}
                  />
                </div>
                {mobileSteps.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                    {mobileSteps.slice(0, 8).map((step, index) => {
                      const status = progressStepStatus(index + 3, testProgress)
                      return (
                        <div key={step.id} style={{ display: "flex", gap: 6, color: "#9ca3af", fontSize: 10, lineHeight: 1.35 }}>
                          <span style={{ color: progressStatusColor(status) }}>●</span>
                          <span style={{ color: status === "running" ? "#d1d5db" : "#9ca3af" }}>
                            {status === "running" ? "▶" : status === "done" ? "✓" : "○"} {step.description}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={!ideas.length}
              onClick={handleGenerateTests}>
              <Zap size={13} />
              {t("mGenerateCode")}
            </Button>
          </div>

        {testRun && (
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#c2c2c2" }}>{t("mResultsTitle")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#c2c2c2" }}>{Math.round(testRun.durationMs / 100) / 10}s</span>
                <button
                  onClick={handleDownloadReport}
                  style={{ color: "#f87171", fontSize: 11, fontWeight: 600 }}
                  className="hover:opacity-80 transition-opacity">
                  {t("mReportBtn")}
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
              {[
                [t("mPassed"), ideaSummary.passed, "#22c55e"],
                [t("mFailed"), ideaSummary.failed, "#ef4444"],
                [t("mNeedsSupport"), ideaSummary.blocked, "#f59e0b"]
              ].map(([label, count, color]) => (
                <div
                  key={label}
                  style={{
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    padding: "6px 7px"
                  }}>
                  <div style={{ color: color as string, fontSize: 14, fontWeight: 700 }}>{count}</div>
                  <div style={{ color: "#9ca3af", fontSize: 10 }}>{label}</div>
                </div>
              ))}
            </div>
            {ideaSummary.blocked > 0 && (
              <div style={{ color: "#f59e0b", fontSize: 11, lineHeight: 1.4, marginBottom: 8 }}>
                {t("mNeedsSupportHint")}
              </div>
            )}
            {ideaResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: setupResults.length ? 8 : 0 }}>
                {ideaResults.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      borderRadius: 7,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      padding: 8
                    }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 99,
                          background: testStatusColor(item.status),
                          flexShrink: 0,
                          marginTop: 5
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: "#d1d5db", fontSize: 12, lineHeight: 1.35 }}>{resultTitleLabel(item.id, item.title, t)}</div>
                        <div style={{ color: "#9ca3af", fontSize: 11, lineHeight: 1.35, marginTop: 3 }}>
                          {testStatusLabel(item.status, t)}: {resultMessageLabel(item.message, t)}
                        </div>
                        {item.error && (
                          <div style={{ color: "#f87171", fontSize: 10, lineHeight: 1.35, marginTop: 3, wordBreak: "break-word" }}>
                            {item.error}
                          </div>
                        )}
                        {item.evidence?.length > 0 && (
                          <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.35, marginTop: 4, wordBreak: "break-word" }}>
                            {t("mEvidence")}: {item.evidence.slice(0, 3).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {setupResults.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>{t("mSetupChecks")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {setupResults.map((item) => (
                    <div key={item.id} style={{ color: "#9ca3af", fontSize: 10, lineHeight: 1.35 }}>
                      <span style={{ color: testStatusColor(item.status) }}>●</span> {resultTitleLabel(item.id, item.title, t)}: {resultMessageLabel(item.message, t)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
