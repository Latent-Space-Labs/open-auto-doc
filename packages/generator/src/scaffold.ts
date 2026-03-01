import fs from "fs-extra";
import path from "node:path";
import { execSync } from "node:child_process";

export async function scaffoldSite(
  outputDir: string,
  projectName: string,
  templateDir: string,
): Promise<void> {
  // Copy site template to output dir
  await fs.copy(templateDir, outputDir, {
    overwrite: true,
    filter: (src) => {
      const basename = path.basename(src);
      return (
        basename !== "node_modules" &&
        basename !== ".next" &&
        basename !== ".source" &&
        basename !== "dist" &&
        basename !== ".turbo"
      );
    },
  });

  // Replace {{projectName}} placeholders in all relevant files
  const filesToProcess = await findTextFiles(outputDir);
  for (const filePath of filesToProcess) {
    try {
      let content = await fs.readFile(filePath, "utf-8");
      if (content.includes("{{projectName}}")) {
        content = content.replace(/\{\{projectName\}\}/g, projectName);
        await fs.writeFile(filePath, content, "utf-8");
      }
    } catch {
      // Skip binary files
    }
  }

  // Install dependencies
  const nodeModulesPath = path.join(outputDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    // First install without postinstall (fumadocs-mdx needs source.config.ts to exist)
    try {
      execSync("npm install --ignore-scripts", {
        cwd: outputDir,
        stdio: "pipe",
        timeout: 120000,
      });
    } catch (err) {
      const hasNodeModules = fs.existsSync(nodeModulesPath);
      if (!hasNodeModules) {
        throw new Error(`npm install failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Now run fumadocs-mdx to generate .source directory
    try {
      execSync("npx fumadocs-mdx", { cwd: outputDir, stdio: "pipe", timeout: 30000 });
    } catch {
      // Non-fatal — dev server will generate .source on startup
    }
  }
}

async function findTextFiles(dir: string): Promise<string[]> {
  const textExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".mdx",
    ".css", ".html", ".yaml", ".yml", ".toml", ".mjs",
  ]);

  const results: string[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next" && entry.name !== ".source") {
          await walk(fullPath);
        }
      } else if (textExtensions.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}
