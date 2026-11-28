---
type: regex
target: { source: file, path: .groundboard/order-refunds.board.json }
pattern: '\{(?=[^{}]*"kind"\s*:\s*"question")(?=[^{}]*[Rr]estock)(?=[^{}]*\([^)]+\))[^{}]*\}'
weight: 1
---
