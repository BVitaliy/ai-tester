import { useState } from "react"

import { Button } from "../ui/Button"

interface AddSubFormProps {
  onAdd: (subtitle: string) => void
  onCancel: () => void
}

export function AddSubForm({ onAdd, onCancel }: AddSubFormProps) {
  const [val, setVal] = useState("")
  const add = () => {
    const t = val.trim()
    if (t) {
      onAdd(t)
      setVal("")
    }
  }
  return (
    <li className="flex items-center gap-2 border-l-2 border-gray-200 py-1.5 pl-2 pr-3">
      <input
        autoFocus
        className="min-w-0 flex-1 rounded border border-blue-400 px-1 py-0.5 text-xs outline-none"
        placeholder="Назва підрозділу"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add()
          if (e.key === "Escape") onCancel()
        }}
      />
      <Button size="sm" onClick={add} disabled={!val.trim()}>
        Додати
      </Button>
      <button
        onClick={onCancel}
        className="text-xs text-gray-400 hover:text-gray-600">
        ✕
      </button>
    </li>
  )
}
