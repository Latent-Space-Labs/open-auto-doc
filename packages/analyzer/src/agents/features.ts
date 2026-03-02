import type { ArchitectureOverview, FeaturesAnalysis, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const featuresSchema = {
  type: "object",
  properties: {
    tagline: { type: "string", description: "One-line product description (what does this software do?)" },
    targetAudience: { type: "string", description: "Who uses this software and why" },
    features: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short feature name" },
          description: { type: "string", description: "1-2 sentence description of the feature from a user perspective" },
          category: { type: "string", description: "Feature category (e.g. Core, Integration, Developer Experience, Security)" },
          relatedFiles: { type: "array", items: { type: "string" }, description: "Key source files implementing this feature" },
        },
        required: ["name", "description", "category", "relatedFiles"],
      },
    },
    useCases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short use case title" },
          description: { type: "string", description: "Description of the workflow or scenario" },
          involvedFeatures: { type: "array", items: { type: "string" }, description: "Names of features involved in this use case" },
        },
        required: ["title", "description", "involvedFeatures"],
      },
    },
  },
  required: ["tagline", "targetAudience", "features", "useCases"],
};

export async function analyzeFeatures(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<FeaturesAnalysis> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<FeaturesAnalysis>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are a product documentation writer. Your job is to describe what software does from a USER's perspective — not how it's built internally.
Focus on capabilities, features, and use cases that matter to someone evaluating or using this software.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze this codebase and extract its user-facing features and capabilities.

## Architecture Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
Modules: ${architecture.modules.map((m) => `${m.name}: ${m.description}`).join("\n")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
Read the README, CLI help text, test descriptions, route handlers, UI pages, configuration options, and any user-facing documentation.

If this is a **library or framework**, describe capabilities provided to consumers (API surface, configuration options, extensibility points).
If this is an **application**, describe user-facing features (what can users do with it?).
If this is a **CLI tool**, describe available commands and what they accomplish.

For each feature:
- Write the description from the user's perspective ("Lets you..." or "Provides..." not "Implements..." or "Uses...")
- Assign a category (Core, Integration, Developer Experience, Security, Configuration, etc.)
- List 1-3 key source files that implement the feature

Also identify 2-5 common use cases — real workflows or scenarios where someone would use this software.

Group features into meaningful categories. Aim for 5-15 features total — enough to be comprehensive but not exhaustive.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: featuresSchema,
    maxTurns: 25,
  });
}
