---
name: "learned-codemap-generator-hygiene"
description: "Use when you are adding or updating a codemap generator for a frontend Angular repo."
version: "1.0.0"
source: "continuous-learning"
status: "approved"
learned_from: "skills/learned/learned-codemap-generator-hygiene.md"
---

# Codemap Generator Hygiene (Frontend)

Extracted: 2026-02-24
Source: session extraction

## Overview

Patterns for maintaining a codemap generator that stays useful over time.

## Trigger

You are adding or updating a codemap generator for a frontend Angular repo.

## Actions

### 1) Generate high-signal maps (not file inventories)

Prefer maps that answer:

- where is the screen wired? (routing)
- where are providers composed? (providers)
- what is the facade/use-case entry? (application)
- where is state/caching? (state)
- what is the cross-context surface? (public APIs)

### 2) Keep outputs stable

Avoid volatile metrics and noisy diffs:

- sort lists
- cap samples
- avoid per-file line counts

### 3) Use domain-accurate taxonomy

Do not introduce misleading subsystem names (for example "database" or "backend" in a frontend app).

### 4) Treat generated outputs as an atomic set

If one generated file is wrong, fix the generator and regenerate the whole set.
Do not partially delete generated outputs (INDEX + links will drift).

### 5) Make the generator reproducible

- pin the runner in devDependencies
- add an npm script
- commit the generated docs if they are expected to be consumed by agents

## Example snippet (heuristic extraction)

Use regex-based extraction when speed and determinism matter (no AST required):

```ts
// loadChildren targets
extractRegexAll(
  content,
  /loadChildren\s*:\s*\(\)\s*=>\s*import\(['\"]([^'\"]+)['\"]\)/g,
);

// providers attached to routes
extractRegexAll(content, /(provide[A-Za-z0-9_]+\(\))/g);
```

## Caveats

- Heuristics can miss edge cases; keep curated architecture docs alongside generated maps.
- If generator output becomes too large, add more focused maps instead of increasing caps.
