# open-auto-doc Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code plugin in this repo that lets users generate docs on their Claude subscription (no API key) and hand off to Cowork for scheduled re-runs.

**Architecture:** Add a `.claude-plugin/` directory with a single `open-auto-doc` skill. The skill orchestrates analysis via parallel subagents (Agent tool, `general-purpose` type) instead of the existing SDK-based pipeline. Two new non-interactive CLI subcommands (`scaffold`, `generate-from-json`) provide plumbing the skill calls via `npx`. Existing CLI commands and BYOK flow are untouched.

**Tech Stack:** TypeScript (ESM, strict), tsup, Commander.js, fs-extra, the existing `@latent-space-labs/auto-doc-generator` package. No new runtime dependencies.

**Spec reference:** [`docs/superpowers/specs/2026-05-03-open-auto-doc-skill-design.md`](../specs/2026-05-03-open-auto-doc-skill-design.md)

**Note on testing:** This repo has no test infrastructure (per `CLAUDE.md`). Per project conventions, verification steps run `npm run build` and exercise the CLI/skill manually rather than writing automated tests.

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `packages/cli/src/config.ts` | Config types and load/save | Modify (add `routineAction`, loosen optional fields) |
| `packages/cli/src/commands/scaffold.ts` | Non-interactive scaffold + write `.autodocrc.json` | Create |
| `packages/cli/src/commands/generate-from-json.ts` | Read cache JSON → run generator → write MDX | Create |
| `packages/cli/src/index.ts` | Register subcommands | Modify (add 2 subcommands) |
| `.claude-plugin/plugin.json` | Plugin manifest | Create |
| `.claude-plugin/skills/open-auto-doc/SKILL.md` | Skill orchestrator | Create |
| `.claude-plugin/skills/open-auto-doc/schemas/analysis-result.md` | Output schema reference | Create |
| `.claude-plugin/skills/open-auto-doc/agents/architect.md` | Wave 1 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/guide-writer.md` | Wave 3 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/api-doc.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/component-doc.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/model-doc.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/business-logic.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/features.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/error-doc.md` | Wave 2 subagent prompt | Create |
| `.claude-plugin/skills/open-auto-doc/agents/config-doc.md` | Wave 2 subagent prompt | Create |

---

### Task 1: Extend `AutodocConfig` for skill use

**Files:**
- Modify: `packages/cli/src/config.ts:4-19`

- [ ] **Step 1: Loosen required fields and add `routineAction`**

Replace the entire `AutodocConfig` interface with:

```typescript
export interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName?: string;     // optional: skill-mode local repos may not have a GitHub fullname
    cloneUrl?: string;     // optional: skill-mode local repos may not have a remote
    htmlUrl?: string;      // optional: skill-mode local repos may not have a remote
    path?: string;         // new: absolute or relative local path (skill mode uses ".")
  }>;
  outputDir: string;
  projectName?: string;
  docsRepo?: string;
  docsRepoOwner?: string;
  docsRepoName?: string;
  vercelUrl?: string;
  ciEnabled?: boolean;
  ciBranch?: string;
  routineAction?: "none" | "commit" | "push";  // new: Cowork routine post-regen behavior
}
```

The optional `fullName`/`cloneUrl`/`htmlUrl` fields preserve backwards compat: existing CLI flow still populates them; skill flow leaves them empty.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build -w packages/cli`
Expected: build succeeds, no type errors. If consumers (e.g., `init.ts`, `generate.ts`, `deploy.ts`) reference `repo.fullName`/`cloneUrl`/`htmlUrl` and now flag them as possibly undefined, leave that for Task 2 fix-up since those paths aren't reached in skill mode.

If a real consumer breaks, narrow the issue with: `npm run build 2>&1 | head -50`. Add `if (!repo.cloneUrl) throw new Error(...)` guards at the entry of each consumer function so existing CLI paths fail loud, but skill mode (which never enters those paths) is unaffected.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/config.ts
git commit -m "feat(cli): extend AutodocConfig with routineAction and optional GitHub fields"
```

---

### Task 2: Add `scaffold` CLI subcommand

**Files:**
- Create: `packages/cli/src/commands/scaffold.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create the scaffold command**

Create `packages/cli/src/commands/scaffold.ts` with:

```typescript
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scaffoldSite } from "@latent-space-labs/auto-doc-generator";
import { saveConfig } from "../config.js";
import type { AutodocConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ScaffoldOptions {
  output?: string;
  name?: string;
  repoPath?: string;
}

export async function scaffoldCommand(options: ScaffoldOptions) {
  const repoPath = path.resolve(options.repoPath || ".");
  const outputDir = path.resolve(options.output || "docs-site");
  const projectName = options.name || path.basename(repoPath);

  if (!fs.existsSync(repoPath)) {
    console.error(`Repo path does not exist: ${repoPath}`);
    process.exit(1);
  }

  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(path.join(templateDir, "package.json"))) {
    console.error(`Site template not found at: ${templateDir}`);
    process.exit(1);
  }

  // Detect git remote (best-effort; skill mode tolerates absence)
  const remote = detectGitRemote(repoPath);

  // Scaffold site
  const cliVersion = getCliVersion();
  await scaffoldSite(outputDir, projectName, templateDir, cliVersion);

  // Write config
  const config: AutodocConfig = {
    repos: [{
      name: path.basename(repoPath),
      ...(remote?.fullName && { fullName: remote.fullName }),
      ...(remote?.cloneUrl && { cloneUrl: remote.cloneUrl }),
      ...(remote?.htmlUrl && { htmlUrl: remote.htmlUrl }),
      path: repoPath,
    }],
    outputDir,
    projectName,
    routineAction: "none",
  };
  saveConfig(config);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    cacheDir: path.join(outputDir, ".autodoc-cache"),
    repoName: path.basename(repoPath),
  }));
}

function detectGitRemote(repoPath: string): { fullName?: string; cloneUrl?: string; htmlUrl?: string } | null {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();

    if (!url) return null;

    // Match git@github.com:owner/repo.git OR https://github.com/owner/repo.git
    const match = url.match(/[:\/]([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
    if (!match) return { cloneUrl: url };

    const [, owner, repo] = match;
    return {
      fullName: `${owner}/${repo}`,
      cloneUrl: url,
      htmlUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

function resolveTemplateDir(): string {
  const candidates = [
    path.resolve(__dirname, "site-template"),
    path.resolve(__dirname, "../../site-template"),
    path.resolve(__dirname, "../../../site-template"),
    path.resolve(__dirname, "../../../../packages/site-template"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(__dirname, "site-template");
}

function getCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    }
    const monoPkgPath = path.resolve(__dirname, "../../package.json");
    if (fs.existsSync(monoPkgPath)) {
      return JSON.parse(fs.readFileSync(monoPkgPath, "utf-8")).version;
    }
  } catch {}
  return "0.0.0";
}
```

The command emits a single JSON line on success (so the skill can parse the result) instead of `@clack/prompts` UI.

- [ ] **Step 2: Wire into the CLI**

Modify `packages/cli/src/index.ts` — add the import and registration:

```typescript
// Add this import next to the others:
import { scaffoldCommand } from "./commands/scaffold.js";

// Add this command registration before `program.parse()`:
program
  .command("scaffold")
  .description("Non-interactive scaffold + .autodocrc.json. Used by the open-auto-doc skill.")
  .option("-o, --output <dir>", "Output directory", "docs-site")
  .option("-n, --name <name>", "Project name (defaults to repo dir name)")
  .option("-p, --repo-path <path>", "Repo path to document (defaults to cwd)", ".")
  .action(scaffoldCommand);
```

- [ ] **Step 3: Build and verify**

Run: `npm run build -w packages/cli`
Expected: build succeeds.

Run: `node packages/cli/dist/index.js scaffold --help`
Expected: shows the scaffold help text.

- [ ] **Step 4: Smoke-test in a tmp directory**

```bash
mkdir -p /tmp/scaffold-test && cd /tmp/scaffold-test
node /Users/bryan/Code/lsl/open-auto-doc/.claude/worktrees/goofy-williams-de2afb/packages/cli/dist/index.js scaffold -o docs-site
ls docs-site && cat .autodocrc.json
cd - && rm -rf /tmp/scaffold-test
```

Expected: `docs-site/` is created with the Fumadocs template, `.autodocrc.json` contains a single repo entry. The scaffold command exits with `{ "ok": true, ... }` on stdout.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/scaffold.ts packages/cli/src/index.ts
git commit -m "feat(cli): add scaffold subcommand for non-interactive docs-site setup"
```

---

### Task 3: Add `generate-from-json` CLI subcommand

**Files:**
- Create: `packages/cli/src/commands/generate-from-json.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create the command**

Create `packages/cli/src/commands/generate-from-json.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";
import type { AnalysisResult } from "@latent-space-labs/auto-doc-analyzer";

interface GenerateFromJsonOptions {
  cacheDir?: string;
  outputDir?: string;
}

export async function generateFromJsonCommand(options: GenerateFromJsonOptions) {
  const config = loadConfig();
  if (!config && !options.outputDir) {
    console.error("No .autodocrc.json found and no --output-dir provided.");
    process.exit(1);
  }

  const outputDir = path.resolve(options.outputDir || config!.outputDir);
  const cacheDir = options.cacheDir
    ? path.resolve(options.cacheDir)
    : path.join(outputDir, ".autodoc-cache");

  if (!fs.existsSync(cacheDir)) {
    console.error(`Cache directory does not exist: ${cacheDir}`);
    process.exit(1);
  }

  // Load all *-analysis.json files
  const cacheFiles = fs.readdirSync(cacheDir).filter((f) => f.endsWith("-analysis.json"));
  if (cacheFiles.length === 0) {
    console.error(`No analysis JSON files found in ${cacheDir}`);
    process.exit(1);
  }

  const results: AnalysisResult[] = [];
  for (const file of cacheFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf-8"));
      // Cache files have shape { version, commitSha, timestamp, result } OR are bare AnalysisResult
      const result: AnalysisResult = raw.result ?? raw;
      results.push(result);
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (results.length === 0) {
    console.error("No valid analysis results loaded.");
    process.exit(1);
  }

  // Write content
  const contentDir = path.join(outputDir, "content", "docs");
  await writeContent(contentDir, results, undefined, undefined, {});
  await writeMeta(contentDir, results, undefined);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    repos: results.map((r) => r.repoName),
  }));
}
```

This command intentionally skips the cross-repo analysis (single-repo only for v1 per spec) and skips changelogs (no previous-vs-current diff in skill mode yet).

- [ ] **Step 2: Wire into the CLI**

Add to `packages/cli/src/index.ts`:

```typescript
// Import alongside scaffold:
import { generateFromJsonCommand } from "./commands/generate-from-json.js";

// Register before program.parse():
program
  .command("generate-from-json")
  .description("Read .autodoc-cache/*.json → run generator → write MDX. Used by the open-auto-doc skill.")
  .option("-c, --cache-dir <path>", "Cache directory (defaults to <outputDir>/.autodoc-cache)")
  .option("-o, --output-dir <path>", "Output directory (defaults to .autodocrc.json outputDir)")
  .action(generateFromJsonCommand);
```

- [ ] **Step 3: Build and verify**

Run: `npm run build -w packages/cli`
Expected: build succeeds.

Run: `node packages/cli/dist/index.js generate-from-json --help`
Expected: shows the command help.

- [ ] **Step 4: Smoke test (requires Task 2's scaffold output + a fake cache file)**

```bash
mkdir -p /tmp/genfromjson-test && cd /tmp/genfromjson-test
node /Users/bryan/Code/lsl/open-auto-doc/.claude/worktrees/goofy-williams-de2afb/packages/cli/dist/index.js scaffold -o docs-site -n "Test"
mkdir -p docs-site/.autodoc-cache
# Drop a minimal fake AnalysisResult so generate-from-json has something to chew on:
cat > docs-site/.autodoc-cache/test-analysis.json <<'EOF'
{
  "version": 3,
  "commitSha": "abc123",
  "timestamp": "2026-05-03T00:00:00Z",
  "result": {
    "repoName": "test",
    "repoUrl": "",
    "staticAnalysis": { "fileTree": { "path": ".", "name": "test", "type": "directory" }, "languages": ["typescript"], "dependencies": [], "claudeMd": [], "entryFiles": [], "totalFiles": 0 },
    "architecture": { "summary": "Test repo.", "projectPurpose": "Testing.", "targetAudience": "Devs.", "techStack": ["TypeScript"], "modules": [], "dataFlow": "n/a", "entryPoints": [], "keyPatterns": [], "diagrams": [] },
    "features": null,
    "apiEndpoints": [],
    "components": [],
    "dataModels": [],
    "gettingStarted": { "prerequisites": [], "installation": "n/a", "quickStart": "n/a" },
    "diagrams": [],
    "configuration": null,
    "businessLogic": null,
    "errorHandling": null
  }
}
EOF
node /Users/bryan/Code/lsl/open-auto-doc/.claude/worktrees/goofy-williams-de2afb/packages/cli/dist/index.js generate-from-json
ls docs-site/content/docs/
cd - && rm -rf /tmp/genfromjson-test
```

Expected: `docs-site/content/docs/test/` exists with at least an `index.mdx`. Command prints `{ "ok": true, ... }` to stdout.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/generate-from-json.ts packages/cli/src/index.ts
git commit -m "feat(cli): add generate-from-json subcommand for skill-mode MDX generation"
```

---

### Task 4: Create plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Write the manifest**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "open-auto-doc",
  "version": "0.1.0",
  "description": "AI-powered documentation generator that runs on your Claude subscription. Generates Fumadocs sites from any repo and integrates with Cowork for scheduled re-runs.",
  "author": {
    "name": "Latent Space Labs",
    "url": "https://github.com/Latent-Space-Labs"
  },
  "homepage": "https://github.com/Latent-Space-Labs/open-auto-doc",
  "repository": "https://github.com/Latent-Space-Labs/open-auto-doc",
  "license": "MIT",
  "keywords": ["documentation", "fumadocs", "claude-code", "cowork"]
}
```

This is the minimum manifest. Skills are auto-discovered from the `skills/` subdirectory, no explicit declaration needed.

- [ ] **Step 2: Verify location**

Run: `ls -la .claude-plugin/`
Expected: `plugin.json` present.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat(plugin): add Claude Code plugin manifest"
```

---

### Task 5: Create the schema reference file

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc/schemas/analysis-result.md`

- [ ] **Step 1: Write the schema reference**

This file documents the JSON shape each subagent must return. The main skill loads it once; each subagent prompt links to its relevant section.

Create `.claude-plugin/skills/open-auto-doc/schemas/analysis-result.md`:

````markdown
# AnalysisResult Schema

This is the canonical JSON shape that subagents return. The main skill assembles
the per-section outputs into a single `AnalysisResult` object and writes it to
`<outputDir>/.autodoc-cache/<repo-slug>-analysis.json` for the generator package
to consume.

The authoritative TypeScript types live at `packages/analyzer/src/types.ts` —
keep this file in sync if those change.

## Top-level shape

```jsonc
{
  "repoName": "string — slugified directory or repo name",
  "repoUrl": "string — GitHub URL if available, else empty string",
  "staticAnalysis": {
    "fileTree": { "path": ".", "name": "repo", "type": "directory", "children": [] },
    "languages": ["typescript", "..."],
    "dependencies": [],
    "claudeMd": [{ "path": "CLAUDE.md", "content": "..." }],
    "entryFiles": ["src/index.ts"],
    "totalFiles": 0
  },
  "architecture":   /* ArchitectureOverview, see architect.md */,
  "features":       /* FeaturesAnalysis | null, see features.md */,
  "apiEndpoints":   /* ApiEndpoint[],         see api-doc.md */,
  "components":     /* ComponentDoc[],        see component-doc.md */,
  "dataModels":     /* DataModelDoc[],        see model-doc.md */,
  "gettingStarted": /* GettingStartedGuide,   see guide-writer.md */,
  "diagrams":       [/* MermaidDiagram[] — pulled from architecture.diagrams */],
  "configuration":  /* ConfigurationAnalysis | null, see config-doc.md */,
  "businessLogic":  /* BusinessLogicAnalysis | null, see business-logic.md */,
  "errorHandling":  /* ErrorHandlingAnalysis | null, see error-doc.md */
}
```

## ArchitectureOverview (Wave 1, required)

```jsonc
{
  "summary": "2-3 paragraph description of the project",
  "projectPurpose": "1-2 paragraph plain-language description for someone new",
  "targetAudience": "Who would use this software and why",
  "techStack": ["TypeScript", "Next.js", "..."],
  "modules": [
    {
      "name": "string",
      "description": "string",
      "files": ["string"],
      "responsibilities": ["string"]
    }
  ],
  "dataFlow": "string — how data flows through the system",
  "entryPoints": ["string — file paths"],
  "keyPatterns": ["string — architectural patterns"],
  "diagrams": [
    {
      "id": "string — kebab-case",
      "title": "string",
      "description": "string",
      "mermaidSyntax": "string — valid Mermaid"
    }
  ]
}
```

## ApiEndpoint[] (Wave 2)

```jsonc
[
  {
    "method": "GET | POST | PUT | DELETE | PATCH",
    "path": "/api/...",
    "description": "string",
    "parameters": [
      {
        "name": "string",
        "type": "string",
        "required": true,
        "description": "string",
        "location": "path | query | header | body"
      }
    ],
    "requestBody": "string — optional",
    "responseBody": "string — optional",
    "authentication": "string — optional"
  }
]
```

## ComponentDoc[] (Wave 2)

```jsonc
[
  {
    "name": "string",
    "description": "string",
    "filePath": "string",
    "props": [
      {
        "name": "string",
        "type": "string",
        "required": true,
        "defaultValue": "string — optional",
        "description": "string"
      }
    ],
    "usage": "string — example code",
    "category": "string — optional grouping"
  }
]
```

## DataModelDoc[] (Wave 2)

```jsonc
[
  {
    "name": "string",
    "description": "string",
    "filePath": "string",
    "fields": [
      {
        "name": "string",
        "type": "string",
        "description": "string",
        "constraints": ["string — optional"]
      }
    ],
    "relationships": ["string"]
  }
]
```

## FeaturesAnalysis (Wave 2)

```jsonc
{
  "tagline": "string",
  "targetAudience": "string",
  "features": [
    {
      "name": "string",
      "description": "string",
      "category": "string",
      "relatedFiles": ["string"]
    }
  ],
  "useCases": [
    {
      "title": "string",
      "description": "string",
      "involvedFeatures": ["string"]
    }
  ]
}
```

## ConfigurationAnalysis (Wave 2)

```jsonc
{
  "configItems": [
    {
      "name": "string",
      "source": "string — file path or env",
      "type": "string",
      "defaultValue": "string — optional",
      "required": true,
      "description": "string",
      "category": "string — optional"
    }
  ],
  "configFiles": ["string"],
  "environmentVariables": ["string"]
}
```

## BusinessLogicAnalysis (Wave 2)

```jsonc
{
  "domainConcepts": [
    { "name": "string", "description": "string", "relatedFiles": ["string"] }
  ],
  "businessRules": [
    { "name": "string", "description": "string", "sourceFiles": ["string"], "category": "string — optional" }
  ],
  "workflows": [
    {
      "name": "string",
      "description": "string",
      "steps": ["string"],
      "diagram": { "id": "string", "title": "string", "description": "string", "mermaidSyntax": "string" }
    }
  ],
  "keyInvariants": ["string"]
}
```

## ErrorHandlingAnalysis (Wave 2)

```jsonc
{
  "errorCodes": [
    {
      "code": "string",
      "httpStatus": 404,
      "message": "string",
      "description": "string",
      "sourceFile": "string — optional"
    }
  ],
  "commonErrors": [
    { "error": "string", "cause": "string", "solution": "string", "category": "string — optional" }
  ],
  "errorClasses": ["string"],
  "debuggingTips": ["string"]
}
```

## GettingStartedGuide (Wave 3)

```jsonc
{
  "prerequisites": ["string"],
  "installation": "string — markdown",
  "quickStart": "string — markdown",
  "configuration": "string — optional markdown",
  "examples": "string — optional markdown"
}
```

## Subagent output convention

Every subagent MUST return its result as a single fenced JSON code block, with
no prose before or after:

````markdown
```json
{ ... }
```
````

The main skill parses the first JSON block from each subagent's output. If a
subagent fails to produce valid JSON, the main skill marks that section as
`null` (for nullable fields) or `[]` (for array fields) and continues.
````

- [ ] **Step 2: Verify file exists and renders**

Run: `cat .claude-plugin/skills/open-auto-doc/schemas/analysis-result.md | head -30`
Expected: file content shows the AnalysisResult Schema heading.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/schemas/analysis-result.md
git commit -m "feat(plugin): add AnalysisResult schema reference"
```

---

### Task 6: Create Wave 1 + Wave 3 subagent prompts

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc/agents/architect.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/guide-writer.md`

- [ ] **Step 1: Create architect prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/architect.md`:

````markdown
---
description: Wave 1 subagent. Analyzes overall architecture, produces ArchitectureOverview JSON. Required — its output blocks Wave 2 + Wave 3 dispatch.
---

# Architect subagent prompt

You are a senior software architect analyzing a codebase. Your job is to produce
a structured JSON description of this project's architecture, suitable for
generating documentation.

## Your task

Investigate the repo at the path provided. Use Glob to discover structure, Read
to examine key files, Grep to find patterns. Then produce `ArchitectureOverview`
JSON matching the schema below.

## Investigation guidance

Start with:
- `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml` / `pyproject.toml` to identify language and dependencies
- `README.md` for stated purpose
- Any `CLAUDE.md` files for project-specific context (these are gold — read them all)
- `tsconfig.json`, build tool configs, framework configs
- Entry files (e.g., `src/index.ts`, `main.py`, `cmd/`)
- Top-level directory layout to identify modules

For each module you identify, list its files (at most 8 representative files —
not exhaustive), describe its responsibilities, and note dependencies between
modules.

## Output schema

Match this shape exactly. Required fields cannot be omitted:

```jsonc
{
  "summary": "2-3 paragraph description of the project",
  "projectPurpose": "1-2 paragraph plain-language description for a stranger",
  "targetAudience": "Who uses this and why",
  "techStack": ["string", "..."],
  "modules": [
    {
      "name": "string",
      "description": "string",
      "files": ["string"],
      "responsibilities": ["string"]
    }
  ],
  "dataFlow": "string — how data moves through the system",
  "entryPoints": ["string"],
  "keyPatterns": ["string — architectural patterns observed"],
  "diagrams": [
    {
      "id": "string — kebab-case",
      "title": "string",
      "description": "string",
      "mermaidSyntax": "string — valid Mermaid"
    }
  ]
}
```

## Diagram requirements

You MUST produce at least two diagrams:

1. **Architecture overview** — `id: "architecture-overview"`, use `graph TD`, show modules and their connections
2. **Data flow** — `id: "data-flow"`, use `flowchart LR`, show how data moves through the system

Each `mermaidSyntax` must be valid, render-ready Mermaid (no surrounding fences,
no language tags — just the Mermaid source).

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "summary": "...", "projectPurpose": "...", ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/architect.ts`. Keep them in
sync when prompts evolve.
````

- [ ] **Step 2: Create guide-writer prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/guide-writer.md`:

````markdown
---
description: Wave 3 subagent. Synthesizes a getting-started guide from architecture + tech stack. Runs after Wave 1 completes; output is GettingStartedGuide JSON.
---

# Guide-writer subagent prompt

You are a technical writer producing a getting-started guide for a project.

## Your task

Given the project's architecture summary, tech stack, and entry points (provided
by the dispatching skill), produce a `GettingStartedGuide` JSON with concrete,
copy-paste-ready instructions.

## Investigation guidance

Use Read/Glob to verify install steps. Look for:
- `package.json` scripts (`dev`, `start`, `build`)
- README install instructions
- `Dockerfile` or `docker-compose.yml` for containerized setups
- Environment variable examples (`.env.example`)
- Test commands

If the project requires environment variables, list them in prerequisites.

## Output schema

```jsonc
{
  "prerequisites": ["string — e.g., 'Node.js 18+', 'Docker'"],
  "installation": "string — markdown with code blocks",
  "quickStart": "string — markdown with the minimal hello-world flow",
  "configuration": "string — optional markdown for config options",
  "examples": "string — optional markdown for example usage"
}
```

The `installation`, `quickStart`, `configuration`, and `examples` fields are
markdown strings. Use fenced code blocks inside them where appropriate.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "prerequisites": [...], "installation": "...", ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/guide-writer.ts`. Keep them in
sync.
````

- [ ] **Step 3: Verify**

Run: `ls .claude-plugin/skills/open-auto-doc/agents/`
Expected: `architect.md` and `guide-writer.md` present.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/agents/architect.md .claude-plugin/skills/open-auto-doc/agents/guide-writer.md
git commit -m "feat(plugin): add Wave 1 + Wave 3 subagent prompts"
```

---

### Task 7: Create Wave 2 subagent prompts (part A — code structure)

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc/agents/api-doc.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/component-doc.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/model-doc.md`

- [ ] **Step 1: Create api-doc prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/api-doc.md`:

````markdown
---
description: Wave 2 subagent. Finds and documents API endpoints. Returns ApiEndpoint[] JSON. Failure is non-fatal.
---

# API documentation subagent prompt

You are an API documentation expert. Find every HTTP endpoint in this codebase
and document each one in detail.

## Investigation guidance

Use Glob to find route/controller/handler files: `**/routes/**`, `**/api/**`,
`**/controllers/**`, `**/handlers/**`, `**/endpoints/**`.

Use Grep for HTTP method patterns:
- Express/Koa: `app.get(`, `router.post(`, `route.put(`, `.delete(`
- Next.js App Router: `export async function GET`, `export async function POST`
- FastAPI: `@app.get`, `@app.post`, `@router.get`
- Spring: `@GetMapping`, `@PostMapping`, `@RequestMapping`
- Go: `http.HandleFunc`, `r.GET`, `r.POST`
- Rails: `routes.rb`, `resources :foo`

Use Read to examine each file and extract endpoint details: HTTP method, path
template, parameters, request/response shape, authentication requirements.

## Output schema

```jsonc
[
  {
    "method": "GET | POST | PUT | DELETE | PATCH",
    "path": "/api/v1/users/:id",
    "description": "string",
    "parameters": [
      {
        "name": "string",
        "type": "string",
        "required": true,
        "description": "string",
        "location": "path | query | header | body"
      }
    ],
    "requestBody": "string — optional",
    "responseBody": "string — optional",
    "authentication": "string — optional"
  }
]
```

If no endpoints exist (e.g., this is a frontend-only repo or library), return
an empty array `[]`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
[ { "method": "GET", ... } ]
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/api-doc.ts`. Keep in sync.
````

- [ ] **Step 2: Create component-doc prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/component-doc.md`:

````markdown
---
description: Wave 2 subagent. Documents UI components (props, usage). Returns ComponentDoc[] JSON. Failure is non-fatal.
---

# Component documentation subagent prompt

You are a UI documentation specialist. Find every reusable UI component in this
codebase and document its API.

## Investigation guidance

Use Glob: `**/components/**/*.{tsx,jsx,vue,svelte}`, `**/ui/**/*.{tsx,jsx}`,
`**/lib/components/**`.

For each component file:
- Extract the component name (from default/named export)
- Find its props interface/type (TypeScript) or `propTypes` (JS)
- Identify default values
- Read JSDoc comments for descriptions
- Note the file path

Skip components that are clearly internal/private (file starts with `_`,
component name starts with `_`, or marked as private in JSDoc).

## Output schema

```jsonc
[
  {
    "name": "Button",
    "description": "Primary call-to-action button with variants",
    "filePath": "src/components/Button.tsx",
    "props": [
      {
        "name": "variant",
        "type": "'primary' | 'secondary'",
        "required": false,
        "defaultValue": "'primary'",
        "description": "Visual style variant"
      }
    ],
    "usage": "<Button variant=\"primary\" onClick={handleClick}>Click me</Button>",
    "category": "Inputs"
  }
]
```

If no components exist (e.g., this is a backend-only repo), return `[]`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
[ { "name": "Button", ... } ]
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/component-doc.ts`. Keep in sync.
````

- [ ] **Step 3: Create model-doc prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/model-doc.md`:

````markdown
---
description: Wave 2 subagent. Documents data models / schemas. Returns DataModelDoc[] JSON. Failure is non-fatal.
---

# Data model documentation subagent prompt

You are a data modeling expert. Find every persistent data model / schema in
this codebase and document its fields, types, constraints, and relationships.

## Investigation guidance

Look for:
- Prisma: `schema.prisma`
- Drizzle: `*/schema.ts` with `pgTable` / `mysqlTable` / `sqliteTable`
- TypeORM: `@Entity` decorators
- Sequelize: `Model.init()` calls
- Mongoose: `mongoose.Schema(...)`
- SQLAlchemy: classes inheriting `Base`
- Django: `models.Model` subclasses
- Pydantic: `BaseModel` subclasses
- Plain TypeScript: `interface User` / `type Order` in `**/models/**` or `**/types/**`
- GraphQL: `*.graphql` schemas

Use Grep to find schema definitions, then Read to extract field details.

## Output schema

```jsonc
[
  {
    "name": "User",
    "description": "Application user account",
    "filePath": "src/models/user.ts",
    "fields": [
      {
        "name": "id",
        "type": "uuid",
        "description": "Primary key",
        "constraints": ["PRIMARY KEY", "NOT NULL"]
      }
    ],
    "relationships": ["hasMany Posts via author_id"]
  }
]
```

If no data models exist, return `[]`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
[ { "name": "User", ... } ]
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/model-doc.ts`. Keep in sync.
````

- [ ] **Step 4: Verify**

Run: `ls .claude-plugin/skills/open-auto-doc/agents/`
Expected: `api-doc.md`, `component-doc.md`, `model-doc.md` (plus the two from Task 6).

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/agents/api-doc.md .claude-plugin/skills/open-auto-doc/agents/component-doc.md .claude-plugin/skills/open-auto-doc/agents/model-doc.md
git commit -m "feat(plugin): add Wave 2 code-structure subagent prompts"
```

---

### Task 8: Create Wave 2 subagent prompts (part B — semantic)

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc/agents/business-logic.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/features.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/error-doc.md`
- Create: `.claude-plugin/skills/open-auto-doc/agents/config-doc.md`

- [ ] **Step 1: Create business-logic prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/business-logic.md`:

````markdown
---
description: Wave 2 subagent. Identifies domain concepts, business rules, workflows. Returns BusinessLogicAnalysis JSON. Failure is non-fatal.
---

# Business logic subagent prompt

You are a domain modeling expert. Identify the core business concepts, rules,
and workflows that define this system's behavior — not the technical
implementation.

## Investigation guidance

Look for the WHY, not the HOW. Read:
- Comments and docstrings that explain rules ("must be", "cannot", "only if")
- Validation logic (e.g., "balance >= amount", "user.isAdmin")
- State machines / status enums
- Service classes that orchestrate multi-step operations
- Domain-driven design folders (`domain/`, `entities/`, `services/`)
- Tests that document expected behavior

Capture the *invariants* — things that must always be true.

## Output schema

```jsonc
{
  "domainConcepts": [
    { "name": "Order", "description": "A customer purchase request", "relatedFiles": ["src/order/order.ts"] }
  ],
  "businessRules": [
    { "name": "OrderCannotShipBeforePayment", "description": "...", "sourceFiles": ["..."], "category": "Order Lifecycle" }
  ],
  "workflows": [
    {
      "name": "Checkout",
      "description": "User completes a purchase",
      "steps": ["Add items to cart", "Enter shipping", "Submit payment", "Receive confirmation"],
      "diagram": { "id": "checkout-flow", "title": "Checkout flow", "description": "...", "mermaidSyntax": "flowchart LR\n  A[Cart] --> B[Shipping] --> C[Payment] --> D[Confirmation]" }
    }
  ],
  "keyInvariants": ["Inventory count never goes negative"]
}
```

If no business logic is detectable (e.g., pure utility library), return:
`{ "domainConcepts": [], "businessRules": [], "workflows": [], "keyInvariants": [] }`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "domainConcepts": [...], ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/business-logic.ts`. Keep in sync.
````

- [ ] **Step 2: Create features prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/features.md`:

````markdown
---
description: Wave 2 subagent. Identifies user-facing features and use cases. Returns FeaturesAnalysis JSON. Failure is non-fatal.
---

# Features subagent prompt

You are a product analyst describing what this software does for its users — in
end-user-facing terms.

## Investigation guidance

Read the README, look at UI routes and component names, scan command-line help
output, look at API endpoint paths. Translate technical artifacts into user
stories.

A "feature" is something a user can DO. A "use case" is a story chaining
multiple features.

## Output schema

```jsonc
{
  "tagline": "string — short product tagline",
  "targetAudience": "string — who this is for",
  "features": [
    {
      "name": "Bulk import",
      "description": "Upload a CSV to create many records at once",
      "category": "Data Management",
      "relatedFiles": ["src/import/csv-importer.ts"]
    }
  ],
  "useCases": [
    {
      "title": "Onboard a new team",
      "description": "Admin imports member list, assigns roles, sends invites",
      "involvedFeatures": ["Bulk import", "Role assignment", "Invite email"]
    }
  ]
}
```

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "tagline": "...", "features": [...] }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/features.ts`. Keep in sync.
````

- [ ] **Step 3: Create error-doc prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/error-doc.md`:

````markdown
---
description: Wave 2 subagent. Catalogues error codes, common errors, debugging tips. Returns ErrorHandlingAnalysis JSON. Failure is non-fatal.
---

# Error handling subagent prompt

You are documenting how this codebase signals and handles errors.

## Investigation guidance

Use Grep to find:
- `throw new` (custom exceptions)
- Error class definitions: `class FooError extends Error`
- HTTP error responses: `res.status(400)`, `HTTPException(404)`, `Response(status_code=500)`
- Error code constants / enums
- Logging calls with `error` / `fatal` level

Use Read to examine error handling middleware, catch blocks, and status mappings.

## Output schema

```jsonc
{
  "errorCodes": [
    {
      "code": "AUTH_INVALID_TOKEN",
      "httpStatus": 401,
      "message": "Token is invalid or expired",
      "description": "Returned when the bearer token cannot be verified",
      "sourceFile": "src/auth/middleware.ts"
    }
  ],
  "commonErrors": [
    {
      "error": "ECONNREFUSED on startup",
      "cause": "Database not running",
      "solution": "Start postgres with `docker compose up -d db`",
      "category": "Setup"
    }
  ],
  "errorClasses": ["AuthError", "ValidationError"],
  "debuggingTips": ["Set LOG_LEVEL=debug to see request bodies"]
}
```

If error handling is minimal, return arrays as empty: `{ "errorCodes": [], "commonErrors": [], "errorClasses": [], "debuggingTips": [] }`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "errorCodes": [...], ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/error-doc.ts`. Keep in sync.
````

- [ ] **Step 4: Create config-doc prompt**

Create `.claude-plugin/skills/open-auto-doc/agents/config-doc.md`:

````markdown
---
description: Wave 2 subagent. Catalogues configuration knobs (env vars, config files). Returns ConfigurationAnalysis JSON. Failure is non-fatal.
---

# Configuration subagent prompt

You are documenting every knob a deployer / operator can turn to configure this
software.

## Investigation guidance

Read:
- `.env.example`, `.env.sample`, `.envrc.example`
- Config loading code: search for `process.env.`, `os.getenv(`, `Deno.env.get(`
- Config schema files (Zod, Joi, Pydantic Settings, dotenv-safe configs)
- `config/*.{ts,yaml,toml,json}`
- Framework-specific configs: `next.config.js`, `vite.config.ts`, `nuxt.config.ts`

For each config item: name, source (file path or env), type, default, whether
required, what it controls.

## Output schema

```jsonc
{
  "configItems": [
    {
      "name": "DATABASE_URL",
      "source": ".env (env var)",
      "type": "string",
      "defaultValue": null,
      "required": true,
      "description": "Postgres connection string",
      "category": "Database"
    }
  ],
  "configFiles": [".env.example", "next.config.js"],
  "environmentVariables": ["DATABASE_URL", "NODE_ENV", "..."]
}
```

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "configItems": [...], ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/config-doc.ts`. Keep in sync.
````

- [ ] **Step 5: Verify**

Run: `ls .claude-plugin/skills/open-auto-doc/agents/`
Expected: 9 files total — `architect.md`, `guide-writer.md`, `api-doc.md`, `component-doc.md`, `model-doc.md`, `business-logic.md`, `features.md`, `error-doc.md`, `config-doc.md`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/agents/business-logic.md .claude-plugin/skills/open-auto-doc/agents/features.md .claude-plugin/skills/open-auto-doc/agents/error-doc.md .claude-plugin/skills/open-auto-doc/agents/config-doc.md
git commit -m "feat(plugin): add Wave 2 semantic subagent prompts"
```

---

### Task 9: Create the SKILL.md orchestrator

**Files:**
- Create: `.claude-plugin/skills/open-auto-doc/SKILL.md`

This is the main artifact: the orchestration logic the agent follows when the
user invokes the skill.

- [ ] **Step 1: Write SKILL.md**

Create `.claude-plugin/skills/open-auto-doc/SKILL.md`:

````markdown
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

Use Read to check for `.autodocrc.json` in cwd and in `docs-site/.autodocrc.json`.

- If found: parse it. Note the `outputDir`, `repos[0].name`, and compute `<cacheDir> = <outputDir>/.autodoc-cache`. Proceed to Step 3 (skip first-run scaffold).
- If not found: proceed to Step 2.

Use Bash `pwd` to capture the absolute cwd. Save it as `<repoPath>` for later steps. Save `<repoName>` from `repos[0].name` (re-run path) or wait for the scaffold output (first-run path).

## Step 2: First-run scaffold

In interactive mode, briefly tell the user what's about to happen ("I'll set up a Fumadocs site in `docs-site/` and analyze this repo").

Run:

```bash
npx @latent-space-labs/open-auto-doc scaffold -o docs-site
```

The command outputs a single JSON line on success: `{"ok":true,"outputDir":"...","cacheDir":"...","repoName":"..."}`. Parse it to capture `<outputDir>`, `<cacheDir>`, and `<repoName>`.

If the command fails, surface the error to the user and stop.

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

Save the parsed results as `<wave2Results>`.

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

Update `.autodocrc.json` to set `routineAction` to the user's choice. Use Read + Edit on the JSON file.

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
   - `commit`: run `git -C <repoPath> add docs-site/ && git -C <repoPath> commit -m "docs: auto-update via open-auto-doc"`. If the commit fails because nothing changed, that's also success.
   - `push`: same as commit, then run `git -C <outputDir> add . && git -C <outputDir> commit -m "docs: auto-update" && git -C <outputDir> push`. If the docs-site has no git config, fail with a clear message.
3. Exit with structured success/failure message — Cowork picks it up.

If anything is ambiguous (config malformed, routineAction missing, etc.), fail with a message — DO NOT prompt.

## Helpful patterns

- **Loading prompt files**: `agents/<name>.md` paths are relative to this skill's base directory. The runtime tells you the base directory at skill activation time. Resolve relative paths against it.
- **Parsing subagent JSON**: subagents return their result inside a fenced ```json ... ``` block. Extract the FIRST such block. If the subagent returned malformed JSON, log it and treat as a failure for that section.
- **Throttling**: dispatch Wave 2 in two batches by default — 4 + 3, not 7-at-once. If even those batches hit rate limits, fail loud — don't retry indefinitely.
- **Logging**: after each wave, briefly tell the interactive user what found ("Found 12 endpoints, 4 components"). Skip in unattended mode.
````

- [ ] **Step 2: Verify file exists**

Run: `ls -la .claude-plugin/skills/open-auto-doc/`
Expected: shows `SKILL.md`, `agents/` (with 9 files), `schemas/` (with 1 file).

- [ ] **Step 3: Lint the markdown for obvious frontmatter / structure issues**

Run: `head -10 .claude-plugin/skills/open-auto-doc/SKILL.md`
Expected: starts with `---\nname: open-auto-doc\ndescription: ...\n---`.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/skills/open-auto-doc/SKILL.md
git commit -m "feat(plugin): add open-auto-doc skill orchestrator"
```

---

### Task 10: Build, install plugin locally, and end-to-end verify

**Files:**
- None (verification only — no code changes)

- [ ] **Step 1: Full monorepo build**

Run: `npm run build`
Expected: all packages build successfully. If any fail, fix the underlying issue before proceeding.

- [ ] **Step 2: Verify scaffold works in a fresh tmp directory**

```bash
mkdir -p /tmp/oad-e2e && cd /tmp/oad-e2e
git init -q
node /Users/bryan/Code/lsl/open-auto-doc/.claude/worktrees/goofy-williams-de2afb/packages/cli/dist/index.js scaffold -o docs-site -n "OAD E2E Test"
```

Expected:
- `docs-site/` exists with Fumadocs structure
- `.autodocrc.json` exists with `routineAction: "none"` and a single repo entry
- The command's stdout is a single JSON line with `"ok":true`

- [ ] **Step 3: Install the plugin into Claude Code locally**

Per Claude Code plugin install docs (verify the exact command at install time — this is the typical pattern):

```bash
# Either via the plugin install command, OR symlink for dev:
ln -sf /Users/bryan/Code/lsl/open-auto-doc/.claude/worktrees/goofy-williams-de2afb/.claude-plugin ~/.claude/plugins/local/open-auto-doc
```

Expected: the `open-auto-doc` skill shows up in `Skill` listings in a fresh Claude Code session.

If the plugin install path differs in this version of Claude Code, consult `claude --help` or the docs to find the right invocation. Do not skip this step — the next steps depend on it.

- [ ] **Step 4: Run the skill end-to-end against the test repo**

Open a fresh Claude Code session in `/tmp/oad-e2e` (or use a real test repo of your choice), then in the conversation:

> "Use the open-auto-doc skill to document this repo."

Verify:
- The skill announces itself ("Using open-auto-doc to ...")
- Wave 1 architect subagent runs and returns architecture JSON
- Wave 2 dispatches multiple subagents in parallel (visible as multiple Agent tool calls in one message)
- Wave 3 guide-writer runs after Wave 2
- `docs-site/.autodoc-cache/<repoName>-analysis.json` is created
- `docs-site/content/docs/<repoName>/index.mdx` is created
- The skill presents the end-of-run menu

- [ ] **Step 5: Verify Cowork handoff (interactive only — don't actually create a routine)**

When the menu appears, choose option 3 ("Schedule re-runs with Cowork"). Verify:
- The skill asks for cadence
- The skill asks for routineAction (with `push` only offered if applicable)
- The skill writes the chosen `routineAction` into `.autodocrc.json`
- The skill invokes the `anthropic-skills:schedule` skill with a sane prompt

You can cancel out of the schedule skill at the cadence prompt if you don't want to actually create a routine. The verification is that the handoff happens correctly, not that the routine runs.

- [ ] **Step 6: Verify unattended-mode skip-prompts behavior**

In a fresh session, ask:

> "Run the open-auto-doc skill in unattended mode."

Verify:
- No interactive prompts shown
- No end-of-run menu shown
- After generation, the configured `routineAction` is performed silently
- The skill exits with a clear success message

- [ ] **Step 7: Cleanup test repo**

```bash
cd - && rm -rf /tmp/oad-e2e
```

- [ ] **Step 8: Final commit**

If any small issues turned up that needed fixing during verification, commit them now with a descriptive message. Otherwise, no commit needed for this verification step.

---

## Notes for the implementing engineer

- **Don't over-validate config.** The skill mode is for local repos; many fields the existing CLI requires (cloneUrl, htmlUrl) are optional now. Trust that skill-mode code paths don't need them.
- **The subagent prompts intentionally duplicate `packages/analyzer/src/agents/*.ts` system prompts.** This is by design — the spec calls it out as an accepted tradeoff. Do not "DRY this up" by trying to import the prompts from the analyzer package.
- **Don't add new runtime dependencies to the CLI.** The plumbing subcommands (`scaffold`, `generate-from-json`) should use only what's already in `packages/cli/package.json`.
- **The skill is markdown, not code.** When the spec says "the skill dispatches X", the SKILL.md file is just instructions for the main agent — it tells the agent what to do, but the agent is the one calling the Agent tool, parsing JSON, etc. Treat SKILL.md as user-facing prose telling Claude how to behave.
- **Frontmatter `description` is the trigger.** The text in each skill / subagent prompt's frontmatter description is what the runtime uses to decide when to surface the skill or what the subagent does. Make it specific and trigger-friendly.
- **Plugin marketplace listing is out of scope.** Users install via local path during this iteration. Add a marketplace listing as a follow-up.
- **MDX auto-fix is a follow-up.** The existing analyzer's `mdx-fixer` agent runs as part of the BYOK build-check flow. Porting it into the skill (as another subagent prompt + an extra recovery wave) is intentionally not in this plan — v1 just surfaces MDX errors and stops.
- **Cross-repo / multi-repo support is a follow-up.** v1 documents only the cwd repo. The `generate-from-json` subcommand already loads multiple cache files if present, so the skill can be extended later to clone additional repos and dispatch analysis for each — without changing the generator-side plumbing.
