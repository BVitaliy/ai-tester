import React, { useEffect, useState } from "react"
import { CheckCircle, XCircle, ChevronLeft, Eye, EyeOff } from "lucide-react"
import { cn } from "../../lib/cn"
import type { ProviderKeys, SelectedModels } from "../../core/types"
import {
  getProviderKeys,
  setProviderKeys,
  getSettings,
  setSettings,
  getStoredProviderModels,
  setStoredProviderModels,
  type JackSettings,
} from "../../store/jack"
import { validateKey, fetchProviderModels } from "../../core/api/aiService"
import { useLanguage } from "../../contexts/LanguageContext"
import { LANG_LABELS, type LangCode } from "../../core/i18n"

interface Props {
  onBack: () => void
  onLangChange?: (lang: LangCode) => void
}

const PROVIDERS = [
  { id: "openai",      label: "OpenAI",      keyField: "openaiKey"      as keyof ProviderKeys },
  { id: "gemini",      label: "Gemini",       keyField: "geminiKey"      as keyof ProviderKeys },
  { id: "groq",        label: "Groq",         keyField: "groqKey"        as keyof ProviderKeys },
  { id: "openrouter",  label: "OpenRouter",   keyField: "openrouterKey"  as keyof ProviderKeys },
  { id: "grok",        label: "xAI Grok",     keyField: "grokKey"        as keyof ProviderKeys },
] as const

type ProviderId = typeof PROVIDERS[number]["id"]

const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  openai:      ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  gemini:      ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  groq:        ["llama-3.3-70b-versatile", "llama3-70b-8192", "mixtral-8x7b-32768"],
  openrouter:  ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "meta-llama/llama-3.3-70b-instruct"],
  grok:        ["grok-2-1212", "grok-beta"],
}

type ValidationState = "idle" | "checking" | "ok" | "fail"

const selStyle: React.CSSProperties = {
  flex: 1,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  padding: "4px 6px",
  fontSize: 11,
  color: "var(--fg)",
  outline: "none",
  minWidth: 0,
}

export function ProviderKeysSettings({ onBack, onLangChange }: Props) {
  const { t, lang, setLang } = useLanguage()
  const [keys, setKeys] = useState<ProviderKeys | null>(null)
  const [validity, setValidity] = useState<Partial<Record<ProviderId, ValidationState>>>({})
  const [fetchedModels, setFetchedModels] = useState<Partial<Record<ProviderId, string[]>>>({})
  const [showKey, setShowKey] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [selectedModels, setSelectedModels] = useState<SelectedModels>({
    mediaAnalysisProvider: "openai",
    mediaAnalysisModel: FALLBACK_MODELS.openai[1],
    codeGenProvider: "openai",
    codeGenModel: FALLBACK_MODELS.openai[0],
    reviewProvider: undefined,
    reviewModel: undefined,
  })
  const [framework, setFramework] = useState<JackSettings["targetFramework"]>("playwright")
  const [language, setLanguage] = useState<JackSettings["targetLanguage"]>("typescript")
  const [uiLanguage, setUiLanguage] = useState<LangCode>(lang)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [k, s, stored] = await Promise.all([
        getProviderKeys(),
        getSettings(),
        getStoredProviderModels(),
      ])
      setKeys(k)
      if (s) {
        setSelectedModels(s.selectedModels)
        setFramework(s.targetFramework)
        setLanguage(s.targetLanguage)
        if (s.uiLanguage) setUiLanguage(s.uiLanguage)
      }
      if (Object.keys(stored).length > 0) {
        setFetchedModels(stored as Partial<Record<ProviderId, string[]>>)
      }
    })()
  }, [])

  if (!keys) {
    return (
      <div style={{ width: 440, padding: 24, color: "var(--fg)", backgroundColor: "var(--bg)" }}>
        {t("loading")}
      </div>
    )
  }

  const getKey = (p: typeof PROVIDERS[number]) => (keys[p.keyField] as string | null) ?? ""
  const hasKey = (id: ProviderId) => {
    const p = PROVIDERS.find((x) => x.id === id)!
    return (keys[p.keyField] as string | null)?.trim().length > 0
  }

  const availableProviders = PROVIDERS.filter((p) => hasKey(p.id)).map((p) => p.id)
  const analysisProviders = availableProviders.filter((p): p is "openai" | "gemini" | "openrouter" =>
    ["openai", "gemini", "openrouter"].includes(p)
  )

  const getModels = (pid: ProviderId): string[] =>
    fetchedModels[pid]?.length ? fetchedModels[pid]! : FALLBACK_MODELS[pid]

  const isLive = (pid: ProviderId) => Boolean(fetchedModels[pid]?.length)

  const handleKeyChange = (p: typeof PROVIDERS[number], value: string) => {
    setKeys((prev) => prev ? { ...prev, [p.keyField]: value || null } : prev)
    setValidity((v) => ({ ...v, [p.id]: "idle" }))
  }

  const handleValidate = async (p: typeof PROVIDERS[number]) => {
    const key = getKey(p)
    if (!key) return
    setValidity((v) => ({ ...v, [p.id]: "checking" }))
    const ok = await validateKey(p.id, key)
    setValidity((v) => ({ ...v, [p.id]: ok ? "ok" : "fail" }))
    if (ok) {
      const models = await fetchProviderModels(p.id, key)
      if (models.length > 0) {
        setFetchedModels((prev) => {
          const next = { ...prev, [p.id]: models }
          setStoredProviderModels(next)
          return next
        })
      }
    }
  }

  const setTaskProvider = (
    task: "mediaAnalysis" | "codeGen" | "review",
    provider: string
  ) => {
    if (task === "review" && provider === "none") {
      setSelectedModels((prev) => ({ ...prev, reviewProvider: undefined, reviewModel: undefined }))
      return
    }
    const pid = provider as ProviderId
    const model = getModels(pid)?.[0] ?? ""
    if (task === "mediaAnalysis") {
      setSelectedModels((prev) => ({
        ...prev,
        mediaAnalysisProvider: pid as SelectedModels["mediaAnalysisProvider"],
        mediaAnalysisModel: model,
      }))
    } else if (task === "codeGen") {
      setSelectedModels((prev) => ({
        ...prev,
        codeGenProvider: pid as SelectedModels["codeGenProvider"],
        codeGenModel: model,
      }))
    } else {
      setSelectedModels((prev) => ({ ...prev, reviewProvider: pid, reviewModel: model }))
    }
  }

  const handleSave = async () => {
    if (!keys) return
    setSaving(true)
    try {
      await setProviderKeys(keys)
      await setSettings({ selectedModels, targetFramework: framework, targetLanguage: language, uiLanguage })
      setLang(uiLanguage)
      onLangChange?.(uiLanguage)
    } finally {
      setSaving(false)
      onBack()
    }
  }

  const chip = (active: boolean, onClick: () => void, label: string) => (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        background: active ? "var(--primary)" : "var(--bg)",
        color: active ? "#fff" : "#94a3b8",
        border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
        cursor: "pointer",
        transition: "all 0.12s",
      }}>
      {label}
    </button>
  )

  const sectionTitle = (text: string) => (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "#64748b",
        textTransform: "uppercase",
        paddingBottom: 6,
        borderBottom: "1px solid var(--border)",
        marginBottom: 8,
      }}>
      {text}
    </div>
  )

  return (
    <div
      style={{
        width: 440,
        maxHeight: 580,
        backgroundColor: "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--card)",
          flexShrink: 0,
        }}>
        <button
          onClick={onBack}
          style={{ color: "var(--fg)", opacity: 0.6, display: "flex" }}
          className="hover:opacity-100 transition-opacity">
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Настройки</span>
      </div>

      {/* Scrollable content */}
      <div className="jack-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>

        {/* Section 1: API Keys */}
        <div style={{ marginBottom: 16 }}>
          {sectionTitle(t("apiKeysSection"))}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PROVIDERS.map((p) => {
              const val = getKey(p)
              const vs = validity[p.id] ?? "idle"
              const shown = showKey[p.id]
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 76,
                      fontSize: 11,
                      fontWeight: 500,
                      color: hasKey(p.id) ? "#f87171" : "#64748b",
                      flexShrink: 0,
                    }}>
                    {p.label}
                  </span>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={shown ? "text" : "password"}
                      value={val}
                      onChange={(e) => handleKeyChange(p, e.target.value)}
                      placeholder="sk-…"
                      style={{
                        width: "100%",
                        background: "var(--card)",
                        border: `1px solid ${hasKey(p.id) ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
                        borderRadius: 6,
                        padding: "5px 28px 5px 8px",
                        fontSize: 11,
                        color: "var(--fg)",
                        outline: "none",
                        fontFamily: "monospace",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      onClick={() => setShowKey((s) => ({ ...s, [p.id]: !s[p.id] }))}
                      style={{
                        position: "absolute",
                        right: 6,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#64748b",
                        display: "flex",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}>
                      {shown ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleValidate(p)}
                    disabled={!val || vs === "checking"}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 5,
                      fontSize: 10,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid var(--border)",
                      color: !val ? "#475569" : "var(--fg)",
                      cursor: val ? "pointer" : "not-allowed",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}>
                    {vs === "checking" ? "…" : t("testKey")}
                  </button>
                  {vs === "ok" && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, minWidth: 36 }}>
                      <CheckCircle size={13} style={{ color: "#22c55e" }} />
                      <span style={{ fontSize: 8, color: "#22c55e", whiteSpace: "nowrap" }}>
                        {isLive(p.id) ? `${fetchedModels[p.id]!.length} моделей` : "✓"}
                      </span>
                    </div>
                  )}
                  {vs === "fail" && <XCircle size={14} style={{ color: "#ef4444", flexShrink: 0 }} />}
                  {vs === "idle" && (
                    <span style={{ width: 36, fontSize: 8, color: "#475569", flexShrink: 0, whiteSpace: "nowrap" }}>
                      {hasKey(p.id) && !isLive(p.id) ? "→ Тест" : ""}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Section 2: Task model assignment */}
        <div style={{ marginBottom: 16 }}>
          {sectionTitle(t("modelsSection"))}
          {availableProviders.length === 0 ? (
            <p style={{ fontSize: 11, color: "#64748b" }}>
              {t("noProvidersHint")}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(
                [
                  { label: t("mediaAnalysisTask"), task: "mediaAnalysis" as const, provider: selectedModels.mediaAnalysisProvider, model: selectedModels.mediaAnalysisModel, providers: analysisProviders },
                  { label: t("codeGenTask"), task: "codeGen" as const, provider: selectedModels.codeGenProvider, model: selectedModels.codeGenModel, providers: availableProviders },
                  { label: t("reviewTask"), task: "review" as const, provider: selectedModels.reviewProvider ?? "none", model: selectedModels.reviewModel ?? "", providers: ["none" as const, ...availableProviders] },
                ] as const
              ).map(({ label, task, provider, model, providers }) => {
                const pid = provider !== "none" ? (provider as ProviderId) : null
                const modelList = pid ? getModels(pid) : []
                const isFetched = pid ? isLive(pid) : false
                return (
                  <div key={task}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{label}</span>
                      {isFetched && (
                        <span style={{ fontSize: 9, color: "#22c55e", opacity: 0.8 }}>
                          live
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        value={provider}
                        onChange={(e) => setTaskProvider(task, e.target.value)}
                        style={selStyle}>
                        {providers.map((p) => (
                          <option key={p} value={p}>
                            {p === "none" ? t("disableReview") : PROVIDERS.find((x) => x.id === p)?.label ?? p}
                          </option>
                        ))}
                      </select>
                      {pid && (
                        <select
                          value={modelList.includes(model) ? model : modelList[0] ?? model}
                          onChange={(e) => {
                            const m = e.target.value
                            if (task === "mediaAnalysis") setSelectedModels((prev) => ({ ...prev, mediaAnalysisModel: m }))
                            else if (task === "codeGen") setSelectedModels((prev) => ({ ...prev, codeGenModel: m }))
                            else setSelectedModels((prev) => ({ ...prev, reviewModel: m }))
                          }}
                          style={selStyle}>
                          {modelList.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Section 3: UI Language */}
        <div style={{ marginBottom: 16 }}>
          {sectionTitle(t("uiLanguageSection"))}
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.entries(LANG_LABELS) as [LangCode, string][]).map(([code, label]) =>
              chip(uiLanguage === code, () => setUiLanguage(code), label)
            )}
          </div>
        </div>

        {/* Section 4: Target stack */}
        <div style={{ marginBottom: 4 }}>
          {sectionTitle(t("targetStackSection"))}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 5 }}>Фреймворк</div>
              <div style={{ display: "flex", gap: 6 }}>
                {chip(framework === "playwright", () => setFramework("playwright"), "Playwright")}
                {chip(framework === "cypress", () => setFramework("cypress"), "Cypress")}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 5 }}>Язык</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {chip(language === "typescript", () => setLanguage("typescript"), "TypeScript")}
                {chip(language === "javascript", () => setLanguage("javascript"), "JavaScript")}
                {chip(language === "dotnet", () => setLanguage("dotnet"), ".Net")}
                {chip(language === "java", () => setLanguage("java"), "Java")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          backgroundColor: "var(--card)",
          flexShrink: 0,
        }}>
        <button
          onClick={onBack}
          style={{
            padding: "6px 16px",
            borderRadius: 7,
            fontSize: 12,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "#94a3b8",
            cursor: "pointer",
          }}>
          Назад
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "6px 20px",
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
            background: saving ? "#374151" : "var(--primary)",
            border: "none",
            color: saving ? "#94a3b8" : "#fff",
            cursor: saving ? "not-allowed" : "pointer",
          }}>
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  )
}
