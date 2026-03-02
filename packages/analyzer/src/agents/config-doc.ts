import type { ArchitectureOverview, ConfigurationAnalysis, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const configOutputSchema = {
  type: "object",
  properties: {
    configItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Config variable or option name" },
          source: { type: "string", description: "Where this config is defined (e.g. .env, config.ts, process.env)" },
          type: { type: "string", description: "Data type (string, number, boolean, etc.)" },
          defaultValue: { type: "string", description: "Default value if any" },
          required: { type: "boolean", description: "Whether this config is required" },
          description: { type: "string", description: "What this config option does" },
          category: { type: "string", description: "Grouping category (e.g. Database, Auth, Feature Flags)" },
        },
        required: ["name", "source", "type", "required", "description"],
      },
    },
    configFiles: {
      type: "array",
      items: { type: "string" },
      description: "List of configuration file paths found in the project",
    },
    environmentVariables: {
      type: "array",
      items: { type: "string" },
      description: "List of environment variable names used in the project",
    },
  },
  required: ["configItems", "configFiles", "environmentVariables"],
};

export async function analyzeConfiguration(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<ConfigurationAnalysis> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<ConfigurationAnalysis>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are a configuration documentation expert. Your job is to find and document every configuration option, environment variable, and feature flag in a codebase.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze this codebase and extract all configuration options and environment variables.

## Architecture Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
1. Use Glob to find config files: \`.env*\`, \`config/**\`, \`**/config.*\`, \`**/*.config.*\`, \`**/settings.*\`, \`**/.env.example\`
2. Use Grep to search for \`process.env\`, \`os.environ\`, \`ConfigService\`, \`@Value\`, \`getenv\`, \`ENV[\`, \`config.\` references
3. Use Read to examine config files, .env.example files, and files that reference environment variables

For each configuration item:
- Identify the variable name and where it's defined
- Determine its type and default value (if any)
- Note whether it's required for the app to function
- Write a clear description of what it controls
- Assign a category (Database, Auth, API Keys, Feature Flags, Server, Logging, etc.)

Also list all config files found and all environment variable names.
If no configuration is found, return empty arrays.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: configOutputSchema,
    maxTurns: 30,
  });
}
