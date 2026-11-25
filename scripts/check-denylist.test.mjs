import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rangesFromPrePush, readTerms, scan } from "./check-denylist.mjs";

const script = path.join(import.meta.dirname, "check-denylist.mjs");
let repo;
let denylist;

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(file, content, message) {
  writeFileSync(path.join(repo, file), content);
  git("add", file);
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function prePush(localSha, remoteSha = "0".repeat(40)) {
  return spawnSync(
    process.execPath,
    [script, "--pre-push", "--cwd", repo, "--denylist", denylist],
    { input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`, encoding: "utf8" },
  );
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "denylist-"));
  denylist = path.join(repo, "..", `${path.basename(repo)}.denylist`);
  git("init", "-q", "-b", "main");
  writeFileSync(denylist, "# client terms\nAcmeSecretCorp\n\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(denylist, { force: true });
});

describe("check-denylist", () => {
  test("reads terms, skipping blanks and comments", () => {
    expect(readTerms(denylist)).toEqual(["AcmeSecretCorp"]);
    expect(readTerms(path.join(repo, "missing"))).toEqual([]);
  });

  test("blocks a push whose diff adds a listed term (case-insensitive)", () => {
    const sha = commit("a.txt", "hello acmesecretcorp\n", "feat: add a");
    const result = prePush(sha);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("a.txt");
  });

  test("blocks a push whose commit message contains a listed term", () => {
    const sha = commit("a.txt", "hello\n", "feat: for AcmeSecretCorp");
    expect(prePush(sha).status).toBe(1);
  });

  test("allows a clean push", () => {
    const sha = commit("a.txt", "hello world\n", "feat: add a");
    expect(prePush(sha).status).toBe(0);
  });

  test("only scans commits not already on the remote side", () => {
    const first = commit("a.txt", "AcmeSecretCorp\n", "feat: old");
    const second = commit("b.txt", "clean\n", "feat: new");
    expect(prePush(second, first).status).toBe(0);
  });

  test("skips silently when the denylist file is absent", () => {
    const sha = commit("a.txt", "AcmeSecretCorp\n", "feat: add a");
    rmSync(denylist);
    expect(prePush(sha).status).toBe(0);
  });

  test("--all scans the whole history", () => {
    commit("a.txt", "AcmeSecretCorp\n", "feat: a");
    commit("a.txt", "removed\n", "fix: scrub");
    expect(scan(repo, ["--all"], ["AcmeSecretCorp"])).toHaveLength(1);
  });

  test("parses pre-push stdin and ignores branch deletions", () => {
    const z = "0".repeat(40);
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(
      rangesFromPrePush(`refs/heads/x ${a} refs/heads/x ${b}\n(delete) ${z} refs/heads/y ${b}\n`),
    ).toEqual([[`${b}..${a}`]]);
  });
});
