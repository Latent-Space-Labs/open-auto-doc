import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisResult } from "./types.js";
import { searchDocumentation } from "./search.js";

/**
 * Resolve which repo to use. If only one loaded, return it.
 * If multiple, require the `repo` argument.
 */
function resolveRepo(
  results: AnalysisResult[],
  repo?: string,
): AnalysisResult {
  if (results.length === 1) return results[0];
  if (!repo) {
    const names = results.map((r) => r.repoName).join(", ");
    throw new Error(
      `Multiple repos loaded (${names}). Please specify the "repo" argument.`,
    );
  }
  const match = results.find(
    (r) => r.repoName.toLowerCase() === repo.toLowerCase(),
  );
  if (!match) {
    const names = results.map((r) => r.repoName).join(", ");
    throw new Error(`Repo "${repo}" not found. Available: ${names}`);
  }
  return match;
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerTools(server: McpServer, results: AnalysisResult[]): void {
  const repoNames = results.map((r) => r.repoName);
  const repoHint = results.length > 1
    ? ` Available repos: ${repoNames.join(", ")}.`
    : "";

  // 1. get_project_overview
  server.registerTool(
    "get_project_overview",
    {
      description:
        `Get a high-level overview of the project: purpose, tech stack, target audience, and counts of endpoints/components/models.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
      },
    },
    ({ repo }) => {
      const r = resolveRepo(results, repo);
      return textResult({
        repoName: r.repoName,
        repoUrl: r.repoUrl,
        purpose: r.architecture.projectPurpose,
        targetAudience: r.architecture.targetAudience,
        summary: r.architecture.summary,
        techStack: r.architecture.techStack,
        languages: r.staticAnalysis.languages,
        totalFiles: r.staticAnalysis.totalFiles,
        entryPoints: r.architecture.entryPoints,
        counts: {
          apiEndpoints: r.apiEndpoints.length,
          components: r.components.length,
          dataModels: r.dataModels.length,
          diagrams: r.diagrams.length,
          modules: r.architecture.modules.length,
        },
        features: r.features
          ? { tagline: r.features.tagline, featureCount: r.features.features.length }
          : null,
      });
    },
  );

  // 2. search_documentation
  server.registerTool(
    "search_documentation",
    {
      description:
        `Full-text search across all documentation sections (architecture, APIs, components, models, business logic, etc).${repoHint}`,
      inputSchema: {
        query: z.string().describe("Search query"),
        repo: z.string().optional().describe("Filter to a specific repo"),
        limit: z.number().optional().default(10).describe("Max results (default 10)"),
      },
    },
    ({ query, repo, limit }) => {
      const targets = repo ? [resolveRepo(results, repo)] : results;
      const hits = searchDocumentation(targets, query, limit);
      return textResult(hits);
    },
  );

  // 3. get_api_endpoints
  server.registerTool(
    "get_api_endpoints",
    {
      description:
        `List API endpoints with method, path, description, parameters, and auth info.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
        method: z.string().optional().describe("Filter by HTTP method (GET, POST, etc)"),
        pathFilter: z.string().optional().describe("Filter paths containing this substring"),
      },
    },
    ({ repo, method, pathFilter }) => {
      const r = resolveRepo(results, repo);
      let endpoints = r.apiEndpoints;
      if (method) {
        endpoints = endpoints.filter(
          (e) => e.method.toUpperCase() === method.toUpperCase(),
        );
      }
      if (pathFilter) {
        const filter = pathFilter.toLowerCase();
        endpoints = endpoints.filter((e) =>
          e.path.toLowerCase().includes(filter),
        );
      }
      return textResult({
        repo: r.repoName,
        total: endpoints.length,
        endpoints,
      });
    },
  );

  // 4. get_components
  server.registerTool(
    "get_components",
    {
      description:
        `List UI components with name, description, props, usage examples, and file paths.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
        nameFilter: z.string().optional().describe("Filter by component name (substring match)"),
        category: z.string().optional().describe("Filter by component category"),
      },
    },
    ({ repo, nameFilter, category }) => {
      const r = resolveRepo(results, repo);
      let components = r.components;
      if (nameFilter) {
        const filter = nameFilter.toLowerCase();
        components = components.filter((c) =>
          c.name.toLowerCase().includes(filter),
        );
      }
      if (category) {
        const cat = category.toLowerCase();
        components = components.filter(
          (c) => c.category?.toLowerCase() === cat,
        );
      }
      return textResult({
        repo: r.repoName,
        total: components.length,
        components,
      });
    },
  );

  // 5. get_data_models
  server.registerTool(
    "get_data_models",
    {
      description:
        `List data models with fields, types, relationships, and file paths.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
        nameFilter: z.string().optional().describe("Filter by model name (substring match)"),
      },
    },
    ({ repo, nameFilter }) => {
      const r = resolveRepo(results, repo);
      let models = r.dataModels;
      if (nameFilter) {
        const filter = nameFilter.toLowerCase();
        models = models.filter((m) =>
          m.name.toLowerCase().includes(filter),
        );
      }
      return textResult({
        repo: r.repoName,
        total: models.length,
        dataModels: models,
      });
    },
  );

  // 6. get_architecture
  server.registerTool(
    "get_architecture",
    {
      description:
        `Get detailed architecture: modules, data flow, key patterns, and entry points.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
      },
    },
    ({ repo }) => {
      const r = resolveRepo(results, repo);
      return textResult({
        repo: r.repoName,
        summary: r.architecture.summary,
        modules: r.architecture.modules,
        dataFlow: r.architecture.dataFlow,
        keyPatterns: r.architecture.keyPatterns,
        entryPoints: r.architecture.entryPoints,
        diagramCount: r.architecture.diagrams.length,
      });
    },
  );

  // 7. get_diagram
  server.registerTool(
    "get_diagram",
    {
      description:
        `Retrieve Mermaid diagrams. Returns all diagrams if no diagramId specified, or a specific one by ID.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
        diagramId: z.string().optional().describe("Specific diagram ID to retrieve"),
      },
    },
    ({ repo, diagramId }) => {
      const r = resolveRepo(results, repo);
      if (diagramId) {
        const diagram = r.diagrams.find((d) => d.id === diagramId);
        if (!diagram) {
          const ids = r.diagrams.map((d) => d.id).join(", ");
          return textResult({
            error: `Diagram "${diagramId}" not found. Available: ${ids}`,
          });
        }
        return textResult(diagram);
      }
      return textResult({
        repo: r.repoName,
        total: r.diagrams.length,
        diagrams: r.diagrams,
      });
    },
  );

  // 8. get_business_rules
  server.registerTool(
    "get_business_rules",
    {
      description:
        `Get domain concepts, business rules, workflows, and key invariants.${repoHint}`,
      inputSchema: {
        repo: z.string().optional().describe("Repository name (required if multiple repos)"),
      },
    },
    ({ repo }) => {
      const r = resolveRepo(results, repo);
      if (!r.businessLogic) {
        return textResult({
          repo: r.repoName,
          message: "No business logic analysis available for this repo.",
        });
      }
      return textResult({
        repo: r.repoName,
        domainConcepts: r.businessLogic.domainConcepts,
        businessRules: r.businessLogic.businessRules,
        workflows: r.businessLogic.workflows,
        keyInvariants: r.businessLogic.keyInvariants,
      });
    },
  );
}
