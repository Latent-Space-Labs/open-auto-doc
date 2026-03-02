import { execSync } from "node:child_process";
import type { StaticAnalysis } from "./types.js";

export type DiffStatus = "A" | "M" | "D" | "R";

export interface DiffEntry {
  status: DiffStatus;
  filePath: string;
}

export type AffectedSection =
  | "architecture"
  | "api"
  | "components"
  | "dataModels"
  | "features"
  | "gettingStarted"
  | "configuration"
  | "businessLogic"
  | "errorHandling";

export interface DiffResult {
  entries: DiffEntry[];
  affectedSections: Set<AffectedSection>;
  fullRegenRequired: boolean;
}

const FULL_REGEN_THRESHOLD_PCT = 0.3;
const FULL_REGEN_THRESHOLD_ABS = 50;

const SECTION_PATTERNS: Record<AffectedSection, RegExp[]> = {
  api: [
    /routes?\//i,
    /api\//i,
    /controllers?\//i,
    /handlers?\//i,
    /endpoints?\//i,
    /middleware\//i,
  ],
  components: [
    /components?\//i,
    /\.tsx$/,
    /\.vue$/,
    /\.svelte$/,
  ],
  dataModels: [
    /models?\//i,
    /schemas?\//i,
    /entities?\//i,
    /prisma\//i,
    /migrations?\//i,
    /\.prisma$/,
  ],
  architecture: [
    /package\.json$/,
    /tsconfig/,
    /\.config\.(ts|js|mjs|cjs)$/,
    /docker/i,
    /\.env/,
    /webpack|vite|rollup|esbuild/i,
  ],
  features: [
    /readme/i,
    /cli\//i,
    /commands?\//i,
    /pages?\//i,
    /views?\//i,
    /features?\//i,
    /tests?\//i,
    /specs?\//i,
  ],
  gettingStarted: [
    /readme/i,
    /install/i,
    /setup/i,
    /contributing/i,
    /getting.?started/i,
  ],
  configuration: [
    /\.env/i,
    /config\//i,
    /settings\//i,
    /\.config\.(ts|js|mjs|cjs)$/,
  ],
  businessLogic: [
    /services?\//i,
    /domain\//i,
    /rules?\//i,
    /validators?\//i,
    /policies?\//i,
    /workflows?\//i,
  ],
  errorHandling: [
    /errors?\//i,
    /exceptions?\//i,
    /middleware\//i,
  ],
};

export function computeDiff(repoPath: string, fromSha: string): DiffEntry[] {
  try {
    const output = execSync(`git diff --name-status ${fromSha}..HEAD`, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...parts] = line.split("\t");
        const normalizedStatus = status.charAt(0) as DiffStatus;
        // For renames, use the new file path (second part)
        const filePath = parts.length > 1 ? parts[1] : parts[0];
        return { status: normalizedStatus, filePath };
      });
  } catch {
    // If git diff fails (e.g., sha not in history), signal full regen
    return [];
  }
}

export function classifyChanges(
  entries: DiffEntry[],
  staticAnalysis: StaticAnalysis,
): DiffResult {
  const totalFiles = staticAnalysis.totalFiles;
  const changedCount = entries.length;

  // Threshold check
  if (
    changedCount > FULL_REGEN_THRESHOLD_ABS ||
    (totalFiles > 0 && changedCount / totalFiles > FULL_REGEN_THRESHOLD_PCT)
  ) {
    return {
      entries,
      affectedSections: new Set<AffectedSection>([
        "architecture",
        "api",
        "components",
        "dataModels",
        "features",
        "gettingStarted",
        "configuration",
        "businessLogic",
        "errorHandling",
      ]),
      fullRegenRequired: true,
    };
  }

  const affected = new Set<AffectedSection>();

  for (const entry of entries) {
    for (const [section, patterns] of Object.entries(SECTION_PATTERNS)) {
      if (patterns.some((p) => p.test(entry.filePath))) {
        affected.add(section as AffectedSection);
      }
    }
  }

  // If nothing matched specific patterns but files changed, re-run architecture
  if (entries.length > 0 && affected.size === 0) {
    affected.add("architecture");
  }

  // Getting started always regenerates if architecture changes
  if (affected.has("architecture")) {
    affected.add("gettingStarted");
  }

  return {
    entries,
    affectedSections: affected,
    fullRegenRequired: false,
  };
}

export function getHeadSha(repoPath: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}
