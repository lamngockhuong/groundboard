---
type: llm
focus: { source: file, path: .groundboard/order-refunds.board.json }
weight: 1
---

This is a board as JSON: `nodes` (with `kind`, `label`, `detail`) joined by `edges`.
The repository it was drawn from names only these actors and parts: the customer, the order and its seven statuses (pending, paid, packed, shipped, delivered, cancelled, refunded), the warehouse (which ships or restocks packed orders) and finance (whose reports tell cancelled and refunded apart).
Read every node and edge label and detail.
PASS if every actor, system, step and receiver the board draws is one of these, a part of one, or an action one of them takes. A `question` node may ask about anything: asking is not inventing.
FAIL if any node or edge, other than a `question` node, draws an actor, a system, a step or a receiver none of these names, for example a payment provider, a courier, a support agent, an automatic time limit, an email or notification, a partial refund, an approval step.
