import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scaffoldSite } from "@latent-space-labs/auto-doc-generator";
import { saveConfig } from "../config.js";
import type { AutodocConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ScaffoldOptions {
  output?: string;
  name?: string;
  repoPath?: string;
}

export async function scaffoldCommand(options: ScaffoldOptions) {
  const repoPath = path.resolve(options.repoPath || ".");
  const outputDir = path.resolve(options.output || "docs-site");
  const projectName = options.name || path.basename(repoPath);

  if (!fs.existsSync(repoPath)) {
    console.error(`Repo path does not exist: ${repoPath}`);
    process.exit(1);
  }

  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(path.join(templateDir, "package.json"))) {
    console.error(`Site template not found at: ${templateDir}`);
    process.exit(1);
  }

  const remote = detectGitRemote(repoPath);

  const cliVersion = getCliVersion();
  await scaffoldSite(outputDir, projectName, templateDir, cliVersion);

  const config: AutodocConfig = {
    repos: [{
      name: path.basename(repoPath),
      ...(remote?.fullName && { fullName: remote.fullName }),
      ...(remote?.cloneUrl && { cloneUrl: remote.cloneUrl }),
      ...(remote?.htmlUrl && { htmlUrl: remote.htmlUrl }),
      path: repoPath,
    }],
    outputDir,
    projectName,
    routineAction: "none",
  };
  saveConfig(config);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    cacheDir: path.join(outputDir, ".autodoc-cache"),
    repoName: path.basename(repoPath),
  }));
}

function detectGitRemote(repoPath: string): { fullName?: string; cloneUrl?: string; htmlUrl?: string } | null {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();

    if (!url) return null;

    const match = url.match(/[:\/]([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
    if (!match) return { cloneUrl: url };

    const [, owner, repo] = match;
    return {
      fullName: `${owner}/${repo}`,
      cloneUrl: url,
      htmlUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

function resolveTemplateDir(): string {
  const candidates = [
    path.resolve(__dirname, "site-template"),
    path.resolve(__dirname, "../../site-template"),
    path.resolve(__dirname, "../../../site-template"),
    path.resolve(__dirname, "../../../../packages/site-template"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(__dirname, "site-template");
}

function getCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    }
    const monoPkgPath = path.resolve(__dirname, "../../package.json");
    if (fs.existsSync(monoPkgPath)) {
      return JSON.parse(fs.readFileSync(monoPkgPath, "utf-8")).version;
    }
  } catch {}
  return "0.0.0";
}
