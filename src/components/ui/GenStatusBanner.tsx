import React from "react"
import { RefreshCw, AlertCircle } from "lucide-react"
import type { JackGenStatus } from "../../core/types"
import { cn } from "../../lib/cn"
import { useLanguage } from "../../contexts/LanguageContext"

interface Props {
  status: JackGenStatus
  onRetry?: () => void
  className?: string
}

export function GenStatusBanner({ status, onRetry, className }: Props) {
  const { t } = useLanguage()
  if (status.phase === "idle") return null

  const phaseLabel =
    status.phase === "analyzing-media"
      ? t("genAnalyzingMedia")
      : status.phase === "generating-ideas"
        ? t("genGeneratingIdeas")
        : status.phase === "generating-code"
          ? t("genGeneratingCode")
          : t("genProcessing")

  if (status.phase === "error") {
    return (
      <div
        className={cn("flex items-start gap-2 rounded-lg px-3 py-2", className)}
        style={{
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)",
        }}>
        <AlertCircle size={13} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 11, color: "#fca5a5", flex: 1, lineHeight: 1.5 }}>
          {status.error ?? t("generationError")}
        </span>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              fontSize: 11,
              color: "#f87171",
              background: "rgba(220,38,38,0.15)",
              border: "1px solid rgba(220,38,38,0.3)",
              borderRadius: 5,
              padding: "2px 8px",
              cursor: "pointer",
              flexShrink: 0,
              fontWeight: 600,
            }}>
            {t("retry")}
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn("flex items-center gap-2 rounded-lg px-3 py-2", className)}
      style={{
        background: "rgba(220,38,38,0.08)",
        border: "1px solid rgba(220,38,38,0.2)",
      }}>
      <RefreshCw size={12} className="animate-spin" style={{ color: "#f87171", flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: "#f87171" }}>
        {phaseLabel}
      </span>
    </div>
  )
}
