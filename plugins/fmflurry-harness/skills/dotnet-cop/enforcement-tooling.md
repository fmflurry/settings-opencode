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

### ArchUnitNET for architecture enforcement

Add a test project referencing `ArchUnitNET` (per [ADR-0010](https://github.com/gc-platform/gc.platform/blob/main/docs/adr/0010-archunitnet-tests-architecture.md)):

```xml
<PackageReference Include="TngTech.ArchUnitNET" Version="0.13.3" />
<PackageReference Include="TngTech.ArchUnitNET.xUnitV3" Version="0.13.3" />
```

```csharp
// tests/GcPlatform.Api.Tests/Architecture/ArchitectureFixture.cs
using TngTech.ArchUnitNET.Core;
using TngTech.ArchUnitNET.Loader;
using Xunit;

public class ArchitectureFixture
{
    private static Architecture? _model;

    // Load assembly once and share across all tests
    public static Architecture Model => _model ??= new ArchLoader().LoadAssembly(typeof(Program).Assembly).Build();

    public class Layer
    {
        public static IObjectProvider<Class> Domain => 
            Model.Classes().That().ResideInNamespace("GcPlatform.*.Domain");

        public static IObjectProvider<Class> Application =>
            Model.Classes().That().ResideInNamespace("GcPlatform.*.Application");

        public static IObjectProvider<Class> Infrastructure =>
            Model.Classes().That().ResideInNamespace("GcPlatform.*.Infrastructure");

        public static IObjectProvider<Class> Presentation =>
            Model.Classes().That().ResideInNamespace("GcPlatform.*.Presentation");
    }

    public static IObjectProvider<Class> NoDependency => 
        Model.Classes().That().ResideInNamespace("Microsoft.EntityFrameworkCore")
            .Or().ResideInNamespace("Npgsql")
            .Or().ResideInNamespace("System.Net.Http");
}

// tests/GcPlatform.Api.Tests/Architecture/LayerDependencyRules.cs
using TngTech.ArchUnitNET.xUnit;
using Xunit;
using static GcPlatform.Api.Tests.Architecture.ArchitectureFixture;

public class LayerDependencyRules
{
    [Fact]
    public void Domain_depends_only_on_SharedKernel()
    {
        var rule = ArchRuleDefinition.Classes()
            .That().Are(Layer.Domain)
            .Should().NotDependOnAny(Layer.Infrastructure, ArchitectureFixture.NoDependency)
            .And().NotDependOnNamespaceMatching("GcPlatform.*.Application");

        rule.Check(Model);
    }

    [Fact]
    public void Application_does_not_depend_on_Infrastructure()
    {
        var rule = ArchRuleDefinition.Classes()
            .That().Are(Layer.Application)
            .Should().NotDependOnAny(Layer.Infrastructure, ArchitectureFixture.NoDependency);

        rule.Check(Model);
    }

    [Fact]
    public void Presentation_depends_only_inward()
    {
        var rule = ArchRuleDefinition.Classes()
            .That().Are(Layer.Presentation)
            .Should().NotDependOnAny(Layer.Domain, Layer.Application, Layer.Infrastructure);

        rule.Check(Model);
    }
}

// tests/GcPlatform.Api.Tests/Architecture/FrameworkIsolationRules.cs
using TngTech.ArchUnitNET.xUnit;
using Xunit;
using static GcPlatform.Api.Tests.Architecture.ArchitectureFixture;

public class FrameworkIsolationRules
{
    [Fact]
    public void EntityFrameworkCore_confined_to_Infrastructure()
    {
        var rule = ArchRuleDefinition.Classes()
            .That().Are(Layer.Domain.Or(Layer.Application))
            .Should().NotDependOnAny(Layer.Infrastructure)
            .And().NotDependOnNamespaceMatching("Microsoft.EntityFrameworkCore");

        rule.Check(Model);
    }

    [Fact]
    public void Npgsql_confined_to_Infrastructure()
    {
        var rule = ArchRuleDefinition.Classes()
            .That().Are(Layer.Domain.Or(Layer.Application))
            .Should().NotDependOnNamespaceMatching("Npgsql");

        rule.Check(Model);
    }
}

---

## 4. Rule-to-enforcement mapping

| BLOCK rule | Enforcement mechanism | Deterministic? |
|---|---|---|
| Module-isolation violation | ArchUnitNET / ArchUnitNET architecture test | Yes (build-time, CI) |
| Port/adapter direction violation (infra in Core/App) | ArchUnitNET `Core_has_no_dependency_on_Infrastructure` | Yes (build-time, CI) |
| EF entities in Core (Core refs EF namespace) | ArchUnitNET `Core_has_no_dependency_on_EfCore` | Yes (build-time, CI) |
| Business logic in endpoint handler | dotnet-cop review only — no stock analyzer covers this | **Review-only** |
| Missing `.AsNoTracking()` on read-only paths | dotnet-cop review only — no stock analyzer covers this | **Review-only** |
| Missing ProblemDetails mapping (raw 500) | dotnet-cop review only | **Review-only** |
| `FromSqlRaw`/`ExecuteSqlRaw` with string interpolation | CA2100 (error) + SonarAnalyzer S2077/S3649 (error) | Yes (build-time) |
| Nullable dereference / unjustified `!` | CS8600/CS8602/CS8604/CS8618/CS8625 (error) + `<Nullable>enable</Nullable>` | Yes (build-time) |
| Missing `CancellationToken` propagation | CA2016 (error) | Yes (build-time) |

Rules marked **Review-only** are not catchable by stock Roslyn analyzers or simple architectural-layer tests. They remain enforced exclusively by dotnet-cop pre-merge review and the coder self-check in [enforcement.md](enforcement.md). A custom Roslyn analyzer could cover them, but none is bundled here.
