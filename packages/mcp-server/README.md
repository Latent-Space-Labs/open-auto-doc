# @latent-space-labs/open-auto-doc-mcp

MCP server for [open-auto-doc](https://github.com/Latent-Space-Labs/open-auto-doc) — exposes AI-analyzed codebase documentation to Claude Code and other MCP-compatible AI assistants.

## Setup

The easiest way to set up is through the main CLI:

```bash
# After generating docs with open-auto-doc
open-auto-doc setup-mcp
```

This creates `.mcp.json` in your project root. Claude Code automatically discovers the tools next time you open the project.

### Manual `.mcp.json` setup

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

## Available Tools

| Tool | Description |
|---|---|
| `get_project_overview` | Project purpose, tech stack, summary stats |
| `search_documentation` | Full-text search across all documentation |
| `get_api_endpoints` | API endpoints with params, auth, request/response |
| `get_components` | UI components with props and usage examples |
| `get_data_models` | Data models with fields, types, relationships |
| `get_architecture` | Modules, data flow, patterns, entry points |
| `get_diagram` | Mermaid diagrams (architecture, ER, flow) |
| `get_business_rules` | Domain concepts, rules, workflows |

All tools accept an optional `repo` parameter for multi-repo setups.

## Available Resources

| URI | Description |
|---|---|
| `docs://overview` | Project overview |
| `docs://architecture` | Architecture details |
| `docs://getting-started` | Getting started guide |
| `docs://diagrams/{diagramId}` | Individual Mermaid diagrams |

## CLI Options

```bash
open-auto-doc-mcp [options]

Options:
  --project-dir <path>   Project directory containing .autodocrc.json
  --cache-dir <path>     Direct path to .autodoc-cache directory
```

If no options are given, the server searches the current directory for `.autodocrc.json`.

## How It Works

When you run `open-auto-doc init` or `generate`, the AI analysis results are saved as JSON cache files in `<outputDir>/.autodoc-cache/`. Each analyzed repo gets a `<repo-name>-analysis.json` file containing the full structured analysis.

The MCP server reads these cache files at startup, loads the analysis results into memory, and exposes them through the [Model Context Protocol](https://modelcontextprotocol.io/) via stdio transport.

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

Key design decisions:

- **Separate package** — no dependency on the analyzer or generator, so `npx` startup is fast (~2 seconds) and install size is small
- **Read-only** — the server only reads cached JSON, it never modifies files or runs analysis
- **Stdio transport** — standard for Claude Code MCP servers, launched as a subprocess
- **Multi-repo** — loads all cached analysis files; tools accept a `repo` parameter to target a specific repo

### Cache discovery order

1. `--cache-dir <path>` — direct path to the `.autodoc-cache` directory
2. `--project-dir <path>` — scans for `.autodocrc.json` → reads `outputDir` → finds cache
3. Default — scans CWD and `docs-site/` for `.autodocrc.json`, or looks for `.autodoc-cache/` directly

### What's in the cache

Each `*-analysis.json` file contains:

- **Architecture** — project purpose, tech stack, modules, data flow, patterns, Mermaid diagrams
- **API endpoints** — method, path, parameters, request/response bodies, auth requirements
- **Components** — name, description, props, usage examples, file paths
- **Data models** — fields, types, constraints, relationships
- **Business logic** — domain concepts, rules, workflows, invariants
- **Getting started** — prerequisites, installation, quick start, configuration
- **Features** — feature list, use cases, categories
- **Configuration** — config items, env vars, config files
- **Error handling** — error codes, common errors, debugging tips

## License

MIT
