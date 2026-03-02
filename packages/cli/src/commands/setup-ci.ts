import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
  }>;
  outputDir: string;
  docsRepo?: string;
}

function getGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function loadConfig(): AutodocConfig | null {
  for (const candidate of [
    path.resolve(".autodocrc.json"),
    path.resolve("docs-site", ".autodocrc.json"),
  ]) {
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, "utf-8"));
      } catch {
        // continue
      }
    }
  }
  return null;
}

function generateWorkflow(branch: string, docsRepoUrl: string, outputDir: string): string {
  return `name: Update Documentation

on:
  push:
    branches: [${branch}]
  workflow_dispatch:

jobs:
  update-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout source repo
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Cache analysis results
        uses: actions/cache@v4
        with:
          path: .autodoc-cache
          key: autodoc-cache-\${{ github.sha }}
          restore-keys: |
            autodoc-cache-

      - name: Install open-auto-doc
        run: npm install -g open-auto-doc

      - name: Generate documentation
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: open-auto-doc generate --incremental

      - name: Clone docs repo
        run: |
          git clone https://x-access-token:\${{ secrets.DOCS_DEPLOY_TOKEN }}@${docsRepoUrl.replace("https://", "")} docs-repo

      - name: Copy updated content
        run: |
          # Copy content and any updated config, preserving the docs repo git history
          rsync -av --delete \\
            --exclude '.git' \\
            --exclude 'node_modules' \\
            --exclude '.next' \\
            --exclude '.source' \\
            ${outputDir}/ docs-repo/

      - name: Push to docs repo
        run: |
          cd docs-repo
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          # Only commit and push if there are changes
          if git diff --cached --quiet; then
            echo "No documentation changes to push."
          else
            git commit -m "Update documentation from \${{ github.repository }}@\${{ github.sha }}"
            git push
          fi
`;
}

export async function setupCiCommand() {
  p.intro("open-auto-doc — CI/CD Setup");

  const gitRoot = getGitRoot();
  if (!gitRoot) {
    p.log.error("Not in a git repository. Run this command from your project root.");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.docsRepo) {
    p.log.error(
      "No docs repo configured. Run `open-auto-doc deploy` first to create a docs GitHub repo.",
    );
    process.exit(1);
  }

  const outputDir = config.outputDir
    ? path.relative(gitRoot, path.resolve(config.outputDir))
    : "docs-site";

  p.log.info(`Docs repo: ${config.docsRepo}`);
  p.log.info(`Output directory: ${outputDir}`);

  const branch = await p.text({
    message: "Which branch should trigger doc updates?",
    initialValue: "main",
    validate: (v) => (v.length === 0 ? "Branch name is required" : undefined),
  });

  if (p.isCancel(branch)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Write workflow file
  const workflowDir = path.join(gitRoot, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "update-docs.yml");

  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(
    workflowPath,
    generateWorkflow(branch, config.docsRepo, outputDir),
    "utf-8",
  );

  p.log.success(`Created ${path.relative(gitRoot, workflowPath)}`);

  p.note(
    [
      "Add these secrets to your GitHub repository:",
      "(Settings → Secrets and variables → Actions → New repository secret)",
      "",
      "  ANTHROPIC_API_KEY   — Your Anthropic API key",
      "  DOCS_DEPLOY_TOKEN   — GitHub PAT with repo scope",
      "                        (needed to push to the docs repo)",
      "",
      "To create the PAT:",
      "  1. Go to https://github.com/settings/tokens",
      "  2. Generate new token (classic) with 'repo' scope",
      "  3. Copy the token and add it as DOCS_DEPLOY_TOKEN",
      "",
      "Note: GITHUB_TOKEN is automatically provided by GitHub Actions",
      "      (used for reading the source repo during analysis).",
    ].join("\n"),
    "Required GitHub Secrets",
  );

  p.outro("CI/CD workflow is ready! Commit and push to activate.");
}
