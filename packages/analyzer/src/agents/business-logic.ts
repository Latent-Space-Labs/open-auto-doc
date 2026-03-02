import type { ArchitectureOverview, BusinessLogicAnalysis, StaticAnalysis } from "../types.js";
import { runAgent, EFFICIENCY_HINTS } from "../agent-sdk.js";

const businessLogicSchema = {
  type: "object",
  properties: {
    domainConcepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Domain concept name (e.g. User, Order, Subscription)" },
          description: { type: "string", description: "What this concept represents in the domain" },
          relatedFiles: { type: "array", items: { type: "string" }, description: "Key files implementing this concept" },
        },
        required: ["name", "description", "relatedFiles"],
      },
    },
    businessRules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name for the business rule" },
          description: { type: "string", description: "What the rule enforces or ensures" },
          sourceFiles: { type: "array", items: { type: "string" }, description: "Files containing this rule" },
          category: { type: "string", description: "Category (Validation, Authorization, Pricing, Workflow, etc.)" },
        },
        required: ["name", "description", "sourceFiles"],
      },
    },
    workflows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          description: { type: "string", description: "What this workflow accomplishes" },
          steps: { type: "array", items: { type: "string" }, description: "Ordered steps in the workflow" },
          diagram: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              mermaidSyntax: { type: "string" },
            },
            required: ["id", "title", "description", "mermaidSyntax"],
          },
        },
        required: ["name", "description", "steps"],
      },
    },
    keyInvariants: {
      type: "array",
      items: { type: "string" },
      description: "Key invariants or constraints the system maintains",
    },
  },
  required: ["domainConcepts", "businessRules", "workflows", "keyInvariants"],
};

export async function analyzeBusinessLogic(
  repoPath: string,
  staticAnalysis: StaticAnalysis,
  architecture: ArchitectureOverview,
  apiKey: string,
  model?: string,
  onAgentMessage?: (text: string) => void,
  onToolUse?: (event: { tool: string; target: string }) => void,
): Promise<BusinessLogicAnalysis> {
  const claudeMdContext = staticAnalysis.claudeMd.map((c) => c.content).join("\n\n");

  return runAgent<BusinessLogicAnalysis>({
    onAgentMessage,
    onToolUse,
    systemPrompt: `You are a domain analysis expert. Your job is to extract the "why" behind the code — the business rules, domain concepts, workflows, and invariants that shape how the software behaves.
Focus on rules and logic, not implementation details. Your output must be valid JSON matching the provided schema. No markdown, no explanations outside the JSON.`,
    prompt: `Analyze this codebase and extract business logic, domain concepts, and workflows.

## Architecture Context
${architecture.summary}
Tech Stack: ${architecture.techStack.join(", ")}
Modules: ${architecture.modules.map((m) => `${m.name}: ${m.description}`).join("\n")}
${claudeMdContext ? `\n## CLAUDE.md Context\n${claudeMdContext}\n` : ""}

## Instructions
1. Use Glob to find service, domain, and business logic files: \`**/services/**\`, \`**/domain/**\`, \`**/rules/**\`, \`**/validators/**\`, \`**/policies/**\`, \`**/workflows/**\`, \`**/middleware/**\`
2. Use Grep to find validation functions, guard clauses, authorization checks, state transitions, business rule comments
3. Use Read to examine key files and understand the domain logic

**Domain Concepts**: Identify the core entities/concepts of the domain (not just data models, but the ideas the software is built around). Explain what each represents.

**Business Rules**: Find rules encoded in the logic — validation rules, authorization policies, pricing logic, rate limits, state machine transitions. For each rule, explain what it enforces.

**Workflows**: Identify multi-step processes (e.g. user registration flow, order processing, deployment pipeline). List the steps and optionally generate a Mermaid \`stateDiagram-v2\` for the most important workflow.

**Key Invariants**: List constraints the system must always maintain (e.g. "every order must have a valid customer", "API keys must be hashed before storage").

If this is a library without clear business logic, focus on the design rules and constraints that guide how the library is used.
${EFFICIENCY_HINTS}`,
    cwd: repoPath,
    apiKey,
    model,
    outputSchema: businessLogicSchema,
    maxTurns: 35,
  });
}
