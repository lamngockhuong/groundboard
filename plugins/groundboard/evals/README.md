# Evals for the `board` skill

Each folder is one case for `claude plugin eval`: `prompt.md` is the task, `case.yaml` the
expected outcome and the scaffold, `graders/` the checks, and `repo/` the small fixed repository
the run works in. The suite measures what the skill adds to a model that already has the
groundboard CLI: the same case runs with the plugin loaded and without it, and the difference is
the skill's worth.

## What the cases measure

| Case | Repository | Reader | Board | Main question |
|---|---|---|---|---|
| `checkout-why-declined` | `checkout/` (payment, stock, decisions) | A developer new to the team | Cause tree | Why is a checkout declined after the card was authorized? |
| `orders-refund-for-pm` | `orders/` (status table, README) | A product manager who never reads code | State machine | Until when can a customer cancel, and when only get a refund? |
| `orders-after-placed` | `server/` (routes, jobs, event handler) | A developer new to the project | Flow | What happens after an order is placed, until it is packed or closed? |
| `signup-from-requirements` | `docs/requirements.md`, no code | The client who wrote the brief | Flow from the requirements | Is this the signup flow the client meant? |

Each repository holds one thing its own files cannot answer, so a good board has to say so
rather than invent it: what the gateway does with a refused card, how a packed order goes back to stock (the
README says it can, the code has no such status change), what publishes `order.paid`, and what
the Welcome screen looks like or what a wrong code does.

Every prompt names the reader and fixes the output name, so graders can find
`.groundboard/<slug>.board.json`, `.groundboard/<slug>.excalidraw` and `.groundboard/<slug>.png`.
It also says that groundboard is installed and that nobody can answer questions: both arms get the
same tool, and only the with-arm gets the skill's procedure.

Two kinds of grader:

- **Grounding** (free, deterministic):
  - `01-sources-checked`: the `.excalidraw` carries the title line `Sources checked against the
    working tree`. `groundboard render --check-sources` writes that file only when the board is
    valid, every claim node (`step`, `state`, `decision`, `cause`, `rejected`, `fact`) cites a
    source, and every quote is in the lines it cites; so this one regex covers "it renders",
    "every claim cites a source" and "every quote is real".
  - `02-image-drawn`: the PNG exists.
  - `03-open-question-named`: the board JSON has a `question` node that names who must answer, in
    parentheses; in three cases it must also be about the case's open point (restocking a packed
    order, what makes an order paid, a question for the client).
  - `08-cites-requirements` (requirements case only): the board cites `"kind": "doc"` sources.
  - `04-no-invented-actor` is a judge reading the board JSON against the list of actors the
    repository names, since "no actor the source does not name" is not a pattern.
- **Reader** (a judge given only the PNG):
  - `05-reader-answers` (weight 3): the judge reads the image as the named reader and answers
    the three questions the repository answers; it passes only if all three can be read off the
    image in words the image gives.
  - `06-premises-stated` (weight 2): the judge lists what the board takes for granted, step by
    step, and fails on any step that cannot be followed without something the board never says.
    This is the measured form of Part B in `skills/board/references/review.md`.
- `07-skill-fired` (`tool_used: Skill`) confirms the with-arm loaded the skill. In a two-arm run
  it is an indicator only, not part of the score.

## Before the first run

The cases draw the PNG with this repository's own build, because `@groundboard/png` is not on
npm yet and the run's sandbox has no network. The run's agent also gets a temporary `HOME`, so a
Node installed through a version manager is not found there. So the build and a copy of Node are
put next to the suite once:

```bash
pnpm install && pnpm -r build
plugins/groundboard/evals/scripts/prepare-tool.sh   # packs both packages and copies Node into evals/.tool/
```

Run `prepare-tool.sh` again after any change under `packages/`. It needs the npm registry once,
for the packages' dependencies; `evals/.tool/` (about 330 MB with Node) is git-ignored.

Each case's `scaffold.sh` calls `scripts/seed-workspace.sh`, which copies the case's `repo/` into
the empty workspace, commits it, and copies `evals/.tool/node_modules` beside it, so
`npx groundboard render` and `npx groundboard png` run from the workspace without the network.
The scaffold runs only with `--scaffold`, as you and outside the sandbox.

Two things make `npx` find that Node in the run:

- `scripts/run-eval.sh` puts `evals/.tool/node/bin` first on the `PATH` the run inherits.
- The agent's shell does not keep that order: it rebuilds `PATH` from your login shell (seen in
  a run, not documented), so whatever your `~/.zshrc` or `~/.profile` puts first comes first.
  With Volta that is
  `~/.volta/bin`, whose shims read their Node from `$HOME/.volta`, and the run's `HOME` is empty.
  So when `prepare-tool.sh` finds Volta, it keeps the three small files a shim reads, and the
  scaffold writes them, with the Node copy as the only image, to `$HOME/.volta` in the run's
  temporary home. nvm and asdf are not handled; their shims would need the same treatment.

**Once `@groundboard/png` is published**, at the version the plugin pins, the skill's own command
`npx -y -p groundboard@<version> -p @groundboard/png@<version> groundboard png ...` still needs the
registry, which the sandbox blocks unless it is granted. Either keep the local copy (scaffold
installs the published tarballs instead of packing the build: replace the two `pnpm pack` lines
with `npm pack groundboard@<version> @groundboard/png@<version>`), or grant the registry with
`--allow-tools "WebFetch(domain:registry.npmjs.org)"` and drop the scaffold's copy, so the run
tests the command users run. The Node copy stays needed wherever Node comes from a version
manager. The plugin's MCP server is not started in an eval run (no mock, and `--mocks record` is
the default), so the skill uses its CLI fallback either way.

## Running it

`scripts/run-eval.sh` runs `claude plugin eval .` from `plugins/groundboard` with the scaffold,
the tool grants and the `PATH` above; other arguments pass through:

```bash
# Smoke run: one case, one run, no baseline arm; --keep-temp keeps the workspace and trace.
plugins/groundboard/evals/scripts/run-eval.sh --case checkout-why-declined --runs 1 \
  --ablation none --keep-temp --max-cost-usd 2

# Full comparison: every case, three runs per arm, with and without the plugin.
plugins/groundboard/evals/scripts/run-eval.sh --ablation with-without --runs 3 --max-cost-usd 50
```

- `--allow-tools` grants only what the skill's own `allowed-tools` lists: writing the board, the
  groundboard CLI (`Bash(npx groundboard:*)` and the `npx -y -p groundboard@` form for the PNG),
  and the read-only git commands it uses to fill `repo`. `Read`, `Glob`, `Grep`, `Skill` and
  `Agent` (the fresh-eyes reviewer) are not gated. Other shell commands are denied, which the
  runs show as `Permission to use Bash has been denied because Claude Code is running in don't
  ask mode`; the skill does not need them.
- `--scaffold` is required: without it the workspace is empty and every grader fails.
- `--trust-plugin` answers the first-run trust prompt; use it only on this repository.
- `--no-publish` keeps the HTML report on your machine.
- Results land in `evals/results/<timestamp>/` (`report.html`, `aggregate-result.json`).
- The judge defaults to haiku. If `07-skill-fired` passes and `Δ` is negative, re-run with
  `--judge-model sonnet` before blaming the skill.

## Reading Δ per grader

`Δ` is the with-arm score minus the without-arm score; a positive `Δ` means the skill raised it.
Read it per grader, not only per case (`report.html` shows both arms' verdicts for every grader):

- `Δ` on `01-sources-checked` and `03-open-question-named`, with `05` and `06` flat: the skill
  teaches grounding (cite, check, ask instead of invent), not explaining. The next change belongs
  in the reader steps (step 1 and step 7 of `SKILL.md`).
- `Δ` on `05-reader-answers` but not `06-premises-stated`: the board names the right things but
  leaves the reasons between them unsaid; look at the premise list (step 3) and the reviewer's
  Part B.
- No `Δ` on `04-no-invented-actor`: a strong model already sticks to what it read; the rule costs
  nothing but adds nothing measurable here.
- A grader that fails in both arms usually measures the environment, not the skill: check the
  run's `NOTES` and the workspace with `--keep-temp` before reading anything into it.

## Cost

Four smoke runs of `checkout-why-declined` (2026-11-27 and 28, Claude Code 2.1.332, Linux under
WSL2, default model, haiku judge, `--runs 1 --ablation none`). Runs 1 to 3 stopped on a reason in
the setup; run 4 wrote the `.excalidraw` but not the PNG, for a reason in Claude Code (below):

| Run | Setup | Cost | Time | Turns | Score |
|---|---|---|---|---|---|
| 1 | direct `claude plugin eval` | 1.09 USD | 282 s | 36 | 0.09 |
| 2 | same, `--keep-temp` | 0.77 USD | 255 s | 23 | 0.27 |
| 3 | `run-eval.sh` (Node copy first on `PATH`), `--keep-temp` | 0.87 USD | 140 s | 27 | 0.18 |
| 4 | `run-eval.sh` with the Volta home, `--keep-temp`, `--max-cost-usd 2` | 2.43 USD | 447 s | 43 | 0.36 |

The judge cost 0.002 USD per run, since most judge graders had no PNG to read; with a PNG each
image judge adds about a cent. Run 4 went over its 2 USD ceiling because the ceiling is checked
only before a run starts; once crossed, it skipped the paid judges (04 to 06). Much of run 4's
cost came from working around the read-only shell: the agent printed the 46 KB render in seven
pieces to save it with the Write tool.

A full comparison is 4 cases × 2 arms × 3 runs = 24 agent runs. A with-arm run that renders, draws
the PNG and repeats the fresh-eyes review after each fix does more turns than these runs did, so
take 1.5 to 2.5 USD per with-arm run (run 4 also sent the board to two fresh-eyes reviewers) and
0.5 to 1 USD per without-arm run: 24 to 42 USD for the full run; `--max-cost-usd 50` leaves room. Run one at a time it takes about two hours; `-j 4` cuts the
wall time to about 30 minutes on the same rate limit.

## Smoke run results

| Grader | Run 1 | Run 2 | Run 3 | Run 4 | Why |
|---|---|---|---|---|---|
| `01-sources-checked` | fail | fail | fail | pass | runs 1 to 3: no `.excalidraw`, `npx` could not start (below); run 4 rendered it |
| `02-image-drawn` | fail | fail | fail | fail | runs 1 to 3: same cause; run 4: the shell could not write the PNG (below) |
| `03-open-question-named` | fail | pass | pass | pass | run 1 asked "How does authorize report a refused card? (Payments team)", but the grader then demanded a guest-checkout question, off the asked path; it now accepts any named question |
| `04-no-invented-actor` | fail | pass | fail | skipped | run 1: the actor list left out refunds and other customers, which `decisions.md` names. Run 3: the board explains a declined card as "a card the bank refuses", and the rubric listed the bank as invented; it now counts only an actor drawn as its own step. Run 4: skipped once the cost ceiling was crossed |
| `05-reader-answers`, `06-premises-stated` | fail | fail | fail | skipped | no PNG to read; run 4 skipped them at the cost ceiling |
| `07-skill-fired` | pass | pass | pass | pass | the skill loaded |

**Why nothing rendered.** Run 2's trace (`--keep-temp`) shows the skill load, read the code, write
`.groundboard/checkout-declined.board.json`, and then every Node command stop at once:

```text
$ npx groundboard render .groundboard/checkout-declined.board.json -o .groundboard/checkout-declined.excalidraw --check-sources . 2>&1 | tail -30
Volta error: Node is not available.

To run any Node command, first set a default version using `volta install node`
```

`node --version` stopped the same way, with exit code 126. On the machine that ran the suite,
`node` and `npx` on `PATH` are Volta shims (`~/.volta/bin`); a shim picks the Node to run from
Volta's settings in `HOME`, and the run's agent has a fresh temporary `HOME` with no Volta in it.
The grants were not the cause: the `npx groundboard` calls were allowed and ran, and only the
agent's attempts to look for another Node (`ls`, `which`, `python3`) were denied, as they should
be. The agent then reviewed the text of the board instead of the image, as the skill says to.

Run 3 put the Node copy first on `PATH` (`run-eval.sh`), and the agent's shell still ran Volta:

```text
$ which node
/home/lamngockhuong/.volta/bin/node
$ npx groundboard render .groundboard/checkout-declined.board.json -o .groundboard/checkout-declined.excalidraw --check-sources .
Volta update error: Could not create directory /tmp/claude-eval-WJ3dju/home/.volta

Please ensure that you have the correct permissions.
```

The `PATH` did reach the run: the eval harness itself ran `npm root --global` with the Node copy
(`0 verbose cli .../evals/.tool/node/bin/node .../evals/.tool/node/bin/npm` in the run's npm log).
But the agent's shell rebuilt `PATH` from the login shell, where `~/.zshrc` and `~/.profile` put
`$VOLTA_HOME/bin` first, without `VOLTA_HOME` itself, so the shim looks for `$HOME/.volta` in the
empty temporary home and cannot create it in the sandbox.

The fix writes a Volta home to the run's temporary `HOME` from the scaffold (see "Before the first
run"). Checked outside the eval: a temporary `HOME` made read-only after the scaffold, with
`~/.volta/bin` first on `PATH`, reproduces `Could not create directory .../.volta` without the
Volta home, and with it `npx groundboard render --check-sources` writes the `.excalidraw` and
`npx groundboard png` draws the PNG. Run 4 confirmed it inside an eval run: `npx groundboard`
started, and `validate --check-sources` passed.

**Why run 4 drew no PNG.** Every shell command that wrote a file failed, in the workspace and in
the run's own temporary directory alike:

```text
$ npx groundboard png .groundboard/checkout-declined.board.json -o .groundboard/checkout-declined.png
groundboard png: cannot write .groundboard/checkout-declined.png: EROFS
$ npx groundboard validate .groundboard/checkout-declined.board.json --check-sources .
.groundboard/checkout-declined.board.json: valid, sources checked
zsh:1: read-only file system: /tmp/claude-eval-r0ORwW/tmp/claude-1000/cwd-2e5a
```

The sandbox settings the harness wrote for the run (`config/settings.json` in the kept
directory) allow writes to the run's `home` and `tmp`, both under `/tmp/claude-eval-r0ORwW/`, and
deny writes to `//tmp`, the system temporary directory they live in; the deny wins. Claude Code
2.1.332 leaves the run's parent directory out of that deny list on macOS only, so on Linux a run
whose agent writes files from the shell cannot pass. Setting `TMPDIR` should not help: the list of
temporary directories the harness denies reads `TMPDIR` as well (read from the bundled code, not
tried). This is not in the setup, and the documentation says a granted
`Bash` can write to the run's workspace. The agent saved the `.excalidraw` with the Write tool,
from the render printed to standard output, but the Write tool cannot save a binary PNG.

## Known blockers

- **Linux needs `bubblewrap` and `socat`.** Without `socat` every run is refused before the agent
  starts, at no cost: `Sandbox required but unavailable: sandbox is enabled but dependencies are
  missing: socat not installed`. Install both (`apt-get install bubblewrap socat`).
- **Node from a version manager is not found** under the run's temporary `HOME`
  (`Volta error: Node is not available.`, `Volta update error: Could not create directory
  .../home/.volta`). Run `prepare-tool.sh`, then the suite through `scripts/run-eval.sh`. Volta is
  handled; nvm or asdf shims first on the login-shell `PATH` are not.
- **On Linux, shell commands cannot write files in an eval run** (`EROFS`, `read-only file
  system: /tmp/claude-eval-.../tmp/...`): the harness denies writes to `/tmp`, where the run's
  own directories are (see "Why run 4 drew no PNG"). Until Claude Code fixes it, the PNG graders
  fail on Linux; run the suite on macOS, where the harness leaves the run's directory out of that deny
  (read from the bundled code; not tried here).
- **The plugin's MCP server does not start** in an eval run (`has no mock and is NOT started`),
  so the skill always takes its CLI fallback; that is the path these cases test.
- **`@groundboard/png` is not on npm**, so the PNG comes from this repository's build through
  `scripts/prepare-tool.sh` (see "Before the first run").
- **A large board is cut into tiles** (`<slug>-r1c1.png`, ...) instead of one `<slug>.png`; the
  image graders then fail on a missing file. The cases' boards are small enough to fit one image.

## Adding a case

- Copy a small fixture into `<case>/repo/` and keep it frozen: graders quote what it says.
- Give the output a fixed slug in the prompt and point the graders at
  `.groundboard/<slug>.board.json`, `.excalidraw` and `.png`.
- Name the reader in the prompt and in `05` and `06`, with what they do NOT know.
- Write each `llm` grader as `PASS if ...` / `FAIL if ...`, one property per grader.
- Put one thing in the repository its files cannot answer, and grade for a `question` on it.
