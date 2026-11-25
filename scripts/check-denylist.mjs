#!/usr/bin/env node
// Blocks a push (or flags history) that contains any term from a local, untracked denylist.
//
// Usage:
//   pre-push hook:   node scripts/check-denylist.mjs --pre-push   (reads git's pre-push stdin)
//   whole history:   node scripts/check-denylist.mjs --all
//   a revision range node scripts/check-denylist.mjs --range <a>..<b>
// Options:
//   --denylist <file>  term file (default: the repository's info/denylist under the git dir)
//   --cwd <dir>        repository to scan (default: process cwd)
//
// The denylist holds one term per line; blank lines and lines starting with # are ignored.
// Matching is case-insensitive on commit messages and on added diff lines. When the denylist
// file is absent the check passes silently.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const ZERO_SHA = /^0+$/;

export function readTerms(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
}

/** Revision arguments for `git log` from pre-push stdin lines. */
export function rangesFromPrePush(stdin) {
  const ranges = [];
  for (const line of stdin.split(/\r?\n/)) {
    const [localRef, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || ZERO_SHA.test(localSha)) continue; // deletion
    if (!remoteSha || ZERO_SHA.test(remoteSha)) {
      ranges.push([localSha, "--not", "--remotes"]);
    } else {
      ranges.push([`${remoteSha}..${localSha}`]);
    }
  }
  return ranges;
}

/** Returns one finding per (commit, term) pair whose message or added lines contain the term. */
export function scan(cwd, revArgs, terms) {
  if (terms.length === 0) return [];
  const lowered = terms.map((t) => t.toLowerCase());
  const out = git(cwd, ["log", "-p", "--no-color", "--format=commit %H%n%B", ...revArgs, "--"]);
  const findings = [];
  let commit = null;
  let file = null;
  const seen = new Set();
  for (const line of out.split("\n")) {
    if (line.startsWith("commit ") && /^commit [0-9a-f]{40}$/.test(line)) {
      commit = line.slice(7);
      file = "(commit message)";
      continue;
    }
    if (line.startsWith("diff --git")) {
      file = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    const isAdded = line.startsWith("+");
    const inMessage = file === "(commit message)";
    if (!isAdded && !inMessage) continue;
    const text = line.toLowerCase();
    lowered.forEach((term, i) => {
      if (text.includes(term)) {
        const key = `${commit}\0${file}\0${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({ commit, file, term: terms[i] });
        }
      }
    });
  }
  return findings;
}

function defaultDenylist(cwd) {
  const rel = git(cwd, ["rev-parse", "--git-path", "info/denylist"]).trim();
  return path.resolve(cwd, rel);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "pre-push": { type: "boolean" },
      all: { type: "boolean" },
      range: { type: "string" },
      denylist: { type: "string" },
      cwd: { type: "string" },
    },
  });
  const cwd = path.resolve(values.cwd ?? process.cwd());
  const terms = readTerms(values.denylist ?? defaultDenylist(cwd));
  if (terms.length === 0) return 0;

  let ranges;
  if (values.all) ranges = [["--all"]];
  else if (values.range) ranges = [[values.range]];
  else if (values["pre-push"]) ranges = rangesFromPrePush(readStdin());
  else {
    console.error("check-denylist: pass --pre-push, --all or --range <a>..<b>");
    return 2;
  }

  const findings = ranges.flatMap((r) => scan(cwd, r, terms));
  if (findings.length === 0) return 0;
  console.error("check-denylist: denylisted terms found; nothing was pushed.");
  for (const f of findings) {
    console.error(`  ${f.commit.slice(0, 12)}  ${f.file}  term: ${f.term}`);
  }
  return 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) process.exit(main());
