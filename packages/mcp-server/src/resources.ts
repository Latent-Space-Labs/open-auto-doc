import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisResult } from "./types.js";

export function registerResources(server: McpServer, results: AnalysisResult[]): void {
  // For single-repo setups, use the first result directly
  const primary = results[0];

  // Static resource: overview
  server.registerResource(
    "overview",
    "docs://overview",
    {
      description: "Project overview — purpose, tech stack, and summary",
      mimeType: "text/plain",
    },
    () => {
      const sections = results.map((r) =>
        [
          `# ${r.repoName}`,
          "",
          `**Purpose:** ${r.architecture.projectPurpose}`,
          `**Audience:** ${r.architecture.targetAudience}`,
          `**Tech Stack:** ${r.architecture.techStack.join(", ")}`,
          "",
          r.architecture.summary,
        ].join("\n"),
      );
      return {
        contents: [
          {
            uri: "docs://overview",
            text: sections.join("\n\n---\n\n"),
          },
        ],
      };
    },
  );

  // Static resource: architecture
  server.registerResource(
    "architecture",
    "docs://architecture",
    {
      description: "Architecture details — modules, data flow, patterns",
      mimeType: "text/plain",
    },
    () => {
      const sections = results.map((r) => {
        const modules = r.architecture.modules
          .map(
            (m) =>
              `### ${m.name}\n${m.description}\n- Files: ${m.files.join(", ")}\n- Responsibilities: ${m.responsibilities.join(", ")}`,
          )
          .join("\n\n");
        return [
          `# ${r.repoName} — Architecture`,
          "",
          r.architecture.summary,
          "",
          "## Modules",
          modules,
          "",
          "## Data Flow",
          r.architecture.dataFlow,
          "",
          "## Key Patterns",
          r.architecture.keyPatterns.map((p) => `- ${p}`).join("\n"),
          "",
          "## Entry Points",
          r.architecture.entryPoints.map((e) => `- ${e}`).join("\n"),
        ].join("\n");
      });
      return {
        contents: [
          {
            uri: "docs://architecture",
            text: sections.join("\n\n---\n\n"),
          },
        ],
      };
    },
  );

  // Static resource: getting-started
  server.registerResource(
    "getting-started",
    "docs://getting-started",
    {
      description: "Getting started guide — prerequisites, installation, quick start",
      mimeType: "text/plain",
    },
    () => {
      const sections = results.map((r) =>
        [
          `# Getting Started with ${r.repoName}`,
          "",
          "## Prerequisites",
          r.gettingStarted.prerequisites.map((p) => `- ${p}`).join("\n"),
          "",
          "## Installation",
          r.gettingStarted.installation,
          "",
          "## Quick Start",
          r.gettingStarted.quickStart,
          ...(r.gettingStarted.configuration
            ? ["", "## Configuration", r.gettingStarted.configuration]
            : []),
          ...(r.gettingStarted.examples
            ? ["", "## Examples", r.gettingStarted.examples]
            : []),
        ].join("\n"),
      );
      return {
        contents: [
          {
            uri: "docs://getting-started",
            text: sections.join("\n\n---\n\n"),
          },
        ],
      };
    },
  );

  // Template resource: diagrams
  const allDiagrams = results.flatMap((r) =>
    r.diagrams.map((d) => ({ ...d, repo: r.repoName })),
  );

  server.registerResource(
    "diagram",
    new ResourceTemplate("docs://diagrams/{diagramId}", {
      list: async () => ({
        resources: allDiagrams.map((d) => ({
          uri: `docs://diagrams/${d.id}`,
          name: `${d.title} (${d.repo})`,
          description: d.description,
          mimeType: "text/plain",
        })),
      }),
    }),
    {
      description: "Individual Mermaid diagrams by ID",
      mimeType: "text/plain",
    },
    (uri, { diagramId }) => {
      const diagram = allDiagrams.find((d) => d.id === diagramId);
      if (!diagram) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Diagram "${diagramId}" not found. Available: ${allDiagrams.map((d) => d.id).join(", ")}`,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            text: [
              `# ${diagram.title}`,
              "",
              diagram.description,
              "",
              "```mermaid",
              diagram.mermaidSyntax,
              "```",
            ].join("\n"),
          },
        ],
      };
    },
  );
}
