# Docshot Extension

Chrome Extension (Manifest V3 + Plasmo + TypeScript + React + Tailwind CSS 3).
Captures annotated screenshots + audio narration → AI-generated rich text → saved to WordPress ACF fields.

## Stack & conventions

- **Package manager:** pnpm · **Build:** `pnpm dev` / `pnpm build`
- **Mock mode:** `PLASMO_PUBLIC_MOCK_MODE=true` in `.env.development`
- **Styling:** Tailwind CSS 3 only. No component library.
- **Class merging:** use `cn()` from `src/lib/cn.ts` (wraps `tailwind-merge`) whenever combining Tailwind classes — in components, never concatenate class strings with template literals or `+`. This ensures `className` overrides passed to shared components work correctly without `!important`.
- **Icons:** `lucide-react` only — never inline SVGs.
- **No comments** unless the WHY is non-obvious. No docstrings.

## Code organisation rules

- **One component per file.** Never define multiple exported or unexported components in the same file.
- **No inline subcomponents.** If you need a helper component inside a parent, extract it to its own file first.
- **Use `EditorContext`** (`src/contexts/EditorContext.tsx`) inside the editor tree instead of drilling `token`, `postId`, `isDirty`, `currentDestination`, `onSelectDestination`, `onClearDestination` through props.
- **Use shared UI primitives** — `<ErrorText message={err} />` instead of inline `{err && <p className="text-xs text-red-500">…</p>}`, and `<ScreenFooter>` for the standard modal action footer.
- **Use shared hooks** — `useVerticalDnd()` for dnd-kit sensor setup, `useDebouncedCallback()` for debounced search inputs.
- **Imports from `core/api`** — import from `"../../core/api"` (barrel `src/core/api/index.ts`) or from a specific sub-module (`"../../core/api/gemini"`).

## Architecture

### Entry points (Plasmo — filenames are fixed)

| File | Role |
|---|---|
| `src/popup.tsx` | Thin shell — renders `<LoginForm>` or `<LoggedInView>` |
| `src/tabs/editor.tsx` | 6-screen router; listens for `NAVIGATE` messages; reads `editorInitScreen` on mount |
| `src/background.ts` | Orchestration: window lifecycle, crop (OffscreenCanvas), AI submission, message routing |
| `src/contents/page-tools.ts` | Page tools: inspector + action recorder; bundled only, injected via `chrome.scripting.executeScript` on button click (no auto-run on tabs) |

### Core

`src/core/` — types, config, drawAnnotation, speech-recognition types, api barrel + sub-modules (auth, posts, media, gemini).

### State & hooks

| Path | Role |
|---|---|
| `src/store/session.ts` | `chrome.storage` abstraction |
| `src/contexts/EditorContext.tsx` | Scoped context for the editor tree: `token`, `postId`, `isDirty`, `currentDestination`, callbacks |
| `src/hooks/` | useAuth, useCaptureFlow, useVerticalDnd, useDebounce |

### Components

| Path | Role |
|---|---|
| `src/components/ui/` | Shared primitives: Button, Input, Spinner, Toast, ErrorText, ScreenFooter |
| `src/components/popup/` | Popup shell: login form, destination badge, Gemini key settings, logged-in view |
| `src/components/project/` | Post selector screen |
| `src/components/editor/` | Tab editor: accordion, section/subsection rows, forms, destination button, breadcrumb |
| `src/components/annotator/` | Canvas annotation screen (arrow, text, line, rect; 5 colors; undo) |
| `src/components/audio/` | Audio recorder screen (Web Speech API transcription) |
| `src/components/video/` | Video recorder screen (MediaRecorder) |
| `src/components/review/` | AI processing spinner + content review/edit screen |

## User flow (screens in order)

```
post-selector → tab-editor → [overlay crop] → annotator → audio-recorder → ai-processing → content-review → tab-editor
```

- Destination badge in popup opens `tab-editor` when a destination is already set, `post-selector` otherwise.
- After save, editor returns to `tab-editor`; the selected section's parent is auto-expanded and scrolled into view.

## Message types

| Message | Direction | Action |
|---|---|---|
| `OPEN_EDITOR_WINDOW` | popup → background | Create or focus editor; set `editorInitScreen` in session |
| `START_CAPTURE_FLOW` | popup → background | Store `captureFlow`; inject + activate overlay |
| `ACTIVATE_OVERLAY` | background → content | Show drag-select overlay |
| `CROP_SELECTED` | content → background | Capture + crop tab; focus editor; navigate to annotator |
| `ANNOTATION_DONE` | editor → background | Store annotated image; navigate to audio-recorder |
| `AUDIO_DONE` | editor → background | Store audio; navigate to ai-processing; call AI |
| `NAVIGATE` | background → editor | Set screen in editor router |
| `CLOSE_EDITOR_WINDOW` | editor → background | Close the editor window |
| `UPDATE_BADGE` | any → background | Set popup badge text + amber color |

## WP REST API

Auth: `Authorization: Basic {btoa(email:appPassword)}`  
Screenshots embed as `<img class="aligncenter size-full">` in `content_main` or `subcontent`.

## CLAUDE.md maintenance

After any change that affects architecture, entry points, message contracts, code organisation rules, or known constraints — update the relevant section of this file. Do not add per-file or per-component detail; keep descriptions at folder/module level.

## USAGE.md maintenance

After **any change** that affects what a user sees or does — user flow, screen behaviour, UI labels, new/removed features, destination selection, annotation tools, audio/video recording, AI processing, save flow — you **must** update `USAGE.md` to reflect the new behaviour before marking the task done.

- Keep instructions in Ukrainian (the existing language of the document).
- Update only the sections affected by the change; don't rewrite unrelated sections.
- If a whole new feature is added, add a new numbered section and update the table of contents.
- If a feature is removed, remove its section and all references to it.

## Known constraints

- `editorInitScreen` in `chrome.storage.session` is the fallback for the initial screen when the editor window is newly created or the tab remounts after an extension reload — written by background before sending `NAVIGATE`, read and cleared by `editor.tsx` on mount.
- `chrome.runtime.sendMessage` for `NAVIGATE` is fire-and-forget (`.catch(() => {})`). The `editorInitScreen` fallback and the 30 s timeout in `AiProcessingScreen` exist precisely because the message can be silently dropped if the listener isn't registered yet.
- User edits **only** `acf.content[]`. Posts are pre-created in WP admin and are read-only.
- Microphone access: browser prompt via `getUserMedia()` — no manifest entry needed.
