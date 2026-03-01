import fs from "fs-extra";
import path from "node:path";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";
import type { AnalysisResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Register helpers
Handlebars.registerHelper("join", (arr: string[], sep: string) => {
  if (!Array.isArray(arr)) return "";
  return arr.join(typeof sep === "string" ? sep : ", ");
});

let templatesLoaded = false;
const templates: Record<string, HandlebarsTemplateDelegate> = {};

function loadTemplates() {
  if (templatesLoaded) return;

  // Search multiple possible locations for templates
  const templateDirs = [
    path.resolve(__dirname, "templates/mdx"),           // dist/templates/mdx (copied by tsup)
    path.resolve(__dirname, "../templates/mdx"),         // sibling to dist/
    path.resolve(__dirname, "../src/templates/mdx"),     // source dir from dist/
    path.resolve(__dirname, "../../src/templates/mdx"),  // up two levels
  ];

  let templateDir: string | undefined;
  for (const dir of templateDirs) {
    if (fs.existsSync(dir)) {
      templateDir = dir;
      break;
    }
  }

  if (!templateDir) {
    throw new Error(
      `Template directory not found. __dirname=${__dirname}, searched: ${templateDirs.join(", ")}`,
    );
  }

  const templateFiles = ["overview", "getting-started", "api-endpoint", "component", "data-model"];
  for (const name of templateFiles) {
    const filePath = path.join(templateDir, `${name}.hbs`);
    if (fs.existsSync(filePath)) {
      templates[name] = Handlebars.compile(fs.readFileSync(filePath, "utf-8"), {
        noEscape: true, // Don't HTML-escape output — this is MDX, not HTML
      });
    }
  }

  templatesLoaded = true;
}

export async function writeContent(
  contentDir: string,
  results: AnalysisResult[],
): Promise<void> {
  loadTemplates();

  await fs.ensureDir(contentDir);

  if (results.length === 1) {
    // Single repo — write directly to content/docs/
    await writeRepoContent(contentDir, results[0]);
  } else {
    // Multiple repos — each in its own subdirectory
    // Write a root index that links to all repos
    await writeMultiRepoIndex(contentDir, results);

    for (const result of results) {
      const repoDir = path.join(contentDir, slugify(result.repoName));
      await writeRepoContent(repoDir, result);
    }
  }
}

async function writeMultiRepoIndex(contentDir: string, results: AnalysisResult[]): Promise<void> {
  const repoCards = results.map((r) => {
    const slug = slugify(r.repoName);
    const stack = r.architecture.techStack.slice(0, 5).join(", ");
    const stats = [
      r.apiEndpoints.length > 0 ? `${r.apiEndpoints.length} API endpoints` : null,
      r.components.length > 0 ? `${r.components.length} components` : null,
      r.dataModels.length > 0 ? `${r.dataModels.length} data models` : null,
    ].filter(Boolean).join(" · ");

    return `### [${r.repoName}](/docs/${slug})\n\n${r.architecture.summary.split("\n")[0]}\n\n**Stack:** ${stack || "N/A"}${stats ? `\n\n${stats}` : ""}`;
  }).join("\n\n---\n\n");

  const mdx = `---
title: Documentation
description: Auto-generated documentation for ${results.length} repositories
---

# Documentation

${repoCards}
`;

  await fs.writeFile(path.join(contentDir, "index.mdx"), mdx);
}

async function writeRepoContent(dir: string, result: AnalysisResult): Promise<void> {
  await fs.ensureDir(dir);

  // Cast to record for template rendering
  const safeResult = result as AnalysisResult;

  // Overview (index page)
  if (templates["overview"]) {
    const overviewData = {
      ...safeResult,
      apiEndpointCount: safeResult.apiEndpoints.length,
      componentCount: safeResult.components.length,
      dataModelCount: safeResult.dataModels.length,
    };
    await fs.writeFile(path.join(dir, "index.mdx"), renderTemplate("overview", overviewData));
  }

  // Getting Started
  if (templates["getting-started"]) {
    await fs.writeFile(
      path.join(dir, "getting-started.mdx"),
      renderTemplate("getting-started", safeResult),
    );
  }

  // API Endpoints
  if (safeResult.apiEndpoints.length > 0 && templates["api-endpoint"]) {
    const apiDir = path.join(dir, "api");
    await fs.ensureDir(apiDir);
    await fs.writeFile(
      path.join(apiDir, "index.mdx"),
      renderTemplate("api-endpoint", { ...safeResult, endpoints: safeResult.apiEndpoints }),
    );
  }

  // Components
  if (safeResult.components.length > 0 && templates["component"]) {
    const compDir = path.join(dir, "components");
    await fs.ensureDir(compDir);
    await fs.writeFile(
      path.join(compDir, "index.mdx"),
      renderTemplate("component", { ...safeResult, components: safeResult.components }),
    );
  }

  // Data Models
  if (safeResult.dataModels.length > 0 && templates["data-model"]) {
    const modelDir = path.join(dir, "data-models");
    await fs.ensureDir(modelDir);
    await fs.writeFile(
      path.join(modelDir, "index.mdx"),
      renderTemplate("data-model", { ...safeResult, models: safeResult.dataModels }),
    );
  }
}

function renderTemplate(name: string, data: object): string {
  const template = templates[name];
  if (!template) {
    throw new Error(`Template "${name}" not loaded`);
  }
  try {
    const raw = template(data);
    return sanitizeCodeBlocks(raw);
  } catch (err) {
    throw new Error(
      `Failed to render template "${name}": ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Shiki only supports specific language identifiers. AI often generates
 * code blocks with unsupported langs like ```env, ```plaintext, etc.
 * Replace them with supported alternatives to prevent build errors.
 */
const SHIKI_LANG_MAP: Record<string, string> = {
  env: "bash",
  dotenv: "bash",
  plaintext: "text",
  plain: "text",
  txt: "text",
  raw: "text",
  output: "text",
  log: "text",
  console: "bash",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  conf: "ini",
  config: "ini",
  cfg: "ini",
  dockerfile: "docker",
  makefile: "make",
  proto: "protobuf",
  tf: "hcl",
};

// Languages known to be supported by Shiki
const KNOWN_SHIKI_LANGS = new Set([
  "text", "bash", "sh", "zsh", "shell", "javascript", "js", "typescript", "ts",
  "tsx", "jsx", "json", "jsonc", "python", "py", "go", "rust", "rs", "java",
  "kotlin", "kt", "ruby", "rb", "php", "csharp", "c#", "cs", "cpp", "c",
  "swift", "dart", "vue", "svelte", "html", "css", "scss", "sass", "less",
  "sql", "graphql", "yaml", "yml", "toml", "xml", "markdown", "md", "mdx",
  "diff", "docker", "ini", "make", "nginx", "prisma", "protobuf", "hcl",
  "terraform", "lua", "r", "scala", "elixir", "erlang", "clojure", "haskell",
  "ocaml", "zig", "assembly", "wasm", "csv", "regex", "http",
]);

function sanitizeCodeBlocks(mdx: string): string {
  return mdx.replace(/```(\w+)/g, (_match, lang: string) => {
    const lower = lang.toLowerCase();
    // Map known aliases
    if (SHIKI_LANG_MAP[lower]) {
      return "```" + SHIKI_LANG_MAP[lower];
    }
    // If not a known Shiki language, fall back to text
    if (!KNOWN_SHIKI_LANGS.has(lower)) {
      return "```text";
    }
    return "```" + lower;
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
