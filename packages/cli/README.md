# open-auto-doc

**One command. Beautiful docs. Auto-deployed.**

Turn any GitHub repo into a fully hosted documentation site — powered by AI that actually reads your code.

```bash
npx @latent-space-labs/open-auto-doc
```

No config files. No manual writing. Just point it at your repos and get a production-ready docs site with architecture overviews, API references, component docs, and more.

## Install

```bash
# Run directly with npx (no install needed)
npx @latent-space-labs/open-auto-doc

# Or install globally
npm install -g @latent-space-labs/open-auto-doc
```

### Requirements

- **Node.js 18+**
- **A GitHub account** — works with public and private repos
- **An [Anthropic API key](https://console.anthropic.com/)** — powers the AI analysis

## Quick Start

```bash
# 1. Generate docs (interactive setup)
npx @latent-space-labs/open-auto-doc

# 2. Preview locally
cd docs-site && npm run dev

# 3. Deploy
open-auto-doc deploy

# 4. Auto-update on every push
open-auto-doc setup-ci
```

The CLI walks you through GitHub auth, repo selection, and API key setup interactively.

## What Gets Generated

| Section | Contents |
|---|---|
| **Architecture Overview** | Tech stack, module breakdown, data flow diagrams, entry points, key patterns |
| **Getting Started** | Prerequisites, install steps, quick start guide, config options |
| **API Reference** | Endpoints with methods, params, request/response bodies, auth |
| **Components** | UI components with props, usage examples, categories |
| **Data Models** | Schemas with field types, constraints, relationships, ER diagrams |
| **Business Logic** | Domain concepts, business rules, workflows |
| **Configuration** | Config files, env vars, settings reference |
| **Error Handling** | Error codes, common errors, debugging tips |

Multi-repo setups also get **cross-repo analysis** — shared dependencies, API contracts, and relationship diagrams.

## All Commands

| Command | What it does |
|---|---|
| `open-auto-doc` | Full interactive setup: auth → pick repos → analyze → generate |
| `open-auto-doc init -o <dir>` | Same, with custom output directory (default: `docs-site`) |
| `open-auto-doc generate` | Re-analyze and regenerate using saved config |
| `open-auto-doc generate --incremental` | Only re-analyze changed files |
| `open-auto-doc deploy` | Create a GitHub repo for docs and push |
| `open-auto-doc setup-ci` | Add GitHub Actions workflow for auto-updates |
| `open-auto-doc setup-mcp` | Set up MCP server for Claude Code |
| `open-auto-doc login` | Authenticate with GitHub |
| `open-auto-doc logout` | Clear stored credentials |

## MCP Server for AI Assistants

open-auto-doc includes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI assistants like Claude Code query your documentation directly. Instead of reading raw source files, the AI gets structured knowledge about your architecture, APIs, components, and data models.

### How it works

When you run `open-auto-doc init` or `generate`, the AI analysis results are cached as JSON in `<outputDir>/.autodoc-cache/`. The MCP server (`@latent-space-labs/open-auto-doc-mcp`) is a separate lightweight package that reads this cache and serves it over the Model Context Protocol via stdio.

```
open-auto-doc init → .autodoc-cache/*.json → MCP Server (stdio) → Claude Code
```

The server has no dependency on the analyzer or generator — it only reads JSON files, so `npx` startup is fast.

### Setup

```bash
# Set up after generating docs
open-auto-doc setup-mcp
```

This creates `.mcp.json` in your project root. Claude Code will automatically discover the tools:

- `get_project_overview` — purpose, tech stack, summary stats
- `search_documentation` — full-text search across all sections
- `get_api_endpoints` — API endpoint details with params, auth, request/response
- `get_components` — UI component documentation with props and usage
- `get_data_models` — data model schemas with fields and relationships
- `get_architecture` — modules, data flow, patterns, entry points
- `get_diagram` — Mermaid diagrams (architecture, ER, flow)
- `get_business_rules` — domain concepts, rules, and workflows

Resources are also available at `docs://overview`, `docs://architecture`, `docs://getting-started`, and `docs://diagrams/{id}`.

You can also configure `.mcp.json` manually:

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

## Language Support

open-auto-doc is **language-agnostic**. It uses AI to understand code — not language-specific parsers. Works with TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, PHP, C#, Swift, and more.

## Privacy & Security

- Your Anthropic API key is **only sent to the Anthropic API**
- All code analysis runs **locally on your machine** (or in your own CI runner)
- Credentials stored at `~/.open-auto-doc/credentials.json` with `0600` permissions
- Run `open-auto-doc logout` to clear everything

## Links

- [GitHub](https://github.com/Latent-Space-Labs/open-auto-doc) — source code, issues, contributing
- [Anthropic Console](https://console.anthropic.com/) — get an API key

## License

MIT
