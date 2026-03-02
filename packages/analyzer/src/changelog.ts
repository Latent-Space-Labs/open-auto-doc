import type { AnalysisResult, ChangelogChange, ChangelogEntry } from "./types.js";

export function computeChangelog(
  previous: AnalysisResult,
  current: AnalysisResult,
  fromCommit: string,
  toCommit: string,
): ChangelogEntry {
  const added: ChangelogChange[] = [];
  const removed: ChangelogChange[] = [];
  const modified: ChangelogChange[] = [];

  // Compare API endpoints by method+path
  diffByKey(
    previous.apiEndpoints,
    current.apiEndpoints,
    (e) => `${e.method} ${e.path}`,
    (e) => e.description,
    "API Endpoints",
    added,
    removed,
    modified,
  );

  // Compare components by name
  diffByKey(
    previous.components,
    current.components,
    (c) => c.name,
    (c) => c.description,
    "Components",
    added,
    removed,
    modified,
  );

  // Compare data models by name
  diffByKey(
    previous.dataModels,
    current.dataModels,
    (m) => m.name,
    (m) => m.description,
    "Data Models",
    added,
    removed,
    modified,
  );

  // Compare configuration items by name
  if (previous.configuration && current.configuration) {
    diffByKey(
      previous.configuration.configItems,
      current.configuration.configItems,
      (c) => c.name,
      (c) => c.description,
      "Configuration",
      added,
      removed,
      modified,
    );
  } else if (current.configuration) {
    for (const item of current.configuration.configItems) {
      added.push({ name: item.name, description: item.description, section: "Configuration" });
    }
  }

  // Compare error codes by code
  if (previous.errorHandling && current.errorHandling) {
    diffByKey(
      previous.errorHandling.errorCodes,
      current.errorHandling.errorCodes,
      (e) => e.code,
      (e) => e.description,
      "Error Codes",
      added,
      removed,
      modified,
    );
  } else if (current.errorHandling) {
    for (const item of current.errorHandling.errorCodes) {
      added.push({ name: item.code, description: item.description, section: "Error Codes" });
    }
  }

  // Compare domain concepts by name
  if (previous.businessLogic && current.businessLogic) {
    diffByKey(
      previous.businessLogic.domainConcepts,
      current.businessLogic.domainConcepts,
      (c) => c.name,
      (c) => c.description,
      "Domain Concepts",
      added,
      removed,
      modified,
    );
  } else if (current.businessLogic) {
    for (const item of current.businessLogic.domainConcepts) {
      added.push({ name: item.name, description: item.description, section: "Domain Concepts" });
    }
  }

  // Compare features by name
  if (previous.features && current.features) {
    diffByKey(
      previous.features.features,
      current.features.features,
      (f) => f.name,
      (f) => f.description,
      "Features",
      added,
      removed,
      modified,
    );
  } else if (current.features) {
    for (const item of current.features.features) {
      added.push({ name: item.name, description: item.description, section: "Features" });
    }
  }

  const totalChanges = added.length + removed.length + modified.length;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} added`);
  if (removed.length > 0) parts.push(`${removed.length} removed`);
  if (modified.length > 0) parts.push(`${modified.length} modified`);
  const summary = totalChanges === 0
    ? "No documentation changes detected."
    : `${totalChanges} changes: ${parts.join(", ")}.`;

  return {
    generatedAt: new Date().toISOString(),
    fromCommit,
    toCommit,
    added,
    removed,
    modified,
    summary,
  };
}

function diffByKey<T>(
  previous: T[],
  current: T[],
  getKey: (item: T) => string,
  getDescription: (item: T) => string,
  section: string,
  added: ChangelogChange[],
  removed: ChangelogChange[],
  modified: ChangelogChange[],
): void {
  const prevMap = new Map(previous.map((item) => [getKey(item), item]));
  const currMap = new Map(current.map((item) => [getKey(item), item]));

  for (const [key, item] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      added.push({ name: key, description: getDescription(item), section });
    } else if (getDescription(prev) !== getDescription(item)) {
      modified.push({ name: key, description: getDescription(item), section });
    }
  }

  for (const [key, item] of prevMap) {
    if (!currMap.has(key)) {
      removed.push({ name: key, description: getDescription(item), section });
    }
  }
}
