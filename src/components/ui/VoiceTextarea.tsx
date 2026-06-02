import { Mic, MicOff } from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

const supported =
  typeof window !== "undefined" &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  !!(
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  )

export function VoiceTextarea({
  value,
  onChange,
  placeholder,
  minHeight = "min-h-[80px]"
}: Props) {
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState("")
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const startDictation = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: (new () => SpeechRecognition) | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.lang = "uk-UA"
    recognition.continuous = true
    recognition.interimResults = true
    recognitionRef.current = recognition

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interimText = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const word = r[0].transcript
          const base = valueRef.current
          const next = base ? base + " " + word.trimStart() : word.trimStart()
          valueRef.current = next
          onChange(next)
        } else {
          interimText += r[0].transcript
        }
      }
      setInterim(interimText)
    }

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "aborted") return
      stopDictation()
    }

    recognition.onend = () => {
      setInterim("")
      setRecording(false)
    }

    recognition.start()
    setRecording(true)
  }

  const stopDictation = () => {
    recognitionRef.current?.stop()
  }

  // While recording, show committed value + interim preview in the textarea
  const displayValue =
    recording && interim ? (value ? value + " " + interim : interim) : value

  return (
    <div className="relative">
      <textarea
        className={`${minHeight} resize-y w-full  rounded-lg border border-gray-200 bg-white p-3 pb-9 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-200 ${recording ? "cursor-not-allowed bg-gray-50" : ""}`}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={recording}
      />
      <button
        type="button"
        disabled={!supported}
        onClick={recording ? stopDictation : startDictation}
        title={
          !supported
            ? "Браузер не підтримує розпізнавання мовлення"
            : recording
              ? "Зупинити диктовку"
              : "Надиктувати"
        }
        className={`absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          !supported
            ? "cursor-not-allowed bg-gray-100/80 text-gray-300"
            : recording
              ? "bg-red-50/80 text-red-500 hover:bg-red-100/80 hover:text-red-600"
              : "bg-gray-100/80 text-gray-400 hover:bg-gray-200/80 hover:text-gray-600"
        }`}>
        {!supported ? (
          <MicOff size={20} />
        ) : recording ? (
          <span className="h-4 w-4 animate-pulse rounded-full bg-red-500" />
        ) : (
          <Mic size={20} />
        )}
      </button>
    </div>
  )
}
