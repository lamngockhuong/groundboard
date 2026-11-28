---
tags: [board, cause-tree]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]
---

A developer who joined the team this week asked: why can a checkout come back declined after the customer's card was already authorized?
They know TypeScript and how card payments look from the outside, but they have not read this repository.
Draw them a board that answers the question from the code in this repository.

Name the output `checkout-declined`: write the board to `.groundboard/checkout-declined.board.json`, render it with the source check to `.groundboard/checkout-declined.excalidraw`, and save an image of the board at `.groundboard/checkout-declined.png`.
groundboard and its PNG renderer are installed in this repository (`npx groundboard --help`); there is no network access.
Nobody can answer questions while you work.
