import { useCallback, useEffect, useRef, useState } from "react"

import "../style.css"

import { AnnotatorScreen } from "../components/annotator/AnnotatorScreen"
import { AudioRecorderScreen } from "../components/audio/AudioRecorderScreen"
import { Breadcrumb } from "../components/editor/Breadcrumb"
import {
  CAPTURE_STEP_SCREENS,
  CaptureStepBar,
  SCREENSHOT_STEPS,
  VIDEO_STEPS
} from "../components/editor/CaptureStepBar"
import { TabEditor } from "../components/editor/TabEditor"
import { PostSelector } from "../components/project/PostSelector"
import { AiProcessingScreen } from "../components/review/AiProcessingScreen"
import { ContentReviewScreen } from "../components/review/ContentReviewScreen"
import { VideoRecorderScreen } from "../components/video/VideoRecorderScreen"
import { getPost } from "../core/api"
import { GEMINI_MODEL } from "../core/config"
import type { Destination, EditorScreen, WPPost } from "../core/types"
import { useAuth } from "../hooks/useAuth"
import { useCaptureFlow } from "../hooks/useCaptureFlow"
import {
  getAiKeys,
  getLastDestination,
  getLastPost,
  setAiKeys,
  setLastDestination,
  setLastPost
} from "../store/session"

function EditorWindow() {
  const { auth, isLoading } = useAuth()
  const [screen, setScreen] = useState<EditorScreen>("post-selector")
  const [postSelectorKey, setPostSelectorKey] = useState(0)
  const [post, setPost] = useState<WPPost | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [aiModel, setAiModel] = useState(GEMINI_MODEL)
  const {
    flow,
    patch: patchFlow,
    clear: clearFlow,
    refresh: refreshFlow
  } = useCaptureFlow()
  const isTabEditorDirtyRef = useRef(false)

  // Restore last context and read initial screen from storage
  useEffect(() => {
    Promise.all([
      getLastPost(),
      getLastDestination(),
      chrome.storage.session.get("editorInitScreen"),
      getAiKeys()
    ]).then(([p, d, { editorInitScreen }, { geminiModel }]) => {
      if (p) setPost(p)
      if (d) setDestination(d)
      if (geminiModel) setAiModel(geminiModel)
      if (editorInitScreen) {
        setScreen(editorInitScreen as EditorScreen)
        chrome.storage.session.remove("editorInitScreen")
      } else if (p) {
        setScreen("tab-editor")
      }
    })
  }, [])

  const handleAiModelChange = useCallback(async (model: string) => {
    setAiModel(model)
    const { geminiKey } = await getAiKeys()
    if (geminiKey) await setAiKeys({ geminiKey, geminiModel: model })
  }, [])

  // Listen for NAVIGATE and PING messages from background
  useEffect(() => {
    const handler = (
      message: { type: string; screen?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r: unknown) => void
    ) => {
      if (message.type === "PING") {
        sendResponse({ ok: true })
        return true
      }
      if (message.type === "NAVIGATE" && message.screen) {
        const target = message.screen as EditorScreen
        refreshFlow().then(() => setScreen(target))
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [refreshFlow])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !auth.token) return
      if (screen === "tab-editor" && post) {
        if (isTabEditorDirtyRef.current) return
        getPost(post.id, auth.token).then((fresh) => {
          if (fresh) { setPost(fresh); setLastPost(fresh) }
        })
      } else if (screen === "post-selector") {
        setPostSelectorKey((k) => k + 1)
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [screen, post, auth.token])

  const navigate = useCallback((s: EditorScreen) => {
    if (s === "post-selector") setPostSelectorKey((k) => k + 1)
    setScreen(s)
  }, [])

  const handlePostSelect = useCallback(async (selectedPost: WPPost) => {
    setPost(selectedPost)
    await setLastPost(selectedPost)
    setScreen("tab-editor")
  }, [])

  const handleDestinationChange = useCallback((dest: Destination) => {
    setDestination(dest)
  }, [])

  const handleAnnotationConfirm = useCallback(
    async (annotatedDataUrl: string, annotations: any[]) => {
      await patchFlow({ annotatedDataUrl, annotations })
      chrome.runtime.sendMessage({
        type: "ANNOTATION_DONE",
        annotatedDataUrl,
        annotations
      })
    },
    [patchFlow]
  )

  const handleAudioConfirm = useCallback(
    (transcript: string) => {
      chrome.runtime.sendMessage({
        type: "AUDIO_DONE",
        transcript,
        annotatedDataUrl: flow?.annotatedDataUrl
      })
    },
    [flow?.annotatedDataUrl]
  )

  const handleSaved = useCallback(
    (updatedPost: WPPost) => {
      clearFlow()
      setPost(updatedPost)
      setScreen("tab-editor")
    },
    [clearFlow]
  )

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <span className="text-sm text-gray-400">Завантаження…</span>
      </div>
    )
  }

  if (!auth.token) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc] p-8">
        <div className="text-center">
          <p className="font-medium text-gray-700">Не авторизовано</p>
          <p className="mt-1 text-xs text-gray-500">
            Відкрийте popup розширення та увійдіть.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-screen flex-col bg-[#f8fafc]"
      style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Top bar — hidden for annotator (canvas needs full height) */}
      {screen !== "annotator" && (
        <div className="shrink-0 border-b border-gray-200 bg-white">
          {!CAPTURE_STEP_SCREENS.has(screen) && (
            <div className="flex items-center justify-between gap-2 px-4 py-2">
              <Breadcrumb post={post} screen={screen} onNavigate={navigate} />
            </div>
          )}
          {CAPTURE_STEP_SCREENS.has(screen) && (
            <CaptureStepBar
              current={screen}
              steps={
                flow?.flowType === "video" ? VIDEO_STEPS : SCREENSHOT_STEPS
              }
              post={post}
              destination={destination}
            />
          )}
        </div>
      )}

      {/* Screen content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {screen === "post-selector" && (
          <div className="flex-1 flex flex-col overflow-y-auto min-h-0 p-4">
            <PostSelector
              token={auth.token}
              refreshKey={postSelectorKey}
              onSelect={handlePostSelect}
            />
          </div>
        )}

        {screen === "tab-editor" && post && (
          <TabEditor
            token={auth.token}
            post={post}
            currentDestination={destination}
            onDestinationChange={handleDestinationChange}
            onClearDestination={() => {
              setDestination(null)
              setLastDestination(null)
            }}
            onDirtyChange={(dirty) => { isTabEditorDirtyRef.current = dirty }}
          />
        )}
        {screen === "tab-editor" && !post && (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-gray-400">
            <div>
              <p>Оберіть документ</p>
              <button
                onClick={() => navigate("post-selector")}
                className="mt-2 text-xs text-blue-600 underline">
                ← Назад
              </button>
            </div>
          </div>
        )}

        {screen === "annotator" && flow?.rawDataUrl && (
          <AnnotatorScreen
            imageDataUrl={flow.rawDataUrl}
            onConfirm={handleAnnotationConfirm}
            onCancel={() => {
              clearFlow()
              chrome.runtime
                .sendMessage({ type: "CLOSE_EDITOR_WINDOW" })
                .catch(() => {})
            }}
          />
        )}

        {screen === "audio-recorder" && (
          <AudioRecorderScreen
            screenshotUrl={flow?.annotatedDataUrl}
            onConfirm={handleAudioConfirm}
            onCancel={() => {
              clearFlow()
              chrome.runtime
                .sendMessage({ type: "CLOSE_EDITOR_WINDOW" })
                .catch(() => {})
            }}
          />
        )}

        {screen === "video-recorder" && (
          <VideoRecorderScreen
            token={auth.token}
            onCancel={() => {
              clearFlow()
              chrome.runtime
                .sendMessage({ type: "CLOSE_EDITOR_WINDOW" })
                .catch(() => {})
            }}
          />
        )}

        {screen === "ai-processing" && (
          <AiProcessingScreen
            flowType={flow?.flowType}
            error={flow?.aiError}
            currentModel={aiModel}
            onModelChange={handleAiModelChange}
            onRetry={() =>
              chrome.runtime.sendMessage({ type: "RETRY_AI" }).catch(() => {})
            }
            onCancel={() => {
              chrome.runtime.sendMessage({ type: "CANCEL_AI" }).catch(() => {})
              clearFlow()
              navigate("tab-editor")
            }}
          />
        )}

        {screen === "content-review" && flow && auth.token && (
          <ContentReviewScreen
            flow={flow}
            token={auth.token}
            onSaved={handleSaved}
            onCancel={() => {
              clearFlow()
              chrome.runtime
                .sendMessage({ type: "CLOSE_EDITOR_WINDOW" })
                .catch(() => {})
            }}
          />
        )}
      </div>
    </div>
  )
}

export default EditorWindow
