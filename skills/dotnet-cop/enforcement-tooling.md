# dotnet-cop / enforcement tooling

**Paste these into your .NET solution repo; they are not active in this config repo.**

These templates wire the deterministic subset of the BLOCK rules (see [enforcement.md](enforcement.md)) directly into the build, so violations become compiler errors rather than review findings. Rules that cannot be caught by analyzers are marked explicitly — they remain review-only and are caught by dotnet-cop / the coder self-check.

---

## 1. `.editorconfig` block

Place at repo root alongside your `.sln`/`.slnx`. The `[*.cs]` section cascades to all C# files.

```editorconfig
# =============================================================
# .NET enforcement — generated from dotnet-cop/enforcement-tooling.md
# =============================================================

[*.cs]

# ---------------------------------------------------------------
# Nullable reference types — BLOCK: nullable dereference / unjustified !
# Requires <Nullable>enable</Nullable> in every .csproj (see below).
# Analyzer IDs: CS8600 (possible null assignment), CS8602 (dereference of
# possibly null), CS8604 (possible null argument), CS8618 (non-nullable
# uninitialized), CS8625 (null literal to non-nullable).
# ---------------------------------------------------------------
dotnet_diagnostic.CS8600.severity = error
dotnet_diagnostic.CS8602.severity = error
dotnet_diagnostic.CS8604.severity = error
dotnet_diagnostic.CS8618.severity = error
dotnet_diagnostic.CS8625.severity = error

# ---------------------------------------------------------------
# CancellationToken propagation — BLOCK: missing CT on async I/O
# CA2016: forward CancellationToken to methods that accept one.
# ---------------------------------------------------------------
dotnet_diagnostic.CA2016.severity = error

# ---------------------------------------------------------------
# SQL injection — BLOCK: FromSqlRaw/ExecuteSqlRaw with interpolation
# CA2100: review SQL queries for security vulnerabilities.
# Note: CA2100 fires on string-concatenated SQL. It does NOT cover
# all string-interpolation patterns — dotnet-cop review still required.
# ---------------------------------------------------------------
dotnet_diagnostic.CA2100.severity = error

# ---------------------------------------------------------------
# Async correctness
# CA2007: do not directly await a Task (ConfigureAwait) — warning only;
#         not a BLOCK rule but worth surfacing.
# CA1849: use async overloads — advisory.
# ---------------------------------------------------------------
dotnet_diagnostic.CA2007.severity = suggestion
dotnet_diagnostic.CA1849.severity = warning

# ---------------------------------------------------------------
# General code quality (advisory / WARN tier)
# ---------------------------------------------------------------
dotnet_diagnostic.CA1822.severity = suggestion   # mark members static
dotnet_diagnostic.CA1852.severity = suggestion   # seal internal types
dotnet_diagnostic.CA2201.severity = warning      # do not raise reserved exceptions
dotnet_diagnostic.CA1031.severity = suggestion   # do not catch general exception

# ---------------------------------------------------------------
# Style rules — suggestion (🔵 nit tier; never BLOCK)
# ---------------------------------------------------------------
csharp_style_var_for_built_in_types = true:suggestion
csharp_style_var_when_type_is_apparent = true:suggestion
dotnet_sort_system_directives_first = true
dotnet_separate_import_directive_groups = true
```

### Required `Directory.Build.props` (enable nullable globally)

```xml
<!-- Directory.Build.props — repo root -->
<Project>
  <PropertyGroup>
    <!-- Nullable reference types: required for CS8600/8602/8604 to fire -->
    <Nullable>enable</Nullable>
    <!-- Escalate nullable warnings to errors (belt-and-suspenders with .editorconfig) -->
    <WarningsAsErrors>nullable</WarningsAsErrors>
    <!-- Treat CA2016 and CA2100 as errors via .editorconfig above -->
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <!-- Implicit usings and latest language version -->
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
</Project>
```

---

## 2. Recommended analyzer packages

Add these `<PackageReference>` entries to a shared `Directory.Packages.props` (Central Package Management) or directly to each `.csproj`.

```xml
<!-- Microsoft built-in — ships with the SDK; no PackageReference needed for net10.0+ -->
<!-- Microsoft.CodeAnalysis.NetAnalyzers is included automatically. -->

<!-- Meziantou.Analyzer — broad correctness + async rules -->
<PackageReference Include="Meziantou.Analyzer" Version="2.*" PrivateAssets="all" />

<!-- Roslynator — style + code quality -->
<PackageReference Include="Roslynator.Analyzers" Version="4.*" PrivateAssets="all" />

<!-- SonarAnalyzer.CSharp — security + reliability (covers SQL injection patterns
     beyond CA2100, e.g. S2077 for Entity Framework raw SQL) -->
<PackageReference Include="SonarAnalyzer.CSharp" Version="9.*" PrivateAssets="all" />
```

### SonarAnalyzer IDs for SQL injection (complement CA2100)

```editorconfig
# SonarAnalyzer additions — add to .editorconfig [*.cs] section
dotnet_diagnostic.S2077.severity = error   # SQL queries should not be vulnerable to injection attacks
dotnet_diagnostic.S3649.severity = error   # Database queries should not be vulnerable to injection
```

---

## 3. Architecture tests (for rules no analyzer can enforce)

The following BLOCK rules have **no stock Roslyn analyzer**:

- Module-isolation violation (direct cross-module type reference)
- Port/adapter direction violation (infra types in Core/Application)
- EF entities used as domain types in Core
- Business logic inside Minimal API endpoint handler

These are enforced by a combination of **architecture tests** (build-time, in a test project) and **dotnet-cop review**. Architecture tests run in CI as part of the test suite.

### NetArchTest example

Add a project `tests/architecture/ArchitectureTests.csproj` referencing `NetArchTest.Rules`:

```xml
<PackageReference Include="NetArchTest.Rules" Version="1.*" />
```

```csharp
// tests/architecture/DependencyRulesShould.cs
using NetArchTest.Rules;
using Xunit;

public class DependencyRulesShould
{
    private const string CoreNamespace = "MyApp.Module.*.Core";
    private const string ApplicationNamespace = "MyApp.Module.*.Application";
    private const string InfrastructureNamespace = "MyApp.Module.*.Infrastructure";
    private const string EfNamespace = "Microsoft.EntityFrameworkCore";

    [Fact]
    public void Core_has_no_dependency_on_Infrastructure()
    {
        var result = Types.InCurrentDomain()
            .That().ResideInNamespaceMatching(CoreNamespace)
            .ShouldNot().HaveDependencyOn(InfrastructureNamespace)
            .GetResult();

        Assert.True(result.IsSuccessful,
            "Core must not depend on Infrastructure: " +
            string.Join(", ", result.FailingTypes?.Select(t => t.FullName) ?? []));
    }

    [Fact]
    public void Core_has_no_dependency_on_EfCore()
    {
        var result = Types.InCurrentDomain()
            .That().ResideInNamespaceMatching(CoreNamespace)
            .ShouldNot().HaveDependencyOn(EfNamespace)
            .GetResult();

        Assert.True(result.IsSuccessful,
            "Core must not reference EF Core: " +
            string.Join(", ", result.FailingTypes?.Select(t => t.FullName) ?? []));
    }

    [Fact]
    public void Application_has_no_dependency_on_Infrastructure()
    {
        var result = Types.InCurrentDomain()
            .That().ResideInNamespaceMatching(ApplicationNamespace)
            .ShouldNot().HaveDependencyOn(InfrastructureNamespace)
            .GetResult();

        Assert.True(result.IsSuccessful,
            "Application must not depend on Infrastructure: " +
            string.Join(", ", result.FailingTypes?.Select(t => t.FullName) ?? []));
    }

    [Fact]
    public void No_cross_module_direct_references()
    {
        // Each module's Core/Application must not reference another module's Core/Application.
        // Pattern: MyApp.Module.Order.Core must not depend on MyApp.Module.User.Core (or vice versa).
        // Adjust namespace tokens to match your actual module naming.
        var orderCoreTypes = Types.InCurrentDomain()
            .That().ResideInNamespaceMatching("MyApp.Module.Order.Core")
            .ShouldNot().HaveDependencyOn("MyApp.Module.User")
            .GetResult();

        Assert.True(orderCoreTypes.IsSuccessful,
            "OrderModule.Core must not directly reference UserModule: " +
            string.Join(", ", orderCoreTypes.FailingTypes?.Select(t => t.FullName) ?? []));
    }
}
```

> **Note on ArchUnitNET:** `ArchUnitNET` is a more expressive alternative that supports fluent layering assertions and custom predicates. Use it if the team already depends on it; the rule intent is identical.

---

## 4. Rule-to-enforcement mapping

| BLOCK rule | Enforcement mechanism | Deterministic? |
|---|---|---|
| Module-isolation violation | NetArchTest / ArchUnitNET architecture test | Yes (build-time, CI) |
| Port/adapter direction violation (infra in Core/App) | NetArchTest `Core_has_no_dependency_on_Infrastructure` | Yes (build-time, CI) |
| EF entities in Core (Core refs EF namespace) | NetArchTest `Core_has_no_dependency_on_EfCore` | Yes (build-time, CI) |
| Business logic in endpoint handler | dotnet-cop review only — no stock analyzer covers this | **Review-only** |
| Missing `.AsNoTracking()` on read-only paths | dotnet-cop review only — no stock analyzer covers this | **Review-only** |
| Missing ProblemDetails mapping (raw 500) | dotnet-cop review only | **Review-only** |
| `FromSqlRaw`/`ExecuteSqlRaw` with string interpolation | CA2100 (error) + SonarAnalyzer S2077/S3649 (error) | Yes (build-time) |
| Nullable dereference / unjustified `!` | CS8600/CS8602/CS8604/CS8618/CS8625 (error) + `<Nullable>enable</Nullable>` | Yes (build-time) |
| Missing `CancellationToken` propagation | CA2016 (error) | Yes (build-time) |

Rules marked **Review-only** are not catchable by stock Roslyn analyzers or simple architectural-layer tests. They remain enforced exclusively by dotnet-cop pre-merge review and the coder self-check in [enforcement.md](enforcement.md). A custom Roslyn analyzer could cover them, but none is bundled here.
