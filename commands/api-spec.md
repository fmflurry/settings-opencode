---
description: Generate Zalando-compliant OpenAPI 3.1 specs (one per bounded context) and publish to SmartBear SwaggerHub
---

# API Spec Command

Routing to the `api-spec-architect` subagent is handled by the `agent:` field on this command in `opencode.jsonc` — no manual delegation needed.

Generate and publish OpenAPI 3.1 specifications for: $ARGUMENTS

---

## Workflow at a Glance

1. **Discover bounded contexts** from your domain model (code-memory).
2. **Discover published APIs on SwaggerHub** (if MCP connected): List existing published APIs and check for drift (APIs on SwaggerHub not in your domain model).
3. **Reconcile**: Cross-map domain BCs against published APIs (identify new, update, and orphan APIs).
4. **Generate one `<bc>.openapi.yaml` per BC** in `api-specs/` folder, following Zalando conventions (kebab-case, snake_case, cursor pagination, RFC 9457 errors).
5. **Validate** with Spectral or Redocly linting.
6. **Confirmation gate** (if MCP connected): Review reconciliation summary (new / update / orphan) before publishing.
7. **Publish/update** each API to SwaggerHub (optional; requires MCP + credentials + user confirmation).
8. **Report** spec locations, URLs, and reconciliation summary.

---

## Arguments

```
/api-spec [options] [bounded-contexts-or-path]

Options:
  --output-dir <path>       Output directory for specs (default: api-specs/)
  --generate-only           Generate specs only; skip SwaggerHub push
  --bc-list <list>          Explicit comma-separated BC names (e.g., "user-management,order-fulfillment,payment-processing")
  --swagger-org <name>      SwaggerHub organization name
  --swagger-owner <email>   SwaggerHub owner email
  --swagger-base-url <url>  SwaggerHub base URL (default: https://app.swaggerhub.com)

Examples:
  /api-spec                                  # Discover BCs and generate specs
  /api-spec --generate-only                  # Generate only (skip push)
  /api-spec --bc-list "users,orders,payments"  # Explicit BC names
  /api-spec --output-dir docs/api-specs/    # Custom output directory
  /api-spec --swagger-org acme-corp          # Set SwaggerHub org
```

---

## Preflight Requirements

### Before Running `/api-spec`

- [ ] **Codebase indexed**: Code is in a recognized git repo with a project structure (Angular, .NET, or other domain-driven codebase).
- [ ] **SwaggerHub account** (if publishing): Organization name, owner email, and API-level access.
- [ ] **MCP connection** (if discovering and publishing): the `smartbear-swagger` MCP server must be `enabled: true` and reachable in `opencode.jsonc` (`mcp.smartbear-swagger`). Otherwise, use `--generate-only` to skip discovery and publication.
  - When the MCP is connected, `smartbear-swagger_*` tools appear directly in the agent's tool list — the agent inspects them to discover published APIs, reconciles them against your domain model, and surfaces new/update/orphan APIs before publication.
  - When the MCP is not connected, specs are generated only; publication is skipped.
- [ ] **Validation tools** (recommended): Install Spectral (`npm install -g @stoplight/spectral-cli`) or Redocly (`npm install -g @redocly/cli`). If absent, validation is skipped (reported in output).

### SwaggerHub Publication

Publishing to SwaggerHub requires:
- **Organization exists** on SwaggerHub (you must have created it).
- **Owner email** with API edit permissions.
- **`smartbear-swagger` MCP connected** with credentials.
- If any of these are missing, use `--generate-only` to skip publication; push specs manually via the SwaggerHub web UI.

---

## Output

### Specs Generated

One `.openapi.yaml` file per bounded context in `api-specs/` (or `--output-dir`):

```
api-specs/
├── user-management.openapi.yaml        (v1.0.0)
├── order-fulfillment.openapi.yaml      (v2.0.0)
├── payment-processing.openapi.yaml     (v1.0.0)
└── analytics-reporting.openapi.yaml    (v1.0.0)
```

Each spec is **self-contained, independently publishable, and Zalando-compliant**:
- **Naming**: Paths in kebab-case, JSON properties in snake_case.
- **Pagination**: Cursor-based (`?cursor=`, `?limit=`); no offset/page.
- **Errors**: RFC 9457 Problem+JSON on all 4xx/5xx.
- **Versioning**: URL major version (`/v1/`, `/v2/`); SemVer in `info.version`.
- **Idempotency**: `Idempotency-Key` header on POST; PUT/DELETE inherently idempotent.
- **Security**: OAuth2 or Bearer token; per-operation security rules.

### Validation Output

Spectral or Redocly linting results. Example:

```
/Users/example/api-specs/user-management.openapi.yaml
  10:5   warning  Consider adding a x-summary tag  oas3-valid-schema
  ✓ 0 errors, 1 warning (pass)

/Users/example/api-specs/order-fulfillment.openapi.yaml
  ✓ 0 errors, 0 warnings (pass)
```

### SwaggerHub Publication (If MCP Connected)

On successful push, each spec is published with a URL and reconciliation summary:

```
## Reconciliation Summary
| API | Status | Action | Old Version | New Version |
|---|---|---|---|---|
| user-management-api | New | Created | — | 1.0.0 |
| order-fulfillment-api | Update | Published | 1.2.0 | 2.0.0 |
| payment-processing-api | New | Created | — | 1.0.0 |
| legacy-billing-api | Orphan | Kept as-is | 0.9.0 | 0.9.0 |

## Published URLs
✓ user-management-api@1.0.0
  https://app.swaggerhub.com/apis/acme-org/user-management-api/1.0.0

✓ order-fulfillment-api@2.0.0
  https://app.swaggerhub.com/apis/acme-org/order-fulfillment-api/2.0.0

✓ payment-processing-api@1.0.0
  https://app.swaggerhub.com/apis/acme-org/payment-processing-api/1.0.0
```

Each URL can be shared with API consumers for documentation and testing via SwaggerHub's interactive UI. Orphan APIs remain unchanged on the catalog.

---

## Confirmation Gate

**Important**: Before publishing to SwaggerHub, the agent will present a reconciliation summary (when MCP is connected):

```
## Bounded Contexts Detected
1. User Management
2. Order Fulfillment
3. Payment Processing
4. Analytics & Reporting

## SwaggerHub Reconciliation
| Bounded Context | Status | Action | Published Version |
|---|---|---|---|
| User Management | New | Create | — |
| Order Fulfillment | Update | Bump to v2.0.0 | 1.2.0 |
| Payment Processing | New | Create | — |
| Analytics & Reporting | Update | Bump to v1.1.0 | 1.0.0 |
| Legacy Billing | Orphan | Keep as-is | 0.9.0 |

**Status Legend:**
- New: Domain model BC not yet on SwaggerHub (will be created).
- Update: Domain model BC found on SwaggerHub (will be updated).
- Orphan: API published on SwaggerHub but not in domain model (not modified; for your awareness).

**Proceed with publication? (yes/no/modify)**
```

You **MUST confirm** before any specs are pushed to SwaggerHub. This safeguard ensures:
- No accidental creation of duplicate APIs.
- Orphan APIs (possible drift) are visible before changes.
- Version bumps are deliberate.

---

## Troubleshooting

### "Specs validated but SwaggerHub MCP not connected"

**Solution**: Ensure the `smartbear-swagger` MCP is available. Check `opencode.jsonc` → `mcp.smartbear-swagger.enabled`, and confirm `smartbear-swagger_*` tools appear in the agent's tool list.

If not connected, either:
- Set `mcp.smartbear-swagger.enabled: true` in `opencode.jsonc` and restart the session.
- Or use `--generate-only` and publish manually via SwaggerHub web UI.

### "Validation failed: multiple errors"

**Solution**: The agent will report validation errors and loop until fixed. Common fixes:

| Error | Fix |
|-------|-----|
| "Paths should start with /v" | Add `/v1` prefix: `/v1/users` not `/users` |
| "Field names must be snake_case" | Rename `userId` → `user_id` |
| "Use cursor pagination" | Change `?offset=` to `?cursor=` |
| "POST must return 201 with Location" | Add `201` response with Location header |

### "BC boundaries unclear"

**Solution**: Confirm bounded context list before running. For .NET Clean Architecture, one `Module/` folder = one BC. For Angular, one `libs/<feature>/` = one BC. Ask the agent if unsure:

```
/api-spec --bc-list "users,orders,payments"
```

---

## Comparison: API Spec Workflows

| Task | Command | Notes |
|------|---------|-------|
| **Generate specs only** | `/api-spec --generate-only` | No SwaggerHub discovery or publication; specs in `api-specs/` |
| **Generate + validate** | `/api-spec --generate-only` | Spectral/Redocly linting included; no SwaggerHub reconciliation |
| **Generate + discover + publish** | `/api-spec` | Full workflow: discover published APIs, reconcile, get user approval, publish; requires SwaggerHub MCP + confirmation |
| **Update existing specs** | `/api-spec` | Agent discovers published APIs, reconciles against domain model, and publishes updates |
| **Custom output dir** | `/api-spec --output-dir docs/api-specs/` | Specs written to alternate location; reconciliation (if MCP connected) still applies |
| **Explicit BC list** | `/api-spec --bc-list "users,payments"` | Skip auto-discovery; use provided names; reconciliation against published APIs still occurs (if MCP connected) |

---

## Reference

- **Skill**: [api-spec-openapi](../skills/api-spec-openapi/SKILL.md) — Zalando conventions, templates, validation.
- **Agent prompt**: [api-spec-architect.txt](../prompts/agents/api-spec-architect.txt) — Orchestrates the workflow.
- **Zalando Checklist**: [zalando-checklist.md](../skills/api-spec-openapi/zalando-checklist.md) — Verifiable rules per section.
- **OpenAPI 3.1 Guide**: [openapi-3.1-template.md](../skills/api-spec-openapi/openapi-3.1-template.md) — Templates and idioms.
- **Error Model**: [problem-json.md](../skills/api-spec-openapi/problem-json.md) — RFC 9457 Problem schema.
- **Validation**: [validation.md](../skills/api-spec-openapi/validation.md) — Spectral, Redocly, SwaggerHub fallback.

---

## Key Points

✓ **One file per BC** — independent, versioned, publishable.
✓ **Zalando-compliant** — kebab-case paths, snake_case JSON, cursor pagination, RFC 9457 errors.
✓ **Validated** — Spectral/Redocly linting before reporting done.
✓ **SwaggerHub-ready** — Each spec published as a separate API (if MCP connected).
✓ **User-confirmed** — Confirmation gate before publication to shared catalog.
