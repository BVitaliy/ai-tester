import React, { useEffect, useRef, useState } from "react";
import { Smartphone, Trash2, X } from "lucide-react";
import "~style.css";

import { Button } from "./components/ui/Button";
import { VideoIcon, LightBulbIcon, SettingsIcon, CameraIcon, CrosshairIcon, RecordActionsIcon } from "./components/ui/icons";
import { Input } from "./components/ui/Input";
import { ProviderKeysSettings } from "./components/popup/ProviderKeysSettings";
import { IdeasScreen } from "./components/popup/IdeasScreen";
import { CodeScreen } from "./components/popup/CodeScreen";
import { MobileTestingScreen } from "./components/popup/MobileTestingScreen";
import { ActionCard } from "./components/popup/ActionCard";
import type { JackGenStatus, JackSessionState } from "./core/types";
import {
  addScreenshot,
  emptyJackSession,
  getActiveTab,
  getGenStatus,
  getSessionKeyFromUrl,
  getSessionState,
  getSessionVideoDataUrl,
  loadScreenshotsWithData,
  setAnnotateContext,
  setLastSessionKey,
  updateSessionState,
  getProviderKeys,
  getRecordingTabId,
  setRecordingTabId,
  deleteSessionScreenshot,
  deleteSessionVideo,
  clearSessionState,
  getUiLanguage
} from "./store/jack";
import { isInspectableTabUrl, sendTabMessage } from "./lib/tabMessage";
import { LanguageContext, makeT } from "./contexts/LanguageContext";
import type { LangCode } from "./core/i18n";
import { VoiceInput } from "./components/ui/VoiceInput";

// Root component for the extension popup.  It toggles between the
// main capture interface and the settings screen.  All session data is
// persisted in chrome.storage.session via the store helpers.

function MainPanel({ onOpenSettings, onOpenIdeas, onOpenCode, onOpenMobile }: { onOpenSettings: () => void; onOpenIdeas: () => void; onOpenCode: () => void; onOpenMobile: () => void }) {
  const { t, lang } = React.useContext(LanguageContext);
  const [session, setSession] = useState<JackSessionState | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [siteLabel, setSiteLabel] = useState<string | null>(null);
  const [screenshotPreviews, setScreenshotPreviews] = useState<Array<{ id: string; dataUrl: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [genStatus, setGenStatusState] = useState<JackGenStatus>({ phase: "idle" });
  const [hasAnyKey, setHasAnyKey] = useState<boolean>(true);
  const [tabVideoActive, setTabVideoActive] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadSessionForActiveTab = async () => {
    const tab = await getActiveTab();
    const key = getSessionKeyFromUrl(tab?.url);
    if (!key) {
      setSessionKey(null);
      setSiteLabel(null);
      setSession(emptyJackSession());
      setPrompt("");
      return;
    }
    setSessionKey(key);
    await setLastSessionKey(key);
    try {
      setSiteLabel(new URL(key).hostname);
    } catch {
      setSiteLabel(key);
    }
    const state = await getSessionState(key);
    const next = state ?? emptyJackSession();
    setSession(next);
    setPrompt(next.customPrompt ?? "");
    const previews = await loadScreenshotsWithData(key, next.screenshots);
    setScreenshotPreviews(previews.map((s) => ({ id: s.id, dataUrl: s.dataUrl })));
    if (next.hasVideo) {
      const videoUrl = await getSessionVideoDataUrl(key);
      setVideoPreviewUrl(videoUrl ?? null);
    } else {
      setVideoPreviewUrl(next.videoDataUrl ?? null);
    }
    const videoState = await chrome.storage.session.get("jackTabVideoState");
    const active = videoState.jackTabVideoState?.sessionKey === key;
    setTabVideoActive(Boolean(active));

    const recordingTabId = await getRecordingTabId();
    setRecording(recordingTabId !== null && recordingTabId === tab?.id);
  };

  useEffect(() => {
    loadSessionForActiveTab();
    getProviderKeys().then((keys) => {
      const anyKey = Object.values(keys).some((v) => typeof v === "string" && v.trim().length > 0);
      setHasAnyKey(anyKey);
    });
    getGenStatus().then(setGenStatusState);
    const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === "local" && changes.jackGenStatus) {
        setGenStatusState(changes.jackGenStatus.newValue ?? { phase: "idle" });
      }
      if (area === "local" && changes.jackTabSessions) {
        loadSessionForActiveTab();
        return;
      }
      if (area === "session" && (changes.jackAnnotateContext || changes.jackTabVideoState)) {
        loadSessionForActiveTab();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  // Register message listener for element selection and recorder results
  useEffect(() => {
    const handler = (message: any) => {
      if (message.type === "ELEMENT_SELECTED" || message.type === "RECORDER_RESULTS") {
        loadSessionForActiveTab();
        setRecording(false);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handlePromptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrompt(e.target.value);
    if (sessionKey) {
      updateSessionState({ customPrompt: e.target.value }, sessionKey).catch(() => {});
    }
  };

  // Capture screenshot of the active tab and store it in session
  const handleScreenshot = async () => {
    setMessage(null);
    try {
      const tab = await getActiveTab();
      const key = getSessionKeyFromUrl(tab?.url);
      if (!tab?.id || !tab.windowId || !key) {
        setMessage(t("errOpenSite"));
        return;
      }
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const shot = await addScreenshot(key, imageDataUrl);
      await setLastSessionKey(key);
      await setAnnotateContext({
        sessionKey: key,
        returnTabId: tab.id,
        returnWindowId: tab.windowId,
        screenshotId: shot.id
      });
      await loadSessionForActiveTab();
      chrome.tabs.create({ url: chrome.runtime.getURL("tabs/annotate.html") });
      window.close();
    } catch (err) {
      console.error(err);
      setMessage(err instanceof Error ? err.message : t("errOpenSite"));
    }
  };

  const toggleRecording = async () => {
    setMessage(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !tab.url) {
        setMessage(t("errNoTab"));
        return;
      }
      if (!isInspectableTabUrl(tab.url)) {
        setMessage(t("errNotInspectable"));
        return;
      }
      if (!recording) {
        setRecording(true);
        await setRecordingTabId(tab.id!);
        await sendTabMessage(tab.id, { type: "START_RECORDER" });
        window.close();
      } else {
        await sendTabMessage(tab.id, { type: "STOP_RECORDER" });
        await setRecordingTabId(null);
      }
    } catch (err) {
      console.error(err);
      setRecording(false);
      await setRecordingTabId(null);
      setMessage(t("errRecordFailed"));
    }
  };

  const startTabVideoRecording = async () => {
    setMessage(null);
    try {
      const tab = await getActiveTab();
      const key = getSessionKeyFromUrl(tab?.url);
      if (!tab?.id || !tab.windowId || !key) {
        setMessage(t("errOpenSite"));
        return;
      }
      if (!isInspectableTabUrl(tab.url!)) {
        setMessage(t("errNotInspectable"));
        return;
      }
      const streamId = await new Promise<string>((resolve) => chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, resolve));
      const res = await chrome.runtime.sendMessage({
        type: "START_TAB_VIDEO",
        tabId: tab.id,
        windowId: tab.windowId,
        sessionKey: key,
        streamId
      });
      if (!res?.ok) {
        const detail =
          res?.error === "already_recording"
            ? t("alreadyRecording")
            : res?.error === "not_allowed"
              ? t("errNotInspectable")
              : res?.error === "recorder_tab_not_ready"
                ? t("recorderNotReady")
                : res?.error
                  ? `${t("errStartRecord")}: ${res.error}`
                  : t("errStartRecord");
        setMessage(detail);
        return;
      }
      await setLastSessionKey(key);
      setTabVideoActive(true);
      setMessage(t("recordingStarted"));
      window.close();
    } catch (err) {
      console.error(err);
      setMessage(t("errStartRecord"));
    }
  };

  const handleSelectElement = async () => {
    setMessage(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !tab.url) {
        setMessage(t("errNoTab"));
        return;
      }
      if (!isInspectableTabUrl(tab.url)) {
        setMessage(t("errNotInspectable"));
        return;
      }
      if (sessionKey) await setLastSessionKey(sessionKey);
      await sendTabMessage(tab.id, { type: "START_INSPECT" });
      window.close();
    } catch (err) {
      console.error(err);
      setMessage(t("errInspectorFailed"));
    }
  };

  const handleDeleteScreenshot = async (id: string) => {
    if (!sessionKey) return;
    await deleteSessionScreenshot(sessionKey, id);
    setScreenshotPreviews((prev) => prev.filter((s) => s.id !== id));
    setSession((prev) => (prev ? { ...prev, screenshots: prev.screenshots.filter((s) => s.id !== id) } : prev));
  };

  const handleDeleteVideo = async () => {
    if (!sessionKey) return;
    await deleteSessionVideo(sessionKey);
    setVideoPreviewUrl(null);
    setSession((prev) => (prev ? { ...prev, hasVideo: false, videoDataUrl: undefined, videoMimeType: undefined } : prev));
  };

  const handleClearAll = async () => {
    if (!sessionKey) return;
    await clearSessionState(sessionKey);
    setSession(emptyJackSession());
    setScreenshotPreviews([]);
    setVideoPreviewUrl(null);
    setPrompt("");
    setConfirmClear(false);
    setMessage(t("dataCleared"));
  };

  const handleGenerateIdeas = async () => {
    if (!sessionKey) return;
    await setLastSessionKey(sessionKey);
    chrome.runtime.sendMessage({ type: "JACK_GENERATE_IDEAS", sessionKey }).catch(() => {});
    onOpenIdeas();
  };

  // Determine if we can generate ideas (needs context and at least one key)
  const canGenerate = Boolean(
    hasAnyKey &&
      session &&
      (session.screenshots.length > 0 ||
        session.screenshotDataUrl ||
        session.hasVideo ||
        session.videoDataUrl ||
        videoPreviewUrl ||
        session.htmlContext ||
        (session.recordedActions && session.recordedActions.length > 0))
  );

  return (
    <div
      className="popup-scroll"
      style={{
        width: 440,
        maxHeight: 560,
        overflowY: "auto",
        backgroundColor: "var(--bg)",
        color: "var(--fg)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}
    >
      {/* Compact header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#ffffff", fontSize: 18, lineHeight: 1, fontWeight: 800, letterSpacing: "0.04em" }}>REDSTONE</span>
          <span style={{ color: "#c2c2c2", fontSize: 18, lineHeight: 1, fontWeight: 700, letterSpacing: "0.02em" }}>QA</span>
        </div>
        {siteLabel && (
          <span style={{ fontSize: 10, color: "#c2c2c2", maxWidth: 155, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sessionKey ?? undefined}>
            {siteLabel}
          </span>
        )}
      </div>
      {message && <p style={{ fontSize: 12, color: "#c2c2c2", margin: 0 }}>{message}</p>}
      {/* 2×2 action grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ActionCard
          icon={<CameraIcon className="w-9 h-9" />}
          label={t("screenshot")}
          onClick={handleScreenshot}
        />
        <ActionCard
          icon={<VideoIcon className="w-9 h-9" />}
          label={tabVideoActive ? t("recordingInProgress") : t("recordVideo")}
          onClick={startTabVideoRecording}
          danger={tabVideoActive}
          disabled={tabVideoActive}
        />
        <ActionCard
          icon={<RecordActionsIcon className="w-9 h-9" />}
          label={recording ? t("stopRecording") : t("recordActions")}
          onClick={toggleRecording}
          danger={recording}
        />
        <ActionCard
          icon={<CrosshairIcon className="w-9 h-9" />}
          label={t("selectElement")}
          onClick={handleSelectElement}
        />
      </div>
      <button
        onClick={onOpenMobile}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          width: "100%",
          padding: "8px",
          borderRadius: 8,
          fontSize: 12,
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "#d1d5db",
          cursor: "pointer"
        }}
      >
        <Smartphone size={15} style={{ color: "#f87171" }} />
        Mobile app testing
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: "#c2c2c2" }}>{t("promptLabel")}</label>
        <VoiceInput
          value={prompt}
          onChange={(val) => {
            setPrompt(val);
            if (sessionKey) updateSessionState({ customPrompt: val }, sessionKey).catch(() => {});
          }}
          placeholder={t("promptPlaceholder")}
        />
      </div>
      {/* Video preview */}
      {videoPreviewUrl && (
        <div style={{ position: "relative" }}>
          <video src={videoPreviewUrl} controls className="w-full max-h-28 rounded border border-[var(--border)] bg-black" />
          <button
            onClick={handleDeleteVideo}
            title={t("clearAll")}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(231,0,0,0.85)",
              border: "none",
              borderRadius: 6,
              padding: "3px 5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              color: "#fff"
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}

      {/* Screenshot grid */}
      {screenshotPreviews.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {screenshotPreviews.map((shot) => (
            <div key={shot.id} style={{ position: "relative" }}>
              <img
                src={shot.dataUrl}
                alt=""
                onClick={() => setPreviewUrl(shot.dataUrl)}
                style={{
                  width: "100%",
                  height: 56,
                  objectFit: "cover",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  cursor: "zoom-in",
                  display: "block"
                }}
              />
              <button
                onClick={() => handleDeleteScreenshot(shot.id)}
                title={t("clearAll")}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "rgba(231,0,0,0.85)",
                  border: "none",
                  color: "#fff",
                  fontSize: 9,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Status preview */}
      <div className="text-xs space-y-1" style={{ color: "#c2c2c2" }}>
        {session && session.screenshots.length > 0 && (
          <p className="flex items-center gap-1">
            <CameraIcon className="w-3 h-3" /> {t("screenshotsCount", { n: session.screenshots.length })}
          </p>
        )}
        {session?.htmlContext && (
          <p className="flex items-center gap-1">
            <CrosshairIcon className="w-3 h-3" /> {t("elementSelected")}
          </p>
        )}
        {session?.recordedActions && session.recordedActions.length > 0 && (
          <p className="flex items-center gap-1">
            <RecordActionsIcon className="w-3 h-3" /> {t("actionsCount", { n: session.recordedActions.length })}
          </p>
        )}
        {(session?.hasVideo || session?.videoDataUrl || videoPreviewUrl) && (
          <p className="flex items-center gap-1">
            <VideoIcon className="w-3 h-3" /> {t("videoReady")}
          </p>
        )}
        {tabVideoActive && (
          <p className="flex items-center gap-1" style={{ color: "#e70000" }}>
            <VideoIcon className="w-3 h-3" /> {t("recordingActive")}
          </p>
        )}
        {/* Gen status indicator */}
        {genStatus.phase !== "idle" && genStatus.phase !== "error" && (
          <p className="flex items-center gap-1" style={{ color: "#e70000" }}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span style={{ fontSize: 11 }}>
              {genStatus.phase === "analyzing-media" && "Аналіз медіа..."}
              {genStatus.phase === "generating-ideas" && "Генерація ідей..."}
              {genStatus.phase === "generating-code" && "Генерація коду..."}
            </span>
          </p>
        )}
        {genStatus.phase === "error" && (
          <p className="flex items-center gap-1 flex-wrap" style={{ color: "#e70000", fontSize: 11 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✕ {genStatus.error ?? "Помилка генерації"}</span>
            <button
              onClick={() => chrome.runtime.sendMessage({ type: "JACK_RETRY", sessionKey: genStatus.sessionKey, failedPhase: genStatus.failedPhase }).catch(() => {})}
              style={{ color: "#e70000", background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: 0, flexShrink: 0 }}
            >
              Повторити →
            </button>
          </p>
        )}
        {session && session.testIdeas.length > 0 && (
          <button onClick={onOpenIdeas} className="flex items-center gap-1 transition-colors w-full text-left" style={{ color: "#e70000" }}>
            <LightBulbIcon className="w-3 h-3" /> {t("ideasLink", { n: session.testIdeas.length })}
          </button>
        )}
        {session && session.generatedFiles.length > 0 && (
          <button onClick={onOpenCode} className="flex items-center gap-1 transition-colors w-full text-left" style={{ color: "#e70000" }}>
            <VideoIcon className="w-3 h-3" /> Код ({session.generatedFiles.length} файлов) →
          </button>
        )}
      </div>

      {/* Clear all */}
      {sessionKey &&
        session &&
        (session.screenshots.length > 0 ||
          session.hasVideo ||
          session.videoDataUrl ||
          session.htmlContext ||
          session.recordedActions.length > 0 ||
          session.testIdeas.length > 0 ||
          session.generatedFiles.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
            {confirmClear ? (
              <>
                <span style={{ fontSize: 11, color: "#e70000", flex: 1 }}>{t("clearConfirm")}</span>
                <button
                  onClick={handleClearAll}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 5,
                    fontSize: 11,
                    background: "#e70000",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600
                  }}
                >
                  {t("yes")}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 5,
                    fontSize: 11,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "#c2c2c2",
                    cursor: "pointer"
                  }}
                >
                  {t("no")}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 10px",
                  borderRadius: 5,
                  fontSize: 11,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "#c2c2c2",
                  cursor: "pointer"
                }}
              >
                <Trash2 size={11} />
                {t("clearAll")}
              </button>
            )}
          </div>
        )}

      {/* Generate + Settings */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Button className="w-full" disabled={!canGenerate} onClick={handleGenerateIdeas}>
          <span className="inline-flex items-center gap-2">
            <LightBulbIcon className="w-4 h-4" />
            <span>{t("generateIdeas")}</span>
          </span>
        </Button>
        <button
          onClick={onOpenSettings}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "6px",
            borderRadius: 7,
            fontSize: 12,
            background: "transparent",
            border: "1px solid var(--border)",
            color: "#c2c2c2",
            cursor: "pointer"
          }}
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          {t("settings")}
        </button>
      </div>

      {/* Lightbox */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.92)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out"
          }}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: "50%",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              cursor: "pointer"
            }}
          >
            <X size={16} />
          </button>
          <img
            src={previewUrl}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "95vw",
              maxHeight: "95vh",
              borderRadius: 8,
              objectFit: "contain",
              cursor: "default",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
            }}
          />
        </div>
      )}
    </div>
  );
}

type Screen = "settings" | "code" | "mobile";

const POPUP_SCREEN_KEY = "rdqaPopupScreen";
const popupScreens: Screen[] = ["settings", "code", "mobile"];

function isPopupScreen(value: unknown): value is Screen {
  return typeof value === "string" && popupScreens.includes(value as Screen);
}

function IndexPopup() {
  const [screen, setScreen] = useState<Screen>("mobile");
  const [lang, setLang] = useState<LangCode>("uk");

  const goToScreen = React.useCallback((nextScreen: Screen) => {
    setScreen(nextScreen);
    chrome.storage.session.set({ [POPUP_SCREEN_KEY]: nextScreen }).catch(() => {});
  }, []);

  useEffect(() => {
    getUiLanguage().then(setLang);
    chrome.storage.session.get(POPUP_SCREEN_KEY).then((result) => {
      const storedScreen = result[POPUP_SCREEN_KEY];
      if (isPopupScreen(storedScreen)) setScreen(storedScreen);
    });
  }, []);

  const contextValue = React.useMemo(() => ({ lang, setLang, t: makeT(lang) }), [lang]);

  return (
    <LanguageContext.Provider value={contextValue}>
      {screen === "settings" && <ProviderKeysSettings onBack={() => goToScreen("mobile")} onLangChange={setLang} />}
      {screen === "code" && <CodeScreen onBack={() => goToScreen("mobile")} />}
      {screen === "mobile" && (
        <MobileTestingScreen
          onOpenCode={() => goToScreen("code")}
          onOpenSettings={() => goToScreen("settings")}
        />
      )}
    </LanguageContext.Provider>
  );
}

export default IndexPopup;
