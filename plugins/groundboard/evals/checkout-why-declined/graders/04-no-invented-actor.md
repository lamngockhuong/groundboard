---
type: llm
focus: { source: file, path: .groundboard/checkout-declined.board.json }
weight: 1
---

This is a board as JSON: `nodes` (with `kind`, `label`, `detail`) joined by `edges`.
The repository it was drawn from names only these actors and parts: the customer and their cart (and guest carts), `checkout()`, the payment gateway with its three calls (authorize, capture, void), the stock reservation (`reserveStock`) with its stock counts, other customers who could buy the stock, refunds and their fee (the reason the team rejected capturing at order time), and Product, who has not decided on guest checkout.
Read every node and edge label and detail.
PASS if every actor, system, step and receiver the board draws as a node or an edge is one of these, a part of one, or an action one of them takes. A `question` node may ask about anything: asking is not inventing. Words that explain one of these to the reader, such as "the bank refuses the card" for what a declined card or a failed authorize means, are not a new actor as long as the board draws no step for them.
FAIL if any node or edge, other than a `question` node, draws as its own step or receiver an actor, a system or an action none of these names, for example a fraud check, a call to the bank, an email or notification, a retry, a webhook, a queue, a warehouse worker.
