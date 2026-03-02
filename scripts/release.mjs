#!/usr/bin/env node

/**
 * Bump version across all packages and create a git tag.
 *
 * Usage:
 *   npm run release -- patch    # 0.1.0 → 0.1.1
 *   npm run release -- minor    # 0.1.0 → 0.2.0
 *   npm run release -- major    # 0.1.0 → 1.0.0
 *   npm run release -- 0.2.0    # explicit version
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PACKAGES = [
  "packages/analyzer/package.json",
  "packages/generator/package.json",
  "packages/cli/package.json",
];

const CLI_PKG = "packages/cli/package.json";
const CLI_INDEX = "packages/cli/src/index.ts";

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      if (/^\d+\.\d+\.\d+$/.test(type)) return type;
      console.error(`Invalid version bump: ${type}`);
      process.exit(1);
  }
}

const bumpType = process.argv[2];
if (!bumpType) {
  console.error("Usage: npm run release -- <patch|minor|major|x.y.z>");
  process.exit(1);
}

// Read current version from CLI package
const cliPkg = JSON.parse(readFileSync(CLI_PKG, "utf-8"));
const currentVersion = cliPkg.version;
const newVersion = bumpVersion(currentVersion, bumpType);

console.log(`Bumping version: ${currentVersion} → ${newVersion}\n`);

// Update all package.json files
for (const pkgPath of PACKAGES) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  Updated ${pkgPath} → ${newVersion}`);
}

// Update version in CLI source (Commander .version() call)
const indexContent = readFileSync(CLI_INDEX, "utf-8");
const updatedIndex = indexContent.replace(
  /\.version\("[^"]+"\)/,
  `.version("${newVersion}")`,
);
writeFileSync(CLI_INDEX, updatedIndex);
console.log(`  Updated ${CLI_INDEX} → ${newVersion}`);

// Git commit and tag
console.log(`\nCreating git commit and tag v${newVersion}...`);
execSync(`git add -A`, { stdio: "inherit" });
execSync(`git commit -m "release: v${newVersion}"`, { stdio: "inherit" });
execSync(`git tag v${newVersion}`, { stdio: "inherit" });

console.log(`\nDone! To publish, run:`);
console.log(`  git push && git push --tags`);
