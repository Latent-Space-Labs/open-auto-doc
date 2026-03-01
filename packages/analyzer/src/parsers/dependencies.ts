import fs from "node:fs";
import path from "node:path";
import type { DependencyInfo } from "../types.js";

interface DepFileSpec {
  filename: string;
  packageManager: string;
  parse: (content: string) => { deps: Record<string, string>; devDeps: Record<string, string> };
}

const DEP_FILES: DepFileSpec[] = [
  {
    filename: "package.json",
    packageManager: "npm",
    parse: (content) => {
      const pkg = JSON.parse(content);
      return {
        deps: pkg.dependencies || {},
        devDeps: pkg.devDependencies || {},
      };
    },
  },
  {
    filename: "requirements.txt",
    packageManager: "pip",
    parse: (content) => {
      const deps: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[><=!~]+(.*))?$/);
        if (match) deps[match[1]] = match[2] || "*";
      }
      return { deps, devDeps: {} };
    },
  },
  {
    filename: "pyproject.toml",
    packageManager: "pip",
    parse: (content) => {
      const deps: Record<string, string> = {};
      const depSection = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depSection) {
        for (const match of depSection[1].matchAll(/"([^"]+)"/g)) {
          const parts = match[1].match(/^([a-zA-Z0-9_-]+)/);
          if (parts) deps[parts[1]] = "*";
        }
      }
      return { deps, devDeps: {} };
    },
  },
  {
    filename: "go.mod",
    packageManager: "go",
    parse: (content) => {
      const deps: Record<string, string> = {};
      const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireBlock) {
        for (const line of requireBlock[1].split("\n")) {
          const match = line.trim().match(/^(\S+)\s+(\S+)/);
          if (match) deps[match[1]] = match[2];
        }
      }
      return { deps, devDeps: {} };
    },
  },
  {
    filename: "Cargo.toml",
    packageManager: "cargo",
    parse: (content) => {
      const deps: Record<string, string> = {};
      const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depSection) {
        for (const line of depSection[1].split("\n")) {
          const match = line.trim().match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"\n]+)/);
          if (match) deps[match[1]] = match[2];
        }
      }
      return { deps, devDeps: {} };
    },
  },
  {
    filename: "Gemfile",
    packageManager: "bundler",
    parse: (content) => {
      const deps: Record<string, string> = {};
      for (const match of content.matchAll(/gem\s+['"]([^'"]+)['"]/g)) {
        deps[match[1]] = "*";
      }
      return { deps, devDeps: {} };
    },
  },
  {
    filename: "composer.json",
    packageManager: "composer",
    parse: (content) => {
      const pkg = JSON.parse(content);
      return {
        deps: pkg.require || {},
        devDeps: pkg["require-dev"] || {},
      };
    },
  },
];

export function parseDependencies(repoPath: string): DependencyInfo[] {
  const results: DependencyInfo[] = [];

  for (const spec of DEP_FILES) {
    const filePath = path.join(repoPath, spec.filename);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const { deps, devDeps } = spec.parse(content);
      results.push({
        packageManager: spec.packageManager,
        dependencies: deps,
        devDependencies: devDeps,
        raw: content,
      });
    } catch {
      // Skip unparseable files
    }
  }

  return results;
}
