import { closestCenter, DndContext } from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { Pencil, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { EditorContext } from "../../contexts/EditorContext"
import {
  getPost,
  publishPost,
  updatePostAcf,
  updatePostTitle
} from "../../core/api"
import type { Destination, WPAcfElement, WPPost } from "../../core/types"
import { useVerticalDnd } from "../../hooks/useVerticalDnd"
import { setLastDestination } from "../../store/session"
import { Button } from "../ui/Button"
import { ErrorText } from "../ui/ErrorText"
import { Spinner } from "../ui/Spinner"
import { AddSectionForm } from "./AddSectionForm"
import { InlineInput } from "./InlineInput"
import { SectionItem } from "./SectionItem"

interface Props {
  token: string
  post: WPPost
  currentDestination: Destination | null
  onDestinationChange: (dest: Destination) => void
  onClearDestination: () => void
  onDirtyChange?: (dirty: boolean) => void
}

// Stable IDs live alongside content so they survive arrayMove
interface SectionEntry {
  id: string
  element: WPAcfElement
}

function toEntries(content: WPAcfElement[]): SectionEntry[] {
  return content.map((element, i) => ({ id: `${element.type}-${i}`, element }))
}

export function TabEditor({
  token,
  post: initialPost,
  currentDestination,
  onDestinationChange,
  onClearDestination,
  onDirtyChange
}: Props) {
  const [post, setPost] = useState<WPPost>(initialPost)
  const [entries, setEntries] = useState<SectionEntry[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const { sensors } = useVerticalDnd()

  useEffect(() => {
    if (initialPost.acf?.content?.length > 0) {
      setPost(initialPost)
      setEntries(toEntries(initialPost.acf.content))
      setIsDirty(false)
      return
    }
    setLoading(true)
    getPost(initialPost.id, token)
      .then((p) => {
        setPost(p)
        setEntries(toEntries(p.acf.content ?? []))
        setIsDirty(false)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [initialPost.id, token])

  // Sync fresh post from parent (after content-review save) without clobbering dirty local edits
  const prevInitialIdRef = useRef(initialPost.id)
  useEffect(() => {
    if (prevInitialIdRef.current !== initialPost.id) {
      prevInitialIdRef.current = initialPost.id
      return // handled by above effect
    }
    if (initialPost.acf?.content?.length > 0 && !isDirty) {
      setPost(initialPost)
      setEntries(toEntries(initialPost.acf.content))
    }
  }, [initialPost])

  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const localContent = entries.map((e) => e.element)

  const mutateEntries = (fn: (prev: SectionEntry[]) => SectionEntry[]) => {
    setEntries((prev) => fn(prev))
    setIsDirty(true)
  }

  const addSection = (title: string, type: "nosubs" | "subs") => {
    const el: WPAcfElement = {
      acf_fc_layout: "element",
      type,
      show_in_menu: true,
      show_content_editor: true,
      content_title: title,
      content_main: "",
      content_sub: type === "subs" ? [] : null
    }
    mutateEntries((prev) => [...prev, { id: `${el.type}-${prev.length}`, element: el }])
    onClearDestination()
    setShowAddForm(false)
  }

  const renameSection = (index: number, title: string) =>
    mutateEntries((prev) =>
      prev.map((e, i) =>
        i === index
          ? { ...e, element: { ...e.element, content_title: title } }
          : e
      )
    )

  const deleteSection = (index: number) => {
    mutateEntries((prev) => prev.filter((_, i) => i !== index))
    onClearDestination()
  }

  const addSubsection = (sectionIndex: number, subtitle: string) => {
    mutateEntries((prev) =>
      prev.map((e, i) =>
        i === sectionIndex
          ? {
              ...e,
              element: {
                ...e.element,
                content_sub: [
                  ...(e.element.content_sub ?? []),
                  { content_subtitle: subtitle, subcontent: "" }
                ]
              }
            }
          : e
      )
    )
    onClearDestination()
  }

  const renameSubsection = (
    sectionIndex: number,
    subIndex: number,
    subtitle: string
  ) =>
    mutateEntries((prev) =>
      prev.map((e, i) =>
        i === sectionIndex
          ? {
              ...e,
              element: {
                ...e.element,
                content_sub: e.element.content_sub!.map((s, j) =>
                  j === subIndex ? { ...s, content_subtitle: subtitle } : s
                )
              }
            }
          : e
      )
    )

  const deleteSubsection = (sectionIndex: number, subIndex: number) => {
    mutateEntries((prev) =>
      prev.map((e, i) =>
        i === sectionIndex
          ? {
              ...e,
              element: {
                ...e.element,
                content_sub: e.element.content_sub!.filter(
                  (_, j) => j !== subIndex
                )
              }
            }
          : e
      )
    )
    onClearDestination()
  }

  const moveSub = (
    sectionIndex: number,
    oldIndex: number,
    newIndex: number
  ) => {
    mutateEntries((prev) =>
      prev.map((e, i) =>
        i === sectionIndex
          ? {
              ...e,
              element: {
                ...e.element,
                content_sub: arrayMove(
                  e.element.content_sub!,
                  oldIndex,
                  newIndex
                )
              }
            }
          : e
      )
    )
    onClearDestination()
  }

  // ── DnD sections ─────────────────────────────────────────────────────────────

  const sectionIds = entries.map((e) => e.id)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = entries.findIndex((e) => e.id === active.id)
    const newIndex = entries.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    mutateEntries((prev) => arrayMove(prev, oldIndex, newIndex))
    onClearDestination()
  }

  // ── Publish ───────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const updated = await publishPost(post.id, token)
      setPost(updated)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Помилка публікації")
    } finally {
      setPublishing(false)
    }
  }

  // ── Rename post title ─────────────────────────────────────────────────────────

  const handleTitleCommit = async (newTitle: string) => {
    setEditingTitle(false)
    setSavingTitle(true)
    setTitleError(null)
    try {
      const updated = await updatePostTitle(post.id, newTitle, token)
      setPost((p) => ({ ...p, title: updated.title }))
    } catch {
      setTitleError("Не вдалося перейменувати")
    } finally {
      setSavingTitle(false)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const updated = await updatePostAcf(post.id, localContent, token)
      setPost(updated)
      setEntries(toEntries(updated.acf.content ?? []))
      setIsDirty(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Помилка збереження")
    } finally {
      setIsSaving(false)
    }
  }

  // ── Destination ───────────────────────────────────────────────────────────────

  const selectDestination = async (dest: Destination) => {
    await setLastDestination(dest)
    onDestinationChange(dest)
    chrome.runtime.sendMessage({ type: "CLOSE_EDITOR_WINDOW" })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  if (error) return <ErrorText message={error} />

  return (
    <EditorContext.Provider
      value={{
        token,
        postId: post.id,
        isDirty,
        currentDestination,
        onSelectDestination: selectDestination,
        onClearDestination
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Post header */}
        <div className="shrink-0 border-b border-gray-100 bg-white px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <div className="flex items-center">
                  <InlineInput
                    value={post.title.rendered}
                    onCommit={handleTitleCommit}
                    onCancel={() => {
                      setEditingTitle(false)
                      setTitleError(null)
                    }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <p
                    className="truncate text-sm font-semibold text-gray-800"
                    onDoubleClick={() => setEditingTitle(true)}
                    title="Двічі клікніть для перейменування">
                    {savingTitle ? (
                      <span className="text-gray-400">
                        {post.title.rendered}
                      </span>
                    ) : (
                      post.title.rendered
                    )}
                  </p>
                  <button
                    onClick={() => setEditingTitle(true)}
                    disabled={savingTitle}
                    className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
                    <Pencil size={12} />
                  </button>
                </div>
              )}
              <ErrorText message={titleError} />
              <a
                href={post.link}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-500 hover:underline">
                {post.slug}
              </a>
            </div>
            {post.status === "draft" && (
              <Button
                variant="secondary"
                size="sm"
                loading={publishing}
                onClick={handlePublish}>
                Опублікувати
              </Button>
            )}
            <Button
              size="sm"
              loading={isSaving}
              disabled={!isDirty}
              onClick={handleSave}>
              Зберегти
            </Button>
          </div>
          <ErrorText message={saveError} />
          {isDirty && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
              <TriangleAlert size={12} className="shrink-0" />
              Збережіть зміни щоб обрати ціль для запису
            </p>
          )}
        </div>

        {/* Section list */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {entries.length === 0 ? (
            <p className="p-4 text-center text-xs text-gray-400">
              Немає елементів у цьому документі
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}>
              <SortableContext
                items={sectionIds}
                strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col divide-y divide-gray-100">
                  {entries.map((entry, elementIndex) => (
                    <SectionItem
                      key={entry.id}
                      id={entry.id}
                      element={entry.element}
                      elementIndex={elementIndex}
                      onRename={(title) => renameSection(elementIndex, title)}
                      onDelete={() => deleteSection(elementIndex)}
                      onAddSub={(subtitle) =>
                        addSubsection(elementIndex, subtitle)
                      }
                      onRenameSub={(subIndex, subtitle) =>
                        renameSubsection(elementIndex, subIndex, subtitle)
                      }
                      onDeleteSub={(subIndex) =>
                        deleteSubsection(elementIndex, subIndex)
                      }
                      onMoveSub={(oldIdx, newIdx) =>
                        moveSub(elementIndex, oldIdx, newIdx)
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {/* Add section */}
          {showAddForm ? (
            <AddSectionForm
              onAdd={addSection}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="shrink-0 border-t border-gray-100 py-2 text-center text-xs text-blue-600 hover:bg-blue-50">
              + Розділ
            </button>
          )}
        </div>
      </div>
    </EditorContext.Provider>
  )
}
