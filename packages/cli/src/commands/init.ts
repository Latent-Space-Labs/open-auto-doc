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
import { analyzeRepository, analyzeCrossRepos } from "@latent-space-labs/auto-doc-analyzer";
import type { AnalysisResult, CrossRepoAnalysis } from "@latent-space-labs/auto-doc-analyzer";
import { scaffoldSite, writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initCommand(options: { output?: string }) {
  p.intro("open-auto-doc — AI-powered documentation generator");

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

  // Step 4: Clone and analyze repos
  const results: AnalysisResult[] = [];
  const clones: ClonedRepo[] = [];

  for (const repo of repos) {
    const spinner = p.spinner();

    spinner.start(`Cloning ${repo.name}...`);
    try {
      const cloned = cloneRepo(repo, token);
      clones.push(cloned);
      spinner.stop(`Cloned ${repo.name}`);
    } catch (err) {
      spinner.stop(`Failed to clone ${repo.name}`);
      p.log.error(`Clone error: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const cloned = clones[clones.length - 1];
    spinner.start(`Analyzing ${repo.name}...`);
    try {
      const result = await analyzeRepository({
        repoPath: cloned.localPath,
        repoName: repo.name,
        repoUrl: repo.htmlUrl,
        apiKey,
        onProgress: (stage, message) => {
          spinner.stop(`[${repo.name}] ${message}`);
          spinner.start(`Analyzing ${repo.name} — ${stage}...`);
        },
        onAgentMessage: (text) => {
          spinner.message(text);
        },
      });
      results.push(result);
      spinner.stop(`Analyzed ${repo.name} — ${result.apiEndpoints.length} endpoints, ${result.components.length} components, ${result.dataModels.length} models, ${result.diagrams.length} diagrams`);
    } catch (err) {
      spinner.stop(`Failed to analyze ${repo.name}`);
      p.log.error(`Analysis error: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (results.length === 0) {
    p.log.error("No repositories were successfully analyzed.");
    cleanup(clones);
    process.exit(1);
  }

  // Step 4b: Cross-repo analysis (multi-repo only)
  let crossRepo: CrossRepoAnalysis | undefined;
  if (results.length > 1) {
    const crossSpinner = p.spinner();
    crossSpinner.start("Analyzing cross-repository relationships...");
    try {
      crossRepo = await analyzeCrossRepos(results, apiKey);
      crossSpinner.stop(`Cross-repo analysis complete — ${crossRepo.repoRelationships.length} relationships found`);
    } catch (err) {
      crossSpinner.stop("Cross-repo analysis failed (non-fatal)");
      p.log.warn(`Cross-repo error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Step 5: Generate docs site
  const outputDir = path.resolve(options.output || "docs-site");
  const projectName = results.length === 1 ? results[0].repoName : "My Project";

  const genSpinner = p.spinner();

  // Scaffold site
  try {
    genSpinner.start("Scaffolding documentation site...");
    const templateDir = resolveTemplateDir();
    p.log.info(`Using template from: ${templateDir}`);
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

  // Save config for regeneration (in both outputDir and CWD)
  try {
    const config = {
      repos: repos.map((r) => ({
        name: r.name,
        fullName: r.fullName,
        cloneUrl: r.cloneUrl,
        htmlUrl: r.htmlUrl,
      })),
      outputDir,
    };
    const configJson = JSON.stringify(config, null, 2);
    fs.writeFileSync(path.join(outputDir, ".autodocrc.json"), configJson);
    // Also save in CWD so deploy/generate/setup-ci can find it
    const cwdConfig = path.resolve(".autodocrc.json");
    if (cwdConfig !== path.join(outputDir, ".autodocrc.json")) {
      fs.writeFileSync(cwdConfig, configJson);
    }
  } catch {
    // Non-critical
  }

  // Cleanup temp clones
  cleanup(clones);

  // Done!
  p.note(
    `cd ${path.relative(process.cwd(), outputDir)} && npm run dev`,
    "Next steps",
  );

  p.outro("Documentation generated successfully!");
}

function resolveTemplateDir(): string {
  // Look for site-template in the monorepo or installed location
  const candidates = [
    path.resolve(__dirname, "../../site-template"),
    path.resolve(__dirname, "../../../site-template"),
    path.resolve(__dirname, "../../../../packages/site-template"),
  ];

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, "package.json");
    if (fs.existsSync(pkgPath)) return candidate;
  }

  // Fallback: use relative path from CLI dist
  return path.resolve(__dirname, "../../site-template");
}

function cleanup(clones: ClonedRepo[]) {
  for (const clone of clones) {
    cleanupClone(clone);
  }
}
