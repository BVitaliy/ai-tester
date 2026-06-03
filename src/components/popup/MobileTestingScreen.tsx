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
  type MobileTestRunResult,
  type MobileTestStatus
} from "../../core/api/mobileAgent"
import { generateMobileSteps, generateTestIdeas } from "../../core/api/aiService"
import type { TestCaseIdea } from "../../core/types"
import { useLanguage } from "../../contexts/LanguageContext"
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

function statusText(health: MobileAgentHealth | null, error: string | null) {
  if (error) return error
  if (!health) return "Перевіряю локальний qa-agent..."
  if (!health.adb) return "qa-agent працює, але adb не знайдено в PATH"
  return `qa-agent ${health.version}: adb ${health.adb ? "ok" : "missing"}, emulator ${health.emulator ? "ok" : "missing"}, appium ${health.appium ? "ok" : "missing"}`
}

function mobileSessionKey(deviceId: string, packageName: string) {
  return `mobile:${deviceId || "device"}:${packageName || "app"}`
}

function testStatusColor(status: MobileTestStatus) {
  if (status === "passed") return "#22c55e"
  if (status === "failed") return "#ef4444"
  return "#f59e0b"
}

function testStatusLabel(status: MobileTestStatus) {
  if (status === "passed") return "Passed"
  if (status === "failed") return "Failed"
  return "Needs support"
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

function elementTarget(element: MobileElement) {
  return element.resourceId || element.contentDesc || element.text || element.label
}

function elementLabel(element: MobileElement) {
  return element.text || element.contentDesc || element.resourceId || element.label
}

export function MobileTestingScreen({ onBack, onOpenCode, onOpenSettings }: Props) {
  const { lang } = useLanguage()
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
          ? `${err.message}. Запусти: pnpm agent`
          : "Не вдалося підключитися до qa-agent"
      )
    } finally {
      setLoading(false)
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
        setError(err instanceof Error ? err.message : "Не вдалося отримати список apps")
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
      setError(err instanceof Error ? err.message : "Не вдалося запустити app")
    } finally {
      setLoading(false)
    }
  }

  const handleStartEmulator = async (name: string) => {
    setError(null)
    setLoading(true)
    try {
      await startAndroidEmulator(name)
      setTimeout(refresh, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити емулятор")
    } finally {
      setLoading(false)
    }
  }

  const handleStartIosSimulator = async (deviceId: string) => {
    setError(null)
    setLoading(true)
    try {
      await startIosSimulator(deviceId)
      setTimeout(refresh, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити iOS Simulator")
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
      setError(err instanceof Error ? err.message : "Не вдалося зробити скріншот app")
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
      setError(err instanceof Error ? err.message : "Не вдалося записати відео app")
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
      setError(err instanceof Error ? err.message : "Не вдалося записати дії app")
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
      setError(err instanceof Error ? err.message : "Не вдалося прочитати UI tree app")
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
      setError(err instanceof Error ? err.message : "Не вдалося натиснути selected element")
    } finally {
      setLoading(false)
    }
  }

  const addRecordedFlowStep = (action: MobileExecutableStep["action"]) => {
    if (!selectedElement) return
    const target = elementTarget(selectedElement).trim()
    if (!target) {
      setError("У вибраного елемента немає стабільного target. Спробуй інший елемент або додай accessibility id в app.")
      return
    }
    const value = action === "input" ? flowInputValue.trim() : undefined
    if (action === "input" && !value) {
      setError("Для input step введи значення, яке треба набрати в полі.")
      return
    }

    const label = elementLabel(selectedElement)
    const description =
      action === "tap"
        ? `Tap ${label}`
        : action === "input"
          ? `Input value into ${label}`
          : action === "assertNotVisible"
            ? `Verify ${label} is not visible`
            : `Verify ${label} is visible`

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

  const deleteRecordedFlowStep = (id: string) => {
    setTestRun(null)
    setRecordedFlowSteps((prev) => prev.filter((step) => step.id !== id))
  }

  const buildMobileContext = () => [
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
    prompt.trim() ? `User goal:\n${prompt.trim()}` : "User goal: discover core app flows and propose QA ideas."
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
      setIdeas(await generateTestIdeas({ context: buildMobileContext(), provider, model, lang }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося згенерувати ідеї")
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
        customPrompt: buildMobileContext(),
        screenshotDataUrl: mobileScreenshot ?? undefined,
        mediaDescription: mobileScreenshot ? "Mobile app screenshot was captured for this QA session." : undefined,
        recordedActions: [],
        generatedFiles: []
      }, sessionKey)
      chrome.runtime.sendMessage({ type: "JACK_GENERATE_MOBILE_CODE", sessionKey }).catch(() => {})
      onOpenCode()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити генерацію mobile tests")
    }
  }

  const runExecutableSteps = async (steps: MobileExecutableStep[], emptyError: string) => {
    let progressTimer: number | undefined
    setTestRun(null)
    setMobileSteps(steps)
    if (!steps.length) {
      setTestProgress({
        phase: "error",
        label: "No executable steps to run.",
        total: 1,
        current: 0
      })
      setError(emptyError)
      return
    }

    const total = Math.max(steps.length + 3, 3)
    setTestProgress({
      phase: "launching-app",
      label: "Launching selected app and preparing automation...",
      total,
      current: 1
    })
    window.setTimeout(() => {
      setTestProgress((prev) =>
        prev.phase === "launching-app"
          ? { ...prev, phase: "reading-ui", label: "Reading mobile UI tree...", current: Math.min(prev.current + 1, prev.total) }
          : prev
      )
    }, 900)
    window.setTimeout(() => {
      setTestProgress((prev) =>
        prev.phase === "reading-ui"
          ? { ...prev, phase: "executing-steps", label: "Executing mobile steps...", current: Math.min(prev.current + 1, prev.total) }
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
        label: "Collecting final screenshot and report...",
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
        label: "Test run complete",
        total,
        current: total
      })
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer)
    }
  }

  const handleRunMobileTests = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    setTesting(true)
    setActiveRunMode("ideas")
    setError(null)
    setTestRun(null)
    setTestProgress({
      phase: "generating-steps",
      label: "Generating executable steps from ideas...",
      total: Math.max(ideas.length, 1),
      current: 0
    })
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      const steps = await generateMobileSteps({
        ideas,
        context: buildMobileContext(),
        provider,
        model,
        lang
      })
      setMobileSteps(steps)
      if (!steps.length) {
        setTestProgress({
          phase: "error",
          label: "No executable steps could be generated. Add exact visible text, accessibility id, or record/select elements.",
          total: 1,
          current: 0
        })
        setError("Не вдалося сформувати executable steps. Додай точний текст кнопки/поля, accessibility id або вибери/запиши елементи app.")
        return
      }
      await runExecutableSteps(
        steps,
        "Не вдалося сформувати executable steps. Додай точний текст кнопки/поля, accessibility id або вибери/запиши елементи app."
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити mobile tests")
      setTestProgress((prev) => ({ ...prev, phase: "error", label: "Test run failed" }))
    } finally {
      setTesting(false)
      setActiveRunMode(null)
    }
  }

  const handleRunPromptFlow = async () => {
    if (!selectedDeviceId || !selectedPackage) return
    const text = prompt.trim()
    if (!text) {
      setError("Опиши flow у prompt, наприклад: перейти на реєстрацію, заповнити поля і натиснути Зареєструватись.")
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
      label: "Converting prompt into executable mobile steps...",
      total: 1,
      current: 0
    })
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      const steps = await generateMobileSteps({
        ideas: [promptIdea],
        context: buildMobileContext(),
        provider,
        model,
        lang
      })
      if (!steps.length) {
        setTestProgress({
          phase: "error",
          label: "No executable steps could be generated from prompt.",
          total: 1,
          current: 0
        })
        setError("Не вдалося перетворити prompt у executable steps. Допоможе точний текст кнопок/полів або натисни “Вибрати елемент app”, щоб runner побачив UI tree.")
        return
      }
      await runExecutableSteps(
        steps,
        "Не вдалося перетворити prompt у executable steps. Додай точний текст кнопок/полів або accessibility id."
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити prompt flow")
      setTestProgress((prev) => ({ ...prev, phase: "error", label: "Prompt flow failed" }))
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
        "Recorded flow порожній. Вибери елемент і додай tap/input/assert кроки."
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося запустити recorded flow")
      setTestProgress((prev) => ({ ...prev, phase: "error", label: "Recorded flow failed" }))
    } finally {
      setTesting(false)
      setActiveRunMode(null)
    }
  }

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
    const idea: TestCaseIdea = { id: crypto.randomUUID(), text: text || "Нова mobile test idea" }
    setIdeas((prev) => [...prev, idea])
    setNewIdeaText("")
    if (!text) setEditingIdeaId(idea.id)
  }

  const handleDownloadReport = () => {
    if (!testRun) return
    const lines = [
      "# Mobile QA Report",
      "",
      `Device: ${selectedDevice?.name ?? selectedDeviceId}`,
      `App: ${selectedApp?.label ?? selectedPackage} (${selectedPackage})`,
      `Platform: ${testRun.platform}`,
      `Duration: ${Math.round(testRun.durationMs / 100) / 10}s`,
      "",
      "## Summary",
      "",
      `- Passed: ${ideaSummary.passed}`,
      `- Failed: ${ideaSummary.failed}`,
      `- Needs support: ${ideaSummary.blocked}`,
      "",
      "## Ideas",
      "",
      ...ideas.map((idea, index) => `${index + 1}. ${idea.text}`),
      "",
      "## Runnable Steps",
      "",
      ...mobileSteps.map((step, index) =>
        `${index + 1}. ${step.action}${step.target ? `: ${step.target}` : ""}${step.value ? ` = ${step.value}` : ""} — ${step.description}`
      ),
      "",
      "## Results",
      "",
      ...testRun.results.flatMap((item) => [
        `### ${item.status.toUpperCase()} — ${item.title}`,
        "",
        item.message,
        item.evidence?.length ? `Evidence: ${item.evidence.join(", ")}` : "",
        item.error ? `Error: ${item.error}` : "",
        ""
      ].filter(Boolean))
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    chrome.downloads.download({
      url,
      filename: `mobile-qa-report-${Date.now()}.md`,
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
          <img
            src={redstoneIcon}
            alt="REDSTONE QA"
            style={{ width: 22, height: 22, display: "block", borderRadius: 6, flexShrink: 0 }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
            <span style={{ color: "#ffffff", fontSize: 13, lineHeight: 1, fontWeight: 800, letterSpacing: "0.04em" }}>REDSTONE</span>
            <span style={{ color: "#c2c2c2", fontSize: 13, lineHeight: 1, fontWeight: 700, letterSpacing: "0.02em" }}>QA</span>
          </div>
          <span style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
          <Smartphone size={15} style={{ color: "#f87171", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>Mobile testing</span>
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
          <div style={{ fontSize: 11, color: error ? "#f87171" : "#c2c2c2", lineHeight: 1.45 }}>
            {statusText(health, error)}
          </div>
        </div>

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>Device</label>
          <select
            value={selectedDeviceId}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
            style={selectStyle}
            disabled={!devices.length}>
            {!devices.length && <option value="">No connected devices</option>}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} - {device.platform ?? "android"} {device.type} - {device.state}
              </option>
            ))}
          </select>
        </div>

        {(emulators.length > 0 || iosSimulators.length > 0) && (
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 7 }}>Launch emulator / simulator</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: iosSimulators.length ? 7 : 0 }}>
              <select
                value={selectedEmulatorName}
                onChange={(event) => setSelectedEmulatorName(event.target.value)}
                style={selectStyle}
                disabled={!emulators.length || loading}>
                {!emulators.length && <option value="">No Android emulators</option>}
                {emulators.map((emulator) => (
                  <option key={emulator.name} value={emulator.name}>{emulator.name}</option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!selectedEmulatorName || loading}
                onClick={() => handleStartEmulator(selectedEmulatorName)}>
                <Rocket size={13} />
                Android
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
                  disabled={
                    !selectedIosSimulatorId ||
                    loading ||
                    iosSimulators.find((simulator) => simulator.id === selectedIosSimulatorId)?.state === "Booted"
                  }
                  onClick={() => handleStartIosSimulator(selectedIosSimulatorId)}>
                  <Rocket size={13} />
                  iOS
                </Button>
              </div>
            )}
          </div>
        )}

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>Application package</label>
          <select
            value={selectedPackage}
            onChange={(event) => setSelectedPackage(event.target.value)}
            style={selectStyle}
            disabled={!apps.length || appsLoading}>
            {appsLoading && <option value="">Loading apps...</option>}
            {!appsLoading && !apps.length && <option value="">No user apps found</option>}
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
            Start selected app
          </Button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ActionCard
            icon={<CameraIcon className="w-9 h-9" />}
            label="Скріншот app"
            onClick={handleScreenshot}
            disabled={!selectedDeviceId || loading}
          />
          <ActionCard
            icon={<VideoIcon className="w-9 h-9" />}
            label={screenRecording ? "Зупинити відео" : "Запис відео app"}
            onClick={toggleScreenRecording}
            danger={screenRecording}
            disabled={!selectedDeviceId || loading}
          />
          <ActionCard
            icon={<RecordActionsIcon className="w-9 h-9" />}
            label={actionRecording ? "Стоп запис дій" : "Запис дій app"}
            onClick={toggleActionRecording}
            danger={actionRecording}
            disabled={!selectedDeviceId || loading}
          />
          <ActionCard
            icon={<CrosshairIcon className="w-9 h-9" />}
            label="Вибрати елемент app"
            onClick={handleSelectElement}
            disabled={!selectedDeviceId || loading}
          />
        </div>

        {(mobileScreenshot || mobileVideoUrl || actionSummary) && (
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#c2c2c2" }}>Mobile capture context</span>
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
                  display: "block",
                  marginBottom: mobileVideoUrl || actionSummary ? 8 : 0
                }}
              />
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
                <div>Before elements: {actionSummary.beforeElementCount}</div>
                {actionSummary.afterElementCount !== undefined && <div>After elements: {actionSummary.afterElementCount}</div>}
                {(actionSummary.afterFocusedWindow || actionSummary.focusedWindow) && (
                  <div style={{ wordBreak: "break-word" }}>Focus: {actionSummary.afterFocusedWindow ?? actionSummary.focusedWindow}</div>
                )}
              </div>
            )}
          </div>
        )}

        {elements.length > 0 && (
          <div style={panelStyle}>
            <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>
              Selected element {focusedWindow ? `- ${focusedWindow}` : ""}
            </label>
            <select
              value={selectedElementId}
              onChange={(event) => setSelectedElementId(event.target.value)}
              style={selectStyle}>
              {elements.slice(0, 80).map((element) => (
                <option key={element.id} value={element.id}>
                  {element.label.slice(0, 80)} {element.clickable ? "- clickable" : ""}
                </option>
              ))}
            </select>
            {selectedElement && (
              <div style={{ color: "#c2c2c2", fontSize: 11, lineHeight: 1.45, marginTop: 7, wordBreak: "break-word" }}>
                <div>{selectedElement.className}</div>
                {selectedElement.resourceId && <div>id: {selectedElement.resourceId}</div>}
                {selectedElement.contentDesc && <div>desc: {selectedElement.contentDesc}</div>}
                <div>bounds: {selectedElement.bounds.raw}</div>
              </div>
            )}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={!selectedElement || loading}
              onClick={handleTapSelectedElement}>
              <Play size={13} />
              Tap selected element
            </Button>
            <div
              style={{
                marginTop: 9,
                paddingTop: 9,
                borderTop: "1px solid var(--border)"
              }}>
              <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>
                Recorded flow builder
              </div>
              <input
                value={flowInputValue}
                onChange={(event) => setFlowInputValue(event.target.value)}
                placeholder="Value for input step..."
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
                  Add tap
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || !flowInputValue.trim() || loading}
                  onClick={() => addRecordedFlowStep("input")}>
                  <Plus size={13} />
                  Add input
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || loading}
                  onClick={() => addRecordedFlowStep("assertVisible")}>
                  <Plus size={13} />
                  Assert visible
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedElement || loading}
                  onClick={() => addRecordedFlowStep("assertNotVisible")}>
                  <Plus size={13} />
                  Assert hidden
                </Button>
              </div>
            </div>
          </div>
        )}

        <div style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#c2c2c2" }}>Recorded flow</span>
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
              Натисни “Вибрати елемент app”, вибери поле або кнопку і додай tap/input/assert кроки. Цей flow можна буде повторно прогнати в app.
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
                    <span style={{ color: "#d1d5db", fontWeight: 600 }}>{step.action}</span>
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
            Run recorded flow
          </Button>
        </div>

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>Prompt для flow / ідей</label>
          <VoiceInput
            value={prompt}
            onChange={setPrompt}
            placeholder="Наприклад: перейти на реєстрацію, заповнити поля, натиснути Зареєструватись..."
          />
          <Button
            className="mt-2 w-full"
            disabled={!selectedDeviceId || !selectedPackage || !prompt.trim() || testing}
            loading={testing && activeRunMode === "prompt"}
            onClick={handleRunPromptFlow}>
            <Play size={13} />
            Run prompt as flow
          </Button>
          <Button
            className="mt-2 w-full"
            disabled={generating}
            loading={generating}
            onClick={handleGenerateIdeas}>
            <Zap size={13} />
            Generate mobile test ideas
          </Button>
        </div>

        <div style={panelStyle}>
          <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 8 }}>Ideas that will be tested</div>
          {ideas.length === 0 && (
            <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>
              Згенеруй ідеї з prompt або додай свої вручну.
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
                placeholder="Додати свою ідею для тесту..."
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
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>Runnable steps</div>
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
                      <span style={{ color: "#f87171", fontWeight: 700 }}>{index + 1}. {step.action}</span>
                      {step.target ? ` → ${step.target}` : ""}
                      {step.value ? ` = ${step.value}` : ""}
                      <div style={{ color: "#64748b", marginTop: 2 }}>{step.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={!selectedDeviceId || !selectedPackage || !ideas.length || testing}
              loading={testing && activeRunMode === "ideas"}
              onClick={handleRunMobileTests}>
              <Play size={13} />
              Test these ideas
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
                            {status === "running" ? "Running" : status === "done" ? "Done" : "Queued"}: {step.description}
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
              Generate mobile test code
            </Button>
          </div>

        {testRun && (
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#c2c2c2" }}>Results for these ideas</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#c2c2c2" }}>{Math.round(testRun.durationMs / 100) / 10}s</span>
                <button
                  onClick={handleDownloadReport}
                  style={{ color: "#f87171", fontSize: 11, fontWeight: 600 }}
                  className="hover:opacity-80 transition-opacity">
                  Report
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
              {[
                ["Passed", ideaSummary.passed, "#22c55e"],
                ["Failed", ideaSummary.failed, "#ef4444"],
                ["Needs support", ideaSummary.blocked, "#f59e0b"]
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
                Needs support означає: runner не знайшов потрібний target або ідея ще не має достатньо конкретних executable steps. Допомагає recorded flow, точний visible text/accessibility id або стабільний selector.
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
                        <div style={{ color: "#d1d5db", fontSize: 12, lineHeight: 1.35 }}>{item.title}</div>
                        <div style={{ color: "#9ca3af", fontSize: 11, lineHeight: 1.35, marginTop: 3 }}>
                          {testStatusLabel(item.status)}: {item.message}
                        </div>
                        {item.error && (
                          <div style={{ color: "#f87171", fontSize: 10, lineHeight: 1.35, marginTop: 3, wordBreak: "break-word" }}>
                            {item.error}
                          </div>
                        )}
                        {item.evidence?.length > 0 && (
                          <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.35, marginTop: 4, wordBreak: "break-word" }}>
                            Evidence: {item.evidence.slice(0, 3).join(", ")}
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
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>Setup checks</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {setupResults.map((item) => (
                    <div key={item.id} style={{ color: "#9ca3af", fontSize: 10, lineHeight: 1.35 }}>
                      <span style={{ color: testStatusColor(item.status) }}>●</span> {item.title}: {item.message}
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
