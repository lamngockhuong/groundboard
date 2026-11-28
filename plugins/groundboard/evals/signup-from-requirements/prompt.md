---
tags: [board, from-requirements]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]
---

The client sent us their signup brief, `docs/requirements.md`; nothing is built yet.
Draw the signup flow from the requirements, so the client can check it is what they meant before we build it.
The client does not read code.

Name the output `signup-flow`: write the board to `.groundboard/signup-flow.board.json`, render it with the source check to `.groundboard/signup-flow.excalidraw`, and save an image of the board at `.groundboard/signup-flow.png`.
groundboard and its PNG renderer are installed in this repository (`npx groundboard --help`); there is no network access.
Nobody can answer questions while you work.
