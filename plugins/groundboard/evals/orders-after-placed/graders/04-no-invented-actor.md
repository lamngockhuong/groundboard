---
type: llm
focus: { source: file, path: .groundboard/after-order-placed.board.json }
weight: 1
---

This is a board as JSON: `nodes` (with `kind`, `label`, `detail`) joined by `edges`.
The repository it was drawn from names only these actors and parts: the customer's request to `POST /orders` and `GET /orders/:id`, the API router, the database tables (`orders`, `order_items`, `products`), the job queue, the `send-receipt` worker and the mail service it calls, the nightly `close-stale-orders` schedule, the `prepare-shipment` handler of the `order.paid` event, the catalog routes, the supplier and the admin console that runs `sync-catalog`.
Read every node and edge label and detail.
PASS if every actor, system, step and receiver the board draws is one of these, a part of one, or an action one of them takes. A `question` node may ask about anything: asking is not inventing.
FAIL if any node or edge, other than a `question` node, draws an actor, a system, a step or a receiver none of these names, for example a payment provider or payment step, a courier, warehouse staff, an SMS or push notification, an inventory or stock service, a cache, a dead-letter queue, a webhook.
