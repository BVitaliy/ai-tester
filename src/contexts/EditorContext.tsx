import { createContext, useContext } from "react"

import type { Destination } from "../core/types"

interface EditorContextValue {
  token: string
  postId: number
  isDirty: boolean
  currentDestination: Destination | null
  onSelectDestination: (dest: Destination) => void
  onClearDestination: () => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error("useEditorContext must be used inside EditorContext.Provider")
  return ctx
}
