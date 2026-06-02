import { RichTextEditor } from "./RichTextEditor"

interface Props {
  originalHtml: string
  onChangeOriginal: (html: string) => void
  translatedHtml: string
  language: string
  onChangeTranslated: (html: string) => void
}

export function TranslationPanel({
  originalHtml,
  onChangeOriginal,
  translatedHtml,
  language,
  onChangeTranslated
}: Props) {
  return (
    <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <span className="text-xs font-medium text-slate-500 mb-1 shrink-0">
          Українська
        </span>
        <RichTextEditor value={originalHtml} onChange={onChangeOriginal} />
      </div>
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <span className="text-xs font-medium text-slate-500 mb-1 shrink-0">
          {language}
        </span>
        <RichTextEditor value={translatedHtml} onChange={onChangeTranslated} />
      </div>
    </div>
  )
}
