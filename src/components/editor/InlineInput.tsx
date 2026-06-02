import { useEffect, useRef, useState } from "react"

interface InlineInputProps {
  value: string
  onCommit: (v: string) => void
  onCancel: () => void
}

export function InlineInput({ value, onCommit, onCancel }: InlineInputProps) {
  const [val, setVal] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])

  return (
    <input
      ref={ref}
      className="min-w-0 flex-1 rounded border border-blue-400 px-1 py-0.5 text-sm font-semibold text-gray-800 outline-none focus:ring-1 focus:ring-blue-400"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          onCommit(val.trim() || value)
        }
        if (e.key === "Escape") onCancel()
      }}
      onBlur={() => onCommit(val.trim() || value)}
    />
  )
}
