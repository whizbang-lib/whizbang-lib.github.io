---
title: JSON Contexts
version: 1.0.0
category: Source Generators
order: 5
description: >-
  AOT-compatible JSON serialization with compile-time JsonSerializerContext
  generation - zero reflection for Native AOT
tags: >-
  source-generators, json, serialization, aot, native-aot, system-text-json,
  zero-reflection
codeReferences:
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Core/Serialization/WhizbangJsonContext.cs
---

# JSON Contexts

The **MessageJsonContextGenerator** discovers all message types (`ICommand`, `IEvent`) at compile-time and generates a `JsonSerializerContext` with `JsonTypeInfo` for **AOT-compatible JSON serialization**. This enables Native AOT deployments with zero reflection overhead.

## Why JSON Source Generation?

**Problem**: Traditional `JsonSerializer` uses **reflection** at runtime:

```csharp
// ❌ Reflection-based (not AOT-compatible)
var json = JsonSerializer.Serialize(message);  // Scans type at runtime!
var deserialized = JsonSerializer.Deserialize<CreateOrder>(json);  // Reflection!
```

**Issues with Reflection**:
- ❌ **Not AOT Compatible**: Native AOT trims reflection metadata
- ❌ **Slow First Call**: ~50-100ms to scan type and build metadata
- ❌ **Runtime Overhead**: Type analysis on every new type
- ❌ **Large Binary Size**: Includes all reflection infrastructure

**Solution**: **Source-Generated JsonSerializerContext**:

```csharp
// ✅ AOT-compatible (compile-time metadata)
var options = new JsonSerializerOptions {
    TypeInfoResolver = new WhizbangJsonContext()  // Generated at compile-time
};

var json = JsonSerializer.Serialize(message, options);  // Zero reflection!
var deserialized = JsonSerializer.Deserialize<CreateOrder>(json, options);
```

**Benefits**:
- ✅ **AOT Compatible**: No reflection, full Native AOT support
- ✅ **Fast**: Zero runtime type analysis (~100x faster first call)
- ✅ **Small Binary**: No reflection infrastructure needed
- ✅ **Explicit**: All serialized types visible at compile-time

---

## How It Works

### 1. Compile-Time Discovery

```
┌──────────────────────────────────────────────────┐
│  MessageJsonContextGenerator (Roslyn)            │
│                                                  │
│  Discovers:                                      │
│  1. Messages (ICommand, IEvent)                 │
│  2. Nested types (OrderItem in List<OrderItem>) │
│  3. Collection types (List<T>)                  │
│  4. WhizbangId types (MessageId, ProductId)     │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  Generated Files                                 │
│                                                  │
│  1. MessageJsonContext.g.cs                      │
│     └─ JsonTypeInfo for all discovered types    │
│                                                  │
│  2. WhizbangJsonContext.g.cs (facade)            │
│     └─ Public API for JsonSerializerOptions     │
└──────────────────────────────────────────────────┘
```

---

### 2. Generated Code

**WhizbangJsonContext.g.cs** (facade):
```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Generated;

/// <summary>
/// Generated JSON context for WhizBang message serialization (AOT-compatible).
/// Discovered 5 message types, 3 nested types, 2 collection types.
/// </summary>
[JsonSerializable(typeof(CreateOrder))]
[JsonSerializable(typeof(OrderCreated))]
[JsonSerializable(typeof(ShipOrder))]
[JsonSerializable(typeof(OrderShipped))]
[JsonSerializable(typeof(CancelOrder))]
public partial class WhizbangJsonContext : JsonSerializerContext {
    /// <summary>
    /// Creates JsonSerializerOptions with WhizbangJsonContext.
    /// </summary>
    public static JsonSerializerOptions CreateOptions() {
        var options = new JsonSerializerOptions {
            TypeInfoResolver = new WhizbangJsonContext(),
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        // Register WhizbangId converters (AOT-compatible)
        options.Converters.Add(new ProductIdJsonConverter());
        options.Converters.Add(new OrderIdJsonConverter());

        return options;
    }
}
```

**MessageJsonContext.g.cs** (implementation):
```csharp
using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace MyApp.Generated;

internal partial class MessageJsonContext : JsonSerializerContext {
    // Generated JsonTypeInfo for CreateOrder
    private JsonTypeInfo<CreateOrder> Create_CreateOrder(JsonSerializerOptions options) {
        var properties = new JsonPropertyInfo[3];

        properties[0] = JsonMetadataServices.CreatePropertyInfo<Guid>(
            options,
            propertyName: "OrderId",
            getter: static obj => ((CreateOrder)obj).OrderId,
            setter: null  // Init-only property
        );

        properties[1] = JsonMetadataServices.CreatePropertyInfo<Guid>(
            options,
            propertyName: "CustomerId",
            getter: static obj => ((CreateOrder)obj).CustomerId,
            setter: null
        );

        properties[2] = JsonMetadataServices.CreatePropertyInfo<List<OrderItem>>(
            options,
            propertyName: "Items",
            getter: static obj => ((CreateOrder)obj).Items,
            setter: null
        );

        // Constructor parameters for record with primary constructor
        var ctorParams = new JsonParameterInfoValues[3];
        ctorParams[0] = new JsonParameterInfoValues { Name = "OrderId", ParameterType = typeof(Guid) };
        ctorParams[1] = new JsonParameterInfoValues { Name = "CustomerId", ParameterType = typeof(Guid) };
        ctorParams[2] = new JsonParameterInfoValues { Name = "Items", ParameterType = typeof(List<OrderItem>) };

        var objectInfo = new JsonObjectInfoValues<CreateOrder> {
            ObjectWithParameterizedConstructorCreator = static args => new CreateOrder(
                (Guid)args[0],
                (Guid)args[1],
                (List<OrderItem>)args[2]
            ),
            PropertyMetadataInitializer = _ => properties,
            ConstructorParameterMetadataInitializer = () => ctorParams
        };

        var jsonTypeInfo = JsonMetadataServices.CreateObjectInfo(options, objectInfo);
        jsonTypeInfo.OriginatingResolver = this;
        return jsonTypeInfo;
    }

    // Type resolver - matches type to JsonTypeInfo
    public override JsonTypeInfo? GetTypeInfo(Type type) {
        if (type == typeof(CreateOrder)) {
            return Create_CreateOrder(Options);
        }

        if (type == typeof(OrderCreated)) {
            return Create_OrderCreated(Options);
        }

        // ... more types

        return null;  // Not handled by this context
    }
}
```

---

## Discovery Patterns

### Pattern 1: Command/Event Discovery

```csharp
// Commands and events are auto-discovered
public record CreateOrder(
    Guid OrderId,
    Guid CustomerId,
    List<OrderItem> Items
) : ICommand;  // ← Discovered

public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTimeOffset CreatedAt
) : IEvent;  // ← Discovered
```

**Result**: `JsonTypeInfo<CreateOrder>` and `JsonTypeInfo<OrderCreated>` generated.

---

### Pattern 2: Nested Type Discovery

```csharp
// Command uses OrderItem (nested type)
public record CreateOrder(
    Guid OrderId,
    Guid CustomerId,
    List<OrderItem> Items  // ← OrderItem discovered automatically
) : ICommand;

// Nested type (not ICommand or IEvent)
public record OrderItem(
    Guid ProductId,
    int Quantity,
    decimal UnitPrice
);
```

**Result**: `JsonTypeInfo<OrderItem>` also generated (needed for `List<OrderItem>`).

---

### Pattern 3: Collection Type Discovery

```csharp
// List<T> types discovered from properties
public record CreateOrder(
    Guid OrderId,
    List<OrderItem> Items  // ← List<OrderItem> discovered
) : ICommand;
```

**Result**: `JsonTypeInfo<List<OrderItem>>` generated for AOT compatibility.

---

### Pattern 4: WhizbangId Converter Discovery

```csharp
// Generator infers converters for *Id types
public record CreateOrder(
    ProductId ProductId,  // ← Infers ProductIdJsonConverter
    CustomerId CustomerId  // ← Infers CustomerIdJsonConverter
) : ICommand;
```

**Result**: Converters automatically registered in `CreateOptions()`:
```csharp
options.Converters.Add(new ProductIdJsonConverter());
options.Converters.Add(new CustomerIdJsonConverter());
```

---

## Usage

### Basic Serialization

```csharp
using MyApp.Generated;

// Create options with generated context
var options = WhizbangJsonContext.CreateOptions();

// Serialize (AOT-compatible, zero reflection)
var command = new CreateOrder(orderId, customerId, items);
var json = JsonSerializer.Serialize(command, options);

// Deserialize (AOT-compatible)
var deserialized = JsonSerializer.Deserialize<CreateOrder>(json, options);
```

---

### Dependency Injection

```csharp
// Program.cs
using MyApp.Generated;

var builder = WebApplication.CreateBuilder(args);

// Register JsonSerializerOptions with generated context
builder.Services.AddSingleton(WhizbangJsonContext.CreateOptions());

// Or configure JsonOptions for ASP.NET Core
builder.Services.Configure<JsonOptions>(options => {
    options.JsonSerializerOptions.TypeInfoResolver = new WhizbangJsonContext();
    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});
```

---

### Outbox/Inbox Serialization

```csharp
public class OutboxPublisher {
    private readonly JsonSerializerOptions _jsonOptions;

    public OutboxPublisher() {
        _jsonOptions = WhizbangJsonContext.CreateOptions();
    }

    public async Task PublishAsync(object message, CancellationToken ct = default) {
        // Serialize with AOT-compatible context
        var json = JsonSerializer.Serialize(message, _jsonOptions);

        await _db.ExecuteAsync(
            "INSERT INTO wh_outbox (message_id, payload, ...) VALUES (@MessageId, @Payload::jsonb, ...)",
            new { MessageId = Guid.NewGuid(), Payload = json },
            cancellationToken: ct
        );
    }
}
```

---

## Performance

### Benchmark: First Serialization

| Method | Overhead | Notes |
|--------|----------|-------|
| **Generated Context** | ~5ms | Compile-time metadata |
| **Reflection** | ~100ms | Runtime type analysis |

**20x faster** on first call!

### Subsequent Calls

| Method | Overhead | Notes |
|--------|----------|-------|
| **Generated Context** | ~100ns | Direct property access |
| **Reflection** | ~150ns | Cached reflection metadata |

**1.5x faster** on subsequent calls (minimal difference after warm-up).

---

## Native AOT Compatibility

### Publish Native AOT

```xml
<!-- MyApp.csproj -->
<PropertyGroup>
  <PublishAot>true</PublishAot>
</PropertyGroup>
```

**Build**:
```bash
dotnet publish -c Release

# Output:
Generating native code...
  MyApp.dll -> MyApp.exe (Native AOT)
  Binary size: 12.5 MB (includes JSON context)
  Startup time: < 10ms
```

**Verification**:
```bash
# Check binary doesn't use reflection
nm MyApp.exe | grep -i "reflection"
# No results = success!
```

---

## Diagnostics

### WHIZ099: Generator Running

**Severity**: Info

**Message**: `MessageJsonContextGenerator invoked for assembly '{0}' with {1} message type(s)`

**Example**:
```
info WHIZ099: MessageJsonContextGenerator invoked for assembly 'MyApp' with 5 message type(s)
```

---

### WHIZ007: JSON Serializable Type Discovered

**Severity**: Info

**Message**: `Found JSON-serializable type '{0}' ({1})`

**Example**:
```
info WHIZ007: Found JSON-serializable type 'CreateOrder' (command)
info WHIZ007: Found JSON-serializable type 'OrderItem' (nested type)
info WHIZ007: Found JSON-serializable type 'List<OrderItem>' (collection type)
```

---

## Best Practices

### DO ✅

- ✅ **Use WhizbangJsonContext.CreateOptions()** for all JSON serialization
- ✅ **Mark all messages as public** (generator only processes public types)
- ✅ **Use records with primary constructors** for best JSON support
- ✅ **Test Native AOT** deployment early (catches issues sooner)
- ✅ **Include nested types** in same assembly as messages

### DON'T ❌

- ❌ Use reflection-based JsonSerializer (defeats AOT)
- ❌ Mark messages as internal (won't be discovered)
- ❌ Use complex custom converters (may not be AOT-compatible)
- ❌ Serialize types from other assemblies without their context
- ❌ Skip testing with `PublishAot=true`

---

## Troubleshooting

### Problem: Type Not Serializable in Native AOT

**Symptoms**: Serialization throws `NotSupportedException` in AOT build.

**Cause**: Type not included in generated context.

**Solution**:
1. Verify type is public
2. Verify type implements `ICommand` or `IEvent`
3. Rebuild project to regenerate context

```csharp
// ❌ Internal type (not discovered)
internal record CreateOrder(...) : ICommand;

// ✅ Public type (discovered)
public record CreateOrder(...) : ICommand;
```

### Problem: Nested Type Not Found

**Symptoms**: `List<OrderItem>` fails to serialize.

**Cause**: `OrderItem` not public or in different assembly.

**Solution**: Make nested types public in same assembly:
```csharp
// ✅ Public nested type
public record OrderItem(Guid ProductId, int Quantity);
```

### Problem: WhizbangId Converter Not Registered

**Symptoms**: `ProductId` serializes as `{}` instead of GUID value.

**Cause**: Converter not auto-discovered (name doesn't match convention).

**Solution**: Ensure converter follows naming convention:
```csharp
// Type: ProductId
// Converter: ProductIdJsonConverter (must match!)
public class ProductIdJsonConverter : JsonConverter<ProductId> {
    // Implementation...
}
```

---

## Further Reading

**Source Generators**:
- [Receptor Discovery](receptor-discovery.md) - Compile-time receptor discovery
- [Perspective Discovery](perspective-discovery.md) - Compile-time perspective discovery
- [Message Registry](message-registry.md) - VSCode extension integration
- [Aggregate IDs](aggregate-ids.md) - UUIDv7 generation for identity value objects

**Core Concepts**:
- [Message Context](../core-concepts/message-context.md) - MessageId, CorrelationId, CausationId

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing

**Advanced**:
- [Native AOT Deployment](../advanced/native-aot.md) - Full AOT deployment guide

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
