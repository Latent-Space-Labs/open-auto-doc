import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { getGithubToken } from "../auth/token-store.js";

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

interface DeployOptions {
  dir?: string;
}

function loadConfig(): AutodocConfig | null {
  // Try CWD first, then docs-site/
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

function saveConfig(config: AutodocConfig) {
  // Save to CWD
  fs.writeFileSync(
    path.resolve(".autodocrc.json"),
    JSON.stringify(config, null, 2),
  );
  // Also save in outputDir if it exists
  if (config.outputDir && fs.existsSync(config.outputDir)) {
    fs.writeFileSync(
      path.join(config.outputDir, ".autodocrc.json"),
      JSON.stringify(config, null, 2),
    );
  }
}

function resolveDocsDir(config: AutodocConfig | null, dirOption?: string): string {
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

function getGitHubUsername(octokit: Octokit): Promise<string> {
  return octokit.rest.users.getAuthenticated().then((res) => res.data.login);
}

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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

  const octokit = new Octokit({ auth: token });

  // If docsRepo already set, just push updates
  if (config?.docsRepo) {
    p.log.info(`Docs repo already configured: ${config.docsRepo}`);

    const spinner = p.spinner();
    spinner.start("Pushing updates to docs repo...");

    try {
      // Check if git is initialized
      if (!fs.existsSync(path.join(docsDir, ".git"))) {
        exec("git init", docsDir);
        exec(`git remote add origin ${config.docsRepo}`, docsDir);
      }

      exec("git add -A", docsDir);

      // Check if there are changes to commit
      try {
        exec("git diff --cached --quiet", docsDir);
        spinner.stop("No changes to push.");
        p.outro("Docs are up to date!");
        return;
      } catch {
        // There are staged changes — continue
      }

      exec('git commit -m "Update documentation"', docsDir);
      exec("git push -u origin main", docsDir);
      spinner.stop("Pushed updates to docs repo.");
    } catch (err) {
      spinner.stop("Push failed.");
      p.log.error(`${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    p.outro("Docs updated! Vercel will auto-deploy from the push.");
    return;
  }

  // First-time setup: create GitHub repo and push
  const username = await getGitHubUsername(octokit);

  // Fetch user's organizations
  let orgs: Array<{ login: string }> = [];
  try {
    const { data } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
    orgs = data;
  } catch {
    // If we can't fetch orgs, just offer personal account
  }

  // Let user pick owner (personal account or org)
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
      p.cancel("Deploy cancelled.");
      process.exit(0);
    }
    owner = selected as string;
  }

  const isOrg = owner !== username;
  const defaultName = config?.repos?.[0]
    ? `${config.repos[0].name}-docs`
    : "my-project-docs";

  const repoName = await p.text({
    message: "Name for the docs GitHub repo:",
    initialValue: defaultName,
    validate: (v) => {
      if (!v || v.length === 0) return "Repo name is required";
      if (!/^[a-zA-Z0-9._-]+$/.test(v)) return "Invalid repo name";
    },
  });

  if (p.isCancel(repoName)) {
    p.cancel("Deploy cancelled.");
    process.exit(0);
  }

  const visibility = await p.select({
    message: "Repository visibility:",
    options: [
      { value: "public", label: "Public" },
      { value: "private", label: "Private" },
    ],
  });

  if (p.isCancel(visibility)) {
    p.cancel("Deploy cancelled.");
    process.exit(0);
  }

  const spinner = p.spinner();

  // Create GitHub repo (under personal account or org)
  spinner.start(`Creating GitHub repo ${owner}/${repoName}...`);
  let repoUrl: string;
  try {
    if (isOrg) {
      const { data } = await octokit.rest.repos.createInOrg({
        org: owner,
        name: repoName as string,
        private: visibility === "private",
        description: "Auto-generated documentation site",
        auto_init: false,
      });
      repoUrl = data.clone_url;
      spinner.stop(`Created ${data.full_name}`);
    } else {
      const { data } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName as string,
        private: visibility === "private",
        description: "Auto-generated documentation site",
        auto_init: false,
      });
      repoUrl = data.clone_url;
      spinner.stop(`Created ${data.full_name}`);
    }
  } catch (err: any) {
    spinner.stop("Failed to create repo.");
    if (err?.status === 422) {
      p.log.error(`Repository "${repoName}" already exists. Choose a different name or delete it first.`);
    } else {
      p.log.error(`GitHub API error: ${err?.message || err}`);
    }
    process.exit(1);
  }

  // Initialize git and push
  spinner.start("Pushing docs to GitHub...");
  try {
    // Ensure .gitignore exists
    const gitignorePath = path.join(docsDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "node_modules/\n.next/\n.source/\n");
    }

    // Init, add, commit, push
    if (!fs.existsSync(path.join(docsDir, ".git"))) {
      exec("git init -b main", docsDir);
    }

    exec("git add -A", docsDir);
    exec('git commit -m "Initial documentation site"', docsDir);

    // Set remote (remove first if exists)
    try {
      exec("git remote remove origin", docsDir);
    } catch {
      // No existing remote
    }

    const pushUrl = repoUrl.replace("https://", `https://${token}@`);
    exec(`git remote add origin ${pushUrl}`, docsDir);
    exec("git push -u origin main", docsDir);

    // Replace authenticated URL with clean URL for storage
    exec("git remote set-url origin " + repoUrl, docsDir);

    spinner.stop("Pushed to GitHub.");
  } catch (err) {
    spinner.stop("Git push failed.");
    p.log.error(`${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Save docsRepo to config
  const updatedConfig: AutodocConfig = config || {
    repos: [],
    outputDir: docsDir,
  };
  updatedConfig.docsRepo = repoUrl;
  saveConfig(updatedConfig);

  // Print Vercel instructions
  p.note(
    [
      "Connect your docs repo to Vercel for automatic deployments:",
      "",
      "  1. Go to https://vercel.com/new",
      "  2. Click 'Import Git Repository'",
      `  3. Select '${owner}/${repoName}'`,
      "  4. Click 'Deploy'",
      "",
      "Once connected, Vercel will auto-deploy on every push to the docs repo.",
    ].join("\n"),
    "Vercel Setup",
  );

  p.outro(`Docs repo: https://github.com/${owner}/${repoName}`);
}
