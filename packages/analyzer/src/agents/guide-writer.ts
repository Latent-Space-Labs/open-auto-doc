import type {
  AnalysisResult,
  ArchitectureOverview,
  GettingStartedGuide,
  StaticAnalysis,
} from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const guideOutputSchema = {
  type: "object",
  properties: {
    prerequisites: { type: "array", items: { type: "string" } },
    installation: { type: "string" },
    quickStart: { type: "string" },
    configuration: { type: "string" },
    examples: { type: "string" },
  },
  required: ["prerequisites", "installation", "quickStart"],
};

export async function writeGettingStarted(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  partialResult: Pick<AnalysisResult, "apiEndpoints" | "components" | "dataModels">,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<GettingStartedGuide> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");
  const depsContext = staticAnalysis.dependencies
    .map((d) => `${d.packageManager}: ${Object.keys(d.dependencies).slice(0, 20).join(", ")}`)
    .join("\n");

  return runAgent<GettingStartedGuide>({
    onAgentMessage,
    systemPrompt: `You are a technical writer creating getting-started guides for developers.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Create a getting-started guide for this project.

## Architecture
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
Entry Points: ${architecture.entryPoints.join(", ")}

## Dependencies
${depsContext}

${claudeMdContext ? `## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## API Endpoints Found: ${partialResult.apiEndpoints.length}
## UI Components Found: ${partialResult.components.length}
## Data Models Found: ${partialResult.dataModels.length}

## Instructions
Use Read to examine the README, package.json, and any setup/config files for accurate installation steps.
Produce a getting-started guide with:
- prerequisites: array of required tools/runtimes with version requirements
- installation: step-by-step installation instructions in markdown
- quickStart: how to get the project running in markdown
- configuration: configuration options and environment variables in markdown
- examples: common usage examples in markdown
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: guideOutputSchema,
    maxTurns: 15,
  });
}
