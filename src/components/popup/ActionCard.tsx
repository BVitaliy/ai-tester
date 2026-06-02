import React from "react"

interface Props {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}

export function ActionCard({ icon, label, onClick, active, danger, disabled }: Props) {
  const borderColor = danger ? "#ef4444" : active ? "#dc2626" : "transparent"
  const bg = danger
    ? "rgba(239,68,68,0.08)"
    : active
      ? "rgba(220,38,38,0.08)"
      : "var(--card)"
  const iconColor = danger ? "#f87171" : active ? "#f87171" : "#9ca3af"
  const textColor = danger ? "#f87171" : active ? "#c4b5fd" : "#d1d5db"

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        padding: "16px 8px 13px",
        borderRadius: 14,
        background: bg,
        border: `1.5px solid ${borderColor}`,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        width: "100%",
        minHeight: 90,
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active && !danger) {
          const el = e.currentTarget as HTMLButtonElement
          el.style.borderColor = "#dc262655"
          el.style.background = "rgba(220,38,38,0.05)"
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active && !danger) {
          const el = e.currentTarget as HTMLButtonElement
          el.style.borderColor = "transparent"
          el.style.background = "var(--card)"
        }
      }}>
      {danger && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#ef4444",
            animation: "pulse-dot 1.2s ease-in-out infinite",
          }}
        />
      )}
      <span style={{ color: iconColor, display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: textColor, textAlign: "center", lineHeight: 1.3 }}>
        {label}
      </span>
    </button>
  )
}
