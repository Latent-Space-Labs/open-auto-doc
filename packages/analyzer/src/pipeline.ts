import type { AnalysisResult, AnalyzerOptions, BusinessLogicAnalysis, ConfigurationAnalysis, ErrorHandlingAnalysis, FeaturesAnalysis, MermaidDiagram, StaticAnalysis } from "./types.js";
import { buildFileTree, detectEntryFiles, detectLanguages } from "./parsers/tree.js";
import { parseDependencies } from "./parsers/dependencies.js";
import { readClaudeMd } from "./parsers/claude-md.js";
import { buildImportGraph } from "./parsers/import-graph.js";
import { analyzeArchitecture } from "./agents/architect.js";
import { analyzeApiEndpoints } from "./agents/api-doc.js";
import { analyzeComponents } from "./agents/component-doc.js";
import { analyzeDataModels } from "./agents/model-doc.js";
import { analyzeFeatures } from "./agents/features.js";
import { analyzeConfiguration } from "./agents/config-doc.js";
import { analyzeBusinessLogic } from "./agents/business-logic.js";
import { analyzeErrorHandling } from "./agents/error-doc.js";
import { writeGettingStarted } from "./agents/guide-writer.js";
import { initializeRepo } from "./agents/repo-init.js";
import { computeDiff, classifyChanges, type AffectedSection } from "./diff.js";

export interface IncrementalOptions extends AnalyzerOptions {
  previousResult: AnalysisResult;
  previousCommitSha: string;
}

// Each agent SDK query() adds exit listeners; parallel repos × parallel agents can exceed the default 10
process.setMaxListeners(Math.max(process.getMaxListeners(), 50));

export async function analyzeRepository(options: AnalyzerOptions): Promise<AnalysisResult> {
  const { repoPath, repoName, repoUrl, apiKey, model, skipInit, onProgress, onAgentMessage, onToolUse } = options;

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

  // Repo init: generate CLAUDE.md if missing (non-fatal — analysis works without it)
  if (!skipInit) {
    onProgress?.("init", "Checking for project context...");
    try {
      const updated = await initializeRepo(repoPath, staticAnalysis, apiKey, model, onAgentMessage, onToolUse);
      if (updated.claudeMd.length > staticAnalysis.claudeMd.length) {
        staticAnalysis.claudeMd = updated.claudeMd;
        onProgress?.("init", "Generated CLAUDE.md for project context");
      }
    } catch (err) {
      // Non-fatal: continue analysis without CLAUDE.md
      onProgress?.("init", "Skipped project context (continuing without it)");
    }
  }

  // Stage 2: Architecture pass (Agent SDK)
  onProgress?.("architecture", "Analyzing architecture with AI...");
  const architecture = await analyzeArchitecture(repoPath, staticAnalysis, apiKey, model, onAgentMessage, onToolUse);
  onProgress?.("architecture", `Identified ${architecture.modules.length} modules, ${architecture.diagrams.length} diagrams`);

  // Stage 3: Detail pass (parallel, Agent SDK — failures are non-fatal)
  onProgress?.("details", "Analyzing APIs, components, data models, features, config, business logic, errors...");
  const [apiSettled, compSettled, modelSettled, featuresSettled, configSettled, bizLogicSettled, errorSettled] = await Promise.allSettled([
    analyzeApiEndpoints(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeComponents(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeDataModels(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeFeatures(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeConfiguration(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeBusinessLogic(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
    analyzeErrorHandling(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse),
  ]);

  const apiResult = apiSettled.status === "fulfilled" ? apiSettled.value : null;
  const components = compSettled.status === "fulfilled" ? compSettled.value : [];
  const modelResult = modelSettled.status === "fulfilled" ? modelSettled.value : null;
  const features: FeaturesAnalysis | null = featuresSettled.status === "fulfilled" ? featuresSettled.value : null;
  const configuration: ConfigurationAnalysis | null = configSettled.status === "fulfilled" ? configSettled.value : null;
  const businessLogic: BusinessLogicAnalysis | null = bizLogicSettled.status === "fulfilled" ? bizLogicSettled.value : null;
  const errorHandling: ErrorHandlingAnalysis | null = errorSettled.status === "fulfilled" ? errorSettled.value : null;

  if (apiSettled.status === "rejected") onProgress?.("details", `API analysis failed (non-fatal): ${apiSettled.reason}`);
  if (compSettled.status === "rejected") onProgress?.("details", `Component analysis failed (non-fatal): ${compSettled.reason}`);
  if (modelSettled.status === "rejected") onProgress?.("details", `Data model analysis failed (non-fatal): ${modelSettled.reason}`);
  if (featuresSettled.status === "rejected") onProgress?.("details", `Features analysis failed (non-fatal): ${featuresSettled.reason}`);
  if (configSettled.status === "rejected") onProgress?.("details", `Configuration analysis failed (non-fatal): ${configSettled.reason}`);
  if (bizLogicSettled.status === "rejected") onProgress?.("details", `Business logic analysis failed (non-fatal): ${bizLogicSettled.reason}`);
  if (errorSettled.status === "rejected") onProgress?.("details", `Error handling analysis failed (non-fatal): ${errorSettled.reason}`);

  const apiEndpoints = apiResult?.endpoints ?? [];
  const dataModels = modelResult?.models ?? [];

  // Collect diagrams from all agents
  const diagrams: MermaidDiagram[] = [
    ...architecture.diagrams,
    ...(apiResult?.diagram ? [apiResult.diagram] : []),
    ...(modelResult?.diagram ? [modelResult.diagram] : []),
  ];

  // Collect workflow diagrams from business logic
  if (businessLogic) {
    for (const workflow of businessLogic.workflows) {
      if (workflow.diagram) diagrams.push(workflow.diagram);
    }
  }

  onProgress?.(
    "details",
    `Found ${apiEndpoints.length} endpoints, ${components.length} components, ${dataModels.length} models, ${diagrams.length} diagrams${features ? `, ${features.features.length} features` : ""}`,
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
    onToolUse,
  );

  return {
    repoName,
    repoUrl,
    staticAnalysis,
    architecture,
    features,
    apiEndpoints,
    components,
    dataModels,
    gettingStarted,
    diagrams,
    configuration,
    businessLogic,
    errorHandling,
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
    onToolUse,
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

  // Repo init: generate CLAUDE.md if missing (non-fatal)
  if (!skipInit) {
    try {
      const updated = await initializeRepo(repoPath, staticAnalysis, apiKey, model, onAgentMessage, onToolUse);
      if (updated.claudeMd.length > staticAnalysis.claudeMd.length) {
        staticAnalysis.claudeMd = updated.claudeMd;
      }
    } catch {
      // Non-fatal: continue without CLAUDE.md
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
    architecture = await analyzeArchitecture(repoPath, staticAnalysis, apiKey, model, onAgentMessage, onToolUse);
  }

  // Stage 3: Detail agents (selective)
  let apiEndpoints = previousResult.apiEndpoints;
  let components = previousResult.components;
  let dataModels = previousResult.dataModels;
  let features = previousResult.features;
  let configuration = previousResult.configuration;
  let businessLogic = previousResult.businessLogic;
  let errorHandling = previousResult.errorHandling;
  let apiDiagram: MermaidDiagram | undefined;
  let modelDiagram: MermaidDiagram | undefined;
  const workflowDiagrams: MermaidDiagram[] = [];

  // Extract previous diagrams from detail agents for reuse
  const prevArchDiagramIds = new Set(previousResult.architecture.diagrams.map((d) => d.id));
  const prevDetailDiagrams = previousResult.diagrams.filter((d) => !prevArchDiagramIds.has(d.id));

  const promises: Promise<void>[] = [];

  if (affected.has("api")) {
    promises.push(
      analyzeApiEndpoints(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
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
      analyzeComponents(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
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
      analyzeDataModels(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
        (result) => {
          dataModels = result.models;
          modelDiagram = result.diagram;
        },
      ).catch((err) => {
        onProgress?.("details", `Data model re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("features")) {
    promises.push(
      analyzeFeatures(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
        (result) => {
          features = result;
        },
      ).catch((err) => {
        onProgress?.("details", `Features re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("configuration")) {
    promises.push(
      analyzeConfiguration(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
        (result) => {
          configuration = result;
        },
      ).catch((err) => {
        onProgress?.("details", `Configuration re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("businessLogic")) {
    promises.push(
      analyzeBusinessLogic(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
        (result) => {
          businessLogic = result;
          // Collect workflow diagrams
          for (const workflow of result.workflows) {
            if (workflow.diagram) workflowDiagrams.push(workflow.diagram);
          }
        },
      ).catch((err) => {
        onProgress?.("details", `Business logic re-analysis failed (non-fatal): ${err}`);
      }),
    );
  }

  if (affected.has("errorHandling")) {
    promises.push(
      analyzeErrorHandling(repoPath, staticAnalysis, architecture, apiKey, model, onAgentMessage, onToolUse).then(
        (result) => {
          errorHandling = result;
        },
      ).catch((err) => {
        onProgress?.("details", `Error handling re-analysis failed (non-fatal): ${err}`);
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

  // Add workflow diagrams from business logic
  if (affected.has("businessLogic")) {
    diagrams.push(...workflowDiagrams);
  } else if (businessLogic) {
    // Reuse previous workflow diagrams
    for (const workflow of businessLogic.workflows) {
      if (workflow.diagram) diagrams.push(workflow.diagram);
    }
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
      onToolUse,
    );
  }

  return {
    repoName,
    repoUrl,
    staticAnalysis,
    architecture,
    features,
    apiEndpoints,
    components,
    dataModels,
    gettingStarted,
    diagrams,
    configuration,
    businessLogic,
    errorHandling,
  };
}
