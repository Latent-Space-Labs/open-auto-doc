import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";

const MCP_SERVER_KEY = "project-docs";

function getMcpConfig() {
  return {
    command: "npx",
    args: ["-y", "@latent-space-labs/open-auto-doc-mcp", "--project-dir", "."],
  };
}

/**
 * Programmatic setup — called from init command.
 * Writes/merges .mcp.json in the current working directory.
 */
export async function setupMcpConfig(opts: { outputDir: string }): Promise<void> {
  const cacheDir = path.join(opts.outputDir, ".autodoc-cache");
  if (!fs.existsSync(cacheDir)) {
    p.log.warn("No analysis cache found — skipping MCP setup. Run setup-mcp after generating docs.");
    return;
  }

  writeMcpJson(process.cwd());
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

  writeMcpJson(process.cwd());

  p.log.success("MCP server configured!");
  p.note(
    [
      "The following tools are now available in Claude Code:",
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
    "Available MCP tools",
  );

  p.outro("Open Claude Code in this project to start using the tools.");
}

function writeMcpJson(projectRoot: string): void {
  const mcpPath = path.join(projectRoot, ".mcp.json");

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(mcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    } catch {
      // Overwrite invalid JSON
    }
  }

  const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_KEY] = getMcpConfig();

  const merged = { ...existing, mcpServers };
  fs.writeFileSync(mcpPath, JSON.stringify(merged, null, 2) + "\n");

  p.log.step(`Wrote ${path.relative(projectRoot, mcpPath)}`);
}
