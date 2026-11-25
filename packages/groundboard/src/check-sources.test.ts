import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Board, CodeSource } from "@groundboard/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkSources, MAX_SOURCE_FILE_BYTES } from "./check-sources.ts";
import { createSourceReader } from "./fs-confined.ts";

const SECRET = "TOP-SECRET-FILE-CONTENT";
let base: string;
let root: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "check-sources-"));
  root = path.join(base, "repo");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "a.ts"),
    `// ${SECRET}\nexport function add(a: number, b: number) {\n  return a +\n    b;\n}\n`,
  );
  writeFileSync(path.join(base, "outside.ts"), `${SECRET}\n`);
  symlinkSync(path.join(base, "outside.ts"), path.join(root, "src", "escape.ts"));
  symlinkSync(path.join(root, "src", "a.ts"), path.join(root, "src", "inside-link.ts"));
  writeFileSync(path.join(root, "big.txt"), "x".repeat(MAX_SOURCE_FILE_BYTES + 1));
  mkdirSync(path.join(root, "docs"));
  writeFileSync(
    path.join(root, "docs", "req.md"),
    "# Requirements\n\n- The Pay button submits the order.\n- Done opens the receipt.\n",
  );
  mkdirSync(path.join(root, "design"));
  writeFileSync(path.join(root, "design", "cart.png"), `${SECRET}\n`);
  symlinkSync(path.join(base, "outside.ts"), path.join(root, "design", "escape.png"));
  execFileSync("mkfifo", [path.join(root, "pipe")]);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

function board(...sources: Array<Partial<CodeSource>>): Board {
  return {
    schemaVersion: 1,
    title: "t",
    question: "q",
    groups: [],
    edges: [],
    nodes: [{ id: "n", kind: "note", label: "n", sourceIds: [] }],
    sources: sources.map((s, i) => ({
      id: `s${i}`,
      kind: "code" as const,
      path: "src/a.ts",
      line: 2,
      ...s,
    })),
  };
}

async function oneIssue(...sources: Array<Partial<CodeSource>>) {
  const result = await checkSources(board(...sources), root);
  expect(result.sourcesChecked).toBeNull();
  expect(result.issues, JSON.stringify(result.issues)).toHaveLength(1);
  const issue = result.issues[0] as { path: string; message: string };
  expect(issue.message).not.toContain(SECRET);
  return issue;
}

describe("checkSources", () => {
  test("passes a quote spread over several lines with different whitespace", async () => {
    const result = await checkSources(
      board({
        line: 2,
        endLine: 4,
        quote: "export function add(a: number, b: number) { return a + b;",
      }),
      root,
    );
    expect(result.issues).toEqual([]);
    expect(result.sourcesChecked).toEqual({ root: "working tree" });
  });

  test("does not claim the board's commit outside a git repository", async () => {
    const b = board({ quote: "export function add" });
    b.repo = { commit: "abcdef1" };
    expect((await checkSources(b, root)).sourcesChecked).toEqual({ root: "working tree" });
  });

  test("follows a symlink that stays inside the root", async () => {
    const result = await checkSources(board({ path: "src/inside-link.ts", quote: "add" }), root);
    expect(result.issues).toEqual([]);
  });

  test("rejects a missing file", async () => {
    const issue = await oneIssue({ path: "src/missing.ts" });
    expect(issue).toEqual({
      path: "sources[0].path",
      message: expect.stringMatching(/file not found/),
    });
  });

  test("rejects a line past the end of the file", async () => {
    const issue = await oneIssue({ line: 99 });
    expect(issue.path).toBe("sources[0].line");
    expect(issue.message).toMatch(/past the end of the file, which has 5 lines/);
  });

  test("rejects an endLine past the end of the file", async () => {
    expect((await oneIssue({ line: 2, endLine: 99 })).path).toBe("sources[0].endLine");
  });

  test("rejects a quote that is not in the cited lines", async () => {
    const issue = await oneIssue({ line: 3, quote: "export function add" });
    expect(issue.path).toBe("sources[0].quote");
    expect(issue.message).toMatch(/src\/a\.ts:3\): the quote does not appear/);
  });

  test("rejects a quote that matches file content outside the cited lines without echoing it", async () => {
    const issue = await oneIssue({ line: 2, quote: SECRET });
    expect(issue.message).not.toContain(SECRET);
  });

  test("rejects a `..` escape", async () => {
    expect((await oneIssue({ path: "../outside.ts" })).message).toMatch(/outside the root/);
  });

  test("rejects a symlink escape", async () => {
    expect((await oneIssue({ path: "src/escape.ts", line: 1 })).message).toMatch(
      /outside the root through a symlink/,
    );
  });

  test("rejects a FIFO without blocking", async () => {
    expect((await oneIssue({ path: "pipe", line: 1 })).message).toMatch(/not a regular file/);
  });

  test("rejects a directory", async () => {
    expect((await oneIssue({ path: "src", line: 1 })).message).toMatch(/not a regular file/);
  });

  test("rejects an oversize file", async () => {
    expect((await oneIssue({ path: "big.txt", line: 1 })).message).toMatch(/larger than 2 MB/);
  });

  test("rejects a root that does not exist", async () => {
    const result = await checkSources(board({}), path.join(base, "nope"));
    expect(result.issues[0]?.message).toMatch(/does not exist/);
  });

  test("skips Figma sources, which cannot be checked offline", async () => {
    const b = board({ quote: "export function add" });
    b.sources.push({ id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" });
    const result = await checkSources(b, root);
    expect(result.issues).toEqual([]);
    expect(result.sourcesChecked).not.toBeNull();
  });

  test("checks a doc source like code: file, lines and quote", async () => {
    const doc = (extra: Partial<Board["sources"][number]>) => {
      const b = board();
      b.sources.push({
        id: "req",
        kind: "doc",
        path: "docs/req.md",
        line: 3,
        quote: "The Pay button submits the order.",
        ...extra,
      } as Board["sources"][number]);
      return b;
    };
    expect((await checkSources(doc({}), root)).issues).toEqual([]);
    expect((await checkSources(doc({ line: 4 }), root)).issues).toEqual([
      {
        path: "sources[0].quote",
        message:
          "source `req` (docs/req.md:4): the quote does not appear in the cited lines; re-read the file and fix line, endLine or quote",
      },
    ]);
    expect((await checkSources(doc({ quote: "Pay later" }), root)).issues[0]?.path).toBe(
      "sources[0].quote",
    );
    expect((await checkSources(doc({ path: "docs/gone.md" }), root)).issues[0]?.message).toMatch(
      /file not found/,
    );
    expect((await checkSources(doc({ line: 40 }), root)).issues[0]?.path).toBe("sources[0].line");
  });

  test("checks that a committed mockup exists, without reading it", async () => {
    const mockup = (mockupPath: string) => {
      const b = board();
      b.sources.push({ id: "m", kind: "mockup", label: "Cart mockup", path: mockupPath });
      return b;
    };
    const realRoot = await (await import("node:fs/promises")).realpath(root);
    const reader = createSourceReader(realRoot, { remaining: 1024 });
    expect((await checkSources(mockup("design/cart.png"), root, { reader })).issues).toEqual([]);
    expect(reader.budget.remaining).toBe(1024);
    const cases: Array<[string, RegExp]> = [
      ["design/missing.png", /^source `m` \(design\/missing\.png\) does not exist under the root$/],
      ["design/escape.png", /outside the root through a symlink/],
      ["design", /not a regular file/],
      ["pipe", /not a regular file/],
      ["../outside.ts", /outside the root/],
    ];
    for (const [mockupPath, pattern] of cases) {
      const result = await checkSources(mockup(mockupPath), root);
      expect(result.sourcesChecked, mockupPath).toBeNull();
      expect(result.issues, mockupPath).toHaveLength(1);
      expect(result.issues[0]?.path).toBe("sources[0].path");
      expect(result.issues[0]?.message).toMatch(pattern);
      expect(result.issues[0]?.message).not.toContain(SECRET);
    }
  });

  test("skips links and mockups without a path", async () => {
    const b = board();
    b.sources.push(
      { id: "l", kind: "link", url: "https://docs.example.com/a", title: "Spec" },
      { id: "m", kind: "mockup", label: "Kept in Drive" },
    );
    const result = await checkSources(b, root);
    expect(result.issues).toEqual([]);
    expect(result.sourcesChecked).not.toBeNull();
  });

  test("checks a source cited only by an edge like any other", async () => {
    const b = board({ quote: "not in the file" });
    b.nodes.push({ id: "m", kind: "note", label: "m", sourceIds: [] });
    b.edges.push({ id: "e", from: "n", to: "m", kind: "navigates", sourceIds: ["s0"] });
    const result = await checkSources(b, root);
    expect(result.issues.map((i) => i.path)).toEqual(["sources[0].quote"]);
  });

  test("a shared reader reads each file once and draws on one budget", async () => {
    const realRoot = (await import("node:fs/promises")).realpath(root);
    const reader = createSourceReader(await realRoot, { remaining: 1024 });
    const first = await checkSources(board({ quote: "export function add" }), root, { reader });
    expect(first.issues).toEqual([]);
    const used = 1024 - reader.budget.remaining;
    expect(used).toBeGreaterThan(0);
    await checkSources(board({ quote: "export function add" }), root, { reader });
    expect(1024 - reader.budget.remaining).toBe(used);
  });
});

describe("checkSources against the board's commit", () => {
  let repo: string;
  let head: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: repo,
      encoding: "utf8",
    }).trim();

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "check-sources-git-"));
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(repo, "src", "other.ts"), "export const other = 1;\n");
    writeFileSync(path.join(repo, ".gitignore"), "ignored.ts\n");
    writeFileSync(path.join(repo, "ignored.ts"), "export const ignored = 1;\n");
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    head = git("rev-parse", "HEAD");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const cited = (commit: string, ...paths: string[]): Board => ({
    schemaVersion: 1,
    title: "t",
    question: "q",
    groups: [],
    edges: [],
    nodes: [{ id: "n", kind: "note", label: "n", sourceIds: [] }],
    repo: { commit },
    sources: paths.map((p, i) => ({ id: `s${i}`, kind: "code" as const, path: p, line: 1 })),
  });

  test("claims the commit when HEAD is that commit and the cited files are unchanged", async () => {
    for (const commit of [head, head.slice(0, 7)]) {
      expect((await checkSources(cited(commit, "src/a.ts"), repo)).sourcesChecked).toEqual({
        root: "working tree",
        commit,
      });
    }
  });

  test("still claims the commit when only an uncited file changed", async () => {
    writeFileSync(path.join(repo, "src", "other.ts"), "export const other = 2;\n");
    try {
      expect((await checkSources(cited(head, "src/a.ts"), repo)).sourcesChecked?.commit).toBe(head);
    } finally {
      git("checkout", "--", "src/other.ts");
    }
  });

  test("does not claim the commit when a cited file has uncommitted changes", async () => {
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1; // edited\n");
    try {
      expect((await checkSources(cited(head, "src/a.ts"), repo)).sourcesChecked).toEqual({
        root: "working tree",
      });
    } finally {
      git("checkout", "--", "src/a.ts");
    }
  });

  test("does not claim the commit for a cited file the commit does not hold", async () => {
    writeFileSync(path.join(repo, "src", "new.ts"), "export const fresh = 1;\n");
    try {
      for (const file of ["src/new.ts", "ignored.ts"]) {
        expect((await checkSources(cited(head, file), repo)).sourcesChecked).toEqual({
          root: "working tree",
        });
      }
    } finally {
      rmSync(path.join(repo, "src", "new.ts"));
    }
  });

  test("does not claim a commit that is not HEAD", async () => {
    const other = "0123456789abcdef0123456789abcdef01234567";
    expect((await checkSources(cited(other, "src/a.ts"), repo)).sourcesChecked).toEqual({
      root: "working tree",
    });
  });
});
