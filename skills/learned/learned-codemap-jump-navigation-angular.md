# Codemap Jump Navigation (Angular)

Extracted: 2026-02-24
Source: session extraction

## Overview

Use codemaps as a jump-table to move from a user-facing screen to the code that wires it:
routes -> providers -> facade/use-case -> ports/adapters -> stores/proxies.

This is optimized for repos that use:

- standalone Angular routing (`routes.ts`)
- provider factories (`*providers.ts`)
- clean/hex layers (presentation/application/domain/infrastructure)

## Trigger

You need to debug or extend a feature and the repo is too large for ad-hoc grepping.

## Action

Start at the codemap index and follow the focused maps in order.

## Steps

1. Open `docs/CODEMAPS/INDEX.md`
2. Find the relevant route entry in `docs/CODEMAPS/ROUTING.md`
   - note lazy imports (`loadChildren`, `loadComponent`)
   - note provider calls attached to routes (`provide*()`)
3. Find provider wiring in `docs/CODEMAPS/PROVIDERS.md`
   - locate the `*providers.ts` or `*-service.providers.ts` file
   - look for cross-context wiring hints (`AppContext.*`)
4. Identify API surface via `docs/CODEMAPS/PUBLIC-APIS.md` (ports + provider factories)
5. Identify orchestration logic via `docs/CODEMAPS/APPLICATION.md` (facades + use-cases)
6. Identify state and caching via `docs/CODEMAPS/STATE.md` (stores + session proxies)
7. Sanity-check layer presence via `docs/CODEMAPS/LAYERS.md`

## Example

Regenerate the maps before a deep investigation:

```bash
npm run codemaps:generate
```

## Caveats

- The routing/providers extraction is heuristic; treat it as a shortlist, not ground truth.
- Prefer the curated docs for intent/architecture: `docs/CODEMAPS/ARCHITECTURE.md`, `docs/CODEMAPS/MODULES.md`, `docs/CODEMAPS/FILES.md`.
