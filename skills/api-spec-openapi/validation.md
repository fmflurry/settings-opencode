# OpenAPI Specification Validation

Validation tools and fallback strategies to ensure specs comply with OpenAPI 3.1 and Zalando conventions.

---

## Primary Validator: Spectral (Recommended)

**Spectral** is a JSON/YAML linter that supports OpenAPI 3.1 and custom rulesets (including Zalando).

### Installation & Setup

```bash
# Install Spectral CLI globally
npm install --global @stoplight/spectral-cli

# Or run via npx (no installation)
npx @stoplight/spectral-cli --version
```

### Availability Check

```bash
# Check if Spectral is installed
which spectral

# Or via npx (works even without global install)
npx @stoplight/spectral-cli --version
```

### Running Spectral with Zalando Ruleset

```bash
# Basic lint (uses default ruleset)
npx @stoplight/spectral-cli lint api-specs/user-management.openapi.yaml

# Lint all specs in folder
npx @stoplight/spectral-cli lint api-specs/*.openapi.yaml

# Lint with custom Zalando ruleset (if available)
npx @stoplight/spectral-cli lint api-specs/*.openapi.yaml \
  --ruleset path/to/zalando-ruleset.yaml
```

### Example Output

```
/Users/example/api-specs/user-management.openapi.yaml
  10:5   warning  Paths should start with /v  zalando-paths
  24:7   error    Field names must be snake_case  zalando-naming
  40:3   error    Must use cursor pagination, not offset  zalando-pagination
  
3 warnings, 1 error
```

### Starter Zalando Ruleset

Create `.spectral-zalando.yaml`:

```yaml
extends:
  - spectral:oas

rules:
  # Paths must use kebab-case
  zalando-paths:
    description: "Paths should use kebab-case"
    given: "$.paths[*]~"
    then:
      function: pattern
      functionOptions:
        match: "^/v[0-9]+/[a-z0-9/_-]*$"
    severity: error

  # Path parameters must be snake_case
  zalando-path-params:
    description: "Path parameters should be snake_case"
    given: "$.paths[*].parameters[?(@.in == 'path')].name"
    then:
      function: pattern
      functionOptions:
        match: "^[a-z_]+$"
    severity: error

  # Response bodies must use snake_case JSON
  zalando-snake-case:
    description: "JSON properties must be snake_case"
    given: "$.components.schemas[*].properties[*]~"
    then:
      function: pattern
      functionOptions:
        match: "^[a-z_]+$"
    severity: error

  # POST must return 201 with Location header
  zalando-post-201:
    description: "POST endpoints should return 201 Created with Location header"
    given: "$.paths[*].post"
    then:
      - function: truthy
        field: "responses.201"
        severity: error
      - function: truthy
        field: "responses.201.headers.Location"
        severity: warning

  # Errors must use problem+json
  zalando-problem-json:
    description: "Error responses must use application/problem+json"
    given: "$.paths[*][get,post,put,delete,patch].responses[4xx,5xx][*]"
    then:
      function: truthy
      field: "content['application/problem+json']"
      severity: error

  # No offset/page pagination
  zalando-no-offset:
    description: "Use cursor pagination, not offset/page"
    given: "$.paths[*].parameters[?(@.name =~ /offset|page/)]"
    then:
      function: falsy
      severity: error

  # No nullable (use type: [type, "null"] instead)
  zalando-no-nullable-3-0:
    description: "Use 3.1 union types (type: [string, \"null\"]) instead of nullable"
    given: "$.components.schemas[*].properties[*]"
    then:
      function: falsy
      field: nullable
      severity: warning
```

Use with:
```bash
npx @spectral/spectral-cli lint api-specs/*.openapi.yaml --ruleset .spectral-zalando.yaml
```

---

## Alternative Validator: Redocly CLI

**Redocly CLI** is OpenAPI 3.1-aware and provides comprehensive validation.

### Installation

```bash
npm install --global @redocly/cli

# Or via npx
npx @redocly/cli --version
```

### Running Redocly

```bash
# Lint a single spec
npx @redocly/cli lint api-specs/user-management.openapi.yaml

# Lint all specs
npx @redocly/cli lint api-specs/*.openapi.yaml

# Detailed output
npx @redocly/cli lint api-specs/*.openapi.yaml --format pretty
```

### Example Output

```
/Users/example/api-specs/user-management.openapi.yaml
  line 24  error  String value must not have whitespace  casing
  line 40  error  Array items must be unique  refs
  
2 errors
```

---

## Fallback: SwaggerHub MCP Validation

If neither Spectral nor Redocly is available locally, and the `smartbear-swagger` MCP is connected, the publishing agent can validate specs via SwaggerHub's import/validate endpoint:

```bash
# Check if MCP is available
ToolSearch("swaggerhub")
```

If the MCP is connected, it provides a `smartbear_swagger_validate_spec` tool that validates specs against OpenAPI 3.1 rules.

---

## Validation Checklist

Before declaring a spec complete, run:

1. **Spectral (if available)**
   ```bash
   npx @stoplight/spectral-cli lint api-specs/*.openapi.yaml
   ```
   Expected: No errors (warnings acceptable).

2. **Redocly (if Spectral unavailable)**
   ```bash
   npx @redocly/cli lint api-specs/*.openapi.yaml
   ```
   Expected: No errors or warnings related to structure.

3. **Manual review against zalando-checklist.md**
   - [ ] Paths are kebab-case
   - [ ] JSON properties are snake_case
   - [ ] Pagination uses cursor (no offset/page)
   - [ ] Errors use RFC 9457 Problem schema
   - [ ] POST returns 201 with Location header
   - [ ] Idempotency headers present on POST
   - [ ] All 4xx/5xx return problem+json

4. **SwaggerHub preview (if MCP connected)**
   ```bash
   # Push to a draft/preview API on SwaggerHub
   # Review rendering and discoverability
   ```

---

## Common Validation Failures & Fixes

### Error: "Paths should start with /v"

**Cause**: Path missing version prefix.

**Fix**:
```yaml
# BAD
/users

# GOOD
/v1/users
```

### Error: "Field names must be snake_case"

**Cause**: Property using camelCase or kebab-case.

**Fix**:
```yaml
# BAD
properties:
  userId: string
  is-active: boolean

# GOOD
properties:
  user_id: string
  is_active: boolean
```

### Error: "POST must return 201 with Location header"

**Cause**: POST response missing 201 or Location header.

**Fix**:
```yaml
# BAD
post:
  responses:
    "200":
      description: "Created"

# GOOD
post:
  responses:
    "201":
      description: "Created"
      headers:
        Location:
          schema:
            type: string
          description: "URI of created resource"
```

### Error: "Error responses must use application/problem+json"

**Cause**: Error response using a custom error schema.

**Fix**:
```yaml
# BAD
responses:
  "404":
    content:
      application/json:
        schema:
          $ref: "#/components/schemas/ApiError"

# GOOD
responses:
  "404":
    content:
      application/problem+json:
        schema:
          $ref: "#/components/schemas/Problem"
```

### Error: "Use cursor pagination, not offset/page"

**Cause**: Query parameters using `offset`, `page`, or `limit` without cursor.

**Fix**:
```yaml
# BAD
parameters:
  - name: offset
    in: query
  - name: limit
    in: query

# GOOD
parameters:
  - name: cursor
    in: query
  - name: limit
    in: query
```

---

## Validation Gate in the Workflow

The API spec agent MUST NOT report success until validation passes:

```
1. Generate OpenAPI YAML for each BC
2. RUN VALIDATOR (Spectral → Redocly → SwaggerHub MCP)
3. IF errors → fix and loop to step 2
4. IF clean → report success + paste last 15 lines of validator output
```

**Failure handling**:
- **Validator not installed**: Report it; agent should guide installation or use MCP fallback.
- **Validation failures**: Fix in YAML, re-run validator. Loop until clean.
- **Pre-existing errors**: Not the agent's responsibility; note them but proceed.

---

## Summary

- **Primary**: Use **Spectral** with a Zalando ruleset.
- **Alternative**: Use **Redocly CLI** for comprehensive validation.
- **Fallback**: Use **SwaggerHub MCP** validation if local tools unavailable.
- **Always run** before declaring spec done.
- **Paste output** (last ~15 lines) in final report.
- **Loop on failures** until clean.
