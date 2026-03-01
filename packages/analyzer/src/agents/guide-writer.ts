import type {
  AIProvider,
  AnalysisResult,
  ArchitectureOverview,
  GettingStartedGuide,
  StaticAnalysis,
} from "../types.js";

export async function writeGettingStarted(
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  partialResult: Pick<AnalysisResult, "apiEndpoints" | "components" | "dataModels">,
  provider: AIProvider,
): Promise<GettingStartedGuide> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");
  const depsContext = staticAnalysis.dependencies
    .map((d) => `${d.packageManager}: ${Object.keys(d.dependencies).slice(0, 20).join(", ")}`)
    .join("\n");

  const systemPrompt = `You are a technical writer creating getting-started guides for developers.
Always respond with valid JSON. No markdown outside the JSON.`;

  const userPrompt = `Create a getting-started guide for this project.

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

Respond with this JSON structure:
{
  "prerequisites": ["Node.js >= 18", "npm or yarn", ...other prereqs],
  "installation": "Step by step installation instructions in markdown",
  "quickStart": "Quick start guide in markdown showing how to get the project running",
  "configuration": "Configuration options and environment variables in markdown",
  "examples": "Common usage examples in markdown"
}`;

  const response = await provider.chat(systemPrompt, userPrompt);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      prerequisites: ["See project README"],
      installation: "See project README for installation instructions.",
      quickStart: "See project README for quick start guide.",
    };
  }
  return JSON.parse(jsonMatch[0]) as GettingStartedGuide;
}
