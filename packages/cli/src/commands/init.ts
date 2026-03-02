import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { getGitRoot, createCiWorkflow } from "../actions/setup-ci-action.js";
import { analyzeRepository, analyzeCrossRepos } from "@latent-space-labs/auto-doc-analyzer";
import type { AnalysisResult, CrossRepoAnalysis } from "@latent-space-labs/auto-doc-analyzer";
import { scaffoldSite, writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";
import { ProgressTable, buildRepoSummary } from "../ui/progress-table.js";

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

  // Step 1: GitHub authentication
  let token = getGithubToken();
  if (!token) {
    p.log.info("Let's connect your GitHub account.");
    token = await authenticateWithGithub();
    setGithubToken(token);
  } else {
    p.log.success("Using saved GitHub credentials.");
  }

  // Step 2: Select repositories
  const repos = await pickRepos(token);
  p.log.info(`Selected ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`);

  // Step 3: Anthropic API key
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

  // Step 4: Model selection
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

  // Step 5: Clone all repos
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

  // Step 5: Analyze all repos in parallel
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
      });
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

  // Step 6: Cross-repo analysis (multi-repo only)
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

  // Step 7: Generate docs site
  const outputDir = path.resolve(options.output || "docs-site");
  const projectName = results.length === 1 ? results[0].repoName : "My Project";

  const genSpinner = p.spinner();

  // Scaffold site
  try {
    genSpinner.start("Scaffolding documentation site...");
    await scaffoldSite(outputDir, projectName, templateDir);
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
    await writeContent(contentDir, results, crossRepo);
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
  };
  try {
    saveConfig(config);
  } catch {
    // Non-critical
  }

  // Cleanup temp clones
  cleanup(clones);

  p.log.success("Documentation generated successfully!");

  // Optional deploy follow-up
  const shouldDeploy = await p.confirm({
    message: "Would you like to deploy your docs to GitHub?",
  });

  if (p.isCancel(shouldDeploy) || !shouldDeploy) {
    p.note(
      `cd ${path.relative(process.cwd(), outputDir)} && npm run dev`,
      "Next steps",
    );
    p.outro("Done!");
    return;
  }

  const deployResult = await createAndPushDocsRepo({
    token,
    docsDir: outputDir,
    config,
  });

  if (!deployResult) {
    p.note(
      `cd ${path.relative(process.cwd(), outputDir)} && npm run dev`,
      "Next steps",
    );
    p.outro("Done!");
    return;
  }

  // Optional CI setup follow-up
  const shouldSetupCi = await p.confirm({
    message: "Would you like to set up CI to auto-update docs on every push?",
  });

  if (p.isCancel(shouldSetupCi) || !shouldSetupCi) {
    showVercelInstructions(deployResult.owner, deployResult.repoName);
    p.outro(`Docs repo: https://github.com/${deployResult.owner}/${deployResult.repoName}`);
    return;
  }

  const gitRoot = getGitRoot();
  if (!gitRoot) {
    p.log.warn("Not in a git repository — skipping CI setup. Run `open-auto-doc setup-ci` from your project root later.");
    showVercelInstructions(deployResult.owner, deployResult.repoName);
    p.outro(`Docs repo: https://github.com/${deployResult.owner}/${deployResult.repoName}`);
    return;
  }

  const ciResult = await createCiWorkflow({
    gitRoot,
    docsRepoUrl: deployResult.repoUrl,
    outputDir,
    token,
    config,
  });

  // Secret verification is handled inside createCiWorkflow

  showVercelInstructions(deployResult.owner, deployResult.repoName);
  p.outro(`Docs repo: https://github.com/${deployResult.owner}/${deployResult.repoName}`);
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
