import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { resolveRoot } from "../mcp/file-access.ts";
import { buildServer } from "../mcp/server.ts";
import { type CliIO, EXIT } from "./io.ts";

export const mcpHelp = `Usage: groundboard mcp

Run the MCP server over stdio. File access (checkSourcesRoot, outputPath) is confined to
GROUNDBOARD_ROOT, or to the working directory when it is unset.
`;

export async function mcpCommand(args: string[], io: CliIO): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    io.stdout(mcpHelp);
    return EXIT.ok;
  }
  const root = await resolveRoot(process.env, io.cwd);
  if (!root.ok) {
    io.stderr(`groundboard mcp: file access disabled: ${root.reason}\n`);
  }
  const fileAccess = root.ok ? { root: root.root } : false;
  // stdout carries the protocol; anything else goes to stderr.
  serveStdio(() => buildServer({ fileAccess }), {
    onerror: (error) => io.stderr(`groundboard mcp: ${error.message}\n`),
  });
  return EXIT.ok;
}
