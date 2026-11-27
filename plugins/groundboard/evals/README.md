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
npm yet, and the run's sandbox has no network and cannot read your home directory, where this
checkout lives. So the build is installed next to the suite once, and each run's scaffold copies
it into the workspace:

```bash
pnpm install && pnpm -r build
plugins/groundboard/evals/scripts/prepare-tool.sh   # packs both packages into evals/.tool/
```

Run `prepare-tool.sh` again after any change under `packages/`. It needs the npm registry once,
for the packages' dependencies; `evals/.tool/` (about 120 MB) is git-ignored.

Each case's `scaffold.sh` calls `scripts/seed-workspace.sh`, which copies the case's `repo/` into
the empty workspace, commits it, and copies `evals/.tool/node_modules` beside it, so
`npx groundboard render` and `npx groundboard png` run from the workspace without the network.
The scaffold runs only with `--scaffold`, as you and outside the sandbox.

**Once `@groundboard/png` is published**, at the version the plugin pins, the skill's own command
`npx -y -p groundboard@<version> -p @groundboard/png@<version> groundboard png ...` still needs the
registry, which the sandbox blocks unless it is granted. Either keep the local copy (scaffold
installs the published tarballs instead of packing the build: replace the two `pnpm pack` lines
with `npm pack groundboard@<version> @groundboard/png@<version>`), or grant the registry with
`--allow-tools "WebFetch(domain:registry.npmjs.org)"` and drop the scaffold's copy, so the run
tests the command users run. The plugin's MCP server is not started in an eval run (no mock, and
`--mocks record` is the default), so the skill uses its CLI fallback either way.

## Running it

From `plugins/groundboard`:

```bash
TOOLS=(Write Edit "Bash(npx groundboard:*)" "Bash(npx -y -p groundboard@:*)" \
  "Bash(git remote get-url:*)" "Bash(git rev-parse:*)" "Bash(git status:*)" "Bash(git branch:*)")

# Smoke run: one case, one run, no baseline arm; --keep-temp keeps the workspace and trace.
claude plugin eval . --case checkout-why-declined --runs 1 --ablation none --keep-temp \
  --scaffold --trust-plugin --no-publish --max-cost-usd 5 --allow-tools "${TOOLS[@]}"

# Full comparison: every case, three runs per arm, with and without the plugin.
claude plugin eval . --ablation with-without --runs 3 \
  --scaffold --trust-plugin --no-publish --max-cost-usd 60 --allow-tools "${TOOLS[@]}"
```

- `--allow-tools` grants only what the skill's own `allowed-tools` lists: writing the board, the
  groundboard CLI, and the read-only git commands it uses to fill `repo`. `Read`, `Glob`, `Grep`,
  `Skill` and `Agent` (the fresh-eyes reviewer) are not gated.
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

One smoke run (2026-11-27, Claude Code 2.1.332, Linux under WSL2, default model, haiku judge):
`checkout-why-declined`, `--runs 1 --ablation none`, cost **1.09 USD**, **282 s**, 36 turns,
score **0.09** (1 of 11 weighted points). The judge cost 0.002 USD of that, since most judge
graders had no PNG to read; with a PNG each image judge adds about a cent.

A full comparison is 4 cases × 2 arms × 3 runs = 24 agent runs. At the smoke run's price that is
about 26 USD; a with-arm run that gets through rendering and the fresh-eyes review does more
turns than the smoke run did, and a without-arm run fewer, so plan for 20 to 45 USD and set
`--max-cost-usd` above that. Run one at a time it takes about two hours; `-j 4` cuts the wall
time to about 30 minutes on the same rate limit.

## Smoke run result

| Grader | Verdict | Why |
|---|---|---|
| `01-sources-checked` | fail | no `.excalidraw` was written |
| `02-image-drawn` | fail | no PNG was written |
| `03-open-question-named` | fail | the board asked "How does authorize report a refused card? (Payments team)"; the grader then demanded a guest-checkout question, which is off the asked path. The grader now accepts any named question |
| `04-no-invented-actor` | fail (3 of 3 votes) | the actor list left out refunds and other customers, which `decisions.md` names; the list now has them |
| `05-reader-answers`, `06-premises-stated` | fail | no PNG to read |
| `07-skill-fired` | pass | the skill loaded |

The skill loaded, read the code and wrote a well-cited `.groundboard/checkout-declined.board.json`
(doc sources as `"kind": "doc"`, a `question` naming who answers), but neither the render with the
source check nor the PNG happened. Why is not known: the run's trace lives in a temporary directory
that is deleted after the run, and the smoke run did not pass `--keep-temp`. The same
`npx groundboard render --check-sources` and `npx groundboard png` succeed in a workspace seeded by
the same scaffold outside the sandbox, also with a read-only `HOME`, so the likely causes are that
a Bash call did not match the granted patterns or that the sandbox stopped `npx`. The next smoke
run should add `--keep-temp` and read `out/trace.jsonl` before any full run.

## Known blockers

- **Linux needs `bubblewrap` and `socat`.** Without `socat` every run is refused before the agent
  starts, at no cost: `Sandbox required but unavailable: sandbox is enabled but dependencies are
  missing: socat not installed`. Install both (`apt-get install bubblewrap socat`).
- **No render in the smoke run**, cause unverified (above). Until a run writes the `.excalidraw`
  and the PNG, `01`, `02`, `05` and `06` measure the environment, not the skill.
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
