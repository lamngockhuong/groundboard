import { boardJsonSchemaText } from "@groundboard/schema";
import { VERSION } from "../version.ts";
import { CliError, type CliIO, EXIT } from "./io.ts";
import { renderCommand } from "./render.ts";
import { validateCommand } from "./validate.ts";

export const mainHelp = `groundboard ${VERSION}
Turn a question about a codebase into an editable, source-grounded Excalidraw board.

Usage: groundboard <command> [options]

Commands:
  render <board.json>    Validate, lay out and write an .excalidraw scene
  png <board.json>       Draw a board or .excalidraw scene as PNG (needs groundboard-png)
  validate <board.json>  Check a board and, with --check-sources, its citations
  atlas check [dir]      Check every board of a screen atlas and the refs between them
  schema                 Print the board JSON Schema
  mcp                    Run the MCP server over stdio
  serve                  Run the web viewer, render API and MCP endpoint
  export --out <dir>     Write the screen atlas as a static site of the viewer and its data
  figma entry <board>    Write or check the cached Figma reference entry of one frame

Run "groundboard <command> --help" for a command's options.

Exit codes: 0 ok, 1 I/O error, 2 bad arguments, 3 invalid board or failed source check.
`;

type Command = (args: string[], io: CliIO) => Promise<number>;

const commands: Record<string, () => Promise<Command>> = {
  render: async () => renderCommand,
  validate: async () => validateCommand,
  png: async () => (await import("./png.ts")).pngCommand,
  atlas: async () => (await import("./atlas.ts")).atlasCommand,
  schema: async () => async (_args, io) => {
    io.stdout(boardJsonSchemaText());
    return EXIT.ok;
  },
  mcp: async () => (await import("./mcp.ts")).mcpCommand,
  serve: async () => (await import("./serve.ts")).serveCommand,
  export: async () => (await import("./export.ts")).exportCommand,
  figma: async () => (await import("./figma.ts")).figmaCommand,
};

export async function run(argv: string[], io: CliIO): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "-h" || name === "--help" || name === "help") {
    io.stdout(mainHelp);
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  if (name === "-v" || name === "--version") {
    io.stdout(`${VERSION}\n`);
    return EXIT.ok;
  }
  const load = commands[name];
  if (!load) {
    io.stderr(`groundboard: unknown command ${JSON.stringify(name)}\n\n${mainHelp}`);
    return EXIT.usage;
  }
  try {
    return await (await load())(rest, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`groundboard ${name}: ${error.message}\n`);
      return error.exitCode;
    }
    if ((error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
      io.stderr(`groundboard ${name}: ${(error as Error).message}\n`);
      return EXIT.usage;
    }
    throw error;
  }
}
