import type { AnalysisResult, AnalyzerOptions, StaticAnalysis } from "./types.js";
import { buildFileTree, detectEntryFiles, detectLanguages } from "./parsers/tree.js";
import { parseDependencies } from "./parsers/dependencies.js";
import { readClaudeMd } from "./parsers/claude-md.js";
import { analyzeArchitecture } from "./agents/architect.js";
import { analyzeApiEndpoints } from "./agents/api-doc.js";
import { analyzeComponents } from "./agents/component-doc.js";
import { analyzeDataModels } from "./agents/model-doc.js";
import { writeGettingStarted } from "./agents/guide-writer.js";

export async function analyzeRepository(options: AnalyzerOptions): Promise<AnalysisResult> {
  const { repoPath, repoName, repoUrl, provider, onProgress } = options;

  // Stage 1: Static parsing
  onProgress?.("static", "Parsing file tree and dependencies...");
  const { tree, flatFiles, totalFiles } = buildFileTree(repoPath);
  const languages = detectLanguages(flatFiles);
  const dependencies = parseDependencies(repoPath);
  const claudeMd = readClaudeMd(repoPath);
  const entryFiles = detectEntryFiles(flatFiles);

  const staticAnalysis: StaticAnalysis = {
    fileTree: tree,
    languages,
    dependencies,
    claudeMd,
    entryFiles,
    totalFiles,
  };

  onProgress?.("static", `Found ${totalFiles} files, ${languages.length} languages, ${claudeMd.length} CLAUDE.md files`);

  // Stage 2: Architecture pass
  onProgress?.("architecture", "Analyzing architecture with AI...");
  const architecture = await analyzeArchitecture(repoPath, staticAnalysis, provider);
  onProgress?.("architecture", `Identified ${architecture.modules.length} modules`);

  // Stage 3: Detail pass (parallel)
  onProgress?.("details", "Analyzing APIs, components, and data models...");
  const [apiEndpoints, components, dataModels] = await Promise.all([
    analyzeApiEndpoints(repoPath, staticAnalysis, architecture, provider),
    analyzeComponents(repoPath, staticAnalysis, architecture, provider),
    analyzeDataModels(repoPath, staticAnalysis, architecture, provider),
  ]);
  onProgress?.(
    "details",
    `Found ${apiEndpoints.length} endpoints, ${components.length} components, ${dataModels.length} models`,
  );

  // Stage 4: Synthesis
  onProgress?.("synthesis", "Writing getting started guide...");
  const gettingStarted = await writeGettingStarted(
    staticAnalysis,
    architecture,
    { apiEndpoints, components, dataModels },
    provider,
  );

  return {
    repoName,
    repoUrl,
    staticAnalysis,
    architecture,
    apiEndpoints,
    components,
    dataModels,
    gettingStarted,
  };
}
