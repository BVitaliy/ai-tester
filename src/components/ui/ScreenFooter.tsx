import type { ReactNode } from "react"

export function ScreenFooter({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={[
        "flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3",
        className
      ]
        .filter(Boolean)
        .join(" ")}>
      {children}
    </div>
  )
}
