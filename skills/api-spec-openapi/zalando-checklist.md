# Zalando RESTful API Guidelines Checklist

Concrete, verifiable rules. Each item includes a checkbox, one-line rule, and YAML snippet for mechanical verification.

---

## Naming

### Paths

- [ ] **kebab-case paths** — no underscores, no CamelCase
  ```yaml
  # GOOD
  /v1/market-searches
  /v1/order-items
  
  # BAD
  /v1/MarketSearches      # CamelCase
  /v1/market_searches     # snake_case
  ```

- [ ] **Lowercase** — paths always lowercase
  ```yaml
  # GOOD
  /v1/users
  
  # BAD
  /v1/Users               # Capitalized
  ```

- [ ] **Plural resource nouns** — `/users`, not `/user`
  ```yaml
  # GOOD
  GET /v1/users           # List all users
  POST /v1/users          # Create a user
  GET /v1/users/{id}      # Get one user
  
  # BAD
  GET /v1/user            # Ambiguous
  POST /v1/user           # Should be plural collection
  ```

- [ ] **No trailing slash** — `/v1/users`, not `/v1/users/`
  ```yaml
  # GOOD
  GET /v1/users
  
  # BAD
  GET /v1/users/
  ```

### JSON Properties

- [ ] **snake_case** — not camelCase, not kebab-case
  ```yaml
  # GOOD
  user_id: string
  created_at: string
  is_active: boolean
  market_search_id: string
  
  # BAD
  userId: string          # camelCase
  created-at: string      # kebab-case
  IsActive: boolean       # Pascal
  ```

---

## HTTP Semantics

### Verb Usage

- [ ] **GET** for retrieval (safe, idempotent, no body)
  ```yaml
  GET /v1/users
  GET /v1/users/{id}
  ```

- [ ] **POST** for creation (201 Created, Location header, idempotent key optional)
  ```yaml
  POST /v1/users
  responses:
    "201":
      headers:
        Location:
          schema:
            type: string
          description: "URI of created resource"
          example: "https://api.example.com/v1/users/user-123"
  ```

- [ ] **PUT** for full replacement (idempotent, 200 or 204)
  ```yaml
  PUT /v1/users/{id}
  requestBody:
    content:
      application/json:
        schema:
          type: object
          properties:
            email: { type: string }
            name: { type: string }
          required: [email, name]
  responses:
    "200":
      description: "User updated"
    "204":
      description: "User updated (no content)"
  ```

- [ ] **DELETE** for removal (idempotent, 204 No Content)
  ```yaml
  DELETE /v1/users/{id}
  responses:
    "204":
      description: "User deleted"
  ```

- [ ] **Avoid PATCH** — use PUT or POST instead (Zalando discourages partial updates)
  ```yaml
  # Discouraged
  PATCH /v1/users/{id}
  
  # Preferred: Full replacement
  PUT /v1/users/{id}
  ```

### HTTP Status Codes

- [ ] **200 OK** — successful GET, PUT, or other safe read
- [ ] **201 Created** — resource created; include Location header
- [ ] **202 Accepted** — async operation queued (e.g., batch import)
- [ ] **204 No Content** — successful DELETE or PUT with no body
- [ ] **207 Multi-Status** — batch operation with mixed success/failure
- [ ] **400 Bad Request** — malformed request (validation error)
- [ ] **401 Unauthorized** — missing or invalid credentials
- [ ] **403 Forbidden** — authenticated but not authorized
- [ ] **404 Not Found** — resource does not exist
- [ ] **409 Conflict** — state conflict (e.g., user already exists)
- [ ] **412 Precondition Failed** — If-Match ETag mismatch
- [ ] **422 Unprocessable Entity** — semantic validation error
- [ ] **429 Too Many Requests** — rate limit exceeded; include Retry-After header
- [ ] **500 Internal Server Error** — unrecoverable server error
- [ ] **503 Service Unavailable** — temporary outage; include Retry-After header

### Status Code Mapping

| Scenario | Status | Use When |
|----------|--------|----------|
| Valid GET | 200 | Resource exists and is returned |
| Valid POST (create) | 201 | Resource created; Location header present |
| Async operation accepted | 202 | Job queued, poll status endpoint |
| Success, no body | 204 | DELETE, or PUT with no response body |
| Batch success/failure | 207 | Multiple operations with mixed outcomes |
| Bad syntax or validation | 400 | Missing required field, wrong type, invalid value |
| Not authenticated | 401 | Missing or invalid Bearer token |
| Authenticated but denied | 403 | User lacks permission for this resource |
| Not found | 404 | Resource ID does not exist |
| Conflict (duplicate key) | 409 | User with email already exists |
| ETag mismatch | 412 | If-Match header stale (optimistic lock) |
| Business logic error | 422 | User age must be ≥18; cannot delete active account |
| Rate limit | 429 | Too many requests in time window |
| Unexpected error | 500 | Bug, unhandled exception |
| Service down | 503 | Maintenance, database unavailable |

---

## Pagination (Cursor-Based, No Offset)

- [ ] **Use cursor pagination**, not offset/page
  ```yaml
  # GOOD: Cursor-based
  GET /v1/users?cursor=abc123&limit=20
  
  # BAD: Offset (inefficient at scale)
  GET /v1/users?offset=40&limit=20
  
  # BAD: Page-based
  GET /v1/users?page=3&limit=20
  ```

- [ ] **Cursor parameter** — opaque, server-managed token
  ```yaml
  parameters:
    - name: cursor
      in: query
      description: "Cursor for next page"
      schema:
        type: string
      required: false
  ```

- [ ] **Limit parameter** — max items per page (default 20, max 100)
  ```yaml
  parameters:
    - name: limit
      in: query
      description: "Items per page (default 20, max 100)"
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      required: false
  ```

- [ ] **Response envelope** includes items + _links
  ```yaml
  responses:
    "200":
      content:
        application/json:
          schema:
            type: object
            required: [items]
            properties:
              items:
                type: array
                items:
                  $ref: "#/components/schemas/User"
              _links:
                type: object
                properties:
                  self:
                    type: object
                    properties:
                      href: { type: string }
                  next:
                    type: object
                    properties:
                      href: { type: string }
                      example: "https://api.example.com/v1/users?cursor=xyz789&limit=20"
                  prev:
                    type: object
                    properties:
                      href: { type: string }
  ```

---

## Errors: RFC 9457 Problem+JSON

- [ ] **Content-Type: application/problem+json** on all 4xx/5xx
  ```yaml
  responses:
    "404":
      description: "Not Found"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"
  ```

- [ ] **Single reusable Problem schema** across all endpoints
  ```yaml
  components:
    schemas:
      Problem:
        type: object
        required: [type, title, status]
        properties:
          type:
            type: string
            description: "URI identifying problem type"
            example: "https://api.example.com/problems/user-not-found"
          title:
            type: string
            description: "Short, human-readable summary"
            example: "User Not Found"
          status:
            type: integer
            description: "HTTP status code"
            example: 404
          detail:
            type: string
            description: "Details specific to this occurrence"
            example: "User with ID 'user-456' does not exist in the system"
          instance:
            type: string
            description: "URI to the affected resource or request"
            example: "https://api.example.com/v1/users/user-456"
  ```

- [ ] **Extension members** — add custom fields as siblings
  ```yaml
  # Example: Add 'trace_id' for debugging
  responses:
    "500":
      content:
        application/problem+json:
          schema:
            allOf:
              - $ref: "#/components/schemas/Problem"
              - type: object
                properties:
                  trace_id:
                    type: string
                    example: "abc123def456"
  ```

---

## Versioning (URL Major Version)

- [ ] **URL major version** — `/v1/`, `/v2/` in path
  ```yaml
  servers:
    - url: "https://api.example.com"
  paths:
    /v1/users:
      ...
    /v2/users:
      ...
  ```

- [ ] **Additive-only within a version** — no breaking changes to `/v1` after release
  ```yaml
  # OK: Add new optional field
  properties:
    phone_number:  # NEW
      type: string
      required: false
  
  # NOT OK: Remove field or change type
  properties:
    # email: REMOVED
    user_id:
      type: string   # Changed from integer
  ```

- [ ] **Bump major version** if breaking change required
  ```yaml
  # v1 (old)
  /v1/users/{id}
  
  # v2 (breaking: renamed endpoint)
  /v2/customers/{id}
  ```

- [ ] **Alternative: Media-type versioning** (content negotiation; optional)
  ```yaml
  # Acceptable alternative to URL versioning
  headers:
    Accept: "application/vnd.example.v1+json"
  ```

---

## Idempotency

- [ ] **POST requires Idempotency-Key header** (UUID)
  ```yaml
  post:
    parameters:
      - name: Idempotency-Key
        in: header
        description: "Unique key for idempotent requests (UUID)"
        schema:
          type: string
          format: uuid
        required: true
    requestBody:
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/CreateUserRequest"
    responses:
      "201":
        description: "User created"
  ```

- [ ] **PUT and DELETE are inherently idempotent** — no key required
  ```yaml
  put:
    description: "Update user; safe to retry with same request"
    responses:
      "200": ...
  
  delete:
    description: "Delete user; safe to retry"
    responses:
      "204": ...
  ```

- [ ] **Same response on retry** — server returns identical response if key is resubmitted
  ```yaml
  # First POST
  POST /v1/users
  Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  → 201 Created

  # Retry with same key
  POST /v1/users
  Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  → 201 Created (same response)
  ```

---

## Filtering & Sorting

- [ ] **Filtering via query parameters** — one per field
  ```yaml
  parameters:
    - name: status
      in: query
      schema:
        type: string
        enum: [active, inactive, archived]
    - name: user_id
      in: query
      schema:
        type: string
  ```

- [ ] **Free-text search** via `?q=` parameter
  ```yaml
  parameters:
    - name: q
      in: query
      description: "Free-text search query"
      schema:
        type: string
      example: "john@example.com"
  ```

- [ ] **Sorting** via `?sort=field,-field` (ascending/descending)
  ```yaml
  parameters:
    - name: sort
      in: query
      description: "Sort by field (use '-' prefix for descending)"
      schema:
        type: string
      examples:
        ascending: { value: "created_at" }
        descending: { value: "-created_at" }
  ```

---

## Hypermedia & Links

- [ ] **_links object** in response for navigation
  ```yaml
  properties:
    _links:
      type: object
      properties:
        self:
          type: object
          properties:
            href: { type: string, example: "https://api.example.com/v1/users/user-123" }
        edit:
          type: object
          properties:
            href: { type: string }
        delete:
          type: object
          properties:
            href: { type: string }
  ```

- [ ] **Standard link relations**: self, next, prev, first, last, edit, delete, related
  ```yaml
  _links:
    self: { href: "..." }
    next: { href: "...", }
    prev: { href: "..." }
    first: { href: "..." }
    last: { href: "..." }
  ```

---

## Headers & Content Types

- [ ] **Default Content-Type: application/json**
  ```yaml
  responses:
    "200":
      content:
        application/json:  # Default, always JSON unless documented
          schema: ...
  ```

- [ ] **Errors: application/problem+json** (RFC 9457)
  ```yaml
  responses:
    "400":
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"
  ```

- [ ] **ETag header** for optimistic concurrency control
  ```yaml
  responses:
    "200":
      headers:
        ETag:
          schema:
            type: string
          description: "Resource version identifier"
          example: '"abc123def456"'
      content:
        application/json:
          schema: ...
  ```

- [ ] **If-Match header** on PUT/DELETE to enforce optimistic locking
  ```yaml
  put:
    parameters:
      - name: If-Match
        in: header
        description: "ETag value from GET; prevents conflicts"
        schema:
          type: string
        required: false
    responses:
      "200": ...
      "412":
        description: "Precondition Failed (ETag stale)"
  ```

- [ ] **Retry-After header** on 429 (rate limit) and 503 (service unavailable)
  ```yaml
  responses:
    "429":
      headers:
        Retry-After:
          schema:
            type: integer
          description: "Seconds to wait before retrying"
          example: 60
    "503":
      headers:
        Retry-After:
          schema:
            type: integer
  ```

---

## Deprecation

- [ ] **Deprecation: true header** in responses
  ```yaml
  responses:
    "200":
      headers:
        Deprecation:
          schema:
            type: boolean
          description: "This endpoint is deprecated"
          example: true
```

- [ ] **Sunset header** — date when endpoint will be removed
  ```yaml
  responses:
    "200":
      headers:
        Sunset:
          schema:
            type: string
            format: date-time
          description: "Date when this endpoint will be removed"
          example: "2026-12-31T23:59:59Z"
  ```

- [ ] **deprecated: true** on schema fields
  ```yaml
  properties:
    legacy_field:
      type: string
      deprecated: true
      description: "DEPRECATED. Use 'new_field' instead."
    new_field:
      type: string
  ```

---

## Security

- [ ] **securitySchemes** defined
  ```yaml
  components:
    securitySchemes:
      bearerAuth:
        type: http
        scheme: bearer
        bearerFormat: JWT
      oauth2:
        type: oauth2
        flows:
          implicit:
            authorizationUrl: "https://auth.example.com/oauth/authorize"
            scopes:
              read:users: "Read user data"
              write:users: "Modify user data"
  ```

- [ ] **Security applied per operation**, not globally
  ```yaml
  paths:
    /v1/users:
      get:
        security:
          - bearerAuth: []
      post:
        security:
          - oauth2: [write:users]
    /v1/public-data:
      get:
        security: []  # No auth required
  ```

- [ ] **No secrets in examples or defaults**
  ```yaml
  # BAD: Exposes token
  parameters:
    - name: Authorization
      in: header
      schema:
        type: string
        default: "Bearer sk-abc123xyz789..."
  
  # GOOD: Placeholder only
  parameters:
    - name: Authorization
      in: header
      schema:
        type: string
        example: "Bearer <your-token>"
  ```

---

## Summary

**Checklist use**:
1. ✓ Run through each section for your API spec.
2. ✓ Use YAML snippets as templates.
3. ✓ Validate with Spectral or Redocly (see [validation.md](../validation.md)).
4. ✓ Re-check before publishing to SwaggerHub.
