import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AgentQueryOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  apiKey: string;
  model?: string;
  outputSchema?: object;
  allowedTools?: string[];
  maxTurns?: number;
  onAgentMessage?: (text: string) => void;
}

const FILLER_PATTERNS = /^(let me|i'll|i need to|i want to|i should|i will|now i'll|now let me|now i need|first,? i|next,? i|okay|alright)/i;

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

export async function runAgent<T>(options: AgentQueryOptions): Promise<T> {
  const result = query({
    prompt: options.prompt,
    options: {
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      model: options.model || "claude-sonnet-4-20250514",
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
      throw new Error(`Agent failed: ${message.subtype}`);
    }
  }
  throw new Error("Agent returned no result");
}
