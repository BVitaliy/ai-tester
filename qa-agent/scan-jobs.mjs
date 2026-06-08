import crypto from "node:crypto"

import { createEmptyAppMap, summarizeAppMap } from "./app-map-store.mjs"
import { scanAppStructure } from "./screen-crawler.mjs"

// In-memory registry of scan jobs. Jobs live in the long-running agent process,
// so a job keeps progressing (and its state stays queryable) even after the
// extension popup is closed and reopened. The UI polls /app/scan/status and can
// re-attach by deviceId+appId.

const jobs = new Map()
const EVENT_BUFFER = 120

function key(deviceId, appId) {
  return `${deviceId}::${appId}`
}

export function getJob(deviceId, appId) {
  return jobs.get(key(deviceId, appId)) ?? null
}

export function getJobById(id) {
  for (const job of jobs.values()) if (job.id === id) return job
  return null
}

// A lightweight, JSON-serializable view (no heavy app-map element data).
export function jobSnapshot(job) {
  if (!job) return null
  return {
    id: job.id,
    deviceId: job.deviceId,
    appId: job.appId,
    platform: job.platform,
    status: job.status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    current: job.current,
    counts: job.counts,
    skippedDangerous: job.skipped.slice(0, 40),
    events: job.events.slice(-30),
    summary: job.summary ?? null,
    filePath: job.filePath ?? null,
    error: job.error ?? null,
    resumable: job.status === "stopped" || job.status === "error"
  }
}

export function stopScan(deviceId, appId) {
  const job = getJob(deviceId, appId)
  if (!job) return null
  if (job.status === "running") {
    job.stopRequested = true
    job.status = "stopping"
    job.updatedAt = Date.now()
  }
  return job
}

export function startScan(deps, { deviceId, appId, platform = "android", options = {}, resume = false }) {
  const k = key(deviceId, appId)
  const existing = jobs.get(k)
  if (existing && (existing.status === "running" || existing.status === "stopping")) {
    return existing
  }

  const appMap =
    resume && existing?.appMap
      ? existing.appMap
      : createEmptyAppMap({ appId, platform, deviceId })

  const job = {
    id: crypto.randomBytes(6).toString("hex"),
    deviceId,
    appId,
    platform,
    status: "running",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    stopRequested: false,
    appMap,
    filePath: resume && existing?.filePath ? existing.filePath : undefined,
    events: [],
    skipped: resume && existing?.skipped ? existing.skipped : [],
    current: null,
    counts: { screens: appMap.screens.length, transitions: 0, skipped: 0 },
    summary: null,
    error: null
  }
  jobs.set(k, job)
  runJob(deps, job, options)
  return job
}

function recordEvent(job, event) {
  job.updatedAt = Date.now()
  job.events.push({ at: Date.now(), ...event })
  if (job.events.length > EVENT_BUFFER) job.events.shift()

  if (event.type === "launch") {
    job.current = { phase: event.resuming ? "Resuming scan…" : "Launching app…" }
  } else if (event.type === "screen") {
    job.current = { phase: "Reading screen", screenId: event.screenId, name: event.name }
  } else if (event.type === "action") {
    job.current = { phase: "Tapping", screenId: event.screenId, action: event.label }
  } else if (event.type === "transition") {
    job.current = { phase: "Opened", screenId: event.to, name: event.name, action: event.label }
  } else if (event.type === "skip") {
    job.skipped.push({ screenId: event.screenId, label: event.label, reason: event.reason })
  }

  const s = summarizeAppMap(job.appMap)
  job.counts = { screens: s.screenCount, transitions: s.transitionCount, skipped: job.skipped.length }
}

async function runJob(deps, job, options) {
  try {
    const res = await scanAppStructure(deps, {
      deviceId: job.deviceId,
      platform: job.platform,
      appId: job.appId,
      maxDepth: Number(options.maxDepth ?? 3),
      maxScreens: Number(options.maxScreens ?? 30),
      maxActionsPerScreen: Number(options.maxActionsPerScreen ?? 8),
      waitAfterActionMs: Number(options.waitAfterActionMs ?? 1200),
      avoidDangerousActions: options.avoidDangerousActions !== false,
      appMap: job.appMap,
      filePath: job.filePath,
      shouldStop: () => job.stopRequested,
      onProgress: (event) => recordEvent(job, event)
    })
    job.summary = res.summary
    job.filePath = res.filePath
    job.status = res.stopped ? "stopped" : "done"
    job.current = { phase: res.stopped ? "Stopped" : "Done" }
  } catch (error) {
    job.status = "error"
    job.error = error instanceof Error ? error.message : String(error)
    job.current = { phase: "Error" }
  } finally {
    job.stopRequested = false
    job.updatedAt = Date.now()
  }
}
