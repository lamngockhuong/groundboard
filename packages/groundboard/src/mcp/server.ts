import { McpServer } from "@modelcontextprotocol/server";
import { VERSION } from "../version.ts";
import { type RenderFn, registerTools } from "./tools.ts";

/** `false` on HTTP: tools may not read or write files. Over stdio, access is confined to `root`. */
export type FileAccess = false | { root: string };

export interface BuildServerOptions {
  fileAccess: FileAccess;
  /** Replaces the in-process pipeline, e.g. with a gated, worker-backed one on HTTP. */
  render?: RenderFn;
}

/** One server factory for both transports: stdio (`groundboard mcp`) and Streamable HTTP (`/mcp`). */
export function buildServer(options: BuildServerOptions): McpServer {
  const server = new McpServer(
    { name: "groundboard", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "groundboard turns a source-grounded board IR into an editable Excalidraw scene. " +
        "Call get_board_schema once to learn the format, write the board from your own reading " +
        "of the code, then call render_board (or validate_board) and fix any reported issue.",
    },
  );
  registerTools(server, options.fileAccess, options.render);
  return server;
}
