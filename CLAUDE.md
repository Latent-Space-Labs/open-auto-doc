# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
npm run build          # Build all packages (analyzer → generator → cli)
npm run dev            # Watch mode for all packages
npm run clean          # Remove all dist/ directories
npm run local          # Run CLI locally: node packages/cli/dist/index.js init
npm run release -- patch|minor|major  # Bump version + git tag, then push with --tags
```

Build a single package:
```bash
npm run build -w packages/analyzer
npm run build -w packages/generator
npm run build -w packages/cli
```

To test the CLI locally after building:
```bash
node packages/cli/dist/index.js --help
# Or link globally:
cd packages/cli && npm link && open-auto-doc --help
```

There are no tests or linting configured in this project.

## Architecture

Monorepo with 3 npm workspace packages (+ site-template which is excluded from workspaces):

**`packages/analyzer`** — AI code analysis engine using `@anthropic-ai/claude-agent-sdk` (v0.2.x). Runs a multi-stage pipeline:
1. Static parsing (file tree, dependencies, CLAUDE.md, entry files, import graph)
2. Architecture agent (required — produces module analysis + Mermaid diagrams)
3. Parallel detail agents (API endpoints, components, data models — failures are non-fatal)
4. Getting started guide synthesis

**`packages/generator`** — Handlebars `.hbs` templates that render analysis results into MDX files, plus site scaffolding that copies `site-template` into user projects. Templates are in `templates/mdx/` and get copied to `dist/templates/mdx/` via tsup `onSuccess` hook.

**`packages/cli`** — Published as `@latent-space-labs/open-auto-doc`. Commander.js CLI with commands: init (default), generate, deploy, setup-ci, login, logout.

**`packages/site-template`** — Fumadocs v16 + Next.js + Tailwind v4 template. Not part of the workspace build. Contains `{{projectName}}` placeholders replaced during scaffolding. Uses CSS-first Tailwind config (no tailwind.config.ts).

## Agent SDK Patterns

All AI agents go through `runAgent()` in `packages/analyzer/src/agent-sdk.ts`:
- Uses `query()` from `@anthropic-ai/claude-agent-sdk`
- Read-only tools: `["Read", "Glob", "Grep"]`
- `permissionMode: "bypassPermissions"` for automated use
- Structured output via `outputFormat: { type: "json_schema", schema }`
- API key passed via `env: { ANTHROPIC_API_KEY }`, not constructor
- Results extracted from `message.structured_output` on `message.type === "result"` + `message.subtype === "success"`
- Auto-retry on `error_max_turns`: bumps maxTurns to 1.5x (capped at 60) with an efficiency-focused retry prompt
- Default model: `claude-sonnet-4-6`

Agent definitions live in `packages/analyzer/src/agents/` — each exports a function that builds a system prompt, defines a Zod schema, and calls `runAgent<T>()`.

## Key Dependencies

- `@anthropic-ai/claude-agent-sdk` ^0.2.63 — requires **Zod v4** as peer dependency
- `handlebars` — MDX template rendering
- `@clack/prompts` — CLI interactive prompts
- `@octokit/rest` + `@octokit/auth-oauth-device` — GitHub OAuth Device Flow auth
- `fs-extra` — file operations in generator and CLI

## Conventions

- ESM only (`"type": "module"`) — all imports use `.js` extensions
- tsup bundles each package (entry: `src/index.ts`, format: `esm`, dts: `true`)
- TypeScript strict mode, ES2022 target, bundler module resolution
- `process.setMaxListeners(50)` in pipeline.ts to handle parallel agent queries
- MDX content uses `escapeMdxOutsideCode()` helper to escape JSX-like syntax in generated docs
