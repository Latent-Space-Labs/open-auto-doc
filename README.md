# open-auto-doc

**One command. Beautiful docs. Auto-deployed.**

Turn any GitHub repo into a fully hosted documentation site — powered by AI that actually reads your code.

```bash
npx open-auto-doc
```

No config files. No manual writing. Just point it at your repos and get a production-ready docs site with architecture overviews, API references, component docs, and more.

---

## Install

```bash
# Run directly (no install needed)
npx open-auto-doc

# Or install globally
npm install -g open-auto-doc
```

After installing globally, you can run `open-auto-doc` from anywhere instead of `npx open-auto-doc`.

### Prerequisites

- **Node.js 18+**
- **A GitHub account** (public and/or private repos)
- **An [Anthropic API key](https://console.anthropic.com/)** — the AI engine that analyzes your code

---

## Quick Start

### 1. Generate your docs

```bash
npx open-auto-doc
```

The interactive CLI walks you through everything:

```
┌  open-auto-doc — AI-powered documentation generator
│
◆  Let's connect your GitHub account.
│  → Opens browser for GitHub OAuth (no tokens to copy-paste)
│
◇  Found 111 repositories
◇  Select repositories to document
│  my-api, my-frontend, my-shared-lib
│
◇  Enter your Anthropic API key
│  sk-ant-...
│
◇  [my-api] Analyzing architecture with AI...
◇  [my-api] Found 14 endpoints, 0 components, 5 models
◇  [my-frontend] Analyzing architecture with AI...
◇  [my-frontend] Found 0 endpoints, 23 components, 0 models
│
◇  Site scaffolded
◇  Documentation content written
│
◆  Next steps
│  cd docs-site && npm run dev
│
└  Documentation generated successfully!
```

### 2. Preview locally

```bash
cd docs-site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to browse your docs.

### 3. Deploy

```bash
npx open-auto-doc deploy
```

This creates a GitHub repo for your docs site and pushes it. Then connect it to Vercel:

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the docs repo that was just created
3. Click **Deploy**

Your docs are now live. Every time you run `deploy` again, Vercel auto-deploys the update.

### 4. Set up CI/CD (optional)

```bash
npx open-auto-doc setup-ci
```

This generates a GitHub Actions workflow in your **source** repo that automatically re-analyzes your code and pushes updated docs whenever you push to main. Your docs stay up to date without you doing anything.

---

## Commands

| Command | What it does |
|---|---|
| `open-auto-doc` | Full setup: GitHub auth, pick repos, AI analysis, generate site |
| `open-auto-doc init -o <dir>` | Same as above, custom output directory (default: `docs-site`) |
| `open-auto-doc generate` | Re-analyze and regenerate docs using saved config |
| `open-auto-doc generate --incremental` | Only re-analyze files that changed since last run |
| `open-auto-doc deploy` | Create a GitHub repo for docs and push |
| `open-auto-doc setup-ci` | Generate a GitHub Actions workflow for auto-updating docs |
| `open-auto-doc login` | Authenticate with GitHub |
| `open-auto-doc logout` | Clear all stored credentials |

---

## What Gets Generated

AI analyzes each repo through a multi-stage pipeline and produces:

| Section | What it covers |
|---|---|
| **Architecture Overview** | Tech stack, module breakdown, data flow, entry points, key patterns, Mermaid diagrams |
| **Getting Started** | Prerequisites, installation steps, quick start guide, configuration options |
| **API Reference** | Every endpoint — methods, parameters, request/response bodies, auth requirements |
| **Components** | UI components with props, usage examples, visual categories |
| **Data Models** | Schemas and models with fields, types, constraints, ER diagrams |

For multi-repo projects, you also get **cross-repo analysis** — shared dependencies, API contracts between services, and relationship diagrams.

### Generated site structure

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

The site is built on [Fumadocs](https://fumadocs.dev) + Next.js with full-text search, dark mode, and sidebar navigation out of the box.

---

## CI/CD Setup Details

When you run `setup-ci`, it generates `.github/workflows/update-docs.yml` in your source repo. You need to add two GitHub secrets:

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) |
| `DOCS_DEPLOY_TOKEN` | A GitHub Personal Access Token with `repo` scope — [create one here](https://github.com/settings/tokens) |

### How it works

```
Push to main → GitHub Actions runs → AI re-analyzes your code → Updated docs pushed to docs repo → Vercel auto-deploys
```

The workflow:
1. Triggers on every push to your main branch (configurable)
2. Installs `open-auto-doc` and runs `generate --incremental`
3. Only re-analyzes files that changed (uses cached results for the rest)
4. Pushes updated content to your docs repo
5. Vercel picks up the push and auto-deploys

You can also trigger it manually from the Actions tab (`workflow_dispatch`).

---

## End-to-End Example

```bash
# 1. Install globally (optional — you can use npx instead)
npm install -g open-auto-doc

# 2. Generate docs (interactive — picks repos, enters API key)
open-auto-doc

# 3. Preview locally
cd docs-site && npm install && npm run dev

# 4. Deploy to GitHub + Vercel
cd .. && open-auto-doc deploy

# 5. Set up auto-updates
open-auto-doc setup-ci
# → Add ANTHROPIC_API_KEY and DOCS_DEPLOY_TOKEN as GitHub secrets
# → Commit and push the generated workflow file
```

That's it. Your docs are live and stay up to date.

---

## Language Support

open-auto-doc is **language-agnostic**. It uses AI to understand code in any language — not language-specific parsers. It works well with:

TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, PHP, C#, Swift, and more.

It also reads dependency files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, etc.) and `CLAUDE.md` files for richer context.

---

## Tips

- **CLAUDE.md files** — If your repo has a `CLAUDE.md` or `.claude/CLAUDE.md`, its contents get injected into every AI prompt. This gives the AI insider knowledge about your project's conventions and architecture, resulting in significantly better docs.

- **Multi-repo docs** — Select multiple repos during `init` and they'll all be documented in a single unified site with sidebar navigation and cross-repo analysis.

- **Re-generating** — After the first run, a `.autodocrc.json` config is saved. Run `open-auto-doc generate` to re-analyze without going through the full setup flow again. Use `--incremental` to only re-analyze changed files.

- **Custom output directory** — Use `-o` to control where the site is generated: `open-auto-doc init -o my-docs`

- **Custom GitHub OAuth App** — The CLI uses a default GitHub OAuth App. To use your own:
  ```bash
  export OPEN_AUTO_DOC_GITHUB_CLIENT_ID=your_client_id
  open-auto-doc
  ```

---

## Credentials

Stored at `~/.open-auto-doc/credentials.json` with `0600` permissions. Contains your GitHub OAuth token and Anthropic API key. Run `open-auto-doc logout` to clear everything.

Your API key is **never sent anywhere except directly to the Anthropic API**. All analysis runs locally on your machine (or in your CI runner).

---

## Contributing

```bash
git clone https://github.com/kyritzb/open-auto-doc.git
cd open-auto-doc
npm install
npm run build
```

### Monorepo structure

```
packages/
├── cli/            # Published as "open-auto-doc" — the CLI you run
├── analyzer/       # AI code analysis engine (Claude Agent SDK)
├── generator/      # Handlebars MDX templates + Fumadocs site scaffolding
└── site-template/  # Next.js + Fumadocs + Tailwind template (copied to user's project)
```

Build all packages: `npm run build` (builds analyzer → generator → cli)

### Local development

```bash
# Build and run the CLI locally
npm run build
node packages/cli/dist/index.js

# Or link it globally for testing
cd packages/cli && npm link
open-auto-doc --help
```

### Publishing a new version

Requires an `NPM_TOKEN` secret set in the GitHub repo settings.

```bash
# Bump version across all packages, commit, and tag
npm run release -- patch   # 0.1.0 → 0.1.1
npm run release -- minor   # 0.1.0 → 0.2.0
npm run release -- major   # 0.1.0 → 1.0.0

# Push the tag to trigger the publish workflow
git push && git push --tags
```

The GitHub Actions workflow (`.github/workflows/publish.yml`) automatically publishes all three packages to npm when a `v*` tag is pushed.

---

## License

MIT
