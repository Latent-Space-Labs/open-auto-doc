import fs from "node:fs";
import path from "node:path";
import type { AIProvider, ApiEndpoint, ArchitectureOverview, StaticAnalysis } from "../types.js";

const API_FILE_PATTERNS = [
  /routes?\//i,
  /api\//i,
  /controllers?\//i,
  /handlers?\//i,
  /endpoints?\//i,
  /views?\.(py|rb)$/i,
  /\.controller\.\w+$/,
  /\.handler\.\w+$/,
  /\.router\.\w+$/,
  /route\.\w+$/,
];

export async function analyzeApiEndpoints(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  provider: AIProvider,
): Promise<ApiEndpoint[]> {
  const apiFiles = findApiFiles(repoPath, staticAnalysis);
  if (apiFiles.length === 0) return [];

  const fileContents = apiFiles
    .slice(0, 15)
    .map((f) => {
      try {
        const content = fs.readFileSync(path.join(repoPath, f), "utf-8");
        return `--- ${f} ---\n${content.slice(0, 4000)}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");

  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  const systemPrompt = `You are an API documentation expert. Analyze source code and extract API endpoint documentation.
Always respond with valid JSON. No markdown outside the JSON.`;

  const userPrompt = `Analyze these API/route files and document all endpoints.

## Project Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}

${claudeMdContext ? `## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## API Files
${fileContents}

Respond with a JSON array of endpoints:
[
  {
    "method": "GET|POST|PUT|DELETE|PATCH",
    "path": "/api/endpoint",
    "description": "What this endpoint does",
    "parameters": [
      {
        "name": "paramName",
        "type": "string",
        "required": true,
        "description": "What this param is",
        "location": "path|query|header|body"
      }
    ],
    "requestBody": "Description of request body if applicable",
    "responseBody": "Description of response",
    "authentication": "Required auth if any"
  }
]

If no API endpoints found, return an empty array [].`;

  const response = await provider.chat(systemPrompt, userPrompt);
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as ApiEndpoint[];
  } catch {
    return [];
  }
}

function findApiFiles(repoPath: string, staticAnalysis: StaticAnalysis): string[] {
  const flatFiles = getAllFiles(staticAnalysis.fileTree);
  return flatFiles.filter((f) => API_FILE_PATTERNS.some((p) => p.test(f)));
}

function getAllFiles(node: { path: string; type: string; children?: typeof node[] }): string[] {
  if (node.type === "file") return [node.path];
  return (node.children || []).flatMap(getAllFiles);
}
