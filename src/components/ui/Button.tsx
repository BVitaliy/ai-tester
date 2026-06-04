import React from "react"

import { cn } from "../../lib/cn"

// Variants for our button component.  We support solid (primary), outline,
// ghost and danger.  Solid variant uses the primary color for background
// with white text.  Outline variant shows a neutral background with a
// colored border and text.  Danger is red for destructive actions.
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline"
type Size = "sm" | "md"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantClasses: Record<Variant, string> = {
  // Solid primary button with our primary color
  primary:
    "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 disabled:opacity-50",
  // Secondary button used for less important actions (white background)
  secondary:
    "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 disabled:opacity-50",
  // Ghost button for text‑only actions
  ghost: "bg-transparent text-[var(--primary)] hover:bg-gray-100 disabled:opacity-50",
  // Danger button for destructive actions
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  // Outline button: white background with colored border and text
  outline:
    "bg-white text-[var(--primary)] border border-[var(--primary)] hover:bg-[var(--primary)] hover:text-white disabled:opacity-50"
}

const sizeClasses: Record<Size, string> = {
  sm: "min-h-[42px] px-3 py-2 text-xs",
  md: "min-h-[42px] px-4 py-2 text-sm"
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none ",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}>
      {loading && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8z"
          />
        </svg>
      )}
      {children}
    </button>
  )
}
