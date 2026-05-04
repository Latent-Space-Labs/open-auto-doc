import fs from "node:fs";
import path from "node:path";

export interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName?: string;     // optional: skill-mode local repos may not have a GitHub fullname
    cloneUrl?: string;     // optional: skill-mode local repos may not have a remote
    htmlUrl?: string;      // optional: skill-mode local repos may not have a remote
    path?: string;         // new: absolute or relative local path (skill mode uses ".")
  }>;
  outputDir: string;
  projectName?: string;
  docsRepo?: string;
  docsRepoOwner?: string;
  docsRepoName?: string;
  vercelUrl?: string;
  ciEnabled?: boolean;
  ciBranch?: string;
  routineAction?: "none" | "commit" | "push";  // new: Cowork routine post-regen behavior
}

export function loadConfig(): AutodocConfig | null {
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

export function saveConfig(config: AutodocConfig) {
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
