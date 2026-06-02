import React, { useEffect, useMemo, useState } from "react"
import { ChevronLeft, Play, RefreshCw, Rocket, Smartphone, Zap } from "lucide-react"

import {
  getMobileAgentHealth,
  getMobileApps,
  getMobileDevices,
  startAndroidEmulator,
  startMobileApp,
  type AvailableEmulator,
  type MobileAgentHealth,
  type MobileApp,
  type MobileDevice
} from "../../core/api/mobileAgent"
import { generateTestIdeas } from "../../core/api/aiService"
import type { TestCaseIdea } from "../../core/types"
import { useLanguage } from "../../contexts/LanguageContext"
import { cn } from "../../lib/cn"
import { getSettings } from "../../store/jack"
import { Button } from "../ui/Button"
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

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  )

  const selectedApp = useMemo(
    () => apps.find((app) => app.packageName === selectedPackage) ?? null,
    [apps, selectedPackage]
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
        "Automation plan: use adb/Appium/Maestro-compatible flows. Prefer stable accessibility identifiers, Flutter Semantics identifiers, resource-id, text, content-desc, and avoid raw coordinates unless no better locator exists.",
        prompt.trim() ? `User goal:\n${prompt.trim()}` : "User goal: discover core app flows and propose QA ideas."
      ].join("\n\n")

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
