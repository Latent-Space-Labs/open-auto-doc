# Page-flow skill design

**Date:** 2026-05-07
**Status:** Approved (pending written-spec review)
**Scope:** New sibling Claude Code skill `open-auto-doc-pages` that drives Chrome via the `claude-in-chrome` MCP to crawl the user's running web app, capture screenshots of every reachable page, and embed them as a `pages.mdx` doc — Mermaid navigation graph plus screenshot gallery — in the open-auto-doc-generated Fumadocs site.

---

## 1. Problem

Open-auto-doc today produces static, AI-derived documentation: architecture, API endpoints, components, data models, etc. There's no visual representation of the running app — what pages exist, what the UI looks like, and how a user clicks from one page to another. For projects with a UI, this is a meaningful documentation gap.

## 2. Goal

A user runs `/open-auto-doc` (or `/open-auto-doc-pages` directly), opts into a page crawl, logs into their app once in a Chrome tab the skill opens, and receives a `pages.mdx` containing a Mermaid map of all crawled pages, plus a gallery card for each page (screenshot, route, title, list of buttons that navigate elsewhere). All artifacts are written into the existing Fumadocs site at `<outputDir>/public/page-flow/` and `<outputDir>/content/docs/pages.mdx`.

## 3. Non-goals (v1)

- Crawling native desktop apps (Chrome MCP only; computer-use is not used).
- Crawling apps with no auth-free interactive surface unless the user logs in first or opts into `publicOnly`.
- Adding this feature to the BYOK analyzer CLI. Chrome MCP only exists in Claude Code; the BYOK path stays static-analysis-only.
- Auto-creating accounts on the user's app, or accepting passwords pasted into chat.
- Filling forms with synthetic data.
- Per-page MDX files. v1 produces a single `pages.mdx`; per-page detail pages are a follow-up.

## 4. User flow

### 4.1 Triggered from main `open-auto-doc` skill

Existing [SKILL.md](../../../.claude-plugin/skills/open-auto-doc/SKILL.md) gains one new step between current Step 7 (Generate MDX) and Step 8 (End-of-run menu):

> **Step 7.5 — Optional page crawl.** In interactive mode, ask: *"Also crawl the running app and capture screenshots of every page? (y/n)"*. If yes, invoke the `open-auto-doc-pages` skill via the Skill tool. Skipped entirely in unattended mode.

### 4.2 Direct invocation

`/open-auto-doc-pages` runs the sibling skill standalone. Useful when the user just wants to refresh screenshots without re-running the AI analysis.

### 4.3 Inside `open-auto-doc-pages`

1. Read `.autodocrc.json`. Locate `pageFlow` block; if absent, run first-run prompts (§7).
2. Detect & start dev server in the background. Poll until ready or fail with captured stderr.
3. Open a Chrome MCP tab. Navigate to `baseUrl + loginUrl` (or just `baseUrl` if `publicOnly: true`).
4. Pause and tell the user: *"Please log in in the open Chrome tab, then say 'ready'. Or say 'public-only' to crawl without logging in."*
5. On user confirmation, dispatch the `page-crawler` subagent.
6. On subagent return, merge the page-flow manifest into the `AnalysisResult` cache JSON.
7. Kill the dev server (try/finally, runs even on errors and aborts).
8. Run `npx @latent-space-labs/open-auto-doc generate-from-json` to re-render MDX (which now includes `pages.mdx`).
9. Print summary: pages visited, pages skipped, destructive blocks, warnings.

## 5. Architecture

### 5.1 Why split main session vs subagent

Login can't happen inside a subagent — subagents complete autonomously and don't have a clean human-input pause. The crawl itself is heavy on tool calls and screenshots, which would bloat the main session's context window if done inline. So:

- **Main session** owns: config I/O, dev-server lifecycle, the Chrome tab open + login pause, dispatching the crawler subagent, post-processing the manifest, generating MDX.
- **Subagent** owns: the BFS crawl, screenshot capture, manifest assembly, returning structured JSON.

Chrome MCP tabs are session-scoped to the user's Chrome extension (not per-agent), so the authenticated tab the main session opened is visible to the subagent when it calls `tabs_context_mcp`. Screenshots written via `save_to_disk: true` persist on disk beyond subagent context.

### 5.2 File layout

```
.claude-plugin/skills/open-auto-doc-pages/
  SKILL.md                       # orchestrator (main session)
  agents/
    page-crawler.md              # subagent prompt
  schemas/
    page-flow.schema.json        # contract subagent returns
```

Modifies:
- `.claude-plugin/skills/open-auto-doc/SKILL.md` — adds Step 7.5
- `packages/analyzer/src/types.ts` — adds `PageFlow`, `PageRecord`, `PageEdge` types; `AnalysisResult.pageFlow?: PageFlow | null`
- `packages/generator/src/content-writer.ts` — adds `writePagesPage(result, outputDir)` call (silently skipped when `result.pageFlow` absent)
- `packages/generator/src/meta-writer.ts` — inserts `pages` into the Fumadocs sidebar order
- `packages/generator/src/templates/mdx/pages.hbs` — new Handlebars template (auto-copied to `dist/templates/mdx/` by tsup `onSuccess` hook, same as existing templates)

Adds:
- `<outputDir>/public/page-flow/<slug>.png` — screenshot artifacts (referenced from MDX as `/page-flow/<slug>.png`)

## 6. Crawler internals

### 6.1 BFS state

```
visited: Set<string>     // canonicalized URL keys (pathname[+hash], query dropped if dropQueryParams)
queue:   Array<{ url, depth, sourceSlug?, sourceLabel? }>
pages:   Map<slug, PageRecord>
edges:   Array<PageEdge>
warnings: string[]
```

### 6.2 Per-page loop

1. Pop. Skip if `visited.has(canonical) || depth > maxDepth || pages.size >= maxPages`.
2. `navigate(url, tabId)`. Wrap in a `perPageTimeoutMs` timeout (default 10s).
3. **Login-redirect detection** — if post-navigate URL matches `loginUrl`, the session expired. Stop the crawl and surface the error to the main session.
4. Dismiss modals: detect `[role="dialog"]`, press Esc once. Record `hadModal: true` if found. (Modals that don't respond to Esc — e.g. confirmation dialogs requiring an explicit Cancel click — are a documented v1 limitation; the screenshot will include the modal overlay.)
5. Take screenshot via `mcp__Claude_in_Chrome__computer({ action: "screenshot", save_to_disk: true })`. Move/rename returned tmp path to `<outputDir>/public/page-flow/<slug>.png`.
6. Extract metadata in **one** `javascript_tool` call (avoids N round-trips):
   ```js
   ({
     title: document.title,
     url: location.href,
     anchors: [...document.querySelectorAll('a[href]')].map(a => ({
       href: a.href,
       text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80)
     })),
     buttons: [...document.querySelectorAll('button, [role="button"]')].map(b => ({
       text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 80),
       type: b.type || ''
     }))
   })
   ```
7. **Filter clickables** in subagent code (no extra tool calls):
   - Anchors: keep if same-origin AND href not matching any `excludeUrls` glob AND text doesn't match destructive regex AND text non-empty.
   - Buttons: keep if `type !== 'submit'` AND `closest('form') === null` (treat any button inside a `<form>` as a submit button regardless of explicit `type`, since HTML defaults `<button>` to `type="submit"` inside a form) AND text doesn't match destructive regex AND text non-empty.
   - Allow override: text matching `allowDestructive` bypasses the destructive-pattern filter.
8. **Anchors** → enqueue target, record edge. (No click needed — `href` tells us where it goes.)
9. **Buttons** → click each, poll `location.href` for change (4× 500ms). If URL changed, enqueue target + record edge + navigate back. If unchanged, the button was non-navigational; drop it.

### 6.3 Slug derivation

URL pathname → kebab-case:
- `/` → `home`
- `/users/profile` → `users-profile`
- `/posts/[id]/edit` → `posts-id-edit`
- Collisions get `-2`, `-3`, … suffixes (deterministic by visit order).

### 6.4 Subagent output (returned as a fenced ```json block, matching existing Wave 2 pattern)

```jsonc
{
  "pages": [
    {
      "slug": "home",
      "url": "/",
      "title": "Welcome",
      "screenshot": "page-flow/home.png",
      "hadModal": false,
      "clickTargets": [{ "label": "Get started", "to": "signup" }]
    }
  ],
  "edges": [{ "from": "home", "to": "signup", "label": "Get started" }],
  "mermaid": "graph LR\n  home --> |Get started| signup",
  "stats": {
    "pagesVisited": 12,
    "pagesSkipped": 3,
    "destructiveBlocked": 5,
    "errors": []
  },
  "warnings": []
}
```

### 6.5 Limits & safety defaults

| Setting | Default | Notes |
|---|---|---|
| `maxPages` | 30 | Hard cap on visited-page count |
| `maxDepth` | 5 | Click-depth from start URL |
| `perPageTimeoutMs` | 10000 | Per-navigation watchdog |
| `totalTimeoutMs` | 600000 | 10-minute crawl ceiling |
| `dropQueryParams` | `true` | Canonicalize by pathname only |
| `excludeUrls` | `[]` | User-supplied glob list (e.g. `/admin/*`) |
| `destructivePatterns` | (see §7) | Default text-regex list |
| `allowDestructive` | `[]` | Text-match allowlist (overrides patterns) |

Default destructive regex list (case-insensitive):
```
^delete   ^remove   ^cancel   sign ?out   log ?out
^pay      ^purchase subscribe unsubscribe
deactivate destroy   ^reset
```

## 7. Config: `.autodocrc.json` extension

```jsonc
{
  // ... existing fields preserved ...
  "pageFlow": {
    "enabled": true,
    "devCommand": "npm run dev",
    "baseUrl": "http://localhost:3000",
    "loginUrl": "/login",
    "publicOnly": false,
    "maxPages": 30,
    "maxDepth": 5,
    "perPageTimeoutMs": 10000,
    "totalTimeoutMs": 600000,
    "dropQueryParams": true,
    "excludeUrls": [],
    "destructivePatterns": [
      "^delete", "^remove", "^cancel", "sign ?out", "log ?out",
      "^pay", "^purchase", "subscribe", "unsubscribe",
      "deactivate", "destroy", "^reset"
    ],
    "allowDestructive": []
  }
}
```

### 7.1 First-run prompts

On initial invocation of `open-auto-doc-pages` (no `pageFlow` block in config):

1. **Dev command.** Read `package.json` `scripts.dev`. If missing or repo is a monorepo with multiple packages exposing `dev`, prompt the user for the exact command (and which package directory to run it in). Persist to `devCommand`.
2. **Base URL.** Start the dev server in background. Parse captured stdout for `http(s)://...:NNNN` URLs. If exactly one match, use it. If multiple (e.g. Vite prints local + network), present them as a numbered list and ask the user to pick one. Persist the chosen URL to `baseUrl`.
3. **Login URL.** Ask `"What's the login path? (default '/login', or 'none' for a public-only crawl)"`. Persist to `loginUrl` or set `publicOnly: true`.

### 7.2 Subsequent runs

Read the block as-is, no prompts. Fail loud (don't silently fallback) if a required field is missing or malformed.

### 7.3 Dev-server failure UX

- **No response after 60s** → SIGTERM the process, show last 30 lines of captured stdout+stderr, prompt: *"Try a different command? (type the new command, or 'cancel')"*.
- **Port collision** → most dev servers self-relocate; we use the URL from parsed stdout, not the configured one (and update the config if it changed).
- **Missing env vars** → captured stderr typically shows the underlying error; surface verbatim and stop.
- **Cleanup** — main session wraps the dev-server lifecycle in try/finally so the process is killed on success, error, and abort.

## 8. Generator changes

### 8.1 Types (in `packages/analyzer/src/types.ts`, re-exported by generator)

```ts
export interface PageFlow {
  pages: PageRecord[];
  edges: PageEdge[];
  mermaid: string;
  stats: {
    pagesVisited: number;
    pagesSkipped: number;
    destructiveBlocked: number;
    errors: string[];
  };
  warnings: string[];
}
export interface PageRecord {
  slug: string;
  url: string;
  title: string;
  screenshot: string;          // relative to <outputDir>/public, e.g. "page-flow/home.png"
  hadModal: boolean;
  clickTargets: { label: string; to: string }[];
}
export interface PageEdge { from: string; to: string; label: string; }

// AnalysisResult gains:
//   pageFlow?: PageFlow | null;
```

`null` and missing are treated identically — existing cache JSONs without this field continue to validate.

### 8.2 Template — `packages/generator/src/templates/mdx/pages.hbs`

```mdx
---
title: Pages
description: Visual map of every page in the app
---

import { Mermaid } from 'fumadocs-ui/components/mdx/mermaid';

## Navigation map

<Mermaid chart={`{{{mermaid}}}`} />

## All pages ({{pages.length}})

<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
{{#each pages}}
  <div className="border rounded-lg overflow-hidden bg-fd-card">
    <img src="/{{screenshot}}" alt="{{title}}" className="w-full border-b" />
    <div className="p-4">
      <h3 className="font-semibold mb-1">{{title}}</h3>
      <code className="text-xs text-fd-muted-foreground">{{url}}</code>
      {{#if clickTargets.length}}
      <p className="text-sm mt-3 mb-1">Navigates to:</p>
      <ul className="text-sm">
        {{#each clickTargets}}
        <li>→ <code>{{to}}</code> <span className="text-fd-muted-foreground">({{label}})</span></li>
        {{/each}}
      </ul>
      {{/if}}
    </div>
  </div>
{{/each}}
</div>

{{#if warnings.length}}
> **Crawl warnings:** {{join warnings ", "}}
{{/if}}
```

### 8.3 Wiring

- `content-writer.ts` — add `writePagesPage(result, outputDir)` parallel to existing per-section writers. No-op when `!result.pageFlow || result.pageFlow.pages.length === 0`.
- `meta-writer.ts` — insert `"pages"` after `"index"` in the docs sidebar order.
- `<outputDir>/public/page-flow/` is created by the main session via `fs.ensureDir` before subagent dispatch (so the subagent can write directly there).

## 9. Why no BYOK changes

Chrome MCP only exists in Claude Code, so this feature is plugin-only by necessity. Adding equivalent functionality to the BYOK analyzer would mean bundling Playwright (~300MB), reimplementing auth as code (no human-in-the-loop pause), and managing browser binaries — none of which justify the complexity for v1. If a future BYOK use case appears, a separate Playwright-backed analyzer command is the right shape; not in scope here.

## 10. Open questions / risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | Subagent loses authenticated tab between dispatches | Tab IDs persist in the user's Chrome extension session; main session passes the `tabId` explicitly to the subagent. |
| 2 | SPA route changes that don't update `location.href` (rare, hash-based or pushState-bypassing routers) | Documented limitation in v1. Layer URL-change detection via `history.pushState`/`popstate` listeners injected via `javascript_tool` if it becomes a real problem. |
| 3 | Dev server prints multiple URLs (Vite local+network) | First-run prompt confirms; persisted to config. |
| 4 | Crawl exceeds rate limits or context budget | `maxPages: 30` + `totalTimeoutMs: 10min` + subagent isolation cap the blast radius. |
| 5 | A misclick on an unmatched destructive button (e.g. "Archive" — not in default pattern list) | User can extend `destructivePatterns` after seeing the crawl output. Crawl is reversible; data is on a dev DB. |
| 6 | Mermaid diagram becomes unreadable past ~30 nodes | Acceptable at 30-page cap; could add edge bundling or layout hints later. |

## 11. Release sequencing

The skill itself ships in this repo's `.claude-plugin/`, but the MDX rendering depends on changes in `packages/generator` (new template, new wiring, new types). Because the skill calls `npx @latent-space-labs/open-auto-doc generate-from-json`, the generator changes must be published to npm before the skill can render the new `pages.mdx`. Recommended order:
1. Land generator + analyzer type changes; cut a new minor release of `@latent-space-labs/open-auto-doc`.
2. Land the sibling skill + Step 7.5 hook in `.claude-plugin/`. Pin the minimum CLI version required in the skill (verify via `--version` at start of run; fail loud if too old).

## 12. Acceptance criteria

- [ ] `/open-auto-doc-pages` exists and runs end-to-end on a Next.js app with login, producing `pages.mdx` + screenshot PNGs.
- [ ] Existing `/open-auto-doc` flow asks the new optional question and invokes the sibling skill on yes; behavior unchanged on no.
- [ ] First run prompts for dev command, base URL, login URL; persists to `.autodocrc.json`.
- [ ] Subsequent runs are fully zero-prompt with config in place.
- [ ] Dev server is killed on success, error, and user abort (verified by checking process state in test).
- [ ] Generated `pages.mdx` renders in the Fumadocs preview without errors and screenshots resolve from `/page-flow/<slug>.png`.
- [ ] Default destructive-pattern blocks for sign-out / delete are observed not to be clicked during crawl.
- [ ] Cache JSON validates against existing schema even when older runs (without `pageFlow`) are loaded.
