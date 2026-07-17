---
title: 'WHIZ070: Missing Pgvector.EntityFrameworkCore Package'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Error diagnostic when a perspective model uses [VectorField] but the required
  Pgvector.EntityFrameworkCore package is not referenced
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - vector
  - pgvector
  - efcore
  - package-reference
codeReferences:
  - src/Whizbang.Generators/VectorDependencyAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/VectorFieldPackageReferenceAnalyzer.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/VectorDependencyAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorFieldPackageReferenceAnalyzerTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ070: Missing Pgvector.EntityFrameworkCore Package

**Severity**: Error
**Category**: Package Reference

## Description

This error is reported when a property has the `[VectorField]` attribute but the project does not reference the `Pgvector.EntityFrameworkCore` package. This package is required for EF Core to map vector columns to PostgreSQL's `vector` type.

Two analyzers ship this ID, and either (or both) can fire:

- **`VectorDependencyAnalyzer`** (in `Whizbang.Generators`) — fires on **any** property with `[VectorField]`, reported at the attribute's location.
- **`VectorFieldPackageReferenceAnalyzer`** (in `Whizbang.Data.EFCore.Postgres.Generators`) — fires once per compilation, at compilation end with no source location, when a non-abstract class implements `IPerspectiveFor<TModel, TEvent...>` (or `IPerspectiveWithActionsFor`/`IPerspectiveBase`) whose model has a `[VectorField]` property.

## Diagnostic Message

From `VectorDependencyAnalyzer` (per property):

```
Property 'Embedding' uses [VectorField] but Pgvector.EntityFrameworkCore package is not referenced. Add <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" /> to your .csproj file.
```

From `VectorFieldPackageReferenceAnalyzer` (once per compilation):

```
Perspective model uses [VectorField] but Pgvector.EntityFrameworkCore package is not referenced. Add <PackageReference Include="Pgvector.EntityFrameworkCore" /> to your project.
```

## Common Causes

1. **Forgot to add package reference** - Added `[VectorField]` attribute but didn't install the required NuGet package
2. **Package accidentally removed** - Package reference was removed during dependency cleanup
3. **Wrong package** - Referenced `Pgvector` base package but not the EF Core integration package

## How to Fix

Add the `Pgvector.EntityFrameworkCore` package reference to your project:

### Using .NET CLI

```bash{title="Using .NET CLI" description="Using .NET CLI" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", ".NET"]}
dotnet add package Pgvector.EntityFrameworkCore
```

### Using Package Manager Console

```powershell{title="Using Package Manager Console" description="Using Package Manager Console" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Package"]}
Install-Package Pgvector.EntityFrameworkCore
```

### Using PackageReference in .csproj

```xml{title="Using PackageReference in .csproj" description="Using PackageReference in .csproj" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "PackageReference"]}
<ItemGroup>
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

### Using Central Package Management

In `Directory.Packages.props`:

```xml{title="Using Central Package Management" description="In `Directory." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Central"]}
<ItemGroup>
  <PackageVersion Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

In your project file:

```xml{title="Using Central Package Management (2)" description="In your project file:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Central"]}
<ItemGroup>
  <PackageReference Include="Pgvector.EntityFrameworkCore" />
</ItemGroup>
```

## Code Example

### Before (causes WHIZ070)

```csharp{title="Before (causes WHIZ070)" description="Before (causes WHIZ070)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Before", "Causes"]}
// Missing: <PackageReference Include="Pgvector.EntityFrameworkCore" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // WHIZ070: Package not referenced
  public float[]? Embedding { get; init; }
}
```

### After (compiles successfully)

```csharp{title="After (compiles successfully)" description="After (compiles successfully)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "After", "Compiles"]}
// Added: <PackageReference Include="Pgvector.EntityFrameworkCore" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // Works - package is referenced
  public float[]? Embedding { get; init; }
}
```

## Suppressing This Diagnostic

If you intentionally want to use `[VectorField]` without the EF Core package (e.g., for testing or code generation scenarios), add the assembly-level suppression attribute (defined in `Whizbang.Core.Perspectives`):

```csharp{title="Suppressing This Diagnostic" description="If you intentionally want to use [VectorField] without the EF Core package (e." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
[assembly: SuppressVectorPackageCheck]
```

Note: `[assembly: SuppressVectorPackageCheck]` only silences the perspective-model check in `Whizbang.Data.EFCore.Postgres.Generators` (WHIZ070 and [WHIZ071](whiz071.md) from that analyzer). The per-property check in `Whizbang.Generators` is not affected by the attribute — suppress it with a pragma at the property:

```csharp{title="Suppressing This Diagnostic (2)" description="Pragma suppression for the per-property analyzer:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
#pragma warning disable WHIZ070
[VectorField(1536)]
public float[]? Embedding { get; init; }
#pragma warning restore WHIZ070
```

To silence both analyzers project-wide, set the severity to `none` in a global analyzer config file (`NoWarn` does not suppress Error-severity diagnostics, and the compilation-end variant has no source location, so pragmas cannot reach it):

```ini{title="Suppressing This Diagnostic (3)" description="Project-wide suppression via .globalconfig:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ070.severity = none
```

## Why This Matters

The `Pgvector.EntityFrameworkCore` package provides:

- **EF Core type mapping** - Maps `float[]` properties to PostgreSQL `vector` columns
- **UseVector() extension** - Configures EF Core options for pgvector support
- **Query translation** - Translates LINQ queries with vector operations to SQL

Without this package, EF Core cannot properly handle vector columns, leading to runtime errors.

## Related Diagnostics

- **[WHIZ071](whiz071.md)** - Missing base Pgvector package (for NpgsqlDataSourceBuilder.UseVector())

## See Also

- [Vector Search](../../extending/features/vector-search.md) - Complete vector search documentation
- [VectorField Attribute](../../extending/features/vector-search.md#vectorfield-attribute) - Using the VectorField attribute
- [Turnkey Setup](../../extending/features/vector-search.md#turnkey-setup) - Automatic vector configuration
