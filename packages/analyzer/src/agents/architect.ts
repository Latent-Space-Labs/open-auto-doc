import type { ArchitectureOverview, MermaidDiagram, ModuleInfo, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const architectureSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 paragraph description of the project" },
    projectPurpose: { type: "string", description: "1-2 paragraph plain-language description of what this project does for someone who has never seen it" },
    targetAudience: { type: "string", description: "Who the intended users of this software are" },
    techStack: { type: "array", items: { type: "string" } },
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          responsibilities: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "files", "responsibilities"],
      },
    },
    dataFlow: { type: "string" },
    entryPoints: { type: "array", items: { type: "string" } },
    keyPatterns: { type: "array", items: { type: "string" } },
    diagrams: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          mermaidSyntax: { type: "string" },
        },
        required: ["id", "title", "description", "mermaidSyntax"],
      },
    },
  },
  required: ["summary", "projectPurpose", "targetAudience", "techStack", "modules", "dataFlow", "entryPoints", "keyPatterns", "diagrams"],
};

export async function analyzeArchitecture(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<ArchitectureOverview> {
  const claudeMdContext = staticAnalysis.claudeMd
    .map((c) => `--- ${c.path} ---\n${c.content}`)
    .join("\n\n");

  const depsContext = staticAnalysis.dependencies
    .map((d) => `${d.packageManager}: ${Object.keys(d.dependencies).join(", ")}`)
    .join("\n");

  const importGraphSummary = staticAnalysis.importGraph
    ? `Import graph: ${staticAnalysis.importGraph.edges.length} edges across ${staticAnalysis.importGraph.moduleClusters.length} clusters (${staticAnalysis.importGraph.moduleClusters.map((c) => `${c.name}: ${c.files.length} files`).join(", ")})`
    : "";

  return runAgent<ArchitectureOverview>({
    onAgentMessage,
    systemPrompt: `You are a senior software architect analyzing a codebase. Produce structured JSON analysis.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze this repository's architecture.

Before diving into architecture, first describe what this project does in 1-2 paragraphs (projectPurpose) for someone who has never seen it. Also identify the target audience — who would use this software and why.

## Known Context (from static parsing)
- Languages: ${staticAnalysis.languages.join(", ")}
- Entry files: ${staticAnalysis.entryFiles.join(", ")}
- Dependencies: ${depsContext}
- Total files: ${staticAnalysis.totalFiles}
${importGraphSummary ? `- ${importGraphSummary}` : ""}
${claudeMdContext ? `\n## CLAUDE.md Project Context\n${claudeMdContext}\n` : ""}

## Instructions
Use Glob to discover the project structure. Use Read to examine key files including:
- Entry points and main application files
- Configuration files (tsconfig, webpack, docker, etc.)
- README and documentation
- Middleware, auth, database configuration
- Route definitions and API setup

Produce a comprehensive architecture analysis.
Also generate Mermaid diagrams:
1. An architecture overview diagram using \`graph TD\` showing the main modules and how they connect
2. A data flow diagram using \`flowchart LR\` showing how data moves through the system

Return the diagrams in the "diagrams" array with id, title, description, and mermaidSyntax fields.
Each mermaidSyntax value should be valid Mermaid syntax that can be rendered directly.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: architectureSchema,
    maxTurns: 30,
  });
}
