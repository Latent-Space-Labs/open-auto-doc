import fs from "node:fs";
import path from "node:path";
import type { ClaudeMdContent } from "../types.js";

const CLAUDE_MD_PATHS = ["CLAUDE.md", ".claude/CLAUDE.md"];

export function readClaudeMd(repoPath: string): ClaudeMdContent[] {
  const results: ClaudeMdContent[] = [];

  for (const relPath of CLAUDE_MD_PATHS) {
    const fullPath = path.join(repoPath, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (content.trim()) {
          results.push({ path: relPath, content });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results;
}
