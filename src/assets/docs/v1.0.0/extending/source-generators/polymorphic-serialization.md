---
title: Polymorphic Serialization
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Generators/Templates/Snippets/JsonContextSnippets.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Polymorphic Serialization

The **MessageJsonContextGenerator** automatically discovers polymorphic base types and generates type discriminator-based JSON serialization. This enables returning **collections of base types** (like `List<BaseEvent>` or `List<ICommand>`) without manually adding `[JsonPolymorphic]` and `[JsonDerivedType]` attributes.

## The Problem

When returning collections of base-typed messages, traditional approaches require explicit attribute configuration:

```csharp{title="The Problem" description="When returning collections of base-typed messages, traditional approaches require explicit attribute configuration:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Problem"] unverified="problem-statement setup — the working generator behavior is verified in 'The Solution' and 'User-Defined Base Classes'"}
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
```csharp{title="The Problem - BaseEvent" description="With manual attributes, you must update the base class for each derived type:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Problem"] unverified="counter-example — the manual [JsonPolymorphic]/[JsonDerivedType] approach the generator replaces"}
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

```csharp{title="The Solution" description="Whizbang automatically discovers all inheritance relationships during source generation and configures polymorphic" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Solution"] tests=["MessageJsonContextGeneratorTests.Generator_WithUserBaseClass_AutoDiscoversPolymorphicTypesAsync"]}
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

:::updated
**The discriminator contract is fixed (re-verified against library commit `1b31f58d`)**: generated polymorphic factories always use the property name **`$type`** and **simple type names** as values. `[JsonPolymorphic]` on an abstract base is honored as a *discovery marker* (it triggers derived-type registration), but its `TypeDiscriminatorPropertyName` setting and custom `[JsonDerivedType]` string values are **ignored** by the generated `JsonTypeInfo` (`JsonContextSnippets.cs` — hardcoded `$type`; discriminator values come from `_extractSimpleName`). If you need custom discriminators, that is currently unsupported — using them in attributes produces payloads that cannot be read back as typed events.
:::

---

## How It Works

### 1. Inheritance Discovery

During source generation, the `MessageJsonContextGenerator`:

1. Scans all discovered message types (`ICommand`, `IEvent`, and `[WhizbangSerializable]` types)
2. Walks up the inheritance chain for each type (stopping at `System.*` types)
3. Records base class → derived type relationships (plus interface implementations, keeping only `ICommand`/`IEvent` among `Whizbang.Core` interfaces)
4. Groups by base type to build the polymorphic registry

```mermaid{caption="Inheritance discovery and grouping — the generator records each derived→base and derived→interface relationship, then groups by base type (class and interface) to build the polymorphic registry." tests=["MessageJsonContextGeneratorTests.Generator_WithUserBaseClass_AutoDiscoversPolymorphicTypesAsync", "MessageJsonContextGeneratorTests.Generator_WithIEventCollection_IncludesAllEventTypesAsync", "MessageJsonContextGeneratorTests.Generator_WithDeepInheritance_DiscoversAllLevelsAsync"]}
flowchart TD
    subgraph Discovery["Discovery Phase"]
        D1["SeedCreatedEvent : BaseEvent : IEvent<br/>Records: SeedCreatedEvent → BaseEvent<br/>Records: SeedCreatedEvent → IEvent"]
        D2["SeedProcessedEvent : BaseEvent : IEvent<br/>Records: SeedProcessedEvent → BaseEvent<br/>Records: SeedProcessedEvent → IEvent"]
        D3["SeedDeletedEvent : BaseEvent : IEvent<br/>Records: SeedDeletedEvent → BaseEvent<br/>Records: SeedDeletedEvent → IEvent"]
    end

    subgraph Grouping["Grouping Phase"]
        G1["BaseEvent (base class)<br/>Derived: [SeedCreatedEvent, SeedProcessedEvent, SeedDeletedEvent]"]
        G2["IEvent (interface)<br/>Derived: [SeedCreatedEvent, SeedProcessedEvent, SeedDeletedEvent]"]
    end

    Discovery --> Grouping

    class D1,D2,D3 layer-event
    class G1,G2 layer-core
```

### 2. Internal Data Structures

The generator uses two internal record types to track inheritance relationships:

#### InheritanceInfo

A minimal value type that tracks individual inheritance relationships discovered during scanning:

```csharp{title="InheritanceInfo" description="A minimal value type that tracks individual inheritance relationships discovered during scanning:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "InheritanceInfo"] unverified="generator-internal data structure — not part of the generated output"}
internal sealed record InheritanceInfo(
    string DerivedTypeName,  // e.g., "global::MyApp.Events.SeedCreatedEvent"
    string BaseTypeName,     // e.g., "global::MyApp.BaseAppEvent"
    bool IsInterface         // true if BaseTypeName is an interface
);
```

- **DerivedTypeName**: Fully qualified derived type name with `global::` prefix
- **BaseTypeName**: Fully qualified base type name with `global::` prefix
- **IsInterface**: Distinguishes class inheritance from interface implementation

#### PolymorphicTypeInfo

An aggregated view created by grouping `InheritanceInfo` records:

```csharp{title="PolymorphicTypeInfo" description="An aggregated view created by grouping InheritanceInfo records:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "PolymorphicTypeInfo"] unverified="generator-internal data structure — not part of the generated output"}
internal sealed record PolymorphicTypeInfo(
    string BaseTypeName,                    // "global::MyApp.BaseAppEvent"
    string BaseSimpleName,                  // "BaseAppEvent"
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

```csharp{title="Generated Code" description="For each polymorphic base type, the generator creates a factory method:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Generated", "Code"] tests=["MessageJsonContextGeneratorTests.Generator_WithUserBaseClass_AutoDiscoversPolymorphicTypesAsync"]}
private JsonTypeInfo<global::MyApp.BaseEvent> CreatePolymorphic_MyApp_BaseEvent(JsonSerializerOptions options) {
  var polyOptions = new JsonPolymorphismOptions {
    TypeDiscriminatorPropertyName = "$type",
    UnknownDerivedTypeHandling = JsonUnknownDerivedTypeHandling.FallBackToNearestAncestor
  };

  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedCreatedEvent), "SeedCreatedEvent"));
  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedProcessedEvent), "SeedProcessedEvent"));
  polyOptions.DerivedTypes.Add(new JsonDerivedType(typeof(global::MyApp.SeedDeletedEvent), "SeedDeletedEvent"));

  var objectInfo = new JsonObjectInfoValues<global::MyApp.BaseEvent> {
    ObjectCreator = null,  // Base type may be abstract or interface
    ObjectWithParameterizedConstructorCreator = null,
    PropertyMetadataInitializer = _ => Array.Empty<JsonPropertyInfo>(),
    ConstructorParameterMetadataInitializer = null,
    SerializeHandler = null
  };

  var jsonTypeInfo = JsonMetadataServices.CreateObjectInfo<global::MyApp.BaseEvent>(options, objectInfo);
  jsonTypeInfo.PolymorphismOptions = polyOptions;
  jsonTypeInfo.OriginatingResolver = this;
  return jsonTypeInfo;
}
```

The method name comes from `PolymorphicTypeInfo.UniqueIdentifier` (`CreatePolymorphic_` + fully qualified name with `.` replaced by `_`), and each derived-type discriminator string is the type's **simple name** (`_extractSimpleName`).

---

## Supported Patterns

### User-Defined Base Classes

```csharp{title="User-Defined Base Classes" description="User-Defined Base Classes" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "User-Defined", "Base"] tests=["MessageJsonContextGeneratorTests.Generator_WithUserBaseClass_AutoDiscoversPolymorphicTypesAsync"]}
// Non-abstract base class
public class BaseAppEvent : IEvent {
  public string EventId { get; init; } = "";
  public DateTime Timestamp { get; init; }
}

public class SeedCreatedEvent : BaseAppEvent { }
public class SeedProcessedEvent : BaseAppEvent { }
```

### Interface Collections

```csharp{title="Interface Collections" description="Interface Collections" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Interface", "Collections"] tests=["MessageJsonContextGeneratorTests.Generator_WithIEventCollection_IncludesAllEventTypesAsync"]}
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

```csharp{title="ICommand Collections" description="ICommand Collections" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "ICommand", "Collections"] tests=["MessageJsonContextGeneratorTests.Generator_WithICommandCollection_IncludesAllCommandTypesAsync"]}
// Return commands to execute
public record GetPendingCommands : ICommand;

public class GetPendingCommandsHandler : IReceptor<GetPendingCommands, List<ICommand>> {
  public Task<List<ICommand>> HandleAsync(GetPendingCommands query) {
    return Task.FromResult(pendingCommands);
  }
}
```

### Deep Inheritance

```csharp{title="Deep Inheritance" description="Deep Inheritance" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Deep", "Inheritance"] tests=["MessageJsonContextGeneratorTests.Generator_WithDeepInheritance_DiscoversAllLevelsAsync"]}
public class DomainEvent : IEvent { }
public class AggregateEvent : DomainEvent { }
public class OrderEvent : AggregateEvent { }
public class OrderCreated : OrderEvent { }
public class OrderShipped : OrderEvent { }

// All intermediate and leaf types are tracked
// OrderCreated → OrderEvent, AggregateEvent, DomainEvent, IEvent
```

### Array Types

```csharp{title="Array Types" description="Array Types" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Array", "Types"] tests=["MessageJsonContextGeneratorTests.Generator_WithArrayOfBaseType_AutoDiscoversPolymorphicTypesAsync"]}
// Arrays are also supported
public record ProcessBatchResult(BaseEvent[] Events);
```

---

## Explicit Opt-Out of Auto-Configuration

Adding `[JsonPolymorphic]` to a base type **excludes it from automatic polymorphic factory generation** — `_shouldSkipBaseType` in `MessageJsonContextGenerator` skips any base carrying an explicit `[JsonPolymorphic]` attribute, so no `CreatePolymorphic_*` factory is emitted for it (locked by `Generator_WithExplicitJsonPolymorphic_UsesUserAttributesAsync`):

```csharp{title="Explicit Opt-Out" description="Adding [JsonPolymorphic] excludes the base from auto polymorphic factory generation." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Explicit", "Opt-Out"] tests=["MessageJsonContextGeneratorTests.Generator_WithExplicitJsonPolymorphic_UsesUserAttributesAsync"]}
// Generator will NOT auto-generate a polymorphic factory for this base
[JsonPolymorphic(TypeDiscriminatorPropertyName = "eventType")]
[JsonDerivedType(typeof(HighPriorityEvent), "high")]
[JsonDerivedType(typeof(LowPriorityEvent), "low")]
public class ControlledBaseEvent : IEvent { }
```

:::updated
**Important caveat (verified at commit `1b31f58d`)**: opting out only suppresses the *auto-generated* factory. It does **not** make the generated context honor your custom discriminator settings — as described in the callout above, generated `JsonTypeInfo` always uses `$type` + simple names. On *abstract* types reached through property scanning, `[JsonPolymorphic]`/`[JsonDerivedType]` act as discovery markers (`_processAbstractPolymorphicType` registers the listed derived types), again with the fixed `$type` contract. Fully custom discriminators require your own resolver outside the generated context.
:::

---

## What Gets Excluded

The generator intelligently excludes:

- **Abstract derived types** - Cannot be instantiated, so excluded from `DerivedTypes` (`_getConcretePublicDerivedTypes`)
- **Non-public types** - Internal/private types aren't accessible in generated code
- **System.* types** - Base-chain walking stops at `System.*` types; `System.*` interfaces are skipped
- **Whizbang.Core interfaces other than `ICommand`/`IEvent`** - `IMessage`, `IHasId`, etc. are not treated as polymorphic bases
- **Abstract base classes** - No factory from the message-inheritance path (only concrete class or interface bases) — *unless* the abstract type carries `[JsonPolymorphic]` and is reached via property scanning, in which case its `[JsonDerivedType]` entries are registered with the fixed `$type` contract
- **Bases with explicit `[JsonPolymorphic]`** - Skipped by the automatic registry (see "Explicit Opt-Out" above)

---

## Diagnostics

The generator reports discovered polymorphic types:

| Diagnostic | Level | Description |
|------------|-------|-------------|
| WHIZ071 | Info | `Discovered polymorphic base type '{0}' with {1} derived type(s) for automatic JSON serialization` |

Example:
```
info WHIZ071: Discovered polymorphic base type 'BaseEvent' with 3 derived type(s) for automatic JSON serialization
info WHIZ071: Discovered polymorphic base type 'IEvent' with 15 derived type(s) for automatic JSON serialization
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
