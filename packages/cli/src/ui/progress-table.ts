import type { AnalysisResult } from "@latent-space-labs/auto-doc-analyzer";

// ── Unicode / color support detection ────────────────────────────────

function isUnicodeSupported(): boolean {
  if (process.platform === "win32") {
    return (
      Boolean(process.env.WT_SESSION) || // Windows Terminal
      Boolean(process.env.TERMINUS_SUBLIME) ||
      process.env.ConEmuTask === "{cmd::Cmder}" ||
      process.env.TERM_PROGRAM === "Terminus-Sublime" ||
      process.env.TERM_PROGRAM === "vscode" ||
      process.env.TERM === "xterm-256color" ||
      process.env.TERM === "alacritty" ||
      process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
    );
  }
  return process.env.TERM !== "linux"; // linux console (not emulator)
}

const unicode = isUnicodeSupported();

// ── Symbols ──────────────────────────────────────────────────────────

const S_QUEUED = unicode ? "\u25CB" : "o";        // ○
const S_DONE = unicode ? "\u2713" : "+";           // ✓
const S_FAILED = unicode ? "\u2717" : "x";         // ✗
const S_BAR = unicode ? "\u2502" : "|";            // │
const S_BULLET = unicode ? "\u25CF" : "*";         // ●
const SPINNER_FRAMES = unicode
  ? ["\u25D2", "\u25D0", "\u25D3", "\u25D1"]       // ◒◐◓◑
  : ["/", "-", "\\", "|"];

// ── Raw ANSI helpers ─────────────────────────────────────────────────

const ESC = "\x1b[";
const reset = `${ESC}0m`;
const dim = (s: string) => `${ESC}2m${s}${reset}`;
const green = (s: string) => `${ESC}32m${s}${reset}`;
const red = (s: string) => `${ESC}31m${s}${reset}`;
const magenta = (s: string) => `${ESC}35m${s}${reset}`;
const cyan = (s: string) => `${ESC}36m${s}${reset}`;
const bold = (s: string) => `${ESC}1m${s}${reset}`;

const cursorUp = (n: number) => (n > 0 ? `${ESC}${n}A` : "");
const eraseLine = `${ESC}2K`;
const hideCursor = `${ESC}?25l`;
const showCursor = `${ESC}?25h`;

// ── ANSI-aware string utilities ──────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function truncateAnsi(s: string, max: number): string {
  if (visibleLength(s) <= max) return s;

  let visible = 0;
  let result = "";
  let i = 0;
  const raw = s;

  while (i < raw.length && visible < max - 1) {
    // Check for ANSI escape
    if (raw[i] === "\x1b" && raw[i + 1] === "[") {
      const end = raw.indexOf("m", i);
      if (end !== -1) {
        result += raw.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    result += raw[i];
    visible++;
    i++;
  }

  return result + reset + dim("\u2026"); // …
}

// ── Types ────────────────────────────────────────────────────────────

export type RepoStatus = "queued" | "active" | "done" | "failed";

interface RepoState {
  status: RepoStatus;
  message: string;  // e.g. "architecture: Analyzing architecture..."
  summary: string;  // e.g. "3 endpoints, 12 components, 2 diagrams"
  error: string;
  activity: string; // e.g. "Reading src/routes/api.ts"
  activityTs: number; // timestamp of last activity update
}

// ── ProgressTable ────────────────────────────────────────────────────

export class ProgressTable {
  private repos: string[];
  private states: Map<string, RepoState>;
  private maxNameLen: number;
  private lineCount = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private spinnerIdx = 0;
  private isTTY: boolean;
  private exitHandler: (() => void) | null = null;

  constructor(options: { repos: string[] }) {
    this.repos = options.repos;
    this.states = new Map();
    this.maxNameLen = Math.max(...options.repos.map((r) => r.length), 4);

    for (const repo of options.repos) {
      this.states.set(repo, { status: "queued", message: "", summary: "", error: "", activity: "", activityTs: 0 });
    }

    this.isTTY = process.stdout.isTTY === true;
  }

  start(): void {
    if (this.isTTY) {
      process.stdout.write(hideCursor);
      this.exitHandler = () => process.stdout.write(showCursor);
      process.on("exit", this.exitHandler);
      this.render();
      this.interval = setInterval(() => {
        this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
        this.render();
      }, 80);
    } else {
      // Non-TTY: print header once
      const total = this.repos.length;
      process.stdout.write(`Analyzing ${total} ${total === 1 ? "repository" : "repositories"}...\n`);
    }
  }

  update(repo: string, patch: { status?: RepoStatus; message?: string; summary?: string; error?: string; activity?: string }): void {
    const state = this.states.get(repo);
    if (!state) return;

    const prevStatus = state.status;

    if (patch.status !== undefined) state.status = patch.status;
    if (patch.message !== undefined) {
      state.message = patch.message;
      // Clear stale activity when stage message changes
      state.activity = "";
      state.activityTs = 0;
    }
    if (patch.summary !== undefined) state.summary = patch.summary;
    if (patch.error !== undefined) state.error = patch.error;
    if (patch.activity !== undefined) {
      state.activity = patch.activity;
      state.activityTs = Date.now();
    }

    // Non-TTY: log transitions
    if (!this.isTTY && patch.status && patch.status !== prevStatus) {
      if (patch.status === "done") {
        process.stdout.write(`  ${S_DONE} ${repo}  ${state.summary}\n`);
      } else if (patch.status === "failed") {
        process.stdout.write(`  ${S_FAILED} ${repo}  ${state.error}\n`);
      } else if (patch.status === "active" && prevStatus === "queued") {
        process.stdout.write(`  ${S_QUEUED} ${repo}  Starting...\n`);
      }
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.isTTY) {
      // Final render (shows all done/failed states)
      this.render();
      process.stdout.write(showCursor);
      if (this.exitHandler) {
        process.removeListener("exit", this.exitHandler);
        this.exitHandler = null;
      }
    }
  }

  getSummary(): { done: number; failed: number; total: number } {
    let done = 0;
    let failed = 0;
    for (const state of this.states.values()) {
      if (state.status === "done") done++;
      else if (state.status === "failed") failed++;
    }
    return { done, failed, total: this.repos.length };
  }

  // ── Private rendering ────────────────────────────────────────────

  private render(): void {
    const cols = process.stdout.columns || 80;
    const lines: string[] = [];
    const { done, failed, total } = this.getSummary();
    const completed = done + failed;

    // Header
    lines.push(`${dim(S_BAR)}`);
    lines.push(`${cyan(S_BULLET)}  ${bold(`Analyzing ${total} ${total === 1 ? "repository" : "repositories"}`)}`);
    lines.push(`${dim(S_BAR)}  ${completed}/${total} complete`);

    // Per-repo rows
    for (const repo of this.repos) {
      const state = this.states.get(repo)!;
      const paddedName = repo.padEnd(this.maxNameLen);
      let line: string;

      switch (state.status) {
        case "queued":
          line = `${dim(S_BAR)}  ${dim(S_QUEUED)} ${dim(paddedName)}  ${dim("Queued")}`;
          break;
        case "active": {
          const frame = SPINNER_FRAMES[this.spinnerIdx];
          let activitySuffix = "";
          if (state.activity && state.activityTs > 0 && Date.now() - state.activityTs < 3000) {
            activitySuffix = dim(" | " + state.activity);
          }
          line = `${dim(S_BAR)}  ${magenta(frame)} ${paddedName}  ${dim(state.message)}${activitySuffix}`;
          break;
        }
        case "done":
          line = `${dim(S_BAR)}  ${green(S_DONE)} ${paddedName}  ${state.summary}`;
          break;
        case "failed":
          line = `${dim(S_BAR)}  ${red(S_FAILED)} ${paddedName}  ${red(state.error || "Failed")}`;
          break;
      }

      // Truncate to terminal width
      if (visibleLength(line) > cols) {
        line = truncateAnsi(line, cols);
      }

      lines.push(line);
    }

    // Bottom rail
    lines.push(`${dim(S_BAR)}`);

    // Move cursor up to overwrite previous output
    let output = "";
    if (this.lineCount > 0) {
      output += cursorUp(this.lineCount);
    }

    for (const line of lines) {
      output += eraseLine + line + "\n";
    }

    // If previous render had more lines, erase leftover lines
    if (this.lineCount > lines.length) {
      for (let i = 0; i < this.lineCount - lines.length; i++) {
        output += eraseLine + "\n";
      }
      output += cursorUp(this.lineCount - lines.length);
    }

    this.lineCount = lines.length;
    process.stdout.write(output);
  }
}

// ── Tool activity formatter ──────────────────────────────────────────

export function formatToolActivity(event: { tool: string; target: string }): string {
  switch (event.tool) {
    case "Read":
      return `Reading ${event.target}`;
    case "Glob":
      return `Searching ${event.target}`;
    case "Grep":
      return `Grep: ${event.target}`;
    default:
      return `${event.tool}: ${event.target}`;
  }
}

// ── Summary helper ───────────────────────────────────────────────────

export function buildRepoSummary(result: AnalysisResult): string {
  const parts: string[] = [];
  if (result.apiEndpoints.length > 0) {
    parts.push(`${result.apiEndpoints.length} endpoint${result.apiEndpoints.length === 1 ? "" : "s"}`);
  }
  if (result.components.length > 0) {
    parts.push(`${result.components.length} component${result.components.length === 1 ? "" : "s"}`);
  }
  if (result.diagrams.length > 0) {
    parts.push(`${result.diagrams.length} diagram${result.diagrams.length === 1 ? "" : "s"}`);
  }
  if (result.dataModels.length > 0) {
    parts.push(`${result.dataModels.length} model${result.dataModels.length === 1 ? "" : "s"}`);
  }
  if (result.configuration && result.configuration.configItems.length > 0) {
    parts.push(`${result.configuration.configItems.length} config${result.configuration.configItems.length === 1 ? "" : "s"}`);
  }
  if (result.errorHandling && result.errorHandling.errorCodes.length > 0) {
    parts.push(`${result.errorHandling.errorCodes.length} error code${result.errorHandling.errorCodes.length === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : "Analysis complete";
}
