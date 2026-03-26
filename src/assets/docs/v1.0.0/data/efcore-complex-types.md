---
title: EF Core Complex Types
version: 1.0.0
category: Data Access
order: 3
description: >-
  EF Core 10 ComplexProperty().ToJson() patterns for perspective metadata and
  scope - in-place updates, collection handling, and index corruption prevention
tags: >-
  ef-core, complex-types, json, jsonb, perspectives, metadata, scope,
  in-place-updates, complexproperty
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs
  - src/Whizbang.Core/Lenses/PerspectiveMetadata.cs
  - src/Whizbang.Core/Lenses/PerspectiveScope.cs
  - src/Whizbang.Core/Lenses/PerspectiveRow.cs
lastMaintainedCommit: '01f07906'
---

# EF Core Complex Types

Whizbang perspective rows store three JSON columns: `data` (the read model), `metadata` (event information), and `scope` (multi-tenancy/security). EF Core 10's `ComplexProperty().ToJson()` maps these columns with full LINQ query support, but requires careful handling to avoid tracking index corruption.

## PerspectiveRow Structure

Every perspective table follows the same schema:

```csharp{title="PerspectiveRow" description="Generic perspective row with JSON columns" category="Architecture" difficulty="BEGINNER" tags=["Data", "EF Core", "PerspectiveRow"]}
public class PerspectiveRow<TModel> where TModel : class {
  public required Guid Id { get; init; }
  public required TModel Data { get; set; }
  public required PerspectiveMetadata Metadata { get; set; }
  public required PerspectiveScope Scope { get; set; }
  public required DateTime CreatedAt { get; init; }
  public required DateTime UpdatedAt { get; set; }
  public required int Version { get; set; }
}
```

## ComplexProperty().ToJson() Configuration

Map the JSON columns in your `DbContext`:

```csharp{title="ComplexProperty ToJson Configuration" description="Configure ComplexProperty().ToJson() for perspective columns" category="Configuration" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "ComplexProperty", "ToJson"]}
protected override void OnModelCreating(ModelBuilder modelBuilder) {
  modelBuilder.Entity<PerspectiveRow<OrderModel>>(entity => {
    entity.ToTable("wh_per_order");
    entity.HasKey(e => e.Id);

    // Data column - OwnsOne for the read model
    entity.OwnsOne(e => e.Data, data => data.ToJson("data"));

    // Metadata and Scope - ComplexProperty for full LINQ support
    entity.ComplexProperty(e => e.Metadata, m => m.ToJson("metadata"));
    entity.ComplexProperty(e => e.Scope, s => s.ToJson("scope"));
  });
}
```

This enables full server-side LINQ queries against all three JSON columns:

```csharp{title="LINQ Queries on JSON Columns" description="Query across data, metadata, and scope JSON columns" category="Usage" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "LINQ", "JSON"]}
// Filter by data fields
var highValueOrders = await context.Set<PerspectiveRow<OrderModel>>()
    .Where(r => r.Data.Amount > 1000)
    .ToListAsync();

// Filter by metadata
var recentEvents = await context.Set<PerspectiveRow<OrderModel>>()
    .Where(r => r.Metadata.Timestamp > DateTime.UtcNow.AddDays(-7))
    .ToListAsync();

// Filter by scope
var tenantOrders = await context.Set<PerspectiveRow<OrderModel>>()
    .Where(r => r.Scope.TenantId == "tenant-123")
    .ToListAsync();

// Query scope extensions
var usWestOrders = await context.Set<PerspectiveRow<OrderModel>>()
    .Where(r => r.Scope.Extensions.Any(e => e.Key == "region" && e.Value == "us-west"))
    .ToListAsync();
```

## Type Design Rules

EF Core 10's `ComplexProperty().ToJson()` has specific requirements for mapped types:

### Use Classes, Not Records

Records have generated copy-constructors that can cause `NullReferenceException` during EF Core query materialization. Both `PerspectiveMetadata` and `PerspectiveScope` are classes:

```csharp{title="Class Design for ComplexProperty" description="Classes with parameterless constructors for EF Core compatibility" category="Architecture" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "ComplexProperty", "Design"]}
// CORRECT: class with parameterless constructor
public class PerspectiveMetadata {
  public PerspectiveMetadata() { }

  public string EventType { get; set; } = string.Empty;
  public string EventId { get; set; } = string.Empty;
  public DateTime Timestamp { get; set; }
  public string? CorrelationId { get; set; }
  public string? CausationId { get; set; }
}

// WRONG: record with copy-constructor causes NullReferenceException
// public record PerspectiveMetadata(string EventType, ...);
```

### Use List, Not Dictionary

EF Core does NOT support `Dictionary<TKey, TValue>` with `ToJson()` ([GitHub #29825](https://github.com/dotnet/efcore/issues/29825)). Use `List<T>` with a key-value wrapper:

```csharp{title="ScopeExtension Key-Value Pattern" description="List of key-value objects instead of Dictionary for ToJson() compatibility" category="Architecture" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "ComplexProperty", "Collections"]}
// CORRECT: List<ScopeExtension> works with ToJson()
public class ScopeExtension {
  public ScopeExtension() { }
  public ScopeExtension(string key, string? value) {
    Key = key;
    Value = value;
  }

  [JsonPropertyName("k")]
  public string Key { get; set; } = string.Empty;

  [JsonPropertyName("v")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string? Value { get; set; }
}

public class PerspectiveScope {
  // Extensions as List for ToJson() compatibility
  public List<ScopeExtension> Extensions { get; set; } = [];

  // WRONG: Dictionary is NOT supported with ToJson()
  // public Dictionary<string, string?> Extensions { get; set; } = new();
}
```

### Use `set`, Not `init`

Properties mapped via `ComplexProperty` need `set` accessors for EF Core materialization:

```csharp{title="Accessor Requirements" description="Use set accessors for EF Core ComplexProperty materialization" category="Architecture" difficulty="BEGINNER" tags=["Data", "EF Core", "ComplexProperty", "Accessors"]}
public class PerspectiveRow<TModel> where TModel : class {
  // init is fine for non-complex columns
  public required Guid Id { get; init; }
  public required DateTime CreatedAt { get; init; }

  // set is REQUIRED for ComplexProperty mapped columns
  public required TModel Data { get; set; }
  public required PerspectiveMetadata Metadata { get; set; }
  public required PerspectiveScope Scope { get; set; }
}
```

## In-Place Updates

EF Core 10's `ComplexProperty().ToJson()` maintains internal indexes for collections inside complex types. Replacing `List` instances on a tracked entity corrupts these indexes, causing `ArgumentOutOfRangeException` during `SaveChangesAsync`. The `BaseUpsertStrategy` provides two approaches:

### Detach-and-Reattach (Default Strategy)

The primary upsert strategy avoids the problem entirely by detaching tracked entities and querying with `AsNoTracking()`:

```csharp{title="Detach-and-Reattach Pattern" description="Avoid tracking corruption by detaching and using AsNoTracking" category="Architecture" difficulty="ADVANCED" tags=["Data", "EF Core", "ComplexProperty", "Upsert"]}
// 1. Detach any locally tracked entity
var localRow = context.Set<PerspectiveRow<TModel>>().Local
    .FirstOrDefault(r => r.Id == id);
if (localRow != null) {
  context.Entry(localRow).State = EntityState.Detached;
}

// 2. Query WITHOUT tracking -- clean entity with no internal state
var existingRow = await context.Set<PerspectiveRow<TModel>>()
    .AsNoTracking()
    .FirstOrDefaultAsync(r => r.Id == id, ct);

// 3. Create a new row instance with cloned complex types
var row = new PerspectiveRow<TModel> {
  Id = existingRow.Id,
  Data = model,
  Metadata = CloneMetadata(metadata),
  Scope = CloneScope(scope),
  CreatedAt = existingRow.CreatedAt,
  UpdatedAt = DateTime.UtcNow,
  Version = existingRow.Version + 1
};
context.Set<PerspectiveRow<TModel>>().Update(row);
```

### UpdateMetadataInPlace / UpdateScopeInPlace

For scenarios where entities are already tracked, in-place update methods modify properties on the **existing object instances** without replacing the `List` references:

```csharp{title="UpdateMetadataInPlace" description="Update metadata properties without replacing the object" category="Architecture" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "ComplexProperty", "In-Place"]}
protected static void UpdateMetadataInPlace(PerspectiveMetadata target, PerspectiveMetadata source) {
  target.EventType = source.EventType;
  target.EventId = source.EventId;
  target.Timestamp = source.Timestamp;
  target.CorrelationId = source.CorrelationId;
  target.CausationId = source.CausationId;
}
```

```csharp{title="UpdateScopeInPlace" description="Update scope properties while preserving List instances" category="Architecture" difficulty="ADVANCED" tags=["Data", "EF Core", "ComplexProperty", "In-Place", "Collections"]}
protected static void UpdateScopeInPlace(PerspectiveScope target, PerspectiveScope source) {
  // Scalar properties -- safe to assign directly
  target.TenantId = source.TenantId;
  target.CustomerId = source.CustomerId;
  target.UserId = source.UserId;
  target.OrganizationId = source.OrganizationId;

  // CRITICAL: Clear and re-add items, DO NOT replace the List instances
  // Replacing the List corrupts EF Core's InternalComplexCollectionEntry indexes
  target.AllowedPrincipals.Clear();
  foreach (var principal in source.AllowedPrincipals) {
    target.AllowedPrincipals.Add(principal);
  }

  target.Extensions.Clear();
  foreach (var extension in source.Extensions) {
    target.Extensions.Add(new ScopeExtension(extension.Key, extension.Value));
  }
}
```

**Why this matters**: EF Core's `InternalComplexCollectionEntry` maintains indexes into the `List` instances that are part of the complex type. When you do `target.AllowedPrincipals = newList`, the old indexes point to the replaced list while EF Core's internal state still references the original. On `SaveChangesAsync`, EF Core tries to access items by stale indexes, throwing `ArgumentOutOfRangeException`.

## Clone Methods

When creating new `PerspectiveRow` instances (e.g., during upsert), complex types must be cloned to avoid sharing references:

```csharp{title="CloneMetadata" description="Create an independent copy of PerspectiveMetadata" category="Architecture" difficulty="BEGINNER" tags=["Data", "EF Core", "Clone"]}
protected static PerspectiveMetadata CloneMetadata(PerspectiveMetadata metadata) {
  return new PerspectiveMetadata {
    EventType = metadata.EventType,
    EventId = metadata.EventId,
    Timestamp = metadata.Timestamp,
    CorrelationId = metadata.CorrelationId,
    CausationId = metadata.CausationId
  };
}
```

```csharp{title="CloneScope" description="Create an independent copy of PerspectiveScope with new List instances" category="Architecture" difficulty="INTERMEDIATE" tags=["Data", "EF Core", "Clone"]}
protected static PerspectiveScope CloneScope(PerspectiveScope scope) {
  return new PerspectiveScope {
    TenantId = scope.TenantId,
    CustomerId = scope.CustomerId,
    UserId = scope.UserId,
    OrganizationId = scope.OrganizationId,
    AllowedPrincipals = [.. scope.AllowedPrincipals],
    Extensions = [.. scope.Extensions]
  };
}
```

## Summary

| Pattern | When to Use | Key Constraint |
|---------|-------------|----------------|
| `ComplexProperty().ToJson()` | Map JSON columns with LINQ support | Classes only, no records |
| `List<ScopeExtension>` | Key-value extensions in JSON | No Dictionary with ToJson |
| Detach-and-reattach | Primary upsert path | Query with `AsNoTracking()` |
| `UpdateMetadataInPlace` | Updating tracked metadata | Copy all properties |
| `UpdateScopeInPlace` | Updating tracked scope | Clear+Add, never replace List |
| `CloneMetadata` / `CloneScope` | Creating new rows | Avoid shared references |

See [EF Core Integration](efcore-integration.md) for broader EF Core setup and configuration.
