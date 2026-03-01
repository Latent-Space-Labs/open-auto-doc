import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { generateCommand } from "./commands/generate.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";

const program = new Command();

program
  .name("open-auto-doc")
  .description("Auto-generate beautiful documentation websites from GitHub repositories using AI")
  .version("0.1.0");

program
  .command("init", { isDefault: true })
  .description("Initialize and generate documentation for your repositories")
  .option("-o, --output <dir>", "Output directory", "docs-site")
  .action(initCommand);

program
  .command("generate")
  .description("Regenerate documentation using existing configuration")
  .action(generateCommand);

program
  .command("login")
  .description("Authenticate with GitHub")
  .action(loginCommand);

program
  .command("logout")
  .description("Clear stored credentials")
  .action(logoutCommand);

program.parse();
