---
type: llm
focus: { source: file, path: .groundboard/signup-flow.png }
weight: 2
---

You understand software, so do not judge whether you could follow the image: a reader who understands every word cannot tell what a real reader lacks.
Judge what the board takes for granted.
Walk the image in reading order, box by box and arrow by arrow.
At each step write what the reader must already accept for the step to make sense: a term, a rule of how a part normally works, a relation between two things the board names, the meaning of an arrow or a mark.
The reader is the client who wrote the signup brief: they do not read code, know their own brief and the words in it, and want to check the flow before it is built.
PASS if every such item is said on the image in words that reader knows, or the board still reads without it.
FAIL if a step cannot be followed without an item the image never says (a branch whose condition is never said, a step whose reason is missing, a value that cannot be checked), even when every word on the image has a gloss.
