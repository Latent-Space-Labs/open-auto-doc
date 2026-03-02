import type { ArchitectureOverview, ErrorHandlingAnalysis, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const errorHandlingSchema = {
  type: "object",
  properties: {
    errorCodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "Error code identifier" },
          httpStatus: { type: "number", description: "Associated HTTP status code if applicable" },
          message: { type: "string", description: "Error message shown to users" },
          description: { type: "string", description: "Detailed explanation of when and why this error occurs" },
          sourceFile: { type: "string", description: "File where this error is defined" },
        },
        required: ["code", "message", "description"],
      },
    },
    commonErrors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          error: { type: "string", description: "Error name or symptom" },
          cause: { type: "string", description: "What causes this error" },
          solution: { type: "string", description: "How to fix or resolve this error" },
          category: { type: "string", description: "Category (Setup, Runtime, Configuration, Authentication, etc.)" },
        },
        required: ["error", "cause", "solution"],
      },
    },
    errorClasses: {
      type: "array",
      items: { type: "string" },
      description: "Custom error class names defined in the codebase",
    },
    debuggingTips: {
      type: "array",
      items: { type: "string" },
      description: "General debugging tips and techniques for this project",
    },
  },
  required: ["errorCodes", "commonErrors", "errorClasses", "debuggingTips"],
};

export async function analyzeErrorHandling(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<ErrorHandlingAnalysis> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<ErrorHandlingAnalysis>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are an error handling documentation expert. Your job is to find and document all error patterns, error codes, custom error classes, and common failure modes in a codebase. Write troubleshooting guidance that helps developers diagnose and fix issues.
Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze this codebase and document its error handling patterns and common errors.

## Architecture Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
1. Use Grep to find custom Error classes: \`extends Error\`, \`extends BaseError\`, \`class.*Error\`, \`class.*Exception\`
2. Use Grep to find error code constants: \`ERROR_\`, \`ERR_\`, \`error_code\`, HTTP status codes (\`400\`, \`401\`, \`403\`, \`404\`, \`500\`)
3. Use Grep to find error handling patterns: \`try.*catch\`, error middleware, \`.catch(\`, \`onError\`, \`handleError\`
4. Use Read to examine error handling files, middleware, and error class definitions

**Error Codes**: Document any defined error codes with their HTTP status (if applicable), user-facing message, and a detailed description of when they occur.

**Common Errors**: Identify errors developers commonly encounter when setting up, configuring, or using this project. For each, explain the cause and provide a clear solution.

**Error Classes**: List all custom error/exception classes defined in the project.

**Debugging Tips**: Write 3-8 practical debugging tips specific to this project (e.g. "Enable verbose logging by setting LOG_LEVEL=debug", "Check the /health endpoint for service status").

If no error handling patterns are found, return empty arrays with a few general debugging tips.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: errorHandlingSchema,
    maxTurns: 30,
  });
}
