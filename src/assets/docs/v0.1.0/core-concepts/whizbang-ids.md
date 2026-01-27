# WhizbangIds: Strongly-Typed Identity Values

Whizbang uses strongly-typed identity values based on UUIDv7 for all identifiers. This provides type safety, prevents ID mixing mistakes, and enables AOT-compatible dependency injection.

## Overview

**WhizbangIds** are source-generated value types that:
- ✅ Wrap UUIDv7 GUIDs for time-ordered, database-friendly identities
- ✅ Provide compile-time type safety (can't mix OrderId with CustomerId)
- ✅ Support both static and DI-based ID generation
- ✅ Are fully AOT-compatible (zero reflection)
- ✅ Auto-register with DI via ModuleInitializer

## TrackedGuid: Metadata-Aware GUID Wrapper

For scenarios where you need to work with raw GUIDs while preserving generation metadata, Whizbang provides `TrackedGuid`:

```csharp
using Whizbang.Core.ValueObjects;

// Create with sub-millisecond precision (recommended)
var tracked = TrackedGuid.NewMedo();  // Uses Medo.Uuid7 internally

// Check metadata
bool isTimeOrdered = tracked.IsTimeOrdered;           // true
bool subMs = tracked.SubMillisecondPrecision;         // true
DateTimeOffset when = tracked.Timestamp;              // Extracted from UUIDv7

// Implicit conversion to Guid
Guid guid = tracked;

// Parse from external sources (database, API)
var parsed = TrackedGuid.Parse("550e8400-e29b-41d4-a716-446655440000");
var external = TrackedGuid.FromExternal(someGuid);
```

### Why TrackedGuid?

| Feature | `Guid.NewGuid()` | `Guid.CreateVersion7()` | `TrackedGuid.NewMedo()` |
|---------|------------------|-------------------------|-------------------------|
| Time-ordered | ❌ No (v4) | ✅ Yes (v7) | ✅ Yes (v7) |
| Sub-millisecond precision | ❌ N/A | ❌ No (ms only) | ✅ Yes |
| Metadata preserved | ❌ No | ❌ No | ✅ Yes |
| Monotonic counter | ❌ No | ❌ No | ✅ Yes |
| Database index friendly | ❌ Poor | ✅ Good | ✅ Excellent |

**Recommendation**: Use `[WhizbangId]` types for domain identities, `TrackedGuid` for infrastructure code that needs GUID flexibility with metadata preservation.

## Roslyn Analyzers (WHIZ055-WHIZ056)

Whizbang includes Roslyn analyzers that detect problematic GUID generation patterns:

### WHIZ055: Guid.NewGuid() Usage

```csharp
// ⚠️ Warning: Use TrackedGuid.NewMedo() or a [WhizbangId] type instead
var id = Guid.NewGuid();  // WHIZ055

// ✅ Fix: Use TrackedGuid
var id = TrackedGuid.NewMedo();

// ✅ Or use strongly-typed ID
var orderId = OrderId.New();
```

**Why**: `Guid.NewGuid()` creates UUIDv4 (random) which is not time-ordered and fragments database indexes.

### WHIZ056: Guid.CreateVersion7() Usage

```csharp
// ⚠️ Warning: Use TrackedGuid.NewMedo() for sub-millisecond precision
var id = Guid.CreateVersion7();  // WHIZ056

// ✅ Fix: Use TrackedGuid for sub-millisecond precision
var id = TrackedGuid.NewMedo();
```

**Why**: `Guid.CreateVersion7()` only has millisecond precision. In high-throughput scenarios, multiple IDs within the same millisecond may not sort correctly.

### Suppressing Analyzer Warnings

For legitimate cases where you need raw GUID operations:

```csharp
// Suppress for specific line
#pragma warning disable WHIZ055
var testId = Guid.NewGuid();  // Intentional for test fixture
#pragma warning restore WHIZ055

// Or suppress in project file (for test projects)
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ055;WHIZ056</NoWarn>
</PropertyGroup>
```

## Quick Start

### Defining a WhizbangId

```csharp
using Whizbang.Core;

[WhizbangId]
public readonly partial struct OrderId;

[WhizbangId]
public readonly partial struct CustomerId;
```

The `[WhizbangId]` attribute triggers source generation that creates:
- Value object with `Value` property (Guid)
- `New()` static method for creating new IDs
- `From(Guid)` static method for wrapping existing GUIDs
- `Parse(string)` method for deserialization
- Equality operators and `IComparable<T>`
- Implicit conversion to Guid
- JSON converter
- **Strongly-typed provider** (`IWhizbangIdProvider<TId>`)
- **Auto-registration** via ModuleInitializer

### Using WhizbangIds

```csharp
// Static creation (uses global WhizbangIdProvider)
var orderId = OrderId.New();

// From existing GUID
var existingId = OrderId.From(guid);

// Parse from string
var parsedId = OrderId.Parse("3c5e4...");

// Implicit conversion to Guid
Guid guid = orderId;

// Get underlying Guid
Guid underlyingGuid = orderId.Value;
```

## Strongly-Typed ID Providers

### The Problem: Generic Code Needs Type-Safe IDs

When writing generic services or utilities, you need type-safe ID generation:

```csharp
// ❌ WRONG: Loses type safety
public class Repository<TEntity> {
    private readonly IWhizbangIdProvider _idProvider;

    public async Task<TEntity> CreateAsync(TEntity entity) {
        entity.Id = _idProvider.NewGuid(); // Returns Guid - not type-safe!
    }
}

// ✅ CORRECT: Type-safe with IWhizbangIdProvider<TId>
public class Repository<TEntity, TId>
    where TId : struct {

    private readonly IWhizbangIdProvider<TId> _idProvider;

    public async Task<TEntity> CreateAsync(TEntity entity) {
        entity.Id = _idProvider.NewId(); // Returns TId - type-safe!
    }
}
```

### Interface: `IWhizbangIdProvider<TId>`

```csharp
/// <summary>
/// Strongly-typed provider for generating WhizbangId instances.
/// </summary>
public interface IWhizbangIdProvider<TId> where TId : struct {
    /// <summary>
    /// Generates a new strongly-typed ID instance.
    /// </summary>
    TId NewId();
}
```

### How It Works

1. **Source Generation**: For each `[WhizbangId]`, the generator creates:
   - `OrderIdProvider` class implementing `IWhizbangIdProvider<OrderId>`
   - Auto-registration in `WhizbangIdProviderRegistration.g.cs`

2. **ModuleInitializer**: Runs when assembly loads, registers all providers
   ```csharp
   [ModuleInitializer]
   public static void Initialize() {
       WhizbangIdProviderRegistry.RegisterFactory<OrderId>(
           baseProvider => new OrderIdProvider(baseProvider)
       );
   }
   ```

3. **DI Integration**: `AddWhizbangIdProviders()` registers all typed providers
   ```csharp
   services.AddSingleton<IWhizbangIdProvider<OrderId>>(
       sp => new OrderIdProvider(sp.GetRequiredService<IWhizbangIdProvider>())
   );
   ```

## 10+ Provider Registration Patterns

### 1. Auto-Register All Providers (Recommended)

**When**: Standard application setup

```csharp
var builder = WebApplication.CreateBuilder(args);

// Registers IWhizbangIdProvider (Uuid7IdProvider by default)
// AND all IWhizbangIdProvider<TId> for discovered WhizbangIds
builder.Services.AddWhizbangIdProviders();

var app = builder.Build();
```

**What gets registered**:
- `IWhizbangIdProvider` → `Uuid7IdProvider` (singleton)
- `IWhizbangIdProvider<OrderId>` → `OrderIdProvider` (singleton)
- `IWhizbangIdProvider<CustomerId>` → `CustomerIdProvider` (singleton)
- ... (all WhizbangIds in all loaded assemblies)

### 2. Custom Base Provider

**When**: Using database sequences, tenant-specific IDs, or custom ID generation

```csharp
// Custom ID generator
public class SequenceBasedIdProvider : IWhizbangIdProvider {
    private readonly IDbConnection _db;

    public Guid NewGuid() {
        var sequence = _db.GetNextSequence("id_sequence");
        return GuidFromSequence(sequence);
    }
}

// Register custom provider
builder.Services.AddSingleton<IWhizbangIdProvider, SequenceBasedIdProvider>();
builder.Services.AddWhizbangIdProviders();
// Now ALL typed providers use SequenceBasedIdProvider
```

### 3. Override Specific ID Types

**When**: Some IDs need special generation (e.g., CustomerIds from external system)

```csharp
builder.Services.AddWhizbangIdProviders();

// Override CustomerIdProvider
builder.Services.AddSingleton<IWhizbangIdProvider<CustomerId>>(sp => {
    var externalSystem = sp.GetRequiredService<IExternalCustomerService>();
    return new ExternalCustomerIdProvider(externalSystem);
});
```

### 4. Test Project Overrides

**When**: Tests need deterministic or custom IDs

```csharp
// Test setup
var services = new ServiceCollection();

// Use sequential IDs for tests
services.AddSingleton<IWhizbangIdProvider, SequentialTestIdProvider>();
services.AddWhizbangIdProviders();

// All typed providers now use SequentialTestIdProvider
var provider = services.BuildServiceProvider();
var orderIdProvider = provider.GetRequiredService<IWhizbangIdProvider<TestOrderId>>();
var id1 = orderIdProvider.NewId(); // TestOrderId(00000000-0000-0000-0000-000000000001)
var id2 = orderIdProvider.NewId(); // TestOrderId(00000000-0000-0000-0000-000000000002)
```

### 5. No DI - Direct Provider Creation

**When**: Console apps, scripts, or areas without DI

```csharp
// Create typed provider directly
var baseProvider = new Uuid7IdProvider();
var orderIdProvider = OrderId.CreateProvider(baseProvider);

var orderId = orderIdProvider.NewId();
```

### 6. Global Provider Configuration

**When**: Want to use global static provider AND DI

```csharp
// Configure global provider (affects OrderId.New())
WhizbangIdProvider.Configure(new Uuid7IdProvider());

// ALSO register with DI (for injection)
builder.Services.AddWhizbangIdProviders();

// Now works both ways:
var id1 = OrderId.New(); // Uses global provider
var id2 = orderIdProvider.NewId(); // Uses injected provider (same implementation)
```

### 7. Hybrid - Static + DI

**When**: Some code uses static `New()`, some uses DI

```csharp
// Configure global provider
WhizbangIdProvider.Configure(new Uuid7IdProvider());

// Register for DI
builder.Services.AddWhizbangIdProviders();

public class OrderService {
    // Option 1: Use static New()
    public Order CreateOrder() {
        return new Order {
            Id = OrderId.New() // Uses global provider
        };
    }

    // Option 2: Inject typed provider
    public class OrderRepository {
        private readonly IWhizbangIdProvider<OrderId> _idProvider;

        public OrderRepository(IWhizbangIdProvider<OrderId> idProvider) {
            _idProvider = idProvider;
        }

        public Order CreateOrder() {
            return new Order {
                Id = _idProvider.NewId() // Uses injected provider
            };
        }
    }
}
```

### 8. Multi-Tenant ID Generation

**When**: IDs need tenant prefix or tenant-specific sequences

```csharp
public class TenantAwareIdProvider : IWhizbangIdProvider {
    private readonly IHttpContextAccessor _contextAccessor;

    public Guid NewGuid() {
        var tenantId = _contextAccessor.HttpContext?.User.FindFirst("tenant_id")?.Value;
        return GenerateTenantPrefixedGuid(tenantId);
    }
}

builder.Services.AddScoped<IWhizbangIdProvider, TenantAwareIdProvider>();
builder.Services.AddWhizbangIdProviders();
// All typed providers now include tenant context
```

### 9. Database Sequence IDs

**When**: Using database-generated sequences for distributed ID generation

```csharp
public class PostgresSequenceIdProvider : IWhizbangIdProvider {
    private readonly NpgsqlConnection _connection;

    public Guid NewGuid() {
        var sequence = _connection.ExecuteScalar<long>(
            "SELECT nextval('global_id_sequence')"
        );
        return ConvertSequenceToGuid(sequence);
    }
}

builder.Services.AddSingleton<IWhizbangIdProvider, PostgresSequenceIdProvider>();
builder.Services.AddWhizbangIdProviders();
```

### 10. Scoped vs Singleton Providers

**When**: Provider needs request-scoped dependencies

```csharp
// Scoped base provider
builder.Services.AddScoped<IWhizbangIdProvider, RequestScopedIdProvider>();

// Register typed providers as scoped
builder.Services.AddWhizbangIdProviders();

// Now IWhizbangIdProvider<OrderId> is scoped, uses scoped base provider
```

## Advanced Scenarios

### Custom Provider Implementation

```csharp
public class CustomOrderIdProvider : IWhizbangIdProvider<OrderId> {
    private readonly ILogger<CustomOrderIdProvider> _logger;

    public CustomOrderIdProvider(ILogger<CustomOrderIdProvider> logger) {
        _logger = logger;
    }

    public OrderId NewId() {
        var id = OrderId.From(Guid.CreateVersion7());
        _logger.LogDebug("Generated OrderId: {OrderId}", id);
        return id;
    }
}

// Register custom implementation
builder.Services.AddSingleton<IWhizbangIdProvider<OrderId>, CustomOrderIdProvider>();
```

### Composite Provider (Multiple Strategies)

```csharp
public class CompositeIdProvider : IWhizbangIdProvider {
    private readonly IWhizbangIdProvider _primary;
    private readonly IWhizbangIdProvider _fallback;

    public Guid NewGuid() {
        try {
            return _primary.NewGuid();
        }
        catch {
            return _fallback.NewGuid();
        }
    }
}
```

### Logging Wrapper

```csharp
public class LoggingIdProviderWrapper<TId> : IWhizbangIdProvider<TId>
    where TId : struct {

    private readonly IWhizbangIdProvider<TId> _inner;
    private readonly ILogger _logger;

    public TId NewId() {
        var id = _inner.NewId();
        _logger.LogDebug("Generated {IdType}: {Id}", typeof(TId).Name, id);
        return id;
    }
}
```

## API Reference

### IWhizbangIdProvider&lt;TId&gt;

**Namespace**: `Whizbang.Core`

**Purpose**: Strongly-typed provider for generating WhizbangId instances.

**Methods**:
- `TId NewId()` - Generates a new ID instance

**Usage**:
```csharp
public class OrderService {
    private readonly IWhizbangIdProvider<OrderId> _idProvider;

    public OrderService(IWhizbangIdProvider<OrderId> idProvider) {
        _idProvider = idProvider;
    }

    public Order CreateOrder() {
        return new Order {
            Id = _idProvider.NewId()
        };
    }
}
```

### WhizbangIdProviderRegistry

**Namespace**: `Whizbang.Core`

**Purpose**: Global registry for typed ID provider factories (used by generated code).

**Methods**:
- `RegisterFactory<TId>(Func<IWhizbangIdProvider, IWhizbangIdProvider<TId>>)` - Register factory (called by ModuleInitializer)
- `CreateProvider<TId>(IWhizbangIdProvider)` - Create typed provider from registry
- `RegisterDICallback(Action<IServiceCollection, IWhizbangIdProvider>)` - Register DI callback
- `RegisterAllWithDI(IServiceCollection, IWhizbangIdProvider)` - Call all DI callbacks
- `GetRegisteredIdTypes()` - Get all registered ID types

**Note**: Typically not used directly - ModuleInitializer handles registration automatically.

### AddWhizbangIdProviders Extension

**Namespace**: `Microsoft.Extensions.DependencyInjection`

**Purpose**: Registers all WhizbangId providers with DI.

**Signature**:
```csharp
public static IServiceCollection AddWhizbangIdProviders(
    this IServiceCollection services,
    IWhizbangIdProvider? baseProvider = null
)
```

**Parameters**:
- `baseProvider` - Custom base provider (default: `new Uuid7IdProvider()`)

**Returns**: `IServiceCollection` for chaining

**Example**:
```csharp
builder.Services.AddWhizbangIdProviders(); // Uses Uuid7IdProvider
// OR
builder.Services.AddWhizbangIdProviders(new CustomIdProvider());
```

## Testing Patterns

### Test with Sequential IDs

```csharp
public class SequentialTestIdProvider : IWhizbangIdProvider {
    private long _counter = 0;

    public Guid NewGuid() {
        var value = Interlocked.Increment(ref _counter);
        return new Guid($"00000000-0000-0000-0000-{value:D12}");
    }
}

// In tests
var services = new ServiceCollection();
services.AddSingleton<IWhizbangIdProvider, SequentialTestIdProvider>();
services.AddWhizbangIdProviders();
```

### Test with Known IDs

```csharp
public class KnownIdProvider<TId> : IWhizbangIdProvider<TId>
    where TId : struct {

    private readonly Queue<TId> _ids;

    public KnownIdProvider(params TId[] ids) {
        _ids = new Queue<TId>(ids);
    }

    public TId NewId() => _ids.Dequeue();
}

// In tests
var knownOrderId = OrderId.From(new Guid("11111111-1111-1111-1111-111111111111"));
var provider = new KnownIdProvider<OrderId>(knownOrderId);

var order = new Order { Id = provider.NewId() };
Assert.Equal(knownOrderId, order.Id);
```

### Test Direct Provider Creation

```csharp
[Test]
public void OrderId_CreateProvider_GeneratesValidIds() {
    // Arrange
    var baseProvider = new Uuid7IdProvider();
    var orderIdProvider = OrderId.CreateProvider(baseProvider);

    // Act
    var id1 = orderIdProvider.NewId();
    var id2 = orderIdProvider.NewId();

    // Assert
    Assert.NotEqual(id1, id2);
    Assert.NotEqual(Guid.Empty, id1.Value);
}
```

## Migration Guide

### Automated Migration with `whizbang-migrate`

Whizbang provides automated code transformation for migrating from raw Guid usage:

```bash
# Analyze codebase for Guid patterns
whizbang-migrate analyze ./src

# Transform Guid.NewGuid()/CreateVersion7() to TrackedGuid.NewMedo()
whizbang-migrate transform --transformer GuidToTrackedGuid ./src

# Or transform to IWhizbangIdProvider pattern (for DI)
whizbang-migrate transform --transformer GuidToIdProvider ./src
```

The `GuidToTrackedGuidTransformer` automatically:
- Converts `Guid.NewGuid()` → `TrackedGuid.NewMedo()`
- Converts `Guid.CreateVersion7()` → `TrackedGuid.NewMedo()`
- Adds `using Whizbang.Core.ValueObjects;` directive
- Emits warnings about return types that may need updating

### Migrating from Guid to WhizbangId

**Before**:
```csharp
public class Order {
    public Guid OrderId { get; init; }
}

public class OrderService {
    public Order CreateOrder() {
        return new Order {
            OrderId = Guid.NewGuid() // ❌ Not time-ordered, not type-safe
        };
    }
}
```

**After**:
```csharp
[WhizbangId]
public readonly partial struct OrderId;

public class Order {
    public OrderId OrderId { get; init; } // ✅ Type-safe
}

public class OrderService {
    private readonly IWhizbangIdProvider<OrderId> _idProvider;

    public OrderService(IWhizbangIdProvider<OrderId> idProvider) {
        _idProvider = idProvider;
    }

    public Order CreateOrder() {
        return new Order {
            OrderId = _idProvider.NewId() // ✅ Time-ordered UUIDv7, type-safe
        };
    }
}
```

### Migrating from IWhizbangIdProvider to IWhizbangIdProvider&lt;TId&gt;

**Before**:
```csharp
public class Repository<TEntity> {
    private readonly IWhizbangIdProvider _idProvider;

    public Repository(IWhizbangIdProvider idProvider) {
        _idProvider = idProvider;
    }

    public TEntity Create(TEntity entity) {
        entity.Id = _idProvider.NewGuid(); // ❌ Returns Guid
        return entity;
    }
}
```

**After**:
```csharp
public class Repository<TEntity, TId>
    where TId : struct {

    private readonly IWhizbangIdProvider<TId> _idProvider;

    public Repository(IWhizbangIdProvider<TId> idProvider) {
        _idProvider = idProvider;
    }

    public TEntity Create(TEntity entity) {
        entity.Id = _idProvider.NewId(); // ✅ Returns TId
        return entity;
    }
}

// Usage
var orderRepo = new Repository<Order, OrderId>(orderIdProvider);
```

## Best Practices

1. **Use typed providers in generic code** - Enables type safety in repositories, services, utilities
2. **Prefer DI over static New()** - Makes testing easier, allows custom providers
3. **Configure global provider early** - In `Program.cs` before any IDs are created
4. **Use auto-registration** - Let ModuleInitializer handle registration automatically
5. **Override specific types when needed** - Register custom implementations after `AddWhizbangIdProviders()`
6. **Test with sequential IDs** - Makes tests predictable and debuggable
7. **Document custom providers** - Explain why/when custom generation is needed

## See Also

- [Message Context](/v0.1.0/core-concepts/message-context) - How IDs flow through message processing
- [Observability](/v0.1.0/core-concepts/observability) - Correlation and causation tracking
- [Testing Strategy](/v0.1.0/testing/testing-strategy) - Testing with WhizbangIds
