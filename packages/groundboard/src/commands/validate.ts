import path from "node:path";
import { parseArgs } from "node:util";
import { validateBoard } from "../pipeline.ts";
import { CliError, type CliIO, EXIT, formatIssues, readJsonInput } from "./io.ts";

export const validateHelp = `Usage: groundboard validate <board.json> [options]

Check a board against the schema and, optionally, its citations against the files.

Options:
      --check-sources <root> Check every cited quote against the files under <root>
      --json                 Print the result as JSON on stdout
  -h, --help                 Show this help
`;

export async function validateCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "check-sources": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.stdout(validateHelp);
    return EXIT.ok;
  }
  if (positionals.length !== 1) {
    throw new CliError(EXIT.usage, "validate takes exactly one board file");
  }
  const input = positionals[0] as string;
  const board = await readJsonInput(input === "-" ? "-" : path.resolve(io.cwd, input), io);
  const checkRoot = values["check-sources"];
  const result = await validateBoard(
    board,
    checkRoot !== undefined ? { checkSourcesRoot: path.resolve(io.cwd, checkRoot) } : {},
  );
  if (values.json) {
    const { board: _board, ...report } = result;
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else if (result.ok) {
    for (const warning of result.warnings) io.stderr(`warning: ${warning}\n`);
    io.stdout(result.sourcesChecked ? `${input}: valid, sources checked\n` : `${input}: valid\n`);
  } else {
    io.stderr(`${input}: ${result.issues.length} issue(s)\n${formatIssues(result.issues)}`);
  }
  return result.ok ? EXIT.ok : EXIT.invalid;
}
