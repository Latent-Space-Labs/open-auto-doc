import type { ArchitectureOverview, ComponentDoc, StaticAnalysis } from "../types.js";
import { runAgent } from "../agent-sdk.js";

interface ComponentAnalysisResult {
  components: ComponentDoc[];
}

const componentOutputSchema = {
  type: "object",
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          filePath: { type: "string" },
          props: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                defaultValue: { type: "string" },
                description: { type: "string" },
              },
              required: ["name", "type", "required", "description"],
            },
          },
          usage: { type: "string" },
          category: { type: "string" },
        },
        required: ["name", "description", "filePath", "props", "usage"],
      },
    },
  },
  required: ["components"],
};

export async function analyzeComponents(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<ComponentDoc[]> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  const result = await runAgent<ComponentAnalysisResult>({
    onAgentMessage,
    systemPrompt: `You are a UI component documentation expert. Analyze source code and extract component documentation.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Find and document all UI components in this codebase.

## Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
Use Glob to find component files (e.g. **/components/**, **/*.component.*, **/*.vue, **/*.svelte, src/**/*.tsx).
Use Read to examine each file and extract component details.

For each component, document: name, description, filePath, props (name, type, required, defaultValue, description), usage example code, category.
If no UI components are found, return an empty components array.`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: componentOutputSchema,
    maxTurns: 40,
  });

  return result.components;
}
