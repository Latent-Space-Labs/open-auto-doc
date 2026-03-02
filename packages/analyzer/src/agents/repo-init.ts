import fs from "node:fs";
import path from "node:path";
import type { StaticAnalysis } from "../types.js";
import { runAgent } from "../agent-sdk.js";
import { readClaudeMd } from "../parsers/claude-md.js";

interface RepoInitResult {
  content: string;
}

const repoInitSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "The CLAUDE.md file content in markdown format",
    },
  },
  required: ["content"],
};

export async function initializeRepo(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<StaticAnalysis> {
  // Skip if CLAUDE.md already exists
  if (staticAnalysis.claudeMd.length > 0) {
    return staticAnalysis;
  }

  const depsContext = staticAnalysis.dependencies
    .map((d) => {
      const allDeps = { ...d.dependencies, ...d.devDependencies };
      return `${d.packageManager}: ${Object.keys(allDeps).slice(0, 30).join(", ")}`;
    })
    .join("\n");

  const importGraphSummary = staticAnalysis.importGraph
    ? `Import graph: ${staticAnalysis.importGraph.edges.length} edges, ${staticAnalysis.importGraph.moduleClusters.length} module clusters (${staticAnalysis.importGraph.moduleClusters.map((c) => `${c.name}: ${c.files.length} files`).join(", ")})`
    : "";

  const result = await runAgent<RepoInitResult>({
    onAgentMessage,
    systemPrompt: `You are a senior developer writing a CLAUDE.md file for a codebase. CLAUDE.md is a concise project reference that helps AI agents understand the repo quickly. Your output must be valid JSON matching the provided schema.`,
    prompt: `Generate a CLAUDE.md file for this repository.

## Known Context (from static parsing)
- Languages: ${staticAnalysis.languages.join(", ")}
- Entry files: ${staticAnalysis.entryFiles.join(", ")}
- Dependencies:
${depsContext}
- Total files: ${staticAnalysis.totalFiles}
${importGraphSummary ? `- ${importGraphSummary}` : ""}

## Instructions
Explore the repo to understand its structure, then produce a CLAUDE.md with these sections:

1. **Project overview** — one-line description of what this project does
2. **Build & run** — key commands (build, test, dev server, lint)
3. **Architecture** — brief description of the main directories and their roles
4. **Key conventions** — coding patterns, naming conventions, important design decisions
5. **Tech stack** — frameworks, libraries, and tools used

Keep it concise (under 100 lines). Focus on information that helps an AI agent navigate and understand the codebase quickly.
Read the README, package.json/Cargo.toml/etc., and a few key source files to gather this info.
Do NOT read more than 10-12 files total.`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: repoInitSchema,
    maxTurns: 15,
  });

  // Write CLAUDE.md to the repo root
  const claudeMdPath = path.join(repoPath, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, result.content, "utf-8");

  // Re-read to update staticAnalysis
  const updatedClaudeMd = readClaudeMd(repoPath);

  return {
    ...staticAnalysis,
    claudeMd: updatedClaudeMd,
  };
}
