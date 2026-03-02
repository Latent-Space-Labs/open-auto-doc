import fs from "node:fs";
import path from "node:path";
import type { ImportEdge, ImportGraph, ModuleCluster } from "../types.js";

const IMPORT_PATTERNS = [
  // ES modules: import ... from "..."
  /from\s+["']([^"']+)["']/g,
  // ES modules: import "..."
  /import\s+["']([^"']+)["']/g,
  // CommonJS: require("...")
  /require\(\s*["']([^"']+)["']\s*\)/g,
];

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb",
  ".php", ".cs", ".swift", ".dart", ".vue", ".svelte",
]);

const MAX_FILES = 200;

export function buildImportGraph(repoPath: string, flatFiles: string[]): ImportGraph {
  const sourceFiles = flatFiles
    .filter((f) => SOURCE_EXTENSIONS.has(path.extname(f)))
    .slice(0, MAX_FILES);

  const edges: ImportEdge[] = [];
  const fileSet = new Set(flatFiles);

  for (const file of sourceFiles) {
    const fullPath = path.join(repoPath, file);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    for (const pattern of IMPORT_PATTERNS) {
      // Reset lastIndex for each file since patterns are global
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const importPath = match[1];
        const isExternal = !importPath.startsWith(".") && !importPath.startsWith("/");

        if (isExternal) {
          // External dependency — use package name as target
          const pkgName = importPath.startsWith("@")
            ? importPath.split("/").slice(0, 2).join("/")
            : importPath.split("/")[0];
          edges.push({ from: file, to: pkgName, isExternal: true });
        } else {
          // Relative import — resolve to actual file
          const resolved = resolveImport(repoPath, file, importPath, fileSet);
          if (resolved) {
            edges.push({ from: file, to: resolved, isExternal: false });
          }
        }
      }
    }
  }

  const moduleClusters = buildClusters(sourceFiles, edges);

  return { edges, moduleClusters };
}

function resolveImport(
  repoPath: string,
  fromFile: string,
  importPath: string,
  fileSet: Set<string>,
): string | null {
  const dir = path.dirname(fromFile);
  const resolved = path.normalize(path.join(dir, importPath));

  // Try exact path
  if (fileSet.has(resolved)) return resolved;

  // Try with extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
    if (fileSet.has(resolved + ext)) return resolved + ext;
  }

  // Try as directory with index
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const indexPath = path.join(resolved, `index${ext}`);
    if (fileSet.has(indexPath)) return indexPath;
  }

  return null;
}

function buildClusters(sourceFiles: string[], edges: ImportEdge[]): ModuleCluster[] {
  // Group files by top-level directory
  const groups = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const parts = file.split("/");
    const topDir = parts.length > 1 ? parts[0] : "(root)";
    const group = groups.get(topDir) || [];
    group.push(file);
    groups.set(topDir, group);
  }

  const clusters: ModuleCluster[] = [];
  for (const [name, files] of groups) {
    const fileSet = new Set(files);
    let internalEdgeCount = 0;
    let externalEdgeCount = 0;

    for (const edge of edges) {
      if (!fileSet.has(edge.from)) continue;
      if (edge.isExternal || !fileSet.has(edge.to)) {
        externalEdgeCount++;
      } else {
        internalEdgeCount++;
      }
    }

    clusters.push({ name, files, internalEdgeCount, externalEdgeCount });
  }

  return clusters.sort((a, b) => b.files.length - a.files.length);
}
