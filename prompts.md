```
---

## Короткі промпти по кроках

Після того як вставив головний промпт — використовуй ці для продовження:

### Крок 1 — Типи та API
```

Start with step 1: create src/core/types.ts, src/core/config.ts, and src/core/api.ts with full mock data. MOCK_MODE=true. Include all types and all API functions listed above.

```

### Крок 2 — Storage та Auth
```

Step 2: create src/store/session.ts with @plasmohq/storage typed wrappers, and src/hooks/useAuth.ts hook.

```

### Крок 3 — Popup
```

Step 3: build popup.tsx — login form + logged-in state with 3 action buttons and session badge. Use mock auth.

```

### Крок 4 — Side Panel shell
```

Step 4: build sidepanel.tsx — screen router, breadcrumb bar, step dots. No screen content yet, just navigation shell.

```

### Крок 5 — Вибір проєкту та категорії
```

Step 5: build ProjectSelector.tsx (search + create inline) and CategorySelector.tsx (two-phase drill-down). Wire into sidepanel router.

```

### Крок 6 — Скріншот (видима область)
```

Step 6: build useScreenshot.ts hook with visible capture only (chrome.tabs.captureVisibleTab). Wire the popup Screenshot button → background → side panel opens on annotation-editor screen with the image.

```

### Крок 7 — Анотації (Fabric.js)
```

Step 7: build AnnotationEditor.tsx with Fabric.js. Tools: Arrow (with arrowhead), Text, Rectangle, Line, Freehand. Color swatches, stroke slider, undo history, zoom+pan. Export PNG on Next.

```

### Крок 8 — Голос та Whisper
```

Step 8: build VoiceRecorder.tsx with MediaRecorder, waveform visualizer (AnalyserNode + canvas bars), Whisper transcription, and "Improve with AI" Claude API call.

```

### Крок 9 — Rich Text Editor
```

Step 9: build RichTextEditor.tsx with Quill Snow theme, correct toolbar, debounced sync to currentEntry.contentHtml.

```

### Крок 10 — Превью та сабміт
```

Step 10: build PreviewSubmit.tsx — screenshot thumbnail + HTML preview, "Submit now" and "Add to batch" modes, badge update, post-submit modal.

```

### Крок 11 — Scroll capture
```

Step 11: implement scroll capture in contents/scroll-capture.ts and background.ts. 3-second countdown, step-by-step capture, OffscreenCanvas stitching, progress indicator.

```

### Крок 12 — Polish
```

Step 12: add auto-save draft (30s interval + resume banner), error boundaries on all screens, keyboard shortcuts (Ctrl+Shift+S, Ctrl+Z, Escape), batch submit from popup.

```

---

## Якщо Claude "загубився"

```

Focus only on [назва файлу]. Ignore everything else for now.

```

```

The previous code has a bug: [опис]. Fix only this, don't change other files.

```

```

Show me the current state of [filename] before continuing.

```

```
