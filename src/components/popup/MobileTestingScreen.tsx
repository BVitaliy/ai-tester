import React, { useEffect, useMemo, useState } from "react"
import { ChevronLeft, Play, RefreshCw, Rocket, Smartphone, Trash2, Zap } from "lucide-react"

import {
  captureMobileScreenshot,
  getMobileAgentHealth,
  getMobileApps,
  getMobileDevices,
  getMobileElements,
  startAndroidEmulator,
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
  type MobileElement
} from "../../core/api/mobileAgent"
import { generateTestIdeas } from "../../core/api/aiService"
import type { TestCaseIdea } from "../../core/types"
import { useLanguage } from "../../contexts/LanguageContext"
import { cn } from "../../lib/cn"
import { getSettings } from "../../store/jack"
import { ActionCard } from "./ActionCard"
import { Button } from "../ui/Button"
import { CameraIcon, CrosshairIcon, RecordActionsIcon, VideoIcon } from "../ui/icons"
import { VoiceInput } from "../ui/VoiceInput"

interface Props {
  onBack: () => void
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

export function MobileTestingScreen({ onBack }: Props) {
  const { lang } = useLanguage()
  const [health, setHealth] = useState<MobileAgentHealth | null>(null)
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [emulators, setEmulators] = useState<AvailableEmulator[]>([])
  const [apps, setApps] = useState<MobileApp[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [selectedPackage, setSelectedPackage] = useState("")
  const [prompt, setPrompt] = useState("")
  const [ideas, setIdeas] = useState<TestCaseIdea[]>([])
  const [loading, setLoading] = useState(false)
  const [appsLoading, setAppsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileScreenshot, setMobileScreenshot] = useState<string | null>(null)
  const [mobileVideoUrl, setMobileVideoUrl] = useState<string | null>(null)
  const [screenRecording, setScreenRecording] = useState(false)
  const [actionRecording, setActionRecording] = useState(false)
  const [actionSummary, setActionSummary] = useState<MobileActionRecordingResult | null>(null)
  const [elements, setElements] = useState<MobileElement[]>([])
  const [selectedElementId, setSelectedElementId] = useState("")
  const [focusedWindow, setFocusedWindow] = useState("")

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
      setApps([])
      setSelectedDeviceId("")
      setSelectedPackage("")
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
    refresh()
  }, [])

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
        setSelectedPackage("")
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

  const handleScreenshot = async () => {
    if (!selectedDeviceId) return
    setError(null)
    setLoading(true)
    try {
      const result = await captureMobileScreenshot(selectedDeviceId)
      setMobileScreenshot(result.dataUrl)
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
        if (result.screenshotDataUrl) setMobileScreenshot(result.screenshotDataUrl)
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

  const handleGenerateIdeas = async () => {
    setGenerating(true)
    setError(null)
    try {
      const settings = await getSettings()
      const provider = settings?.selectedModels.codeGenProvider ?? "openai"
      const model = settings?.selectedModels.codeGenModel ?? "gpt-4o-mini"
      const context = [
        "Target: mobile application testing.",
        selectedDevice
          ? `Device: ${selectedDevice.name} (${selectedDevice.type}, ${selectedDevice.id}, state: ${selectedDevice.state})`
          : "Device is not selected.",
        selectedApp
          ? `App package: ${selectedApp.packageName}`
          : "App package is not selected.",
        mobileScreenshot ? "A mobile screenshot was captured and is available in the session preview." : null,
        mobileVideoUrl ? "A mobile screen recording was captured and is available in the session preview." : null,
        focusedWindow ? `Focused window/activity: ${focusedWindow}` : null,
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
        "Automation plan: use adb/Appium/Maestro-compatible flows. Prefer stable accessibility identifiers, Flutter Semantics identifiers, resource-id, text, content-desc, and avoid raw coordinates unless no better locator exists.",
        prompt.trim() ? `User goal:\n${prompt.trim()}` : "User goal: discover core app flows and propose QA ideas."
      ].filter(Boolean).join("\n\n")

      setIdeas(await generateTestIdeas({ context, provider, model, lang }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося згенерувати ідеї")
    } finally {
      setGenerating(false)
    }
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
        <button
          onClick={onBack}
          style={{ color: "var(--fg)", opacity: 0.6, display: "flex" }}
          className="hover:opacity-100 transition-opacity">
          <ChevronLeft size={18} />
        </button>
        <Smartphone size={16} style={{ color: "#f87171" }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Mobile testing</span>
        <button
          onClick={refresh}
          disabled={loading}
          style={{ marginLeft: "auto", color: "#f87171", opacity: loading ? 0.5 : 0.85 }}
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
                {device.name} - {device.type} - {device.state}
              </option>
            ))}
          </select>
        </div>

        {emulators.length > 0 && (
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 7 }}>Available emulators</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {emulators.slice(0, 4).map((emulator) => (
                <button
                  key={emulator.name}
                  onClick={() => handleStartEmulator(emulator.name)}
                  disabled={loading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "#d1d5db",
                    padding: "7px 9px",
                    fontSize: 12,
                    cursor: loading ? "not-allowed" : "pointer"
                  }}>
                  <span>{emulator.name}</span>
                  <Rocket size={13} style={{ color: "#f87171" }} />
                </button>
              ))}
            </div>
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
          </div>
        )}

        <div style={panelStyle}>
          <label style={{ display: "block", fontSize: 11, color: "#c2c2c2", marginBottom: 6 }}>Prompt для тестування</label>
          <VoiceInput
            value={prompt}
            onChange={setPrompt}
            placeholder="Наприклад: перевір логін, валідацію форм, onboarding, помилки мережі..."
          />
          <Button
            className="mt-2 w-full"
            disabled={generating}
            loading={generating}
            onClick={handleGenerateIdeas}>
            <Zap size={13} />
            Generate mobile test ideas
          </Button>
        </div>

        {ideas.length > 0 && (
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#c2c2c2", marginBottom: 8 }}>Generated ideas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ideas.map((idea, index) => (
                <div
                  key={idea.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    padding: 8
                  }}>
                  <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700, minWidth: 18 }}>{index + 1}</span>
                  <span style={{ color: "#d1d5db", fontSize: 12, lineHeight: 1.45 }}>{idea.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
