import { defineConfig } from "tsup";
import { copyFileSync, cpSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const TEMPLATE_EXCLUDE = new Set(["node_modules", ".next", ".source", "dist", ".turbo"]);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  noExternal: [
    "@latent-space-labs/auto-doc-analyzer",
    "@latent-space-labs/auto-doc-generator",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: async () => {
    // Copy Handlebars templates from generator package into CLI dist
    const srcDir = join("..", "generator", "src", "templates", "mdx");
    const destDir = join("dist", "templates", "mdx");
    mkdirSync(destDir, { recursive: true });
    for (const file of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }

    // Copy site-template into dist so it ships with the npm package
    cpSync(join("..", "site-template"), join("dist", "site-template"), {
      recursive: true,
      filter: (src) => !TEMPLATE_EXCLUDE.has(basename(src)),
    });
  },
});
