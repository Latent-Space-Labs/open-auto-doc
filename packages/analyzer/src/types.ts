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

export interface StaticAnalysis {
  fileTree: FileNode;
  languages: string[];
  dependencies: DependencyInfo[];
  claudeMd: ClaudeMdContent[];
  entryFiles: string[];
  totalFiles: number;
}

export interface ArchitectureOverview {
  summary: string;
  techStack: string[];
  modules: ModuleInfo[];
  dataFlow: string;
  entryPoints: string[];
  keyPatterns: string[];
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
  apiEndpoints: ApiEndpoint[];
  components: ComponentDoc[];
  dataModels: DataModelDoc[];
  gettingStarted: GettingStartedGuide;
}

export interface AIProvider {
  chat(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface AnalyzerOptions {
  repoPath: string;
  repoName: string;
  repoUrl: string;
  provider: AIProvider;
  onProgress?: (stage: string, message: string) => void;
}
