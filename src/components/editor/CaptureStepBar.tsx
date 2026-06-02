import React from "react"

import type { Destination, EditorScreen, WPPost } from "../../core/types"

export const SCREENSHOT_STEPS: { screen: EditorScreen; label: string }[] = [
  { screen: "annotator", label: "Анотація" },
  { screen: "audio-recorder", label: "Опис" },
  { screen: "ai-processing", label: "AI" },
  { screen: "content-review", label: "Перегляд" }
]

export const VIDEO_STEPS: { screen: EditorScreen; label: string }[] = [
  { screen: "video-recorder", label: "Відео" },
  { screen: "ai-processing", label: "AI" },
  { screen: "content-review", label: "Перегляд" }
]

export const CAPTURE_STEP_SCREENS = new Set<EditorScreen>([
  "audio-recorder",
  "video-recorder",
  "ai-processing",
  "content-review"
])

interface CaptureStepBarProps {
  current: EditorScreen
  steps: { screen: EditorScreen; label: string }[]
  post: WPPost | null
  destination: Destination | null
}

export function CaptureStepBar({
  current,
  steps,
  post,
  destination
}: CaptureStepBarProps) {
  const activeIndex = steps.findIndex((s) => s.screen === current)

  const contextLabel = (() => {
    if (!post) return null
    const postTitle = post.title.rendered
    if (!destination?.sectionTitle) return postTitle
    const sectionLabel = destination.subSectionTitle
      ? `${destination.sectionTitle} › ${destination.subSectionTitle}`
      : destination.sectionTitle
    return `${postTitle} · ${sectionLabel}`
  })()

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-2 ">
      {contextLabel && (
        <span className="max-w-full truncate text-[11px] text-gray-500">
          {contextLabel}
        </span>
      )}
      <div className="flex items-center justify-center">
        {steps.map((step, i) => {
          const isDone = i < activeIndex
          const isActive = i === activeIndex
          const isLast = i === steps.length - 1
          return (
            <React.Fragment key={step.screen}>
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={[
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    isDone
                      ? "bg-blue-600 text-white"
                      : isActive
                        ? "bg-blue-600 text-white ring-2 ring-blue-200 ring-offset-1"
                        : "bg-gray-200 text-gray-400"
                  ].join(" ")}>
                  {isDone ? (
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={[
                    "text-[10px] font-medium leading-tight",
                    isActive
                      ? "text-blue-600"
                      : isDone
                        ? "text-gray-400"
                        : "text-gray-300"
                  ].join(" ")}>
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={[
                    "mb-4 h-px w-8 shrink-0",
                    isDone ? "bg-blue-600" : "bg-gray-200"
                  ].join(" ")}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
