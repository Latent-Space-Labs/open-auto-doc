import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAnalysisData } from "./loader.js";
import { createServer } from "./server.js";

function parseArgs(argv: string[]): { cacheDir?: string; projectDir?: string } {
  const opts: { cacheDir?: string; projectDir?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--cache-dir" && argv[i + 1]) {
      opts.cacheDir = argv[++i];
    } else if (argv[i] === "--project-dir" && argv[i + 1]) {
      opts.projectDir = argv[++i];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  let data;
  try {
    data = loadAnalysisData(opts);
  } catch (err) {
    process.stderr.write(
      `open-auto-doc-mcp: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(1);
  }

  const repoNames = data.results.map((r) => r.repoName).join(", ");
  process.stderr.write(
    `open-auto-doc-mcp: Loaded ${data.results.length} repo(s): ${repoNames}\n`,
  );

  const server = createServer(data.results);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`open-auto-doc-mcp: Fatal error: ${err}\n`);
  process.exit(1);
});
