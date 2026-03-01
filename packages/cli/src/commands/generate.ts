import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { getAnthropicKey, getGithubToken } from "../auth/token-store.js";
import { cloneRepo, cleanupClone, type ClonedRepo } from "../github/fetcher.js";
import { analyzeRepository, AnthropicProvider } from "@open-auto-doc/analyzer";
import type { AnalysisResult } from "@open-auto-doc/analyzer";
import { writeContent, writeMeta } from "@open-auto-doc/generator";

interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
  }>;
  outputDir: string;
}

export async function generateCommand() {
  p.intro("open-auto-doc — Regenerating documentation");

  // Look for .autodocrc.json in current directory
  const configPath = path.resolve(".autodocrc.json");
  if (!fs.existsSync(configPath)) {
    p.log.error("No .autodocrc.json found. Run `open-auto-doc init` first.");
    process.exit(1);
  }

  const config: AutodocConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const token = getGithubToken();
  const apiKey = getAnthropicKey();

  if (!token) {
    p.log.error("Not authenticated. Run `open-auto-doc login` first.");
    process.exit(1);
  }

  if (!apiKey) {
    p.log.error("No Anthropic API key found. Run `open-auto-doc init` first.");
    process.exit(1);
  }

  const provider = new AnthropicProvider(apiKey);
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
    );
    clones.push(cloned);
    spinner.stop(`Cloned ${repo.name}`);

    spinner.start(`Analyzing ${repo.name}...`);
    try {
      const result = await analyzeRepository({
        repoPath: cloned.localPath,
        repoName: repo.name,
        repoUrl: repo.htmlUrl,
        provider,
        onProgress: (_stage, message) => {
          spinner.message(message);
        },
      });
      results.push(result);
      spinner.stop(`Analyzed ${repo.name}`);
    } catch (err) {
      spinner.stop(`Failed: ${err}`);
    }
  }

  if (results.length > 0) {
    const contentDir = path.join(config.outputDir, "content", "docs");
    await writeContent(contentDir, results);
    await writeMeta(contentDir, results);
    p.log.success("Documentation regenerated!");
  }

  for (const clone of clones) {
    cleanupClone(clone);
  }

  p.outro("Done!");
}
