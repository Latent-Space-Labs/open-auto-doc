import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisResult } from "./types.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

export function createServer(results: AnalysisResult[]): McpServer {
  const repoNames = results.map((r) => r.repoName).join(", ");

  const server = new McpServer({
    name: "open-auto-doc",
    version: "0.5.2",
  }, {
    instructions: `This server provides documentation for: ${repoNames}. ` +
      `Use the tools to query project architecture, API endpoints, components, data models, diagrams, and business rules. ` +
      `Use search_documentation for free-text search across all sections.`,
  });

  registerTools(server, results);
  registerResources(server, results);

  return server;
}
