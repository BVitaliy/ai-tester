import { Copy, Pencil } from "lucide-react"
import { useState } from "react"

import type { WPPost } from "../../core/types"
import { InlineInput } from "../editor/InlineInput"
import { Button } from "../ui/Button"
import { ErrorText } from "../ui/ErrorText"
import { Spinner } from "../ui/Spinner"

interface PostRowProps {
  post: WPPost
  onSelect: () => void
  onClone: () => Promise<void>
  onRename: (newTitle: string) => Promise<void>
}


export function PostRow({ post, onSelect, onClone, onRename }: PostRowProps) {
  const [cloning, setCloning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const handleClone = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setCloning(true)
    try {
      await onClone()
    } finally {
      setCloning(false)
    }
  }

  const handleCommit = async (newTitle: string) => {
    setEditing(false)
    setSaving(true)
    setRenameError(null)
    try {
      await onRename(newTitle)
    } catch {
      setRenameError("Не вдалося перейменувати")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setRenameError(null)
  }

  return (
    <li>
      <div
        className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-xs hover:bg-gray-100"
        onClick={() => !editing && !saving && onSelect()}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editing ? (
            <InlineInput
              value={post.title.rendered}
              onCommit={handleCommit}
              onCancel={handleCancel}
            />
          ) : saving ? (
            <>
              <Spinner />
              <span className="truncate font-medium text-gray-400">
                {post.title.rendered}
              </span>
            </>
          ) : (
            <span className="truncate font-medium text-gray-800">
              {post.title.rendered}
            </span>
          )}
        </div>

        {!editing && (
          <span className="ml-auto shrink-0 text-gray-400">{post.slug}</span>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-1"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          disabled={saving}>
          <Pencil size={14} />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-1"
          onClick={handleClone}
          disabled={cloning}>
          {cloning ? <Spinner /> : <Copy size={14} />}
        </Button>
      </div>

      <ErrorText message={renameError} />
    </li>
  )
}
