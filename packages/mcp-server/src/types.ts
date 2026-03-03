/**
 * Local copy of analysis result interfaces from @latent-space-labs/auto-doc-analyzer.
 * Kept separate to avoid depending on the full analyzer package (fast npx startup).
 */

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileNode[];
  extension?: string;
  size?: number;
}

export interface DependencyInfo {
  packageManager: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  raw: string;
}

export interface ClaudeMdContent {
  path: string;
  content: string;
}

export interface ImportEdge {
  from: string;
  to: string;
  isExternal: boolean;
}

export interface ModuleCluster {
  name: string;
  files: string[];
  internalEdgeCount: number;
  externalEdgeCount: number;
}

export interface ImportGraph {
  edges: ImportEdge[];
  moduleClusters: ModuleCluster[];
}

export interface StaticAnalysis {
  fileTree: FileNode;
  languages: string[];
  dependencies: DependencyInfo[];
  claudeMd: ClaudeMdContent[];
  entryFiles: string[];
  totalFiles: number;
  importGraph?: ImportGraph;
}

export interface MermaidDiagram {
  id: string;
  title: string;
  description: string;
  mermaidSyntax: string;
}

export interface ArchitectureOverview {
  summary: string;
  projectPurpose: string;
  targetAudience: string;
  techStack: string[];
  modules: ModuleInfo[];
  dataFlow: string;
  entryPoints: string[];
  keyPatterns: string[];
  diagrams: MermaidDiagram[];
}

export interface ModuleInfo {
  name: string;
  description: string;
  files: string[];
  responsibilities: string[];
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  parameters: ParameterDoc[];
  requestBody?: string;
  responseBody?: string;
  authentication?: string;
}

export interface ParameterDoc {
  name: string;
  type: string;
  required: boolean;
  description: string;
  location: "path" | "query" | "header" | "body";
}

export interface ComponentDoc {
  name: string;
  description: string;
  filePath: string;
  props: PropDoc[];
  usage: string;
  category?: string;
}

export interface PropDoc {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description: string;
}

export interface DataModelDoc {
  name: string;
  description: string;
  filePath: string;
  fields: FieldDoc[];
  relationships: string[];
}

export interface FieldDoc {
  name: string;
  type: string;
  description: string;
  constraints?: string[];
}

export interface Feature {
  name: string;
  description: string;
  category: string;
  relatedFiles: string[];
}

export interface UseCase {
  title: string;
  description: string;
  involvedFeatures: string[];
}

export interface FeaturesAnalysis {
  tagline: string;
  targetAudience: string;
  features: Feature[];
  useCases: UseCase[];
}

export interface ConfigurationItem {
  name: string;
  source: string;
  type: string;
  defaultValue?: string;
  required: boolean;
  description: string;
  category?: string;
}

export interface ConfigurationAnalysis {
  configItems: ConfigurationItem[];
  configFiles: string[];
  environmentVariables: string[];
}

export interface DomainConcept {
  name: string;
  description: string;
  relatedFiles: string[];
}

export interface BusinessRule {
  name: string;
  description: string;
  sourceFiles: string[];
  category?: string;
}

export interface Workflow {
  name: string;
  description: string;
  steps: string[];
  diagram?: MermaidDiagram;
}

export interface BusinessLogicAnalysis {
  domainConcepts: DomainConcept[];
  businessRules: BusinessRule[];
  workflows: Workflow[];
  keyInvariants: string[];
}

export interface ErrorCode {
  code: string;
  httpStatus?: number;
  message: string;
  description: string;
  sourceFile?: string;
}

export interface CommonError {
  error: string;
  cause: string;
  solution: string;
  category?: string;
}

export interface ErrorHandlingAnalysis {
  errorCodes: ErrorCode[];
  commonErrors: CommonError[];
  errorClasses: string[];
  debuggingTips: string[];
}

export interface ChangelogChange {
  name: string;
  description: string;
  section: string;
}

export interface ChangelogEntry {
  generatedAt: string;
  fromCommit: string;
  toCommit: string;
  added: ChangelogChange[];
  removed: ChangelogChange[];
  modified: ChangelogChange[];
  summary: string;
}

export interface GettingStartedGuide {
  prerequisites: string[];
  installation: string;
  quickStart: string;
  configuration?: string;
  examples?: string;
}

export interface AnalysisResult {
  repoName: string;
  repoUrl: string;
  staticAnalysis: StaticAnalysis;
  architecture: ArchitectureOverview;
  features: FeaturesAnalysis | null;
  apiEndpoints: ApiEndpoint[];
  components: ComponentDoc[];
  dataModels: DataModelDoc[];
  gettingStarted: GettingStartedGuide;
  diagrams: MermaidDiagram[];
  configuration: ConfigurationAnalysis | null;
  businessLogic: BusinessLogicAnalysis | null;
  errorHandling: ErrorHandlingAnalysis | null;
}

export interface AnalysisCache {
  version: number;
  commitSha: string;
  timestamp: string;
  result: AnalysisResult;
}

export interface CrossRepoAnalysis {
  summary: string;
  sharedDependencies: string[];
  techStackOverlap: string[];
  apiContracts: ApiContract[];
  repoRelationships: RepoRelationship[];
  integrationPatterns: IntegrationPattern[];
  dataFlowAcrossServices: string;
  sharedConventions: string[];
  diagrams: MermaidDiagram[];
}

export interface ApiContract {
  consumerRepo: string;
  providerRepo: string;
  endpoint: string;
  method: string;
  description: string;
}

export interface RepoRelationship {
  from: string;
  to: string;
  relationshipType: string;
  description: string;
}

export interface IntegrationPattern {
  repos: string[];
  pattern: string;
  description: string;
  direction: string;
}
