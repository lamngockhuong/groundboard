---
type: regex
target: { source: file, path: .groundboard/after-order-placed.board.json }
pattern: '\{(?=[^{}]*"kind"\s*:\s*"question")(?=[^{}]*paid)(?=[^{}]*\([^)]+\))[^{}]*\}'
weight: 1
---
