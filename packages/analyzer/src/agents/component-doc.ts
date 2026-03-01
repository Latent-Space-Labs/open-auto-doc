import fs from "node:fs";
import path from "node:path";
import type { AIProvider, ArchitectureOverview, ComponentDoc, StaticAnalysis } from "../types.js";

const COMPONENT_FILE_PATTERNS = [
  /components?\//i,
  /\.component\.\w+$/,
  /\.vue$/,
  /\.svelte$/,
  /src\/.*\.tsx$/,
];

export async function analyzeComponents(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  provider: AIProvider,
): Promise<ComponentDoc[]> {
  const componentFiles = findComponentFiles(staticAnalysis);
  if (componentFiles.length === 0) return [];

  const fileContents = componentFiles
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

  const systemPrompt = `You are a UI component documentation expert. Analyze source code and extract component documentation.
Always respond with valid JSON. No markdown outside the JSON.`;

  const userPrompt = `Analyze these component files and document the UI components.

## Project Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}

${claudeMdContext ? `## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Component Files
${fileContents}

Respond with a JSON array of components:
[
  {
    "name": "ComponentName",
    "description": "What this component does and when to use it",
    "filePath": "path/to/component.tsx",
    "props": [
      {
        "name": "propName",
        "type": "string",
        "required": true,
        "defaultValue": "optional default",
        "description": "What this prop does"
      }
    ],
    "usage": "Example usage code snippet",
    "category": "Optional category like Layout, Form, Navigation"
  }
]

If no UI components found, return an empty array [].`;

  const response = await provider.chat(systemPrompt, userPrompt);
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as ComponentDoc[];
  } catch {
    return [];
  }
}

function findComponentFiles(staticAnalysis: StaticAnalysis): string[] {
  const flatFiles = getAllFiles(staticAnalysis.fileTree);
  return flatFiles.filter((f) => COMPONENT_FILE_PATTERNS.some((p) => p.test(f)));
}

function getAllFiles(node: { path: string; type: string; children?: typeof node[] }): string[] {
  if (node.type === "file") return [node.path];
  return (node.children || []).flatMap(getAllFiles);
}
