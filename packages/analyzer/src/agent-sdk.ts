import { query } from "@anthropic-ai/claude-agent-sdk";

// Only match very specific error messages from the API/Claude Code, not general agent text
const CREDIT_ERROR_PATTERNS = [
  /^credit balance is too low/i,
  /^your credit balance is too low/i,
  /^insufficient credits/i,
  /^error:.*credit balance/i,
  /^error:.*insufficient/i,
];

/** Pre-flight check: validate API key and credit balance via Anthropic API */
export async function validateApiKey(apiKey: string, model?: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (res.ok) return { valid: true };

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const errMsg = (body as any)?.error?.message || `HTTP ${res.status}`;

    if (res.status === 401) {
      return { valid: false, error: `Invalid API key: ${errMsg}` };
    }
    if (res.status === 403 || res.status === 429) {
      const msg = String(errMsg).toLowerCase();
      if (msg.includes("credit") || msg.includes("balance") || msg.includes("billing")) {
        return { valid: false, error: `Insufficient credits: ${errMsg}` };
      }
      if (msg.includes("rate")) {
        // Rate limit is transient, not a permanent failure
        return { valid: true };
      }
      return { valid: false, error: errMsg };
    }
    // Other errors (500, etc.) — don't block, let the agent try
    return { valid: true };
  } catch {
    // Network error — don't block, let the agent try
    return { valid: true };
  }
}

export interface AgentQueryOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  apiKey: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  onAgentMessage?: (text: string) => void;
  onToolUse?: (event: { tool: string; target: string }) => void;
  retryOnMaxTurns?: boolean;
}

export class AgentError extends Error {
  subtype: string;
  numTurns?: number;

  constructor(subtype: string, message: string, numTurns?: number) {
    super(message);
    this.name = "AgentError";
    this.subtype = subtype;
    this.numTurns = numTurns;
  }
}

export const EFFICIENCY_HINTS = `

## Efficiency Guidelines
- Be selective: read at most 15-20 key files. Prioritize producing output over exhaustive exploration.
- Focus on the most important/representative files rather than reading every file.
- If you have enough information to produce a good result, stop exploring and produce output.

## Output Formatting Rules
- NEVER use angle-bracket placeholders like <your-api-key> or <repository-url> in your output. Use backtick-wrapped text instead: \`your-api-key\`, \`repository-url\`. Angle brackets break MDX parsing.
- When including code examples with triple backticks, ensure the opening and closing fence markers start at column 0 (no leading spaces before the backtick fence).`;

const FILLER_PATTERNS = /^(let me|i'll|i need to|i want to|i should|i will|now i'll|now let me|now i need|first,? i|next,? i|okay|alright)/i;

/** Strip env vars that prevent Claude Code from being launched as a subprocess */
function stripClaudeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key !== "CLAUDECODE") {
      clean[key] = value;
    }
  }
  return clean;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

async function runAgentOnce<T>(options: AgentQueryOptions): Promise<T> {
  const agentPromise = runAgentCore<T>(options);

  if (options.timeoutMs) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new AgentError("timeout", `Agent timed out after ${Math.round(options.timeoutMs! / 1000)}s`)), options.timeoutMs);
    });
    return Promise.race([agentPromise, timeoutPromise]);
  }

  return agentPromise;
}

async function runAgentCore<T>(options: AgentQueryOptions): Promise<T> {
  const result = query({
    prompt: options.prompt,
    options: {
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      model: options.model || "claude-sonnet-4-6",
      allowedTools: options.allowedTools || ["Read", "Glob", "Grep"],
      maxTurns: options.maxTurns || 30,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      env: { ...stripClaudeEnv(process.env), ANTHROPIC_API_KEY: options.apiKey },
      outputFormat: options.outputSchema
        ? { type: "json_schema" as const, schema: options.outputSchema }
        : undefined,
    },
  });

  let lastMessage = "";

  for await (const message of result) {
    // Check system init message for API key source
    if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      const initMsg = message as Record<string, unknown>;
      const keySource = initMsg.apiKeySource as string | undefined;
      // If Claude Code is NOT using the ANTHROPIC_API_KEY env var, warn
      if (keySource && keySource !== "user") {
        options.onAgentMessage?.(`[auth: ${keySource}]`);
      }
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          // Detect credit/billing errors in agent output and fail fast
          // Only check the first line to avoid false positives from agent analysis text
          const firstLine = block.text.split("\n")[0].trim();
          for (const pattern of CREDIT_ERROR_PATTERNS) {
            if (pattern.test(firstLine)) {
              throw new AgentError("credit_error", `API credit issue detected: ${firstLine.slice(0, 120)}`);
            }
          }

          if (options.onAgentMessage) {
            const firstLine = text.split("\n")[0].trim();
            if (!firstLine || FILLER_PATTERNS.test(firstLine) || firstLine === lastMessage) continue;
            lastMessage = firstLine;
            options.onAgentMessage(truncateAtWord(firstLine, 80));
          }
        }
        if (block.type === "tool_use" && options.onToolUse) {
          const input = block.input as Record<string, unknown> | undefined;
          if (input) {
            const tool = block.name as string;
            let target: string | undefined;
            if (tool === "Read" && typeof input.file_path === "string") {
              // Strip cwd prefix to show relative path
              target = input.file_path.startsWith(options.cwd)
                ? input.file_path.slice(options.cwd.length + 1)
                : input.file_path;
            } else if (tool === "Glob" && typeof input.pattern === "string") {
              target = input.pattern;
            } else if (tool === "Grep" && typeof input.pattern === "string") {
              target = input.pattern;
            }
            if (target) {
              options.onToolUse({ tool, target });
            }
          }
        }
      }
    }
    if (message.type === "result") {
      if (message.subtype === "success" && message.structured_output) {
        return message.structured_output as T;
      }
      if (
        message.subtype === "success" &&
        "result" in message &&
        typeof message.result === "string"
      ) {
        const jsonMatch = message.result.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
      }
      const numTurns = "num_turns" in message ? (message.num_turns as number) : undefined;
      throw new AgentError(
        message.subtype,
        `Agent failed: ${message.subtype}`,
        numTurns,
      );
    }
  }
  throw new AgentError("no_result", "Agent returned no result");
}

export async function runAgent<T>(options: AgentQueryOptions): Promise<T> {
  const retryOnMaxTurns = options.retryOnMaxTurns ?? true;

  try {
    return await runAgentOnce<T>(options);
  } catch (error) {
    if (
      retryOnMaxTurns &&
      error instanceof AgentError &&
      error.subtype === "error_max_turns"
    ) {
      const originalMaxTurns = options.maxTurns || 30;
      const retryMaxTurns = Math.min(Math.ceil(originalMaxTurns * 1.5), 60);

      const retryPrompt = `IMPORTANT: You previously ran out of turns exploring this codebase. You MUST produce your structured JSON output within the available turns.
- Limit exploration to 10-15 key files maximum
- Prioritize producing output over exhaustive exploration
- If you have partial information, produce the best output you can with what you know

${options.prompt}`;

      return runAgentOnce<T>({
        ...options,
        prompt: retryPrompt,
        maxTurns: retryMaxTurns,
        retryOnMaxTurns: false,
      });
    }
    throw error;
  }
}
