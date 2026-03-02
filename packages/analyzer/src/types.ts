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

export interface ToolUseEvent {
  tool: string;
  target: string;
}

export interface AnalyzerOptions {
  repoPath: string;
  repoName: string;
  repoUrl: string;
  apiKey: string;
  model?: string;
  skipInit?: boolean;
  onProgress?: (stage: string, message: string) => void;
  onAgentMessage?: (text: string) => void;
  onToolUse?: (event: ToolUseEvent) => void;
}
