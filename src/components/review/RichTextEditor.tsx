import Link from "@tiptap/extension-link"
import TextAlign from "@tiptap/extension-text-align"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface Props {
  value: string
  onChange: (html: string) => void
}

interface ToolbarButtonProps {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  title: string
}

function ToolbarButton({
  active,
  onClick,
  children,
  title
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={[
        "flex h-6 w-6 items-center justify-center rounded transition-colors",
        active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"
      ].join(" ")}>
      {children}
    </button>
  )
}

const HEADING_OPTIONS = [
  { label: "Paragraph", level: null as null },
  { label: "Heading 1", level: 1 as const },
  { label: "Heading 2", level: 2 as const },
  { label: "Heading 3", level: 3 as const },
  { label: "Heading 4", level: 4 as const },
  { label: "Heading 5", level: 5 as const },
  { label: "Heading 6", level: 6 as const }
]

const ALIGNMENTS = [
  { value: "left", Icon: AlignLeft, title: "Ліво" },
  { value: "center", Icon: AlignCenter, title: "По центру" },
  { value: "right", Icon: AlignRight, title: "Право" },
  { value: "justify", Icon: AlignJustify, title: "По ширині" }
] as const

export function RichTextEditor({ value, onChange }: Props) {
  const settingContent = useRef(false)
  const [headingOpen, setHeadingOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        strike: false
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" }
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] })
    ],
    content: value,
    immediatelyRender: false,
    onUpdate({ editor: e }) {
      if (!settingContent.current) onChange(e.getHTML())
    }
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.getHTML() !== value) {
      settingContent.current = true
      editor.commands.setContent(value)
      settingContent.current = false
    }
  }, [value])

  useEffect(() => {
    if (!headingOpen) return
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node))
        setHeadingOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [headingOpen])

  const handleLink = () => {
    if (!editor) return
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const url = window.prompt("URL посилання")
    if (url) editor.chain().focus().setLink({ href: url }).run()
  }

  const editorState = useEditorState({
    editor,
    selector: (ctx) => ({
      bold:        ctx.editor?.isActive("bold") ?? false,
      italic:      ctx.editor?.isActive("italic") ?? false,
      bulletList:  ctx.editor?.isActive("bulletList") ?? false,
      orderedList: ctx.editor?.isActive("orderedList") ?? false,
      link:        ctx.editor?.isActive("link") ?? false,
      paragraph:   ctx.editor?.isActive("paragraph") ?? false,
      h1:          ctx.editor?.isActive("heading", { level: 1 }) ?? false,
      h2:          ctx.editor?.isActive("heading", { level: 2 }) ?? false,
      h3:          ctx.editor?.isActive("heading", { level: 3 }) ?? false,
      h4:          ctx.editor?.isActive("heading", { level: 4 }) ?? false,
      h5:          ctx.editor?.isActive("heading", { level: 5 }) ?? false,
      h6:          ctx.editor?.isActive("heading", { level: 6 }) ?? false,
      alignLeft:    ctx.editor?.isActive({ textAlign: "left" }) ?? false,
      alignCenter:  ctx.editor?.isActive({ textAlign: "center" }) ?? false,
      alignRight:   ctx.editor?.isActive({ textAlign: "right" }) ?? false,
      alignJustify: ctx.editor?.isActive({ textAlign: "justify" }) ?? false,
    })
  })

  const headingActiveMap: Record<string, boolean> = {
    "Paragraph":  editorState?.paragraph ?? false,
    "Heading 1":  editorState?.h1 ?? false,
    "Heading 2":  editorState?.h2 ?? false,
    "Heading 3":  editorState?.h3 ?? false,
    "Heading 4":  editorState?.h4 ?? false,
    "Heading 5":  editorState?.h5 ?? false,
    "Heading 6":  editorState?.h6 ?? false,
  }

  const activeHeading = HEADING_OPTIONS.find(({ label }) => headingActiveMap[label])

  return (
    <div className="flex flex-1 flex-col min-h-0 rounded overflow-hidden border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1">
        {/* Heading dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setHeadingOpen((v) => !v)
            }}
            className="flex h-6 items-center gap-0.5 rounded px-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
            <span className="w-16 text-left truncate">
              {activeHeading?.label ?? "Paragraph"}
            </span>
            <ChevronDown size={12} />
          </button>
          {headingOpen && (
            <div className="absolute left-0 top-7 z-50 min-w-[120px] rounded border border-gray-200 bg-white py-1 shadow-md">
              {HEADING_OPTIONS.map(({ label, level }) => (
                <button
                  key={label}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (level === null) {
                      editor?.chain().focus().setParagraph().run()
                    } else {
                      editor?.chain().focus().toggleHeading({ level }).run()
                    }
                    setHeadingOpen(false)
                  }}
                  className={[
                    "flex w-full items-center px-3 py-1 text-left text-xs transition-colors hover:bg-gray-50",
                    headingActiveMap[label] ? "text-blue-700 font-medium" : "text-gray-700"
                  ].join(" ")}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-gray-300" />

        <ToolbarButton
          active={editorState?.bold}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Жирний">
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editorState?.italic}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Курсив">
          <Italic size={14} />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-gray-300" />

        <ToolbarButton
          active={editorState?.bulletList}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Маркований список">
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editorState?.orderedList}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="Нумерований список">
          <ListOrdered size={14} />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-gray-300" />

        <ToolbarButton
          active={editorState?.link}
          onClick={handleLink}
          title="Посилання">
          <LinkIcon size={14} />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-gray-300" />

        {ALIGNMENTS.map(({ value: align, Icon, title }) => (
          <ToolbarButton
            key={align}
            active={editorState?.[`align${align.charAt(0).toUpperCase()}${align.slice(1)}` as keyof typeof editorState] as boolean}
            onClick={() => editor?.chain().focus().setTextAlign(align).run()}
            title={title}>
            <Icon size={14} />
          </ToolbarButton>
        ))}
      </div>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="flex-1 overflow-y-auto min-h-0 px-3 py-2 text-sm text-gray-800 [&_.tiptap]:outline-none [&_.tiptap]:min-h-full [&_.tiptap_p]:mb-2 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-bold [&_.tiptap_h1]:mb-2 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-bold [&_.tiptap_h2]:mb-2 [&_.tiptap_h3]:text-lg [&_.tiptap_h3]:font-semibold [&_.tiptap_h3]:mb-1 [&_.tiptap_h4]:text-base [&_.tiptap_h4]:font-semibold [&_.tiptap_h4]:mb-1 [&_.tiptap_h5]:text-sm [&_.tiptap_h5]:font-semibold [&_.tiptap_h5]:mb-1 [&_.tiptap_h6]:text-xs [&_.tiptap_h6]:font-semibold [&_.tiptap_h6]:mb-1 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_li]:mb-1 [&_.tiptap_a]:text-blue-600 [&_.tiptap_a]:underline"
      />
    </div>
  )
}
