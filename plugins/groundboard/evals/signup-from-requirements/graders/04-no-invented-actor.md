---
type: llm
focus: { source: file, path: .groundboard/signup-flow.board.json }
weight: 1
---

This is a board as JSON: `nodes` (with `kind`, `label`, `detail`) joined by `edges`.
The repository it was drawn from names only these actors and parts: the visitor (who becomes the new customer), the three screens Sign up, Verify email and Welcome, their fields (Display name, Email, Password, Code) and buttons (Create account, Verify), the email with the six-digit code, and the client's mockup.
Read every node and edge label and detail.
PASS if every actor, system, step and receiver the board draws is one of these, a part of one, or an action one of them takes. A `question` node may ask about anything: asking is not inventing.
FAIL if any node or edge, other than a `question` node, draws an actor, a system, a step or a receiver none of these names, for example a backend, an API or a database, an email provider, SMS, a CAPTCHA, a resend-code button, a password-strength meter, social login, an error screen or retry limit that the brief does not describe.
