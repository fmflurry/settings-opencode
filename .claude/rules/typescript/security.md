---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Security

> This file extends [common/security.md](../common/security.md) with TypeScript/JavaScript specific content.

## Secret Management

A secret scanner owns hardcoded keys. Read secrets from the environment and fail startup when a required one is missing.

why-not-tooled: which secrets are required at startup is app-specific.

## Agent Support

- Use **security-reviewer** skill for comprehensive security audits
