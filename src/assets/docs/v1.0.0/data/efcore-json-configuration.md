---
title: EF Core 10 JSON Configuration
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
category: Data
order: 10
description: How Whizbang configures JSON serialization for EF Core JSONB columns via JsonContextRegistry and the turnkey NpgsqlDataSource registration
tags: efcore, json, jsonb, postgresql, npgsql, converters
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/Serialization/EFCoreJsonContext.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres/DbContextRegistrationRegistry.cs
  - src/Whizbang.Core/Lenses/PerspectiveRow.cs
testReferences:
  - tests/Whizbang.Core.Tests/JsonContextRegistryTests.cs
lastMaintainedCommit: '01f07906'
---

# EF Core 10 JSON Configuration

## Overview

EF Core 10 has native JSONB support for PostgreSQL. Whizbang stores perspective data, envelope metadata, and scope information in JSONB columns, and all of it must serialize with the same source-generated, AOT-compatible JSON configuration — including custom converters like the WhizbangId converters emitted by source generators.

The key pieces:

- **`JsonContextRegistry`** (Whizbang.Core) — a global, cross-assembly registry of source-generated `JsonSerializerContext` instances and converters. Each assembly self-registers via `[ModuleInitializer]` at load time — no reflection, fully AOT-compatible.
- **`JsonContextRegistry.CreateCombinedOptions()`** — builds a single `JsonSerializerOptions` from every registered context (Core infrastructure types, EF Core types, and your application types).
- **`EFCoreJsonContext`** (Whizbang.Data.EFCore.Postgres) — registers `EnvelopeMetadata` with the registry; exposes `CreateCombinedOptions()` as a convenience.

## Turnkey Configuration (Recommended)

With the turnkey pattern, JSON configuration is fully automatic. The source-generated registration callback creates the `NpgsqlDataSource` with the combined JSON options already applied:

```csharp{title="Turnkey Configuration" description="JSON options are configured automatically by the generated registration" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Turnkey"] unverified="turnkey DI registration (AddWhizbang().WithEFCore().WithDriver.Postgres); configuration wiring, not exercised by the JsonContextRegistry unit tests"}
// One line — the generated module initializer handles JSON configuration
builder.Services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;
```

Under the hood, the generated callback does the equivalent of:

```csharp{title="Generated Registration (simplified)" description="What the source-generated DbContext registration does for JSON" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Generated"] unverified="NpgsqlDataSourceBuilder configuration (ConfigureJsonOptions/EnableDynamicJson); Npgsql data-source wiring, not covered by the JsonContextRegistry unit tests"}
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
dataSourceBuilder.ConfigureJsonOptions(JsonContextRegistry.CreateCombinedOptions());
dataSourceBuilder.EnableDynamicJson();
// dataSourceBuilder.UseVector() is added automatically when [VectorField] columns exist
```

:::updated{version="1.0.0"}
Earlier drafts of this page recommended registering `JsonSerializerOptions` in DI and avoiding `NpgsqlDataSourceBuilder.ConfigureJsonOptions`. Shipped behavior is the opposite: the turnkey registration configures JSON at the **data source** level via `ConfigureJsonOptions(JsonContextRegistry.CreateCombinedOptions())` + `EnableDynamicJson()`. This is what guarantees that every JSONB read/write — EF Core queries, raw Npgsql commands, and the work-coordinator SQL surface — uses the identical converter set.
:::

## Registering Your Own Types and Converters

Frameworks and applications contribute their JSON contexts to the global registry from a module initializer:

```csharp{title="Registering a JsonSerializerContext" description="Self-registration via ModuleInitializer, mirroring EFCoreJsonContext" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Registration"] tests=["JsonContextRegistryTests.RegisterContext_WithoutProfile_AppliesToAllProfilesAsync"]}
[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(MyLensDto))]
public partial class MyAppJsonContext : JsonSerializerContext {
  [ModuleInitializer]
  internal static void Initialize() {
    JsonContextRegistry.RegisterContext(MyAppJsonContext.Default);
  }
}
```

`JsonContextRegistry` also supports:

- `RegisterConverter(JsonConverter converter)` — for converters that source generation can't express (e.g., WhizbangId converters); instances are created at compile time by source generators
- Priority + profile overloads (`RegisterContext(resolver, priority, profile)`) — infrastructure types from Core take precedence over application types; equal priorities preserve registration order

In practice you rarely write this by hand — the Whizbang source generators emit and register the contexts for your message and perspective types automatically.

## Example: Perspective Row Storage

Perspective rows store your read-model DTOs in JSONB columns using the fixed `PerspectiveRow<TModel>` shape:

```csharp{title="Example: Perspective Row Storage" description="PerspectiveRow<TModel> fields stored as JSONB" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Perspective", "Row"] unverified="type-shape illustration of PerspectiveRow of T stored as JSONB; the row shape itself, not behavior under test"}
public class PerspectiveRow<TModel> where TModel : class {
  public required Guid Id { get; init; }
  public required TModel Data { get; set; }              // JSONB
  public required PerspectiveMetadata Metadata { get; set; } // JSONB
  public required PerspectiveScope Scope { get; set; }   // JSONB
  public required DateTime CreatedAt { get; init; }
  public required DateTime UpdatedAt { get; set; }
  public required int Version { get; set; }
}
```

Because the data source carries the combined options, EF Core automatically:

- Serializes `TModel` to JSONB using your registered contexts and converters
- Applies custom converters (like WhizbangId converters) consistently on both reads and writes
- Stays AOT-compatible — no reflection-based serialization anywhere in the path

## Why Data-Source-Level Configuration

- **One converter set everywhere** — EF Core, Dapper, and raw `NpgsqlCommand` paths all flow through the same `NpgsqlDataSource`, so JSONB bytes are identical regardless of which layer wrote them
- **AOT-safe** — `CreateCombinedOptions()` composes only source-generated `IJsonTypeInfoResolver`s; there is no runtime reflection fallback
- **Zero per-service wiring** — the generated module initializer means consumers never hand-configure JSON for infrastructure types

## References

- [EF Core 10 JSON columns](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew#json-columns)
- [Npgsql EF Core provider](https://www.npgsql.org/efcore/)
