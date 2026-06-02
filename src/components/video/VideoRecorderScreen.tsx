import { useEffect, useRef, useState } from "react"

import { uploadMedia, uploadVideoToGemini } from "../../core/api"
import { MOCK_MODE } from "../../core/config"
import { updateCaptureFlow } from "../../store/session"
import { Button } from "../ui/Button"
import { ErrorText } from "../ui/ErrorText"
import { ScreenFooter } from "../ui/ScreenFooter"
import { Spinner } from "../ui/Spinner"
import { VoiceTextarea } from "../ui/VoiceTextarea"

type Mode = "record" | "upload"
type RecorderState = "idle" | "acquiring" | "recording" | "stopped" | "uploading" | "error"

interface Props {
  token: string
  onCancel: () => void
}

export function VideoRecorderScreen({ token, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("record")
  const [state, setState] = useState<RecorderState>("idle")
  const [duration, setDuration] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const mimeTypeRef = useRef("video/webm")
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchMode = (next: Mode) => {
    if (next === mode) return
    // Stop any ongoing recording
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setUploadedFile(null)
    blobRef.current = null
    chunksRef.current = []
    setState("idle")
    setErrorMsg(null)
    setDuration(0)
    setMode(next)
  }

  // ── Record mode ───────────────────────────────────────────────────────────

  const startRecording = async () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    blobRef.current = null
    chunksRef.current = []
    setErrorMsg(null)
    setDuration(0)
    setState("acquiring")

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      })

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...micStream.getAudioTracks()
      ])

      // Stop recording automatically if user closes the browser's share dialog
      displayStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop()
        }
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm"
      mimeTypeRef.current = mimeType

      const recorder = new MediaRecorder(combinedStream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        combinedStream.getTracks().forEach((t) => t.stop())
        micStream.getTracks().forEach((t) => t.stop())
        displayStream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)

        const blob = new Blob(chunksRef.current, { type: mimeType })
        blobRef.current = blob
        setPreviewUrl(URL.createObjectURL(blob))
        setState("stopped")
      }

      recorder.start(1000)
      setState("recording")
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Помилка доступу до запису")
      setState("error")
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  // ── Upload mode ───────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setUploadedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setErrorMsg(null)
  }

  // ── Confirm (both modes) ──────────────────────────────────────────────────

  const handleConfirm = async () => {
    const blob = mode === "upload" ? uploadedFile : blobRef.current
    if (!blob) return
    setState("uploading")

    try {
      const rawMime = mode === "upload"
        ? (uploadedFile!.type || "video/mp4")
        : mimeTypeRef.current
      const mimeType = rawMime.split(";")[0]

      if (MOCK_MODE) {
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ""
        for (let i = 0; i < bytes.byteLength; i++)
          binary += String.fromCharCode(bytes[i])
        const videoBase64 = btoa(binary)
        chrome.runtime
          .sendMessage({
            type: "VIDEO_DONE",
            videoBase64,
            videoMimeType: mimeType,
            description: description.trim() || undefined
          })
          .catch(() => {})
      } else {
        const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm"
        const filename = `docshot-video-${Date.now()}.${ext}`
        const [fileUri, wpMedia] = await Promise.all([
          uploadVideoToGemini(blob as Blob, mimeType),
          uploadMedia(blob as Blob, filename, token)
        ])
        await updateCaptureFlow({
          videoFileUri: fileUri,
          videoMimeType: mimeType,
          videoWpUrl: wpMedia.source_url
        })
        chrome.runtime
          .sendMessage({
            type: "VIDEO_DONE",
            description: description.trim() || undefined
          })
          .catch(() => {})
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Помилка завантаження відео")
      setState("stopped")
    }
  }

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`

  const hasVideo = mode === "record" ? state === "stopped" : uploadedFile !== null
  const isUploading = state === "uploading"

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => switchMode("record")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "record"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}>
            ● Запис
          </button>
          <button
            onClick={() => switchMode("upload")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "upload"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}>
            ↑ Завантажити файл
          </button>
        </div>

        {/* Record mode UI */}
        {mode === "record" && (
          <>
            <p className="text-sm font-medium text-gray-700">
              {state === "idle" && "Оберіть що записувати"}
              {state === "acquiring" && "Оберіть вікно або вкладку…"}
              {state === "recording" && "Запис відео…"}
              {state === "stopped" && "Запис завершено"}
              {state === "uploading" && "Завантаження відео до Gemini…"}
              {state === "error" && "Помилка запису"}
            </p>

            {state === "recording" && (
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                <span className="font-mono text-lg font-semibold text-gray-800">
                  {fmt(duration)}
                </span>
              </div>
            )}

            <div className="flex justify-center gap-3">
              {(state === "idle" || state === "error") && (
                <Button onClick={startRecording} className="px-6">
                  ● Почати запис
                </Button>
              )}
              {state === "acquiring" && (
                <Button disabled className="px-6">
                  Ініціалізація…
                </Button>
              )}
              {state === "recording" && (
                <Button variant="danger" onClick={stopRecording} className="px-6">
                  ■ Зупинити
                </Button>
              )}
              {state === "stopped" && (
                <Button variant="secondary" onClick={startRecording}>
                  ↺ Перезаписати
                </Button>
              )}
            </div>
          </>
        )}

        {/* Upload mode UI */}
        {mode === "upload" && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              className="w-full">
              {uploadedFile ? "↺ Обрати інший файл" : "Обрати відео файл"}
            </Button>
            {uploadedFile && (
              <p className="text-xs text-gray-500 truncate">{uploadedFile.name}</p>
            )}
          </>
        )}

        {/* Shared: video preview */}
        {previewUrl && !isUploading && (
          <video
            src={previewUrl}
            controls
            className="w-full max-h-56 rounded-lg border border-gray-200 bg-black"
          />
        )}

        {isUploading && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}

        <ErrorText message={errorMsg} />

        {/* Shared: optional description with voice dictation */}
        {(hasVideo || mode === "upload") && !isUploading && (
          <VoiceTextarea
            value={description}
            onChange={setDescription}
            placeholder="Додатковий опис (необов'язково)"
          />
        )}
      </div>

      <ScreenFooter>
        <Button variant="secondary" onClick={onCancel}>
          Скасувати
        </Button>
        <Button
          disabled={!hasVideo}
          loading={isUploading}
          onClick={handleConfirm}>
          Надіслати →
        </Button>
      </ScreenFooter>
    </div>
  )
}
