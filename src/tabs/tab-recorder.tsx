import { putVideoBlob } from "../lib/videoStorage"

let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let chunks: Blob[] = []
let mimeType = "video/webm"
let activeSessionKey: string | null = null

function pickMimeType(): string {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9"
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    return "video/webm;codecs=vp8"
  }
  return "video/webm"
}

async function getTabStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error chrome tab capture constraints
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    }
  })
}

async function startRecording(streamId: string, sessionKey: string): Promise<void> {
  stopTracks()
  chunks = []
  activeSessionKey = sessionKey
  mediaStream = await getTabStream(streamId)
  mimeType = pickMimeType()
  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType,
    videoBitsPerSecond: 2_500_000
  })
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  mediaRecorder.start(1000)
}

function stopTracks(): void {
  mediaRecorder = null
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}

async function finishRecording(): Promise<{ sessionKey: string; mimeType: string }> {
  const key = activeSessionKey
  if (!key) throw new Error("no_active_recording")

  const recorder = mediaRecorder
  if (!recorder || recorder.state === "inactive") {
    stopTracks()
    activeSessionKey = null
    throw new Error("recorder_not_active")
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }))
    }
    recorder.onerror = () => reject(new Error("recorder_error"))
    recorder.stop()
  })

  stopTracks()
  activeSessionKey = null
  chunks = []
  await putVideoBlob(key, blob)
  return { sessionKey: key, mimeType }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "RECORDER_PING") {
    sendResponse({ ok: true })
    return
  }
  if (message.type === "OFFSCREEN_START_RECORD") {
    startRecording(message.streamId, message.sessionKey)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
  if (message.type === "OFFSCREEN_PAUSE_RECORD") {
    mediaRecorder?.pause()
    sendResponse({ ok: true })
    return
  }
  if (message.type === "OFFSCREEN_RESUME_RECORD") {
    mediaRecorder?.resume()
    sendResponse({ ok: true })
    return
  }
  if (message.type === "OFFSCREEN_STOP_RECORD") {
    finishRecording()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
})

export default function TabRecorderPage() {
  return null
}
