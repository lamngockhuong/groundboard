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
Node installed through a version manager (Volta, nvm, asdf) is not found there. So the build and
a copy of Node are put next to the suite once:

```bash
pnpm install && pnpm -r build
plugins/groundboard/evals/scripts/prepare-tool.sh   # packs both packages and copies Node into evals/.tool/
```

Run `prepare-tool.sh` again after any change under `packages/`. It needs the npm registry once,
for the packages' dependencies; `evals/.tool/` (about 330 MB with Node) is git-ignored.

Each case's `scaffold.sh` calls `scripts/seed-workspace.sh`, which copies the case's `repo/` into
the empty workspace, commits it, and copies `evals/.tool/node_modules` beside it, so
`npx groundboard render` and `npx groundboard png` run from the workspace without the network.
The scaffold runs only with `--scaffold`, as you and outside the sandbox. `scripts/run-eval.sh`
puts `evals/.tool/node/bin` first on the `PATH` the run inherits, so `npx` is that Node's and not a
version manager's shim.

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
plugins/groundboard/evals/scripts/run-eval.sh --ablation with-without --runs 3 --max-cost-usd 45
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

Two smoke runs of `checkout-why-declined` (2026-11-27, Claude Code 2.1.332, Linux under WSL2,
default model, haiku judge, `--runs 1 --ablation none`), both before the Node fix, so neither
rendered the board:

| Run | Cost | Time | Turns | Score |
|---|---|---|---|---|
| 1 | 1.09 USD | 282 s | 36 | 0.09 |
| 2 (`--keep-temp`) | 0.77 USD | 255 s | 23 | 0.27 |

The judge cost 0.002 USD per run, since most judge graders had no PNG to read; with a PNG each
image judge adds about a cent.

A full comparison is 4 cases × 2 arms × 3 runs = 24 agent runs. A with-arm run that renders, draws
the PNG and repeats the fresh-eyes review after each fix does more turns than these runs did, so
take 1 to 2 USD per with-arm run and 0.5 to 1 USD per without-arm run: 18 to 36 USD for the full
run; `--max-cost-usd 45` leaves room. Run one at a time it takes about two hours; `-j 4` cuts the
wall time to about 30 minutes on the same rate limit.

## Smoke run results

| Grader | Run 1 | Run 2 | Why |
|---|---|---|---|
| `01-sources-checked` | fail | fail | no `.excalidraw`: `npx` could not start (below) |
| `02-image-drawn` | fail | fail | no PNG, same cause |
| `03-open-question-named` | fail | pass | run 1 asked "How does authorize report a refused card? (Payments team)", but the grader then demanded a guest-checkout question, off the asked path; it now accepts any named question |
| `04-no-invented-actor` | fail | pass | the actor list in run 1 left out refunds and other customers, which `decisions.md` names |
| `05-reader-answers`, `06-premises-stated` | fail | fail | no PNG to read |
| `07-skill-fired` | pass | pass | the skill loaded |

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

The fix copies the Node that runs `prepare-tool.sh` into `evals/.tool/node` and has `run-eval.sh`
put it first on `PATH`. Checked outside the eval: with an empty temporary `HOME`, `npx groundboard`
stops with the same Volta error on the old `PATH`, and with the new `PATH` it renders the board
with the source check and draws the PNG. Not yet checked inside an eval run: the sandbox reading
`evals/.tool/node`, although run 2's agent read files under the same plugin directory.

## Known blockers

- **Linux needs `bubblewrap` and `socat`.** Without `socat` every run is refused before the agent
  starts, at no cost: `Sandbox required but unavailable: sandbox is enabled but dependencies are
  missing: socat not installed`. Install both (`apt-get install bubblewrap socat`).
- **Node from a version manager is not found** under the run's temporary `HOME`
  (`Volta error: Node is not available.`). Run the suite through `scripts/run-eval.sh` after
  `prepare-tool.sh`.
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
