import type { Destination } from "../../core/types"

export function isSelected(
  dest: Destination | null,
  postId: number,
  elementIndex: number,
  targetField: "content_main" | "subcontent",
  subIndex?: number
): boolean {
  if (!dest) return false
  return (
    dest.tabId === postId &&
    dest.elementIndex === elementIndex &&
    dest.targetField === targetField &&
    dest.subIndex === subIndex
  )
}
