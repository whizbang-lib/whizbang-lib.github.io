---
title: Schema Evolution & Event Versioning
category: Architecture & Design
order: 9
tags: schema-evolution, event-versioning, jsonb, upcasting, backward-compatibility
---

# Schema Evolution & Event Versioning

Whizbang provides robust schema evolution capabilities using JSONB storage and flexible driver interfaces, allowing events and projections to evolve over time without breaking existing systems.

## JSONB-Based Schema Evolution

### Flexible Event Schema

Events stored in **JSONB format** naturally support schema evolution:

```csharp{title="Event Schema Evolution" description="Event schema evolution from V1 to V3 with backward-compatible changes" category="Design" difficulty="INTERMEDIATE" tags=["Schema-Evolution", "Event-Versioning", "Backward-Compatibility"] framework="NET8"}
// V1 Event
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId
);

// V2 Event - Add field (backward compatible)
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    DateTimeOffset? PlacedAt = null  // Optional for backward compatibility
);

// V3 Event - Add collection (backward compatible)
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    DateTimeOffset? PlacedAt = null,
    List<string> Tags = null         // Null-safe collection
) {
    // Ensure collections are never null
    public List<string> Tags { get; init; } = Tags ?? new List<string>();
}
```

**JSONB benefits**:
- ✅ Missing fields handled gracefully
- ✅ Extra fields ignored during deserialization
- ✅ No database schema migrations required
- ✅ Query flexibility with JSON operators

### Projection Schema Evolution

Projections can evolve independently of events:

```csharp{title="Projection Schema Evolution" description="Projection schema evolution without database migrations using JSONB" category="Design" difficulty="INTERMEDIATE" tags=["Schema-Evolution", "Projections", "JSONB-Storage"] framework="NET8"}
// V1 Projection
public class OrderSummary {
    public Guid OrderId { get; set; }
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
}

// V2 Projection - Add fields without migration
public class OrderSummary {
    public Guid OrderId { get; set; }
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
    
    // New fields with sensible defaults
    public DateTime EstimatedDelivery { get; set; } = DateTime.MinValue;
    public List<string> Tags { get; set; } = new();
    public CustomerInfo Customer { get; set; } = new();
}

// Projection rebuild handles missing data gracefully
public class OrderSummaryProjection : IProjectionHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, ProjectionContext context) {
        var summary = await context.Load<OrderSummary>(@event.OrderId.ToString()) 
                      ?? new OrderSummary();
        
        summary.OrderId = @event.OrderId;
        summary.Total = @event.Total;
        
        // Handle optional V2+ fields
        if (@event.PlacedAt.HasValue) {
            summary.EstimatedDelivery = @event.PlacedAt.Value.AddDays(7);
        }
        
        if (@event.Tags?.Any() == true) {
            summary.Tags = @event.Tags;
        }
        
        await context.Store(@event.OrderId.ToString(), summary);
    }
}
```

## Event Versioning Strategies

### A. Upcasting (Recommended)

**Convert old events to new schema on read**:

```csharp{title="Event Upcaster Interface" description="Event upcasting interface for converting old events to new schemas" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Upcasting", "Event-Transformation", "Interface"] framework="NET8"}
public interface IEventUpcaster<TOld, TNew> {
    TNew Upcast(TOld oldEvent);
    bool CanUpcast(Type eventType, int version);
}

```csharp{title="Concrete Upcaster Implementation" description="Concrete upcaster implementation for event version migration" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Upcasting", "Implementation", "Registration"] framework="NET8"}
// Upcast V1 OrderPlaced to V2
public class OrderPlacedV1ToV2Upcaster : IEventUpcaster<OrderPlacedV1, OrderPlaced> {
    public OrderPlaced Upcast(OrderPlacedV1 oldEvent) {
        return new OrderPlaced(
            oldEvent.OrderId,
            oldEvent.CustomerId,
            PlacedAt: DateTimeOffset.UtcNow, // Best guess for missing data
            Tags: new List<string>()         // Default to empty
        );
    }
    
    public bool CanUpcast(Type eventType, int version) {
        return eventType == typeof(OrderPlacedV1) && version == 1;
    }
}

// Registration
services.AddWhizbang(options => {
    options.EventVersioning(versioning => {
        versioning.AddUpcaster<OrderPlacedV1ToV2Upcaster>();
        versioning.AddUpcaster<OrderPlacedV2ToV3Upcaster>();
    });
});
```

### B. Multiple Versions Supported Simultaneously

**Keep multiple event versions active**:

```csharp{title="Multiple Version Handlers" description="Supporting multiple event versions simultaneously with separate handlers" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Multiple-Versions", "Event-Handlers", "Registration"] framework="NET8"}
// Multiple handlers for different versions
public class OrderPlacedV1Handler : IEventHandler<OrderPlacedV1> {
    public async Task Handle(OrderPlacedV1 @event, EventContext context) {
        // Handle legacy V1 events
        var order = await _repository.Load<Order>(@event.OrderId);
        order.MarkAsPlaced(placedAt: DateTimeOffset.UtcNow); // Default timestamp
        await _repository.Save(order);
    }
}

public class OrderPlacedV2Handler : IEventHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, EventContext context) {
        // Handle current V2+ events
        var order = await _repository.Load<Order>(@event.OrderId);
        order.MarkAsPlaced(@event.PlacedAt ?? DateTimeOffset.UtcNow);
        await _repository.Save(order);
    }
}

// Router determines which handler to use based on event version
services.AddWhizbang(options => {
    options.EventVersioning(versioning => {
        versioning.RouteByVersion = true;
        versioning.RegisterHandler<OrderPlacedV1Handler>(version: 1);
        versioning.RegisterHandler<OrderPlacedV2Handler>(version: 2);
    });
});
```

### C. Schema Registry

**Centralized schema management**:

```csharp{title="Schema Registry Configuration" description="Centralized schema registry configuration for schema management" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Schema-Registry", "Centralized-Management", "Configuration"] framework="NET8"}
services.AddWhizbang(options => {
    options.EventVersioning(versioning => {
        versioning.UseSchemaRegistry(registry => {
            registry.ConnectionString = "https://schema-registry.company.com";
            registry.AutoRegisterSchemas = true;
            registry.ValidateOnWrite = true;
            registry.CompatibilityLevel = CompatibilityLevel.Backward;
        });
    });
});

// Events automatically registered with schema registry
[SchemaRegistration(subject: "order-placed", version: 2)]
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    DateTimeOffset? PlacedAt = null
);
```

## Driver Interface for Schema Evolution

### Abstract Driver Interface

```csharp{title="Schema Evolution Driver Interface" description="Driver interface for schema evolution with versioning and upcasting support" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Driver-Interface", "Serialization", "Versioning"] framework="NET8"}
public interface ISchemaEvolutionDriver {
    // Serialization with versioning
    Task<byte[]> Serialize<T>(T @event, int? version = null);
    Task<T> Deserialize<T>(byte[] data, int version);
    Task<object> DeserializeToLatestVersion(byte[] data, Type eventType, int storedVersion);
    
    // Schema registration
    Task RegisterSchema(Type eventType, int version);
    Task<SchemaInfo> GetSchema(Type eventType, int version);
    Task<IEnumerable<SchemaInfo>> GetSchemaEvolution(Type eventType);
    
    // Upcasting support
    Task<T> UpcastToLatest<T>(object oldEvent, int fromVersion);
    bool CanUpcast(Type eventType, int fromVersion, int toVersion);
}

public class SchemaInfo {
    public Type EventType { get; set; }
    public int Version { get; set; }
    public string Schema { get; set; }
    public DateTime RegisteredAt { get; set; }
    public CompatibilityLevel Compatibility { get; set; }
}
```

### PostgreSQL JSONB Driver Implementation

```csharp{title="PostgreSQL Schema Evolution Driver" description="PostgreSQL JSONB implementation of schema evolution driver with serialization and upcasting" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "PostgreSQL", "JSONB-Implementation", "Driver"] framework="NET8"}
public class PostgresSchemaEvolutionDriver : ISchemaEvolutionDriver {
    public async Task<byte[]> Serialize<T>(T @event, int? version = null) {
        var eventType = typeof(T);
        var currentVersion = version ?? await GetLatestVersion(eventType);
        
        var eventData = new {
            EventType = eventType.FullName,
            Version = currentVersion,
            Data = @event
        };
        
        return JsonSerializer.SerializeToUtf8Bytes(eventData);
    }
    
    public async Task<T> Deserialize<T>(byte[] data, int version) {
        var eventData = JsonSerializer.Deserialize<dynamic>(data);
        var storedVersion = (int)eventData.Version;
        
        if (storedVersion == version) {
            return JsonSerializer.Deserialize<T>(eventData.Data);
        }
        
        // Need to upcast
        var oldEvent = DeserializeToVersion(eventData.Data, typeof(T), storedVersion);
        return await UpcastToLatest<T>(oldEvent, storedVersion);
    }
    
    public async Task<object> DeserializeToLatestVersion(byte[] data, Type eventType, int storedVersion) {
        var latestVersion = await GetLatestVersion(eventType);
        
        if (storedVersion == latestVersion) {
            // Already latest version
            return JsonSerializer.Deserialize(data, eventType);
        }
        
        // Upcast to latest
        var oldEvent = DeserializeToVersion(data, eventType, storedVersion);
        return await UpcastToLatest(oldEvent, eventType, storedVersion, latestVersion);
    }
}
```

## LINQ Support Evolution

### Driver-Specific LINQ Implementation

```csharp{title="Query Evolution Driver Interface" description="Driver interface for schema-aware LINQ querying across versions" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "LINQ-Support", "Querying", "Interface"] framework="NET8"}
public interface IQueryEvolutionDriver {
    IQueryable<T> Query<T>() where T : class;
    IQueryable<T> QueryVersion<T>(int version) where T : class;
    IQueryable<object> QueryAllVersions(Type eventType);
}

```csharp{title="PostgreSQL Query Driver Implementation" description="PostgreSQL implementation with JSONB operators for evolved schemas" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "PostgreSQL", "JSONB-Queries", "EF-Core"] framework="NET8"}
// PostgreSQL implementation with JSONB operators
public class PostgresQueryDriver : IQueryEvolutionDriver {
    public IQueryable<T> Query<T>() where T : class {
        return _context.Events
            .Where(e => e.EventType == typeof(T).Name)
            .Select(e => JsonSerializer.Deserialize<T>(e.EventData))
            .AsQueryable();
    }
    
    // JSONB path queries for evolved schemas
    public IQueryable<OrderSummary> QueryOrdersWithTags() {
        return _context.Projections
            .Where(p => p.ProjectionName == "order-summary")
            .Where(p => EF.Functions.JsonExists(p.Document, "$.Tags"))  // Has tags field
            .Select(p => JsonSerializer.Deserialize<OrderSummary>(p.Document))
            .AsQueryable();
    }
    
    // Query across schema versions
    public IQueryable<decimal> QueryOrderTotals() {
        return _context.Events
            .Where(e => e.EventType == "OrderPlaced")
            .Select(e => EF.Functions.JsonExtract<decimal>(e.EventData, "$.Total"))
            .AsQueryable();
    }
}
```

### Schema-Aware Query Extensions

```csharp{title="Schema-Aware Query Extensions" description="Extension methods for schema-aware querying and filtering across versions" category="Design" difficulty="INTERMEDIATE" tags=["Schema-Evolution", "LINQ-Extensions", "Query-Helpers", "Extensions"] framework="NET8"}
public static class SchemaQueryExtensions {
    public static IQueryable<T> WhereSchemaVersion<T>(this IQueryable<T> query, int version) {
        // Filter by schema version
        return query.Where(/* version filter logic */);
    }
    
    public static IQueryable<T> WhereHasField<T>(this IQueryable<T> query, string fieldPath) {
        // Filter by field existence (JSONB support)
        return query.Where(/* field existence logic */);
    }
    
    public static IQueryable<TResult> SelectEvolved<T, TResult>(
        this IQueryable<T> query, 
        Expression<Func<T, TResult>> selector,
        SchemaEvolutionOptions options = null) {
        // Schema-aware projection
        return query.Select(/* evolved selector logic */);
    }
}

// Usage
var recentOrdersWithTags = await _context.Query<OrderSummary>()
    .WhereHasField("Tags")
    .Where(o => o.PlacedAt > DateTime.UtcNow.AddDays(-30))
    .ToListAsync();
```

## Blue/Green Deployment Support

### Driver-Level Blue/Green Implementation

```csharp{title="Blue/Green Deployment Driver" description="Driver interface and implementation for blue/green projection deployments" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Blue-Green-Deployment", "Driver-Interface", "PostgreSQL"] framework="NET8"}
public interface IBlueGreenDriver {
    Task<string> CreateGreenDeployment(string projectionName);
    Task BuildGreenProjection(string projectionName, string greenVersion);
    Task ValidateGreenProjection(string projectionName, string greenVersion);
    Task SwitchToGreen(string projectionName, string greenVersion);
    Task CleanupBlueVersion(string projectionName);
}

public class PostgresBlueGreenDriver : IBlueGreenDriver {
    public async Task<string> CreateGreenDeployment(string projectionName) {
        var greenVersion = Guid.NewGuid().ToString("N")[..8];
        var greenTableName = $"{projectionName}_green_{greenVersion}";
        
        // Create green table with same schema as blue
        await _connection.ExecuteAsync($"""
            CREATE TABLE {greenTableName} (LIKE {projectionName} INCLUDING ALL);
            CREATE INDEX CONCURRENTLY idx_{greenTableName}_tenant 
                ON {greenTableName}(tenant_id) WHERE tenant_id IS NOT NULL;
        """);
        
        return greenVersion;
    }
    
    public async Task BuildGreenProjection(string projectionName, string greenVersion) {
        var greenTableName = $"{projectionName}_green_{greenVersion}";
        
        // Rebuild projection in green table from events
        await _projectionBuilder.RebuildInTable(projectionName, greenTableName);
    }
    
    public async Task SwitchToGreen(string projectionName, string greenVersion) {
        var greenTableName = $"{projectionName}_green_{greenVersion}";
        var blueBackupName = $"{projectionName}_blue_backup_{DateTimeOffset.UtcNow:yyyyMMdd_HHmmss}";
        
        // Atomic table swap
        await _connection.ExecuteAsync($"""
            BEGIN;
            ALTER TABLE {projectionName} RENAME TO {blueBackupName};
            ALTER TABLE {greenTableName} RENAME TO {projectionName};
            COMMIT;
        """);
    }
}
```

## Configuration and Best Practices

### Comprehensive Schema Evolution Setup

```csharp{title="Comprehensive Schema Evolution Setup" description="Complete schema evolution configuration with all features enabled" category="Design" difficulty="ADVANCED" tags=["Schema-Evolution", "Configuration", "Comprehensive-Setup", "Best-Practices"] framework="NET8"}
services.AddWhizbang(options => {
    options.SchemaEvolution(evolution => {
        // Storage format
        evolution.UseJsonb = true;
        evolution.StoreSchemaVersion = true;
        evolution.ValidateOnWrite = false; // Allow forward compatibility
        
        // Versioning strategy
        evolution.VersioningStrategy = VersioningStrategy.Upcasting;
        evolution.AutoRegisterUpcasterts = true;
        evolution.UpcastOnRead = true;
        
        // Schema registry
        evolution.UseSchemaRegistry(registry => {
            registry.Url = "https://schema-registry.internal";
            registry.AutoRegister = true;
            registry.CompatibilityLevel = CompatibilityLevel.Backward;
        });
        
        // Blue/Green deployments
        evolution.BlueGreen(blueGreen => {
            blueGreen.ValidationThreshold = 0.99; // 99% accuracy required
            blueGreen.WarmupPeriod = TimeSpan.FromMinutes(5);
            blueGreen.AutoSwitch = false; // Manual approval required
        });
    });
});
```

### Event Versioning Best Practices

```csharp{title="Event Versioning Best Practices" description="Best practices for event versioning and backward-compatible schema evolution" category="Design" difficulty="INTERMEDIATE" tags=["Schema-Evolution", "Best-Practices", "Backward-Compatibility", "Versioning"] framework="NET8"}
// 1. Always make fields optional when adding them
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    DateTimeOffset? PlacedAt = null,      // Optional - added in V2
    List<string>? Tags = null             // Optional - added in V3
);

// 2. Use wrapper types for complex evolution
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    OrderMetadata? Metadata = null        // Wrapper for evolving fields
);

public record OrderMetadata(
    DateTimeOffset? PlacedAt = null,
    List<string>? Tags = null,
    CustomerInfo? Customer = null
);

// 3. Never remove fields - mark as obsolete
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    
    [Obsolete("Use Metadata.PlacedAt instead")]
    DateTimeOffset? PlacedAt = null,      // Keep for backward compatibility
    
    OrderMetadata? Metadata = null
);

// 4. Use semantic versioning for breaking changes
[EventVersion("order-placed", "1.0.0")]
public record OrderPlacedV1(Guid OrderId, Guid CustomerId);

[EventVersion("order-placed", "1.1.0")]  // Minor version - additive
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset? PlacedAt = null);

[EventVersion("order-placed", "2.0.0")]  // Major version - breaking change
public record OrderPlacedV2(Guid OrderId, CustomerId CustomerId, DateTimeOffset PlacedAt);
```

### Projection Evolution Guidelines

1. **Add fields with defaults** - New fields should have sensible default values
2. **Rebuild for major changes** - Use blue/green deployment for breaking changes
3. **Test evolution paths** - Verify old events work with new projections
4. **Monitor data quality** - Track schema evolution impact on data
5. **Document changes** - Keep clear records of schema evolution decisions

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - Core storage architecture
- [**Projection Management**](./projection-management.md) - Backfilling and rebuilding strategies
- [**Advanced Features**](./advanced-features.md) - Cross-aggregate transactions and distributed tracing