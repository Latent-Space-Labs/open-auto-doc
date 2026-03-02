import * as p from "@clack/prompts";
import path from "node:path";
import { getAnthropicKey, getGithubToken } from "../auth/token-store.js";
import { cloneRepo, cleanupClone, type ClonedRepo } from "../github/fetcher.js";
import { loadConfig } from "../config.js";
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

interface GenerateOptions {
  incremental?: boolean;
  force?: boolean;
  repo?: string;
}

export async function generateCommand(options: GenerateOptions) {
  p.intro("open-auto-doc — Regenerating documentation");

  const config = loadConfig();
  if (!config) {
    p.log.error("No .autodocrc.json found. Run `open-auto-doc init` first.");
    process.exit(1);
  }
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

  // Model selection
  const model = (await p.select({
    message: "Which model should analyze your repos?",
    options: [
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Fast & capable (recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest & cheapest" },
      { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "Most capable, slowest" },
    ],
  })) as string;

  if (p.isCancel(model)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  p.log.info(`Using ${model}`);

  const incremental = options.incremental && !options.force;
  const cacheDir = path.join(config.outputDir, ".autodoc-cache");

  // Determine which repos to analyze vs load from cache
  const targetRepoName = options.repo;
  let reposToAnalyze = config.repos;
  const cachedResults: AnalysisResult[] = [];

  if (targetRepoName) {
    const targetRepo = config.repos.find((r) => r.name === targetRepoName);
    if (!targetRepo) {
      p.log.error(`Repo "${targetRepoName}" not found in config. Available: ${config.repos.map((r) => r.name).join(", ")}`);
      process.exit(1);
    }
    reposToAnalyze = [targetRepo];

    // Load cached results for all other repos
    for (const repo of config.repos) {
      if (repo.name === targetRepoName) continue;
      const cached = loadCache(cacheDir, repo.name);
      if (cached) {
        cachedResults.push(cached.result);
        p.log.info(`Using cached analysis for ${repo.name}`);
      } else {
        p.log.warn(`No cached analysis for ${repo.name} — its docs will be stale until it pushes`);
      }
    }
  }

  // Phase 1: Clone repos to analyze
  const cloneSpinner = p.spinner();
  cloneSpinner.start(`Cloning ${reposToAnalyze.length} ${reposToAnalyze.length === 1 ? "repository" : "repositories"}...`);
  const clones: ClonedRepo[] = [];

  for (const repo of reposToAnalyze) {
    cloneSpinner.message(`Cloning ${repo.name}...`);
    try {
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
    } catch (err) {
      p.log.warn(`Failed to clone ${repo.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  cloneSpinner.stop(`Cloned ${clones.length}/${reposToAnalyze.length} ${reposToAnalyze.length === 1 ? "repository" : "repositories"}`);

  if (clones.length === 0) {
    p.log.error("No repositories were cloned.");
    process.exit(1);
  }

  // Phase 2: Analyze repos in parallel
  const analyzeSpinner = p.spinner();
  let completed = 0;
  const total = clones.length;
  const repoStages: Record<string, string> = {};

  const updateSpinner = () => {
    const lines = Object.entries(repoStages)
      .map(([name, status]) => `[${name}] ${status}`)
      .join(" | ");
    analyzeSpinner.message(`${completed}/${total} done — ${lines}`);
  };

  analyzeSpinner.start(`Analyzing ${total} ${total === 1 ? "repo" : "repos"} in parallel...`);

  const analysisPromises = clones.map(async (cloned) => {
    const repo = config.repos.find((r) => r.name === cloned.info.name)!;
    const repoName = repo.name;

    const callbacks = {
      onProgress: (stage: string, msg: string) => {
        repoStages[repoName] = `${stage}: ${msg}`;
        updateSpinner();
      },
    };

    try {
      let result: AnalysisResult;

      if (incremental) {
        const cached = loadCache(cacheDir, repo.name);
        if (cached) {
          result = await analyzeRepositoryIncremental({
            repoPath: cloned.localPath,
            repoName,
            repoUrl: repo.htmlUrl,
            apiKey,
            model,
            previousResult: cached.result,
            previousCommitSha: cached.commitSha,
            ...callbacks,
          });
        } else {
          result = await analyzeRepository({
            repoPath: cloned.localPath,
            repoName,
            repoUrl: repo.htmlUrl,
            apiKey,
            model,
            ...callbacks,
          });
        }
      } else {
        result = await analyzeRepository({
          repoPath: cloned.localPath,
          repoName,
          repoUrl: repo.htmlUrl,
          apiKey,
          model,
          ...callbacks,
        });
      }

      // Save cache
      try {
        const headSha = getHeadSha(cloned.localPath);
        saveCache(cacheDir, repo.name, headSha, result);
      } catch {
        // Cache save failure is non-fatal
      }

      completed++;
      delete repoStages[repoName];
      updateSpinner();
      return { repo: repoName, result };
    } catch (err) {
      completed++;
      delete repoStages[repoName];
      updateSpinner();
      p.log.warn(`[${repoName}] Analysis failed: ${err instanceof Error ? err.message : err}`);
      return { repo: repoName, result: null };
    }
  });

  const settled = await Promise.all(analysisPromises);
  const freshResults: AnalysisResult[] = settled
    .filter((s) => s.result !== null)
    .map((s) => s.result!);

  analyzeSpinner.stop(`Analyzed ${freshResults.length}/${total} ${total === 1 ? "repository" : "repositories"}`);

  // Combine fresh results with cached results from other repos
  const results: AnalysisResult[] = [...freshResults, ...cachedResults];

  if (results.length > 0) {
    // Phase 3: Cross-repo analysis (multi-repo only)
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

    // Phase 4: Generate docs
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
