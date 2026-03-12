import { runAgent } from "../agent-sdk.js";

export interface FixerResult {
  fixed: boolean;
  filesChanged: string[];
  summary: string;
}

const fixerOutputSchema = {
  type: "object",
  properties: {
    fixed: { type: "boolean" },
    filesChanged: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
  required: ["fixed", "filesChanged", "summary"],
};

const SYSTEM_PROMPT = `You are an MDX build-error fixer for Fumadocs documentation sites.

You will receive Next.js / Fumadocs build error output. Your job is to find and fix the broken MDX files so the build succeeds.

## Common errors you must handle

1. **Unescaped JSX characters** — \`{\`, \`}\`, \`<\`, \`>\` outside of code blocks/fences must be escaped as \`\\{\`, \`\\}\`, \`&lt;\`, \`&gt;\` (or wrapped in backticks).
2. **Invalid Shiki language identifiers** — Code fences with unsupported language tags (e.g. \`\`\`env\`\`\`, \`\`\`conf\`\`\`, \`\`\`plaintext\`\`\`) should be changed to a supported language or removed (use \`\`\`text\`\`\` or plain \`\`\`\`\`\` as fallback).
3. **Malformed Mermaid diagrams** — Syntax errors inside \`\`\`mermaid\`\`\` blocks (unclosed quotes, invalid node IDs, missing arrows).
4. **Unclosed code fences** — Missing closing \`\`\`\`\`\` causing the rest of the file to be parsed as code.
5. **Invalid frontmatter** — Malformed YAML in \`---\` blocks (bad indentation, unquoted special characters).
6. **HTML comments** — \`<!-- -->\` is not valid in MDX; remove or convert to JSX comments \`{/* */}\`.
7. **Unescaped pipes in tables** — Pipes inside table cells that break table parsing.
8. **Import/export statements** — Invalid or unnecessary import/export statements in MDX files.
9. **TypeScript type errors in components** — Type mismatches in \`.tsx\`/\`.ts\` files (e.g. \`RefObject\` vs \`MutableRefObject\`, \`null\` vs \`undefined\`, missing type arguments). Fix the types directly.

## Rules

- You may edit files inside \`content/docs/\` (MDX files) AND \`components/\` or \`app/\` (TypeScript/React files).
- For TypeScript errors in \`.tsx\`/\`.ts\` files, fix the type issues directly (e.g. ref type mismatches, missing imports, incorrect generics).
- Read the error output carefully to identify the exact file(s) and line(s).
- Use Read to examine the broken file, then Edit to fix it.
- After fixing, set \`fixed: true\` and list all changed file paths in \`filesChanged\`.
- If you cannot identify or fix the error, set \`fixed: false\` and explain why in \`summary\`.
- Be surgical: fix only what's broken, don't rewrite entire files.`;

export async function fixMdxBuildErrors(
  docsDir: string,
  buildErrors: string,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
): Promise<FixerResult> {
  return runAgent<FixerResult>({
    onAgentMessage,
    systemPrompt: SYSTEM_PROMPT,
    prompt: `The following build errors occurred when building this Fumadocs documentation site.
Diagnose and fix the MDX files causing these errors.

## Build Error Output
\`\`\`
${buildErrors}
\`\`\`

Read the failing files, identify the issues, and use Edit to fix them.
You may edit files in content/docs/, components/, and app/.`,
    cwd: docsDir,
    apiKey,
    model,
    outputSchema: fixerOutputSchema,
    allowedTools: ["Read", "Glob", "Grep", "Edit"],
    maxTurns: 35,
  });
}
