import type { AnalysisResult, CrossRepoAnalysis } from "../types.js";
import { runAgent } from "../agent-sdk.js";

const crossRepoSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Overview of how the repositories relate to each other" },
    sharedDependencies: { type: "array", items: { type: "string" } },
    techStackOverlap: { type: "array", items: { type: "string" } },
    apiContracts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          consumerRepo: { type: "string" },
          providerRepo: { type: "string" },
          endpoint: { type: "string" },
          method: { type: "string" },
          description: { type: "string" },
        },
        required: ["consumerRepo", "providerRepo", "endpoint", "method", "description"],
      },
    },
    repoRelationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          relationshipType: { type: "string" },
          description: { type: "string" },
        },
        required: ["from", "to", "relationshipType", "description"],
      },
    },
    integrationPatterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          repos: { type: "array", items: { type: "string" } },
          pattern: { type: "string", description: "e.g. REST API, Message Queue, Shared Database, gRPC" },
          description: { type: "string" },
          direction: { type: "string", description: "e.g. bidirectional, producer->consumer, client->server" },
        },
        required: ["repos", "pattern", "description", "direction"],
      },
    },
    dataFlowAcrossServices: { type: "string", description: "Description of how data moves across the different services/repos" },
    sharedConventions: { type: "array", items: { type: "string" }, description: "Common patterns, conventions, or standards shared across repos" },
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
  required: ["summary", "sharedDependencies", "techStackOverlap", "apiContracts", "repoRelationships", "integrationPatterns", "dataFlowAcrossServices", "sharedConventions", "diagrams"],
};

export async function analyzeCrossRepos(
  results: AnalysisResult[],
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<CrossRepoAnalysis> {
  const repoSummaries = results.map((r) => {
    const deps = r.staticAnalysis.dependencies
      .flatMap((d) => Object.keys(d.dependencies))
      .slice(0, 30);

    const endpoints = r.apiEndpoints
      .map((e) => `${e.method} ${e.path} - ${e.description}`)
      .slice(0, 20);

    const featuresSummary = r.features
      ? `**Tagline:** ${r.features.tagline}\n**Key Features:** ${r.features.features.slice(0, 5).map((f) => f.name).join(", ")}`
      : "";

    return `### ${r.repoName}
**Tech Stack:** ${r.architecture.techStack.join(", ")}
**Summary:** ${r.architecture.summary.split("\n")[0]}
${featuresSummary ? featuresSummary + "\n" : ""}**Modules:** ${r.architecture.modules.map((m) => m.name).join(", ")}
**Dependencies:** ${deps.join(", ")}
**API Endpoints:** ${endpoints.length > 0 ? "\n" + endpoints.join("\n") : "None"}
**Components:** ${r.components.length} components
**Data Models:** ${r.dataModels.map((m) => m.name).join(", ") || "None"}`;
  }).join("\n\n");

  // Use a temporary cwd (doesn't matter, no file tools used)
  return runAgent<CrossRepoAnalysis>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are a system architect analyzing multiple repositories to understand how they relate.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze the relationships between these ${results.length} repositories.

## Repository Summaries
${repoSummaries}

## Instructions
Based on the summaries above, identify:
1. Shared dependencies across repos
2. Technology stack overlap
3. API contracts (which repos consume/provide APIs to each other)
4. Relationships between repos (shared library, client-server, monorepo packages, etc.)
5. Integration patterns — how do the repos communicate? (REST API, message queue, shared database, gRPC, etc.) Include direction (bidirectional, producer->consumer, client->server)
6. Data flow across services — describe how data moves between the different repos/services
7. Shared conventions — common patterns, naming conventions, coding standards, or architectural patterns used across repos
8. Generate a Mermaid \`graph TD\` system diagram showing all repos and their relationships

Do NOT use file tools — all information is provided above.

IMPORTANT: Never use angle-bracket placeholders like <service-name> in your output. Use backtick-wrapped text instead: \`service-name\`. Angle brackets break MDX parsing.`,
    cwd: process.cwd(),
    apiKey,
    model,
    outputSchema: crossRepoSchema,
    allowedTools: [], // No file tools needed
    maxTurns: 5,
  });
}
