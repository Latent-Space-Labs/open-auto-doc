import fs from "node:fs";
import path from "node:path";

export interface AutodocConfig {
  repos: Array<{
    name: string;
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
  }>;
  outputDir: string;
  projectName?: string;
  docsRepo?: string;
  vercelUrl?: string;
  ciEnabled?: boolean;
  ciBranch?: string;
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
