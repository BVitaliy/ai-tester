import { useRef, useState } from "react"

import { translateHtml } from "../../core/api/gemini"
import { getPost, updatePostAcf, uploadMedia } from "../../core/api"
import type { CaptureFlow, WPPost } from "../../core/types"
import { clearCaptureFlow } from "../../store/session"
import { Button } from "../ui/Button"
import { ScreenFooter } from "../ui/ScreenFooter"
import { Toast } from "../ui/Toast"
import { RichTextEditor } from "./RichTextEditor"
import { TranslateBar } from "./TranslateBar"
import { TranslationPanel } from "./TranslationPanel"

interface Props {
  flow: CaptureFlow
  token: string
  onSaved: (updatedPost: WPPost) => void
  onCancel: () => void
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",")
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png"
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const EDITOR_WIDTH_NORMAL = 520
const EDITOR_WIDTH_SPLIT = 900

export function ContentReviewScreen({ flow, token, onSaved, onCancel }: Props) {
  const [html, setHtml] = useState(flow.generatedHtml ?? "")
  const [savingMode, setSavingMode] = useState<"append" | "override" | null>(null)
  const saving = savingMode !== null
  const [toast, setToast] = useState<{
    msg: string
    type: "success" | "error"
  } | null>(null)

  const [translating, setTranslating] = useState(false)
  const [targetLang, setTargetLang] = useState<string | null>(null)
  const [targetLangDisplay, setTargetLangDisplay] = useState<string | null>(null)
  const [translatedHtml, setTranslatedHtml] = useState("")
  const abortRef = useRef<AbortController | null>(null)

  const resizeWindow = (width: number) => {
    chrome.runtime.sendMessage({ type: "RESIZE_WINDOW", width }).catch(() => {})
  }

  const handleSelectLanguage = async (lang: string, display: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setTargetLang(lang)
    setTargetLangDisplay(display)
    setTranslating(true)
    setTranslatedHtml("")

    try {
      const result = await translateHtml(html, lang, controller.signal)
      setTranslatedHtml(result)
      resizeWindow(EDITOR_WIDTH_SPLIT)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      setToast({
        msg: e instanceof Error ? e.message : "Помилка перекладу",
        type: "error"
      })
      setTargetLang(null)
      setTargetLangDisplay(null)
    } finally {
      setTranslating(false)
    }
  }

  const handleCancelTranslation = () => {
    abortRef.current?.abort()
    setTargetLang(null)
    setTargetLangDisplay(null)
    setTranslatedHtml("")
    resizeWindow(EDITOR_WIDTH_NORMAL)
  }

  const handleSave = async (mode: "append" | "override") => {
    setSavingMode(mode)
    try {
      const { destination } = flow
      const contentToSave = translatedHtml || html

      let mediaHtml = ""
      if (flow.flowType === "video" && flow.videoWpUrl) {
        mediaHtml = `<video class="aligncenter" src="${flow.videoWpUrl}" controls style="max-width:100%"></video>\n`
      } else if (flow.annotatedDataUrl) {
        const blob = dataUrlToBlob(flow.annotatedDataUrl)
        const filename = `docshot-${Date.now()}.png`
        const media = await uploadMedia(blob, filename, token)
        mediaHtml = `<img class="aligncenter size-full" src="${media.source_url}" alt="" />\n`
      }

      const newFinalHtml = mediaHtml + contentToSave

      const post = await getPost(destination.tabId, token)
      const content = JSON.parse(JSON.stringify(post.acf.content))

      let existingHtml = ""
      if (destination.targetField === "content_main") {
        existingHtml = content[destination.elementIndex].content_main ?? ""
      } else if (destination.targetField === "subcontent" && destination.subIndex != null) {
        existingHtml = content[destination.elementIndex]?.content_sub?.[destination.subIndex]?.subcontent ?? ""
      }

      const finalHtml = mode === "append" && existingHtml
        ? existingHtml + "\n" + newFinalHtml
        : newFinalHtml

      if (destination.targetField === "content_main") {
        content[destination.elementIndex].content_main = finalHtml
      } else if (
        destination.targetField === "subcontent" &&
        destination.subIndex != null &&
        content[destination.elementIndex]?.content_sub
      ) {
        content[destination.elementIndex].content_sub[
          destination.subIndex
        ].subcontent = finalHtml
      }

      const updatedPost = await updatePostAcf(destination.tabId, content, token)
      await clearCaptureFlow()

      setToast({ msg: mode === "append" ? "Додано успішно" : "Замінено успішно", type: "success" })
      setTimeout(() => onSaved(updatedPost), 1200)
    } catch (e) {
      setToast({
        msg: e instanceof Error ? e.message : "Помилка збереження",
        type: "error"
      })
    } finally {
      setSavingMode(null)
    }
  }

  const isSplitView = !!translatedHtml && !translating

  return (
    <div className="flex flex-1 flex-col min-h-0 p-3 gap-2">
      {/* Media preview (not editable) */}
      {flow.flowType === "video" && flow.videoWpUrl ? (
        <video
          src={flow.videoWpUrl}
          controls
          className="shrink-0 w-full rounded"
          style={{ maxHeight: 140 }}
        />
      ) : flow.annotatedDataUrl ? (
        <img
          src={flow.annotatedDataUrl}
          className="shrink-0 w-full rounded object-contain"
          style={{ maxHeight: 140 }}
        />
      ) : null}

      <TranslateBar
        translating={translating}
        splitActive={isSplitView}
        onSelectLanguage={handleSelectLanguage}
        onCancel={handleCancelTranslation}
      />

      {isSplitView ? (
        <TranslationPanel
          originalHtml={html}
          onChangeOriginal={setHtml}
          translatedHtml={translatedHtml}
          language={targetLangDisplay!}
          onChangeTranslated={setTranslatedHtml}
        />
      ) : (
        <RichTextEditor value={html} onChange={setHtml} />
      )}

      {toast && (
        <div className="shrink-0">
          <Toast
            message={toast.msg}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <ScreenFooter className="-mx-3 -mb-3">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Скасувати
        </Button>
        <Button variant="secondary" loading={savingMode === "append"} disabled={saving} onClick={() => handleSave("append")}>
          {translatedHtml ? `Додати (${targetLangDisplay})` : "Додати"}
        </Button>
        <Button loading={savingMode === "override"} disabled={saving} onClick={() => handleSave("override")}>
          {translatedHtml ? `Замінити (${targetLangDisplay})` : "Замінити"}
        </Button>
      </ScreenFooter>
    </div>
  )
}
