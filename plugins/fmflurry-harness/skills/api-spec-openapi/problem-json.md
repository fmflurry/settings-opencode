# RFC 9457 Problem+JSON Error Model

Standard error response format for all 4xx and 5xx HTTP responses. Based on RFC 9457 (formerly RFC 7807).

---

## Core Problem Schema

```yaml
components:
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
          description: |
            A URI reference that identifies the problem type.
            Provides human-readable documentation at that URI.
            Use "about:blank" if no URI is available.
          default: "about:blank"
          example: "https://api.example.com/problems/user-not-found"

        title:
          type: string
          description: "Short, human-readable summary of the problem type."
          example: "User Not Found"

        status:
          type: integer
          minimum: 100
          maximum: 599
          description: "HTTP status code."
          example: 404

        detail:
          type: string
          description: |
            Human-readable explanation specific to this occurrence
            of the problem.
          example: "User with ID 'user-456' does not exist in the system"

        instance:
          type: string
          format: uri-reference
          description: |
            A URI reference to the specific occurrence of the problem.
            Distinguishes this occurrence from other problems of the same type.
          example: "https://api.example.com/v1/users/user-456"

      additionalProperties: true  # RFC 9457 allows custom extensions
```

---

## Media Type

All error responses MUST use:

```
Content-Type: application/problem+json
```

---

## Standard HTTP Status Codes & Problem Types

### 400 Bad Request

**When**: Request syntax is malformed or missing required fields.

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Field 'email' is required and must be a valid email address",
  "instance": "https://api.example.com/v1/users"
}
```

### 401 Unauthorized

**When**: Missing or invalid authentication credentials.

```json
{
  "type": "https://api.example.com/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Bearer token is missing or invalid",
  "instance": "https://api.example.com/v1/users"
}
```

### 403 Forbidden

**When**: Authenticated but lacks permission.

```json
{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to delete this resource",
  "instance": "https://api.example.com/v1/users/user-123"
}
```

### 404 Not Found

**When**: Resource does not exist.

```json
{
  "type": "https://api.example.com/problems/resource-not-found",
  "title": "User Not Found",
  "status": 404,
  "detail": "User with ID 'user-456' does not exist",
  "instance": "https://api.example.com/v1/users/user-456"
}
```

### 409 Conflict

**When**: Conflict with existing state (e.g., duplicate key, state violation).

```json
{
  "type": "https://api.example.com/problems/conflict",
  "title": "User Already Exists",
  "status": 409,
  "detail": "A user with email 'john@example.com' already exists",
  "instance": "https://api.example.com/v1/users"
}
```

### 412 Precondition Failed

**When**: ETag/If-Match header mismatch (optimistic concurrency violation).

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "ETag Mismatch",
  "status": 412,
  "detail": "Resource has been modified; If-Match header does not match current ETag",
  "instance": "https://api.example.com/v1/users/user-123",
  "expected_etag": "\"abc123\"",
  "current_etag": "\"xyz789\""
}
```

### 422 Unprocessable Entity

**When**: Request syntax is valid but semantic validation fails (business logic).

```json
{
  "type": "https://api.example.com/problems/business-rule-violation",
  "title": "Business Rule Violation",
  "status": 422,
  "detail": "User must be at least 18 years old to create an account",
  "instance": "https://api.example.com/v1/users",
  "rule": "min-age-18"
}
```

### 429 Too Many Requests

**When**: Rate limit exceeded.

```json
{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "Too many requests. Maximum 100 requests per minute.",
  "instance": "https://api.example.com/v1/users",
  "retry_after": 60
}
```

**Response Headers:**
```
Retry-After: 60
```

### 500 Internal Server Error

**When**: Unexpected server error.

```json
{
  "type": "https://api.example.com/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred processing your request",
  "instance": "https://api.example.com/v1/users",
  "trace_id": "abc-123-def-456"
}
```

### 503 Service Unavailable

**When**: Temporary outage.

```json
{
  "type": "https://api.example.com/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "Service is temporarily unavailable for maintenance",
  "instance": "https://api.example.com/v1/users",
  "estimated_recovery": "2025-01-16T15:00:00Z"
}
```

**Response Headers:**
```
Retry-After: 3600
```

---

## Extension Members

RFC 9457 allows custom fields as siblings to standard properties. Examples:

### Validation Error with Field Details

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Multiple validation errors",
  "instance": "https://api.example.com/v1/users",
  "fields": [
    {
      "name": "email",
      "error": "Invalid email format"
    },
    {
      "name": "age",
      "error": "Must be at least 18"
    }
  ]
}
```

### Rate Limit with Context

```json
{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "You have exceeded the rate limit",
  "instance": "https://api.example.com/v1/search",
  "limit": 100,
  "window_seconds": 60,
  "used": 105,
  "reset_at": "2025-01-16T10:15:30Z"
}
```

### Tracing with Deployment Context

```json
{
  "type": "https://api.example.com/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred",
  "instance": "https://api.example.com/v1/orders",
  "trace_id": "abc-123-def-456",
  "deployment_id": "prod-east-2",
  "timestamp": "2025-01-16T10:12:45Z"
}
```

---

## OpenAPI 3.1 Response Definitions

Define reusable response objects per status code:

```yaml
components:
  responses:
    Problem400:
      description: "Bad Request"
      content:
        application/problem+json:
          schema:
            allOf:
              - $ref: "#/components/schemas/Problem"
              - type: object
                properties:
                  fields:
                    type: array
                    items:
                      type: object
                      properties:
                        name: { type: string }
                        error: { type: string }

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
```

---

## .NET ProblemDetails Mapping

ASP.NET Core's `ProblemDetails` class aligns with RFC 9457:

```csharp
// .NET
var problemDetails = new ProblemDetails
{
    Type = "https://api.example.com/problems/user-not-found",
    Title = "User Not Found",
    Status = StatusCodes.Status404NotFound,
    Detail = "User with ID 'user-456' does not exist",
    Instance = context.Request.Path
};

return Results.Problem(
    detail: problemDetails.Detail,
    instance: problemDetails.Instance,
    statusCode: problemDetails.Status,
    title: problemDetails.Title,
    type: problemDetails.Type
);
```

**Serializes to:**
```json
{
  "type": "https://api.example.com/problems/user-not-found",
  "title": "User Not Found",
  "status": 404,
  "detail": "User with ID 'user-456' does not exist",
  "instance": "/v1/users/user-456"
}
```

---

## Problem Type URI Convention

Create a documentation page at your `type` URI explaining the problem:

```
https://api.example.com/problems/user-not-found
```

**Page content example:**

```html
<h1>User Not Found</h1>
<p>The user requested does not exist in the system.</p>

<h2>Common Causes</h2>
<ul>
  <li>User ID is incorrect or typo</li>
  <li>User was deleted</li>
  <li>User ID format is invalid</li>
</ul>

<h2>Resolution</h2>
<ol>
  <li>Verify the user ID is correct</li>
  <li>List all users to find the correct ID</li>
  <li>Check if the user was deleted</li>
</ol>
```

---

## Summary

- **Always use RFC 9457 Problem schema** for all 4xx and 5xx responses.
- **Content-Type: application/problem+json** on all errors.
- **Required fields**: `type`, `title`, `status`.
- **Optional fields**: `detail`, `instance`.
- **Extensions**: Add custom fields for domain-specific context (fields, limits, retry info, trace IDs).
- **Problem type URI**: Link to documentation explaining the error.
- **Consistent across all endpoints**: One Problem schema, reused everywhere.
