import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { getAnthropicKey, getGithubToken } from "../auth/token-store.js";
import { cloneRepo, cleanupClone, type ClonedRepo } from "../github/fetcher.js";
import {
  analyzeRepository,
  analyzeRepositoryIncremental,
  analyzeCrossRepos,
  saveCache,
  loadCache,
  getHeadSha,
} from "@latent-space-labs/auto-doc-analyzer";
import type { AnalysisResult, CrossRepoAnalysis } from "@latent-space-labs/auto-doc-analyzer";
import { writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";

interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
  }>;
  outputDir: string;
}

interface GenerateOptions {
  incremental?: boolean;
  force?: boolean;
}

export async function generateCommand(options: GenerateOptions) {
  p.intro("open-auto-doc — Regenerating documentation");

  // Look for .autodocrc.json in CWD, then in docs-site/
  let configPath = path.resolve(".autodocrc.json");
  if (!fs.existsSync(configPath)) {
    configPath = path.resolve("docs-site", ".autodocrc.json");
  }
  if (!fs.existsSync(configPath)) {
    p.log.error("No .autodocrc.json found. Run `open-auto-doc init` first.");
    process.exit(1);
  }

  const config: AutodocConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const token = getGithubToken();
  const apiKey = getAnthropicKey();

  if (!token) {
    p.log.error("Not authenticated. Run `open-auto-doc login` or set GITHUB_TOKEN env var.");
    process.exit(1);
  }

  if (!apiKey) {
    p.log.error("No Anthropic API key found. Run `open-auto-doc init` or set ANTHROPIC_API_KEY env var.");
    process.exit(1);
  }

  const incremental = options.incremental && !options.force;
  const cacheDir = path.join(config.outputDir, ".autodoc-cache");

  const results: AnalysisResult[] = [];
  const clones: ClonedRepo[] = [];

  for (const repo of config.repos) {
    const spinner = p.spinner();
    spinner.start(`Cloning ${repo.name}...`);

    const cloned = cloneRepo(
      {
        ...repo,
        description: null,
        defaultBranch: "main",
        language: null,
        private: false,
      },
      token,
      { shallow: !incremental },
    );
    clones.push(cloned);
    spinner.stop(`Cloned ${repo.name}`);

    spinner.start(`Analyzing ${repo.name}...`);
    try {
      let result: AnalysisResult;

      if (incremental) {
        const cached = loadCache(cacheDir, repo.name);
        if (cached) {
          spinner.message(`Incremental analysis (cached from ${cached.commitSha.slice(0, 7)})...`);
          result = await analyzeRepositoryIncremental({
            repoPath: cloned.localPath,
            repoName: repo.name,
            repoUrl: repo.htmlUrl,
            apiKey,
            previousResult: cached.result,
            previousCommitSha: cached.commitSha,
            onProgress: (_stage, message) => {
              spinner.message(message);
            },
            onAgentMessage: (text) => {
              spinner.message(text);
            },
          });
        } else {
          spinner.message("No cache found, running full analysis...");
          result = await analyzeRepository({
            repoPath: cloned.localPath,
            repoName: repo.name,
            repoUrl: repo.htmlUrl,
            apiKey,
            onProgress: (_stage, message) => {
              spinner.message(message);
            },
            onAgentMessage: (text) => {
              spinner.message(text);
            },
          });
        }
      } else {
        result = await analyzeRepository({
          repoPath: cloned.localPath,
          repoName: repo.name,
          repoUrl: repo.htmlUrl,
          apiKey,
          onProgress: (_stage, message) => {
            spinner.message(message);
          },
          onAgentMessage: (text) => {
            spinner.message(text);
          },
        });
      }

      // Save cache for future incremental runs
      try {
        const headSha = getHeadSha(cloned.localPath);
        saveCache(cacheDir, repo.name, headSha, result);
      } catch {
        // Cache save failure is non-fatal
      }

      results.push(result);
      spinner.stop(`Analyzed ${repo.name}`);
    } catch (err) {
      spinner.stop(`Failed: ${err}`);
    }
  }

  if (results.length > 0) {
    // Cross-repo analysis (multi-repo only)
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

    const contentDir = path.join(config.outputDir, "content", "docs");
    await writeContent(contentDir, results, crossRepo);
    await writeMeta(contentDir, results, crossRepo);
    p.log.success("Documentation regenerated!");
  }

  for (const clone of clones) {
    cleanupClone(clone);
  }

  p.outro("Done!");
}
