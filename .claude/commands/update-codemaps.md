---
description: Generate architectural codemaps for the current project
---

Run the codemap generator script to scan the current working directory and generate documentation under `docs/CODEMAPS/`.

```bash
npx tsx ~/.config/opencode/scripts/codemaps/generate.ts
```

Output files:
- `INDEX.md` — Full overview with repository structure
- `frontend.md` — UI components, pages, hooks
- `backend.md` — API routes, controllers, middleware
- `database.md` — Models, schemas, migrations
- `integrations.md` — External services & adapters
- `workers.md` — Background jobs, queues, cron tasks

You can optionally pass a source directory argument:

```bash
npx tsx ~/.config/opencode/scripts/codemaps/generate.ts ./src
```

After generation, review the output and suggest improvements if the classification missed important project-specific directories.
