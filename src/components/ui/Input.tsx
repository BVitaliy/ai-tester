import React from "react"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({
  label,
  error,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-")
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-gray-400">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-md border px-3 py-1.5 text-sm bg-[var(--card)] text-gray-200 placeholder-gray-500 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] ${
          error ? 'border-red-500' : 'border-[var(--border)]'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
