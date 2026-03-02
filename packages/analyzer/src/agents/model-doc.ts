import type { ArchitectureOverview, DataModelDoc, MermaidDiagram, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

interface ModelAnalysisResult {
  models: DataModelDoc[];
  diagram?: MermaidDiagram;
}

const modelOutputSchema = {
  type: "object",
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          filePath: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                description: { type: "string" },
                constraints: { type: "array", items: { type: "string" } },
              },
              required: ["name", "type", "description"],
            },
          },
          relationships: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "filePath", "fields", "relationships"],
      },
    },
    diagram: {
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
  required: ["models"],
};

export async function analyzeDataModels(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<ModelAnalysisResult> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<ModelAnalysisResult>({
    onAgentMessage,
    systemPrompt: `You are a data modeling documentation expert. Analyze source code and extract data model documentation.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Find and document all data models in this codebase.

## Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
Use Glob to find model/schema/entity files (e.g. **/models/**, **/schemas/**, **/entities/**, **/*.model.*, **/*.schema.*, prisma/schema.prisma).
Use Grep to search for class/interface/type definitions, ORM decorators, schema definitions.
Use Read to examine each file and extract model details.

For each model, document: name, description, filePath, fields (name, type, description, constraints), relationships.

Also generate a Mermaid \`erDiagram\` showing entity relationships between the main data models.
If no models are found, set the diagram to null and return an empty models array.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: modelOutputSchema,
    maxTurns: 40,
  });
}
