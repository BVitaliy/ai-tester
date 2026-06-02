import { Mic } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../../lib/cn"
import { useLanguage } from "../../contexts/LanguageContext"
import { getActiveTab } from "../../store/jack"
import { isInspectableTabUrl, sendTabMessage } from "../../lib/tabMessage"

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
}

export function VoiceInput({ value, onChange, placeholder, className, inputClassName }: Props) {
  const { lang, t } = useLanguage()
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState("")
  const valueRef = useRef(value)

  useEffect(() => { valueRef.current = value }, [value])

  // Listen for results relayed from the content script
  useEffect(() => {
    if (!recording) return
    const handler = (message: any) => {
      if (message.type === "DICTATION_RESULT") {
        if (message.isFinal) {
          const word = (message.text as string).trim()
          const base = valueRef.current
          const next = base ? `${base} ${word}` : word
          valueRef.current = next
          onChange(next)
          setInterim("")
        } else {
          setInterim((message.text as string).trim())
        }
      }
      if (message.type === "DICTATION_ENDED") {
        setRecording(false)
        setInterim("")
      }
      if (message.type === "DICTATION_ERROR") {
        setRecording(false)
        setInterim("")
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [recording])

  const start = async () => {
    const tab = await getActiveTab()
    if (!tab?.id || !tab.url || !isInspectableTabUrl(tab.url)) return
    try {
      await sendTabMessage(tab.id, {
        type: "START_DICTATION",
        lang: lang === "en" ? "en-US" : "uk-UA",
      })
      setRecording(true)
    } catch (err) {
      console.warn("VoiceInput: failed to start dictation in tab", err)
    }
  }

  const stop = async () => {
    setRecording(false)
    setInterim("")
    const tab = await getActiveTab()
    if (tab?.id) {
      sendTabMessage(tab.id, { type: "STOP_DICTATION" }).catch(() => {})
    }
  }

  const displayValue = recording && interim
    ? (value ? `${value} ${interim}` : interim)
    : value

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        type="text"
        value={displayValue}
        onChange={(e) => { if (!recording) onChange(e.target.value) }}
        placeholder={placeholder}
        readOnly={recording}
        className={cn(
          "w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 placeholder:text-gray-500 pr-8",
          recording && "opacity-80 cursor-not-allowed",
          inputClassName
        )}
      />
      <button
        type="button"
        onClick={recording ? stop : start}
        title={recording ? t("micStop") : t("micStart")}
        className={cn(
          "absolute right-2 flex h-5 w-5 items-center justify-center rounded-full transition-colors",
          recording
            ? "text-red-400 hover:text-red-300"
            : "text-gray-500 hover:text-gray-300"
        )}>
        {recording
          ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          : <Mic size={13} />}
      </button>
    </div>
  )
}
