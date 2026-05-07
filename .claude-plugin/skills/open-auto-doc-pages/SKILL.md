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
