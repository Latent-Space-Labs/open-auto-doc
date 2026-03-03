import type { AnalysisResult } from "./types.js";

export interface SearchHit {
  section: string;
  title: string;
  content: string;
  score: number;
  repo: string;
}

/**
 * Full-text search across all analysis sections with relevance scoring.
 */
export function searchDocumentation(
  results: AnalysisResult[],
  query: string,
  limit: number = 10,
): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const result of results) {
    const repo = result.repoName;

    // Architecture
    addHit(hits, repo, "architecture", "Architecture Overview", result.architecture.summary, terms);
    addHit(hits, repo, "architecture", "Project Purpose", result.architecture.projectPurpose, terms);
    addHit(hits, repo, "architecture", "Data Flow", result.architecture.dataFlow, terms);
    for (const mod of result.architecture.modules) {
      addHit(hits, repo, "architecture", `Module: ${mod.name}`, `${mod.description} — ${mod.responsibilities.join(", ")}`, terms);
    }
    for (const pattern of result.architecture.keyPatterns) {
      addHit(hits, repo, "architecture", "Key Pattern", pattern, terms);
    }

    // API endpoints
    for (const ep of result.apiEndpoints) {
      addHit(hits, repo, "api", `${ep.method} ${ep.path}`, ep.description, terms);
    }

    // Components
    for (const comp of result.components) {
      addHit(hits, repo, "component", comp.name, `${comp.description} — ${comp.usage}`, terms);
    }

    // Data models
    for (const model of result.dataModels) {
      const fieldsText = model.fields.map((f) => `${f.name}: ${f.type}`).join(", ");
      addHit(hits, repo, "data-model", model.name, `${model.description} — Fields: ${fieldsText}`, terms);
    }

    // Getting started
    addHit(hits, repo, "getting-started", "Installation", result.gettingStarted.installation, terms);
    addHit(hits, repo, "getting-started", "Quick Start", result.gettingStarted.quickStart, terms);
    if (result.gettingStarted.configuration) {
      addHit(hits, repo, "getting-started", "Configuration", result.gettingStarted.configuration, terms);
    }

    // Business logic
    if (result.businessLogic) {
      for (const concept of result.businessLogic.domainConcepts) {
        addHit(hits, repo, "business-logic", concept.name, concept.description, terms);
      }
      for (const rule of result.businessLogic.businessRules) {
        addHit(hits, repo, "business-logic", rule.name, rule.description, terms);
      }
      for (const wf of result.businessLogic.workflows) {
        addHit(hits, repo, "business-logic", wf.name, `${wf.description} — Steps: ${wf.steps.join(" → ")}`, terms);
      }
    }

    // Features
    if (result.features) {
      for (const feature of result.features.features) {
        addHit(hits, repo, "features", feature.name, `${feature.description} [${feature.category}]`, terms);
      }
    }

    // Configuration
    if (result.configuration) {
      for (const item of result.configuration.configItems) {
        addHit(hits, repo, "configuration", item.name, `${item.description} (${item.source})`, terms);
      }
    }

    // Error handling
    if (result.errorHandling) {
      for (const err of result.errorHandling.commonErrors) {
        addHit(hits, repo, "error-handling", err.error, `Cause: ${err.cause} — Solution: ${err.solution}`, terms);
      }
    }

    // Diagrams
    for (const diagram of result.diagrams) {
      addHit(hits, repo, "diagram", diagram.title, diagram.description, terms);
    }
  }

  // Sort by score descending, then limit
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function addHit(
  hits: SearchHit[],
  repo: string,
  section: string,
  title: string,
  content: string,
  terms: string[],
): void {
  const score = scoreMatch(title, content, terms);
  if (score > 0) {
    hits.push({ section, title, content, score, repo });
  }
}

function scoreMatch(title: string, content: string, terms: string[]): number {
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  let score = 0;

  for (const term of terms) {
    // Title matches are worth more
    if (titleLower.includes(term)) {
      score += 10;
      // Exact title match bonus
      if (titleLower === term) score += 5;
    }
    if (contentLower.includes(term)) {
      score += 3;
      // Count occurrences (diminishing returns)
      const count = contentLower.split(term).length - 1;
      score += Math.min(count - 1, 3);
    }
  }

  return score;
}
