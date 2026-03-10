import type { AnalysisResult, CrossRepoAnalysis } from "./types.js";

export interface GraphNode {
  id: string;
  name: string;
  type: "module" | "api" | "component" | "dataModel" | "external" | "repo" | "feature";
  description: string;
  val: number;
  color: string;
  docPath?: string;
  group?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  label?: string;
  value?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NODE_COLORS: Record<GraphNode["type"], string> = {
  module: "#3b82f6",     // blue
  api: "#22c55e",        // green
  component: "#a855f7",  // purple
  dataModel: "#f97316",  // orange
  external: "#6b7280",   // gray
  repo: "#2563eb",       // darker blue (larger)
  feature: "#ec4899",    // pink
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── File→Module resolution helpers ────────────────────────────────────────────

/**
 * Build a file→module lookup from architecture modules.
 * Indexes by exact path + common directory prefix for fuzzy matching.
 */
function buildFileToModuleMap(
  modules: AnalysisResult["architecture"]["modules"],
  idPrefix = "",
): {
  exact: Map<string, string>;
  prefixes: { prefix: string; moduleId: string }[];
} {
  const exact = new Map<string, string>();
  const prefixes: { prefix: string; moduleId: string }[] = [];

  for (const mod of modules) {
    const moduleId = `${idPrefix}module-${slugify(mod.name)}`;
    for (const f of mod.files) {
      exact.set(f, moduleId);
    }

    if (mod.files.length > 0) {
      const dirs = mod.files.map((f) => {
        const lastSlash = f.lastIndexOf("/");
        return lastSlash >= 0 ? f.slice(0, lastSlash + 1) : "";
      }).filter(Boolean);

      if (dirs.length > 0) {
        let commonPrefix = dirs[0];
        for (let i = 1; i < dirs.length; i++) {
          while (!dirs[i].startsWith(commonPrefix) && commonPrefix.length > 0) {
            const slashIdx = commonPrefix.lastIndexOf("/", commonPrefix.length - 2);
            commonPrefix = slashIdx >= 0 ? commonPrefix.slice(0, slashIdx + 1) : "";
          }
        }
        if (commonPrefix.length > 0) {
          prefixes.push({ prefix: commonPrefix, moduleId });
        }
      }
    }
  }

  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return { exact, prefixes };
}

function findModuleForFile(
  filePath: string,
  fileMap: ReturnType<typeof buildFileToModuleMap>,
): string | undefined {
  const exactMatch = fileMap.exact.get(filePath);
  if (exactMatch) return exactMatch;

  for (const { prefix, moduleId } of fileMap.prefixes) {
    if (filePath.startsWith(prefix)) {
      return moduleId;
    }
  }
  return undefined;
}

/**
 * Reconcile importGraph.moduleClusters → architecture module IDs
 * by file overlap, then name matching as fallback.
 */
function buildClusterToArchModuleMap(
  clusters: AnalysisResult["staticAnalysis"]["importGraph"],
  archModules: AnalysisResult["architecture"]["modules"],
  nodeIds: Set<string>,
  idPrefix = "",
): Map<string, string> {
  const fileToModule = new Map<string, string>();
  if (!clusters) return fileToModule;

  for (const cluster of clusters.moduleClusters) {
    let bestModuleId: string | undefined;
    let bestOverlap = 0;

    for (const mod of archModules) {
      const modId = `${idPrefix}module-${slugify(mod.name)}`;
      if (!nodeIds.has(modId)) continue;

      const overlap = cluster.files.filter((f) =>
        mod.files.some((mf) => f === mf || f.startsWith(mf) || mf.startsWith(f)),
      ).length;

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestModuleId = modId;
      }
    }

    if (!bestModuleId) {
      const candidateId = `${idPrefix}module-${slugify(cluster.name)}`;
      if (nodeIds.has(candidateId)) {
        bestModuleId = candidateId;
      }
    }

    if (bestModuleId) {
      for (const f of cluster.files) {
        fileToModule.set(f, bestModuleId);
      }
    }
  }

  return fileToModule;
}

// ─── Helpers shared by single-repo and per-repo-in-cross-repo ──────────────────

interface GraphBuilder {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeIds: Set<string>;
  linkKeys: Set<string>;
}

function createBuilder(): GraphBuilder {
  return { nodes: [], links: [], nodeIds: new Set(), linkKeys: new Set() };
}

function addNode(b: GraphBuilder, node: GraphNode) {
  if (b.nodeIds.has(node.id)) return;
  b.nodeIds.add(node.id);
  b.nodes.push(node);
}

function addLink(b: GraphBuilder, link: GraphLink) {
  const key = `${link.source}→${link.target}→${link.type}`;
  if (b.linkKeys.has(key)) return;
  b.linkKeys.add(key);
  b.links.push(link);
}

/**
 * Add all per-repo nodes (modules, APIs, components, data models, features)
 * and internal links to a GraphBuilder. Supports an optional ID prefix so
 * the same function can be reused for namespaced cross-repo graphs.
 */
function addRepoInternals(
  b: GraphBuilder,
  result: AnalysisResult,
  idPrefix = "",
  docPathPrefix = "",
  group?: string,
) {
  // ── Modules ──
  for (const mod of result.architecture.modules) {
    addNode(b, {
      id: `${idPrefix}module-${slugify(mod.name)}`,
      name: mod.name,
      type: "module",
      description: mod.description,
      val: Math.max(mod.files.length, 3),
      color: NODE_COLORS.module,
      docPath: `${docPathPrefix}architecture`,
      group,
      metadata: { files: mod.files, responsibilities: mod.responsibilities },
    });
  }

  const fileMap = buildFileToModuleMap(result.architecture.modules, idPrefix);

  // ── Features ──
  if (result.features && result.features.features.length > 0) {
    for (const feat of result.features.features) {
      const id = `${idPrefix}feature-${slugify(feat.name)}`;
      addNode(b, {
        id,
        name: feat.name,
        type: "feature",
        description: feat.description,
        val: Math.max(feat.relatedFiles.length, 2),
        color: NODE_COLORS.feature,
        docPath: `${docPathPrefix}features`,
        group,
        metadata: { category: feat.category, relatedFiles: feat.relatedFiles },
      });

      // Link feature → modules via relatedFiles
      const linkedModules = new Set<string>();
      for (const file of feat.relatedFiles) {
        const modId = findModuleForFile(file, fileMap);
        if (modId && b.nodeIds.has(modId) && !linkedModules.has(modId)) {
          linkedModules.add(modId);
          addLink(b, { source: id, target: modId, type: "implemented-by", label: "implemented by" });
        }
      }

      // If no file-based match, try matching feature category to module name
      if (linkedModules.size === 0) {
        for (const mod of result.architecture.modules) {
          const modId = `${idPrefix}module-${slugify(mod.name)}`;
          if (!b.nodeIds.has(modId)) continue;
          if (
            slugify(mod.name) === slugify(feat.category) ||
            mod.name.toLowerCase().includes(feat.category.toLowerCase()) ||
            feat.category.toLowerCase().includes(mod.name.toLowerCase()) ||
            mod.name.toLowerCase().includes(feat.name.toLowerCase().split(" ")[0])
          ) {
            addLink(b, { source: id, target: modId, type: "implemented-by", label: "implemented by" });
            break;
          }
        }
      }
    }
  }

  // ── API endpoints (grouped by base path) ──
  if (result.apiEndpoints.length > 0) {
    const groups = new Map<string, typeof result.apiEndpoints>();
    for (const ep of result.apiEndpoints) {
      const segments = ep.path.split("/").filter(Boolean);
      const base = segments[0] || "api";
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base)!.push(ep);
    }

    for (const [base, endpoints] of groups) {
      const id = `${idPrefix}api-${slugify(base)}`;
      addNode(b, {
        id,
        name: `/${base}`,
        type: "api",
        description: `${endpoints.length} endpoint${endpoints.length > 1 ? "s" : ""}: ${endpoints.map((e) => `${e.method} ${e.path}`).slice(0, 3).join(", ")}${endpoints.length > 3 ? "..." : ""}`,
        val: Math.max(endpoints.length, 2),
        color: NODE_COLORS.api,
        docPath: `${docPathPrefix}api`,
        group,
        metadata: { endpoints: endpoints.map((e) => `${e.method} ${e.path}`) },
      });
    }
  }

  // ── Components ──
  for (const comp of result.components) {
    addNode(b, {
      id: `${idPrefix}component-${slugify(comp.name)}`,
      name: comp.name,
      type: "component",
      description: comp.description,
      val: 2 + (comp.props?.length || 0),
      color: NODE_COLORS.component,
      docPath: `${docPathPrefix}components`,
      group,
      metadata: { filePath: comp.filePath, category: comp.category },
    });
  }

  // ── Data models ──
  for (const model of result.dataModels) {
    addNode(b, {
      id: `${idPrefix}dataModel-${slugify(model.name)}`,
      name: model.name,
      type: "dataModel",
      description: model.description,
      val: 2 + (model.fields?.length || 0),
      color: NODE_COLORS.dataModel,
      docPath: `${docPathPrefix}data-models`,
      group,
      metadata: { filePath: model.filePath, relationships: model.relationships },
    });
  }

  // ── Import graph edges (module↔module) + external deps ──
  const externalToModules = new Map<string, Set<string>>();

  if (result.staticAnalysis.importGraph) {
    const importGraph = result.staticAnalysis.importGraph;

    const clusterFileToModule = buildClusterToArchModuleMap(
      importGraph, result.architecture.modules, b.nodeIds, idPrefix,
    );

    const resolveModule = (filePath: string): string | undefined =>
      clusterFileToModule.get(filePath) || findModuleForFile(filePath, fileMap);

    const edgeCounts = new Map<string, number>();
    for (const edge of importGraph.edges) {
      if (edge.isExternal) {
        const pkg = edge.to.split("/").slice(0, edge.to.startsWith("@") ? 2 : 1).join("/");
        const fromMod = resolveModule(edge.from);
        if (fromMod) {
          if (!externalToModules.has(pkg)) externalToModules.set(pkg, new Set());
          externalToModules.get(pkg)!.add(fromMod);
        }
        continue;
      }
      const fromMod = resolveModule(edge.from);
      const toMod = resolveModule(edge.to);
      if (!fromMod || !toMod || fromMod === toMod) continue;
      const key = `${fromMod}→${toMod}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }

    for (const [key, count] of edgeCounts) {
      const [source, target] = key.split("→");
      if (b.nodeIds.has(source) && b.nodeIds.has(target)) {
        addLink(b, {
          source, target, type: "import",
          label: `${count} import${count > 1 ? "s" : ""}`,
          value: count,
        });
      }
    }

    // External dep nodes (top 10) with links
    const externalCounts = new Map<string, number>();
    for (const edge of importGraph.edges) {
      if (!edge.isExternal) continue;
      const pkg = edge.to.split("/").slice(0, edge.to.startsWith("@") ? 2 : 1).join("/");
      externalCounts.set(pkg, (externalCounts.get(pkg) || 0) + 1);
    }

    const topExternal = [...externalCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [pkg, count] of topExternal) {
      const id = `${idPrefix}external-${slugify(pkg)}`;
      addNode(b, {
        id, name: pkg, type: "external",
        description: `External dependency (${count} imports)`,
        val: Math.max(Math.ceil(count / 2), 1),
        color: NODE_COLORS.external,
        group,
      });

      const importingModules = externalToModules.get(pkg);
      if (importingModules) {
        for (const modId of importingModules) {
          if (b.nodeIds.has(modId)) {
            addLink(b, { source: modId, target: id, type: "depends-on", label: "depends on", value: 1 });
          }
        }
      }
    }
  }

  // ── Link modules → API groups ──
  if (result.apiEndpoints.length > 0) {
    const apiGroups = new Map<string, string>();
    for (const ep of result.apiEndpoints) {
      const segments = ep.path.split("/").filter(Boolean);
      const base = segments[0] || "api";
      const apiId = `${idPrefix}api-${slugify(base)}`;
      if (!apiGroups.has(apiId)) apiGroups.set(apiId, base);
    }

    for (const [apiId, basePath] of apiGroups) {
      if (!b.nodeIds.has(apiId)) continue;

      let linkedModule: string | undefined;
      for (const mod of result.architecture.modules) {
        const modId = `${idPrefix}module-${slugify(mod.name)}`;
        if (!b.nodeIds.has(modId)) continue;
        const hasRouteFile = mod.files.some((f) => {
          const lower = f.toLowerCase();
          return lower.includes(`/${basePath}/`) || lower.includes(`/${basePath}.`) ||
            lower.includes("routes") || lower.includes("controllers") || lower.includes("handlers");
        });
        if (hasRouteFile) { linkedModule = modId; break; }
      }

      if (!linkedModule) {
        for (const mod of result.architecture.modules) {
          const modId = `${idPrefix}module-${slugify(mod.name)}`;
          if (!b.nodeIds.has(modId)) continue;
          if (slugify(mod.name) === slugify(basePath) ||
            mod.name.toLowerCase().includes(basePath.toLowerCase()) ||
            basePath.toLowerCase().includes(mod.name.toLowerCase())) {
            linkedModule = modId; break;
          }
        }
      }

      if (linkedModule) {
        addLink(b, { source: linkedModule, target: apiId, type: "serves", label: "serves" });
      }
    }
  }

  // ── Link modules → components (by file path) ──
  for (const comp of result.components) {
    const compId = `${idPrefix}component-${slugify(comp.name)}`;
    if (!b.nodeIds.has(compId)) continue;
    const modId = findModuleForFile(comp.filePath, fileMap);
    if (modId && b.nodeIds.has(modId)) {
      addLink(b, { source: modId, target: compId, type: "contains", label: "contains" });
    }
  }

  // ── Link modules → data models (by file path) ──
  for (const model of result.dataModels) {
    const modelId = `${idPrefix}dataModel-${slugify(model.name)}`;
    if (!b.nodeIds.has(modelId)) continue;
    const modId = findModuleForFile(model.filePath, fileMap);
    if (modId && b.nodeIds.has(modId)) {
      addLink(b, { source: modId, target: modelId, type: "contains", label: "contains" });
    }
  }

  // ── Data model relationships ──
  for (const model of result.dataModels) {
    const modelId = `${idPrefix}dataModel-${slugify(model.name)}`;
    if (!b.nodeIds.has(modelId)) continue;
    for (const rel of model.relationships) {
      const targetId = `${idPrefix}dataModel-${slugify(rel)}`;
      if (b.nodeIds.has(targetId) && targetId !== modelId) {
        addLink(b, { source: modelId, target: targetId, type: "relationship", label: "relates to" });
      }
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function buildGraphData(result: AnalysisResult): GraphData {
  const b = createBuilder();
  addRepoInternals(b, result);
  return { nodes: b.nodes, links: b.links };
}

export function buildCrossRepoGraphData(
  results: AnalysisResult[],
  crossRepo: CrossRepoAnalysis,
): GraphData {
  const b = createBuilder();

  // Add repo-level container nodes
  for (const result of results) {
    const repoSlug = slugify(result.repoName);
    addNode(b, {
      id: `repo-${repoSlug}`,
      name: result.repoName,
      type: "repo",
      description: result.architecture.summary.split("\n")[0],
      val: Math.max(Math.ceil(result.staticAnalysis.totalFiles / 10), 8),
      color: NODE_COLORS.repo,
      docPath: repoSlug,
      group: repoSlug,
      metadata: {
        techStack: result.architecture.techStack,
        totalFiles: result.staticAnalysis.totalFiles,
        apiCount: result.apiEndpoints.length,
        componentCount: result.components.length,
      },
    });
  }

  // Add per-repo internals with namespaced IDs
  for (const result of results) {
    const repoSlug = slugify(result.repoName);
    const idPrefix = `${repoSlug}/`;
    const docPathPrefix = `${repoSlug}/`;

    addRepoInternals(b, result, idPrefix, docPathPrefix, repoSlug);

    // Link repo container → its modules
    for (const mod of result.architecture.modules) {
      const modId = `${idPrefix}module-${slugify(mod.name)}`;
      if (b.nodeIds.has(modId)) {
        addLink(b, {
          source: `repo-${repoSlug}`,
          target: modId,
          type: "contains",
          label: "contains",
        });
      }
    }
  }

  // ── Cross-repo relationships ──
  for (const rel of crossRepo.repoRelationships) {
    const sourceId = `repo-${slugify(rel.from)}`;
    const targetId = `repo-${slugify(rel.to)}`;
    if (b.nodeIds.has(sourceId) && b.nodeIds.has(targetId)) {
      addLink(b, {
        source: sourceId, target: targetId,
        type: rel.relationshipType, label: rel.relationshipType, value: 3,
      });
    }
  }

  // ── API contracts: link at the API-group level when possible ──
  for (const contract of crossRepo.apiContracts) {
    const consumerSlug = slugify(contract.consumerRepo);
    const providerSlug = slugify(contract.providerRepo);

    // Try to find the specific API group node in the provider repo
    const epSegments = contract.endpoint.split("/").filter(Boolean);
    const epBase = epSegments[0] || "api";
    const providerApiId = `${providerSlug}/api-${slugify(epBase)}`;

    // Try to find a consuming module in the consumer repo
    let consumerId = `repo-${consumerSlug}`;
    // Look for a module whose name relates to the endpoint
    for (const result of results) {
      if (slugify(result.repoName) !== consumerSlug) continue;
      for (const mod of result.architecture.modules) {
        const modId = `${consumerSlug}/module-${slugify(mod.name)}`;
        if (b.nodeIds.has(modId)) {
          // Check if module name relates to the API it consumes
          if (mod.name.toLowerCase().includes(epBase.toLowerCase()) ||
            epBase.toLowerCase().includes(mod.name.toLowerCase())) {
            consumerId = modId;
            break;
          }
        }
      }
    }

    const targetId = b.nodeIds.has(providerApiId)
      ? providerApiId
      : `repo-${providerSlug}`;

    if (b.nodeIds.has(consumerId) && b.nodeIds.has(targetId)) {
      addLink(b, {
        source: consumerId, target: targetId,
        type: "api-contract",
        label: `${contract.method} ${contract.endpoint}`,
        value: 2,
      });
    }
  }

  // ── Integration patterns ──
  for (const pattern of crossRepo.integrationPatterns) {
    if (pattern.repos.length >= 2) {
      const sourceId = `repo-${slugify(pattern.repos[0])}`;
      const targetId = `repo-${slugify(pattern.repos[1])}`;
      if (b.nodeIds.has(sourceId) && b.nodeIds.has(targetId)) {
        addLink(b, {
          source: sourceId, target: targetId,
          type: "integration", label: pattern.pattern, value: 2,
        });
      }
    }
  }

  // ── Shared dependencies: link repos that share the same external dep ──
  // Find external dep nodes that appear in multiple repos and cross-link them
  const externalByName = new Map<string, string[]>();
  for (const node of b.nodes) {
    if (node.type !== "external") continue;
    // Strip repo prefix to get the canonical package name
    const repoPrefix = node.group ? `${node.group}/` : "";
    const pkgName = node.id.replace(repoPrefix, "").replace(/^external-/, "");
    if (!externalByName.has(pkgName)) externalByName.set(pkgName, []);
    externalByName.get(pkgName)!.push(node.id);
  }

  for (const [, nodeIds] of externalByName) {
    if (nodeIds.length <= 1) continue;
    // Link first occurrence to all others as "shared dependency"
    for (let i = 1; i < nodeIds.length; i++) {
      addLink(b, {
        source: nodeIds[0], target: nodeIds[i],
        type: "shared-dep", label: "shared", value: 1,
      });
    }
  }

  return { nodes: b.nodes, links: b.links };
}
