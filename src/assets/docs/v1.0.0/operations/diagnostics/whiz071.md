---
title: 'WHIZ071: Missing Pgvector Package'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Error diagnostic when a perspective model uses [VectorField] but the required
  base Pgvector package is not referenced
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - vector
  - pgvector
  - npgsql
  - package-reference
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/VectorFieldPackageReferenceAnalyzer.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/SuppressVectorPackageCheckAttribute.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorFieldPackageReferenceAnalyzerTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ071: Missing Pgvector Package

**Severity**: Error
**Category**: Package Reference

## Description

This error is reported by the `VectorFieldPackageReferenceAnalyzer` (in `Whizbang.Data.EFCore.Postgres.Generators`) when a perspective model property has the `[VectorField]` attribute but the project does not reference the base `Pgvector` package. This package is required for `NpgsqlDataSourceBuilder.UseVector()` support.

The check fires when a non-abstract class implements `IPerspectiveFor<TModel, TEvent...>` (or `IPerspectiveWithActionsFor`/`IPerspectiveBase`) whose model type has a `[VectorField]` property. It is reported once per compilation, at compilation end, with no source location. A `[VectorField]` on a model that no perspective uses does not trigger it.

## Diagnostic Message

```
Perspective model uses [VectorField] but Pgvector package is not referenced. Add <PackageReference Include="Pgvector" /> to your project.
```

:::updated
The diagnostic ID `WHIZ071` is also used by `Whizbang.Generators` for an unrelated **Info** diagnostic, "Polymorphic Base Type Discovered" (see [Polymorphic Serialization](../../extending/source-generators/polymorphic-serialization.md)). If you see WHIZ071 as an informational build message rather than an error, it is that diagnostic, not this one.
:::

## Common Causes

1. **Forgot to add package reference** - Added `[VectorField]` attribute but didn't install the required NuGet package
2. **Only installed EF Core package** - Installed `Pgvector.EntityFrameworkCore` but not the base `Pgvector` package
3. **Package accidentally removed** - Package reference was removed during dependency cleanup

## How to Fix

Add the `Pgvector` package reference to your project:

### Using .NET CLI

```bash{title="Using .NET CLI" description="Using .NET CLI" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", ".NET"]}
dotnet add package Pgvector
```

### Using Package Manager Console

```powershell{title="Using Package Manager Console" description="Using Package Manager Console" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Package"]}
Install-Package Pgvector
```

### Using PackageReference in .csproj

```xml{title="Using PackageReference in .csproj" description="Using PackageReference in .csproj" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "PackageReference"]}
<ItemGroup>
  <PackageReference Include="Pgvector" Version="0.3.0" />
</ItemGroup>
```

### Using Central Package Management

In `Directory.Packages.props`:

```xml{title="Using Central Package Management" description="In `Directory." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Central"]}
<ItemGroup>
  <PackageVersion Include="Pgvector" Version="0.3.0" />
</ItemGroup>
```

In your project file:

```xml{title="Using Central Package Management (2)" description="In your project file:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Using", "Central"]}
<ItemGroup>
  <PackageReference Include="Pgvector" />
</ItemGroup>
```

## Required Packages

When using `[VectorField]`, you typically need **both** packages:

```xml{title="Required Packages" description="When using [VectorField], you typically need both packages:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Required", "Packages"]}
<ItemGroup>
  <!-- Base package for NpgsqlDataSourceBuilder.UseVector() -->
  <PackageReference Include="Pgvector" Version="0.3.0" />

  <!-- EF Core integration for type mapping and queries -->
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

## Code Example

### Before (causes WHIZ071)

```csharp{title="Before (causes WHIZ071)" description="Before (causes WHIZ071)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Before", "Causes"]}
// Missing: <PackageReference Include="Pgvector" />

public record ProductDto {
  [StreamId]
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // WHIZ071: Package not referenced
  public float[]? Embedding { get; init; }
}

// The model must be used by a perspective for the check to fire
public class ProductPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
  public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) => /* ... */;
}
```

### After (compiles successfully)

```csharp{title="After (compiles successfully)" description="After (compiles successfully)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "After", "Compiles"]}
// Added: <PackageReference Include="Pgvector" />

public record ProductDto {
  [StreamId]
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // Works - package is referenced
  public float[]? Embedding { get; init; }
}
```

## Suppressing This Diagnostic

If you intentionally want to use `[VectorField]` without the Pgvector package (e.g., for testing or code generation scenarios), add the assembly-level suppression attribute (defined in `Whizbang.Core.Perspectives`). It disables this analyzer entirely (both WHIZ070 and WHIZ071):

```csharp{title="Suppressing This Diagnostic" description="If you intentionally want to use [VectorField] without the Pgvector package (e." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
[assembly: SuppressVectorPackageCheck]
```

Pragma suppression does **not** work for this diagnostic — it is reported at compilation end with no source location, which `#pragma warning` regions cannot reach. To suppress it without the attribute, set the severity to `none` in a global analyzer config file:

```ini{title="Suppressing This Diagnostic (2)" description="Project-wide suppression via .globalconfig:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ071.severity = none
```

## Why This Matters

The base `Pgvector` package provides:

- **Npgsql type handler** - Enables Npgsql to read/write PostgreSQL vector types
- **UseVector() extension** - Configures `NpgsqlDataSourceBuilder` for vector support
- **Vector type** - The `Pgvector.Vector` type for direct vector manipulation

Without this package, Npgsql cannot serialize or deserialize vector data, leading to runtime errors when reading or writing vector columns.

## Related Diagnostics

- **[WHIZ070](whiz070.md)** - Missing Pgvector.EntityFrameworkCore package (for EF Core integration)

## See Also

- [Vector Search](../../extending/features/vector-search.md) - Complete vector search documentation
- [VectorField Attribute](../../extending/features/vector-search.md#vectorfield-attribute) - Using the VectorField attribute
- [Turnkey Setup](../../extending/features/vector-search.md#turnkey-setup) - Automatic vector configuration
