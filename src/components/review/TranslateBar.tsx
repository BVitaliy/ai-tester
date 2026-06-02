import { ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Spinner } from "../ui/Spinner"

const LANGUAGES = [
  { code: "English", display: "English",  label: "English (EN)" },
  { code: "German",  display: "Deutsch",  label: "Deutsch (DE)" },
  { code: "French",  display: "Français", label: "Français (FR)" },
  { code: "Polish",  display: "Polski",   label: "Polski (PL)" }
]

interface Props {
  translating: boolean
  splitActive: boolean
  onSelectLanguage: (lang: string, display: string) => void
  onCancel: () => void
}

export function TranslateBar({
  translating,
  splitActive,
  onSelectLanguage,
  onCancel
}: Props) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleSelect = (code: string, display: string) => {
    setOpen(false)
    onSelectLanguage(code, display)
  }

  return (
    <div className="flex shrink-0 items-center gap-2 justify-end">
      <div className="relative" ref={dropdownRef}>
        {translating ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 px-2 py-1">
            <Spinner size="sm" />
            <span>Перекладаю…</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 transition-colors">
            Перекласти
            <ChevronDown
              size={12}
              className={
                open
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </button>
        )}

        {open && !translating && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[150px] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            {LANGUAGES.map(({ code, display, label }) => (
              <button
                key={code}
                type="button"
                onMouseDown={() => handleSelect(code, display)}
                className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors">
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {splitActive && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1">
          ✕ Відмінити переклад
        </button>
      )}
    </div>
  )
}
