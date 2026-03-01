import fs from "node:fs";
import path from "node:path";
import type { AIProvider, ArchitectureOverview, DataModelDoc, StaticAnalysis } from "../types.js";

const MODEL_FILE_PATTERNS = [
  /models?\//i,
  /schemas?\//i,
  /entities?\//i,
  /types?\//i,
  /\.model\.\w+$/,
  /\.schema\.\w+$/,
  /\.entity\.\w+$/,
  /prisma\/schema\.prisma$/,
  /migrations?\//i,
];

export async function analyzeDataModels(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  provider: AIProvider,
): Promise<DataModelDoc[]> {
  const modelFiles = findModelFiles(staticAnalysis);
  if (modelFiles.length === 0) return [];

  const fileContents = modelFiles
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

  const systemPrompt = `You are a data modeling documentation expert. Analyze source code and extract data model documentation.
Always respond with valid JSON. No markdown outside the JSON.`;

  const userPrompt = `Analyze these model/schema files and document the data models.

## Project Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}

${claudeMdContext ? `## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Model Files
${fileContents}

Respond with a JSON array of data models:
[
  {
    "name": "ModelName",
    "description": "What this model represents",
    "filePath": "path/to/model.ts",
    "fields": [
      {
        "name": "fieldName",
        "type": "string",
        "description": "What this field represents",
        "constraints": ["required", "unique"]
      }
    ],
    "relationships": ["Relates to OtherModel via foreignKey"]
  }
]

If no data models found, return an empty array [].`;

  const response = await provider.chat(systemPrompt, userPrompt);
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as DataModelDoc[];
  } catch {
    return [];
  }
}

function findModelFiles(staticAnalysis: StaticAnalysis): string[] {
  const flatFiles = getAllFiles(staticAnalysis.fileTree);
  return flatFiles.filter((f) => MODEL_FILE_PATTERNS.some((p) => p.test(f)));
}

function getAllFiles(node: { path: string; type: string; children?: typeof node[] }): string[] {
  if (node.type === "file") return [node.path];
  return (node.children || []).flatMap(getAllFiles);
}
