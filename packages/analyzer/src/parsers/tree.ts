import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { FileNode } from "../types.js";

const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".turbo",
  "target",
  ".DS_Store",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export function buildFileTree(
  rootPath: string,
  maxDepth = 6,
): { tree: FileNode; flatFiles: string[]; totalFiles: number } {
  const ig = loadGitignore(rootPath);
  const flatFiles: string[] = [];

  function walk(dirPath: string, depth: number): FileNode {
    const name = path.basename(dirPath);
    const node: FileNode = { path: path.relative(rootPath, dirPath) || ".", name, type: "directory", children: [] };

    if (depth > maxDepth) return node;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return node;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.relative(rootPath, path.join(dirPath, entry.name));
      if (ig.ignores(rel) || ig.ignores(rel + "/")) continue;

      if (entry.isDirectory()) {
        const child = walk(path.join(dirPath, entry.name), depth + 1);
        node.children!.push(child);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1);
        let size: number | undefined;
        try {
          size = fs.statSync(path.join(dirPath, entry.name)).size;
        } catch {
          // skip
        }
        flatFiles.push(rel);
        node.children!.push({
          path: rel,
          name: entry.name,
          type: "file",
          extension: ext || undefined,
          size,
        });
      }
    }

    return node;
  }

  const tree = walk(rootPath, 0);
  return { tree, flatFiles, totalFiles: flatFiles.length };
}

function loadGitignore(rootPath: string): Ignore {
  const ig = ignore.default();
  ig.add(DEFAULT_IGNORES);

  const gitignorePath = path.join(rootPath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    ig.add(content);
  }

  return ig;
}

export function detectLanguages(flatFiles: string[]): string[] {
  const extMap: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    kt: "Kotlin",
    rb: "Ruby",
    php: "PHP",
    cs: "C#",
    cpp: "C++",
    c: "C",
    swift: "Swift",
    dart: "Dart",
    vue: "Vue",
    svelte: "Svelte",
  };

  const langs = new Set<string>();
  for (const file of flatFiles) {
    const ext = path.extname(file).slice(1);
    if (extMap[ext]) langs.add(extMap[ext]);
  }
  return Array.from(langs);
}

export function detectEntryFiles(flatFiles: string[]): string[] {
  const entryPatterns = [
    /^src\/index\.\w+$/,
    /^src\/main\.\w+$/,
    /^src\/app\.\w+$/,
    /^index\.\w+$/,
    /^main\.\w+$/,
    /^app\.\w+$/,
    /^src\/server\.\w+$/,
    /^server\.\w+$/,
    /^cmd\/.*\/main\.go$/,
    /^manage\.py$/,
    /^app\/page\.tsx$/,
    /^pages\/index\.\w+$/,
  ];

  return flatFiles.filter((f) => entryPatterns.some((p) => p.test(f)));
}

export function fileTreeToString(node: FileNode, indent = ""): string {
  if (node.type === "file") {
    return `${indent}${node.name}\n`;
  }
  let result = indent ? `${indent}${node.name}/\n` : "";
  const nextIndent = indent ? indent + "  " : "";
  for (const child of node.children || []) {
    result += fileTreeToString(child, nextIndent);
  }
  return result;
}
