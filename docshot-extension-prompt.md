# DocShot Extension — Claude Code Prompt

## Налаштування Claude Code

```bash
npm install -g @anthropic-ai/claude-code
mkdir docshot-extension && cd docshot-extension
claude  # використовуй claude-sonnet-4-5 (дефолт)
```

> **Порада:** давай промпти по одному кроку. Після кожного — тестуй в Chrome перед тим як іти далі.

---

## Головний промпт (вставляй першим)

````
You are building a Chrome Extension (Manifest V3) for automating web documentation creation, used by a small web dev team to document client admin panels (WordPress and custom CMSes).

## Project bootstrap
The project is already initialized with Plasmo + TypeScript + React. Assume this was run:
```bash
pnpm create plasmo docshot-extension --with-src --entry=popup,sidepanel
cd docshot-extension
pnpm add @plasmohq/storage @plasmohq/messaging
pnpm add fabric quill react-quill
pnpm add @types/fabric @types/chrome
pnpm i -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init
````

Use pnpm as package manager.

## Core architecture decisions

- UI: Popup (quick actions) + Side Panel (main workspace)
- State: @plasmohq/storage with useStorage hook + React useState for ephemeral state
- Messaging: @plasmohq/messaging for popup ↔ background ↔ content
- Styling: Tailwind CSS. No component library.
- Mock mode: PLASMO_PUBLIC_MOCK_MODE=true in .env.development

## File structure

```
src/
├── popup.tsx
├── sidepanel.tsx
├── background.ts
├── contents/scroll-capture.ts
├── components/
│   ├── auth/LoginForm.tsx
│   ├── project/ProjectSelector.tsx
│   ├── project/CategorySelector.tsx
│   ├── annotation/AnnotationEditor.tsx
│   ├── voice/VoiceRecorder.tsx
│   ├── editor/RichTextEditor.tsx
│   ├── preview/PreviewSubmit.tsx
│   └── ui/ (Button, SearchInput, Spinner, Toast)
├── core/ (api.ts, config.ts, types.ts, utils.ts)
├── hooks/ (useAuth, useProject, useScreenshot, useVoice)
└── store/session.ts
```

## Types (define in types.ts first)

```typescript
interface User {
  id: string
  email: string
  name: string
}
interface AuthState {
  token: string | null
  user: User | null
}
interface Project {
  id: string
  name: string
  createdAt: string
}
interface Category {
  id: string
  projectId: string
  name: string
}
interface Subcategory {
  id: string
  categoryId: string
  name: string
}
interface SessionContext {
  project: Project | null
  category: Category | null
  subcategory: Subcategory | null
}
interface Entry {
  id?: string
  projectId: string
  categoryId: string
  subcategoryId: string
  screenshotDataUrl: string
  contentHtml: string
  createdAt: string
}
interface BatchEntry extends Entry {
  localId: string
}
type SidePanelScreen =
  | "project-selector"
  | "category-selector"
  | "annotation-editor"
  | "voice-text"
  | "preview-submit"
```

## Storage schema (store/session.ts)

```typescript
// chrome.storage.local (persisted)
auth: AuthState
lastSession: SessionContext

// chrome.storage.session (cleared on browser close)
currentEntry: Partial<Entry>
pendingBatch: BatchEntry[]
```

## popup.tsx

320px wide. Two states:

Logged out: LoginForm. Email + password. On submit → POST /auth/login → store token. Inline error on failure.

Logged in:

- Header: user email + logout button
- Session badge: "Project › Category › Subcategory" or "⚠ Select project" (amber). Click → opens side panel.
- Three action buttons:
  - 📸 Screenshot (dropdown: "Visible area" / "Full page scroll") → background captures → side panel on annotation-editor
  - 🎙 Record voice → side panel on voice-text (starts recording immediately)
  - ✏️ New entry → side panel on annotation-editor (blank)
- If pendingBatch.length > 0: amber banner "Batch: N entries" + "Submit all" button

## sidepanel.tsx

Persistent top breadcrumb: Project › Category › Subcategory (each clickable).
Step dots (1–5) showing current screen.
Screen transitions:
ProjectSelector → CategorySelector → AnnotationEditor → VoiceText → PreviewSubmit

## ProjectSelector.tsx

- Search input (300ms debounce) → GET /projects?search=
- Results list + "＋ Create project" inline form
- Loading skeleton (3 rows)
- Auto-advance on select

## CategorySelector.tsx

Two-phase drill-down:

- Phase 1: categories list + "＋ Add category" inline
- Phase 2: subcategories + "＋ Add subcategory" + "← Back"
- Auto-advance after subcategory select

## useScreenshot.ts hook

Visible mode: chrome.tabs.captureVisibleTab()

Scroll mode:

1. 3-second countdown toast
2. content script scrolls page in steps (window.innerHeight \* 0.9)
3. background captures each viewport
4. stitch with OffscreenCanvas (max 15000px height)
5. progress indicator "Capturing... 3/8 sections"

## AnnotationEditor.tsx

Layout: canvas (flex-1) + tools panel (220px).

Fabric.js canvas with screenshot as background.
Tools: Arrow / Text / Rectangle / Line / Freehand
Color swatches: #EF4444 #F97316 #EAB308 #22C55E #3B82F6 #8B5CF6 + custom
Stroke width slider (1–8px)
Undo (canvas state history as JSON array) + Clear (confirm dialog)
Zoom: mouse wheel. Pan: Space + drag.

Arrow tool: mousedown = start, mouseup = Fabric line + filled triangle arrowhead rotated to match angle.

Buttons: "← Recapture" | "Next →" (exports PNG dataUrl → currentEntry.screenshotDataUrl)

## VoiceRecorder.tsx

- MediaRecorder (audio/webm)
- Waveform: AnalyserNode → getByteFrequencyData → 20 bars on canvas, 60fps rAF
- On stop → POST /transcribe (Whisper whisper-1, language: uk)
- Show raw transcript in read-only textarea
- "✨ Improve with AI" → Claude API with:
  System: "You are a technical writer. Rewrite the voice transcript into clear professional Ukrainian documentation. Return only valid HTML using <p><ul><li><strong>. No markdown."
  User: screenshot (base64) + transcript
- "Skip →" → puts transcript as plain <p> in editor

## RichTextEditor.tsx

- Quill Snow theme
- Toolbar: bold | italic | bullet list | ordered list | link | clean
- Syncs to currentEntry.contentHtml (debounced 500ms)

## PreviewSubmit.tsx

Two-column:

- Left 40%: screenshot thumbnail → click = full-screen modal with pan/zoom
- Right 60%: rendered HTML (dangerouslySetInnerHTML)

Segmented control: "Submit now" | "Add to batch"

Submit now: POST /entries → toast "✓ Saved!" → modal "Add another?" → Yes: AnnotationEditor / No: session summary

Add to batch: push to pendingBatch storage → toast "Added (N total)" → AnnotationEditor. Badge: chrome.action.setBadgeText.

"← Edit" = back to VoiceText. "✎ Change category" = back to CategorySelector (keep screenshot + text).

## api.ts

```typescript
const MOCK_MODE = process.env.PLASMO_PUBLIC_MOCK_MODE === "true"
const mockDelay = () => new Promise((r) => setTimeout(r, 300))

const MOCK_DATA = {
  projects: [
    {
      id: "1",
      name: "Інтернет-магазин Rozetka clone",
      createdAt: "2024-01-10"
    },
    { id: "2", name: "Корпоративний сайт ТОВ Альфа", createdAt: "2024-02-15" },
    { id: "3", name: "Блог Михайла Коваленка", createdAt: "2024-03-01" }
  ]
  // categories and subcategories per project id
}

// Export: login, getProjects, createProject, getCategories, createCategory,
// getSubcategories, createSubcategory, transcribeAudio, improveWithAI,
// submitEntry, submitBatch
```

## background.ts

Messages: CAPTURE_VISIBLE | CAPTURE_SCROLL_FRAME | OPEN_SIDEPANEL | UPDATE_BADGE
Command: Ctrl+Shift+S / Cmd+Shift+S → visible screenshot → open side panel

## contents/scroll-capture.ts

On START_SCROLL_CAPTURE:

1. Save scroll position, scroll to top
2. Calculate steps, send CAPTURE_SCROLL_FRAME per step
3. Wait 150ms between steps for paint
4. Send all dataUrls for stitching in background (OffscreenCanvas)
5. Restore scroll position

## UX requirements

- Auto-save draft every 30s → session storage. On panel open → "Resume draft?" banner.
- All async = spinner with descriptive text ("Transcribing...", "Stitching...", "Generating...")
- Error boundaries on each screen with "Retry" button
- Keyboard: Ctrl+Z undo in annotation, Escape cancel tool

## Visual style

Primary: #2563EB | Background: #F8FAFC | Font: system-ui
CSS variables for theming. Popup max-height: 500px.

## Manifest permissions

activeTab, tabs, scripting, storage, sidePanel, offscreen

## Build & dev

```bash
pnpm dev    # hot reload
pnpm build  # → build/ folder → load in chrome://extensions
```

## Implementation order — stop after each step and ask to test:

1. types.ts + config.ts + api.ts (mock mode)
2. store/session.ts + useAuth.ts
3. popup.tsx (login + logged-in state)
4. sidepanel.tsx shell + screen router + breadcrumb
5. ProjectSelector.tsx + CategorySelector.tsx
6. useScreenshot.ts + visible capture
7. AnnotationEditor.tsx (Fabric.js)
8. VoiceRecorder.tsx + Whisper
9. RichTextEditor.tsx (Quill)
10. PreviewSubmit.tsx + both submit modes
11. Scroll capture (content script + stitch)
12. Batch badge + auto-save + keyboard shortcuts
