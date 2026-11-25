import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { SourcesChecked } from "@groundboard/render-excalidraw";
import type { Board, CodeSource, DocSource, Issue } from "@groundboard/schema";
import { createSourceReader, type SourceReader } from "./fs-confined.ts";

export { MAX_SOURCE_FILE_BYTES, MAX_TOTAL_SOURCE_BYTES } from "./fs-confined.ts";

export interface SourceCheckResult {
  issues: Issue[];
  /** Set only when every source passed. */
  sourcesChecked: SourcesChecked | null;
}

export interface CheckSourcesOptions {
  /**
   * Reads the files: share one across several checks under the same root to read each file
   * once and draw on one byte budget. Its root replaces `root`. Default: a fresh reader.
   */
  reader?: SourceReader;
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

const run = promisify(execFile);

/**
 * Whether the files under `root` are what `commit` holds for every cited path: HEAD is that
 * commit and git lists none of the paths as changed, untracked or ignored. False outside git or
 * on any git error, so a board never claims a commit it was not checked against.
 */
async function treeMatchesCommit(
  root: string,
  commit: string,
  paths: readonly string[],
): Promise<boolean> {
  try {
    const [head, wanted] = await Promise.all([
      run("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }),
      run("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], { cwd: root }),
    ]);
    if (head.stdout.trim() !== wanted.stdout.trim()) return false;
    if (paths.length === 0) return true;
    const status = await run(
      "git",
      ["--literal-pathspecs", "status", "--porcelain", "--ignored", "--", ...paths],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
    );
    return status.stdout.trim() === "";
  } catch {
    return false;
  }
}

function where(source: CodeSource | DocSource): string {
  const range =
    source.endLine !== undefined && source.endLine !== source.line
      ? `${source.line}-${source.endLine}`
      : `${source.line}`;
  return `${source.path}:${range}`;
}

/**
 * Checks every checkable source of a validated board (cited by nodes and edges alike) against
 * the files under `root`. Code and doc sources: the file exists inside the root, the cited lines
 * exist, and the quote (whitespace-normalised) appears in them. A mockup with a path: the file
 * exists inside the root (its content is not read). Figma, link and path-less mockup sources
 * cannot be checked offline and are skipped.
 */
export async function checkSources(
  board: Board,
  root: string,
  options: CheckSourcesOptions = {},
): Promise<SourceCheckResult> {
  let reader = options.reader;
  if (reader === undefined) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
      if (!(await stat(realRoot)).isDirectory()) throw new Error("not a directory");
    } catch {
      return {
        issues: [{ path: "", message: "the source root does not exist or is not a directory" }],
        sourcesChecked: null,
      };
    }
    reader = createSourceReader(realRoot);
  }

  const issues: Issue[] = [];
  for (const [i, source] of board.sources.entries()) {
    const at = `sources[${i}]`;
    if (source.kind === "mockup" && source.path !== undefined) {
      const found = await reader.exists(source.path);
      if (!found.ok) {
        issues.push({
          path: `${at}.path`,
          message: `source \`${source.id}\` (${source.path}) ${found.reason}`,
        });
      }
      continue;
    }
    // Figma, link and path-less mockup sources cannot be checked offline; the rendered board
    // counts them as unchecked.
    if (source.kind !== "code" && source.kind !== "doc") continue;
    // Read sequentially in board order so the size budget is deterministic.
    const read = await reader.read(source.path);
    if (!read.ok) {
      issues.push({
        path: `${at}.path`,
        message: `source \`${source.id}\` (${source.path}) ${read.reason}`,
      });
      continue;
    }
    const lineCount = read.lines.length;
    const end = source.endLine ?? source.line;
    if (source.line > lineCount || end > lineCount) {
      issues.push({
        path: `${at}.${source.line > lineCount ? "line" : "endLine"}`,
        message: `source \`${source.id}\` (${where(source)}) cites a line past the end of the file, which has ${lineCount} lines`,
      });
      continue;
    }
    if (source.quote !== undefined && normalise(source.quote) !== "") {
      const cited = normalise(read.lines.slice(source.line - 1, end).join("\n"));
      if (!cited.includes(normalise(source.quote))) {
        issues.push({
          path: `${at}.quote`,
          message: `source \`${source.id}\` (${where(source)}): the quote does not appear in the cited lines; re-read the file and fix line, endLine or quote`,
        });
      }
    }
  }

  if (issues.length > 0) return { issues, sourcesChecked: null };
  const sourcesChecked: SourcesChecked = { root: "working tree" };
  const commit = board.repo?.commit;
  if (commit) {
    const paths = new Set<string>();
    for (const source of board.sources) {
      if (
        (source.kind === "code" || source.kind === "doc" || source.kind === "mockup") &&
        source.path
      )
        paths.add(source.path);
    }
    // The files were read from disk: name the commit only when disk and commit agree.
    if (await treeMatchesCommit(reader.root, commit, [...paths])) sourcesChecked.commit = commit;
  }
  return { issues, sourcesChecked };
}
