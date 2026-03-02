import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AgentQueryOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  apiKey: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  allowedTools?: string[];
  maxTurns?: number;
  onAgentMessage?: (text: string) => void;
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
- If you have enough information to produce a good result, stop exploring and produce output.`;

const FILLER_PATTERNS = /^(let me|i'll|i need to|i want to|i should|i will|now i'll|now let me|now i need|first,? i|next,? i|okay|alright)/i;

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

async function runAgentOnce<T>(options: AgentQueryOptions): Promise<T> {
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
      env: { ...process.env, ANTHROPIC_API_KEY: options.apiKey },
      outputFormat: options.outputSchema
        ? { type: "json_schema" as const, schema: options.outputSchema }
        : undefined,
    },
  });

  let lastMessage = "";

  for await (const message of result) {
    if (message.type === "assistant" && options.onAgentMessage) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          const firstLine = block.text.split("\n")[0].trim();
          if (!firstLine || FILLER_PATTERNS.test(firstLine) || firstLine === lastMessage) continue;
          lastMessage = firstLine;
          options.onAgentMessage(truncateAtWord(firstLine, 80));
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
