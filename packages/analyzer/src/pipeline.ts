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
import { initializeRepo } from "./agents/repo-init.js";
import { computeDiff, classifyChanges, type AffectedSection } from "./diff.js";

export interface IncrementalOptions extends AnalyzerOptions {
  previousResult: AnalysisResult;
  previousCommitSha: string;
}

export async function analyzeRepository(options: AnalyzerOptions): Promise<AnalysisResult> {
  const { repoPath, repoName, repoUrl, apiKey, model, skipInit, onProgress, onAgentMessage } = options;

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

  // Repo init: generate CLAUDE.md if missing
  if (!skipInit) {
    onProgress?.("init", "Checking for project context...");
    const updated = await initializeRepo(repoPath, staticAnalysis, apiKey, model, onAgentMessage);
    if (updated.claudeMd.length > staticAnalysis.claudeMd.length) {
      staticAnalysis.claudeMd = updated.claudeMd;
      onProgress?.("init", "Generated CLAUDE.md for project context");
    }
  }

  // Stage 2: Architecture pass (Agent SDK)
  onProgress?.("architecture", "Analyzing architecture with AI...");
  const architecture = await analyzeArchitecture(repoPath, staticAnalysis, apiKey, model, onAgentMessage);
  onProgress?.("architecture", `Identified ${architecture.modules.length} modules, ${architecture.diagrams.length} diagrams`);

  // Stage 3: Detail pass (parallel, Agent SDK — failures are non-fatal)
  onProgress?.("details", "Analyzing APIs, components, and data models...");
  const [apiSettled, compSettled, modelSettled] = await Promise.allSettled([
    analyzeApiEndpoints(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
    analyzeComponents(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
    analyzeDataModels(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage),
  ]);

  const apiResult = apiSettled.status === "fulfilled" ? apiSettled.value : null;
  const components = compSettled.status === "fulfilled" ? compSettled.value : [];
  const modelResult = modelSettled.status === "fulfilled" ? modelSettled.value : null;

  if (apiSettled.status === "rejected") onProgress?.("details", `API analysis failed (non-fatal): ${apiSettled.reason}`);
  if (compSettled.status === "rejected") onProgress?.("details", `Component analysis failed (non-fatal): ${compSettled.reason}`);
  if (modelSettled.status === "rejected") onProgress?.("details", `Data model analysis failed (non-fatal): ${modelSettled.reason}`);

  const apiEndpoints = apiResult?.endpoints ?? [];
  const dataModels = modelResult?.models ?? [];

  // Collect diagrams from all agents
  const diagrams: MermaidDiagram[] = [
    ...architecture.diagrams,
    ...(apiResult?.diagram ? [apiResult.diagram] : []),
    ...(modelResult?.diagram ? [modelResult.diagram] : []),
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

export async function analyzeRepositoryIncremental(
  options: IncrementalOptions,
): Promise<AnalysisResult> {
  const {
    repoPath,
    repoName,
    repoUrl,
    apiKey,
    model,
    skipInit,
    onProgress,
    onAgentMessage,
    previousResult,
    previousCommitSha,
  } = options;

  // Stage 1: Always re-run static parsing (fast)
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

  // Repo init: generate CLAUDE.md if missing
  if (!skipInit) {
    const updated = await initializeRepo(repoPath, staticAnalysis, apiKey, model, onAgentMessage);
    if (updated.claudeMd.length > staticAnalysis.claudeMd.length) {
      staticAnalysis.claudeMd = updated.claudeMd;
    }
  }

  // Compute diff and classify
  onProgress?.("incremental", "Computing changes since last analysis...");
  const diffEntries = computeDiff(repoPath, previousCommitSha);

  if (diffEntries.length === 0) {
    onProgress?.("incremental", "No changes detected, reusing cached results");
    return { ...previousResult, staticAnalysis };
  }

  const diffResult = classifyChanges(diffEntries, staticAnalysis);

  if (diffResult.fullRegenRequired) {
    onProgress?.("incremental", `${diffEntries.length} files changed — running full analysis`);
    return analyzeRepository(options);
  }

  const affected = diffResult.affectedSections;
  const sections = Array.from(affected).join(", ");
  onProgress?.("incremental", `${diffEntries.length} files changed — re-analyzing: ${sections}`);

  // Stage 2: Architecture (re-run or reuse)
  let architecture = previousResult.architecture;
  if (affected.has("architecture")) {
    onProgress?.("architecture", "Re-analyzing architecture...");
    architecture = await analyzeArchitecture(repoPath, staticAnalysis, apiKey, model, onAgentMessage);
  }

  // Stage 3: Detail agents (selective)
  let apiEndpoints = previousResult.apiEndpoints;
  let components = previousResult.components;
  let dataModels = previousResult.dataModels;
  let apiDiagram: MermaidDiagram | undefined;
  let modelDiagram: MermaidDiagram | undefined;

  // Extract previous diagrams from detail agents for reuse
  const prevArchDiagramIds = new Set(previousResult.architecture.diagrams.map((d) => d.id));
  const prevDetailDiagrams = previousResult.diagrams.filter((d) => !prevArchDiagramIds.has(d.id));

  const promises: Promise<void>[] = [];

  if (affected.has("api")) {
    promises.push(
      analyzeApiEndpoints(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage).then(
        (result) => {
          apiEndpoints = result.endpoints;
          apiDiagram = result.diagram;
        },
      ).catch((err) => {
        onProgress?.("details", `API re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("components")) {
    promises.push(
      analyzeComponents(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage).then(
        (result) => {
          components = result;
        },
      ).catch((err) => {
        onProgress?.("details", `Component re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("dataModels")) {
    promises.push(
      analyzeDataModels(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage).then(
        (result) => {
          dataModels = result.models;
          modelDiagram = result.diagram;
        },
      ).catch((err) => {
        onProgress?.("details", `Data model re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (promises.length > 0) {
    onProgress?.("details", "Re-analyzing affected sections...");
    await Promise.all(promises);
  }

  // Collect diagrams
  const diagrams: MermaidDiagram[] = [...architecture.diagrams];
  if (affected.has("api") && apiDiagram) {
    diagrams.push(apiDiagram);
  } else {
    // Reuse previous API diagram if present
    const prevApiDiag = prevDetailDiagrams.find((d) => d.id.includes("api"));
    if (prevApiDiag) diagrams.push(prevApiDiag);
  }
  if (affected.has("dataModels") && modelDiagram) {
    diagrams.push(modelDiagram);
  } else {
    const prevModelDiag = prevDetailDiagrams.find((d) => d.id.includes("model") || d.id.includes("er"));
    if (prevModelDiag) diagrams.push(prevModelDiag);
  }

  // Stage 4: Getting started (re-run if affected)
  let gettingStarted = previousResult.gettingStarted;
  if (affected.has("gettingStarted")) {
    onProgress?.("synthesis", "Re-writing getting started guide...");
    gettingStarted = await writeGettingStarted(
      repoPath,
      staticAnalysis,
      architecture,
      { apiEndpoints, components, dataModels },
      apiKey,
      model,
      onAgentMessage,
    );
  }

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
