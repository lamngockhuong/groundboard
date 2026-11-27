---
tags: [board, pm-reader]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]
---

Our product manager asked: until when can a customer cancel an order, and when can they only get a refund instead?
They never read code; they know the order screens and the order statuses customers see.
Draw them a board that answers the question from this repository.

Name the output `order-refunds`: write the board to `.groundboard/order-refunds.board.json`, render it with the source check to `.groundboard/order-refunds.excalidraw`, and save an image of the board at `.groundboard/order-refunds.png`.
groundboard and its PNG renderer are installed in this repository (`npx groundboard --help`); there is no network access.
Nobody can answer questions while you work.
