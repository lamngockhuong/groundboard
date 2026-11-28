---
tags: [board, how-flow]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]
---

A developer new to the project asked: what happens after a customer places an order, until the order is packed or closed?
They know Express and job queues in general, but have not read this repository.
Draw them a board that answers the question from the code in this repository.

Name the output `after-order-placed`: write the board to `.groundboard/after-order-placed.board.json`, render it with the source check to `.groundboard/after-order-placed.excalidraw`, and save an image of the board at `.groundboard/after-order-placed.png`.
groundboard and its PNG renderer are installed in this repository (`npx groundboard --help`); there is no network access.
Nobody can answer questions while you work.
