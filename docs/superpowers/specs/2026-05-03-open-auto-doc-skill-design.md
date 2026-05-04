# open-auto-doc Claude Code Plugin — Design Spec

**Date:** 2026-05-03
**Status:** Draft, awaiting user review

## Overview

Add a Claude Code plugin to the open-auto-doc repo that lets users generate documentation using their Claude subscription instead of an Anthropic API key. The plugin ships a single skill (`open-auto-doc`) that orchestrates analysis via parallel subagents, calls into the existing generator package to write MDX, and hands off to Claude Cowork's scheduling skill for recurring re-runs.

## Goals

- Users can generate docs without supplying an Anthropic API key
- Skill runs entirely inside Claude Code, on the user's plan
- Cowork scheduling is offered as the recurring-update mechanism (replacing the GitHub Actions setup-ci flow for skill users)
- Existing BYOK CLI continues to work unchanged for non-skill users

## Non-Goals (v1)

- Multi-repo / cross-repo analysis from inside the skill (deferred to follow-up)
- GitHub OAuth and remote-repo selection inside the skill (skill operates on the cwd repo)
- Replacing or removing the existing CLI's interactive flows
- Marketplace listing / discoverability (manual install during initial iteration)

## Architecture

### File layout

```
.claude-plugin/
├── plugin.json
└── skills/
    └── open-auto-doc/
        ├── SKILL.md
        ├── agents/
        │   ├── architect.md
        │   ├── api-doc.md
        │   ├── component-doc.md
        │   ├── model-doc.md
        │   ├── business-logic.md
        │   ├── features.md
        │   ├── error-doc.md
        │   ├── config-doc.md
        │   └── guide-writer.md
        └── schemas/
            └── analysis-result.md
```

### Reuse vs new code

- **Reused as-is**: `packages/generator` (scaffolding, MDX writing, graph data), `packages/site-template` (the Next.js docs-site template), `packages/cli/src/commands/deploy.ts`, `packages/cli/src/commands/setup-mcp.ts`
- **New CLI subcommands** (called by the skill, not by users):
  - `packages/cli/src/commands/scaffold.ts` — non-interactive scaffold + write `.autodocrc.json`
  - `packages/cli/src/commands/generate-from-json.ts` — read `.autodoc-cache/<repo>-analysis.json`, run generator, write MDX
- **Replicated**: subagent prompts in `.claude-plugin/skills/open-auto-doc/agents/` mirror the system prompts from `packages/analyzer/src/agents/*.ts`. Two sources of truth — accepted tradeoff. A short note at the top of each subagent file points to its analyzer counterpart and reminds maintainers to keep them in sync.
- **Untouched**: existing `init`, `generate`, `login`, `logout`, `setup-ci` CLI commands continue to work for BYOK users

### Distribution

- Plugin lives in the open-auto-doc monorepo at `.claude-plugin/`
- Users install via local path during initial iteration; marketplace listing is a follow-up
- Skill ships with the repo, no separate publish step needed

## Skill Runtime Flow

### State detection

On invocation, the skill inspects cwd to determine path:

- No `.autodocrc.json` AND no `docs-site/` → first-run path
- `.autodocrc.json` present → re-run path (regenerate only)

### First-run path

1. Skill announces what it will do; confirms target repo with user (skipped in unattended mode)
2. Skill calls `npx @latent-space-labs/open-auto-doc scaffold` to:
   - Copy `packages/site-template/` contents into `docs-site/`
   - Replace `{{projectName}}` placeholders
   - Write `.autodocrc.json` with `{ outputDir: "docs-site", repos: [{ name, path: "." }], routineAction: "none" }`
3. Skill proceeds to analysis

### Analysis (wave-based subagent dispatch)

**Wave 1 — required, blocking:**

- `architect` subagent: returns `ArchitectureOverview` JSON

**Wave 2 — parallel, non-fatal (failures don't abort):**

Dispatched concurrently via the Agent tool, throttled to 4 at a time to avoid plan rate limits:

- `api-doc` → `ApiEndpoint[]`
- `component-doc` → `ComponentDoc[]`
- `model-doc` → `DataModelDoc[]`
- `business-logic` → `BusinessLogicAnalysis`
- `features` → `FeaturesAnalysis`
- `error-doc` → `ErrorHandlingAnalysis`
- `config-doc` → `ConfigurationAnalysis`

Each subagent runs as a `general-purpose` Agent with Read/Glob/Grep, returns JSON conforming to its schema. A subagent failure in Wave 2 is non-fatal: the missing section is omitted from the final docs.

**Wave 3 — depends on `architect` output (Wave 1):**

- `guide-writer` subagent: receives architecture summary + tech stack from Wave 1's result, returns `GettingStartedGuide`. Runs after Wave 2 completes (or fails) so its prompt can reference the full set of detected modules and patterns.

### Assembly & MDX generation

1. Skill assembles all subagent outputs into one `AnalysisResult` JSON (schema matches `packages/analyzer/src/types.ts`)
2. Writes the JSON to `docs-site/.autodoc-cache/<repo-name>-analysis.json`
3. Calls `npx @latent-space-labs/open-auto-doc generate-from-json` which uses `packages/generator` to write MDX into `docs-site/content/docs/<repo-name>/`
4. If MDX validation fails (existing logic in `packages/analyzer/src/agents/mdx-fixer.ts`), skill dispatches a recursive `mdx-fixer` subagent. Capped at 3 iterations.

### End-of-run menu

After successful generation, the skill presents the user with:

1. **Preview locally** — prints `cd docs-site && npm install && npm run dev`
2. **Push to hosted docs repo** — invokes existing `npx @latent-space-labs/open-auto-doc deploy`
3. **Schedule re-runs with Cowork** — see next section
4. **Done**

User picks one or several. In unattended mode, this menu is skipped entirely.

## Cowork Scheduling Handoff

When the user selects "Schedule re-runs with Cowork":

1. Skill asks for cadence; offers defaults: daily / weekly (default) / monthly / custom cron
2. Skill asks what the routine should do after regen:
   - **None** — just regenerate, leave changes uncommitted (default)
   - **Commit** — `git add docs-site/ && git commit -m "docs: auto-update"` in the source repo
   - **Push** — `cd docs-site && git add . && git commit -m "docs: auto-update" && git push`. Only offered if `docs-site/.git/config` exists with a configured remote (i.e., user has run the deploy step), since deploy is what turns `docs-site/` into its own git repo with a remote.
3. Skill writes the choice to `.autodocrc.json` as `routineAction`
4. Skill invokes the `anthropic-skills:schedule` skill via the Skill tool with arguments roughly:

   ```
   prompt: "In the repo at <absolute-cwd-path>, run the open-auto-doc skill in unattended mode. After regen, perform <routineAction> per .autodocrc.json. Do not prompt; auto-accept safe defaults; fail loud on ambiguity."
   schedule: <cron from cadence>
   name: open-auto-doc-<repo-name>
   ```

5. The schedule skill takes over and registers the routine with Cowork

### Unattended mode

The skill MUST support an "unattended" flag in its args. When set:

- Skip all interactive prompts; auto-pick safe defaults
- Skip the end-of-run menu; perform the configured `routineAction` directly
- Exit with structured success/failure
- Never prompt about ambiguity — instead fail with a clear, surfaceable message

This mode is what the Cowork routine invokes.

## Data Contracts

### `.autodocrc.json` (extended)

```json
{
  "outputDir": "docs-site",
  "repos": [{ "name": "my-repo", "path": "." }],
  "routineAction": "none" | "commit" | "push"
}
```

`routineAction` is a new field added for skill/Cowork use. Existing CLI flow ignores it.

### Subagent prompt format

Each `.claude-plugin/skills/open-auto-doc/agents/<name>.md` contains:

- Frontmatter: `description` (one-line summary used by the main skill to pick which subagent prompt to load)
- Section 1: Goal & expected output schema (JSON shape)
- Section 2: Investigation guidance — which files to read, patterns to look for. Mirrors the existing system prompts in `packages/analyzer/src/agents/*.ts`.
- Section 3: Output format example

The main skill dispatches each subagent with a prompt that injects:

- Repo path (cwd)
- Optional CLAUDE.md content (from the cwd's CLAUDE.md and any nested ones)
- The schema reference

## Error Handling

| Failure | Behavior |
|---|---|
| Architect subagent fails | Abort — architecture is required. Surface error to user. |
| Wave 2 detail subagent fails | Continue. Mark section as omitted in final docs. Log warning. |
| MDX generation produces syntax errors | Run mdx-fixer subagent. Cap at 3 iterations. If still failing, surface partial docs + error. |
| Plan rate-limit hit during analysis | Skill detects, pauses 30s, retries Wave 2 batches in groups of 2-3. If persistent, instruct user to retry later. |
| `.autodocrc.json` malformed on re-run | Treat as first-run; back up the malformed file with `.bak` suffix. |
| Routine fires but skill exits non-zero in unattended mode | Schedule skill records the failure; user is notified per Cowork's standard alert flow. |
| User invokes deploy menu but no docs repo configured | Skill walks user through deploy via the existing CLI; does not try to handle deploy setup itself. |

## Testing

This repo has no test infrastructure today (per CLAUDE.md). Verification is manual:

- Run skill in a test repo with no `.autodocrc.json` → verify scaffold + analyze + MDX written
- Run skill in a repo with existing `.autodocrc.json` → verify re-run path
- Inject a deliberate MDX error in a template → verify mdx-fixer recovery within 3 iterations
- Mock-fail an architect subagent → verify abort behavior
- Mock-fail a Wave 2 subagent → verify non-fatal continuation
- Invoke skill in unattended mode → verify no prompts, structured exit code
- End-to-end Cowork: schedule a routine, verify it fires and regenerates correctly

## Open Decisions (resolve during implementation)

- **Plugin manifest schema** — confirm exact `plugin.json` shape required by Claude Code's plugin loader
- **Subagent dispatch concurrency cap** — default 4 parallel, but the right number depends on plan rate limits in practice
- **Cowork unattended-mode failure surfacing** — depends on Cowork's notification primitives, design when implementing the handoff
