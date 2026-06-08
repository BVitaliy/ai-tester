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
  type: "usb" | "emulator" | "simulator"
  platform?: "android" | "ios"
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
  availableIosSimulators?: MobileDevice[]
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

export type MobileTestStatus = "passed" | "failed" | "blocked"

export type MobileStepAction = "tap" | "input" | "assertVisible" | "assertNotVisible" | "wait" | "scroll"

export interface MobileExecutableStep {
  id: string
  ideaId?: string
  action: MobileStepAction
  target?: string
  value?: string
  timeoutMs?: number
  description: string
}

export interface MobileTestResultItem {
  id: string
  title: string
  status: MobileTestStatus
  message: string
  evidence: string[]
  error?: string
  screenshotDataUrl?: string | null
  screenshotError?: string
}

export interface MobileTestRunResult {
  ok: boolean
  platform: "android" | "ios"
  packageName: string
  startedAt: number
  finishedAt: number
  durationMs: number
  focusedWindow: string
  elementCount: number
  screenshotDataUrl?: string | null
  summary: {
    passed: number
    failed: number
    blocked: number
  }
  results: MobileTestResultItem[]
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

export function startIosSimulator(deviceId: string): Promise<{ ok: boolean }> {
  return agentFetch<{ ok: boolean }>("/simulators/ios/start", {
    method: "POST",
    body: JSON.stringify({ deviceId })
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

export function runMobileTests(
  deviceId: string,
  packageName: string,
  ideas: Array<{ id: string; text: string }>
): Promise<MobileTestRunResult> {
  return agentFetch<MobileTestRunResult>("/tests/mobile/run", {
    method: "POST",
    body: JSON.stringify({ deviceId, packageName, ideas })
  })
}

export function runMobileSteps(
  deviceId: string,
  packageName: string,
  steps: MobileExecutableStep[]
): Promise<MobileTestRunResult> {
  return agentFetch<MobileTestRunResult>("/tests/mobile/steps", {
    method: "POST",
    body: JSON.stringify({ deviceId, packageName, steps })
  })
}

export interface AppMapScreenSummary {
  id: string
  name: string
  purpose: string
  fingerprint: string
  visibleTextCount: number
  clickableCount: number
  transitionCount: number
}

export interface AppMapSummary {
  appId: string
  platform: "android" | "ios"
  deviceId: string
  createdAt: string
  updatedAt: string
  screenCount: number
  transitionCount: number
  screens: AppMapScreenSummary[]
}

export interface AppMapTransition {
  action: { label: string; elementId?: string; kind?: string }
  toScreenId: string | null
}

export interface AppMapScreen {
  id: string
  fingerprint: string
  name: string
  purpose: string
  screenshotPath: string | null
  uiTreePath: string | null
  focusedWindow: string
  visibleTexts: string[]
  clickableElements: Array<{
    id: string
    label: string
    text: string
    contentDesc: string
    resourceId: string
    className: string
    bounds: { centerX: number; centerY: number; width: number; height: number } | null
  }>
  transitions: AppMapTransition[]
}

export interface AppMap {
  appId: string
  platform: "android" | "ios"
  deviceId: string
  createdAt: string
  updatedAt: string
  screens: AppMapScreen[]
}

export interface ScanOptions {
  maxDepth?: number
  maxScreens?: number
  maxActionsPerScreen?: number
  waitAfterActionMs?: number
  avoidDangerousActions?: boolean
  goalDriven?: boolean
  maxPerSignature?: number
}

export type ScanJobStatus = "running" | "stopping" | "stopped" | "done" | "error"

export interface ScanEvent {
  at: number
  type: string
  name?: string
  label?: string
  reason?: string
  screenId?: string
  to?: string
  resuming?: boolean
}

export interface ScanJob {
  id: string
  deviceId: string
  appId: string
  platform: "android" | "ios"
  status: ScanJobStatus
  startedAt: number
  updatedAt: number
  current: { phase?: string; name?: string; action?: string; screenId?: string } | null
  counts: { screens: number; transitions: number; skipped: number }
  skippedDangerous: Array<{ screenId: string; label: string; reason: string }>
  events: ScanEvent[]
  summary: AppMapSummary | null
  filePath: string | null
  error: string | null
  resumable: boolean
}

export interface ScanStartResult extends ScanJob {
  ok: boolean
}

export interface ScanStatusResult {
  ok: boolean
  job: ScanJob | null
}

export interface AppMapResult {
  ok: boolean
  filePath: string
  summary: AppMapSummary
  appMap: AppMap
}

export interface ScreenAnalysis {
  ok: boolean
  fingerprint: string
  screenName: string
  purpose: string
  importantElements: string[]
  possibleUserFlows: string[]
  risks: string[]
  suggestedTests: Array<{
    title: string
    priority: "high" | "medium" | "low"
    steps: MobileExecutableStep[]
  }>
  source: string
  aiError?: string
}

export interface GeneratedFlow {
  id: string
  type: "smoke" | "navigation" | "form-validation" | "auth" | "deep-link"
  title: string
  target?: string
  priority: "high" | "medium" | "low"
  placeholder?: boolean
  steps: MobileExecutableStep[]
}

export interface GeneratedFlowsResult {
  ok: boolean
  flows: GeneratedFlow[]
  summary: { total: number; byType: Record<string, number> }
  packageName: string
  platform: "android" | "ios"
}

export function startAppScan(
  deviceId: string,
  appId: string,
  opts?: { platform?: "android" | "ios"; options?: ScanOptions; resume?: boolean }
): Promise<ScanStartResult> {
  return agentFetch<ScanStartResult>("/app/scan", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      appId,
      platform: opts?.platform,
      options: opts?.options,
      resume: opts?.resume ?? false
    })
  })
}

export function getScanStatus(deviceId: string, appId: string): Promise<ScanStatusResult> {
  const params = new URLSearchParams({ deviceId, appId })
  return agentFetch<ScanStatusResult>(`/app/scan/status?${params}`)
}

export function stopAppScan(deviceId: string, appId: string): Promise<ScanStartResult> {
  return agentFetch<ScanStartResult>("/app/scan/stop", {
    method: "POST",
    body: JSON.stringify({ deviceId, appId })
  })
}

export function getAppMap(filter?: {
  appId?: string
  platform?: string
  deviceId?: string
}): Promise<AppMapResult> {
  const params = new URLSearchParams()
  if (filter?.appId) params.set("appId", filter.appId)
  if (filter?.platform) params.set("platform", filter.platform)
  if (filter?.deviceId) params.set("deviceId", filter.deviceId)
  const query = params.toString()
  return agentFetch<AppMapResult>(`/app/map${query ? `?${query}` : ""}`)
}

export function analyzeCurrentScreen(deviceId: string): Promise<ScreenAnalysis> {
  return agentFetch<ScreenAnalysis>("/app/analyze-screen", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  })
}

export interface ExploreFeature {
  id: string
  type: string
  name: string
  confidence: number
  screenIds: string[]
  evidence: string[]
}

export interface ExploreFlow {
  id: string
  feature: string
  featureType: string
  confidence: number
  steps: Array<{ node: string; value: string }>
}

export interface ExploreRisk {
  category: string
  level: "High" | "Medium" | "Low"
  severity: number
  likelihood: number
  impact: number
  score: number
  rationale: string
  evidence: string[]
}

export interface ExploreResult {
  ok: boolean
  app: { appId: string; platform: string; generatedAt: string }
  stats: { featureCount: number; screenCount: number; edgeCount: number; flowCount: number; duplicateGroups: number }
  confidence: number
  coverage: { featureCoverage: number; screenCoverage: number; screensInFlows: number; totalScreens: number }
  riskSummary: { total: number; byLevel: { High?: number; Medium?: number; Low?: number } }
  features: ExploreFeature[]
  flows: ExploreFlow[]
  entities: Array<{ name: string; count: number }>
  authRequirement: { likelyRequiresAuth: boolean; unauthenticatedScreens: number; authenticatedScreens: number }
  risks: ExploreRisk[]
  design: {
    suites: Array<{ feature: string; featureType: string; confidence: number; cases: Array<{ kind: string; title: string; priority: string; steps: MobileExecutableStep[] }> }>
    baseFlows: GeneratedFlow[]
    summary: { total: number; suites: number; byKind: Record<string, number> }
  }
  reportMarkdown: string
}

export function exploreApplication(payload: {
  appId?: string
  platform?: string
  deviceId?: string
  appLabel?: string
}): Promise<ExploreResult> {
  return agentFetch<ExploreResult>("/app/explore", {
    method: "POST",
    body: JSON.stringify(payload)
  })
}

export function appMapScreenshotUrl(fingerprint: string): string {
  return `${DEFAULT_AGENT_URL}/app/screenshot?fingerprint=${encodeURIComponent(fingerprint)}`
}

export function generateTestsFromMap(payload: {
  appMap?: AppMap
  appId?: string
  platform?: string
  deviceId?: string
}): Promise<GeneratedFlowsResult> {
  return agentFetch<GeneratedFlowsResult>("/tests/from-map", {
    method: "POST",
    body: JSON.stringify(payload)
  })
}
