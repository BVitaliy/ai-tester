import { closestCenter, DndContext } from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useEditorContext } from "../../contexts/EditorContext"
import type { WPAcfElement } from "../../core/types"
import { useVerticalDnd } from "../../hooks/useVerticalDnd"
import { AddSubForm } from "./AddSubForm"
import { DestinationButton } from "./DestinationButton"
import { isSelected } from "./destinationUtils"
import { InlineInput } from "./InlineInput"
import { SortableSubItem } from "./SortableSubItem"

interface Props {
  id: string
  element: WPAcfElement
  elementIndex: number
  onRename: (title: string) => void
  onDelete: () => void
  onAddSub?: (subtitle: string) => void
  onRenameSub?: (subIndex: number, subtitle: string) => void
  onDeleteSub?: (subIndex: number) => void
  onMoveSub?: (oldIndex: number, newIndex: number) => void
}

export function SectionItem({
  id,
  element,
  elementIndex,
  onRename,
  onDelete,
  onAddSub,
  onRenameSub,
  onDeleteSub,
  onMoveSub
}: Props) {
  const { postId, isDirty, currentDestination, onSelectDestination } =
    useEditorContext()

  const hasSubs = element.type === "subs" && Array.isArray(element.content_sub)
  const mainActive = isSelected(
    currentDestination,
    postId,
    elementIndex,
    "content_main"
  )
  const isThisSectionSelected =
    currentDestination !== null &&
    currentDestination.tabId === postId &&
    currentDestination.elementIndex === elementIndex
  const [open, setOpen] = useState(hasSubs && isThisSectionSelected)
  const [editing, setEditing] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mainActive)
      headerRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      })
  }, [mainActive])

  // Sub IDs must be stable across re-renders: only regenerate when count changes,
  // never depend on elementIndex (which shifts when sections are reordered).
  const subCountRef = useRef(-1)
  const subIdsRef = useRef<string[]>([])
  const subCount = element.content_sub?.length ?? 0
  if (subCountRef.current !== subCount) {
    subCountRef.current = subCount
    subIdsRef.current = Array.from(
      { length: subCount },
      (_, i) => `sub-${id}-${i}`
    )
  }
  const subIds = subIdsRef.current

  const { sensors } = useVerticalDnd()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined
  }

  const handleSubDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = subIds.indexOf(String(active.id))
    const newIndex = subIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    onMoveSub?.(oldIndex, newIndex)
  }

  return (
    <li ref={setNodeRef} style={style} className="group/section bg-white">
      {/* H3 header row */}
      <div
        ref={headerRef}
        className="flex items-center gap-2 px-2 py-2 hover:bg-gray-50"
        onClick={() => hasSubs && !editing && setOpen((v) => !v)}>
        {/* Section drag handle */}
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab touch-none select-none text-gray-300 opacity-0 group-hover/section:opacity-100 text-xl"
          title="Перетягнути секцію">
          ⠿
        </span>

        {hasSubs && (
          <span
            className="text-xs text-gray-400 transition-transform"
            style={{
              display: "inline-block",
              transform: open ? "rotate(90deg)" : "none"
            }}>
            ▶
          </span>
        )}

        {editing ? (
          <InlineInput
            value={element.content_title}
            onCommit={(v) => {
              onRename(v)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span className="min-w-0 flex-1 flex-col gap-1">
            <span className="flex-1 break-words text-sm font-semibold text-gray-800">
              {element.content_title}
            </span>
            {/* content_main preview */}
            {element.content_main && (
              <p
                className="line-clamp-1 text-xs text-gray-400"
                dangerouslySetInnerHTML={{
                  __html: element.content_main
                    .replace(/<[^>]+>/g, " ")
                    .slice(0, 100)
                }}
              />
            )}
          </span>
        )}

        {!editing && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="shrink-0 text-gray-300 opacity-0 hover:text-blue-500 group-hover/section:opacity-100"
            title="Перейменувати">
            <Pencil size={14} />
          </button>
        )}

        <span className="shrink-0 text-xs text-gray-400">
          {element.type === "nosubs"
            ? "nosubs"
            : `${element.content_sub?.length ?? 0} підрозд.`}
        </span>

        {element.show_content_editor && (
          <DestinationButton
            active={mainActive}
            disabled={isDirty}
            onClick={(e?: React.MouseEvent) => {
              e?.stopPropagation?.()
              onSelectDestination({
                tabId: postId,
                elementIndex,
                targetField: "content_main",
                sectionTitle: element.content_title
              })
            }}
          />
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`Видалити секцію «${element.content_title}»?`))
              onDelete()
          }}
          className="shrink-0 text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover/section:opacity-100"
          title="Видалити секцію">
          ✕
        </button>
      </div>

      {/* H4 subsections */}
      {hasSubs && open && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleSubDragEnd}>
          <SortableContext
            items={subIds}
            strategy={verticalListSortingStrategy}>
            <ul className="pb-1">
              {element.content_sub!.map((sub, subIndex) => (
                <SortableSubItem
                  key={subIds[subIndex]}
                  id={subIds[subIndex]}
                  sub={sub}
                  elementIndex={elementIndex}
                  subIndex={subIndex}
                  sectionTitle={element.content_title}
                  onRename={(subtitle) => onRenameSub?.(subIndex, subtitle)}
                  onDelete={() => onDeleteSub?.(subIndex)}
                />
              ))}
              {showAddSub ? (
                <AddSubForm
                  onAdd={(subtitle) => {
                    onAddSub?.(subtitle)
                    setShowAddSub(false)
                  }}
                  onCancel={() => setShowAddSub(false)}
                />
              ) : (
                <li>
                  <button
                    onClick={() => setShowAddSub(true)}
                    className="w-full border-l-2 border-gray-200 py-1.5 pl-4 text-left text-xs text-blue-600 hover:bg-blue-50">
                    + Підрозділ
                  </button>
                </li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </li>
  )
}
