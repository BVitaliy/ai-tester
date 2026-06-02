import React, { useCallback, useEffect, useRef, useState } from "react"

import { drawAnnotation } from "../../core/drawAnnotation"
import type {
  Annotation,
  AnnotationColor,
  AnnotationTool
} from "../../core/types"
import { Button } from "../ui/Button"
import { ScreenFooter } from "../ui/ScreenFooter"

interface Props {
  imageDataUrl: string
  onConfirm: (annotatedDataUrl: string, annotations: Annotation[]) => void
  onCancel: () => void
}

const COLORS: { label: string; value: AnnotationColor }[] = [
  { label: "Червоний", value: "#EF4444" },
  { label: "Жовтий", value: "#F59E0B" },
  { label: "Зелений", value: "#22C55E" },
  { label: "Синій", value: "#3B82F6" },
  { label: "Чорний", value: "#000000" }
]

const TOOLS: { label: string; value: AnnotationTool }[] = [
  { label: "Стрілка", value: "arrow" },
  { label: "Текст", value: "text" },
  { label: "Лінія", value: "line" },
  { label: "Прямокутник", value: "rectangle" }
]

export function AnnotatorScreen({ imageDataUrl, onConfirm, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [tool, setTool] = useState<AnnotationTool>("arrow")
  const [color, setColor] = useState<AnnotationColor>("#EF4444")
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(
    null
  )
  const textInputRef = useRef<HTMLSpanElement>(null)
  const dragRef = useRef<{
    startMouseX: number
    startMouseY: number
    startX: number
    startY: number
  } | null>(null)
  const [textValue, setTextValue] = useState("")
  const drawingRef = useRef(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    }
  }

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.naturalWidth) return
    // Sync canvas resolution to the image so the aspect ratio is always correct
    if (
      canvas.width !== img.naturalWidth ||
      canvas.height !== img.naturalHeight
    ) {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
    }
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const all = draft ? [...annotations, draft] : annotations
    all.forEach((a) => drawAnnotation(ctx, a, canvas.width, canvas.height))
  }, [annotations, draft])

  useEffect(() => {
    render()
  }, [render])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => render())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [render])

  useEffect(() => {
    if (textInput) {
      setTimeout(() => {
        textInputRef.current?.focus()
      }, 20)
    }
  }, [textInput])

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (textInput) {
      commitText()
      return
    }
    if (tool === "text") {
      const { x, y } = getCanvasCoords(e)
      setTextInput({ x, y })
      setTextValue("")
      return
    }
    drawingRef.current = true
    startRef.current = getCanvasCoords(e)
    setDraft({
      id: `a-${Date.now()}`,
      tool,
      color,
      points: [
        startRef.current.x,
        startRef.current.y,
        startRef.current.x,
        startRef.current.y
      ],
      strokeWidth
    })
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !startRef.current) return
    const startX = startRef.current.x
    const startY = startRef.current.y
    const { x, y } = getCanvasCoords(e)
    setDraft((d) => (d ? { ...d, points: [startX, startY, x, y] } : d))
  }

  const onMouseUp = () => {
    if (!drawingRef.current || !draft) return
    drawingRef.current = false
    startRef.current = null
    setAnnotations((prev) => [...prev, draft])
    setDraft(null)
  }

  const commitText = () => {
    const text = textInputRef.current?.innerText?.trim() ?? textValue.trim()
    if (!textInput || !text) {
      setTextInput(null)
      setTextValue("")
      return
    }
    setAnnotations((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}`,
        tool: "text",
        color,
        points: [textInput.x, textInput.y],
        text,
        strokeWidth
      }
    ])
    setTextInput(null)
    setTextValue("")
  }

  const undo = () => setAnnotations((prev) => prev.slice(0, -1))

  const handleConfirm = () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    // Export at natural image resolution
    const out = document.createElement("canvas")
    out.width = img.naturalWidth
    out.height = img.naturalHeight
    const ctx = out.getContext("2d")!
    ctx.drawImage(img, 0, 0)
    annotations.forEach((a) => drawAnnotation(ctx, a, out.width, out.height))
    onConfirm(out.toDataURL("image/png"), annotations)
  }

  return (
    <div className="flex flex-1 flex-col gap-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        {TOOLS.map((t) => (
          <Button
            key={t.value}
            variant={tool === t.value ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTool(t.value)}>
            {t.label}
          </Button>
        ))}
        <div className="mx-1 h-4 w-px bg-gray-200" />
        {COLORS.map((c) => (
          <button
            key={c.value}
            title={c.label}
            onClick={() => setColor(c.value)}
            className={`h-5 w-5 rounded-full border-2 ${color === c.value ? "border-gray-800" : "border-transparent"}`}
            style={{ background: c.value }}
          />
        ))}
        <div className="mx-1 h-4 w-px bg-gray-200" />
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Товщина</span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20 accent-blue-600"
          />
          <span className="w-3 text-center">{strokeWidth}</span>
        </label>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={annotations.length === 0}
          onClick={undo}>
          Скасувати
        </Button>
      </div>

      {/* Canvas */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-gray-100">
        <img
          ref={imgRef}
          src={imageDataUrl}
          alt=""
          style={{ display: "none" }}
          onLoad={render}
        />
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        {/* Text input overlay — positioned relative to the canvas element itself */}
        {textInput &&
          (() => {
            const canvas = canvasRef.current
            const canvasRect = canvas?.getBoundingClientRect()
            const wrapperRect = canvas?.parentElement?.getBoundingClientRect()
            if (!canvasRect || !wrapperRect || !canvas) return null
            const scale = canvasRect.width / canvas.width
            const fontPx =
              ((4 * strokeWidth * Math.max(canvas.width, canvas.height)) /
                400) *
              scale
            // offset of canvas inside the wrapper div (flex-centered)
            const offsetLeft = canvasRect.left - wrapperRect.left
            const offsetTop = canvasRect.top - wrapperRect.top
            const left = offsetLeft + textInput.x * canvasRect.width
            const top = offsetTop + textInput.y * canvasRect.height
            return (
              <span
                ref={textInputRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) =>
                  setTextValue((e.currentTarget as HTMLSpanElement).innerText)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    commitText()
                  }
                  if (e.key === "Escape") {
                    setTextInput(null)
                    setTextValue("")
                  }
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  dragRef.current = {
                    startMouseX: e.clientX,
                    startMouseY: e.clientY,
                    startX: textInput.x,
                    startY: textInput.y
                  }
                  const onMove = (me: MouseEvent) => {
                    if (!dragRef.current) return
                    const dx =
                      (me.clientX - dragRef.current.startMouseX) /
                      canvasRect.width
                    const dy =
                      (me.clientY - dragRef.current.startMouseY) /
                      canvasRect.height
                    setTextInput({
                      x: dragRef.current.startX + dx,
                      y: dragRef.current.startY + dy
                    })
                  }
                  const onUp = () => {
                    dragRef.current = null
                    window.removeEventListener("mousemove", onMove)
                    window.removeEventListener("mouseup", onUp)
                  }
                  window.addEventListener("mousemove", onMove)
                  window.addEventListener("mouseup", onUp)
                }}
                className="absolute bg-transparent cursor-move whitespace-pre"
                style={{
                  left,
                  top,
                  minWidth: 40,
                  color,
                  fontSize: `${fontPx}px`,
                  lineHeight: 1,
                  fontFamily: "system-ui",
                  outline: "1.5px dashed #3B82F6",
                  outlineOffset: "2px",
                  padding: 0,
                  margin: 0,
                  display: "block",
                  verticalAlign: "top"
                }}
              />
            )
          })()}
      </div>

      <ScreenFooter>
        <Button variant="secondary" onClick={onCancel}>
          Скасувати
        </Button>
        <Button onClick={handleConfirm}>Далі →</Button>
      </ScreenFooter>
    </div>
  )
}
