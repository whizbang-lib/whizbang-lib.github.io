---
title: 'WHIZ070: Missing Pgvector.EntityFrameworkCore Package'
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
---

# WHIZ070: Missing Pgvector.EntityFrameworkCore Package

**Severity**: Error
**Category**: Package Reference

## Description

This error is reported when a perspective model property has the `[VectorField]` attribute but the project does not reference the `Pgvector.EntityFrameworkCore` package. This package is required for EF Core to map vector columns to PostgreSQL's `vector` type.

## Diagnostic Message

```
Perspective model uses [VectorField] but Pgvector.EntityFrameworkCore package is not referenced. Add <PackageReference Include="Pgvector.EntityFrameworkCore" /> to use vector columns.
```

## Common Causes

1. **Forgot to add package reference** - Added `[VectorField]` attribute but didn't install the required NuGet package
2. **Package accidentally removed** - Package reference was removed during dependency cleanup
3. **Wrong package** - Referenced `Pgvector` base package but not the EF Core integration package

## How to Fix

Add the `Pgvector.EntityFrameworkCore` package reference to your project:

### Using .NET CLI

```bash
dotnet add package Pgvector.EntityFrameworkCore
```

### Using Package Manager Console

```powershell
Install-Package Pgvector.EntityFrameworkCore
```

### Using PackageReference in .csproj

```xml
<ItemGroup>
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

### Using Central Package Management

In `Directory.Packages.props`:

```xml
<ItemGroup>
  <PackageVersion Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

In your project file:

```xml
<ItemGroup>
  <PackageReference Include="Pgvector.EntityFrameworkCore" />
</ItemGroup>
```

## Code Example

### Before (causes WHIZ070)

```csharp
// Missing: <PackageReference Include="Pgvector.EntityFrameworkCore" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // WHIZ070: Package not referenced
  public float[]? Embedding { get; init; }
}
```

### After (compiles successfully)

```csharp
// Added: <PackageReference Include="Pgvector.EntityFrameworkCore" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // Works - package is referenced
  public float[]? Embedding { get; init; }
}
```

## Suppressing This Diagnostic

If you intentionally want to use `[VectorField]` without the EF Core package (e.g., for testing or code generation scenarios), add the assembly-level suppression attribute:

```csharp
[assembly: SuppressVectorPackageCheck]
```

Or use pragma suppression:

```csharp
#pragma warning disable WHIZ070
[VectorField(1536)]
public float[]? Embedding { get; init; }
#pragma warning restore WHIZ070
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

- [Vector Search](../features/vector-search.md) - Complete vector search documentation
- [VectorField Attribute](../features/vector-search.md#vectorfield-attribute) - Using the VectorField attribute
- [Turnkey Setup](../features/vector-search.md#turnkey-setup) - Automatic vector configuration
