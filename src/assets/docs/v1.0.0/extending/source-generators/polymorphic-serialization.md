---
title: Polymorphic Serialization
version: 1.0.0
category: Source Generators
order: 6
description: >-
  Automatic polymorphic JSON serialization without explicit [JsonPolymorphic] attributes -
  type discriminators generated at compile-time for base classes and interfaces
tags: >-
  source-generators, json, serialization, polymorphic, inheritance, aot, native-aot,
  type-discriminator
codeReferences:
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Generators/InheritanceInfo.cs
  - src/Whizbang.Generators/PolymorphicTypeInfo.cs
---

# Polymorphic Serialization

The **MessageJsonContextGenerator** automatically discovers polymorphic base types and generates type discriminator-based JSON serialization. This enables returning **collections of base types** (like `List<BaseEvent>` or `List<ICommand>`) without manually adding `[JsonPolymorphic]` and `[JsonDerivedType]` attributes.

## The Problem

When returning collections of base-typed messages, traditional approaches require explicit attribute configuration:

```csharp{title="The Problem" description="When returning collections of base-typed messages, traditional approaches require explicit attribute configuration:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Problem"]}
// The handler returns a List of a base type
public class ProcessBatchHandler : IReceptor<ProcessBatchCommand, List<BaseEvent>> {
  public Task<List<BaseEvent>> HandleAsync(ProcessBatchCommand cmd) {
    return Task.FromResult(new List<BaseEvent> {
      new SeedCreatedEvent { Id = "1" },
      new SeedProcessedEvent { Id = "2" }
    });
  }
}
```

**Without** polymorphic support, serialization loses type information:
```json{title="The Problem (2)" description="Without polymorphic support, serialization loses type information:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Problem"]}
// All derived types serialize as base type - TYPE INFO LOST!
[{"id": "1"}, {"id": "2"}]
```

**With manual attributes**, you must update the base class for each derived type:
```csharp{title="The Problem - BaseEvent" description="With manual attributes, you must update the base class for each derived type:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Problem"]}
// Maintenance nightmare for hundreds of event types!
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(SeedCreatedEvent), "SeedCreatedEvent")]
[JsonDerivedType(typeof(SeedProcessedEvent), "SeedProcessedEvent")]
[JsonDerivedType(typeof(SeedDeletedEvent), "SeedDeletedEvent")]
// ... 50+ more attributes?!
public class BaseEvent : IEvent { }
```

---

## The Solution

Whizbang **automatically discovers** all inheritance relationships during source generation and configures polymorphic serialization for you:

```csharp{title="The Solution" description="Whizbang automatically discovers all inheritance relationships during source generation and configures polymorphic" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Solution"]}
// No attributes needed on the base class!
public class BaseEvent : IEvent {
  public string Id { get; init; } = "";
}

public class SeedCreatedEvent : BaseEvent {
  public string SeedData { get; init; } = "";
}

public class SeedProcessedEvent : BaseEvent {
  public string ProcessedBy { get; init; } = "";
}

// Handler can return List<BaseEvent>
public class ProcessBatchHandler : IReceptor<ProcessBatchCommand, List<BaseEvent>> {
  public Task<List<BaseEvent>> HandleAsync(ProcessBatchCommand cmd) {
    return Task.FromResult(new List<BaseEvent> {
      new SeedCreatedEvent { Id = "1", SeedData = "wheat" },
      new SeedProcessedEvent { Id = "2", ProcessedBy = "user1" }
    });
  }
}
```

**Automatically serializes with type discriminators**:
```json{title="The Solution (2)" description="Automatically serializes with type discriminators:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Solution"]}
[
  {"$type": "SeedCreatedEvent", "id": "1", "seedData": "wheat"},
  {"$type": "SeedProcessedEvent", "id": "2", "processedBy": "user1"}
]
```

---

## How It Works

### 1. Inheritance Discovery

During source generation, the `MessageJsonContextGenerator`:

1. Scans all `ICommand` and `IEvent` implementations
2. Walks up the inheritance chain for each type
3. Records base class → derived type relationships
4. Groups by base type to build polymorphic registry

```
Discovery Phase
├── SeedCreatedEvent : BaseEvent : IEvent
│   └── Records: SeedCreatedEvent → BaseEvent
│   └── Records: SeedCreatedEvent → IEvent
├── SeedProcessedEvent : BaseEvent : IEvent
│   └── Records: SeedProcessedEvent → BaseEvent
│   └── Records: SeedProcessedEvent → IEvent
└── SeedDeletedEvent : BaseEvent : IEvent
    └── Records: SeedDeletedEvent → BaseEvent
    └── Records: SeedDeletedEvent → IEvent

Grouping Phase
├── BaseEvent (base class)
│   └── Derived: [SeedCreatedEvent, SeedProcessedEvent, SeedDeletedEvent]
└── IEvent (interface)
    └── Derived: [SeedCreatedEvent, SeedProcessedEvent, SeedDeletedEvent]
```

### 2. Internal Data Structures

The generator uses two internal record types to track inheritance relationships:

#### InheritanceInfo

A minimal value type that tracks individual inheritance relationships discovered during scanning:

```csharp{title="InheritanceInfo" description="A minimal value type that tracks individual inheritance relationships discovered during scanning:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "InheritanceInfo"]}
internal sealed record InheritanceInfo(
    string DerivedTypeName,  // e.g., "global::MyApp.Events.SeedCreatedEvent"
    string BaseTypeName,     // e.g., "global::MyApp.BaseJdxEvent"
    bool IsInterface         // true if BaseTypeName is an interface
);
```

- **DerivedTypeName**: Fully qualified derived type name with `global::` prefix
- **BaseTypeName**: Fully qualified base type name with `global::` prefix
- **IsInterface**: Distinguishes class inheritance from interface implementation

#### PolymorphicTypeInfo

An aggregated view created by grouping `InheritanceInfo` records:

```csharp{title="PolymorphicTypeInfo" description="An aggregated view created by grouping InheritanceInfo records:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "PolymorphicTypeInfo"]}
internal sealed record PolymorphicTypeInfo(
    string BaseTypeName,                    // "global::MyApp.BaseJdxEvent"
    string BaseSimpleName,                  // "BaseJdxEvent"
    ImmutableArray<string> DerivedTypes,    // All concrete derived types
    bool IsInterface                        // true if base is an interface
);
```

- **BaseTypeName**: Fully qualified name used in generated code
- **BaseSimpleName**: Short name used for generated method naming
- **DerivedTypes**: All concrete (non-abstract) derived types that should be serializable
- **UniqueIdentifier**: Computed property for C# identifiers (e.g., `MyApp_Events_BaseEvent`)

Both records use value equality (critical for incremental generator caching) and are computed transiently during code generation.

### 3. Generated Code

For each polymorphic base type, the generator creates a factory method:

```csharp{title="Generated Code" description="For each polymorphic base type, the generator creates a factory method:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Generated", "Code"]}
private JsonTypeInfo<global::MyApp.BaseEvent> CreatePolymorphic_MyApp_BaseEvent(JsonSerializerOptions options) {
  var polyOptions = new JsonPolymorphismOptions {
    TypeDiscriminatorPropertyName = "$type",
    UnknownDerivedTypeHandling = JsonUnknownDerivedTypeHandling.FallBackToNearestAncestor
  };

  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedCreatedEvent), "SeedCreatedEvent"));
  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedProcessedEvent), "SeedProcessedEvent"));
  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedDeletedEvent), "SeedDeletedEvent"));

  var jsonTypeInfo = JsonMetadataServices.CreateObjectInfo<global::MyApp.BaseEvent>(options, ...);
  jsonTypeInfo.PolymorphismOptions = polyOptions;
  return jsonTypeInfo;
}
```

---

## Supported Patterns

### User-Defined Base Classes

```csharp{title="User-Defined Base Classes" description="Demonstrates user-Defined Base Classes" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "User-Defined", "Base"]}
// Non-abstract base class
public class BaseJdxEvent : IEvent {
  public string EventId { get; init; } = "";
  public DateTime Timestamp { get; init; }
}

public class SeedCreatedEvent : BaseJdxEvent { }
public class SeedProcessedEvent : BaseJdxEvent { }
```

### Interface Collections

```csharp{title="Interface Collections" description="Demonstrates interface Collections" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Interface", "Collections"]}
// Return all events via IEvent interface
public record GetAllEventsCommand : ICommand;

public class GetAllEventsHandler : IReceptor<GetAllEventsCommand, List<IEvent>> {
  public Task<List<IEvent>> HandleAsync(GetAllEventsCommand cmd) {
    return Task.FromResult(new List<IEvent> {
      new OrderCreated { OrderId = "123" },
      new PaymentReceived { Amount = 99.99m }
    });
  }
}
```

### ICommand Collections

```csharp{title="ICommand Collections" description="Demonstrates iCommand Collections" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "ICommand", "Collections"]}
// Return commands to execute
public record GetPendingCommands : ICommand;

public class GetPendingCommandsHandler : IReceptor<GetPendingCommands, List<ICommand>> {
  public Task<List<ICommand>> HandleAsync(GetPendingCommands query) {
    return Task.FromResult(pendingCommands);
  }
}
```

### Deep Inheritance

```csharp{title="Deep Inheritance" description="Demonstrates deep Inheritance" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Deep", "Inheritance"]}
public class DomainEvent : IEvent { }
public class AggregateEvent : DomainEvent { }
public class OrderEvent : AggregateEvent { }
public class OrderCreated : OrderEvent { }
public class OrderShipped : OrderEvent { }

// All intermediate and leaf types are tracked
// OrderCreated → OrderEvent, AggregateEvent, DomainEvent, IEvent
```

### Array Types

```csharp{title="Array Types" description="Demonstrates array Types" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Array", "Types"]}
// Arrays are also supported
public record ProcessBatchResult(BaseEvent[] Events);
```

---

## Explicit Opt-Out

If you want **manual control** over polymorphic serialization, add the `[JsonPolymorphic]` attribute. The generator will skip auto-configuration and use your explicit configuration:

```csharp{title="Explicit Opt-Out" description="If you want manual control over polymorphic serialization, add the [JsonPolymorphic] attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Explicit", "Opt-Out"]}
// Explicit control - generator will NOT auto-configure
[JsonPolymorphic(TypeDiscriminatorPropertyName = "eventType")]
[JsonDerivedType(typeof(HighPriorityEvent), "high")]
[JsonDerivedType(typeof(LowPriorityEvent), "low")]
public class ControlledBaseEvent : IEvent { }
```

---

## What Gets Excluded

The generator intelligently excludes:

- **Abstract derived types** - Cannot be instantiated, so excluded from `DerivedTypes`
- **Non-public types** - Internal/private types aren't accessible in generated code
- **System.* types** - Framework types are handled by System.Text.Json
- **Abstract base classes** - No factory is generated (only concrete/interface bases)

---

## Diagnostics

The generator reports discovered polymorphic types:

| Diagnostic | Level | Description |
|------------|-------|-------------|
| WHIZ071 | Info | `Discovered polymorphic base type '{0}' with {1} derived type(s)` |

Example:
```
info WHIZ071: Discovered polymorphic base type 'BaseJdxEvent' with 3 derived type(s)
info WHIZ071: Discovered polymorphic base type 'IEvent' with 15 derived type(s)
```

---

## AOT Compatibility

All polymorphic serialization is:

- **Compile-time generated** - Zero runtime reflection
- **Native AOT compatible** - Full trimming support
- **Type-safe** - All types known at compile-time

The generated code uses `JsonMetadataServices.CreateObjectInfo` and `JsonPolymorphismOptions` - both fully AOT-compatible APIs.

---

## Related Topics

- [JSON Contexts](json-contexts) - Base JSON serialization system
- [Message Registry](message-registry) - How messages are discovered
- [Receptor Discovery](receptor-discovery) - Handler return type analysis
