import * as p from "@clack/prompts";
import { getGithubToken } from "../auth/token-store.js";
import { loadConfig } from "../config.js";
import {
  getGitRoot,
  createCiWorkflow,
  showSecretsInstructions,
} from "../actions/setup-ci-action.js";

export async function setupCiCommand() {
  p.intro("open-auto-doc — CI/CD Setup");

  const config = loadConfig();
  if (!config?.docsRepo) {
    p.log.error(
      "No docs repo configured. Run `open-auto-doc deploy` first to create a docs GitHub repo.",
    );
    process.exit(1);
  }

  const token = getGithubToken();
  const isMultiRepo = config.repos.length > 1;

  if (isMultiRepo && !token) {
    p.log.error("Not authenticated. Run `open-auto-doc login` first (needed to push workflows to source repos).");
    process.exit(1);
  }

  const gitRoot = getGitRoot();
  if (!isMultiRepo && !gitRoot) {
    p.log.error("Not in a git repository. Run this command from your project root.");
    process.exit(1);
  }

  const result = await createCiWorkflow({
    gitRoot: gitRoot || process.cwd(),
    docsRepoUrl: config.docsRepo,
    outputDir: config.outputDir || "docs-site",
    token: token || undefined,
    config,
  });

  if (!result) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  showSecretsInstructions(isMultiRepo);

  if ("repos" in result) {
    p.outro("Per-repo CI workflows created! Add the required secrets to each source repo.");
  } else {
    p.outro("CI/CD workflow is ready! Commit and push to activate.");
  }
}
