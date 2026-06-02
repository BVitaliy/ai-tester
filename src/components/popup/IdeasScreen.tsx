import React, { useEffect, useRef, useState } from "react"
import { Trash2, RefreshCw, Plus, ChevronLeft, Zap } from "lucide-react"
import { cn } from "../../lib/cn"
import type { JackGenStatus, JackSessionState, SelectedModels, TestCaseIdea } from "../../core/types"
import {
  getGenStatus,
  getLastSessionKey,
  getSessionState,
  getSettings,
  updateSessionState,
} from "../../store/jack"
import { generateTestIdeas } from "../../core/api/aiService"
import { useLanguage } from "../../contexts/LanguageContext"
import { VoiceInput } from "../ui/VoiceInput"
import { GenStatusBanner } from "../ui/GenStatusBanner"

interface Props {
  onBack: () => void
  onOpenCode: () => void
}

export function IdeasScreen({ onBack, onOpenCode }: Props) {
  const { t, lang } = useLanguage()
  const [ideas, setIdeas] = useState<TestCaseIdea[]>([])
  const [session, setSession] = useState<JackSessionState | null>(null)
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<SelectedModels | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [refinement, setRefinement] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [genStatus, setGenStatus] = useState<JackGenStatus>({ phase: "idle" })
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getLastSessionKey().then(async (key) => {
      setSessionKey(key)
      const state = key ? await getSessionState(key) : await getSessionState()
      if (state) {
        setSession(state)
        setIdeas(state.testIdeas ?? [])
      }
    })
    getSettings().then((s) => {
      if (s) setSelectedModels(s.selectedModels)
    })
    getGenStatus().then(setGenStatus)

    const onStorage = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== "local") return
      if (changes.jackGenStatus) {
        const next: JackGenStatus = changes.jackGenStatus.newValue ?? { phase: "idle" }
        setGenStatus(next)
      }
      if (changes.jackTabSessions) {
        getLastSessionKey().then(async (key) => {
          if (!key) return
          const state = await getSessionState(key)
          if (state) setIdeas(state.testIdeas ?? [])
        })
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [])

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus()
  }, [editingId])

  const saveIdeas = async (next: TestCaseIdea[]) => {
    setIdeas(next)
    if (sessionKey) await updateSessionState({ testIdeas: next }, sessionKey)
  }

  const handleDelete = (id: string) => saveIdeas(ideas.filter((i) => i.id !== id))

  const handleEdit = (id: string, text: string) =>
    saveIdeas(ideas.map((i) => (i.id === id ? { ...i, text } : i)))

  const handleRegenerate = async (id: string) => {
    const idea = ideas.find((i) => i.id === id)
    if (!idea || !session) return
    setRegeneratingId(id)
    try {
      const existingOthers = ideas
        .filter((i) => i.id !== id && i.text.trim())
        .map((i, n) => `${n + 1}. ${i.text}`)
        .join("\n")

      const context = [
        session.mediaDescription,
        session.htmlContext,
        session.recordedActions?.map((a) => `${a.type} ${a.selector}`).join("; "),
        session.customPrompt,
        existingOthers
          ? `Already existing ideas (do not duplicate):\n${existingOthers}`
          : null,
        refinement.trim()
          ? `Generate ONE new unique test idea specifically about: ${refinement.trim()}`
          : `Replace idea #${ideas.findIndex((i) => i.id === id) + 1} with a new unique one: "${idea.text}"`,
      ]
        .filter(Boolean)
        .join("\n\n")

      const provider = selectedModels?.codeGenProvider ?? "openai"
      const model = selectedModels?.codeGenModel ?? "gpt-4o-mini"
      const newIdeas = await generateTestIdeas({ context, provider, model, lang })
      const text = newIdeas[0]?.text || idea.text
      await saveIdeas(ideas.map((i) => (i.id === id ? { ...i, text } : i)))
    } catch (err) {
      console.error(err)
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleAdd = () => {
    const text = refinement.trim()
    const newIdea: TestCaseIdea = { id: crypto.randomUUID(), text }
    const next = [...ideas, newIdea]
    saveIdeas(next)
    if (text) {
      setRefinement("")
    } else {
      setEditingId(newIdea.id)
    }
  }

  const handleGenerateCode = () => {
    if (!sessionKey || ideas.length === 0) return
    chrome.runtime.sendMessage({ type: "JACK_GENERATE_CODE", sessionKey }).catch(() => {})
    onOpenCode()
  }

  const handleRetry = () => {
    if (!sessionKey) return
    const failedPhase = genStatus.failedPhase
    chrome.runtime
      .sendMessage({ type: "JACK_RETRY", sessionKey, failedPhase })
      .catch(() => {})
  }

  const isGenerating =
    genStatus.phase === "analyzing-media" || genStatus.phase === "generating-ideas"
  const isError = genStatus.phase === "error"

  return (
    <div
      style={{
        width: 440,
        maxHeight: 580,
        backgroundColor: "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
      }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--card)",
        }}>
        <button
          onClick={onBack}
          style={{ color: "var(--fg)", opacity: 0.6, display: "flex" }}
          className="hover:opacity-100 transition-opacity">
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t("ideasTitle")}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#f87171",
            backgroundColor: "rgba(220,38,38,0.15)",
            padding: "2px 8px",
            borderRadius: 99,
          }}>
          {t("ideasCount", { n: ideas.length })}
        </span>
      </div>

      {/* Status banner */}
      {(isGenerating || isError) && (
        <div style={{ padding: "6px 12px 0" }}>
          <GenStatusBanner
            status={genStatus}
            onRetry={isError ? handleRetry : undefined}
          />
        </div>
      )}

      {/* Ideas list */}
      <div className="jack-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {ideas.length === 0 && !isGenerating && (
          <p style={{ textAlign: "center", color: "#64748b", fontSize: 13, marginTop: 32 }}>
            {t("noIdeasHint")}
          </p>
        )}
        {ideas.map((idea, idx) => (
          <div
            key={idea.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "7px 8px",
              marginBottom: 4,
              borderRadius: 8,
              backgroundColor: editingId === idea.id ? "rgba(220,38,38,0.08)" : "var(--card)",
              border: `1px solid ${editingId === idea.id ? "#dc2626" : "var(--border)"}`,
            }}>
            <span
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: 6,
                backgroundColor: "rgba(220,38,38,0.2)",
                color: "#f87171",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}>
              {idx + 1}
            </span>

            {editingId === idea.id ? (
              <textarea
                ref={editRef}
                value={idea.text}
                onChange={(e) => handleEdit(idea.id, e.target.value)}
                onBlur={() => setEditingId(null)}
                rows={2}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--fg)",
                  fontSize: 13,
                  resize: "none",
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                }}
              />
            ) : (
              <span
                onClick={() => setEditingId(idea.id)}
                style={{
                  flex: 1,
                  fontSize: 13,
                  lineHeight: 1.5,
                  cursor: "text",
                  wordBreak: "break-word",
                }}>
                {idea.text || <span style={{ color: "#64748b" }}>{t("ideaPlaceholder")}</span>}
              </span>
            )}

            <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 1 }}>
              <button
                onClick={() => handleRegenerate(idea.id)}
                disabled={regeneratingId === idea.id}
                title="Уточнити через AI"
                style={{ color: "#f87171", opacity: regeneratingId === idea.id ? 0.4 : 0.7 }}
                className="hover:opacity-100 transition-opacity">
                <RefreshCw size={13} className={cn(regeneratingId === idea.id && "animate-spin")} />
              </button>
              <button
                onClick={() => handleDelete(idea.id)}
                title="Видалити"
                style={{ color: "#f87171", opacity: 0.6 }}
                className="hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Refinement input */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          backgroundColor: "var(--card)",
        }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <VoiceInput
            value={refinement}
            onChange={setRefinement}
            placeholder={t("refinementPlaceholder")}
            className="flex-1"
            inputClassName="text-xs py-1"
          />
          <button
            onClick={handleAdd}
            title="Додати ідею"
            style={{
              background: "rgba(220,38,38,0.15)",
              border: "1px solid rgba(220,38,38,0.3)",
              borderRadius: 6,
              padding: "5px 8px",
              color: "#f87171",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}>
            <Plus size={14} />
          </button>
        </div>
        <button
          onClick={handleGenerateCode}
          disabled={ideas.length === 0}
          style={{
            width: "100%",
            background: ideas.length === 0 ? "#1e2533" : "var(--primary)",
            color: ideas.length === 0 ? "#64748b" : "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 0",
            fontSize: 13,
            fontWeight: 600,
            cursor: ideas.length === 0 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transition: "background 0.15s",
          }}>
          <Zap size={14} />
          {t("generateCode")}
        </button>
      </div>
    </div>
  )
}
