---
title: "WHIZ071: Missing Pgvector Package"
description: "Error diagnostic when a perspective model uses [VectorField] but the required base Pgvector package is not referenced"
category: "Diagnostics"
severity: "Error"
tags: ["diagnostics", "vector", "pgvector", "npgsql", "package-reference"]
---

# WHIZ071: Missing Pgvector Package

**Severity**: Error
**Category**: Package Reference

## Description

This error is reported when a perspective model property has the `[VectorField]` attribute but the project does not reference the base `Pgvector` package. This package is required for `NpgsqlDataSourceBuilder.UseVector()` support.

## Diagnostic Message

```
Perspective model uses [VectorField] but Pgvector package is not referenced. Add <PackageReference Include="Pgvector" /> for NpgsqlDataSourceBuilder.UseVector() support.
```

## Common Causes

1. **Forgot to add package reference** - Added `[VectorField]` attribute but didn't install the required NuGet package
2. **Only installed EF Core package** - Installed `Pgvector.EntityFrameworkCore` but not the base `Pgvector` package
3. **Package accidentally removed** - Package reference was removed during dependency cleanup

## How to Fix

Add the `Pgvector` package reference to your project:

### Using .NET CLI

```bash
dotnet add package Pgvector
```

### Using Package Manager Console

```powershell
Install-Package Pgvector
```

### Using PackageReference in .csproj

```xml
<ItemGroup>
  <PackageReference Include="Pgvector" Version="0.3.0" />
</ItemGroup>
```

### Using Central Package Management

In `Directory.Packages.props`:

```xml
<ItemGroup>
  <PackageVersion Include="Pgvector" Version="0.3.0" />
</ItemGroup>
```

In your project file:

```xml
<ItemGroup>
  <PackageReference Include="Pgvector" />
</ItemGroup>
```

## Required Packages

When using `[VectorField]`, you typically need **both** packages:

```xml
<ItemGroup>
  <!-- Base package for NpgsqlDataSourceBuilder.UseVector() -->
  <PackageReference Include="Pgvector" Version="0.3.0" />

  <!-- EF Core integration for type mapping and queries -->
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

## Code Example

### Before (causes WHIZ071)

```csharp
// Missing: <PackageReference Include="Pgvector" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // WHIZ071: Package not referenced
  public float[]? Embedding { get; init; }
}
```

### After (compiles successfully)

```csharp
// Added: <PackageReference Include="Pgvector" />

public record ProductDto {
  public Guid Id { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // Works - package is referenced
  public float[]? Embedding { get; init; }
}
```

## Suppressing This Diagnostic

If you intentionally want to use `[VectorField]` without the Pgvector package (e.g., for testing or code generation scenarios), add the assembly-level suppression attribute:

```csharp
[assembly: SuppressVectorPackageCheck]
```

Or use pragma suppression:

```csharp
#pragma warning disable WHIZ071
[VectorField(1536)]
public float[]? Embedding { get; init; }
#pragma warning restore WHIZ071
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

- [Vector Search](../features/vector-search.md) - Complete vector search documentation
- [VectorField Attribute](../features/vector-search.md#vectorfield-attribute) - Using the VectorField attribute
- [Turnkey Setup](../features/vector-search.md#turnkey-setup) - Automatic vector configuration
