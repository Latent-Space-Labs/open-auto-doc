import type { ApiEndpoint, ArchitectureOverview, MermaidDiagram, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

interface ApiAnalysisResult {
  endpoints: ApiEndpoint[];
  diagram?: MermaidDiagram;
}

const apiOutputSchema = {
  type: "object",
  properties: {
    endpoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          method: { type: "string" },
          path: { type: "string" },
          description: { type: "string" },
          parameters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                description: { type: "string" },
                location: { type: "string", enum: ["path", "query", "header", "body"] },
              },
              required: ["name", "type", "required", "description", "location"],
            },
          },
          requestBody: { type: "string" },
          responseBody: { type: "string" },
          authentication: { type: "string" },
        },
        required: ["method", "path", "description", "parameters"],
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
  required: ["endpoints"],
};

export async function analyzeApiEndpoints(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<ApiAnalysisResult> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<ApiAnalysisResult>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are an API documentation expert. Analyze source code and extract API endpoint documentation.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Find and document all API endpoints in this codebase.

## Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
Use Glob to find route/controller/handler files (e.g. **/routes/**, **/api/**, **/controllers/**).
Use Grep to search for HTTP method decorators/calls (GET, POST, PUT, DELETE, app.get, router.post, etc.).
Use Read to examine each file and extract endpoint details.

For each endpoint, document: method, path, description, parameters, requestBody, responseBody, authentication.

Also generate a Mermaid \`sequenceDiagram\` showing the main API request flow (e.g. Client -> API -> Service -> Database).
If no endpoints are found, set the diagram to null and return an empty endpoints array.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: apiOutputSchema,
    maxTurns: 40,
  });
}
