import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  onSuccess: async () => {
    // Copy Handlebars templates to dist/templates/mdx/
    const srcDir = join("src", "templates", "mdx");
    const destDir = join("dist", "templates", "mdx");
    mkdirSync(destDir, { recursive: true });
    for (const file of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
  },
});
