import * as p from "@clack/prompts";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { authenticateWithGithub } from "../auth/device-flow.js";
import {
  getAnthropicKey,
  getGithubToken,
  setAnthropicKey,
  setGithubToken,
} from "../auth/token-store.js";
import { cloneRepo, cleanupClone, type ClonedRepo } from "../github/fetcher.js";
import { pickRepos } from "../github/repo-picker.js";
import { saveConfig } from "../config.js";
import type { AutodocConfig } from "../config.js";
import { createAndPushDocsRepo, showVercelInstructions } from "../actions/deploy-action.js";
import { authenticateVercel, deployToVercel } from "../actions/vercel-action.js";
import { runBuildCheck } from "../actions/build-check.js";
import { getGitRoot, createCiWorkflow } from "../actions/setup-ci-action.js";
import { setupMcpConfig } from "./setup-mcp.js";
import { analyzeRepository, analyzeCrossRepos, saveCache, loadCache, getHeadSha, validateApiKey } from "@latent-space-labs/auto-doc-analyzer";
import type { AnalysisResult, CrossRepoAnalysis } from "@latent-space-labs/auto-doc-analyzer";
import { scaffoldSite, writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";
import type { ContentOptions } from "@latent-space-labs/auto-doc-generator";
import { ProgressTable, buildRepoSummary, formatToolActivity } from "../ui/progress-table.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initCommand(options: { output?: string }) {
  p.intro("open-auto-doc — AI-powered documentation generator");

  // Validate site template exists before doing anything else (fail fast)
  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(path.join(templateDir, "package.json"))) {
    p.log.error(
      `Site template not found at: ${templateDir}\n` +
      `This usually means the npm package was not built correctly.\n` +
      `Try reinstalling: npm install -g @latent-space-labs/open-auto-doc`
    );
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: CONFIGURATION — collect all answers before doing any work
  // ═══════════════════════════════════════════════════════════════════

  // --- GitHub authentication ---
  let token = getGithubToken();
  if (!token) {
    p.log.info("Let's connect your GitHub account.");
    token = await authenticateWithGithub();
    setGithubToken(token);
  } else {
    p.log.success("Using saved GitHub credentials.");
  }

  // --- Select repositories ---
  const repos = await pickRepos(token);
  p.log.info(`Selected ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`);

  // --- Project name (multi-repo only) ---
  let projectName: string | undefined;
  if (repos.length > 1) {
    const nameInput = await p.text({
      message: "What would you like to name this project?",
      placeholder: "My Project",
      validate: (v) => {
        if (!v || v.trim().length === 0) return "Project name is required";
      },
    });

    if (p.isCancel(nameInput)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    projectName = nameInput as string;
  }

  // --- Anthropic API key ---
  let apiKey = getAnthropicKey();
  if (!apiKey) {
    const keyInput = await p.text({
      message: "Enter your Anthropic API key",
      placeholder: "sk-ant-...",
      validate: (v) => {
        if (!v || !v.startsWith("sk-ant-")) return "Please enter a valid Anthropic API key";
      },
    });

    if (p.isCancel(keyInput)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    apiKey = keyInput as string;

    const saveKey = await p.confirm({
      message: "Save API key for future use?",
    });

    if (saveKey && !p.isCancel(saveKey)) {
      setAnthropicKey(apiKey);
    }
  } else {
    p.log.success("Using saved Anthropic API key.");
  }

  // --- Model selection ---
  const model = (await p.select({
    message: "Which model should analyze your repos?",
    options: [
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Fast & capable (recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest & cheapest" },
      { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "Most capable, slowest" },
    ],
  })) as string;

  if (p.isCancel(model)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  p.log.info(`Using ${model}`);

  // --- MCP server setup ---
  const shouldSetupMcp = await p.confirm({
    message: "Set up MCP server so Claude Code can query your docs?",
  });
  const wantsMcp = !p.isCancel(shouldSetupMcp) && shouldSetupMcp;

  // --- Deployment configuration ---
  const shouldDeploy = await p.confirm({
    message: "Would you like to deploy your docs to GitHub?",
  });
  const wantsDeploy = !p.isCancel(shouldDeploy) && shouldDeploy;

  // Pre-collected deploy settings
  let deployConfig: { owner: string; repoName: string; visibility: "public" | "private" } | undefined;
  let vercelToken: string | null = null;
  let vercelScope: { teamId: string | undefined } | undefined;
  let wantsVercel = false;
  let wantsCi = false;
  let ciBranch: string | undefined;

  if (wantsDeploy) {
    // Collect GitHub deploy options upfront
    const octokit = new Octokit({ auth: token });
    let username: string;
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      username = data.login;
    } catch {
      p.log.error("Failed to fetch GitHub user info.");
      process.exit(1);
    }

    let orgs: Array<{ login: string }> = [];
    try {
      const { data } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
      orgs = data;
    } catch {
      // If we can't fetch orgs, just offer personal account
    }

    const ownerOptions = [
      { value: username, label: username, hint: "Personal account" },
      ...orgs.map((org) => ({ value: org.login, label: org.login, hint: "Organization" })),
    ];

    let owner = username;
    if (ownerOptions.length > 1) {
      const selected = await p.select({
        message: "Where should the docs repo be created?",
        options: ownerOptions,
      });

      if (p.isCancel(selected)) {
        p.cancel("Operation cancelled");
        process.exit(0);
      }
      owner = selected as string;
    }

    const slug = projectName
      ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : repos[0]?.name;
    const defaultName = slug ? `${slug}-docs` : "my-project-docs";

    const repoNameInput = await p.text({
      message: "Name for the docs GitHub repo:",
      initialValue: defaultName,
      validate: (v) => {
        if (!v || v.length === 0) return "Repo name is required";
        if (!/^[a-zA-Z0-9._-]+$/.test(v)) return "Invalid repo name";
      },
    });

    if (p.isCancel(repoNameInput)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    const visibilityInput = await p.select({
      message: "Repository visibility:",
      options: [
        { value: "public", label: "Public" },
        { value: "private", label: "Private" },
      ],
    });

    if (p.isCancel(visibilityInput)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    deployConfig = {
      owner,
      repoName: repoNameInput as string,
      visibility: visibilityInput as "public" | "private",
    };

    // --- Vercel deployment ---
    const shouldDeployVercel = await p.confirm({
      message: "Would you like to deploy to Vercel? (auto-deploys on every push)",
    });
    wantsVercel = !p.isCancel(shouldDeployVercel) && shouldDeployVercel;

    if (wantsVercel) {
      vercelToken = await authenticateVercel();
      if (vercelToken) {
        // Collect Vercel scope (personal or team)
        try {
          const teamsRes = await fetch("https://api.vercel.com/v2/teams", {
            headers: { Authorization: `Bearer ${vercelToken}` },
          });
          const teamsData = (await teamsRes.json()) as any;
          const teams = teamsData?.teams ?? [];

          if (teams.length > 0) {
            const userRes = await fetch("https://api.vercel.com/v2/user", {
              headers: { Authorization: `Bearer ${vercelToken}` },
            });
            const userData = (await userRes.json()) as any;
            const vercelUsername = userData?.user?.username ?? "Personal";

            const scopeOptions = [
              { value: "__personal__", label: vercelUsername, hint: "Personal account" },
              ...teams.map((t: any) => ({ value: t.id, label: t.name || t.slug, hint: "Team" })),
            ];

            const selectedScope = await p.select({
              message: "Which Vercel scope should own this project?",
              options: scopeOptions,
            });

            if (p.isCancel(selectedScope)) {
              p.cancel("Operation cancelled");
              process.exit(0);
            }

            vercelScope = {
              teamId: selectedScope === "__personal__" ? undefined : (selectedScope as string),
            };
          } else {
            vercelScope = { teamId: undefined };
          }
        } catch {
          // If we can't fetch teams, just use personal scope
          vercelScope = { teamId: undefined };
        }
      } else {
        wantsVercel = false;
      }
    }

    // --- CI setup ---
    const shouldSetupCi = await p.confirm({
      message: "Would you like to set up CI to auto-update docs on every push?",
    });
    wantsCi = !p.isCancel(shouldSetupCi) && shouldSetupCi;

    if (wantsCi) {
      const branchInput = await p.text({
        message: "Which branch should trigger doc updates?",
        initialValue: "main",
        validate: (v) => (v.length === 0 ? "Branch name is required" : undefined),
      });

      if (p.isCancel(branchInput)) {
        p.cancel("Operation cancelled");
        process.exit(0);
      }
      ciBranch = branchInput as string;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: EXECUTION — sit back while everything runs
  // ═══════════════════════════════════════════════════════════════════

  p.log.step("All configured! Starting analysis and generation...");

  // Pre-flight: validate API key and credit balance before expensive work
  const preflight = p.spinner();
  preflight.start("Validating API key...");
  const keyCheck = await validateApiKey(apiKey, model);
  if (!keyCheck.valid) {
    preflight.stop("API key validation failed");
    p.log.error(keyCheck.error || "Invalid API key or insufficient credits.");
    p.log.info("Check your API key at https://console.anthropic.com/settings/keys");
    process.exit(1);
  }
  preflight.stop("API key validated");

  const outputDir = path.resolve(options.output || "docs-site");
  const cacheDir = path.join(outputDir, ".autodoc-cache");

  // Clone all repos
  const cloneSpinner = p.spinner();
  cloneSpinner.start(`Cloning ${repos.length} repositories...`);
  const clones: ClonedRepo[] = [];

  for (const repo of repos) {
    cloneSpinner.message(`Cloning ${repo.name}...`);
    try {
      const cloned = cloneRepo(repo, token);
      clones.push(cloned);
    } catch (err) {
      p.log.warn(`Failed to clone ${repo.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  cloneSpinner.stop(`Cloned ${clones.length}/${repos.length} repositories`);

  if (clones.length === 0) {
    p.log.error("No repositories were cloned.");
    process.exit(1);
  }

  // Analyze all repos in parallel
  const total = clones.length;
  const progressTable = new ProgressTable({ repos: clones.map((c) => c.info.name) });
  progressTable.start();

  const analysisPromises = clones.map(async (cloned) => {
    const repoName = cloned.info.name;
    progressTable.update(repoName, { status: "active", message: "Starting..." });
    try {
      const result = await analyzeRepository({
        repoPath: cloned.localPath,
        repoName,
        repoUrl: cloned.info.htmlUrl,
        apiKey,
        model,
        onProgress: (stage, msg) => {
          progressTable.update(repoName, { status: "active", message: `${stage}: ${msg}` });
        },
        onToolUse: (event) => {
          progressTable.update(repoName, { activity: formatToolActivity(event) });
        },
      });
      // Save analysis cache for MCP server
      try {
        const headSha = getHeadSha(cloned.localPath);
        saveCache(cacheDir, repoName, headSha, result);
      } catch {
        // Cache save failure is non-fatal
      }

      progressTable.update(repoName, { status: "done", summary: buildRepoSummary(result) });
      return { repo: repoName, result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      progressTable.update(repoName, { status: "failed", error: errMsg });
      p.log.warn(`[${repoName}] Analysis failed: ${errMsg}`);
      return { repo: repoName, result: null };
    }
  });

  const settled = await Promise.all(analysisPromises);
  progressTable.stop();

  const results: AnalysisResult[] = settled
    .filter((s) => s.result !== null)
    .map((s) => s.result!);

  const { done, failed } = progressTable.getSummary();
  p.log.step(
    `Analyzed ${done}/${total} repositories` +
    (failed > 0 ? ` (${failed} failed)` : "") +
    (results.length > 0
      ? ` — ${results.reduce((n, r) => n + r.apiEndpoints.length, 0)} endpoints, ${results.reduce((n, r) => n + r.components.length, 0)} components, ${results.reduce((n, r) => n + r.diagrams.length, 0)} diagrams`
      : ""),
  );

  if (results.length === 0) {
    p.log.error("No repositories were successfully analyzed.");
    cleanup(clones);
    process.exit(1);
  }

  // Cross-repo analysis (multi-repo only)
  let crossRepo: CrossRepoAnalysis | undefined;
  if (results.length > 1) {
    const crossSpinner = p.spinner();
    crossSpinner.start("Analyzing cross-repository relationships...");
    try {
      crossRepo = await analyzeCrossRepos(results, apiKey, model, (text) => {
        crossSpinner.message(text.slice(0, 80));
      });
      crossSpinner.stop(`Cross-repo analysis complete — ${crossRepo.repoRelationships.length} relationships found`);
    } catch (err) {
      crossSpinner.stop("Cross-repo analysis failed (non-fatal)");
      p.log.warn(`Cross-repo error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Generate docs site
  if (!projectName) {
    projectName = results.length === 1 ? results[0].repoName : "My Project";
  }

  const genSpinner = p.spinner();

  // Scaffold site
  try {
    genSpinner.start("Scaffolding documentation site...");
    const cliVersion = getCliVersion();
    await scaffoldSite(outputDir, projectName, templateDir, cliVersion);
    genSpinner.stop("Site scaffolded");
  } catch (err) {
    genSpinner.stop("Scaffold failed");
    p.log.error(`Scaffold error: ${err instanceof Error ? err.stack || err.message : err}`);
    cleanup(clones);
    process.exit(1);
  }

  // Write content
  try {
    genSpinner.start("Writing documentation content...");
    const contentDir = path.join(outputDir, "content", "docs");

    // Build repoStatus from cache + repo info
    const contentOptions: ContentOptions = {};
    if (results.length > 1) {
      const repoStatus: ContentOptions["repoStatus"] = {};
      for (const repo of repos) {
        const cached = loadCache(cacheDir, repo.name);
        repoStatus[repo.name] = {
          htmlUrl: repo.htmlUrl,
          lastAnalyzed: cached?.timestamp,
          commitSha: cached?.commitSha,
        };
      }
      contentOptions.repoStatus = repoStatus;
    }

    await writeContent(contentDir, results, crossRepo, undefined, contentOptions);
    await writeMeta(contentDir, results, crossRepo);
    genSpinner.stop("Documentation content written");
  } catch (err) {
    genSpinner.stop("Content writing failed");
    p.log.error(`Content error: ${err instanceof Error ? err.stack || err.message : err}`);
    cleanup(clones);
    process.exit(1);
  }

  // Save config for regeneration
  const config: AutodocConfig = {
    repos: repos.map((r) => ({
      name: r.name,
      fullName: r.fullName,
      cloneUrl: r.cloneUrl,
      htmlUrl: r.htmlUrl,
    })),
    outputDir,
    ...(projectName !== results[0]?.repoName && { projectName }),
  };
  try {
    saveConfig(config);
  } catch {
    // Non-critical
  }

  // Cleanup temp clones
  cleanup(clones);

  // Build quality check — verifies MDX compiles, auto-fixes errors
  try {
    await runBuildCheck({ docsDir: outputDir, apiKey, model });
  } catch (err) {
    p.log.warn(`Build check skipped: ${err instanceof Error ? err.message : err}`);
  }

  p.log.success("Documentation generated successfully!");

  // MCP server setup (if opted in during config phase)
  if (wantsMcp) {
    await setupMcpConfig({ outputDir });
  }

  // Start dev server so the user can preview
  let devServer: ChildProcess | undefined;
  const devPort = await findFreePort(3000);

  try {
    devServer = startDevServer(outputDir, devPort);
    p.log.success(`Documentation site running at http://localhost:${devPort}`);
    p.log.info("Open the link above to preview your docs site.");
  } catch {
    p.log.warn("Could not start preview server. You can run it manually:");
    p.log.info(`  cd ${path.relative(process.cwd(), outputDir)} && npm run dev`);
  }

  // GitHub deploy (if opted in during config phase)
  if (!wantsDeploy || !deployConfig) {
    if (devServer) {
      killDevServer(devServer);
    }
    p.note(
      `cd ${path.relative(process.cwd(), outputDir)} && npm run dev`,
      "To start the dev server again",
    );
    p.outro("Done!");
    process.exit(0);
  }

  // Kill dev server before deploying
  if (devServer) {
    killDevServer(devServer);
  }

  const deployResult = await createAndPushDocsRepo({
    token,
    docsDir: outputDir,
    config,
    preCollected: deployConfig,
  });

  if (!deployResult) {
    p.note(
      `cd ${path.relative(process.cwd(), outputDir)} && npm run dev`,
      "Next steps",
    );
    p.outro("Done!");
    process.exit(0);
  }

  // Vercel deploy (if opted in during config phase)
  let vercelDeploymentUrl: string | undefined;
  if (wantsVercel && vercelToken) {
    const vercelResult = await deployToVercel({
      token: vercelToken,
      githubOwner: deployResult.owner,
      githubRepo: deployResult.repoName,
      docsDir: outputDir,
      config,
      scope: vercelScope,
    });
    if (vercelResult) {
      p.log.success(`Live at: ${vercelResult.deploymentUrl}`);
      vercelDeploymentUrl = vercelResult.deploymentUrl;
    }
  }

  // CI setup (if opted in during config phase)
  if (wantsCi) {
    const gitRoot = getGitRoot();
    if (!gitRoot) {
      p.log.warn("Not in a git repository — skipping CI setup. Run `open-auto-doc setup-ci` from your project root later.");
    } else {
      await createCiWorkflow({
        gitRoot,
        docsRepoUrl: deployResult.repoUrl,
        outputDir,
        token,
        config,
        branch: ciBranch,
      });

      // Save CI info to config
      config.ciEnabled = true;
      config.ciBranch = ciBranch || "main";
      try {
        saveConfig(config);
      } catch {
        // Non-critical
      }
    }
  }

  // Show final summary with all relevant URLs
  const docsRepoUrl = `https://github.com/${deployResult.owner}/${deployResult.repoName}`;

  if (vercelDeploymentUrl) {
    p.note(
      `Docs repo:  ${docsRepoUrl}\nLive site:  ${vercelDeploymentUrl}`,
      "Your documentation is ready!",
    );
    p.outro(vercelDeploymentUrl);
  } else {
    showVercelInstructions(deployResult.owner, deployResult.repoName);
    p.outro(`Docs repo: ${docsRepoUrl}`);
  }

  process.exit(0);
}

function resolveTemplateDir(): string {
  // Candidates ordered: bundled in dist (npm install), then monorepo dev paths
  const candidates = [
    path.resolve(__dirname, "site-template"),              // dist/site-template (npm global install)
    path.resolve(__dirname, "../../site-template"),         // monorepo: packages/site-template
    path.resolve(__dirname, "../../../site-template"),      // monorepo alt
    path.resolve(__dirname, "../../../../packages/site-template"), // monorepo from nested dist
  ];

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, "package.json");
    if (fs.existsSync(pkgPath)) return candidate;
  }

  // Fallback to bundled location
  return path.resolve(__dirname, "site-template");
}

function cleanup(clones: ClonedRepo[]) {
  for (const clone of clones) {
    cleanupClone(clone);
  }
}

function startDevServer(docsDir: string, port: number): ChildProcess {
  // Install deps first (needed for fresh scaffolds)
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: docsDir,
    stdio: "ignore",
    detached: true,
  });

  // Unref so the parent process can exit if the user ctrl+c's
  child.unref();
  return child;
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await isPortInUse(port)) {
    port++;
  }
  return port;
}

function getCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    }
    // Fallback: monorepo dev path
    const monoPkgPath = path.resolve(__dirname, "../../package.json");
    if (fs.existsSync(monoPkgPath)) {
      return JSON.parse(fs.readFileSync(monoPkgPath, "utf-8")).version;
    }
  } catch {
    // ignore
  }
  return "0.0.0";
}

function killDevServer(child: ChildProcess) {
  try {
    // Kill the process group (negative PID) to also kill child processes
    if (child.pid) {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // Already dead
  }
}
