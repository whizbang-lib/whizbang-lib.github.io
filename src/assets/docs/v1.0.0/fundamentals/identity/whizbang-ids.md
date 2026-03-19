# WhizbangIds: Strongly-Typed Identity Values

Whizbang uses strongly-typed identity values based on UUIDv7 for all identifiers. This provides type safety, prevents ID mixing mistakes, and enables AOT-compatible dependency injection.

## Overview

**WhizbangIds** are source-generated value types that:
- ✅ Wrap UUIDv7 GUIDs for time-ordered, database-friendly identities
- ✅ Provide compile-time type safety (can't mix OrderId with CustomerId)
- ✅ Support both static and DI-based ID generation
- ✅ Are fully AOT-compatible (zero reflection)
- ✅ Auto-register with DI via ModuleInitializer

## TrackedGuid: Metadata-Aware GUID Wrapper {#tracked-guid}

For scenarios where you need to work with raw GUIDs while preserving generation metadata, Whizbang provides `TrackedGuid`:

```csharp
using Whizbang.Core.ValueObjects;

// Create with sub-millisecond precision (recommended)
var tracked = TrackedGuid.NewMedo();  // Uses Medo.Uuid7 internally

// Check metadata
bool isTimeOrdered = tracked.IsTimeOrdered;           // true
bool subMs = tracked.SubMillisecondPrecision;         // true
DateTimeOffset when = tracked.Timestamp;              // Extracted from UUIDv7
GuidMetadata metadata = tracked.Metadata;             // Version7 | SourceMedo

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

### Tracking GUID Sources

`TrackedGuid` tracks where and how each GUID was created using the `GuidMetadata` flags:

```csharp
// Freshly created - full metadata available
var fresh = TrackedGuid.NewMedo();
Console.WriteLine(fresh.IsTracking);           // true (authoritative)
Console.WriteLine(fresh.SubMillisecondPrecision); // true (known)
Console.WriteLine(fresh.Metadata);             // Version7 | SourceMedo

// Loaded from database - metadata is inferred
var loaded = TrackedGuid.FromExternal(dbGuid);
Console.WriteLine(loaded.IsTracking);          // false (not authoritative)
Console.WriteLine(loaded.SubMillisecondPrecision); // false (unknown source)
Console.WriteLine(loaded.Metadata);            // Version7 | SourceExternal (inferred)
```

**Key Point**: Only GUIDs created through `NewMedo()`, `NewMicrosoftV7()`, or `NewRandom()` have **authoritative** metadata (`IsTracking = true`). GUIDs loaded from external sources have **inferred** metadata based on version detection.

### Debugging with TrackedGuid

`TrackedGuid` helps you debug GUID-related issues by tracking creation sources and timestamps:

#### Problem 1: "Where did this GUID come from?"

```csharp
public class OrderService {
  private readonly ILogger<OrderService> _logger;

  public async Task ProcessOrderAsync(TrackedGuid orderId) {
    // Debug: Check if this ID was freshly created or loaded
    if (!orderId.IsTracking) {
      _logger.LogWarning(
          "OrderId {OrderId} has no tracking metadata - loaded from external source",
          orderId);
    }

    // Check source
    var source = orderId.Metadata switch {
      var m when (m & GuidMetadata.SourceMedo) != 0 => "Medo.Uuid7",
      var m when (m & GuidMetadata.SourceMicrosoft) != 0 => "Microsoft GUID",
      var m when (m & GuidMetadata.SourceExternal) != 0 => "Database/API",
      var m when (m & GuidMetadata.SourceParsed) != 0 => "Parsed string",
      _ => "Unknown"
    };

    _logger.LogInformation(
        "Processing order {OrderId} from source: {Source}, IsV7: {IsV7}",
        orderId,
        source,
        orderId.IsTimeOrdered);
  }
}
```

**Output**:
```
Processing order 019c7df5-494b-77d6-b994-e7145b796ec0 from source: Database/API, IsV7: true
```

#### Problem 2: "Why are my IDs not sorting chronologically?"

```csharp
public void DebugIdOrdering(List<TrackedGuid> ids) {
  foreach (var id in ids) {
    var timestamp = id.Timestamp;
    var version = (id.Metadata & GuidMetadata.Version7) != 0 ? "v7" : "v4";
    var precision = id.SubMillisecondPrecision ? "sub-ms" : "ms-only";

    Console.WriteLine(
        $"ID: {id}, Version: {version}, Timestamp: {timestamp:O}, Precision: {precision}");

    if (!id.IsTimeOrdered) {
      Console.WriteLine("  ⚠️  WARNING: This is a UUIDv4 - not time-ordered!");
    }

    if (!id.SubMillisecondPrecision && id.IsTimeOrdered) {
      Console.WriteLine(
          "  ⚠️  WARNING: Millisecond-only precision - IDs within same ms may not sort correctly");
    }
  }
}
```

**Output**:
```
ID: 019c7df5-494b-77d6-b994-e7145b796ec0, Version: v7, Timestamp: 2025-01-15T14:32:15.0000000Z, Precision: sub-ms
ID: 550e8400-e29b-41d4-a716-446655440000, Version: v4, Timestamp: 0001-01-01T00:00:00.0000000Z, Precision: ms-only
  ⚠️  WARNING: This is a UUIDv4 - not time-ordered!
```

#### Problem 3: "Did I use the right GUID generator?"

```csharp
public class IdGenerationValidator {
  public void ValidateIdUsage(TrackedGuid id, string context) {
    // Check if using recommended generator
    if ((id.Metadata & GuidMetadata.SourceMedo) != 0) {
      Console.WriteLine($"✅ {context}: Using recommended Medo.Uuid7");
      return;
    }

    // Check if using Microsoft v7 (acceptable but not optimal)
    if ((id.Metadata & GuidMetadata.SourceMicrosoft) != 0 &&
        (id.Metadata & GuidMetadata.Version7) != 0) {
      Console.WriteLine(
          $"⚠️  {context}: Using Guid.CreateVersion7() - consider TrackedGuid.NewMedo() for sub-ms precision");
      return;
    }

    // Check if using v4 (problematic)
    if ((id.Metadata & GuidMetadata.Version4) != 0) {
      Console.WriteLine(
          $"❌ {context}: Using UUIDv4 (random) - not time-ordered, fragments indexes");
      return;
    }

    // External/Unknown source
    Console.WriteLine($"ℹ️  {context}: Source unknown - loaded from external system");
  }
}

// Usage
var validator = new IdGenerationValidator();
validator.ValidateIdUsage(TrackedGuid.NewMedo(), "OrderId");
validator.ValidateIdUsage(TrackedGuid.NewRandom(), "TestId");
```

**Output**:
```
✅ OrderId: Using recommended Medo.Uuid7
❌ TestId: Using UUIDv4 (random) - not time-ordered, fragments indexes
```

#### Problem 4: "When was this GUID created?"

```csharp
public void InvestigateEventTiming(TrackedGuid eventId) {
  if (!eventId.IsTimeOrdered) {
    Console.WriteLine("Cannot extract timestamp - this is not a UUIDv7");
    return;
  }

  var timestamp = eventId.Timestamp;
  var now = DateTimeOffset.UtcNow;
  var age = now - timestamp;

  Console.WriteLine($"Event {eventId}:");
  Console.WriteLine($"  Created: {timestamp:O}");
  Console.WriteLine($"  Age: {age.TotalSeconds:F2} seconds");

  if (age.TotalMinutes > 5) {
    Console.WriteLine("  ⚠️  WARNING: Event is more than 5 minutes old - potential processing delay");
  }
}
```

**Output**:
```
Event 019c7df5-494b-77d6-b994-e7145b796ec0:
  Created: 2025-01-15T14:32:15.4940000Z
  Age: 127.53 seconds
  ⚠️  WARNING: Event is more than 5 minutes old - potential processing delay
```

### JSON Serialization with TrackedGuidJsonConverter {#json-serialization}

`TrackedGuid` serializes as a plain UUID string, not as an object with metadata:

```csharp
using System.Text.Json;
using Whizbang.Core.ValueObjects;

public class Order {
  public TrackedGuid OrderId { get; set; }
  public string CustomerName { get; set; }
}

var order = new Order {
  OrderId = TrackedGuid.NewMedo(),
  CustomerName = "Alice"
};

// Serialize to JSON
var json = JsonSerializer.Serialize(order);
// Result: {"orderId":"019c7df5-494b-77d6-b994-e7145b796ec0","customerName":"Alice"}
// NOT: {"orderId":{"value":"...","metadata":5}}

// Deserialize from JSON
var deserialized = JsonSerializer.Deserialize<Order>(json);
Console.WriteLine(deserialized.OrderId.IsTracking); // false (metadata lost)
Console.WriteLine(deserialized.OrderId.Metadata);   // Version7 | SourceExternal
```

**Why serialize as string?**
- PostgreSQL UUID column compatibility
- Efficient JSONB queries in databases
- Interoperability with systems expecting standard UUID format
- Smaller JSON payload (no metadata object overhead)

**Important**: Metadata is **not preserved** across serialization boundaries. After deserialization, `IsTracking` will be `false` and metadata is inferred from the GUID version.

## TrackedGuid Interception (Opt-In)

Whizbang includes an optional compile-time interceptor that automatically wraps GUID creation calls with `TrackedGuid`, preserving metadata about the GUID source and version.

### Enabling Interception

Add to your project file to enable automatic interception:

```xml
<PropertyGroup>
  <WhizbangGuidInterceptionEnabled>true</WhizbangGuidInterceptionEnabled>
</PropertyGroup>
```

When enabled, the following calls are intercepted:
- `Guid.NewGuid()` → `TrackedGuid` with `Version4 | SourceMicrosoft`
- `Guid.CreateVersion7()` → `TrackedGuid` with `Version7 | SourceMicrosoft`
- Third-party libraries (Marten, UUIDNext, Medo.Uuid7)

### How It Works

The `GuidInterceptorGenerator` uses C# 12 `[InterceptsLocation]` to replace GUID creation calls at compile-time.

#### GuidMetadata Flags {#guid-metadata}

The `GuidMetadata` flags enum tracks both the UUID version and creation source:

```csharp
namespace Whizbang.Core.ValueObjects;

[Flags]
public enum GuidMetadata : ushort {
  None = 0,

  // UUID Version (bits 0-1)
  Version4 = 1 << 0,  // Random UUID - not time-ordered
  Version7 = 1 << 1,  // Time-ordered UUID - chronologically sortable

  // Creation Source (bits 2-5)
  SourceMedo = 1 << 2,       // Medo.Uuid7 - sub-millisecond precision
  SourceMicrosoft = 1 << 3,  // Guid.NewGuid() / CreateVersion7()
  SourceParsed = 1 << 4,     // Parsed from string
  SourceExternal = 1 << 5,   // From database, API, deserialization
  SourceUnknown = 1 << 6,    // Implicit conversion from Guid

  // Third-Party Libraries (bits 8-15)
  SourceMarten = 1 << 8,     // Marten CombGuidIdGeneration
  SourceUuidNext = 1 << 9,   // UUIDNext library
  // ... additional sources
}
```

**Usage**:

```csharp
// Your code (with interception enabled)
var id = Guid.NewGuid();

// After interception (generated code)
var id = TrackedGuid.FromIntercepted(
    Guid.NewGuid(),
    GuidMetadata.Version4 | GuidMetadata.SourceMicrosoft);

// Check metadata flags
bool isV7 = (id.Metadata & GuidMetadata.Version7) != 0;
bool fromMedo = (id.Metadata & GuidMetadata.SourceMedo) != 0;

// Common combinations (internal helpers)
// MEDO_V7 = Version7 | SourceMedo
// MICROSOFT_V7 = Version7 | SourceMicrosoft
// EXTERNAL_V7 = Version7 | SourceExternal
```

**Why Track Sources?**

Different GUID generators have different characteristics:
- **Medo.Uuid7**: Sub-millisecond precision, monotonic counter
- **Microsoft v7**: Millisecond precision only
- **Microsoft v4**: Random, not time-ordered
- **External**: Unknown precision and ordering guarantees

Tracking the source helps you:
- Validate time-ordering assumptions
- Debug GUID generation issues
- Enforce UUIDv7 usage policies
- Understand precision limitations

### Suppressing Interception

Use `[SuppressGuidInterception]` to opt-out of interception:

```csharp
using Whizbang.Core;

public class LegacyService {
  [SuppressGuidInterception]
  public Guid CreateLegacyId() {
    return Guid.NewGuid();  // Not intercepted
  }
}

// Or suppress entire class
[SuppressGuidInterception]
public class TestFixtures {
  // All Guid calls in this class are not intercepted
}
```

### Runtime Validation

Use `GuidOrderingValidator` to validate TrackedGuids at runtime:

```csharp
using Whizbang.Core.Configuration;
using Whizbang.Core.Validation;

var options = new WhizbangOptions {
  GuidOrderingViolationSeverity = GuidOrderingSeverity.Warning
};
var validator = new GuidOrderingValidator(options, logger);

// Validates that the GUID is time-ordered (v7)
validator.ValidateForTimeOrdering(trackedGuid, "EventId");
// Logs warning if v4 GUID is used where v7 is expected
```

Configuration options:
- `DisableGuidTracking` - Bypass all validation (default: `false`)
- `GuidOrderingViolationSeverity` - `None`, `Info`, `Warning` (default), `Error`

### Diagnostics

- **[WHIZ058](../../operations/diagnostics/whiz058.md)** - Info: GUID call intercepted
- **[WHIZ059](../../operations/diagnostics/whiz059.md)** - Info: Interception suppressed

## GuidUsageAnalyzer: Roslyn Analyzer (WHIZ055-WHIZ056) {#analyzer}

Whizbang includes a Roslyn analyzer (`GuidUsageAnalyzer`) that detects problematic GUID generation patterns at compile-time:

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class GuidUsageAnalyzer : DiagnosticAnalyzer {
  // Detects: Guid.NewGuid(), Guid.CreateVersion7(), raw Guid in ID positions
}
```

The analyzer runs during compilation and provides **instant feedback in your IDE** when you use GUID patterns that could cause problems.

### WHIZ055: Guid.NewGuid() Usage

**Severity**: Warning

```csharp
// ⚠️ Warning: Use TrackedGuid.NewMedo() or a [WhizbangId] type instead
var id = Guid.NewGuid();  // WHIZ055: Detected at compile-time
                          // IDE shows squiggle and warning

// ✅ Fix 1: Use TrackedGuid
var id = TrackedGuid.NewMedo();

// ✅ Fix 2: Use strongly-typed ID
var orderId = OrderId.New();
```

**Why**: `Guid.NewGuid()` creates UUIDv4 (random) which:
- Is **not time-ordered** → breaks chronological assumptions
- **Fragments database indexes** → poor query performance
- Has **no timestamp** → can't extract creation time

**Impact**: B-tree indexes in PostgreSQL/SQL Server fragment over time, causing page splits and degraded performance.

### WHIZ056: Guid.CreateVersion7() Usage

**Severity**: Warning

```csharp
// ⚠️ Warning: Use TrackedGuid.NewMedo() for sub-millisecond precision
var id = Guid.CreateVersion7();  // WHIZ056: Detected at compile-time

// ✅ Fix: Use TrackedGuid for sub-millisecond precision
var id = TrackedGuid.NewMedo();
```

**Why**: `Guid.CreateVersion7()` only has **millisecond precision**:
- In high-throughput scenarios, multiple IDs within same millisecond may not sort correctly
- Medo.Uuid7 provides **sub-millisecond precision** + monotonic counter
- Better ordering guarantees in distributed systems

**Real-World Example**:

```csharp
// Problematic with Guid.CreateVersion7()
for (int i = 0; i < 100; i++) {
  var id = Guid.CreateVersion7();  // Multiple IDs in same millisecond
  await InsertEventAsync(id);      // May not sort correctly!
}

// Fixed with TrackedGuid.NewMedo()
for (int i = 0; i < 100; i++) {
  var id = TrackedGuid.NewMedo();  // Sub-millisecond + monotonic counter
  await InsertEventAsync(id);      // Guaranteed correct ordering
}
```

### Suppressing Analyzer Warnings

For **legitimate cases** where you need raw GUID operations:

```csharp
// Suppress for specific line
#pragma warning disable WHIZ055
var testId = Guid.NewGuid();  // Intentional for test fixture
#pragma warning restore WHIZ055

// Suppress for entire method
[System.Diagnostics.CodeAnalysis.SuppressMessage(
    "Whizbang.SourceGeneration",
    "WHIZ055:Guid.NewGuid() Usage")]
public Guid CreateTestGuid() {
  return Guid.NewGuid();  // Analyzer suppressed
}

// Suppress for entire class
[System.Diagnostics.CodeAnalysis.SuppressMessage(
    "Whizbang.SourceGeneration",
    "WHIZ055:Guid.NewGuid() Usage")]
public class LegacyGuidService {
  // All Guid.NewGuid() calls in this class are suppressed
}

// Or suppress in project file (for test projects)
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ055;WHIZ056</NoWarn>
</PropertyGroup>
```

### How the Analyzer Works

The `GuidUsageAnalyzer` uses **syntax node analysis** to detect problematic patterns:

```csharp
public override void Initialize(AnalysisContext context) {
  context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
  context.EnableConcurrentExecution();

  // Register for method invocations
  context.RegisterSyntaxNodeAction(_analyzeInvocation, SyntaxKind.InvocationExpression);
}

private static void _analyzeInvocation(SyntaxNodeAnalysisContext context) {
  var invocation = (InvocationExpressionSyntax)context.Node;
  var methodSymbol = context.SemanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;

  if (methodSymbol?.ContainingType?.ToDisplayString() == "System.Guid") {
    if (methodSymbol.Name == "NewGuid") {
      context.ReportDiagnostic(Diagnostic.Create(
          DiagnosticDescriptors.GuidNewGuidUsage,
          invocation.GetLocation()));
    } else if (methodSymbol.Name == "CreateVersion7") {
      context.ReportDiagnostic(Diagnostic.Create(
          DiagnosticDescriptors.GuidCreateVersion7Usage,
          invocation.GetLocation()));
    }
  }
}
```

**Key Features**:
- **Runs during compilation** - No runtime overhead
- **IDE integration** - Squiggles appear immediately as you type
- **Configurable severity** - Can be error, warning, or info
- **Suppressible** - Use `#pragma warning` or attributes when needed

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

### Interface: `IWhizbangIdProvider<TId>` {#generic-whizbang-id}

The generic `IWhizbangIdProvider<TId>` interface enables **type-safe ID generation** in generic code:

```csharp
namespace Whizbang.Core;

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

**Why Generic Providers?**

Without generic providers, you lose type safety in generic code:

```csharp
// ❌ WITHOUT generic provider - loses type safety
public class Repository<TEntity> {
  private readonly IWhizbangIdProvider _provider;

  public TEntity Create() {
    var id = _provider.NewGuid();  // Returns Guid - not type-safe!
    // Need to manually wrap: var orderId = OrderId.From(id);
  }
}

// ✅ WITH generic provider - type-safe
public class Repository<TEntity, TId> where TId : struct {
  private readonly IWhizbangIdProvider<TId> _provider;

  public TEntity Create() {
    var id = _provider.NewId();  // Returns TId - type-safe!
    // No wrapping needed - already the correct type
  }
}
```

**Real-World Example**:

```csharp
// Domain entities with different ID types
public class Order {
  public OrderId Id { get; set; }
  public string CustomerName { get; set; }
}

public class Customer {
  public CustomerId Id { get; set; }
  public string Name { get; set; }
}

// Generic repository using IWhizbangIdProvider<TId>
public class Repository<TEntity, TId> where TId : struct {
  private readonly IWhizbangIdProvider<TId> _idProvider;
  private readonly DbContext _db;

  public Repository(IWhizbangIdProvider<TId> idProvider, DbContext db) {
    _idProvider = idProvider;
    _db = db;
  }

  public async Task<TEntity> CreateAsync(TEntity entity) {
    // Type-safe ID generation
    var id = _idProvider.NewId();  // Returns TId (OrderId or CustomerId)

    // Assuming TEntity has an Id property of type TId
    var idProperty = typeof(TEntity).GetProperty("Id");
    idProperty?.SetValue(entity, id);

    _db.Add(entity);
    await _db.SaveChangesAsync();
    return entity;
  }
}

// Usage with dependency injection
public class OrderService {
  private readonly Repository<Order, OrderId> _orderRepo;
  private readonly Repository<Customer, CustomerId> _customerRepo;

  public OrderService(
      Repository<Order, OrderId> orderRepo,
      Repository<Customer, CustomerId> customerRepo) {
    _orderRepo = orderRepo;
    _customerRepo = customerRepo;
  }

  public async Task ProcessOrderAsync() {
    // Each repository uses the correct ID type automatically
    var order = await _orderRepo.CreateAsync(new Order {
      CustomerName = "Alice"
    });

    var customer = await _customerRepo.CreateAsync(new Customer {
      Name = "Alice"
    });
  }
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

- [Message Context](/v1.0.0/core-concepts/message-context) - How IDs flow through message processing
- [Observability](/v1.0.0/core-concepts/observability) - Correlation and causation tracking
- [Testing Strategy](/v1.0.0/testing/testing-strategy) - Testing with WhizbangIds
