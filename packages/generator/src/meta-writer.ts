import fs from "fs-extra";
import path from "node:path";
import type { AnalysisResult, ChangelogEntry, CrossRepoAnalysis } from "./types.js";

interface MetaJson {
  title?: string;
  pages: string[];
}

export async function writeMeta(
  contentDir: string,
  results: AnalysisResult[],
  crossRepo?: CrossRepoAnalysis,
  changelogs?: Map<string, ChangelogEntry>,
): Promise<void> {
  if (results.length === 1) {
    const changelog = changelogs?.get(results[0].repoName);
    await writeRepoMeta(contentDir, results[0], changelog);
  } else {
    // Root meta listing index + cross-repo + all repos
    const pages: string[] = ["index"];
    if (crossRepo) pages.push("cross-repo");
    pages.push(...results.map((r) => slugify(r.repoName)));

    const rootMeta: MetaJson = { pages };
    await fs.writeFile(
      path.join(contentDir, "meta.json"),
      JSON.stringify(rootMeta, null, 2),
    );

    for (const result of results) {
      const repoDir = path.join(contentDir, slugify(result.repoName));
      const changelog = changelogs?.get(result.repoName);
      await writeRepoMeta(repoDir, result, changelog);
    }
  }
}

async function writeRepoMeta(dir: string, result: AnalysisResult, changelog?: ChangelogEntry): Promise<void> {
  await fs.ensureDir(dir);

  const pages: string[] = ["index"];
  if (result.features && result.features.features.length > 0) pages.push("features");
  pages.push("getting-started");
  if (result.configuration && result.configuration.configItems.length > 0) pages.push("configuration");
  if (result.businessLogic && (result.businessLogic.domainConcepts.length > 0 || result.businessLogic.businessRules.length > 0 || result.businessLogic.workflows.length > 0)) pages.push("business-logic");
  pages.push("architecture");
  if (result.apiEndpoints.length > 0) pages.push("api");
  if (result.components.length > 0) pages.push("components");
  if (result.dataModels.length > 0) pages.push("data-models");
  if (result.errorHandling && (result.errorHandling.errorCodes.length > 0 || result.errorHandling.commonErrors.length > 0)) pages.push("error-handling");
  if (result.diagrams && result.diagrams.length > 0) pages.push("diagrams");
  if (changelog && (changelog.added.length > 0 || changelog.removed.length > 0 || changelog.modified.length > 0)) pages.push("changelog");

  const meta: MetaJson = {
    title: result.repoName,
    pages,
  };

  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  // Sub-directory metas
  if (result.apiEndpoints.length > 0) {
    await fs.ensureDir(path.join(dir, "api"));
    await fs.writeFile(
      path.join(dir, "api", "meta.json"),
      JSON.stringify({ title: "API Reference", pages: ["index"] }, null, 2),
    );
  }

  if (result.components.length > 0) {
    await fs.ensureDir(path.join(dir, "components"));
    await fs.writeFile(
      path.join(dir, "components", "meta.json"),
      JSON.stringify({ title: "Components", pages: ["index"] }, null, 2),
    );
  }

  if (result.dataModels.length > 0) {
    await fs.ensureDir(path.join(dir, "data-models"));
    await fs.writeFile(
      path.join(dir, "data-models", "meta.json"),
      JSON.stringify({ title: "Data Models", pages: ["index"] }, null, 2),
    );
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
