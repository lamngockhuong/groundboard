import path from "node:path";
import { parseArgs } from "node:util";
import { type AtlasIndex, type AtlasRequire, atlasHasProblems, buildAtlas } from "../atlas.ts";
import {
  confineAtlasDirectory,
  confineDirectory,
  FileAccessError,
  OUTPUT_DIR,
  resolveRoot,
} from "../mcp/file-access.ts";
import { CliError, type CliIO, EXIT, formatIssues } from "./io.ts";

export const atlasHelp = `Usage: groundboard atlas check [dir] [options]

Read every *.board.json directly in [dir] (default <root>/${OUTPUT_DIR}), check each board
and its cited sources, and report dangling refs, duplicate definitions and stale boards.
Each board's claims (screens, interactive elements, grounded nodes, navigates edges) are
counted by grounding: code (a quoted code source), spec (documents, Figma, mockups, links
only) and none (unresolved).

Options:
      --root <path>       Project root the sources are checked against (default: current directory)
      --require <level>   code: every claim must be backed by code; spec: every claim must cite at
                          least a specification. A board below the level is a problem.
      --baseline <dir>    A copy of the atlas taken before an update, inside the root: every node
                          id, edge id and ref it has that the current board lacks is a problem
      --json              Print the atlas index as JSON on stdout
  -h, --help              Show this help

Exit codes: 0 clean, 1 I/O error, 2 bad arguments, 3 a stale or invalid board or a problem.
`;

/**
 * Resolves the root and atlas directory the way \`serve --atlas\` does: never / or home, the
 * atlas directory inside the root or a symlink inside it (see \`confineAtlasDirectory\`).
 */
export async function resolveAtlasPaths(
  cwd: string,
  rootArg: string | undefined,
  dirArg: string | undefined,
  dirName: string,
): Promise<{ root: string; dir: string }> {
  const resolved = await resolveRoot(
    { GROUNDBOARD_ROOT: rootArg === undefined ? cwd : path.resolve(cwd, rootArg) },
    cwd,
  );
  if (!resolved.ok) throw new CliError(EXIT.usage, `--root: ${resolved.reason}`);
  const requested = dirArg === undefined ? OUTPUT_DIR : path.resolve(cwd, dirArg);
  try {
    return {
      root: resolved.root,
      dir: await confineAtlasDirectory(resolved.root, requested, dirName),
    };
  } catch (error) {
    if (error instanceof FileAccessError) throw new CliError(EXIT.usage, error.message);
    throw error;
  }
}

const REQUIRE_LEVELS: readonly AtlasRequire[] = ["code", "spec"];

/**
 * The baseline directory, inside the project root or, so that two copies of a project can be
 * compared, inside the current directory (which, like the root, may not be / or the home).
 */
async function resolveBaseline(cwd: string, root: string, requested: string): Promise<string> {
  try {
    return await confineDirectory(root, requested, "--baseline");
  } catch (error) {
    if (!(error instanceof FileAccessError)) throw error;
    const workspace = await resolveRoot({ GROUNDBOARD_ROOT: cwd }, cwd);
    if (!workspace.ok) throw new CliError(EXIT.usage, error.message);
    try {
      return await confineDirectory(workspace.root, requested, "--baseline");
    } catch (inner) {
      if (inner instanceof FileAccessError) {
        throw new CliError(
          EXIT.usage,
          `${inner.message.replace("the project root", "the project root, the current directory,")}`,
        );
      }
      throw inner;
    }
  }
}

function report(atlas: AtlasIndex): string {
  let out = "";
  const total = { code: 0, spec: 0, none: 0 };
  for (const board of atlas.boards) {
    out += `${board.slug}.board.json (${board.kind}): ${board.status}\n`;
    if (board.status !== "invalid") {
      const g = board.grounding;
      out += `  grounding: code ${g.code}, spec ${g.spec}, none ${g.none}\n`;
      total.code += g.code;
      total.spec += g.spec;
      total.none += g.none;
    }
    if (board.manual) {
      out += `  edited by hand, not checked: ${board.manual.join(", ")}\n`;
    }
    if (board.status !== "ok") out += formatIssues(board.issues);
    for (const warning of board.warnings) out += `  warning: ${warning}\n`;
  }
  for (const warning of atlas.warnings ?? []) out += `warning: ${warning}\n`;
  if (atlas.problems.length > 0) out += `problems:\n${formatIssues(atlas.problems)}`;
  const stale = atlas.boards.filter((b) => b.status === "stale").length;
  const invalid = atlas.boards.filter((b) => b.status === "invalid").length;
  out += `${atlas.boards.length} board(s), ${atlas.refs.length} ref(s), ${stale} stale, ${invalid} invalid, ${atlas.problems.length} problem(s)\n`;
  out += `grounding: code ${total.code}, spec ${total.spec}, none ${total.none}\n`;
  return out;
}

export async function atlasCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      require: { type: "string" },
      baseline: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.stdout(atlasHelp);
    return EXIT.ok;
  }
  const [sub, dirArg, ...extra] = positionals;
  if (sub !== "check" || extra.length > 0) {
    throw new CliError(EXIT.usage, `expected "atlas check [dir]"\n\n${atlasHelp}`);
  }
  const require = values.require;
  if (require !== undefined && !REQUIRE_LEVELS.includes(require as AtlasRequire)) {
    throw new CliError(
      EXIT.usage,
      `--require must be code or spec, not ${JSON.stringify(require.slice(0, 40))}`,
    );
  }
  const { root, dir } = await resolveAtlasPaths(io.cwd, values.root, dirArg, "the atlas directory");
  const baselineDir =
    values.baseline === undefined
      ? undefined
      : await resolveBaseline(io.cwd, root, path.resolve(io.cwd, values.baseline));
  let atlas: AtlasIndex;
  try {
    atlas = await buildAtlas(dir, root, {
      ...(require !== undefined ? { require: require as AtlasRequire } : {}),
      ...(baselineDir !== undefined ? { baselineDir } : {}),
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    throw new CliError(EXIT.io, `cannot read the atlas directory: ${code}`);
  }
  const problems = atlasHasProblems(atlas);
  if (values.json) io.stdout(`${JSON.stringify(atlas, null, 2)}\n`);
  else if (problems) io.stderr(report(atlas));
  else io.stdout(report(atlas));
  return problems ? EXIT.invalid : EXIT.ok;
}
