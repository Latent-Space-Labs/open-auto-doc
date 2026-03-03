import fs from "node:fs";
import path from "node:path";
import type { AnalysisCache, AnalysisResult } from "./types.js";

export interface LoadedData {
  results: AnalysisResult[];
  cacheDir: string;
}

/**
 * Discover and load analysis cache files.
 *
 * Resolution order:
 * 1. --cache-dir <path>  → direct path to cache directory
 * 2. --project-dir <path> → scan for .autodocrc.json → read outputDir → find cache
 * 3. Default: scan CWD for .autodocrc.json or docs-site/.autodocrc.json
 */
export function loadAnalysisData(opts: {
  cacheDir?: string;
  projectDir?: string;
}): LoadedData {
  const cacheDir = resolveCacheDir(opts);
  if (!cacheDir) {
    throw new Error(
      "Could not find analysis cache. Run `open-auto-doc init` or `open-auto-doc generate` first, " +
      "or specify --cache-dir or --project-dir.",
    );
  }

  if (!fs.existsSync(cacheDir)) {
    throw new Error(`Cache directory does not exist: ${cacheDir}`);
  }

  const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith("-analysis.json"));
  if (files.length === 0) {
    throw new Error(`No analysis cache files found in: ${cacheDir}`);
  }

  const results: AnalysisResult[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(cacheDir, file), "utf-8"),
      ) as AnalysisCache;
      if (raw.result) {
        results.push(raw.result);
      }
    } catch {
      // Skip invalid cache files
    }
  }

  if (results.length === 0) {
    throw new Error(`No valid analysis results found in: ${cacheDir}`);
  }

  return { results, cacheDir };
}

function resolveCacheDir(opts: {
  cacheDir?: string;
  projectDir?: string;
}): string | null {
  // 1. Direct cache dir
  if (opts.cacheDir) {
    return path.resolve(opts.cacheDir);
  }

  // 2. Project dir → find .autodocrc.json → outputDir → .autodoc-cache
  if (opts.projectDir) {
    return findCacheFromConfig(path.resolve(opts.projectDir));
  }

  // 3. Default: scan CWD
  return findCacheFromConfig(process.cwd());
}

function findCacheFromConfig(dir: string): string | null {
  const candidates = [
    path.join(dir, ".autodocrc.json"),
    path.join(dir, "docs-site", ".autodocrc.json"),
  ];

  for (const configPath of candidates) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (config.outputDir) {
          const cacheDir = path.resolve(
            path.dirname(configPath),
            config.outputDir,
            ".autodoc-cache",
          );
          if (fs.existsSync(cacheDir)) {
            return cacheDir;
          }
        }
      } catch {
        // continue
      }
    }
  }

  // Also check for .autodoc-cache directly in the dir
  const directCache = path.join(dir, ".autodoc-cache");
  if (fs.existsSync(directCache)) {
    return directCache;
  }

  return null;
}
