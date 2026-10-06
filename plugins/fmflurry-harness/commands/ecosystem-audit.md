---
description: Audit repository-controlled OpenCode and Claude Code ecosystem parity and coherence
agent: ecosystem-auditor
subtask: true
---

# /ecosystem-audit

Load and use the `ai-ecosystem-audit` skill. Execute this request as the read-only `ecosystem-auditor` specialist:

```text
/ecosystem-audit [--scope=all|parity|skills|agents|commands|config] [--strict] [--relevance=gc-platform|portable]
```

Produce exactly one evidence-first Markdown audit report using the skill's output contract. No preamble or postamble. Do not make changes, delegate, inspect user-home configuration, or audit product-source quality.

$ARGUMENTS
