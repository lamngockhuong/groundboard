---
type: regex
target: { source: file, path: .groundboard/signup-flow.board.json }
pattern: '\{(?=[^{}]*"kind"\s*:\s*"question")(?=[^{}]*[Cc]lient)[^{}]*\}'
weight: 1
---
