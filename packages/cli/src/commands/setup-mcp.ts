import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";

const MCP_SERVER_KEY = "project-docs";

function getMcpConfig(docsDir: string) {
  return {
    command: "npx",
    args: ["-y", "@latent-space-labs/open-auto-doc-mcp", "--project-dir", docsDir],
  };
}

/**
 * Programmatic setup — called from init command.
 * Writes .mcp.json in CWD and docs directory, shows connection instructions.
 */
export async function setupMcpConfig(opts: { outputDir: string }): Promise<void> {
  const absOutputDir = path.resolve(opts.outputDir);

  // Write .mcp.json in the current working directory (for local Claude Code usage)
  writeMcpJson(process.cwd(), absOutputDir);

  // Also write .mcp.json in the docs directory itself
  writeMcpJson(absOutputDir, absOutputDir);

  // Add mcp npm script to the docs site's package.json
  addMcpScript(absOutputDir);

  showMcpInstructions(absOutputDir);
}

/**
 * CLI command handler for `open-auto-doc setup-mcp`.
 */
export async function setupMcpCommand() {
  p.intro("open-auto-doc — MCP Server Setup");

  const config = loadConfig();
  if (!config) {
    p.log.error(
      "No .autodocrc.json found. Run `open-auto-doc init` first to generate documentation.",
    );
    process.exit(1);
  }

  const cacheDir = path.join(config.outputDir, ".autodoc-cache");
  if (!fs.existsSync(cacheDir)) {
    p.log.error(
      `No analysis cache found at ${cacheDir}.\n` +
      `Run \`open-auto-doc init\` or \`open-auto-doc generate\` first.`,
    );
    process.exit(1);
  }

  const cacheFiles = fs.readdirSync(cacheDir).filter((f) => f.endsWith("-analysis.json"));
  if (cacheFiles.length === 0) {
    p.log.error("Cache directory exists but contains no analysis files.");
    process.exit(1);
  }

  const absOutputDir = path.resolve(config.outputDir);
  writeMcpJson(process.cwd(), absOutputDir);
  writeMcpJson(absOutputDir, absOutputDir);
  addMcpScript(absOutputDir);

  showMcpInstructions(absOutputDir);
  p.outro("Open Claude Code in this project to start using the tools.");
}

function writeMcpJson(projectRoot: string, docsDir: string): void {
  const mcpPath = path.join(projectRoot, ".mcp.json");
  // Use relative path if docs dir is under project root, otherwise absolute
  const relDocsDir = path.relative(projectRoot, docsDir);
  const isSubdir = !relDocsDir.startsWith("..") && !path.isAbsolute(relDocsDir);
  const configDocsDir = isSubdir ? `./${relDocsDir}` : docsDir;

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(mcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    } catch {
      // Overwrite invalid JSON
    }
  }

  const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_KEY] = getMcpConfig(configDocsDir);

  const merged = { ...existing, mcpServers };
  fs.writeFileSync(mcpPath, JSON.stringify(merged, null, 2) + "\n");

  p.log.step(`Wrote ${mcpPath}`);
}

function addMcpScript(docsDir: string): void {
  const pkgPath = path.join(docsDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    pkg.scripts = pkg.scripts ?? {};
    pkg.scripts.mcp = "npx -y @latent-space-labs/open-auto-doc-mcp --project-dir .";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    p.log.step(`Added 'mcp' script to ${pkgPath}`);
  } catch {
    // Non-critical
  }
}

function showMcpInstructions(docsDir: string): void {
  p.log.success("MCP server configured!");

  p.note(
    [
      "The following tools are now available:",
      "",
      "  get_project_overview    — Project summary and tech stack",
      "  search_documentation    — Full-text search across all docs",
      "  get_api_endpoints       — API endpoint details",
      "  get_components          — UI component documentation",
      "  get_data_models         — Data model schemas",
      "  get_architecture        — Architecture and patterns",
      "  get_diagram             — Mermaid diagrams",
      "  get_business_rules      — Domain concepts and workflows",
    ].join("\n"),
    "Available MCP Tools",
  );

  p.note(
    [
      "A .mcp.json file has been written to your project.",
      "Claude Code will automatically detect it.",
      "",
      "To use from another project, add this to its .mcp.json:",
      "",
      `  {`,
      `    "mcpServers": {`,
      `      "project-docs": {`,
      `        "command": "npx",`,
      `        "args": ["-y", "@latent-space-labs/open-auto-doc-mcp",`,
      `                 "--project-dir", "${docsDir}"]`,
      `      }`,
      `    }`,
      `  }`,
      "",
      "Or run the MCP server directly from the docs directory:",
      "",
      `  cd ${docsDir} && npm run mcp`,
    ].join("\n"),
    "How to Connect",
  );
}
