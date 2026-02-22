---
title: "JSON Contexts"
version: 1.0.0
category: Source Generators
order: 5
description: "AOT-compatible JSON serialization with compile-time JsonSerializerContext generation - zero reflection for Native AOT"
tags: source-generators, json, serialization, aot, native-aot, system-text-json, zero-reflection
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

### Compile-Time Discovery

```
┌──────────────────────────────────────────────────┐
│  MessageJsonContextGenerator (Roslyn)            │
│                                                  │
│  Discovers:                                      │
│  1. Messages (ICommand, IEvent)                  │
│  2. Nested types in collections (List<T>)        │
│  3. Direct property types (non-collection)       │
│  4. Struct types (record struct, readonly)       │
│  5. WhizbangId types (MessageId, ProductId)      │
│  6. Enum types                                   │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  Generated Files                                 │
│                                                  │
│  1. MessageJsonContext.g.cs                      │
│     └─ JsonTypeInfo for all discovered types     │
│                                                  │
│  2. WhizbangJsonContext.g.cs (facade)            │
│     └─ Public API for JsonSerializerOptions      │
└──────────────────────────────────────────────────┘
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
    decimal Total,
    DateTimeOffset CreatedAt
) : IEvent;  // ← Discovered
```

**Result**: `JsonTypeInfo<CreateOrder>` and `JsonTypeInfo<OrderCreated>` generated.

---

### Pattern 2: Nested Type Discovery (Collections)

```csharp
// Command uses OrderItem in a collection
public record CreateOrder(
    Guid OrderId,
    List<OrderItem> Items  // ← OrderItem discovered automatically
) : ICommand;

// Nested type (not ICommand or IEvent)
public record OrderItem(
    Guid ProductId,
    int Quantity,
    decimal UnitPrice
);
```

**Result**: `JsonTypeInfo<OrderItem>` also generated.

---

### Pattern 3: Direct Property Discovery

:::new
Direct (non-collection) property types are now discovered automatically.
:::

```csharp
// Direct property type - NOT in a collection
public record ChatMessage(
    string Id,
    MessageContent Content  // ← Direct property, discovered!
) : ICommand;

public record MessageContent(
    string Text,
    AgentInfo Agent  // ← Deeply nested, also discovered!
);

public record AgentInfo(
    string Name,
    string Role
);
```

**Result**: `JsonTypeInfo` generated for `ChatMessage`, `MessageContent`, AND `AgentInfo`.

Previously, only collection element types were discovered. Now **any custom type** used as a property (direct or nested) is discovered recursively.

---

### Pattern 4: Struct Type Discovery

:::new
Struct types (including `record struct` and `readonly record struct`) are now fully supported.
:::

```csharp
public record OrderWithPermission(
    string Id,
    Permission RequiredPermission  // ← readonly record struct discovered!
) : ICommand;

// Readonly record struct with get-only property
public readonly record struct Permission(string Value);
```

**Result**: Both `OrderWithPermission` and `Permission` have `JsonTypeInfo` generated.

**How it works**:
- **Get-only properties** (`{ get; }`) use constructor initialization
- **Init-only properties** (`{ get; init; }`) use constructor initialization
- **Regular properties** (`{ get; set; }`) use property setters

```csharp
// Generated factory method for Permission
private JsonTypeInfo<Permission> Create_Permission(JsonSerializerOptions options) {
    var properties = new JsonPropertyInfo[1];

    properties[0] = CreateProperty<string>(
        options,
        "Value",
        getter: obj => ((Permission)obj).Value,
        setter: null  // ← Get-only property, uses constructor instead
    );

    var ctorParams = new JsonParameterInfoValues[1];
    ctorParams[0] = new JsonParameterInfoValues { Name = "Value", ParameterType = typeof(string) };

    var objectInfo = new JsonObjectInfoValues<Permission> {
        ObjectWithParameterizedConstructorCreator = static args => new Permission((string)args[0]),
        // ...
    };

    return JsonMetadataServices.CreateObjectInfo(options, objectInfo);
}
```

---

### Pattern 5: WhizbangId Converter Discovery

```csharp
// Generator infers converters for *Id types
public record CreateOrder(
    ProductId ProductId,    // ← Infers ProductIdJsonConverter
    CustomerId CustomerId   // ← Infers CustomerIdJsonConverter
) : ICommand;
```

**Result**: Converters automatically registered:
```csharp
options.Converters.Add(new ProductIdJsonConverter());
options.Converters.Add(new CustomerIdJsonConverter());
```

---

### Pattern 6: Enum Discovery

```csharp
public record OrderCreated(
    Guid OrderId,
    OrderStatus Status  // ← Enum discovered
) : IEvent;

public enum OrderStatus { Pending, Confirmed, Shipped, Delivered }
```

**Result**: `JsonTypeInfo<OrderStatus>` generated.

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

### Dependency Injection

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<JsonSerializerOptions>(sp =>
    WhizbangJsonContext.CreateOptions());
```

### With Message Envelope

```csharp
// Outbox pattern - envelope serialization
var envelope = MessageEnvelope.Create(new CreateOrder(...));
var json = JsonSerializer.Serialize(envelope, options);

// Inbox pattern - envelope deserialization
var received = JsonSerializer.Deserialize<MessageEnvelope<CreateOrder>>(json, options);
```

---

## Performance

| Scenario | Reflection-Based | Source-Generated |
|----------|-----------------|------------------|
| First serialization | ~100ms | ~0.1ms |
| Subsequent | ~0.1ms | ~0.1ms |
| Binary size impact | +2-5MB | +50-100KB |
| AOT compatible | ❌ No | ✅ Yes |

---

## Best Practices

### DO ✅

```csharp
// ✅ Use records with primary constructors
public record CreateOrder(Guid OrderId, string Name) : ICommand;

// ✅ Use readonly record struct for value types
public readonly record struct Permission(string Value);

// ✅ Use init-only properties when needed
public record OrderItem {
    public required Guid ProductId { get; init; }
    public required int Quantity { get; init; }
}
```

### DON'T ❌

```csharp
// ❌ Don't use types without public constructors
internal record InternalModel(string Value);  // Won't be discovered

// ❌ Don't use complex generic types
public record BadCommand(
    Dictionary<string, List<Tuple<int, string>>> Complex  // Avoid
) : ICommand;

// ❌ Don't reference types from unanalyzed assemblies
public record BadCommand(
    ThirdPartyLibrary.SomeType External  // May not be discovered
) : ICommand;
```

---

## Diagnostics

| ID | Severity | Description |
|----|----------|-------------|
| WHIZ007 | Info | MessageJsonContext generator started |
| WHIZ099 | Info | Type discovered for JSON serialization |

---

## Troubleshooting

### "JsonTypeInfo metadata not provided"

**Error**: `JsonTypeInfo metadata for type 'X' was not provided by TypeInfoResolver`

**Causes**:
1. Type is `internal` (not public)
2. Type is from an external assembly
3. Type is not reachable from any `ICommand`/`IEvent`

**Solutions**:
1. Make the type `public`
2. Ensure it's used as a property in a discovered message
3. Check that the assembly references `Whizbang.Generators`

### Struct not being discovered

**Problem**: `readonly record struct` types were previously skipped.

**Solution**: Update to v1.0.0 - struct types are now fully supported.

### Get-only property causing errors

**Problem**: Properties with `{ get; }` (no setter) may have caused compilation errors.

**Solution**: Update to v1.0.0 - get-only properties now correctly use constructor initialization.

---

## See Also

- [WhizbangId Generators](/v1.0.0/source-generators/whizbang-ids) - ID type generation
- [Native AOT Guide](/v1.0.0/guides/native-aot) - AOT deployment
- [Message Patterns](/v1.0.0/core-concepts/messages) - ICommand, IEvent patterns
