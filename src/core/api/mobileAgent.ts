const DEFAULT_AGENT_URL = "http://127.0.0.1:17321"

export interface MobileAgentHealth {
  ok: boolean
  version: string
  adb: boolean
  emulator: boolean
  appium: boolean
}

export interface MobileDevice {
  id: string
  name: string
  state: string
  type: "usb" | "emulator"
  details: Record<string, string>
}

export interface AvailableEmulator {
  name: string
}

export interface MobileApp {
  packageName: string
  label: string
}

export interface MobileDevicesResult {
  connected: MobileDevice[]
  availableEmulators: AvailableEmulator[]
}

export interface MobileElementBounds {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  raw: string
}

export interface MobileElement {
  id: string
  text: string
  contentDesc: string
  resourceId: string
  className: string
  packageName: string
  clickable: boolean
  enabled: boolean
  focusable: boolean
  bounds: MobileElementBounds
  label: string
}

export interface MobileUiResult {
  xml: string
  elements: MobileElement[]
  focusedWindow: string
}

export interface MobileScreenshotResult {
  ok: boolean
  dataUrl: string
}

export interface MobileScreenRecordStopResult {
  ok: boolean
  mimeType: string
  dataUrl: string
  durationMs: number
}

export interface MobileActionRecordingResult {
  ok: boolean
  startedAt: number
  stoppedAt?: number
  durationMs?: number
  beforeElementCount: number
  afterElementCount?: number
  beforeFocusedWindow?: string
  afterFocusedWindow?: string
  focusedWindow?: string
  newElements?: MobileElement[]
  screenshotDataUrl?: string | null
}

async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DEFAULT_AGENT_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error ?? `qa-agent request failed: ${res.status}`
    throw new Error(message)
  }
  return data as T
}

export function getMobileAgentHealth(): Promise<MobileAgentHealth> {
  return agentFetch<MobileAgentHealth>("/health")
}

export function getMobileDevices(): Promise<MobileDevicesResult> {
  return agentFetch<MobileDevicesResult>("/devices")
}

export function getMobileApps(deviceId: string): Promise<{ apps: MobileApp[] }> {
  const params = new URLSearchParams({ deviceId })
  return agentFetch<{ apps: MobileApp[] }>(`/apps?${params}`)
}

export function startMobileApp(deviceId: string, packageName: string): Promise<{ ok: boolean }> {
  return agentFetch<{ ok: boolean }>("/apps/start", {
    method: "POST",
    body: JSON.stringify({ deviceId, packageName })
  })
}

export function startAndroidEmulator(name: string): Promise<{ ok: boolean }> {
  return agentFetch<{ ok: boolean }>("/emulators/start", {
    method: "POST",
    body: JSON.stringify({ name })
  })
}

export function captureMobileScreenshot(deviceId: string): Promise<MobileScreenshotResult> {
  return agentFetch<MobileScreenshotResult>("/capture/screenshot", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}

export function getMobileElements(deviceId: string): Promise<MobileUiResult> {
  const params = new URLSearchParams({ deviceId })
  return agentFetch<MobileUiResult>(`/ui/elements?${params}`)
}

export function tapMobileElement(
  deviceId: string,
  element: MobileElement
): Promise<{ ok: boolean }> {
  return agentFetch<{ ok: boolean }>("/ui/tap", {
    method: "POST",
    body: JSON.stringify({ deviceId, element })
  })
}

export function startMobileScreenRecording(deviceId: string): Promise<{ ok: boolean; remotePath: string }> {
  return agentFetch<{ ok: boolean; remotePath: string }>("/screenrecord/start", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}

export function stopMobileScreenRecording(deviceId: string): Promise<MobileScreenRecordStopResult> {
  return agentFetch<MobileScreenRecordStopResult>("/screenrecord/stop", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}

export function startMobileActionRecording(deviceId: string): Promise<MobileActionRecordingResult> {
  return agentFetch<MobileActionRecordingResult>("/actions/start", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}

export function stopMobileActionRecording(deviceId: string): Promise<MobileActionRecordingResult> {
  return agentFetch<MobileActionRecordingResult>("/actions/stop", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}
