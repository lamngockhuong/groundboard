# Fresh eyes: a reviewer who has not read the code looks at the board

You drew the board, so you read into it what you meant. A reviewer who has only the image shows
what the board actually says. A board can cite every line correctly, pass the source check, and
still leave its reader unable to follow one step, because the missing thing was never on the
board: the source check cannot see it, and neither can you.

Run this after a clean render (step 5 or 6 of the skill) and before the report, for every board
meant for someone other than you. A board you drew only to answer your own question needs none.

## 1. Draw the image

Draw the board as PNG with `groundboard png`, in the light theme, into the cache, which is never
committed. If `.groundboard/.cache/.gitignore` does not exist, write it containing the single line
`*`. Then run, with `<version>` the `version` in the skill's metadata:

```sh
npx -y -p groundboard@<version> -p @groundboard/png@<version> groundboard png .groundboard/<slug>.board.json -o .groundboard/.cache/review/<slug>-light.png
```

When the reader will open the board in the viewer's dark theme, draw it a second time with
`--theme dark` into `<slug>-dark.png` and give the reviewer both images.

The command prints the path of every image it wrote, one per line. A large board is cut into
tiles `<slug>-light-r<row>c<col>.png`: give the reviewer every tile, row by row, and say that they
are the parts of one board, neighbours overlapping by 48 px.

**When there is no image.** `@groundboard/png` may not be on npm yet, and the drawing may fail
(no network for `npx`, a font or a board it cannot draw). Do not retry more than once. Review the
text of the board instead: write the board out for the reviewer as plain lines, in the order you
mean it to be read, one per node (`[kind] label`, with the group it sits in) and one per edge
(`label: from-label -> to-label`, with the edge kind), and nothing else: no `detail`, no source,
no id. Tell the reviewer that this is the text of a board whose layout was not checked, and leave
out question 1 below (where the eye starts), since a list has no layout. Say in the report that
the review used the text, and why the image could not be drawn. A text review cannot catch a
board whose boxes overlap, whose arrows cross, or whose reading order the layout breaks.

## 2. Ask a reviewer who has not read the code

Start a subagent with the Agent tool. Give it ONLY the image paths, the reader and the "surely
knows" list from step 1 of the skill. Never give it the code, the IR, the source quotes, your
term list, your premise list or your notes: the reviewer is useful only because it has not seen
them. The prompt, filled in:

```text
You review one board, an Excalidraw diagram, and have only the image at <absolute path to
<slug>-light.png> (<more images: the dark one, or the tiles row by row>). Read no other file, do not
search the repository, and do not look for the subject anywhere else.

The board is drawn as boxes (nodes) joined by arrows (edges); a labelled frame around several
boxes is a group. Each box also has a sources panel the reader opens by selecting it, listing the
lines of code it rests on and a longer description; the panel is not in the image, and the
reader does not open it to follow the board. Judge only what the image shows.

Reader: <the reader from step 1, e.g. "a QA engineer on this project who does not read code">.
The reader surely knows only this:
<the "surely knows" list from step 1, one item per line>

Part A, as the reader. You have not read the code or any document about it.
1. Where did your eye start, and in what order did you read the boxes and groups?
2. In one or two sentences, what does this board say?
3. Which words, names or marks did you not understand?
4. Which box, arrow or group seemed unrelated to the rest?

Part B, as yourself: someone who understands software.
The reader of Part A is played by you, who understands every word, so Part A cannot show what a
real reader lacks. Find that another way: list what the board takes for granted.
5. Walk the board in reading order, box by box and arrow by arrow. At each step, write what the
   reader must already accept for the step to make sense: a term, a rule of how a part normally
   works, a relation between two things the board names, a convention or a sign (an arrow style,
   a colour, a shape).
6. For each item, quote the words of the board that state it, or write ASSUMED when the board uses
   it without saying it.
7. For each ASSUMED item write ON LIST when it follows from what the reader surely knows, and
   NOT ON LIST otherwise. Do not excuse an item because the reader probably knows it: what is not
   on the list is NOT ON LIST.
8. For each NOT ON LIST item write BLOCKS when a step of the board cannot be followed without it
   (a branch whose condition is never said, a step whose reason is missing, a value that cannot
   be checked), and DETAIL when the board still reads without it.

Answer in <the board's language>, briefly: the four answers of Part A; then for Part B one line
per item (step, what it assumes, STATED with its quote or ASSUMED, ON LIST or NOT ON LIST, and
BLOCKS or DETAIL); then the BLOCKS items in the order the reader meets them, each as one line of
plain words that would close the gap.
```

A set of boards read in order gets one reviewer for the whole set, the images listed in reading
order; an item counts as STATED when the board being read, or an earlier one of the set, says it.

**Why Part B.** The reviewer is a model that understands every word on the board. Asked what it
did not understand, it answers "nothing" or names a jargon word, and the board passes. The holes
that stop a reader are rarely words: a cause tree that never says authorize and capture are two
separate calls has no unknown word on it, yet a reader cannot see why a card that was accepted is
declined later. Asked what the board takes for granted, a reviewer lists exactly that. It is a
question an expert answers well, and the reviewer is the expert in the room.

## 3. Act on the answers

Compare each answer with what you meant:

- **Answer 2 against the question.** Read it against the one-sentence restatement of step 1 of
  the skill. If it misses the point or says something false, the board fails as a whole: change
  its structure (the shape, the groups, which node comes first, a split), not its wording.
- **Answer 1 against the order you intended.** A different order means the layout, the groups or
  the edges do not lead the eye: an edge between two steps is missing, a group holds two stages
  that should be apart, or the start node is not where the reader starts. Fix the structure, not
  the labels.
- **Answer 3: unknown words.** Every word listed there gets a plain gloss of a few words on the
  board or is replaced with the everyday word, as the term list of step 1 says. A gloss that the
  reader needs to follow the board goes in the label or in a `fact` node, not in `detail`, which
  the image does not show. A "typo" may be the reviewer's own misreading of the drawing: check
  the board before fixing it.
- **Answer 4: unrelated parts.** That node or group gets an edge to what it explains, or goes.
- **Answers 5 to 8: what the board takes for granted.** Every BLOCKS item is a hole, and a worse
  one than an unknown word, because the reader cannot look up what the board never names. Close
  it with a `fact` node beside the step that needs it, citing the line it rests on (the premise
  list of step 3 of the skill), or drop the step when it is a detail the question does not need.
  A DETAIL item gets one line in the node's `detail` when one line is enough; the rest go in the
  report as premises left out, where the person who asked can correct them.
- **Never invent an answer the code does not give.** A BLOCKS item the code cannot answer (why a
  limit is 5, when no comment or document says) becomes a `question` node naming who must answer
  it, and is named in the report. It is not closed by a plausible reason.
- **A narrow "surely knows" list.** Many DETAIL items the reader clearly knows (a developer on the
  project knows the project has a database) mean the list was written too narrowly: widen the item
  that covers them, say so in the report, and read the board against the new list.

Every change is a change to the IR: render it again with the source check (step 5 of the skill),
repair it, draw the image again, and ask a **new** reviewer. The first one has now seen the
answer and can no longer read the board fresh; never send the second round to the same subagent.

**When BLOCKS go deeper each round, split.** When a second round still lists BLOCKS items, each
one deeper than the last (the reason, then the reason of the reason), stop adding nodes. One board
is carrying a mechanism that needs room of its own: split it into a set as "Split rather than
crowd" in step 1 of the skill says, give the reason its own board, and link the boards through the
ref they share. Facts added to one crowded board end up as the smallest text, exactly where the
reader needs them.

**Stop** when the last reviewer lists no BLOCKS item, or only BLOCKS items the code cannot answer
(each one a `question` node on the board).

## 4. With no subagent

When no subagent can be started, ask the person who gave the task the four questions of Part A,
with the image (or the text of the board) in front of them, and do Part B yourself: walk the
board step by step with the "surely knows" list open. Say in the report that Part B was done by
the agent that drew the board, which is the weakest of the three ways, since you know what every
node means.
