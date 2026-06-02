import { useState } from "react"

import { Button } from "../ui/Button"
import { Input } from "../ui/Input"

interface AddSectionFormProps {
  onAdd: (title: string, type: "nosubs" | "subs") => void
  onCancel: () => void
}

export function AddSectionForm({ onAdd, onCancel }: AddSectionFormProps) {
  const [title, setTitle] = useState("")
  const [type, setType] = useState<"nosubs" | "subs">("subs")

  const submit = () => {
    const t = title.trim()
    if (!t) return
    onAdd(t, type)
    setTitle("")
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50 p-3">
      <p className="mb-2 text-xs font-medium text-gray-600">Нова секція</p>
      <Input
        autoFocus
        placeholder="Назва секції"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit()
          if (e.key === "Escape") onCancel()
        }}
        className="mb-2 text-xs"
      />
      <div className="mb-3 flex gap-3 text-xs text-gray-600">
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="radio"
            name="type"
            checked={type === "subs"}
            onChange={() => setType("subs")}
          />
          З підрозділами
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="radio"
            name="type"
            checked={type === "nosubs"}
            onChange={() => setType("nosubs")}
          />
          Без підрозділів
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!title.trim()}>
          Додати
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </div>
  )
}
