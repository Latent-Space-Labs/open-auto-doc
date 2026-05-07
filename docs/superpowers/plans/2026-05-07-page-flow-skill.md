# Page-flow skill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code sibling skill (`open-auto-doc-pages`) that drives Chrome via the `claude-in-chrome` MCP to crawl a running web app, captures per-page screenshots, and renders them as a `pages.mdx` (Mermaid graph + screenshot gallery) inside the open-auto-doc Fumadocs site.

**Architecture:** Two-phase delivery. Phase 1 lands the static plumbing (types, MDX template, generator wiring) and ships a new minor release of `@latent-space-labs/open-auto-doc`. Phase 2 adds the sibling skill (`SKILL.md` orchestrator + `page-crawler.md` subagent prompt) and a Step 7.5 hook into the existing `open-auto-doc` skill. The skill calls `npx @latent-space-labs/open-auto-doc generate-from-json` to render — so Phase 1 must be on npm before Phase 2 is useful.

**Tech Stack:** TypeScript ESM monorepo (npm workspaces), `tsup` bundler, Handlebars templates, Fumadocs v16 site template, Chrome MCP (`mcp__Claude_in_Chrome__*`), Claude Code skills.

**Spec:** [docs/superpowers/specs/2026-05-07-page-flow-skill-design.md](../specs/2026-05-07-page-flow-skill-design.md)

**Repo notes:**
- No tests or linters configured (per CLAUDE.md). Verification = `npm run build` succeeds + a manual fixture script exercises the new code path + spot-check of generated MDX.
- All packages are ESM; imports must use `.js` extensions.
- `tsup onSuccess` in `packages/generator/tsup.config.ts` auto-copies every `.hbs` file in `src/templates/mdx/` to `dist/templates/mdx/`. Adding a new template needs no tsup change.
- The site-template's [remark-mermaid plugin](../../../packages/site-template/lib/remark-mermaid.ts) auto-transforms ```` ```mermaid ```` fenced blocks into `<Mermaid code={...} />` JSX. **Do not import Mermaid manually in the template.**

---

## Phase 1 — Generator + analyzer foundation

### Task 1: Add page-flow types

**Files:**
- Modify: `packages/analyzer/src/types.ts` (insert before `interface AnalysisResult` at line 239; modify `AnalysisResult` at lines 239-253)

- [ ] **Step 1: Add the new interfaces before `AnalysisResult`**

Open `packages/analyzer/src/types.ts`. Find the line `export interface GettingStartedGuide {` (line 231). Insert the following block immediately above it:

```ts
// Page Flow (UI crawl)
export interface PageRecord {
  slug: string;
  url: string;
  title: string;
  screenshot: string;          // relative to <outputDir>/public, e.g. "page-flow/home.png"
  hadModal: boolean;
  clickTargets: PageClickTarget[];
}

export interface PageClickTarget {
  label: string;
  to: string;                  // slug of the destination page
}

export interface PageEdge {
  from: string;                // source slug
  to: string;                  // destination slug
  label: string;               // anchor text or button label
}

export interface PageFlowStats {
  pagesVisited: number;
  pagesSkipped: number;
  destructiveBlocked: number;
  errors: string[];
}

export interface PageFlow {
  pages: PageRecord[];
  edges: PageEdge[];
  mermaid: string;             // mermaid graph syntax (no fences)
  stats: PageFlowStats;
  warnings: string[];
}

```

- [ ] **Step 2: Add `pageFlow` to `AnalysisResult`**

In the same file, find the `AnalysisResult` interface (currently lines 239-253). Add `pageFlow` as the last optional field:

```ts
export interface AnalysisResult {
  repoName: string;
  repoUrl: string;
  staticAnalysis: StaticAnalysis;
  architecture: ArchitectureOverview;
  features: FeaturesAnalysis | null;
  apiEndpoints: ApiEndpoint[];
  components: ComponentDoc[];
  dataModels: DataModelDoc[];
  gettingStarted: GettingStartedGuide;
  diagrams: MermaidDiagram[];
  configuration: ConfigurationAnalysis | null;
  businessLogic: BusinessLogicAnalysis | null;
  errorHandling: ErrorHandlingAnalysis | null;
  pageFlow?: PageFlow | null;
}
```

- [ ] **Step 3: Build the analyzer to verify types compile**

Run: `npm run build -w packages/analyzer`
Expected: completes without errors. The dist file `packages/analyzer/dist/types.d.ts` should now contain `PageFlow`.

- [ ] **Step 4: Verify the generator picks up the new types**

Run: `npm run build -w packages/generator`
Expected: completes without errors. Generator imports types via `./types.js` (which re-exports from analyzer); no source change needed in generator/types.ts.

- [ ] **Step 5: Commit**

```bash
git add packages/analyzer/src/types.ts
git commit -m "feat(analyzer): add PageFlow types for UI page-crawl output

PageFlow + supporting interfaces capture the contract returned by the
new page-crawler subagent: per-page records (url, screenshot, click
targets), edges for the navigation graph, mermaid syntax, and stats.
Field is optional on AnalysisResult so existing cache JSONs continue
to validate."
```

---

### Task 2: Add the `pages.hbs` template

**Files:**
- Create: `packages/generator/src/templates/mdx/pages.hbs`

- [ ] **Step 1: Write the template**

Create the file with this exact content:

````handlebars
---
title: Pages
description: Visual map of every page in the app
---

## Navigation map

```mermaid
{{{mermaid}}}
```

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
````

- [ ] **Step 2: Build the generator and confirm tsup copies the new template**

Run: `npm run build -w packages/generator`
Expected: completes without errors.

Run: `ls packages/generator/dist/templates/mdx/pages.hbs`
Expected: file exists (tsup `onSuccess` copies it automatically).

- [ ] **Step 3: Commit**

```bash
git add packages/generator/src/templates/mdx/pages.hbs
git commit -m "feat(generator): add pages.hbs template for page-flow MDX

Single-page output: mermaid navigation graph + responsive screenshot
gallery cards with per-page click targets. Uses fenced mermaid blocks
(transformed to <Mermaid code={...}/> by the site-template's existing
remark-mermaid plugin) — no manual import needed."
```

---

### Task 3: Wire `writePagesPage` into content-writer

**Files:**
- Modify: `packages/generator/src/content-writer.ts` (line 123 — `templateFiles` array; insert a new block inside `writeRepoContent`)

- [ ] **Step 1: Register the template name in `loadTemplates`**

In `packages/generator/src/content-writer.ts`, find the `templateFiles` array on line 123:

```ts
const templateFiles = ["overview", "features", "getting-started", "architecture", "api-endpoint", "component", "data-model", "diagrams", "cross-repo", "configuration", "business-logic", "error-handling", "changelog", "system-graph"];
```

Replace it with:

```ts
const templateFiles = ["overview", "features", "getting-started", "architecture", "pages", "api-endpoint", "component", "data-model", "diagrams", "cross-repo", "configuration", "business-logic", "error-handling", "changelog", "system-graph"];
```

(Adding `"pages"` after `"architecture"` matches the sidebar order added in Task 4.)

- [ ] **Step 2: Add the page-flow render block inside `writeRepoContent`**

Find the `// Architecture` block in `writeRepoContent` (currently lines 271-277):

```ts
  // Architecture
  if (templates["architecture"]) {
    await fs.writeFile(
      path.join(dir, "architecture.mdx"),
      renderTemplate("architecture", safeResult),
    );
  }
```

Insert the following block immediately after the closing `}` of the architecture block, before the `// API Endpoints` comment:

```ts
  // Pages (UI crawl: navigation graph + screenshot gallery)
  if (
    safeResult.pageFlow &&
    safeResult.pageFlow.pages.length > 0 &&
    templates["pages"]
  ) {
    await fs.writeFile(
      path.join(dir, "pages.mdx"),
      renderTemplate("pages", { ...safeResult, ...safeResult.pageFlow }),
    );
  }
```

The spread `{ ...safeResult, ...safeResult.pageFlow }` lifts `pages`, `edges`, `mermaid`, `stats`, and `warnings` to top-level so the template's `{{pages.length}}`, `{{#each pages}}`, and `{{{mermaid}}}` resolve correctly.

- [ ] **Step 3: Build to verify**

Run: `npm run build -w packages/generator`
Expected: completes without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/generator/src/content-writer.ts
git commit -m "feat(generator): render pages.mdx when AnalysisResult has pageFlow

Adds 'pages' to the loaded templates list and a conditional writer in
writeRepoContent that emits pages.mdx whenever pageFlow.pages is
non-empty. The pageFlow fields (pages, edges, mermaid, warnings) are
spread to the top of the render context so the template can iterate
them directly."
```

---

### Task 4: Wire `pages` into the sidebar order in meta-writer

**Files:**
- Modify: `packages/generator/src/meta-writer.ts` (lines 43-55 — pages list)

- [ ] **Step 1: Insert `pages` into the sidebar list**

In `packages/generator/src/meta-writer.ts`, find the block at lines 43-55:

```ts
  const pages: string[] = ["index"];
  if (result.features && result.features.features.length > 0) pages.push("features");
  pages.push("getting-started");
  if (result.configuration && result.configuration.configItems.length > 0) pages.push("configuration");
  if (result.businessLogic && (result.businessLogic.domainConcepts.length > 0 || result.businessLogic.businessRules.length > 0 || result.businessLogic.workflows.length > 0)) pages.push("business-logic");
  pages.push("architecture");
  if (result.apiEndpoints.length > 0) pages.push("api");
  if (result.components.length > 0) pages.push("components");
  if (result.dataModels.length > 0) pages.push("data-models");
  if (result.errorHandling && (result.errorHandling.errorCodes.length > 0 || result.errorHandling.commonErrors.length > 0)) pages.push("error-handling");
  pages.push("system-graph");
  if (result.diagrams && result.diagrams.length > 0) pages.push("diagrams");
  if (changelog && (changelog.added.length > 0 || changelog.removed.length > 0 || changelog.modified.length > 0)) pages.push("changelog");
```

Add a new line for `pages` right after `pages.push("architecture");`:

```ts
  const pages: string[] = ["index"];
  if (result.features && result.features.features.length > 0) pages.push("features");
  pages.push("getting-started");
  if (result.configuration && result.configuration.configItems.length > 0) pages.push("configuration");
  if (result.businessLogic && (result.businessLogic.domainConcepts.length > 0 || result.businessLogic.businessRules.length > 0 || result.businessLogic.workflows.length > 0)) pages.push("business-logic");
  pages.push("architecture");
  if (result.pageFlow && result.pageFlow.pages.length > 0) pages.push("pages");
  if (result.apiEndpoints.length > 0) pages.push("api");
  if (result.components.length > 0) pages.push("components");
  if (result.dataModels.length > 0) pages.push("data-models");
  if (result.errorHandling && (result.errorHandling.errorCodes.length > 0 || result.errorHandling.commonErrors.length > 0)) pages.push("error-handling");
  pages.push("system-graph");
  if (result.diagrams && result.diagrams.length > 0) pages.push("diagrams");
  if (changelog && (changelog.added.length > 0 || changelog.removed.length > 0 || changelog.modified.length > 0)) pages.push("changelog");
```

- [ ] **Step 2: Build to verify**

Run: `npm run build -w packages/generator`
Expected: completes without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/generator/src/meta-writer.ts
git commit -m "feat(generator): include 'pages' in sidebar order when pageFlow present

Inserts the page-flow doc immediately after architecture in the
Fumadocs sidebar — keeps the visual UI map next to the architectural
overview, before the structured API/component reference."
```

---

### Task 5: End-to-end fixture verification of Phase 1

**Files:**
- Create (temporary, not committed): `/tmp/oad-pageflow-fixture.mjs`

- [ ] **Step 1: Build all packages**

Run: `npm run build`
Expected: completes without errors. All three workspace packages (`analyzer`, `generator`, `cli`) build.

- [ ] **Step 2: Write a fixture script**

Run from the worktree root. The script computes the import path from `process.cwd()`, so it's portable to any clone/worktree.

Create `/tmp/oad-pageflow-fixture.mjs` with this content:

```javascript
import fs from "node:fs/promises";
import path from "node:path";

const generatorEntry = path.resolve(process.cwd(), "packages/generator/dist/index.js");
const { writeContent, writeMeta } = await import(generatorEntry);

const outDir = "/tmp/oad-pageflow-test";
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const result = {
  repoName: "demo-app",
  repoUrl: "",
  staticAnalysis: {
    fileTree: { path: ".", name: "demo-app", type: "directory" },
    languages: ["TypeScript"],
    dependencies: [],
    claudeMd: [],
    entryFiles: [],
    totalFiles: 0,
  },
  architecture: {
    summary: "Demo app for fixture verification.",
    projectPurpose: "demo",
    targetAudience: "test",
    techStack: ["Next.js"],
    modules: [],
    dataFlow: "",
    entryPoints: [],
    keyPatterns: [],
    diagrams: [],
  },
  features: null,
  apiEndpoints: [],
  components: [],
  dataModels: [],
  gettingStarted: { prerequisites: [], installation: "", quickStart: "" },
  diagrams: [],
  configuration: null,
  businessLogic: null,
  errorHandling: null,
  pageFlow: {
    pages: [
      {
        slug: "home",
        url: "/",
        title: "Welcome",
        screenshot: "page-flow/home.png",
        hadModal: false,
        clickTargets: [{ label: "Get started", to: "signup" }],
      },
      {
        slug: "signup",
        url: "/signup",
        title: "Sign Up",
        screenshot: "page-flow/signup.png",
        hadModal: false,
        clickTargets: [],
      },
    ],
    edges: [{ from: "home", to: "signup", label: "Get started" }],
    mermaid: "graph LR\n  home --> |Get started| signup",
    stats: { pagesVisited: 2, pagesSkipped: 0, destructiveBlocked: 0, errors: [] },
    warnings: [],
  },
};

await writeContent(outDir, [result]);
await writeMeta(outDir, [result]);

console.log("Wrote MDX to", outDir);
const pagesPath = path.join(outDir, "pages.mdx");
const meta = JSON.parse(await fs.readFile(path.join(outDir, "meta.json"), "utf-8"));
const pagesMdx = await fs.readFile(pagesPath, "utf-8");

// Assertions
const checks = {
  "pages.mdx exists": pagesMdx.length > 0,
  "pages.mdx has mermaid graph": pagesMdx.includes("```mermaid") && pagesMdx.includes("home --> |Get started| signup"),
  "pages.mdx references screenshot": pagesMdx.includes('src="/page-flow/home.png"'),
  "pages.mdx renders click target": pagesMdx.includes("→ <code>signup</code>"),
  "meta.json includes pages": meta.pages.includes("pages"),
  "meta.json places pages after architecture": meta.pages.indexOf("pages") === meta.pages.indexOf("architecture") + 1,
};

let allPass = true;
for (const [label, ok] of Object.entries(checks)) {
  console.log(ok ? "  ✓" : "  ✗", label);
  if (!ok) allPass = false;
}

if (!allPass) {
  console.error("\n--- pages.mdx ---\n" + pagesMdx);
  console.error("\n--- meta.json ---\n" + JSON.stringify(meta, null, 2));
  process.exit(1);
}

console.log("\nAll checks passed.");
```

- [ ] **Step 3: Run the fixture**

Run: `node /tmp/oad-pageflow-fixture.mjs`
Expected output:

```
Wrote MDX to /tmp/oad-pageflow-test
  ✓ pages.mdx exists
  ✓ pages.mdx has mermaid graph
  ✓ pages.mdx references screenshot
  ✓ pages.mdx renders click target
  ✓ meta.json includes pages
  ✓ meta.json places pages after architecture

All checks passed.
```

- [ ] **Step 4: Spot-check the generated MDX**

Run: `cat /tmp/oad-pageflow-test/pages.mdx`
Expected: human-readable Pages MDX with mermaid graph, two cards, click target list.

- [ ] **Step 5: Clean up the fixture**

Run: `rm /tmp/oad-pageflow-fixture.mjs && rm -rf /tmp/oad-pageflow-test`

- [ ] **Step 6: Cut a release of the CLI package** (optional within the dev cycle, but **required** before Phase 2 is functional)

This step is performed manually by the maintainer. It bumps `@latent-space-labs/open-auto-doc` so `npx ...` in Phase 2 picks up the new template:

```bash
npm run release -- minor   # bumps to v0.7.0, creates git tag, pushes with --tags
```

The release script publishes to npm. Phase 2's skill will pin `>= 0.7.0` so it fails loud if the user has an old cached CLI.

---

## Phase 2 — Sibling skill (`open-auto-doc-pages`)

### Task 6: Create skill directory + page-flow schema doc

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc-pages/schemas/page-flow.md`

- [ ] **Step 1: Create the skill directory tree**

Run: `mkdir -p .claude-plugin/skills/open-auto-doc-pages/agents .claude-plugin/skills/open-auto-doc-pages/schemas`

- [ ] **Step 2: Write the schema doc**

Create `.claude-plugin/skills/open-auto-doc-pages/schemas/page-flow.md` with this content:

````markdown
# PageFlow JSON contract

The page-crawler subagent returns this shape inside a single fenced ```json block. The `open-auto-doc-pages` orchestrator parses it and merges it into the `AnalysisResult.pageFlow` field of the cache JSON before re-running `generate-from-json`.

## Schema

```jsonc
{
  "pages": [
    {
      "slug": "string (kebab-case URL pathname; '/' → 'home')",
      "url": "string (full or path-relative URL)",
      "title": "string (document.title at crawl time)",
      "screenshot": "string (relative path under <outputDir>/public, e.g. 'page-flow/home.png')",
      "hadModal": "boolean (true if a [role=dialog] was detected and Esc-dismissed)",
      "clickTargets": [
        { "label": "string (anchor text or aria-label, ≤80 chars)", "to": "string (destination slug)" }
      ]
    }
  ],
  "edges": [
    { "from": "string (slug)", "to": "string (slug)", "label": "string (anchor text or button label)" }
  ],
  "mermaid": "string (mermaid graph syntax — 'graph LR\\n  ...' — without ``` fences)",
  "stats": {
    "pagesVisited": "number",
    "pagesSkipped": "number (URLs filtered by exclude/destructive rules)",
    "destructiveBlocked": "number (clicks blocked by destructivePatterns)",
    "errors": ["string (per-page error messages, if any)"]
  },
  "warnings": ["string (non-fatal issues to surface to the user)"]
}
```

## Slug rules

- `/` → `home`
- Path segments lowercased; non-alphanumerics collapsed to `-`; leading/trailing `-` trimmed.
- Collisions get `-2`, `-3`, … suffixes deterministic by visit order.
- Slugs are stable identifiers for the lifetime of one crawl; do not assume cross-run stability.

## File expectations

By the time the subagent returns, screenshots referenced in `pages[*].screenshot` must already exist on disk at `<outputDir>/public/<screenshot>`. The orchestrator does not re-fetch or move them.
````

- [ ] **Step 3: Commit (no-op directories will be picked up when files are added)**

```bash
git add .claude-plugin/skills/open-auto-doc-pages/schemas/page-flow.md
git commit -m "docs(plugin): add PageFlow JSON contract for page-crawler subagent"
```

---

### Task 7: Write the `page-crawler` subagent prompt

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc-pages/agents/page-crawler.md`

- [ ] **Step 1: Write the prompt file**

Create `.claude-plugin/skills/open-auto-doc-pages/agents/page-crawler.md` with this content:

````markdown
---
description: Page-crawl subagent. Drives Chrome MCP to BFS-crawl a running web app, captures per-page screenshots, and returns a PageFlow JSON manifest. Failure on any single page is non-fatal; total failure (no pages visited) returns errors[] with details.
---

# Page-crawler subagent prompt

You are a UI documentation crawler. You drive an already-open Chrome tab (authenticated by the user, if applicable) through the user's running web app, capture a screenshot of every reachable page, and produce a structured manifest.

## Required tools

Before doing anything, load the Chrome MCP tools via ToolSearch in a single call (deferred tool schemas are not loaded by default):

```
ToolSearch({ query: "claude-in-chrome", max_results: 30 })
```

This loads `tabs_context_mcp`, `navigate`, `computer` (for screenshots), `javascript_tool`, `find`, and the rest of the `mcp__Claude_in_Chrome__*` toolkit you need.

## Inputs (provided by the orchestrator in the dispatch prompt)

- `tabId` — the Chrome tab the orchestrator has already opened and (optionally) authenticated.
- `baseUrl` — origin to crawl, e.g. `http://localhost:3000`.
- `screenshotDir` — absolute path to `<outputDir>/public/page-flow/` (already created by orchestrator).
- `screenshotRel` — relative prefix to embed in `pages[*].screenshot`, e.g. `"page-flow/"`.
- `maxPages`, `maxDepth`, `perPageTimeoutMs`, `totalTimeoutMs`, `dropQueryParams`, `excludeUrls`, `destructivePatterns`, `allowDestructive` — from `.autodocrc.json`.

## Algorithm

Maintain in subagent memory:

```
visited:  Set<string>          // canonicalized URL keys
queue:    Array<{ url, depth, sourceSlug?, sourceLabel? }>
pages:    Map<slug, PageRecord>
edges:    Array<PageEdge>
warnings: string[]
stats:    { pagesVisited: 0, pagesSkipped: 0, destructiveBlocked: 0, errors: [] }
```

Compile `destructiveRe` once: `new RegExp(destructivePatterns.join("|"), "i")`.

### Outer loop

```
queue.push({ url: baseUrl, depth: 0 })
crawlStart = Date.now()
while (queue.length > 0):
  if (Date.now() - crawlStart > totalTimeoutMs):
    warnings.push("crawl-total-timeout")
    break
  if (pages.size >= maxPages):
    warnings.push("max-pages-reached")
    break
  next = queue.shift()
  if (next.depth > maxDepth) continue
  canonical = canonicalize(next.url, dropQueryParams)
  if (visited.has(canonical)) continue
  visited.add(canonical)
  try {
    record = await visitPage(next, tabId)
    if (record) {
      pages.set(record.slug, record)
      stats.pagesVisited++
      // record.outgoing comes from visitPage as resolved {url, label} pairs
      for (const out of record.outgoing) {
        const outCanonical = canonicalize(out.url, dropQueryParams)
        if (!visited.has(outCanonical) && pages.size + queue.length < maxPages) {
          queue.push({ url: out.url, depth: next.depth + 1, sourceSlug: record.slug, sourceLabel: out.label })
        }
      }
    }
  } catch (err) {
    stats.errors.push(`${next.url}: ${err.message}`)
  }
```

### `visitPage(item, tabId)`

1. `await navigate({ url: item.url, tabId })` with a `perPageTimeoutMs` wrapper.
2. Detect login redirect: read `location.href` via `javascript_tool` — if path matches the configured `loginUrl`, push `"session-expired"` to warnings and stop the entire crawl (return null and break the outer loop in the next iteration).
3. Dismiss modal: in one `javascript_tool` call, return `!!document.querySelector('[role="dialog"]')`. If true, send `Escape` via `computer({ action: "key", text: "Escape", tabId })` then re-check; record `hadModal = true` regardless of dismiss success.
4. Take a screenshot with `computer({ action: "screenshot", save_to_disk: true, tabId })`. The tool returns `{ savedPath }` (a temp path). Compute `slug` from `location.href` pathname (see slug rules below). Move the file:
   ```
   await Bash(`mv "${savedPath}" "${screenshotDir}/${slug}.png"`)
   ```
   Set `record.screenshot = `${screenshotRel}${slug}.png``.
5. Extract metadata in **one** `javascript_tool` call (avoids N MCP round-trips):
   ```js
   ({
     title: document.title,
     href: location.href,
     anchors: [...document.querySelectorAll('a[href]')]
       .map(a => ({
         href: a.href,
         text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80)
       }))
       .filter(a => a.text.length > 0),
     buttons: [...document.querySelectorAll('button, [role="button"]')]
       .filter(b => b.type !== 'submit' && !b.closest('form'))
       .map(b => ({
         text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 80)
       }))
       .filter(b => b.text.length > 0)
   })
   ```
6. Filter clickables in subagent code:
   - **Anchors:** keep if `new URL(href).origin === baseUrlOrigin` AND not in `excludeUrls` AND `!destructiveRe.test(text)` (unless `allowDestructive.includes(text)`).
   - **Buttons:** keep if `!destructiveRe.test(text)` (unless allowed). The form-submit + `closest('form')` filter already happened in step 5.
7. Build `outgoing`: for each kept anchor, add `{ url: anchor.href, label: anchor.text }`. (Anchors don't need clicking — `href` tells us where they go.) Add edges to the global `edges` array as you go.
8. For each kept button, click and check for navigation:
   - Read `location.href` (via `javascript_tool`) before click.
   - `computer({ action: "left_click", ..., tabId })` on the button (use `find` to get coordinates from the button's text).
   - Poll `location.href` 4× at 500ms intervals. If it changed, record edge + outgoing entry, then `navigate` back to the page being crawled. If unchanged, drop the button (non-navigational).
   - Cap total per-page button-click time at `perPageTimeoutMs / 2` to avoid runaway pages.
9. Return:
   ```
   {
     slug, url: location.href, title, screenshot,
     hadModal,
     clickTargets: [...kept anchors, ...kept buttons that navigated].map(({label, to}) => ({label, to})),
     outgoing: [...resolved {url, label} for queue]
   }
   ```

### `canonicalize(url, dropQueryParams)`

```js
const u = new URL(url, baseUrl);
return dropQueryParams ? `${u.origin}${u.pathname}${u.hash}` : u.toString();
```

### Slug rules (deterministic)

```js
function slugify(pathname) {
  if (pathname === '/' || pathname === '') return 'home';
  return pathname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

If a slug is already in `pages`, append `-2`, `-3`, … until unique. Track these collisions deterministically using a `slugCounts: Map<string, number>`.

### Mermaid output

After the crawl, build the mermaid string from `edges`:

```
graph LR
  <fromSlug> --> |<sanitized label>| <toSlug>
```

Sanitize labels: replace `|`, `[`, `]`, `(`, `)`, `"` with spaces; truncate to 30 chars. Deduplicate identical edges. If `edges` is empty (single-page app), emit `graph LR\n  home`.

## Output

Return your output as a single fenced JSON code block matching the schema in `schemas/page-flow.md`. Do not include any prose outside the code block — the orchestrator parses the first ```json fence.

## Failure modes

- **No pages visited at all** (e.g., `baseUrl` returned 404, login redirect on first hit): return the schema with empty `pages` and `edges`, populated `stats.errors`, and a top-level `warnings` array describing what happened. The orchestrator will surface this to the user; the run is not considered fatal at the subagent level.
- **Per-page errors** (timeout, navigation failure): push to `stats.errors` and continue. Don't block the rest of the crawl on one bad page.
- **Tool-loading failure** (ToolSearch returns nothing): return a JSON object with `pages: []`, `warnings: ["chrome-mcp-unavailable"]`, and `stats.errors: ["could not load Chrome MCP tools"]`.
````

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc-pages/agents/page-crawler.md
git commit -m "feat(plugin): add page-crawler subagent prompt

Drives Chrome MCP to BFS-crawl a running app, captures per-page
screenshots, applies conservative destructive-action filtering, and
returns a PageFlow JSON manifest. Loads MCP tools via ToolSearch on
entry, single javascript_tool call for DOM extraction (avoids N
round-trips per page), and form-aware button filtering (button + 
closest('form') treated as submit regardless of explicit type)."
```

---

### Task 8: Write the `open-auto-doc-pages` SKILL.md orchestrator

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc-pages/SKILL.md`

- [ ] **Step 1: Write the skill orchestrator**

Create `.claude-plugin/skills/open-auto-doc-pages/SKILL.md` with this content:

````markdown
---
name: open-auto-doc-pages
description: Crawl the user's running web app via Chrome MCP, capture per-page screenshots, and add a Pages page (Mermaid navigation graph + screenshot gallery) to the open-auto-doc Fumadocs site. Use when the user asks to "screenshot the app", "crawl the pages", "add page screenshots to the docs", invokes /open-auto-doc-pages, or accepts the optional page-crawl prompt during /open-auto-doc.
---

# open-auto-doc-pages skill

This skill is a sibling to `open-auto-doc`. It assumes the open-auto-doc Fumadocs site is already scaffolded and `.autodocrc.json` exists. It does NOT re-run the AI analysis — it just adds page-flow data and screenshots to the existing cache, then re-renders MDX.

## When to use

- The user invokes `/open-auto-doc-pages` directly.
- The main `open-auto-doc` skill's Step 7.5 dispatches this skill after the user accepts the optional page-crawl prompt.
- The user says "screenshot the app", "crawl the pages", "add page screenshots", or similar.

## When NOT to use

- The repo is not a web app (no UI to crawl). Detect heuristically: no `package.json` `scripts.dev`, OR the `.autodocrc.json` has no `pageFlow` block AND the user has not requested page-crawl explicitly. If unsure, ask the user.
- `.autodocrc.json` is missing entirely. Tell the user to run `/open-auto-doc` first to scaffold.

## Process overview

1. Detect state (read `.autodocrc.json`)
2. Verify CLI version
3. First-run prompts (if `pageFlow` block missing)
4. Start dev server (background)
5. Open Chrome tab + login pause
6. Dispatch `page-crawler` subagent
7. Merge manifest into cache JSON
8. Kill dev server (try/finally)
9. Re-render MDX
10. Print summary

## Step 1: Detect state

Use Read on `.autodocrc.json` (cwd first, then `docs-site/.autodocrc.json`). If neither exists, tell the user "Run `/open-auto-doc` first to scaffold the site, then re-run this skill." and stop.

Capture:
- `<outputDir>` from `outputDir`
- `<repoName>` from `repos[0].name`
- `<cacheDir>` = `<outputDir>/.autodoc-cache`
- `<cachePath>` = `<cacheDir>/<repoName>-analysis.json`
- `<pageFlowConfig>` = `pageFlow` block (may be missing)

Use Bash `pwd` to capture `<repoPath>`.

Use Read on `<cachePath>`. If missing, tell the user "No analysis cache yet — run `/open-auto-doc` first." and stop.

## Step 2: Verify CLI version

Run: `npx @latent-space-labs/open-auto-doc --version`
Parse the printed version. If `< 0.7.0`, tell the user:

> "This skill needs `@latent-space-labs/open-auto-doc` v0.7.0 or later (you have vX.Y.Z). Update with `npm install -g @latent-space-labs/open-auto-doc@latest` or clear your npx cache."

…and stop.

## Step 3: First-run prompts (only if `pageFlow` is missing)

If `<pageFlowConfig>` is null/undefined, walk the user through:

### 3a. Detect dev command

Read `package.json` in `<repoPath>`. If `scripts.dev` exists and the repo is not a monorepo (no `workspaces` field, no `turbo.json`, no `pnpm-workspace.yaml`), the command is `npm run dev`. Otherwise:

- **Monorepo:** Glob `**/package.json` (limit depth 3) and find all packages with a `dev` script. Present them as a numbered list and ask the user which package to crawl. The dev command becomes `npm run dev -w packages/<chosen>` or `cd <chosen> && npm run dev` depending on workspace setup.
- **No `dev` script:** Ask the user for the exact command.

Save as `<devCommand>`.

### 3b. Login URL

Ask: "What's the login path for your app? (default `/login`, or `none` for a public-only crawl)"
Save as `<loginUrl>` or set `<publicOnly> = true`.

### 3c. Persist defaults

Write the full `pageFlow` block back to `.autodocrc.json` using Read + Edit (or Write if the key is absent). Default values:

```jsonc
"pageFlow": {
  "enabled": true,
  "devCommand": "<devCommand>",
  "baseUrl": "",                              // filled after dev server starts
  "loginUrl": "<loginUrl>",
  "publicOnly": <publicOnly>,
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
```

## Step 4: Start dev server

Use Bash with `run_in_background: true`. The Bash tool inherits the current working directory; if `<repoPath>` differs from cwd, prefix the command with `cd <repoPath> && `:

```
Bash({ command: <devCommand>, run_in_background: true, description: "Start dev server" })
```

Capture the returned `bash_id`. Save it for cleanup.

Use Monitor (or polling reads) to watch stdout for the first URL pattern matching `https?://[^\s]+:\d+`. Allow up to 60s. If multiple distinct URLs appear within the first 5 seconds (Vite local + network case), present them numbered and ask the user to pick. Save as `<baseUrl>` and persist back to `.autodocrc.json`.

If 60s passes with no URL: kill the process (`Bash` with command `kill <pid>` after capturing pid via the bash_id, or use `KillShell` if available), Read the captured stdout/stderr (last 30 lines), and tell the user:

> "Dev server didn't respond after 60s. Last lines of output:
>
> ```
> <captured>
> ```
>
> Try a different command? (type the new command, or 'cancel')"

If they type a command, retry. If `cancel`, stop.

## Step 5: Open Chrome tab + login pause

Use the claude-in-chrome MCP. If its tools aren't loaded, run:

```
ToolSearch({ query: "claude-in-chrome", max_results: 30 })
```

Then:

1. `tabs_context_mcp({ createIfEmpty: true })` — get/create the MCP tab group.
2. Pick a `tabId` from the returned list (or call `tabs_create_mcp` if empty).
3. If `<publicOnly>` is true, `navigate({ url: <baseUrl>, tabId })` and skip to step 6.
4. Otherwise, `navigate({ url: <baseUrl> + <loginUrl>, tabId })`.
5. Tell the user:

   > "I've opened your app at `<URL>` in a Chrome tab. Please log in there, then say **ready** to start the crawl. Or say **public-only** to skip login and crawl what's reachable without auth."

6. Wait for user input. Accept `ready`, `public-only`, or `cancel`. On `cancel`, jump to Step 8 (cleanup) and stop.

## Step 6: Dispatch page-crawler subagent

Read `.claude-plugin/skills/open-auto-doc-pages/agents/page-crawler.md` (relative to this skill's base directory).

Ensure the screenshot directory exists:

```
Bash({ command: `mkdir -p ${<outputDir>}/public/page-flow`, description: "Create screenshot dir" })
```

Dispatch ONE subagent via the Agent tool:

- `subagent_type`: `general-purpose`
- `description`: `"Crawl pages and capture screenshots"`
- `prompt`: Concatenate:
  1. The `page-crawler.md` body (everything after the frontmatter)
  2. `\n\n## Run-specific inputs\n\n` followed by a JSON block with all input values:
     ```json
     {
       "tabId": <tabId>,
       "baseUrl": "<baseUrl>",
       "screenshotDir": "<outputDir>/public/page-flow",
       "screenshotRel": "page-flow/",
       "loginUrl": "<loginUrl or empty if publicOnly>",
       "maxPages": <maxPages>, "maxDepth": <maxDepth>,
       "perPageTimeoutMs": <perPageTimeoutMs>, "totalTimeoutMs": <totalTimeoutMs>,
       "dropQueryParams": <dropQueryParams>,
       "excludeUrls": [...], "destructivePatterns": [...], "allowDestructive": [...]
     }
     ```
  3. `\n\nReturn your output as a single fenced JSON code block.`

Wait for the subagent to return. Parse the first JSON code block from its output.

If parsing fails or the subagent errors out: surface the raw output to the user, jump to Step 8 (cleanup), and stop. Do not retry — the dev server is still running and the user can re-invoke the skill.

## Step 7: Merge manifest into cache JSON

Use Read to load `<cachePath>`. The file structure is:

```jsonc
{ "version": 3, "commitSha": "...", "timestamp": "...", "result": { ...AnalysisResult... } }
```

Set `result.pageFlow = <subagent manifest>`. Write back via Write.

## Step 8: Kill dev server (try/finally — runs even on errors and cancels)

Use the `bash_id` from Step 4. Run `KillShell(<bash_id>)` if available, or fall back to:

```
Bash({ command: `kill ${<pid>}`, description: "Stop dev server" })
```

Wait 2s. Verify the process is gone (`ps -p <pid>`); if not, send SIGKILL.

If this step fails (process already gone, etc.), log a warning but continue.

## Step 9: Re-render MDX

Run: `npx @latent-space-labs/open-auto-doc generate-from-json`

Parse the JSON output `{"ok":true,"outputDir":"...","repos":["..."]}`. If it fails, surface the error.

## Step 10: Print summary

```
Page crawl complete:
  Pages visited:        <stats.pagesVisited>
  Pages skipped:        <stats.pagesSkipped>
  Destructive blocked:  <stats.destructiveBlocked>
  Errors:               <stats.errors.length>
  Warnings:             <warnings.length>

Output: <outputDir>/content/docs/pages.mdx
Screenshots: <outputDir>/public/page-flow/

Preview locally: cd <outputDir> && npm run dev
```

If `warnings.length > 0`, list them. If `stats.errors.length > 0`, list them too with their URLs.

## Helpful patterns

- **Loading prompt files**: `agents/page-crawler.md` is relative to this skill's base directory. The runtime tells you the base dir at activation; resolve relative to it.
- **try/finally for dev server**: Step 8 (kill) MUST run on success, error, AND user cancel. Wrap your in-memory state machine such that the kill happens unconditionally.
- **Tool-load batching**: Load the entire claude-in-chrome MCP toolkit in one ToolSearch call (`max_results: 30`), not per-tool — keyword search is one round-trip.
- **Don't navigate the user's tabs outside the MCP tab group.** `tabs_context_mcp` scopes you to a special group; respect it.
````

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc-pages/SKILL.md
git commit -m "feat(plugin): add open-auto-doc-pages skill orchestrator

Sibling skill that drives Chrome MCP to crawl the running app,
captures screenshots, and merges a PageFlow manifest into the
existing analysis cache, then re-renders MDX. Manages dev-server
lifecycle (auto-start with stdout port detection, try/finally
shutdown), pauses for user-driven login (no creds in chat), and
pins minimum CLI version so the new pages.mdx template is
guaranteed available."
```

---

### Task 9: Hook Step 7.5 into the existing `open-auto-doc` SKILL.md

**Files:**
- Modify: `.claude-plugin/skills/open-auto-doc/SKILL.md` (insert between Step 7 and Step 8)

- [ ] **Step 1: Insert Step 7.5**

In `.claude-plugin/skills/open-auto-doc/SKILL.md`, find the line `## Step 8: End-of-run menu` (currently around line 209). Insert the following block immediately above it:

````markdown
## Step 7.5: Optional page crawl

**Skip this step entirely in unattended mode** — the main flow's `routineAction` doesn't include page crawling, and the crawl needs human-in-the-loop login.

In interactive mode, after Step 7's MDX render succeeds, ask:

> "Want to also crawl the running app and capture screenshots of every page? (y/n)
> This opens a Chrome tab, asks you to log in, then walks through the app and saves a screenshot of each page into the docs."

If the user answers `y`/`yes`: invoke the sibling skill via the Skill tool:

```
skill: open-auto-doc-pages
args: (none)
```

Wait for it to complete and surface its summary. Then continue to Step 8.

If the user answers `n`/`no` (or anything else): proceed directly to Step 8.

````

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/SKILL.md
git commit -m "feat(plugin): add Step 7.5 page-crawl prompt to open-auto-doc

After MDX render, ask the user if they want to also crawl the
running app for screenshots. On yes, invoke the new
open-auto-doc-pages sibling skill. Skipped in unattended mode."
```

---

## Phase 3 — End-to-end manual smoke test

### Task 10: Manual end-to-end run on a real Next.js app

Phase 1 must be published to npm before this works. Use any Next.js app you have locally (or scaffold a fresh one with `npx create-next-app@latest /tmp/oad-smoke` and add a couple of pages).

- [ ] **Step 1: Scaffold the docs site for the smoke-test repo**

In the test repo:

```bash
npx @latent-space-labs/open-auto-doc@latest scaffold -o docs-site
```

Verify `docs-site/.autodocrc.json` is created.

- [ ] **Step 2: Run `/open-auto-doc-pages` in Claude Code**

In a Claude Code session in the test repo's directory, run `/open-auto-doc-pages`.

Expected:
- It detects no `pageFlow` block, runs first-run prompts.
- Detects `npm run dev` from `package.json`.
- Asks for login URL — answer `none` for the smoke test (skip auth).
- Starts the dev server, parses the URL from stdout.
- Opens a Chrome tab to the app.
- Dispatches the page-crawler subagent.
- Subagent crawls, takes screenshots, returns manifest.
- Merges into cache, kills dev server, re-renders MDX.
- Prints summary.

- [ ] **Step 3: Verify outputs**

```bash
ls docs-site/public/page-flow/        # should contain at least 1 .png
cat docs-site/content/docs/pages.mdx  # should have mermaid graph + cards
cat docs-site/content/docs/meta.json  # should include "pages" in pages array
```

- [ ] **Step 4: Preview the docs site**

```bash
cd docs-site && npm install && npm run dev
```

Visit `http://localhost:3000/docs/pages` (or whatever port Fumadocs picks). Verify:
- Mermaid graph renders.
- Screenshot cards display.
- Click-target lists show under each card.
- `/page-flow/<slug>.png` images load.

- [ ] **Step 5: Test the integrated path through `/open-auto-doc`**

In a fresh test repo (or after `git clean -fdx docs-site && rm -rf docs-site`):

```
/open-auto-doc
```

Expected flow:
- Standard analysis runs (Wave 1 + Wave 2 + Wave 3).
- After Step 7 (MDX render), Step 7.5 asks: "Want to also crawl…?" → answer `y`.
- The sibling skill runs and completes.
- Step 8 menu appears.

- [ ] **Step 6: Test the cancel path**

Re-run `/open-auto-doc-pages`. At the login pause, answer `cancel`. Verify the dev server is killed (no orphan process listening on the port: `lsof -i :3000` returns nothing).

- [ ] **Step 7: Test session-expired detection**

Re-run, log in, then in another tab manually log out. The next page navigation in the crawl should redirect to login; the subagent should record `session-expired` warning and stop. The orchestrator surfaces it.

- [ ] **Step 8: Final cleanup commit (if any tweaks were needed during smoke testing)**

```bash
git add -A
git commit -m "fix(plugin): smoke-test fixes from end-to-end run"
```

(If no changes were needed, skip this step.)

---

## Self-review

**Spec coverage:**
- §4.1 (Step 7.5 hook) → Task 9 ✓
- §4.2 (direct invocation) → Task 8's SKILL.md frontmatter ✓
- §4.3 (orchestrator flow) → Task 8 (Steps 1-10 in SKILL.md) ✓
- §5.1 (main/subagent split) → Tasks 7+8 (split is in the SKILL.md/page-crawler.md boundary) ✓
- §5.2 (file layout) → Tasks 6+7+8+9 cover all files ✓
- §6 (crawler internals) → Task 7 ✓
- §7 (config schema) → Task 8 Step 3 (first-run prompts persist defaults) ✓
- §7.3 (dev-server failure UX) → Task 8 Step 4 ✓
- §8.1 (types) → Task 1 ✓
- §8.2 (template) → Task 2 ✓
- §8.3 (wiring) → Tasks 3+4 ✓
- §10 risk register items 1-6 → addressed by design choices in Task 7 (subagent prompt) and the conservative defaults in Task 8 ✓
- §11 release sequencing → Task 5 Step 6 ✓
- §12 acceptance criteria → Task 10 verifies all eight bullets ✓

**Placeholder scan:** No "TBD", "TODO", or hand-wavey steps. Each task has exact paths, full code, and explicit commands.

**Type consistency check:**
- `PageFlow` (Task 1) ↔ `pageFlow?: PageFlow | null` on AnalysisResult (Task 1 Step 2) ✓
- Template references `{{pages.length}}`, `{{#each pages}}`, `{{{mermaid}}}`, `{{screenshot}}`, `{{title}}`, `{{url}}`, `{{#each clickTargets}}{{to}}{{label}}{{/each}}`, `{{warnings}}` — all match `PageFlow` and `PageRecord` field names ✓
- Content-writer spread `{ ...safeResult, ...safeResult.pageFlow }` lifts `pages`, `edges`, `mermaid`, `stats`, `warnings` to top level for the template ✓
- Subagent JSON output (Task 7) matches `PageFlow` shape exactly: `pages[]`, `edges[]`, `mermaid`, `stats`, `warnings` ✓
- Screenshot path: subagent writes to `<screenshotDir>/${slug}.png`, sets `screenshot = page-flow/${slug}.png`; template renders as `<img src="/{{screenshot}}" />` → `/page-flow/${slug}.png` (Fumadocs serves `public/` at site root) ✓
