import fs from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "./types.js";

const CACHE_VERSION = 3;

export interface AnalysisCache {
  version: number;
  commitSha: string;
  timestamp: string;
  result: AnalysisResult;
}

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cacheFilePath(cacheDir: string, repoSlug: string): string {
  return path.join(cacheDir, `${slugify(repoSlug)}-analysis.json`);
}

export function saveCache(
  cacheDir: string,
  repoSlug: string,
  commitSha: string,
  result: AnalysisResult,
): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cache: AnalysisCache = {
    version: CACHE_VERSION,
    commitSha,
    timestamp: new Date().toISOString(),
    result,
  };
  fs.writeFileSync(cacheFilePath(cacheDir, repoSlug), JSON.stringify(cache), "utf-8");
}

export function loadCache(
  cacheDir: string,
  repoSlug: string,
): AnalysisCache | null {
  const filePath = cacheFilePath(cacheDir, repoSlug);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AnalysisCache;
    if (raw.version !== CACHE_VERSION) return null;
    if (!raw.commitSha || !raw.result) return null;
    return raw;
  } catch {
    return null;
  }
}
