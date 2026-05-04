---
name: open-auto-doc
description: Generate a complete documentation site for the current repo using your Claude subscription (no API key needed). Produces architecture overviews, API references, component docs, data models, and a Fumadocs site. Hands off to Cowork for scheduled re-runs. Use when the user asks to "document this repo", "generate docs", "build a docs site", or invokes /open-auto-doc.
---

# open-auto-doc Skill

This skill orchestrates documentation generation for the user's current repo.
It dispatches parallel subagents to analyze the codebase, then calls into the
existing `@latent-space-labs/open-auto-doc` npm package to scaffold a
Fumadocs site and write MDX content.

The user does NOT need an Anthropic API key. All analysis runs as subagents
in this Claude Code session, on the user's plan.

## When to use

Trigger this skill when the user:
- Says "generate docs", "document this repo", "build a docs site"
- Invokes `/open-auto-doc`
- Asks to set up auto-updating documentation
- Asks about open-auto-doc and wants to actually run it (not just learn what it does)

Skip this skill when:
- The user explicitly wants the BYOK CLI flow (`open-auto-doc init` with API key)
- The user is asking conceptual questions about how documentation generators work
- The user is asking a read-only question about the codebase (e.g., "explain the architecture", "what does this do") with no request to generate or write files

## Modes

The skill supports two modes:

- **Interactive** (default) — prompts the user at decision points; shows an end-of-run menu.
- **Unattended** — invoked by Cowork routines. Skips all prompts. Auto-accepts safe defaults. Performs the configured `routineAction` on completion. Fails loud on ambiguity.

If the user (or invoking prompt) includes the word "unattended" or "scheduled" in their request, run in unattended mode.

## Process overview

1. Detect state in cwd
2. First-run scaffold (if needed)
3. Wave 1: dispatch architect subagent (blocking)
4. Wave 2: dispatch detail subagents in parallel (non-fatal)
5. Wave 3: dispatch guide-writer subagent (blocking)
6. Assemble JSON, write cache file
7. Generate MDX
8. End-of-run menu (skipped in unattended mode)
9. Cowork handoff (if user picks scheduling)

## Step 1: Detect state

Use Read to check for `.autodocrc.json` — first in cwd, then in `docs-site/.autodocrc.json` as a fallback. The scaffold command always writes to cwd, so this should be the common case.

- If found at either path: parse it. Note the `outputDir`, `repos[0].name`, and compute `<cacheDir> = <outputDir>/.autodoc-cache`. Proceed to Step 3 (skip first-run scaffold).
- If not found at either path: proceed to Step 2.

Use Bash `pwd` to capture the absolute cwd. Save it as `<repoPath>` for later steps. Save `<repoName>` from `repos[0].name` (re-run path) or wait for the scaffold output (first-run path).

## Step 2: First-run scaffold

In interactive mode, briefly tell the user what's about to happen ("I'll set up a Fumadocs site in `docs-site/` and analyze this repo").

Run:

```bash
npx @latent-space-labs/open-auto-doc scaffold -o docs-site
```

The command outputs a single JSON line on success: `{"ok":true,"outputDir":"...","cacheDir":"...","repoName":"..."}`. Parse it to capture `<outputDir>`, `<cacheDir>`, and `<repoName>`.

If the command fails: in interactive mode, surface the error to the user and stop. In unattended mode, exit non-zero with the error message so Cowork records the failure.

## Step 3: Wave 1 — architect subagent (required)

Read the prompt template from this skill's base directory:
`agents/architect.md`

Read the optional CLAUDE.md context from cwd:
- Glob `**/CLAUDE.md` in `<repoPath>` (limit 5 deep). For each, capture path + contents (cap each file at 8KB).

Dispatch ONE architect subagent via the Agent tool:

- `subagent_type`: `general-purpose`
- `description`: `"Analyze repo architecture"` (3-5 words)
- `prompt`: Concatenate:
  1. The `architect.md` body (everything after the frontmatter)
  2. `\n\n## Project context\n\nRepo path: <repoPath>\n\n` + the collected CLAUDE.md contents (each file with a header showing its path)
  3. `\n\nReturn your output as a single fenced JSON code block.`

Wait for the result. Parse the first JSON code block from the subagent's output.

**Failure handling:** If the architect subagent fails or returns invalid JSON:
- Interactive mode: tell the user "Architecture analysis failed — this is required. Stopping."  Show the error.
- Unattended mode: exit non-zero with a clear error message. The Cowork run will be marked failed.

Either way, do NOT continue. Architecture is required.

Save the parsed JSON as `<architectureResult>`.

## Step 4: Wave 2 — detail subagents (parallel, non-fatal)

Read all 7 Wave 2 prompt templates from this skill's base directory:
- `agents/api-doc.md`
- `agents/component-doc.md`
- `agents/model-doc.md`
- `agents/business-logic.md`
- `agents/features.md`
- `agents/error-doc.md`
- `agents/config-doc.md`

Dispatch the 7 subagents in two batches to stay within plan rate limits — first 4 in one message, then 3 in the next message after the first batch returns. Each subagent gets:

- `subagent_type`: `general-purpose`
- `description`: short imperative phrase per area (e.g., `"Document API endpoints"`)
- `prompt`: Concatenate:
  1. The corresponding prompt body
  2. `\n\n## Project context\n\nRepo path: <repoPath>\n\nArchitecture summary:\n` + the `summary`, `techStack`, `modules` (names only) from `<architectureResult>`
  3. The CLAUDE.md context collected in Step 3
  4. `\n\nReturn your output as a single fenced JSON code block.`

If you hit a rate limit even with batching, surface the error to the user and stop. Don't retry indefinitely.

For each result:
- Parse the first JSON code block.
- If parsing fails OR the subagent returned an error: log a warning, set that field to `null` (for nullable fields: features, configuration, businessLogic, errorHandling) or `[]` (for array fields: apiEndpoints, components, dataModels). Continue.

Save the parsed results as `<wave2Results>`, keyed by section name so Step 6 can dot-access them:

- `wave2Results.apiEndpoints` ← result from `agents/api-doc.md`
- `wave2Results.components` ← result from `agents/component-doc.md`
- `wave2Results.dataModels` ← result from `agents/model-doc.md`
- `wave2Results.businessLogic` ← result from `agents/business-logic.md`
- `wave2Results.features` ← result from `agents/features.md`
- `wave2Results.errorHandling` ← result from `agents/error-doc.md`
- `wave2Results.configuration` ← result from `agents/config-doc.md`

## Step 5: Wave 3 — guide-writer subagent

Read `agents/guide-writer.md`.

Dispatch ONE guide-writer subagent:

- `subagent_type`: `general-purpose`
- `description`: `"Write getting-started guide"`
- `prompt`: Concatenate:
  1. The `guide-writer.md` body
  2. `\n\n## Project context\n\nRepo path: <repoPath>\n\nArchitecture summary:\n` + the full `<architectureResult>` summary, techStack, entryPoints
  3. `\n\nReturn your output as a single fenced JSON code block.`

Wait, parse, save as `<gettingStartedResult>`. Failure is non-fatal — fall back to a placeholder:
```json
{ "prerequisites": [], "installation": "See README.", "quickStart": "See README." }
```

## Step 6: Assemble + write cache

Construct the full `AnalysisResult`:

```jsonc
{
  "repoName": "<repoName>",
  "repoUrl": "",
  "staticAnalysis": {
    "fileTree": { "path": ".", "name": "<repoName>", "type": "directory" },
    "languages": <architectureResult.techStack>,
    "dependencies": [],
    "claudeMd": <collected CLAUDE.md from Step 3>,
    "entryFiles": <architectureResult.entryPoints>,
    "totalFiles": 0
  },
  "architecture": <architectureResult>,
  "features": <wave2Results.features ?? null>,
  "apiEndpoints": <wave2Results.apiEndpoints ?? []>,
  "components": <wave2Results.components ?? []>,
  "dataModels": <wave2Results.dataModels ?? []>,
  "gettingStarted": <gettingStartedResult>,
  "diagrams": <architectureResult.diagrams>,
  "configuration": <wave2Results.configuration ?? null>,
  "businessLogic": <wave2Results.businessLogic ?? null>,
  "errorHandling": <wave2Results.errorHandling ?? null>
}
```

Write it to `<cacheDir>/<repoName>-analysis.json`. The file must wrap the result in cache metadata so `generate-from-json` accepts it:

```jsonc
{
  "version": 3,
  "commitSha": "<from `git rev-parse HEAD` in <repoPath>, or 'unknown' if not a git repo>",
  "timestamp": "<ISO 8601 now>",
  "result": { ... the AnalysisResult above ... }
}
```

Use Write tool to create the file.

## Step 7: Generate MDX

Run:

```bash
npx @latent-space-labs/open-auto-doc generate-from-json
```

Parse the JSON output: `{"ok":true,"outputDir":"...","repos":["..."]}`.

If it fails, surface the error to the user (interactive) or exit non-zero with the error (unattended). For v1, do not attempt to auto-fix MDX errors — the existing `mdx-fixer` agent in `packages/analyzer/src/agents/mdx-fixer.ts` is BYOK-only; porting that recovery loop into the skill is a follow-up.

## Step 8: End-of-run menu

**Skip this step entirely in unattended mode** — proceed to Step 9 if `routineAction` is set, otherwise just announce success.

Print a success message and offer the user 4 options:

```
Documentation generated! What next?

1. Preview locally — cd docs-site && npm install && npm run dev
2. Push to a hosted docs repo — runs `npx @latent-space-labs/open-auto-doc deploy`
3. Schedule re-runs with Cowork — sets up a routine
4. Done
```

Wait for user choice.

For option 2, run the Bash command and let the existing CLI take over.
For option 3, proceed to Step 9.
For option 1 or 4, exit cleanly.

## Step 9: Cowork handoff

Triggered by user choosing option 3 in the menu OR invoked directly when the user asks to schedule.

In interactive mode, ask:
- Cadence: daily / weekly (default) / monthly / custom cron
- After regen, what should happen? `none` (default) / `commit` / `push`
  - Only offer `push` if `<outputDir>/.git/config` exists with a remote (i.e., `git -C <outputDir> remote -v` returns non-empty).

Update `.autodocrc.json` to set `routineAction` to the user's choice:
- If the key already exists in the file, use Edit to replace its value.
- If the key is absent (older config), use Read to load the file, add the key with the chosen value, and use Write to overwrite the file.

Then invoke the schedule skill via the Skill tool:

```
skill: anthropic-skills:schedule
args: |
  Create a routine.
  Name: open-auto-doc-<repoName>
  Schedule: <cron-from-cadence>
  Prompt: |
    In the repo at <absolute-repoPath>, run the open-auto-doc skill in unattended mode.
    After regen, perform "<routineAction>" per .autodocrc.json.
    Do not prompt the user; auto-accept safe defaults; fail loud on ambiguity.
```

The schedule skill takes over from there. Confirm to the user when it returns.

## Unattended mode behavior

When invoked in unattended mode (e.g., from a Cowork routine):

1. Skip Step 8 (no end-of-run menu)
2. Read `routineAction` from `.autodocrc.json`. After Step 7 succeeds:
   - `none`: do nothing further, exit success
   - `commit`: run `git -C <repoPath> add <outputDir> && git -C <repoPath> commit -m "docs: auto-update via open-auto-doc"`. If the commit fails because nothing changed, that's also success.
   - `push`: same as commit, then run `git -C <outputDir> add . && git -C <outputDir> commit -m "docs: auto-update" && git -C <outputDir> push`. If the docs-site has no git config, fail with a clear message.
3. Exit with structured success/failure message — Cowork picks it up.

If anything is ambiguous (config malformed, routineAction missing, etc.), fail with a message — DO NOT prompt.

## Helpful patterns

- **Loading prompt files**: `agents/<name>.md` paths are relative to this skill's base directory. The runtime tells you the base directory at skill activation time. Resolve relative paths against it.
- **Parsing subagent JSON**: subagents return their result inside a fenced ```json ... ``` block. Extract the FIRST such block. If the subagent returned malformed JSON, log it and treat as a failure for that section. In unattended mode, accumulate warnings in a `sectionWarnings[]` array (e.g., `{section: "apiEndpoints", error: "..."}`) and include them in the final structured success/failure message so Cowork operators can diagnose missing sections.
- **Throttling**: dispatch Wave 2 in two batches by default — 4 + 3, not 7-at-once. If even those batches hit rate limits, fail loud — don't retry indefinitely.
- **Logging**: after each wave, briefly tell the interactive user what found ("Found 12 endpoints, 4 components"). Skip in unattended mode.
