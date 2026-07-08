# Bounded Context Mapping & One-File-Per-BC Convention

Convention: One OpenAPI YAML per bounded context (BC), independently publishable to SmartBear SwaggerHub.

---

## Why One File Per BC

- **Independent versioning**: Each BC evolves at its own pace; no monolithic spec to coordinate.
- **Team ownership**: One team owns one API spec file; clear responsibility.
- **SwaggerHub cataloguing**: Each BC publishes as a separate API in your organization; discoverable and separately documented.
- **Minimal $ref coupling**: Avoid cross-file `$ref` (instead, duplicate small shared schemas or use composition within a file).
- **Fast review**: Spec PRs are scoped per domain; easier to review and approve.

---

## Deriving Bounded Contexts from Clean Architecture Repos

### From a .NET Clean-Architecture Codebase

A typical modular monolith layout:

```
api/
├── Module/
│   ├── UserModule/
│   │   ├── Core/              # Domain models, use cases
│   │   ├── Application/       # HTTP endpoints
│   │   └── Infrastructure/    # Repositories, adapters
│   ├── OrderModule/
│   ├── PaymentModule/
│   └── ReportingModule/
├── Core/                      # Shared kernel
├── Infrastructure/            # Cross-cutting infrastructure
└── Program.cs
```

**Clustering rule**: Each `Module/` folder = one BC.

1. Scan `Module/` subdirectories.
2. For each module, group related aggregates (Domain/Models) and endpoints (Application/Endpoint/).
3. Create one `<module-name>.openapi.yaml` in `api-specs/`.

**Example mapping:**

| Module | BC | OpenAPI File | SwaggerHub API Name |
|--------|----|----|---|
| `UserModule/` | User Management | `api-specs/user-management.openapi.yaml` | `user-management-api` |
| `OrderModule/` | Order Fulfillment | `api-specs/order-fulfillment.openapi.yaml` | `order-fulfillment-api` |
| `PaymentModule/` | Payment Processing | `api-specs/payment-processing.openapi.yaml` | `payment-processing-api` |
| `ReportingModule/` | Analytics & Reporting | `api-specs/analytics-reporting.openapi.yaml` | `analytics-reporting-api` |

### From an Angular/TypeScript Monorepo

If organized by feature:

```
libs/
├── user/                  # User BC
│   ├── domain/
│   ├── application/
│   └── presentation/
├── order/                 # Order BC
├── payment/               # Payment BC
└── shared/                # Cross-cutting
```

**Clustering**: Each `libs/<feature>/` = one BC.

---

## Naming Convention

### Directory & File Naming

```
api-specs/
├── user-management.openapi.yaml
├── order-fulfillment.openapi.yaml
├── payment-processing.openapi.yaml
└── analytics-reporting.openapi.yaml
```

- **kebab-case** file names (lowercase, hyphens).
- **Suffix: `.openapi.yaml`** (not `.swagger.yaml` or `.yaml`).
- Files live in `api-specs/` folder at repo root or in a `docs/api-specs/` folder.

### SwaggerHub Naming

When publishing to SwaggerHub, create an API per BC:

**SwaggerHub API Name** (kebab-case, reflects BC):
- `user-management-api`
- `order-fulfillment-api`
- `payment-processing-api`

**Versioning on SwaggerHub**: Start at `1.0.0` (SemVer). Bump major on breaking changes, minor on additive changes, patch on fixes.

---

## BC-Name to SwaggerHub Mapping Table

Keep this table in your project README or docs for discoverability:

```markdown
| Bounded Context | OpenAPI File | SwaggerHub Owner | SwaggerHub API | Current Version |
|---|---|---|---|---|
| User Management | `user-management.openapi.yaml` | `acme-org` | `user-management-api` | 1.0.0 |
| Order Fulfillment | `order-fulfillment.openapi.yaml` | `acme-org` | `order-fulfillment-api` | 2.1.0 |
| Payment Processing | `payment-processing.openapi.yaml` | `acme-org` | `payment-processing-api` | 1.3.0 |
| Analytics & Reporting | `analytics-reporting.openapi.yaml` | `acme-org` | `analytics-reporting-api` | 1.0.0 |
| Notifications | `notifications.openapi.yaml` | `acme-org` | `notifications-api` | 1.1.0 |
```

Update this table when adding or versioning an API.

---

## Reconcile with the Published Catalog

Before finalizing the BC → file list and API names, check what's already on SwaggerHub:

1. **List published APIs** under your SwaggerHub organization/owner (when the agent discovers via MCP).
2. **Cross-map** published API names and versions against your BCs:
   - If an API exists on SwaggerHub with the same name, **reuse it** (don't create a duplicate under a different name).
   - Update the BC-to-API mapping table above to reflect existing published versions.
   - If a published API is **not in your domain model**, note it as an orphan (possible drift) — the agent surfaces this for user awareness.
3. **Avoid naming collisions**: Ensure your BC names align with existing published API identifiers. Example:
   - If `user-accounts-api` is already on SwaggerHub, don't publish as `user-management-api` for the same domain concept.
4. **Version consistency**: If updating an existing API, follow SemVer:
   - Major bump: Breaking changes (e.g., removed endpoint, renamed required field).
   - Minor bump: Additive changes (e.g., new endpoint, new optional field).
   - Patch bump: Fixes only (e.g., schema clarification, doc improvements).

The agent will present a reconciliation summary (new / update / orphan) during the confirmation gate; use this to review alignment before publication.

---

## Shared Schemas: Duplication vs. $ref

### When to Duplicate

Small, often-reused schemas (Problem, Link, CursorPage, timestamps) should be **duplicated per BC file** for independence:

```yaml
# api-specs/user-management.openapi.yaml
components:
  schemas:
    Problem:
      $ref: "..."  # Inline or local

# api-specs/order-fulfillment.openapi.yaml
components:
  schemas:
    Problem:
      $ref: "..."  # Identical copy
```

**Why**: Each BC spec must be self-contained. A consuming tool (like SwaggerHub) should not require resolving references to another BC's file.

### ⚠️ When to Use `$ref` (Cross-BC) — Local Only, Not SwaggerHub-Compatible

If you have a **truly shared contract** (e.g., a published event schema used by multiple BCs), you may define it in a shared file:

```yaml
# api-specs/shared/integration-events.openapi.yaml
components:
  schemas:
    UserCreatedEvent:
      type: object
      properties:
        user_id: { type: string }
        created_at: { type: string, format: date-time }

# api-specs/user-management.openapi.yaml
components:
  schemas:
    UserCreatedEvent:
      $ref: "shared/integration-events.openapi.yaml#/components/schemas/UserCreatedEvent"
```

> **Warning:** This pattern works for local development and preview but will **fail on SwaggerHub**, which cannot resolve cross-file `$ref`s. For SwaggerHub publication, always inline or duplicate shared schemas per BC file.

---

## Example: User Management BC Spec

```yaml
# api-specs/user-management.openapi.yaml

openapi: 3.1.0
info:
  title: "User Management API"
  version: "1.0.0"
  description: "REST API for user account management, profiles, and authentication."
  contact:
    name: "User Team"
    email: "user-team@acme.com"

servers:
  - url: "https://api.acme.com"
    description: "Production"

tags:
  - name: "User Accounts"
    description: "User account lifecycle"
  - name: "User Profiles"
    description: "User profile data"

paths:
  /v1/users:
    get:
      operationId: "listUsers"
      tags: ["User Accounts"]
      summary: "List users"
      parameters:
        - $ref: "#/components/parameters/CursorParam"
        - $ref: "#/components/parameters/LimitParam"
      responses:
        "200":
          description: "Users list"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserPage"
        "500":
          $ref: "#/components/responses/Problem500"

    post:
      operationId: "createUser"
      tags: ["User Accounts"]
      summary: "Create user"
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUserRequest"
      responses:
        "201":
          description: "User created"
          headers:
            Location:
              schema:
                type: string
        "422":
          $ref: "#/components/responses/Problem422"

components:
  parameters:
    CursorParam:
      name: cursor
      in: query
      schema:
        type: string
      required: false

    LimitParam:
      name: limit
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      required: false

  responses:
    Problem422:
      description: "Unprocessable Entity"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem500:
      description: "Internal Server Error"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

  schemas:
    Problem:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
        title:
          type: string
        status:
          type: integer
        detail:
          type: string

    CreateUserRequest:
      type: object
      required: [email, name]
      properties:
        email:
          type: string
          format: email
        name:
          type: string

    UserResponse:
      type: object
      required: [id, email, name, created_at]
      properties:
        id:
          type: string
        email:
          type: string
        name:
          type: string
        created_at:
          type: string
          format: date-time

    UserPage:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/UserResponse"
        _links:
          type: object
```

---

## Publishing to SwaggerHub

### MCP Integration

When the `smartbear-swagger` MCP is connected, the agent will:

1. Discover each BC's OpenAPI file.
2. Infer the SwaggerHub API name from the BC name.
3. Push/update each spec to SwaggerHub under the specified owner and organization.
4. Report the resulting SwaggerHub URLs.

### Pre-Publish Checklist

Before running `/api-spec` to publish:

- [ ] All YAML files in `api-specs/` are valid OpenAPI 3.1.
- [ ] Spectral or Redocly linting passes.
- [ ] Zalando checklist items are verified.
- [ ] BC-to-API-name mapping is clear (ask the agent if unsure).
- [ ] SwaggerHub credentials/organization is known.

---

## Workflow Summary

1. **Identify BCs** in your codebase (one Module/feature = one BC).
2. **Create `api-specs/<bc-name>.openapi.yaml`** per BC.
3. **Fill each spec** with paths, schemas, and Zalando conventions.
4. **Validate** with Spectral or Redocly.
5. **Publish** to SwaggerHub via the agent (when MCP connected).
6. **Maintain mapping** in a table for discoverability.

---

## Summary

- **One file per BC** — independent, versioned, publishable.
- **Name: `<bc-name>.openapi.yaml`** in kebab-case.
- **Duplicate small shared schemas** per file (not cross-file $ref for SwaggerHub).
- **SwaggerHub API name** derived from BC name.
- **Maintain a BC-to-SwaggerHub mapping** for discoverability.
