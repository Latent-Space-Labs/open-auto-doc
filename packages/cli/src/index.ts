import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { generateCommand } from "./commands/generate.js";
import { deployCommand } from "./commands/deploy.js";
import { setupCiCommand } from "./commands/setup-ci.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";

const program = new Command();

program
  .name("open-auto-doc")
  .description("Auto-generate beautiful documentation websites from GitHub repositories using AI")
  .version("0.4.1");

program
  .command("init", { isDefault: true })
  .description("Initialize and generate documentation for your repositories")
  .option("-o, --output <dir>", "Output directory", "docs-site")
  .action(initCommand);

program
  .command("generate")
  .description("Regenerate documentation using existing configuration")
  .option("--incremental", "Only re-analyze changed files (uses cached results)")
  .option("--force", "Force full regeneration (ignore cache)")
  .option("--repo <name>", "Only analyze this repo (uses cache for others)")
  .action(generateCommand);

program
  .command("deploy")
  .description("Create a GitHub repo for docs and push (connect to Vercel for auto-deploy)")
  .option("-d, --dir <path>", "Docs site directory")
  .action(deployCommand);

program
  .command("setup-ci")
  .description("Generate a GitHub Actions workflow for auto-updating docs")
  .action(setupCiCommand);

program
  .command("login")
  .description("Authenticate with GitHub")
  .action(loginCommand);

program
  .command("logout")
  .description("Clear stored credentials")
  .action(logoutCommand);

program.parse();
