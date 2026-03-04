import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import type { AutodocConfig } from "../config.js";

export interface CiResult {
  workflowPath: string;
  branch: string;
}

export interface MultiRepoCiResult {
  repos: string[];
  branch: string;
}

/**
 * Returns the git root directory or null if not in a git repo.
 */
export function getGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
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
        run: npm install -g @latent-space-labs/open-auto-doc

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

function generatePerRepoWorkflow(branch: string, repoName: string, docsRepoUrl: string): string {
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

      - name: Install open-auto-doc
        run: npm install -g @latent-space-labs/open-auto-doc

      - name: Clone docs repo
        run: |
          git clone https://x-access-token:\${{ secrets.DOCS_DEPLOY_TOKEN }}@${docsRepoUrl.replace("https://", "")} docs-site

      - name: Generate documentation
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.DOCS_DEPLOY_TOKEN }}
        run: open-auto-doc generate --repo ${repoName} --incremental

      - name: Push to docs repo
        run: |
          cd docs-site
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "No documentation changes to push."
          else
            git commit -m "Update docs from \${{ github.repository }}@\${{ github.sha }}"
            git pull --rebase origin main || true
            git push
          fi
`;
}

/**
 * Prompts for branch, writes workflow YAML locally.
 * Used for single-repo configs or when run from a source repo.
 * Returns result or null if user cancels.
 */
export async function createCiWorkflow(params: {
  gitRoot: string;
  docsRepoUrl: string;
  outputDir: string;
  token?: string;
  config?: AutodocConfig;
  /** If provided, skip the branch prompt and use this value. */
  branch?: string;
}): Promise<CiResult | MultiRepoCiResult | null> {
  const { gitRoot, docsRepoUrl, outputDir, token, config } = params;

  // Multi-repo: push per-repo workflows via GitHub API
  if (config && config.repos.length > 1 && token) {
    return createCiWorkflowsMultiRepo({
      token,
      config,
      docsRepoUrl,
      branch: params.branch,
    });
  }

  // Single-repo: write workflow file locally
  const relativeOutputDir = path.relative(gitRoot, path.resolve(outputDir));

  p.log.info(`Docs repo: ${docsRepoUrl}`);
  p.log.info(`Output directory: ${relativeOutputDir}`);

  let branch: string | symbol;
  if (params.branch) {
    branch = params.branch;
  } else {
    branch = await p.text({
      message: "Which branch should trigger doc updates?",
      initialValue: "main",
      validate: (v) => (v.length === 0 ? "Branch name is required" : undefined),
    });

    if (p.isCancel(branch)) return null;
  }

  // Write workflow file
  const workflowDir = path.join(gitRoot, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "update-docs.yml");

  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(
    workflowPath,
    generateWorkflow(branch, docsRepoUrl, relativeOutputDir),
    "utf-8",
  );

  p.log.success(`Created ${path.relative(gitRoot, workflowPath)}`);

  // Interactive secret verification if we have a token
  if (token) {
    try {
      const origin = execSync("git remote get-url origin", {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      // Extract owner/repo from git remote URL
      const match = origin.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
      if (match) {
        const octokit = new Octokit({ auth: token });
        await verifySecretsInteractive(octokit, [match[1]]);
      } else {
        showSecretsInstructions(false);
      }
    } catch {
      showSecretsInstructions(false);
    }
  } else {
    showSecretsInstructions(false);
  }

  return { workflowPath, branch };
}

/**
 * Creates per-repo CI workflows for multi-repo configs.
 * Pushes a workflow file to each source repo via the GitHub API.
 */
async function createCiWorkflowsMultiRepo(params: {
  token: string;
  config: AutodocConfig;
  docsRepoUrl: string;
  branch?: string;
}): Promise<MultiRepoCiResult | null> {
  const { token, config, docsRepoUrl } = params;
  const octokit = new Octokit({ auth: token });

  p.log.info(`Setting up CI for ${config.repos.length} repositories`);
  p.log.info(`Docs repo: ${docsRepoUrl}`);

  let branch: string | symbol;
  if (params.branch) {
    branch = params.branch;
  } else {
    branch = await p.text({
      message: "Which branch should trigger doc updates?",
      initialValue: "main",
      validate: (v) => (v.length === 0 ? "Branch name is required" : undefined),
    });

    if (p.isCancel(branch)) return null;
  }

  const createdRepos: string[] = [];
  const workflowPath = ".github/workflows/update-docs.yml";

  for (const repo of config.repos) {
    const spinner = p.spinner();
    spinner.start(`Pushing workflow to ${repo.fullName}...`);

    try {
      const [owner, repoName] = repo.fullName.split("/");
      const workflowContent = generatePerRepoWorkflow(branch, repo.name, docsRepoUrl);
      const contentBase64 = Buffer.from(workflowContent).toString("base64");

      // Check if the file already exists (need its SHA to update)
      let existingSha: string | undefined;
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo: repoName,
          path: workflowPath,
        });
        if (!Array.isArray(data) && data.type === "file") {
          existingSha = data.sha;
        }
      } catch {
        // File doesn't exist yet — that's fine
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: workflowPath,
        message: "Add auto-documentation CI workflow",
        content: contentBase64,
        ...(existingSha ? { sha: existingSha } : {}),
      });

      createdRepos.push(repo.fullName);
      spinner.stop(`Created workflow in ${repo.fullName}`);
    } catch (err: any) {
      spinner.stop(`Failed for ${repo.fullName}`);
      if (err?.status === 404) {
        p.log.warn(
          `Could not push workflow to ${repo.fullName}: 404 Not Found. ` +
          `This usually means your GitHub token is missing the "workflow" scope. ` +
          `Run \`open-auto-doc logout\` then \`open-auto-doc login\` to get a token with updated permissions.`,
        );
      } else {
        p.log.warn(`Could not push workflow to ${repo.fullName}: ${err?.message || err}`);
      }
    }
  }

  if (createdRepos.length === 0) {
    p.log.error("Failed to create workflows in any repository.");
    return null;
  }

  p.log.success(`Created workflows in ${createdRepos.length}/${config.repos.length} repositories`);

  // Interactive secret verification
  await verifySecretsInteractive(octokit, createdRepos);

  return { repos: createdRepos, branch };
}

const REQUIRED_SECRETS = ["ANTHROPIC_API_KEY", "DOCS_DEPLOY_TOKEN"] as const;

/**
 * Checks whether a single Actions secret exists on a repo.
 * Returns true if found, false otherwise (including permission errors).
 */
async function checkSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
): Promise<boolean> {
  try {
    await octokit.rest.actions.getRepoSecret({ owner, repo, secret_name: secretName });
    return true;
  } catch {
    return false;
  }
}

/**
 * Interactive flow that guides the user through adding secrets to each repo,
 * then verifies they exist via the GitHub API.
 */
async function verifySecretsInteractive(
  octokit: Octokit,
  repos: string[],
): Promise<void> {
  // Offer to skip
  const shouldVerify = await p.confirm({
    message: "Would you like to verify secrets now? (you can add them later)",
    initialValue: true,
  });

  if (p.isCancel(shouldVerify) || !shouldVerify) {
    showSecretsInstructions(repos.length > 1);
    return;
  }

  // Show instructions once
  p.note(
    [
      "Each source repo needs two Actions secrets:",
      "",
      "  ANTHROPIC_API_KEY   — Your Anthropic API key",
      "  DOCS_DEPLOY_TOKEN   — GitHub PAT with repo scope",
      "",
      "To create the PAT:",
      "  1. Go to https://github.com/settings/tokens",
      "  2. Generate new token (classic) with 'repo' scope",
      "  3. Copy the token and add it as DOCS_DEPLOY_TOKEN",
    ].join("\n"),
    "Required GitHub Secrets",
  );

  const summary: Record<string, Record<string, boolean>> = {};

  for (const fullName of repos) {
    const [owner, repoName] = fullName.split("/");
    p.log.step(`Add secrets to ${fullName}`);
    p.log.message(`  https://github.com/${fullName}/settings/secrets/actions`);

    let allFound = false;
    while (!allFound) {
      await p.text({
        message: `Press enter when you've added the secrets to ${fullName}...`,
        defaultValue: "",
        placeholder: "",
      });

      const results: Record<string, boolean> = {};
      for (const secret of REQUIRED_SECRETS) {
        results[secret] = await checkSecret(octokit, owner, repoName, secret);
      }

      for (const secret of REQUIRED_SECRETS) {
        if (results[secret]) {
          p.log.success(`${secret} — found`);
        } else {
          p.log.warn(`${secret} — not found`);
        }
      }

      summary[fullName] = results;
      allFound = REQUIRED_SECRETS.every((s) => results[s]);

      if (!allFound) {
        const retry = await p.confirm({
          message: "Some secrets are missing. Would you like to try again?",
          initialValue: true,
        });
        if (p.isCancel(retry) || !retry) break;
      }
    }
  }

  // Final summary
  const lines: string[] = [];
  let allGreen = true;
  for (const fullName of repos) {
    const parts = REQUIRED_SECRETS.map((s) => {
      const ok = summary[fullName]?.[s] ?? false;
      if (!ok) allGreen = false;
      return ok ? `✓ ${s}` : `✗ ${s}`;
    });
    lines.push(`${fullName}  — ${parts.join("  ")}`);
  }

  if (allGreen) {
    p.note(lines.join("\n"), "All secrets verified!");
  } else {
    p.note(lines.join("\n"), "Secret status");
    p.log.warn("Some secrets are still missing — workflows will fail until they are added.");
  }
}

/**
 * Prints the GitHub secrets instructions note.
 */
export function showSecretsInstructions(multiRepo = false) {
  const repoNote = multiRepo
    ? "Add these secrets to EACH source repository:"
    : "Add these secrets to your GitHub repository:";

  p.note(
    [
      repoNote,
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
}
