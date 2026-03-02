import type { AnalysisResult, AnalyzerOptions, MermaidDiagram, StaticAnalysis } from "./types.js";
import { buildFileTree, detectEntryFiles, detectLanguages } from "./parsers/tree.js";
import { parseDependencies } from "./parsers/dependencies.js";
import { readClaudeMd } from "./parsers/claude-md.js";
import { buildImportGraph } from "./parsers/import-graph.js";
import { analyzeArchitecture } from "./agents/architect.js";
import { analyzeApiEndpoints } from "./agents/api-doc.js";
import { analyzeComponents } from "./agents/component-doc.js";
import { analyzeDataModels } from "./agents/model-doc.js";
import { writeGettingStarted } from "./agents/guide-writer.js";

export async function analyzeRepository(options: AnalyzerOptions): Promise<AnalysisResult> {
  const { repoPath, repoName, repoUrl, apiKey, model, onProgress, onAgentMessage } = options;

  // Stage 1: Static parsing + import graph
  onProgress?.("static", "Parsing file tree and dependencies...");
  const { tree, flatFiles, totalFiles } = buildFileTree(repoPath);
  const languages = detectLanguages(flatFiles);
  const dependencies = parseDependencies(repoPath);
  const claudeMd = readClaudeMd(repoPath);
  const entryFiles = detectEntryFiles(flatFiles);
  const importGraph = buildImportGraph(repoPath, flatFiles);

  const staticAnalysis: StaticAnalysis = {
    fileTree: tree,
    languages,
    dependencies,
    claudeMd,
    entryFiles,
    totalFiles,
    importGraph,
  };

  onProgress?.("static", `Found ${totalFiles} files, ${languages.length} languages, ${importGraph.edges.length} import edges`);

  // Stage 2: Architecture pass (Agent SDK)
  onProgress?.("architecture", "Analyzing architecture with AI...");
  const architecture = await analyzeArchitecture(repoPath, staticAnalysis, apiKey, model, onAgentMessage);
  onProgress?.("architecture", `Identified ${architecture.modules.length} modules, ${architecture.diagrams.length} diagrams`);

  // Stage 3: Detail pass (parallel, Agent SDK)
  onProgress?.("details", "Analyzing APIs, components, and data models...");
  const [apiResult, components, modelResult] = await Promise.all([
    analyzeApiEndpoints(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
    analyzeComponents(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
    analyzeDataModels(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
  ]);

  const apiEndpoints = apiResult.endpoints;
  const dataModels = modelResult.models;

  // Collect diagrams from all agents
  const diagrams: MermaidDiagram[] = [
    ...architecture.diagrams,
    ...(apiResult.diagram ? [apiResult.diagram] : []),
    ...(modelResult.diagram ? [modelResult.diagram] : []),
  ];

  onProgress?.(
    "details",
    `Found ${apiEndpoints.length} endpoints, ${components.length} components, ${dataModels.length} models, ${diagrams.length} diagrams`,
  );

  // Stage 4: Synthesis (Agent SDK)
  onProgress?.("synthesis", "Writing getting started guide...");
  const gettingStarted = await writeGettingStarted(
    repoPath,
    staticAnalysis,
    architecture,
    { apiEndpoints, components, dataModels },
    apiKey,
    model,
    onAgentMessage,
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
    diagrams,
  };
}
