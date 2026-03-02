import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import { fixMdxBuildErrors } from "@latent-space-labs/auto-doc-analyzer";

interface BuildCheckOptions {
  docsDir: string;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
}

interface BuildCheckResult {
  success: boolean;
  attempts: number;
  lastErrors?: string;
}

function runBuild(docsDir: string): { success: boolean; output: string } {
  try {
    // Regenerate .source/ after any edits, then build
    execSync("npx fumadocs-mdx", { cwd: docsDir, stdio: "pipe", timeout: 60_000 });
    execSync("npm run build", { cwd: docsDir, stdio: "pipe", timeout: 300_000 });
    return { success: true, output: "" };
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const stdout = error.stdout?.toString() || "";
    const stderr = error.stderr?.toString() || "";
    const output = `${stdout}\n${stderr}`.trim();
    return { success: false, output };
  }
}

function truncateErrors(output: string, max = 8000): string {
  if (output.length <= max) return output;
  return output.slice(0, max) + "\n\n... (truncated)";
}

export async function runBuildCheck(options: BuildCheckOptions): Promise<BuildCheckResult> {
  const { docsDir, apiKey, model, maxAttempts = 3 } = options;

  const spinner = p.spinner();
  spinner.start("Verifying documentation build...");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { success, output } = runBuild(docsDir);

    if (success) {
      spinner.stop("Documentation build verified");
      return { success: true, attempts: attempt };
    }

    if (attempt >= maxAttempts) {
      spinner.stop("Build check failed after all attempts");
      p.log.warn(
        "Documentation build has errors that could not be auto-fixed.\n" +
        "Your docs site may still work — some errors are non-fatal.\n" +
        "You can fix remaining issues manually and run `npm run build` in the docs directory."
      );
      return { success: false, attempts: attempt, lastErrors: output };
    }

    // AI fix attempt
    spinner.message(`Build errors detected — AI is diagnosing and fixing (attempt ${attempt}/${maxAttempts})...`);

    try {
      const result = await fixMdxBuildErrors(
        docsDir,
        truncateErrors(output),
        apiKey,
        model,
        (text) => spinner.message(text),
      );

      if (!result.fixed) {
        spinner.stop("AI fixer could not resolve the build errors");
        p.log.warn(result.summary);
        return { success: false, attempts: attempt, lastErrors: output };
      }

      p.log.info(`Fixed ${result.filesChanged.length} file(s): ${result.summary}`);
      spinner.start("Re-verifying build...");
    } catch (err) {
      spinner.stop("AI fixer encountered an error");
      p.log.warn(`Fixer error: ${err instanceof Error ? err.message : err}`);
      return { success: false, attempts: attempt, lastErrors: output };
    }
  }

  return { success: false, attempts: maxAttempts };
}
