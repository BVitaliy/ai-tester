This is a [Plasmo extension](https://docs.plasmo.com/) project bootstrapped with [`plasmo init`](https://www.npmjs.com/package/plasmo).

## Getting Started

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

You can start editing the popup by modifying `popup.tsx`. It should auto-update as you make changes. To add an options page, simply add a `options.tsx` file to the root of the project, with a react component default exported. Likewise to add a content page, add a `content.ts` file to the root of the project, importing some module and do some logic, then reload the extension on your browser.

For further guidance, [visit our Documentation](https://docs.plasmo.com/)

## Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle for your extension, ready to be zipped and published to the stores.

## Submit to the webstores

The easiest way to deploy your Plasmo extension is to use the built-in [bpp](https://bpp.browser.market) GitHub action. Prior to using this action however, make sure to build your extension and upload the first version to the store to establish the basic credentials. Then, simply follow [this setup instruction](https://docs.plasmo.com/framework/workflows/submit) and you should be on your way for automated submission!
# ai-tester

## Autonomous Mobile QA Engineer ("Explore Application")

On top of the scanner sits an autonomous layer that understands the app like a QA
engineer. Press **Explore Application** (in the App Structure panel) and the agent
will: build an **Application Knowledge Graph** (features → screens → actions →
results), discover **business flows**, assess **risks**, design **runnable tests**
(smoke / happy-path / negative / boundary / risk-based), and write a **senior-QA
report that explains its reasoning** — without a single manually-written test.

If no app map exists yet, **Explore Application** first runs a **goal-driven scan**
(actions ranked by inferred user goals; duplicate cards/lists detected via semantic
memory and sampled rather than exhausted), then analyses the result.

### Intelligence modules (added, ESM, no new dependencies)

| File | Phase | Role |
|---|---|---|
| `application-knowledge-graph.mjs` | 1 | Feature→Screen→Action→Result model + business flows + entities |
| `feature-discovery-engine.mjs` | 2 | Detects features (auth, checkout, payments, …) with confidence + evidence |
| `goal-driven-explorer.mjs` | 3 | Ranks actions by inferred user goals (crawler `selectActions` hook) |
| `semantic-action-memory.mjs` | 4 | Action *intent* + duplicate screen/card detection |
| `auth-explorer.mjs` | 5 | Auth state/capability detection; plans login from configured test creds |
| `form-intelligence.mjs` | 6 | Field/validation detection; valid/invalid/boundary input generation |
| `risk-engine.mjs` | 7 | Risk register (severity/likelihood/impact → High/Medium/Low) |
| `self-healing-engine.mjs` | 8 | Intent-based locators that survive label changes (Login→Sign In) |
| `autonomous-test-design.mjs` | 9 | Tests from business flows (smoke/happy/negative/boundary/risk) |
| `visual-intelligence.mjs` | 10 | Layout heuristics (blank/overlap/hidden/loading) + optional vision hook |
| `autonomous-report.mjs` | 11 | Senior-QA Markdown report with reasoning, coverage & confidence |
| `explore-orchestrator.mjs` | — | Runs the whole pipeline from a saved app map (offline) |

Goal-driven exploration is opt-in (`options.goalDriven` on a scan) so the plain
**Scan App Structure** behaviour is unchanged.

### Configured test credentials (for auth flows)

The auth explorer never invents or brute-forces credentials. Supply test creds via
`QA_TEST_EMAIL` / `QA_TEST_PASSWORD` env vars (or per-call options) to let it plan
a login. Without them it reports auth structure but does not attempt to sign in.

### Explore endpoint

| Method & path | Body | Returns |
|---|---|---|
| `POST /app/explore` | `{ appId }` (loads latest map) or `{ appMap }` | knowledge graph, features, business flows, risks, designed tests, coverage, confidence, and the full Markdown report |

## AI Mobile QA Agent (app structure scanning)

The local QA agent (`qa-agent/server.mjs`) can automatically explore a mobile
app, build a map of its screens and transitions, understand each screen, and
generate runnable test flows.

### Required tools

- **adb** (Android Platform Tools) — Android devices/emulators. Auto-detected at
  `~/Library/Android/sdk` or via `ANDROID_HOME`.
- **xcrun / simctl** (Xcode) — iOS simulators.
- **Appium** with the **XCUITest** driver — iOS UI dump, tap, scroll, back.
  The agent starts Appium automatically if it isn't already running.

### Start the agent

```bash
pnpm agent          # node qa-agent/server.mjs  (listens on 127.0.0.1:17321)
```

### Environment variables

| Variable | Purpose |
|---|---|
| `QA_AGENT_HOST` / `QA_AGENT_PORT` | Agent bind address (default `127.0.0.1:17321`) |
| `APPIUM_HOST` / `APPIUM_PORT` | Appium server (default `127.0.0.1:4723`) |
| `ANDROID_HOME` | Android SDK path |
| `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`) | Enables server-side AI screen analysis via Gemini |
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `OPENAI_MODEL`) | Enables AI screen analysis via an OpenAI-compatible API |

If no AI key is set, screen analysis falls back to a deterministic heuristic, so
the feature works fully offline.

### How to scan an app

From the extension's **Mobile Testing** screen, pick a device and an app, then use
the **App Structure (AI Map)** panel:

1. **Scan App Structure** — launches the app and crawls reachable screens
   (skipping destructive actions like delete / logout / payment). The scan runs
   as a background job in the agent, with **live progress** (current screen,
   counts, recent actions) shown in the panel.
   - **Stop Scan** cancels cooperatively and keeps everything discovered so far.
   - **Resume Scan** continues from where a stopped scan left off (exploration
     progress is persisted per screen in the app map).
   - Closing/reopening the popup does **not** lose progress — the panel
     re-attaches to the running job and keeps polling.
2. **View App Map** — lists every discovered screen with a screenshot thumbnail,
   visible texts, clickable elements, and transitions.
3. **Generate Tests From App Map** — produces smoke, navigation, form-validation,
   auth, and deep-link-placeholder flows.
4. **Run Critical Flows** — executes the high-priority generated flows on the
   device and shows pass/fail per flow.
5. **Download App Map Report** — a self-contained HTML report (app structure,
   screenshots per screen, purposes, transitions, generated flows, and any
   failed steps with screenshots).

### HTTP API (added)

| Method & path | Body / query | Returns |
|---|---|---|
| `POST /app/scan` | `{ deviceId, appId, platform?, options?, resume? }` | starts a background scan job; returns its snapshot |
| `GET /app/scan/status` | `?deviceId&appId` | live job snapshot (status, counts, current step, recent events) |
| `POST /app/scan/stop` | `{ deviceId, appId }` | cooperatively stops a running scan (keeps partial map) |
| `GET /app/map` | `?appId&platform&deviceId` (or latest) | latest saved app map + summary |
| `GET /app/screenshot` | `?fingerprint=<hex>` | PNG of a discovered screen |
| `POST /app/analyze-screen` | `{ deviceId }` | screen name, purpose, risks, suggested tests |
| `POST /tests/from-map` | `{ appMap }` or `{ appId }` (loads latest) | generated executable test flows |

`options` for `/app/scan`: `{ maxDepth=3, maxScreens=30, maxActionsPerScreen=8,
waitAfterActionMs=1200, avoidDangerousActions=true }`.

App maps are saved as JSON in `qa-agent/output/app-maps/`, screenshots in
`qa-agent/output/app-maps/screenshots/`, and UI trees in
`qa-agent/output/app-maps/uitrees/`.

### Implementation modules (added, ESM, no new dependencies)

| File | Role |
|---|---|
| `qa-agent/screen-fingerprint.mjs` | Stable screen signatures from a UI tree |
| `qa-agent/app-map-store.mjs` | App-map data model + JSON persistence |
| `qa-agent/safe-actions.mjs` | Filters destructive actions, prioritises navigation |
| `qa-agent/screen-crawler.mjs` | Explores the app (device helpers injected by the server) |
| `qa-agent/ai-screen-analyzer.mjs` | AI (Gemini/OpenAI) or heuristic screen analysis |
| `qa-agent/test-generator.mjs` | Builds runnable flows from an app map |

Existing endpoints and behaviour are unchanged; the crawler reuses the server's
existing adb/Appium helpers via dependency injection rather than duplicating them.
