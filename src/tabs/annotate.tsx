import React, { useEffect, useState } from "react"

import "~style.css"

import { AnnotatorScreen } from "../components/annotator/AnnotatorScreen"
import { getScreenshot } from "../lib/screenshotStorage"
import { getAnnotateContext } from "../store/jack"

function AnnotateTab() {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    getAnnotateContext().then(async (ctx) => {
      if (!ctx) return
      const dataUrl = await getScreenshot(ctx.sessionKey, ctx.screenshotId)
      if (dataUrl) setImage(dataUrl)
    })
  }, [])

  const handleConfirm = async (annotatedDataUrl: string) => {
    await chrome.runtime.sendMessage({
      type: "ANNOTATE_DONE",
      annotatedDataUrl
    })
  }

  const handleCancel = () => {
    chrome.runtime.sendMessage({ type: "ANNOTATE_CANCEL" })
  }

  if (!image) {
    return <div className="p-4">Нет скриншота для аннотации</div>
  }
  return (
    <div className="h-screen w-screen flex flex-col">
      <AnnotatorScreen
        imageDataUrl={image}
        onConfirm={(annotated, _annotations) => handleConfirm(annotated)}
        onCancel={handleCancel}
      />
    </div>
  )
}

export default AnnotateTab
