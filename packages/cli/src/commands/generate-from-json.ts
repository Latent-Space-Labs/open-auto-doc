import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { writeContent, writeMeta } from "@latent-space-labs/auto-doc-generator";
import type { AnalysisResult } from "@latent-space-labs/auto-doc-analyzer";

interface GenerateFromJsonOptions {
  cacheDir?: string;
  outputDir?: string;
}

export async function generateFromJsonCommand(options: GenerateFromJsonOptions) {
  try {
    const config = loadConfig();
    if (!config && !options.outputDir) {
      throw new Error("No .autodocrc.json found and no --output-dir provided.");
    }

    const outputDir = path.resolve(options.outputDir || config!.outputDir);
    const cacheDir = options.cacheDir
      ? path.resolve(options.cacheDir)
      : path.join(outputDir, ".autodoc-cache");

    if (!fs.existsSync(cacheDir)) {
      throw new Error(`Cache directory does not exist: ${cacheDir}`);
    }

    const cacheFiles = fs.readdirSync(cacheDir).filter((f) => f.endsWith("-analysis.json"));
    if (cacheFiles.length === 0) {
      throw new Error(`No analysis JSON files found in ${cacheDir}`);
    }

    const results: AnalysisResult[] = [];
    for (const file of cacheFiles) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf-8"));
        const result: AnalysisResult = raw.result ?? raw;
        results.push(result);
      } catch (err) {
        throw new Error(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (results.length === 0) {
      throw new Error("No valid analysis results loaded.");
    }

    const contentDir = path.join(outputDir, "content", "docs");
    await writeContent(contentDir, results, undefined, undefined, {});
    await writeMeta(contentDir, results, undefined);

    console.log(JSON.stringify({
      ok: true,
      outputDir,
      repos: results.map((r) => r.repoName),
    }));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  }
}
