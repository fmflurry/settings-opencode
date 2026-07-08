---
name: api-spec-openapi
description: Generate OpenAPI 3.1 specs that follow the Zalando RESTful API Guidelines (kebab-case naming, cursor pagination, RFC 9457 problem+json errors, URL versioning, idempotency), one YAML file per bounded context/domain. Use when authoring, updating, or reviewing an OpenAPI/Swagger specification, or when preparing specs to push to SmartBear SwaggerHub.
---

# OpenAPI 3.1 + Zalando REST API Guidelines Skill

## When to Activate

- Authoring a new OpenAPI 3.1 specification from domain models
- Updating an existing OpenAPI spec to align with Zalando conventions
- Reviewing specs for API naming, error handling, pagination, versioning, or idempotency compliance
- Preparing specs for publication to SmartBear SwaggerHub
- Designing API contracts for a bounded context or microservice

## Core Rules Digest (Zalando-Derived)

The highest-value Zalando rules are embedded below. Full checklist with verifiable YAML snippets: [zalando-checklist.md](zalando-checklist.md).

### 1. **Naming**
- Paths: **kebab-case**, lowercase, **plural resource nouns**, no trailing slash.
  ```yaml
  /v1/users
  /v1/market-searches/{id}
  /v1/order-items
  ```
- JSON properties: **snake_case** (not camelCase).
  ```yaml
  user_id: string
  created_at: string
  is_active: boolean
  ```

### 2. **HTTP Semantics**
- **GET**: retrieve (200 OK or 404).
- **POST**: create new resource (201 Created, Location header with URI).
- **PUT**: replace entire resource, idempotent (200 or 204).
- **DELETE**: remove resource, idempotent (204 No Content).
- **PATCH**: partial update (not recommended; use PUT or POST instead).
- **Status codes**: Use 200/201/202/204/207/400/401/403/404/409/412/422/429/500. See [zalando-checklist.md § HTTP Status Codes](zalando-checklist.md#http-status-codes) for mappings.

### 3. **Pagination (Cursor-Based, No Offset)**
- Cursor pagination: `?cursor=<opaque-value>&limit=<int>` (default limit 20, max 100).
- **Forbid `?offset=` and `?page=`** — they are inefficient at scale.
- Response envelope includes `_links.next` / `_links.prev` for navigation.
  ```yaml
  items: [...]
  _links:
    next: { href: "https://api.example.com/v1/users?cursor=abc123&limit=20" }
    prev: { href: "https://api.example.com/v1/users?cursor=xyz789&limit=20" }
  ```

### 4. **Errors: RFC 9457 Problem+JSON**
- All 4xx/5xx responses use `application/problem+json` (RFC 9457 / RFC 7807).
- Single reusable `Problem` schema across all endpoints.
  ```yaml
  type: string        # URI identifying problem type (e.g., "https://api.example.com/problems/user-not-found")
  title: string       # Human-readable summary
  status: integer     # HTTP status code
  detail: string      # Details specific to this occurrence
  instance: string    # URI to affected resource
  ```

### 5. **Versioning (URL Major Only)**
- Major versions encoded in URL: `/v1/`, `/v2/`.
- **Preferred within-version evolution**: Additive only (no breaking changes within `/v1`).
- Alternative: Media-type versioning (content negotiation `Accept: application/vnd.example.v1+json`); see [openapi-3.1-template.md](openapi-3.1-template.md).
- **MUST NOT break** existing clients mid-version; bump major version if backward-incompatible.

### 6. **Idempotency**
- **POST (create)**: Require `Idempotency-Key` header (UUID or user-provided).
- **PUT / DELETE**: Inherently idempotent; safe to retry.
- Server returns same response if the same `Idempotency-Key` is submitted.

### 7. **Filtering & Sorting**
- Filtering: Query parameters per resource (`?user_id=123`, `?status=active`).
- Searching: `?q=<query>` for free-text search.
- Sorting: `?sort=field,-field` (ascending by default, `-` prefix for descending).

### 8. **Hypermedia & Links**
- Include `_links` object in responses for navigation (cursor pagination, related resources, actions).
- Standard link relations: `self`, `next`, `prev`, `first`, `last`.

### 9. **Headers & Content Types**
- Default: `application/json`.
- Errors: `application/problem+json`.
- Concurrency: `ETag` / `If-Match` for optimistic locking.
- Retry: `Retry-After` on 429 (rate limit) and 503 (service unavailable).

### 10. **Deprecation**
- Use `Deprecation: true` header in responses.
- Use `Sunset` header with a date when the endpoint will be removed.
- Mark deprecated fields in schema with `deprecated: true`.

### 11. **Security**
- Define `securitySchemes` (e.g., OAuth2, Bearer token).
- Apply security per operation (not globally) for granular control.
- Never include secrets or credentials in examples or default values.

### 12. **One File Per Bounded Context**
- Split the API specification by domain/bounded context.
- Naming: `<bounded-context>.openapi.yaml` in `api-specs/` folder (kebab-case).
- Each BC spec is independently publishable to SwaggerHub; minimize cross-file `$ref`.
- See [bounded-context-mapping.md](bounded-context-mapping.md).

## OpenAPI 3.1 Minimal Skeleton

```yaml
openapi: 3.1.0
info:
  title: "<Bounded Context> API"
  version: "1.0.0"
  description: |
    RESTful API for <bounded context description>.
    Follows Zalando RESTful API Guidelines and RFC 9457 for error responses.
  contact:
    name: "API Support"
    email: "api-support@example.com"
  license:
    name: "MIT"

servers:
  - url: "https://api.example.com"
    description: "Production"

tags:
  - name: "Users"
    description: "User management"
  - name: "Orders"
    description: "Order lifecycle"

paths:
  /v1/users:
    get:
      summary: "List users"
      operationId: "listUsers"
      tags: ["Users"]
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
        "400":
          $ref: "#/components/responses/Problem400"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []

    post:
      summary: "Create user"
      operationId: "createUser"
      tags: ["Users"]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUserRequest"
      parameters:
        - $ref: "#/components/parameters/IdempotencyKeyParam"
      responses:
        "201":
          description: "User created"
          headers:
            Location:
              schema:
                type: string
              description: "URI of created resource"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "400":
          $ref: "#/components/responses/Problem400"
        "409":
          $ref: "#/components/responses/Problem409"
        "422":
          $ref: "#/components/responses/Problem422"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []

components:
  parameters:
    CursorParam:
      name: cursor
      in: query
      description: "Cursor for pagination"
      schema:
        type: string
      required: false

    LimitParam:
      name: limit
      in: query
      description: "Maximum items per page (default 20, max 100)"
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      required: false

    IdempotencyKeyParam:
      name: Idempotency-Key
      in: header
      description: "Unique key for idempotent requests (UUID)"
      schema:
        type: string
        format: uuid
      required: true

    IfMatchHeader:
      name: If-Match
      in: header
      description: "ETag for optimistic concurrency control"
      schema:
        type: string
      required: false

  responses:
    Problem400:
      description: "Bad Request"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem401:
      description: "Unauthorized"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem403:
      description: "Forbidden"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem404:
      description: "Not Found"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem409:
      description: "Conflict"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem422:
      description: "Unprocessable Entity"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem429:
      description: "Too Many Requests"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"
      headers:
        Retry-After:
          schema:
            type: integer
          description: "Seconds to wait before retrying"

    Problem500:
      description: "Internal Server Error"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"


    Problem412:
      description: "Precondition Failed"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Problem503:
      description: "Service Unavailable"
      headers:
        Retry-After:
          schema:
            type: integer
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"
  schemas:
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          description: "URI identifying problem type"
          example: "https://api.example.com/problems/user-not-found"
        title:
          type: string
          description: "Human-readable problem summary"
          example: "User Not Found"
        status:
          type: integer
          description: "HTTP status code"
          example: 404
        detail:
          type: string
          description: "Details specific to this occurrence"
          example: "User with ID 'user-123' does not exist"
        instance:
          type: string
          description: "URI to the affected resource"
          example: "https://api.example.com/v1/users/user-123"

    CursorPage:
      type: object
      required:
        - items
      properties:
        items:
          type: array
          description: "List of items"
        _links:
          type: object
          properties:
            self:
              type: object
              properties:
                href:
                  type: string
            next:
              type: object
              properties:
                href:
                  type: string
            prev:
              type: object
              properties:
                href:
                  type: string

    CreateUserRequest:
      type: object
      required:
        - email
        - name
      properties:
        email:
          type: string
          format: email
        name:
          type: string
        is_active:
          type: boolean
          default: true

    UserResponse:
      type: object
      required:
        - id
        - email
        - name
        - created_at
      properties:
        id:
          type: string
        email:
          type: string
          format: email
        name:
          type: string
        is_active:
          type: boolean
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
        _links:
          type: object
          properties:
            self:
              type: object
              properties:
                href:
                  type: string

    UserPage:
      allOf:
        - $ref: "#/components/schemas/CursorPage"
        - type: object
          properties:
            items:
              type: array
              items:
                $ref: "#/components/schemas/UserResponse"

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: "Bearer token (JWT)"
```

See [openapi-3.1-template.md](openapi-3.1-template.md) for full 3.1 idioms (JSON Schema 2020-12, examples, webhooks) and 3.0 migration notes.

## Error Model: RFC 9457 Problem+JSON

Every API response with status 4xx or 5xx MUST use `application/problem+json` (RFC 9457 / RFC 7807). No ad-hoc error shapes.

- Reusable `Problem` schema (shown above) covers all error responses.
- Extensions: add custom fields as siblings to `type`, `title`, `status`, `detail`, `instance`.

See [problem-json.md](problem-json.md) for full RFC 9457 model, .NET ProblemDetails mapping, and extension patterns.

## Validation Gate (MUST Run Before Done)

Validators (Spectral, Redocly) MUST pass before the spec is declared done.

```bash
# Spectral (recommended for Zalando ruleset)
npx @stoplight/spectral-cli lint api-specs/*.openapi.yaml --ruleset path/to/zalando-ruleset.yaml

# Redocly (OpenAPI 3.1 aware)
npx @redocly/cli lint api-specs/*.openapi.yaml
```

If no validator runs, report it. See [validation.md](validation.md) for setup, fallback options, and invocation patterns.

## References

- [zalando-checklist.md](zalando-checklist.md) — Concrete Zalando-derived checklist with verifiable YAML snippets.
- [openapi-3.1-template.md](openapi-3.1-template.md) — OpenAPI 3.1 shape, JSON Schema 2020-12 idioms, 3.0 vs 3.1 differences, webhooks.
- [bounded-context-mapping.md](bounded-context-mapping.md) — One file per BC convention, clustering heuristics, SwaggerHub cataloguing.
- [problem-json.md](problem-json.md) — RFC 9457 model, extension pattern, .NET ProblemDetails example.
- [validation.md](validation.md) — Spectral/Redocly tooling, invocation, fallback validation.

---

**Key Takeaway**: Zalando specs are **predictable, discoverable, and client-friendly**. Kebab-case paths, snake_case JSON, cursor pagination, problem+json errors, URL versioning, and idempotency form a cohesive contract. One file per BC keeps specs independently publishable and reviewable.
