---
name: security-review
description: Security review for full-stack applications (.NET 10 DDD/CQRS/ES back-end + Angular 22 front-end). Gate-driven checklist ensuring secrets, input validation, SQL injection prevention, tenant isolation, XSS protection, and dependency CVEs are enforced at build/CI time, not by manual review.
---

# Security Review Skill

Gate-dominant security checklist for .NET 10 DDD/CQRS/ES back-end + Angular 22 front-end stack. Every clause is backed by an executable gate (build-blocking rule, CI scan, or unit test) or explicitly marked as manual-review-only.

## When to Activate

- Implementing authentication or authorization in back-end commands/queries
- Adding command/query handlers with user input
- Creating database projections or aggregates handling sensitive data
- Implementing Angular components or services with form inputs
- Adding third-party NuGet or npm dependencies
- Writing new domain value objects with invariants

---

## Part A: .NET 10 Back-End Security

### 1. Secrets Management

**Gate**: `gitleaks` pre-commit + full-history CI scan  
**Status**: `GATE TO WIRE`

**Rule**: No API keys, connection strings, passwords, or tokens hardcoded in source. All secrets must be read via `IConfiguration` (appsettings.json / environment variables), user-secrets (dev), or Azure KeyVault (prod).

```csharp
// ❌ WRONG
private const string ApiKey = "sk-proj-xxxxx";
private const string DbPassword = "password123";

// ✅ CORRECT
private readonly IConfiguration _config;

public MyService(IConfiguration config) => _config = config;

var apiKey = _config["External:ApiKey"]
  ?? throw new InvalidOperationException("External:ApiKey not configured");
```

**Verification**: Before committing, run `gitleaks detect --verbose` on staged files. CI must run full-history scan on every PR.

---

### 2. Input Validation at Command Boundary

**Gate**: FluentValidation + domain value-object invariants + unit/property tests  
**Status**: `GATE TO ADD` (property-based tests via CsCheck)

**Rule**: All command inputs validated synchronously at the handler boundary via FluentValidation validators. Domain value objects enforce invariants via constructor throws. Property-based tests (CsCheck) confirm validators reject invalid inputs.

```csharp
// FluentValidation at command boundary
public class CreateUserCommandValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserCommandValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .WithErrorCode("INVALID_EMAIL");

        RuleFor(x => x.Age)
            .InclusiveBetween(0, 150)
            .WithErrorCode("INVALID_AGE");
    }
}

// Domain invariant (value object constructor)
public class Email
{
    public string Value { get; }

    public Email(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.Contains("@"))
            throw new ArgumentException("Invalid email format", nameof(value));
        Value = value;
    }
}
```

**Verification**: Unit tests confirm validator rejects each invalid case; property-based tests (CsCheck) generate random invalid inputs and confirm rejection.

---

### 3. SQL Injection Prevention

**Gate**: Roslyn CA2100 (build-blocking) + SAST rule for interpolated `*SqlRaw` calls  
**Status**: `GATE TO WIRE` (Roslyn CA2100 enabled; SAST rule for raw SQL patterns)

**Rule**: EF Core parameterizes by default. **Forbidden**: `FromSqlRaw()` and `ExecuteSqlRaw()` with string interpolation or concatenation. Use only `FromSqlInterpolated()` or parameterized `*Async` with explicit parameter arrays.

```csharp
// ❌ DANGEROUS
var query = $"SELECT * FROM users WHERE email = '{userEmail}'";
context.Users.FromSqlRaw(query).ToList();

// ✅ CORRECT
var results = context.Users
    .FromSqlInterpolated($"SELECT * FROM users WHERE email = {userEmail}")
    .ToList();

// ✅ ALSO CORRECT (explicit parameters)
var results = await context.Users
    .FromSqlAsync(
        "SELECT * FROM users WHERE email = @email",
        new SqlParameter("@email", userEmail)
    )
    .ToListAsync();
```

**Verification**: Build fails if CA2100 triggered. SAST scan flags interpolated `*SqlRaw` calls.

---

### 4. Tenant Isolation & Row-Level Security (RLS)

**Gate**: `DbConnectionInterceptor` + `FORCE ROW LEVEL SECURITY` + RLS coverage test  
**Status**: `GATE TO ADD` (coverage test; choke point exists in `backend/src/GcPlatform.Api/Infrastructure/Persistence/TenantSessionInterceptor.cs`)

**Rule**: ALL tenant-scoped data access MUST route through the single `DbConnectionInterceptor` choke point that sets `app.tenant_id` session variable. The database enforces `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables. **Forbidden**: per-handler row filtering (e.g., `where x.TenantId == currentTenantId`) as a substitute for RLS — this is the isolation mechanism's death knell.

Test requirement: For every tenant-scoped table, integration test must verify:
- Cross-tenant read returns **0 rows** (not filtered at app layer).
- Default-deny: no `app.tenant_id` set ⇒ 0 rows.
- Same-tenant read returns correct rows.

```csharp
// ❌ FORBIDDEN (per-handler filtering, RLS bypass)
public async Task<IEnumerable<Order>> GetOrdersAsync(string tenantId)
{
    return await _context.Orders
        .Where(o => o.TenantId == tenantId) // ← BUG: RLS should enforce this
        .ToListAsync();
}

// ✅ CORRECT (RLS enforces, no app-layer filtering on tenant)
public async Task<IEnumerable<Order>> GetOrdersAsync()
{
    // Interceptor ensures app.tenant_id is set for this user
    // RLS policy on Orders table: WHERE tenant_id = CAST(current_setting('app.tenant_id') AS text)
    return await _context.Orders.ToListAsync();
}

// ✅ TEST: RLS coverage
[Fact]
public async Task GetOrdersAsync_CrossTenant_Returns_Zero()
{
    // Set session to TenantA
    await _dbFixture.SetTenantAsync("TenantA");
    var tenantAOrders = await _repository.GetOrdersAsync();
    tenantAOrders.Should().HaveCount(2);

    // Switch to TenantB
    await _dbFixture.SetTenantAsync("TenantB");
    var tenantBOrders = await _repository.GetOrdersAsync();
    tenantBOrders.Should().HaveCount(1);

    // Switch to no tenant (default-deny)
    await _dbFixture.SetTenantAsync(null);
    var noTenantOrders = await _repository.GetOrdersAsync();
    noTenantOrders.Should().BeEmpty(); // ← RLS must enforce this
}
```

**Verification**: Integration test `TiersRlsIsolationShould` (exists) validates single-table isolation; `GATE TO ADD` requires per-tenant-table test.

---

### 4b. Least-Privilege DB Roles & Schema Isolation

**Gate**: Privilege-isolation integration test + build-time schema audit  
**Status**: `GATE TO ADD` (Testcontainers test; CI schema-isolation check)

**Rule**: The database enforces context isolation via **role-based schema separation**. Each bounded context has two roles:
- `<context>_migrator`: Non-superuser owner of all DDL objects. Runs migrations (DDL only).
- `<context>_app`: Runtime role, NOSUPERUSER + NOBYPASSRLS, DML-only (SELECT, INSERT, UPDATE, DELETE + USAGE on sequences). Cannot CREATE, ALTER, or DROP.

Both roles are pinned to their own schema; cross-schema access is denied at the database layer.

**Doctrine**:
1. **One schema per bounded context**: `CREATE SCHEMA <context>; GRANT USAGE ON SCHEMA <context> TO <context>_app;`
2. **DML-only grant**: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <context> TO <context>_app;` (no CREATE).
3. **Revoke DDL**: `REVOKE CREATE ON SCHEMA <context> FROM PUBLIC, <context>_app;`
4. **Runtime role is NOBYPASSRLS**: Cannot bypass FORCE ROW LEVEL SECURITY; isolation enforced by database, not code.
5. **No cross-schema grants**: Runtime role cannot access any table outside its own schema.

**Example configuration**:
```sql
-- Provisioning migration (once per context)
CREATE ROLE <context>_migrator NOSUPERUSER BYPASSRLS;
CREATE ROLE <context>_app NOSUPERUSER NOBYPASSRLS;

GRANT CREATE ON SCHEMA <context> TO <context>_migrator;
GRANT USAGE ON SCHEMA <context> TO <context>_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <context> TO <context>_app;
REVOKE CREATE ON SCHEMA <context> FROM PUBLIC, <context>_app;

ALTER DEFAULT PRIVILEGES FOR ROLE <context>_migrator IN SCHEMA <context>
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <context>_app;
```

**Forbidden** (🔴 blockers):
- Cross-schema query: `SELECT ... FROM <other_context>.table` in a handler.
- Cross-schema grant: `GRANT ... ON SCHEMA <other_context> TO <context>_app`.
- DDL by runtime role: Runtime connection used to run migrations; table owned by `<context>_app`; missing `REVOKE CREATE`.

**Verification**: Testcontainers integration test validates:
- `<context>_app` cannot SELECT from another context's schema (permission denied 42501).
- `<context>_app` cannot CREATE/ALTER/DROP in its own schema (no CREATE privilege).
- `<context>_app` can DML (SELECT, INSERT, UPDATE, DELETE) in its own schema.

CI gate: `dotnet-cop` flags any migration with cross-schema access or DDL by runtime role. See [[postgres-schema-per-context]] for the full schema-per-context doctrine.

---

### 5. Error Handling & Information Leak Prevention

**Gate**: Integration test asserting 500 response body contains no stack trace or sensitive details  
**Status**: `GATE TO ADD`

**Rule**: Unhandled exceptions converted to `ProblemDetails` with generic message and no stack trace sent to client. Server logs contain full detail. HTTP 500 response body must not include `Exception`, `StackTrace`, or database column names.

```csharp
// ❌ WRONG
catch (Exception ex)
{
    return Ok(new { error = ex.Message, stackTrace = ex.StackTrace });
}

// ✅ CORRECT
catch (Exception ex)
{
    logger.LogError(ex, "Unhandled exception processing order");
    return Problem(
        detail: "An error occurred while processing your request",
        statusCode: StatusCodes.Status500InternalServerError
    );
}

// ✅ TEST
[Fact]
public async Task POST_OnException_Returns_500_WithoutStackTrace()
{
    var response = await _client.PostAsJsonAsync("/api/orders", invalidPayload);
    response.StatusCode.Should().Be(500);
    
    var body = await response.Content.ReadAsStringAsync();
    body.Should().NotContain("StackTrace");
    body.Should().NotContain("Exception");
}
```

**Verification**: Integration test confirms 500 response contains no sensitive fields.

---

### 6. PII in Logs

**Gate**: SAST rule flagging `Log.*()` calls on sensitive fields + redaction helper  
**Status**: `GATE TO WIRE`

**Rule**: Never log email, phone, SSN, credit card, or tenant-scoped identifiers. Use a redaction helper for user identifiers.

```csharp
// ❌ WRONG
logger.LogInformation("User login: {Email}", user.Email);
logger.LogInformation("Payment: {CardNumber}", payment.CardNumber);

// ✅ CORRECT
logger.LogInformation("User login: {UserId}", user.Id);
logger.LogInformation("Payment processed for {UserId}", user.Id);
```

**Verification**: SAST rule blocks Log calls on Email, Phone, CardNumber, Ssn fields.

---

### 7. Dependency CVEs

**Gate**: `dotnet list package --vulnerable --include-transitive` (build-failing in CI)  
**Status**: `GATE TO WIRE`

**Rule**: Central package management (Directory.Packages.props) or lock files (packages.lock.json) required. CI must scan for vulnerable transitive dependencies and fail the build if any CRITICAL or HIGH CVEs found.

```bash
# Local check before commit
dotnet list package --vulnerable --include-transitive

# CI command (fail on any high-severity CVE)
dotnet list package --vulnerable --include-transitive | grep -E "Critical|High"
```

**Verification**: CI job `dotnet-audit` runs before merge, blocks PR if vulnerabilities found.

---

### 8. Roslyn Security Analyzers

**Gate**: Build-blocking security rule IDs (CA2100, CA1806, CA1834, CA1833, etc.)  
**Status**: `LIVE` (enabled in .csproj; confirm in project file)

**Rule**: C# security analyzers (CA2100 for SQL injection, CA1806 for unchecked return values, etc.) must be configured as errors in `.csproj`. Build fails if violated.

```xml
<PropertyGroup>
  <AnalysisLevel>latest</AnalysisLevel>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <!-- Security rules as errors -->
  <WarningLevel>4</WarningLevel>
</PropertyGroup>
```

**Verification**: `dotnet build` halts on CA* violations.

---

## Part B: Angular 22 Front-End Security

### 1. XSS Prevention & HTML Sanitization

**Gate**: ESLint rule forbidding `bypassSecurityTrust*` without inline justification + `angular-cop` review  
**Status**: `REVIEW-ONLY` (ESLint rule to wire; angular-cop skill covers checklist)

**Rule**: Rely on Angular's built-in `DomSanitizer`. **Forbidden**: `bypassSecurityTrustHtml()`, `bypassSecurityTrustStyle()`, etc., without a comment explaining why and asserting the input is trusted. Do NOT duplicate XSS checks — defer to `/angular-cop` for deep review.

```typescript
// ❌ WRONG
<div [innerHTML]="userContent"></div>
// or
<div [innerHTML]="sanitizer.bypassSecurityTrustHtml(userContent)"></div>

// ✅ CORRECT (Angular sanitizes by default)
<div [innerText]="userContent"></div>

// ✅ IF NEEDED (rare)
// Used for rich-text editor on trusted internal content only
<div [innerHTML]="sanitizer.sanitize(SecurityContext.HTML, userContent)"></div>
```

**Verification**: Defer to `/angular-cop` for XSS + unsafe-method checks.

---

### 2. Content Security Policy (CSP) Headers

**Gate**: Integration test verifying CSP headers on HTTP responses  
**Status**: `GATE TO ADD`

**Rule**: .NET back-end must emit CSP headers on all responses. Front-end cannot work around missing back-end CSP.

```csharp
// Back-end: appsettings.json or middleware
"SecurityHeaders": {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://trusted-cdn.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com; frame-ancestors 'none';"
}

// Back-end: Middleware to add header
app.Use(async (context, next) => {
    context.Response.Headers.Add("Content-Security-Policy", "...");
    await next();
});
```

**Verification**: Integration test checks response header contains CSP policy.

---

### 3. Authentication Token Storage

**Gate**: Code review + documented decision per project security requirements  
**Status**: `REVIEW-ONLY`

**Rule**: Tokens MUST be stored in httpOnly cookies (not localStorage) to mitigate XSS theft. If a trade-off exists (e.g., CSRF vs XSS), document it and justify in code.

```typescript
// ❌ WRONG (XSS-vulnerable)
localStorage.setItem('authToken', response.token);

// ✅ CORRECT (back-end sets httpOnly cookie)
// Front-end: cookie set by Set-Cookie header, no JS access needed
// Back-end: res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict`);

// Front-end automatic: Angular HttpClient sends cookies with requests
httpClient.get('/api/protected'); // ← cookie auto-included by browser
```

**Verification**: Code review confirms no `localStorage.setItem('token')` or `sessionStorage.setItem('token')`.

---

### 4. Input Validation at FE Boundary

**Gate**: Angular form validators + reactive forms + unit tests  
**Status**: `LIVE`

**Rule**: Reactive forms with custom validators confirm user input shape before sending to back-end. Back-end validates independently (do not trust FE validation).

```typescript
// FE: Reactive form validators
const form = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  age: ['', [Validators.required, Validators.min(0), Validators.max(150)]]
});

// Test
it('should disable submit if email invalid', () => {
  form.patchValue({ email: 'not-an-email' });
  expect(form.valid).toBeFalse();
  expect(submitButton.disabled).toBeTrue();
});
```

**Verification**: Unit tests confirm validators reject invalid inputs; back-end gates validate independently.

---

### 5. Dependency CVEs (npm)

**Gate**: `npm audit` (CI) + lock files committed  
**Status**: `LIVE`

**Rule**: Lock files (package-lock.json / yarn.lock / pnpm-lock.yaml) committed. CI runs `npm audit` and fails if CRITICAL or HIGH CVEs found.

```bash
# Local check
npm audit

# CI: fail on high severity
npm audit --production | grep -E "critical|high"
```

**Verification**: CI job `npm-audit` runs before merge.

---

### 6. Defer to Specialized Skills

**Angular-specific checks** (signals, RxJS, component isolation, form security, strictness):  
→ Use `/angular-cop` (or `angular-cop` skill via `/cop-review`)

**Accessibility** (WCAG 2.1, ARIA, keyboard navigation):  
→ Use `/angular-accessibility` skill

---

## Gates Inventory

| Clause | Gate | Status | Notes |
|--------|------|--------|-------|
| **Back-End Secrets** | gitleaks pre-commit + CI scan | `GATE TO WIRE` | Detects hardcoded API keys, connection strings, tokens in history |
| **Back-End Input Validation** | FluentValidation + unit tests + CsCheck property tests | `GATE TO ADD` | Property-based tests required for validator coverage |
| **Back-End SQL Injection** | Roslyn CA2100 (build-blocking) + SAST rule for `*SqlRaw` patterns | `GATE TO WIRE` | SAST must flag string interpolation in raw SQL calls |
| **Back-End Tenant Isolation (RLS)** | DbConnectionInterceptor + `FORCE ROW LEVEL SECURITY` + per-table RLS test | `GATE TO ADD` | Coverage test validates cross-tenant read returns 0, default-deny enforced |
| **Back-End DB Roles & Schema Isolation** | Privilege-isolation integration test (Testcontainers) + dotnet-cop cross-schema/DDL check | `GATE TO ADD` | Test validates `<context>_app` cannot cross-schema, cannot DDL, can DML; CI flags cross-schema queries/grants |
| **Back-End Error Handling** | Integration test asserting 500 response contains no stack trace | `GATE TO ADD` | Test confirms sensitive fields absent from HTTP response |
| **Back-End PII in Logs** | SAST rule flagging Log.* on sensitive fields | `GATE TO WIRE` | Blocks logging of Email, Phone, CardNumber, Ssn |
| **Back-End Dependency CVEs** | `dotnet list package --vulnerable` (CI, build-failing) | `GATE TO WIRE` | Scans transitive dependencies, blocks merge on CRITICAL/HIGH |
| **Back-End Roslyn Analyzers** | CA2100, CA1806, CA1834, CA1833 as build errors | `LIVE` | Verify in .csproj; build halts on violation |
| **FE XSS / Sanitization** | ESLint rule forbidding `bypassSecurityTrust*` + angular-cop review | `REVIEW-ONLY` | Defer detailed checks to `/angular-cop` skill |
| **FE CSP Headers** | Integration test asserting CSP header present | `GATE TO ADD` | Back-end emits CSP; test verifies header value |
| **FE Token Storage** | Code review (no localStorage.setItem for tokens) | `REVIEW-ONLY` | Documented in code; angular-cop reviews |
| **FE Input Validation** | Reactive form validators + unit tests | `LIVE` | FE validators are UX only; back-end validates independently |
| **FE Dependency CVEs** | `npm audit` (CI, build-failing on CRITICAL/HIGH) | `LIVE` | Commit lock files; CI job `npm-audit` gates merge |

---

## Pre-Merge Checklist

Before opening a PR:

1. **Secrets**: No hardcoded API keys, connection strings, or passwords. Run `gitleaks detect --verbose`.
2. **Build gates**: `dotnet build` passes (CA* security rules enabled). `npm run lint` passes.
3. **Tests**: New handlers, aggregates, and FE validators have unit tests. RLS changes have integration tests.
4. **Back-end auth/authz**: Only FluentValidation + domain invariants, no per-handler role checks as RLS substitute.
5. **Back-end DB schema isolation**: New migrations do not cross schemas; roles properly scoped (DDL by `<context>_migrator`, DML by `<context>_app`); FORCE RLS on all new tables (via bulk migration + convention).
6. **FE components**: No `bypassSecurityTrust*`, no `localStorage` for tokens, no innerHTML on user content.
7. **Dependency audit**: `dotnet list package --vulnerable --include-transitive` returns 0 CRITICAL/HIGH. `npm audit --production` returns 0 CRITICAL/HIGH.
8. **Defer to specialists**: Request `/angular-cop` for FE changes, `/dotnet-cop` for back-end changes before merge.
