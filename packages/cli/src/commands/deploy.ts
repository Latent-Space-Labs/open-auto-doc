import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { getGithubToken } from "../auth/token-store.js";
import { loadConfig } from "../config.js";
import {
  createAndPushDocsRepo,
  pushUpdates,
  showVercelInstructions,
} from "../actions/deploy-action.js";

interface DeployOptions {
  dir?: string;
}

function resolveDocsDir(config: ReturnType<typeof loadConfig>, dirOption?: string): string {
  if (dirOption) {
    const resolved = path.resolve(dirOption);
    if (!fs.existsSync(resolved)) {
      p.log.error(`Directory not found: ${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  if (config?.outputDir && fs.existsSync(path.resolve(config.outputDir))) {
    return path.resolve(config.outputDir);
  }

  if (fs.existsSync(path.resolve("docs-site"))) {
    return path.resolve("docs-site");
  }

  p.log.error(
    "Could not find docs site directory. Use --dir to specify the path, or run `open-auto-doc init` first.",
  );
  process.exit(1);
}

export async function deployCommand(options: DeployOptions) {
  p.intro("open-auto-doc — Deploy docs to GitHub");

  const token = getGithubToken();
  if (!token) {
    p.log.error("Not authenticated. Run `open-auto-doc login` first.");
    process.exit(1);
  }

  const config = loadConfig();
  const docsDir = resolveDocsDir(config, options.dir);
  p.log.info(`Docs directory: ${docsDir}`);

  // If docsRepo already set, just push updates
  if (config?.docsRepo) {
    p.log.info(`Docs repo already configured: ${config.docsRepo}`);

    const pushed = await pushUpdates({ token, docsDir, docsRepo: config.docsRepo });
    if (pushed) {
      p.outro("Docs updated! Vercel will auto-deploy from the push.");
    } else {
      p.outro("Docs are up to date!");
    }
    return;
  }

  // First-time setup: create GitHub repo and push
  const result = await createAndPushDocsRepo({
    token,
    docsDir,
    config: config || { repos: [], outputDir: docsDir },
  });

  if (!result) {
    p.cancel("Deploy cancelled.");
    process.exit(0);
  }

  showVercelInstructions(result.owner, result.repoName);
  p.outro(`Docs repo: https://github.com/${result.owner}/${result.repoName}`);
}
