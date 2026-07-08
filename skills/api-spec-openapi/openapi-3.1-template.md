# OpenAPI 3.1 Shape & Idioms

Reference for OpenAPI 3.1 structure, JSON Schema 2020-12 features, and migration from 3.0.

---

## OpenAPI 3.1 Full Template

```yaml
openapi: 3.1.0                          # REQUIRED: OpenAPI version (3.1.0 only)

info:
  title: "User Service API"             # REQUIRED
  version: "1.0.0"                      # REQUIRED: SemVer
  description: |
    API for user management and profile operations.
    Follows Zalando RESTful API Guidelines.
  contact:
    name: "API Support Team"
    url: "https://support.example.com"
    email: "api-support@example.com"
  license:
    name: "MIT"
    identifier: "MIT"                   # 3.1: use identifier or url
    url: "https://opensource.org/licenses/MIT"
  x-api-id: "123e4567-e89b-12d3-a456-426614174000"  # Custom extension

servers:
  - url: "https://api.example.com"
    description: "Production"
    variables:
      environment:
        default: "prod"
        enum: [prod, staging]
  - url: "https://staging-api.example.com"
    description: "Staging"

tags:
  - name: "Users"
    description: "User management operations"
    externalDocs:
      url: "https://docs.example.com/users"
  - name: "Orders"
    description: "Order lifecycle"

paths:
  /v1/users:
    get:
      operationId: "listUsers"
      tags: ["Users"]
      summary: "List all users"
      description: |
        Retrieve a paginated list of users.
        Results are cursor-paginated and sorted by creation date.
      parameters:
        - $ref: "#/components/parameters/CursorParam"
        - $ref: "#/components/parameters/LimitParam"
        - name: status
          in: query
          description: "Filter by user status"
          schema:
            type: string
            enum: [active, inactive, archived]
          required: false
      responses:
        "200":
          description: "Users retrieved successfully"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserPage"
              examples:
                success:
                  value:
                    items:
                      - id: "user-123"
                        email: "john@example.com"
                        name: "John Doe"
                        is_active: true
                        created_at: "2025-01-15T10:30:00Z"
                    _links:
                      self: { href: "https://api.example.com/v1/users?limit=20" }
                      next: { href: "https://api.example.com/v1/users?cursor=abc123&limit=20" }
        "400":
          $ref: "#/components/responses/Problem400"
        "401":
          $ref: "#/components/responses/Problem401"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []
      deprecated: false

    post:
      operationId: "createUser"
      tags: ["Users"]
      summary: "Create a new user"
      description: "Create a new user account with the provided details."
      requestBody:
        required: true
        description: "User creation payload"
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUserRequest"
            examples:
              example1:
                value:
                  email: "jane@example.com"
                  name: "Jane Smith"
                  is_active: true
      parameters:
        - name: Idempotency-Key
          in: header
          description: "Unique key for idempotent request (UUID)"
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "201":
          description: "User created successfully"
          headers:
            Location:
              description: "URI of the newly created resource"
              schema:
                type: string
                format: uri
              example: "https://api.example.com/v1/users/user-123"
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

  /v1/users/{user_id}:
    get:
      operationId: "getUser"
      tags: ["Users"]
      summary: "Get user by ID"
      parameters:
        - name: user_id
          in: path
          description: "User identifier"
          required: true
          schema:
            type: string
            example: "user-123"
      responses:
        "200":
          description: "User found"
          headers:
            ETag:
              description: "Resource version for optimistic concurrency"
              schema:
                type: string
              example: '"abc123def456"'
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "404":
          $ref: "#/components/responses/Problem404"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []

    put:
      operationId: "updateUser"
      tags: ["Users"]
      summary: "Update user (full replacement)"
      parameters:
        - name: user_id
          in: path
          required: true
          schema:
            type: string
        - name: If-Match
          in: header
          description: "ETag from GET; required for optimistic locking"
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UpdateUserRequest"
      responses:
        "200":
          description: "User updated"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "404":
          $ref: "#/components/responses/Problem404"
        "412":
          $ref: "#/components/responses/Problem412"
        "422":
          $ref: "#/components/responses/Problem422"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []

    delete:
      operationId: "deleteUser"
      tags: ["Users"]
      summary: "Delete user"
      parameters:
        - name: user_id
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: "User deleted successfully"
        "404":
          $ref: "#/components/responses/Problem404"
        "500":
          $ref: "#/components/responses/Problem500"
      security:
        - bearerAuth: []

components:
  parameters:
    CursorParam:
      name: cursor
      in: query
      description: "Cursor for pagination (opaque token)"
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

    IfMatchHeader:
      name: If-Match
      in: header
      description: "ETag from GET response for optimistic concurrency control"
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
          example:
            type: "https://api.example.com/problems/validation-error"
            title: "Validation Error"
            status: 400
            detail: "Field 'email' is required"

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

    Problem412:
      description: "Precondition Failed"
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
      headers:
        Retry-After:
          schema:
            type: integer
          description: "Seconds to wait before retrying"
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
      title: "Problem Details (RFC 9457)"
      description: "HTTP API problem response per RFC 9457 / RFC 7807"
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
          description: "URI identifying problem type"
          default: "about:blank"
          example: "https://api.example.com/problems/user-not-found"
        title:
          type: string
          description: "Human-readable problem summary"
          example: "User Not Found"
        status:
          type: integer
          minimum: 100
          maximum: 599
          description: "HTTP status code"
          example: 404
        detail:
          type: string
          description: "Details specific to this occurrence"
          example: "User with ID 'user-456' does not exist"
        instance:
          type: string
          format: uri
          description: "URI to the affected resource"
          example: "https://api.example.com/v1/users/user-456"
      additionalProperties: true  # Allow custom fields per RFC 9457

    Link:
      type: object
      title: "Hypermedia Link"
      required: [href]
      properties:
        href:
          type: string
          format: uri-reference
          description: "Link target URI"
        title:
          type: string
          description: "Link title (human-readable)"
        type:
          type: string
          description: "Media type of link target"
        rel:
          type: string
          description: "Link relation type"
        deprecation:
          type: string
          format: uri

    CursorPage:
      type: object
      title: "Cursor-Paginated Collection"
      required: [items]
      properties:
        items:
          type: array
          description: "List of items in this page"
        _links:
          type: object
          description: "Navigation links"
          properties:
            self:
              $ref: "#/components/schemas/Link"
            next:
              $ref: "#/components/schemas/Link"
            prev:
              $ref: "#/components/schemas/Link"
            first:
              $ref: "#/components/schemas/Link"
            last:
              $ref: "#/components/schemas/Link"

    CreateUserRequest:
      type: object
      title: "Create User Request"
      required:
        - email
        - name
      properties:
        email:
          type: string
          format: email
          description: "User email address"
          example: "jane@example.com"
        name:
          type: string
          minLength: 1
          maxLength: 255
          description: "User full name"
          example: "Jane Smith"
        is_active:
          type: boolean
          default: true
          description: "Whether user account is active"

    UpdateUserRequest:
      type: object
      title: "Update User Request"
      required:
        - email
        - name
      properties:
        email:
          type: string
          format: email
        name:
          type: string
          minLength: 1
          maxLength: 255
        is_active:
          type: boolean

    UserResponse:
      type: object
      title: "User Response"
      required:
        - id
        - email
        - name
        - created_at
      properties:
        id:
          type: string
          description: "Unique user identifier"
          example: "user-123"
        email:
          type: string
          format: email
          example: "jane@example.com"
        name:
          type: string
          example: "Jane Smith"
        is_active:
          type: boolean
          example: true
        created_at:
          type: string
          format: date-time
          description: "User creation timestamp (RFC 3339)"
          example: "2025-01-15T10:30:00Z"
        updated_at:
          type: string
          format: date-time
          description: "Last update timestamp"
          example: "2025-01-16T14:22:00Z"
        _links:
          type: object
          properties:
            self:
              $ref: "#/components/schemas/Link"
            edit:
              $ref: "#/components/schemas/Link"
            delete:
              $ref: "#/components/schemas/Link"

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
      description: "Bearer token (JWT) with user identity"

externalDocs:
  description: "Full API documentation"
  url: "https://docs.example.com/api"
```

---

## OpenAPI 3.1 vs 3.0 Key Differences

### JSON Schema 2020-12 (3.1 only)

**3.0: Use `nullable: true` for optional values**
```yaml
# 3.0
type: string
nullable: true
```

**3.1: Use JSON Schema 2020-12 union types**
```yaml
# 3.1 (CORRECT)
type: [string, "null"]

# 3.1 (ALSO OK, for clarity)
type: string
default: null
```

### Examples (3.1 improved)

**3.0: Single example**
```yaml
# 3.0
example: "john@example.com"
```

**3.1: Multiple examples (plural form)**
```yaml
# 3.1
examples:
  standard:
    value: "john@example.com"
    description: "Standard email"
  alternative:
    value: "jane+test@example.com"
    description: "Email with plus addressing"
```

### Webhooks (3.1 new)

OpenAPI 3.1 supports outbound webhooks (server sends events to client):

```yaml
webhooks:
  userCreatedEvent:
    post:
      summary: "User created event"
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UserCreatedEvent"
      responses:
        "200":
          description: "Webhook received successfully"
```

### Schema Objects (3.1 more flexible)

**3.0: Strict OpenAPI schema subset**

**3.1: Full JSON Schema Draft 2020-12 support**
- `prefixItems` (instead of tuple validation)
- `$id` and `$defs` for schema composition
- `dependentRequired`, `dependentSchemas`
- `const` (single constant value)
- `examples` (plural, multiple examples)

---

## Validation

Use **Spectral** with a Zalando ruleset or **Redocly CLI** (which natively supports OpenAPI 3.1):

```bash
# Spectral
npx @stoplight/spectral-cli lint api-specs/*.openapi.yaml

# Redocly (recommended for 3.1)
npx @redocly/cli lint api-specs/*.openapi.yaml
```

---

## Summary

- OpenAPI 3.1.0 aligns with **JSON Schema Draft 2020-12**.
- Use **type: [string, "null"]** instead of `nullable: true`.
- Use **examples** (plural) with structured metadata.
- Support **webhooks** for server-initiated events.
- Always include **RFC 9457 Problem schema** for error responses.
- Zalando conventions (kebab-case paths, snake_case JSON, cursor pagination) apply equally to 3.0 and 3.1.
