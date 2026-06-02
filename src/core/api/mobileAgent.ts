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
