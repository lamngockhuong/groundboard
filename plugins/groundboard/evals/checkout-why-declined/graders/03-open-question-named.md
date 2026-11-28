---
type: regex
target: { source: file, path: .groundboard/checkout-declined.board.json }
pattern: '\{(?=[^{}]*"kind"\s*:\s*"question")(?=[^{}]*\([^)]+\))[^{}]*\}'
weight: 1
---
