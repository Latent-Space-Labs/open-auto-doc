import fs from "node:fs";
import path from "node:path";
import type { AIProvider, ArchitectureOverview, StaticAnalysis } from "../types.js";
import { fileTreeToString } from "../parsers/tree.js";

export async function analyzeArchitecture(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  provider: AIProvider,
): Promise<ArchitectureOverview> {
  const treeStr = fileTreeToString(staticAnalysis.fileTree);
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => `--- ${c.path} ---\n${c.content}`).join("\n\n");
  const depsContext = staticAnalysis.dependencies
    .map((d) => `${d.packageManager}: ${Object.keys(d.dependencies).join(", ")}`)
    .join("\n");

  // Read key files for deeper context
  const keyFileContents = readKeyFiles(repoPath, staticAnalysis.entryFiles, staticAnalysis.fileTree);

  const systemPrompt = `You are a senior software architect analyzing a codebase. You produce structured JSON analysis.
Always respond with valid JSON matching the requested schema. No markdown, no explanations outside the JSON.`;

  const userPrompt = `Analyze this repository and produce a JSON architecture overview.

## File Tree
${treeStr}

## Languages Detected
${staticAnalysis.languages.join(", ")}

## Dependencies
${depsContext}

${claudeMdContext ? `## CLAUDE.md Project Context\n${claudeMdContext}\n` : ""}

## Key File Contents
${keyFileContents}

Respond with this exact JSON structure:
{
  "summary": "2-3 paragraph description of what this project does, its purpose, and how it works",
  "techStack": ["list", "of", "technologies"],
  "modules": [
    {
      "name": "module name",
      "description": "what this module does",
      "files": ["key/files.ts"],
      "responsibilities": ["responsibility 1", "responsibility 2"]
    }
  ],
  "dataFlow": "Description of how data flows through the application",
  "entryPoints": ["main entry point files"],
  "keyPatterns": ["architectural patterns used, e.g. MVC, event-driven, etc."]
}`;

  const response = await provider.chat(systemPrompt, userPrompt);
  return parseJsonResponse<ArchitectureOverview>(response);
}

function readKeyFiles(
  repoPath: string,
  entryFiles: string[],
  _fileTree: { children?: { path: string; type: string; name: string }[] },
): string {
  const filesToRead = [...entryFiles];

  // Also look for common config/key files
  const configFiles = [
    "README.md",
    "src/app.ts",
    "src/app.tsx",
    "src/index.ts",
    "src/index.tsx",
    "app/layout.tsx",
    "app/page.tsx",
    "src/main.py",
    "main.go",
    "src/lib.rs",
  ];

  for (const f of configFiles) {
    if (!filesToRead.includes(f) && fs.existsSync(path.join(repoPath, f))) {
      filesToRead.push(f);
    }
  }

  const contents: string[] = [];
  for (const file of filesToRead.slice(0, 10)) {
    const fullPath = path.join(repoPath, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Limit per-file to 3000 chars
        contents.push(`--- ${file} ---\n${content.slice(0, 3000)}`);
      } catch {
        // skip
      }
    }
  }
  return contents.join("\n\n");
}

function parseJsonResponse<T>(response: string): T {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in AI response");
  }
  return JSON.parse(jsonMatch[0]) as T;
}
