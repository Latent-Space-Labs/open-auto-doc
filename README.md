# open-auto-doc

**One command. Beautiful docs. Auto-deployed.**

Turn any GitHub repo into a fully hosted documentation site — powered by AI that actually reads your code.

```bash
npx @latent-space-labs/open-auto-doc
```

No config files. No manual writing. Just point it at your repos and get a production-ready docs site with architecture overviews, API references, component docs, and more.

---

## Install

```bash
# Run directly with npx (no install needed)
npx @latent-space-labs/open-auto-doc

# Or install globally for repeated use
npm install -g @latent-space-labs/open-auto-doc
```

Once installed globally, the `open-auto-doc` command is available everywhere — no `npx` prefix needed.

### Requirements

- **Node.js 18+**
- **A GitHub account** — works with both public and private repos
- **An [Anthropic API key](https://console.anthropic.com/)** — powers the AI analysis (bring your own key)

---

## Quick Start

### Step 1: Generate your docs

```bash
npx @latent-space-labs/open-auto-doc
```

The CLI walks you through everything interactively:

1. **GitHub login** — opens your browser for OAuth (no tokens to copy-paste)
2. **Pick repos** — select which repositories to document
3. **Enter your Anthropic API key** — used to analyze your code with AI
4. **AI analyzes your codebase** — reads actual code structure, not just comments
5. **Docs site is generated** — a complete Next.js site with everything wired up

```
┌  open-auto-doc — AI-powered documentation generator
│
◆  Let's connect your GitHub account.
│  → Opens browser for GitHub OAuth
│
◇  Found 47 repositories
◇  Select repositories to document
│  my-api, my-frontend, shared-lib
│
◇  Enter your Anthropic API key
│  sk-ant-...
│
◇  [my-api] Analyzing architecture...
◇  [my-api] Found 14 endpoints, 5 models
◇  [my-frontend] Analyzing architecture...
◇  [my-frontend] Found 23 components
│
◇  Site scaffolded
◇  Documentation content written
│
└  Documentation generated successfully!
```

### Step 2: Preview locally

```bash
cd docs-site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your docs.

### Step 3: Deploy to Vercel

```bash
open-auto-doc deploy
```

This creates a GitHub repo for your docs and pushes it. Then:

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the docs repo
3. Click **Deploy**

Your docs are now live with a URL. Every time you push updates, Vercel auto-deploys.

### Step 4: Auto-update docs on every push (optional)

```bash
open-auto-doc setup-ci
```

This adds a GitHub Actions workflow to your **source** repo. Whenever you push code to main, it automatically re-analyzes your code and updates your docs site. Zero maintenance.

You'll need to add two secrets to your source repo (Settings → Secrets → Actions):

| Secret | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) |
| `DOCS_DEPLOY_TOKEN` | A GitHub PAT with `repo` scope — [create one here](https://github.com/settings/tokens/new) |

---

## All Commands

| Command | What it does |
|---|---|
| `open-auto-doc` | Full interactive setup: auth → pick repos → analyze → generate |
| `open-auto-doc init -o <dir>` | Same, with custom output directory (default: `docs-site`) |
| `open-auto-doc generate` | Re-analyze and regenerate using saved config (`.autodocrc.json`) |
| `open-auto-doc generate --incremental` | Only re-analyze files that changed since last run |
| `open-auto-doc deploy` | Create a GitHub repo for docs and push |
| `open-auto-doc setup-ci` | Add a GitHub Actions workflow to auto-update docs on push |
| `open-auto-doc setup-mcp` | Set up MCP server so Claude Code can query your docs |
| `open-auto-doc login` | Authenticate with GitHub |
| `open-auto-doc logout` | Clear all stored credentials |

---

## What Gets Generated

The AI analyzes each repo through a multi-stage pipeline:

| Section | What's in it |
|---|---|
| **Architecture Overview** | Tech stack, module breakdown, data flow diagrams, entry points, key patterns |
| **Getting Started** | Prerequisites, install steps, quick start guide, config options |
| **API Reference** | Every endpoint with methods, params, request/response bodies, auth requirements |
| **Components** | UI components with props, usage examples, categories |
| **Data Models** | Schemas with field types, constraints, relationships, ER diagrams |

When you document multiple repos together, you also get **cross-repo analysis** — shared dependencies, API contracts between services, and relationship diagrams.

All diagrams are generated as Mermaid and render directly in the docs site.

### Site structure

```
docs-site/
├── app/                        # Next.js app (Fumadocs)
│   ├── docs/                   # Docs layout + pages
│   └── api/search/             # Built-in full-text search
├── content/docs/
│   ├── my-api/
│   │   ├── index.mdx           # Architecture overview + diagrams
│   │   ├── getting-started.mdx
│   │   ├── api/index.mdx       # API endpoints
│   │   └── data-models/        # Data models + ER diagrams
│   └── my-frontend/
│       ├── index.mdx
│       ├── getting-started.mdx
│       └── components/         # UI components
├── source.config.ts            # Fumadocs MDX config
└── package.json
```

Built on [Fumadocs](https://fumadocs.dev) + Next.js — comes with full-text search, dark mode, and sidebar navigation out of the box.

---

## How CI/CD Works

```
Push to main → GitHub Actions → AI re-analyzes code → Docs pushed to docs repo → Vercel auto-deploys
```

The workflow:
1. Triggers on every push to main (configurable)
2. Installs `@latent-space-labs/open-auto-doc`
3. Runs `open-auto-doc generate --incremental` (only re-analyzes changed files)
4. Pushes updated docs to your docs repo
5. Vercel picks up the push and deploys

You can also trigger it manually from the Actions tab.

---

## MCP Server for AI Assistants

open-auto-doc includes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI assistants like Claude Code query your documentation directly. Instead of reading raw source files, the AI gets structured knowledge about your architecture, APIs, components, and data models.

### How it works

When you run `open-auto-doc init` or `generate`, the AI analysis results are saved as a JSON cache in `<outputDir>/.autodoc-cache/`. The MCP server is a separate lightweight package (`@latent-space-labs/open-auto-doc-mcp`) that reads this cache and exposes it over the [Model Context Protocol](https://modelcontextprotocol.io/) via stdio transport.

```
┌──────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  open-auto-doc   │      │   .autodoc-cache/  │      │  MCP Server      │
│  init / generate │─────▶│   *-analysis.json  │◀─────│  (stdio)         │
│                  │ save │                    │ read │                  │
└──────────────────┘      └───────────────────┘      └────────┬─────────┘
                                                              │
                                                     MCP protocol (stdio)
                                                              │
                                                     ┌────────▼─────────┐
                                                     │  Claude Code     │
                                                     │  or any MCP      │
                                                     │  client          │
                                                     └──────────────────┘
```

The flow:

1. **Analysis** — `open-auto-doc init` clones your repos, runs AI agents to analyze architecture/APIs/components/models, and saves structured JSON results to `.autodoc-cache/`
2. **Cache** — Each analyzed repo gets a `<repo-name>-analysis.json` file containing the full analysis: architecture overview, API endpoints, components, data models, diagrams, business logic, and more
3. **MCP Server** — When Claude Code starts, it launches the MCP server via `npx`. The server reads the cached JSON files and registers tools + resources
4. **Querying** — The AI assistant calls MCP tools (like `search_documentation` or `get_api_endpoints`) which query the in-memory analysis data and return structured JSON results

The MCP server has no dependency on the analyzer or generator packages — it only reads JSON files. This keeps the `npx` startup fast (~2 seconds) and the install size small.

### Setup

During `open-auto-doc init`, you'll be prompted to set up the MCP server automatically. You can also set it up later:

```bash
open-auto-doc setup-mcp
```

This creates a `.mcp.json` file in your project root. Next time you open Claude Code in the project, the tools are available automatically.

### Available tools

| Tool | What it provides |
|---|---|
| `get_project_overview` | Project purpose, tech stack, summary stats |
| `search_documentation` | Full-text search across all docs sections |
| `get_api_endpoints` | API endpoints with params, auth, request/response |
| `get_components` | UI components with props and usage examples |
| `get_data_models` | Data models with fields, types, relationships |
| `get_architecture` | Modules, data flow, patterns, entry points |
| `get_diagram` | Mermaid diagrams (architecture, ER, flow) |
| `get_business_rules` | Domain concepts, rules, workflows |

All tools accept an optional `repo` parameter for multi-repo setups. When only one repo is loaded, it's used automatically.

### Available resources

The server also exposes MCP resources that clients can read directly:

| URI | Description |
|---|---|
| `docs://overview` | Project overview (purpose, tech stack, summary) |
| `docs://architecture` | Architecture details (modules, data flow, patterns) |
| `docs://getting-started` | Getting started guide (prerequisites, install, quick start) |
| `docs://diagrams/{diagramId}` | Individual Mermaid diagrams by ID |

### Manual `.mcp.json` setup

If you prefer to configure it manually instead of using `setup-mcp`:

```json
{
  "mcpServers": {
    "project-docs": {
      "command": "npx",
      "args": ["-y", "@latent-space-labs/open-auto-doc-mcp", "--project-dir", "."]
    }
  }
}
```

### Cache discovery

The MCP server finds the analysis cache automatically:

1. `--cache-dir <path>` — direct path to the `.autodoc-cache` directory
2. `--project-dir <path>` — scans for `.autodocrc.json`, reads `outputDir`, finds cache
3. Default — scans the current directory and `docs-site/` for `.autodocrc.json`

### Multi-repo support

If you documented multiple repos together, the MCP server loads all of them. Tools require the `repo` parameter to specify which repo to query. `search_documentation` searches across all repos by default.

---

## Language Support

open-auto-doc is **language-agnostic**. It uses AI to understand code — not language-specific parsers. Works with:

TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, PHP, C#, Swift, and more.

It also reads dependency files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.) and `CLAUDE.md` files for additional context.

---

## Tips

- **Add a CLAUDE.md** — If your repo has a `CLAUDE.md` or `.claude/CLAUDE.md`, its contents are injected into every AI prompt. This gives the AI insider knowledge about your project's conventions, resulting in significantly better docs.

- **Multi-repo docs** — Select multiple repos during setup and they'll all be documented in one unified site with cross-repo analysis.

- **Regenerating** — After the first run, config is saved to `.autodocrc.json`. Run `open-auto-doc generate` to re-analyze without repeating the full setup. Use `--incremental` to only re-analyze changed files.

- **Custom output directory** — `open-auto-doc init -o my-docs`

- **Custom GitHub OAuth App** — Set `OPEN_AUTO_DOC_GITHUB_CLIENT_ID` env var to use your own OAuth app.

---

## Privacy & Security

- Your Anthropic API key is **only sent to the Anthropic API** — never to any other service
- All code analysis runs **locally on your machine** (or in your own CI runner)
- Credentials are stored at `~/.open-auto-doc/credentials.json` with `0600` permissions
- Run `open-auto-doc logout` to clear everything

---

## Contributing

open-auto-doc is MIT-licensed and open to contributions. Whether it's bug fixes, new features, documentation improvements, or ideas — all contributions are welcome.

### Getting started

```bash
git clone https://github.com/Latent-Space-Labs/open-auto-doc.git
cd open-auto-doc
npm install
npm run build
```

### Project structure

This is a monorepo with npm workspaces:

```
packages/
├── cli/            # Published as @latent-space-labs/open-auto-doc
│                   # Commander.js CLI — the main user-facing tool
├── analyzer/       # AI code analysis engine (Claude Agent SDK)
│                   # Multi-stage pipeline: static parsing → AI agents → structured output
├── generator/      # Handlebars MDX templates + site scaffolding
│                   # Renders analysis results into MDX files
├── mcp-server/     # Published as @latent-space-labs/open-auto-doc-mcp
│                   # MCP server — exposes docs to AI assistants
└── site-template/  # Next.js + Fumadocs template (copied to user projects)
                    # NOT part of the workspace build
```

### Local development

```bash
# Build everything
npm run build

# Build a single package
npm run build -w packages/analyzer

# Run the CLI locally
node packages/cli/dist/index.js

# Or link it globally for testing
cd packages/cli && npm link
open-auto-doc --help

# Watch mode for all packages
npm run dev
```

### How to contribute

1. **Fork the repo** and create a branch from `main`
2. **Make your changes** — the codebase is ESM-only TypeScript with strict mode
3. **Build** to verify everything compiles: `npm run build`
4. **Test locally** by running the CLI against a repo
5. **Open a PR** with a clear description of what changed and why

### Areas where help is appreciated

- **New analysis agents** — the analyzer supports pluggable agents in `packages/analyzer/src/agents/`
- **Template improvements** — MDX templates in `packages/generator/src/templates/mdx/`
- **Language-specific parsing** — better static analysis for specific languages
- **MCP server features** — additional tools, resources, or transport options
- **Documentation** — improve this README, add examples, or write guides

### Releasing (maintainers)

```bash
npm run release -- patch   # 0.2.0 → 0.2.1
npm run release -- minor   # 0.2.0 → 0.3.0
npm run release -- major   # 0.2.0 → 1.0.0

git push && git push --tags
```

Pushing a `v*` tag triggers the GitHub Actions workflow that publishes to npm.

---

## License

MIT — see [LICENSE](LICENSE) for details.
