# Lessons from runs

Rules the board skill learned from real runs, each naming the run or the feedback that taught
it. Read this before the first render in a session. A rule here never overrides `SKILL.md`; it
says what went wrong when a run followed `SKILL.md` and still lost time, money or the reader.

Sources so far:

- **Eval smoke runs 1 to 4**: `checkout-why-declined`, 2026-11-27 and 28, default model, one run
  each, recorded in `plugins/groundboard/evals/README.md` ("Cost" and "Smoke run results").
- **PNG render**: PR #29, 2026-11-27, which added `groundboard png` and `@groundboard/png` after
  comparing its images with the viewer's own export; the known gaps are in
  `packages/png/README.md`.
- **Contrast fix**: PR #33, 2026-11-27, which raised the board palette to readable contrast.

All runs so far used the default model, so there is no per-model section yet. One run per
source: these are observed habits, not statistics.

## Rules

### Staying true to the source

1. **An outside party may explain a node; it is drawn as a step only when a source names it.**
   The board explained a declined card as "a card the bank refuses", a fair gloss for the reader,
   but no file in the repository names the bank as an actor. Keep such a party in
   a node's words; never give it a node or a lane of its own (smoke run 3, where the grader first
   counted the bank as an invented actor and was changed to count only actors drawn as a step).
2. **Ask the open question on the path the question asks about.** "How does authorize report a
   refused card? (Payments team)" was the right question for a checkout decline; a question about
   guest checkout would have been off that path. One named question on the path beats several
   around it (smoke run 1).

### Environment

3. **When `npx groundboard` cannot start Node, stop and report it.** `Volta error: Node is not
   available.` and `Could not create directory .../.volta` come from the machine, not the board.
   Searching for another Node (`ls`, `which`, `python3`) was denied and cost turns; quote the
   error in the report and give the reviewer the board's text, as step 7 says (smoke runs 2 and 3).
4. **When the shell cannot write files, do not page a render through standard output.** After
   `EROFS` or `read-only file system`, retrying shell writes fails the same way. Printing the
   46 KB render in seven pieces to save it with the Write tool was much of the 2.43 USD run 4
   cost, and the PNG still could not be saved, since the Write tool writes no binary. Check the
   board with `npx groundboard validate --check-sources .` (it writes nothing), and say in the
   report which files were not written and why (smoke run 4).

### Review cost

5. **One fresh-eyes reviewer per round.** Each reviewer is a subagent paid for in full; start a
   new reviewer only after the board changed, as step 7 says
   (smoke run 4 sent the board to two reviewers and ended at 2.43 USD against a 2 USD ceiling).

### Reading the PNG

6. **A line drawn in a plain sans font is the PNG's font fallback, not a flaw in the board.**
   A line holding a character Excalifont lacks (seen: `→`) is drawn wholly in the fallback font,
   where the viewer swaps only that character. The words stay readable and the viewer shows them
   as intended, so do not reword a label for it (PR #29; `packages/png/README.md`).
7. **The dark PNG is what a dark-mode reader sees.** It applies Excalidraw's own dark filter and
   matched the browser's export to within 0.4 % of pixels, all at glyph edges, in the comparison
   made before PR #29, but it is slower to draw (0.7–0.9 s against 0.4–0.7 s for light in PR
   #29). Draw it only when the reader uses the dark theme, and then trust it as the reader's view.
8. **Low contrast in the image is a renderer bug, not something to fix in the board.** The
   palette is tested so that every text reaches 4.5:1 and every stroke 3:1 in both themes. If a
   reviewer still cannot read a colour, report it with the theme and the node kind rather than
   change the board to avoid that kind (contrast fix, PR #33).

## Adding a rule

Add a rule after an eval run, or when a person says a board was hard to read. Write it under the
heading it belongs to, numbered on from the last rule, with three things:

- **The rule**, in bold, one sentence that says what to do.
- **The run or feedback that taught it**: the eval case and run with where it is recorded, or
  who said the board was hard to read and about which board. Quote the error or the words when
  they are short.
- **The date**, in the source list at the top when the source is new, or in the rule otherwise.

Add a rule only for something that happened; a rule with no run or feedback behind it belongs
in a design discussion, not here. When a later run shows a rule is wrong, change or remove it
and name that run too. When a rule has become a step in `SKILL.md` or a check in the CLI, remove
it here.
