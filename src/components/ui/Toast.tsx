import React, { useEffect } from "react"

import { cn } from "~lib/cn"

type ToastType = "success" | "error" | "info"

interface ToastProps {
  message: string
  type?: ToastType
  onDismiss?: () => void
  duration?: number
}

const typeClasses: Record<ToastType, string> = {
  success: "bg-green-50 border-green-400 text-green-800",
  error: "bg-red-50 border-red-400 text-red-800",
  info: "bg-blue-50 border-blue-400 text-blue-800"
}

export function Toast({
  message,
  type = "info",
  onDismiss,
  duration = 3000
}: ToastProps) {
  useEffect(() => {
    if (!onDismiss) return
    const t = setTimeout(onDismiss, duration)
    return () => clearTimeout(t)
  }, [duration, onDismiss])

  return (
    <div
      className={cn(
        `flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium shadow-sm max-w-full break-words`,
        typeClasses[type]
      )}>
      <span className="flex-1 min-w-0">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-1 opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  )
}
