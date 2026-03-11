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

function truncateErrors(output: string, max = 16000): string {
  if (output.length <= max) return output;
  return output.slice(0, max) + "\n\n... (truncated)";
}

/** Extract the most relevant error lines from build output */
function extractErrorSummary(output: string, maxLines = 80): string {
  const lines = output.split("\n");
  const errorLines: string[] = [];
  let capturing = false;
  let blankCount = 0;

  for (const line of lines) {
    const isErrorLine =
      /error\s*(\(|:|\[)/i.test(line) ||
      /TS\d{4}:/i.test(line) ||
      /Error:|SyntaxError|TypeError|ReferenceError/i.test(line) ||
      /Caused by:/.test(line) ||
      /Type '.*' is not assignable/i.test(line) ||
      /Property '.*' is missing/i.test(line) ||
      /Overload \d+ of \d+/i.test(line) ||
      /Types of parameters/i.test(line) ||
      /Expected|Unexpected|Invalid|Unterminated/i.test(line);

    const isContextLine =
      /^\s*\d+\s*\|/.test(line) ||  // source line numbers from build output
      /^\s*>/.test(line) ||          // pointer lines
      /^\s+at\s+/.test(line) ||      // stack traces
      /failed/i.test(line);

    if (isErrorLine) {
      capturing = true;
      blankCount = 0;
    }

    if (capturing) {
      if (line.trim() === "") {
        blankCount++;
        // Stop capturing after 2 consecutive blanks (end of error block)
        if (blankCount >= 2) {
          capturing = false;
          continue;
        }
      } else {
        blankCount = 0;
      }
      errorLines.push(line);
    } else if (isContextLine) {
      errorLines.push(line);
    }

    if (errorLines.length >= maxLines) break;
  }

  if (errorLines.length === 0) {
    // Fallback: return last N lines
    return lines.slice(-maxLines).join("\n");
  }

  return errorLines.join("\n");
}

export async function runBuildCheck(options: BuildCheckOptions): Promise<BuildCheckResult> {
  const { docsDir, apiKey, model, maxAttempts = 10 } = options;

  const spinner = p.spinner();
  spinner.start("Verifying documentation build...");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { success, output } = runBuild(docsDir);

    if (success) {
      spinner.stop("Documentation build verified");
      return { success: true, attempts: attempt };
    }

    // Always log the build errors so the user can see what's wrong
    spinner.stop("Build errors detected");
    const errorSummary = extractErrorSummary(output);
    p.log.warn(`Build error output:\n${errorSummary}`);

    if (attempt >= maxAttempts) {
      p.log.warn(
        "Documentation build has errors that could not be auto-fixed.\n" +
        "Your docs site may still work — some errors are non-fatal.\n" +
        "You can fix remaining issues manually and run `npm run build` in the docs directory."
      );
      return { success: false, attempts: attempt, lastErrors: output };
    }

    // AI fix attempt
    spinner.start(`AI is diagnosing and fixing build errors (attempt ${attempt}/${maxAttempts})...`);

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

      spinner.stop(`Fixed ${result.filesChanged.length} file(s): ${result.summary}`);
      spinner.start("Re-verifying build...");
    } catch (err) {
      spinner.stop("AI fixer encountered an error");
      p.log.warn(`Fixer error: ${err instanceof Error ? err.message : err}`);
      return { success: false, attempts: attempt, lastErrors: output };
    }
  }

  return { success: false, attempts: maxAttempts };
}
