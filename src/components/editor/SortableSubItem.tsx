import { Pencil } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useEffect, useRef, useState } from "react"

import { useEditorContext } from "../../contexts/EditorContext"
import type { WPAcfSubElement } from "../../core/types"
import { InlineInput } from "./InlineInput"
import { DestinationButton } from "./DestinationButton"
import { isSelected } from "./destinationUtils"

interface SortableSubItemProps {
  id: string
  sub: WPAcfSubElement
  elementIndex: number
  subIndex: number
  sectionTitle: string
  onRename: (subtitle: string) => void
  onDelete: () => void
}

export function SortableSubItem({
  id,
  sub,
  elementIndex,
  subIndex,
  sectionTitle,
  onRename,
  onDelete
}: SortableSubItemProps) {
  const { postId, isDirty, currentDestination, onSelectDestination } =
    useEditorContext()

  const active = isSelected(
    currentDestination,
    postId,
    elementIndex,
    "subcontent",
    subIndex
  )
  const [editing, setEditing] = useState(false)
  const itemRef = useRef<HTMLLIElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, animateLayoutChanges: () => false })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined
  }

  useEffect(() => {
    if (active)
      itemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [active])

  return (
    <li
      ref={(el) => {
        setNodeRef(el)
        ;(itemRef as any).current = el
      }}
      style={style}
      className={`group flex items-center gap-2 border-l-2 py-1.5 pl-2 pr-3 ${
        active
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 hover:bg-gray-50"
      }`}>
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none select-none text-gray-300 opacity-0 group-hover:opacity-100 text-xl"
        title="Перетягнути">
        ⠿
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <InlineInput
            value={sub.content_subtitle}
            onCommit={(v) => {
              onRename(v)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="truncate text-xs font-medium text-gray-700">
              {sub.content_subtitle}
            </p>
            {sub.subcontent && (
              <p
                className="mt-0.5 line-clamp-1 text-xs text-gray-400"
                dangerouslySetInnerHTML={{
                  __html: sub.subcontent.replace(/<[^>]+>/g, " ").slice(0, 80)
                }}
              />
            )}
          </>
        )}
      </div>

      {!editing && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className="shrink-0 text-gray-300 opacity-0 hover:text-blue-500 group-hover:opacity-100"
          title="Перейменувати">
          <Pencil size={14} />
        </button>
      )}

      <DestinationButton
        active={active}
        disabled={isDirty}
        onClick={() =>
          onSelectDestination({
            tabId: postId,
            elementIndex,
            targetField: "subcontent",
            subIndex,
            sectionTitle,
            subSectionTitle: sub.content_subtitle
          })
        }
      />

      <button
        onClick={() => {
          if (window.confirm(`Видалити підрозділ «${sub.content_subtitle}»?`))
            onDelete()
        }}
        className="shrink-0 text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
        title="Видалити підрозділ">
        ✕
      </button>
    </li>
  )
}
