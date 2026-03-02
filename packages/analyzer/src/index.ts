export { analyzeRepository, analyzeRepositoryIncremental } from "./pipeline.js";
export type { IncrementalOptions } from "./pipeline.js";
export { analyzeCrossRepos } from "./agents/cross-repo.js";
export { initializeRepo } from "./agents/repo-init.js";
export { AgentError } from "./agent-sdk.js";
export { fixMdxBuildErrors } from "./agents/mdx-fixer.js";
export type { FixerResult } from "./agents/mdx-fixer.js";
export { saveCache, loadCache } from "./cache.js";
export type { AnalysisCache } from "./cache.js";
export { computeDiff, classifyChanges, getHeadSha } from "./diff.js";
export type { DiffEntry, DiffResult, AffectedSection } from "./diff.js";
export { computeChangelog } from "./changelog.js";
export type {
  AnalysisResult,
  AnalyzerOptions,
  ToolUseEvent,
  ApiContract,
  ApiEndpoint,
  ArchitectureOverview,
  BusinessLogicAnalysis,
  BusinessRule,
  ChangelogChange,
  ChangelogEntry,
  CommonError,
  ComponentDoc,
  ConfigurationAnalysis,
  ConfigurationItem,
  CrossRepoAnalysis,
  DataModelDoc,
  DependencyInfo,
  DomainConcept,
  ClaudeMdContent,
  ErrorCode,
  ErrorHandlingAnalysis,
  Feature,
  FeaturesAnalysis,
  FieldDoc,
  FileNode,
  GettingStartedGuide,
  ImportEdge,
  ImportGraph,
  IntegrationPattern,
  MermaidDiagram,
  ModuleCluster,
  ModuleInfo,
  ParameterDoc,
  PropDoc,
  RepoRelationship,
  StaticAnalysis,
  UseCase,
  Workflow,
} from "./types.js";
