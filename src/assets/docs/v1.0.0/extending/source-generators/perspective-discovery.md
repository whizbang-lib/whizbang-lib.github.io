---
title: Perspective Discovery
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Source Generators
order: 2
description: >-
  Compile-time perspective discovery for event-driven read models - zero
  reflection registration of pure Apply functions
tags: >-
  source-generators, perspectives, read-models, events, roslyn, compile-time,
  zero-reflection
codeReferences:
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Generators/Templates/PerspectiveRegistrationsTemplate.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Discovery

:::updated
**Interface renamed in the shipped library (verified at commit `1b31f58d`)**: perspectives implement **`IPerspectiveFor<TModel, TEvent1, ...>`** (model first, up to 20 event types) with **pure `Apply(TModel, TEvent) → TModel` functions** — not the earlier `IPerspectiveOf<TEvent>`/`UpdateAsync` design this page previously described. The framework owns persistence: your perspective never touches the database. Apply methods MUST be pure (no I/O, no side effects, deterministic) — the `PerspectivePurityAnalyzer` enforces this at build time (WHIZ100+ errors).
:::

The **PerspectiveDiscoveryGenerator** discovers all `IPerspectiveFor<TModel, TEvent...>` implementations at compile-time and generates zero-reflection DI registration code. Perspectives are event-driven read models: pure functions that fold events into a denormalized model which the framework persists for you.

## Perspectives vs Receptors

| Aspect | Perspectives | Receptors |
|--------|-------------|----------|
| **Purpose** | Fold events into read models | Handle commands/queries |
| **Trigger** | Domain events | Commands/queries |
| **Signature** | `TModel Apply(TModel, TEvent)` — pure, synchronous | `ValueTask<TResponse> HandleAsync(...)` |
| **Side Effects** | None (enforced by analyzer) | Business logic, I/O via services |
| **Persistence** | Framework-owned (`wh_per_*` tables) | N/A |
| **Invocation** | Generated perspective runners | Generated dispatcher |

**Whizbang Pattern**: Commands → Receptors → Events → Perspectives → Read Models

---

## Event-Driven Read Models

### Traditional Approach (Direct Updates)

```csharp{title="Traditional Approach (Direct Updates)" description="Traditional Approach (Direct Updates)" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Traditional", "Approach"] unverified="counter-example — traditional tightly-coupled approach, not a Whizbang pattern"}
// ❌ Tight coupling between command and query models
public class OrderService {
    public async Task<OrderCreated> CreateOrderAsync(CreateOrder command) {
        // 1. Update write model
        var order = new Order(command.CustomerId, command.Items);
        await _context.Orders.AddAsync(order);

        // 2. Update read model (tightly coupled!)
        var summary = new OrderSummary { /* ... */ };
        await _context.OrderSummaries.AddAsync(summary);

        await _context.SaveChangesAsync();
        return new OrderCreated(/* ... */);
    }
}
```

### Whizbang Approach (Event-Driven, Pure)

```csharp{title="Whizbang Approach (Event-Driven)" description="Receptor returns event; perspective folds it into the model as a pure function" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Whizbang", "Approach"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync"]}
// ✅ Receptor publishes the event - no read-model coupling
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct = default) {
        return ValueTask.FromResult(new OrderCreated(
            OrderId: message.OrderId,
            CustomerId: message.CustomerId,
            Total: message.Total,
            CreatedAt: DateTimeOffset.UtcNow
        ));
    }
}

// ✅ Read model - a plain class with a [StreamId] property
public class OrderSummary {
    [StreamId]
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = "";
}

// ✅ Perspective folds events into the model - PURE function, no I/O
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> {
    public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) {
        currentData.OrderId = eventData.OrderId;
        currentData.CustomerId = eventData.CustomerId;
        currentData.Total = eventData.Total;
        currentData.Status = "Created";
        return currentData;
    }
}
```

**Benefits**:
- ✅ **Decoupling**: Command handler doesn't know about read models
- ✅ **Multiple Perspectives**: Many read models from same event
- ✅ **Deterministic Rebuild**: Pure Apply functions replay identically
- ✅ **Framework Persistence**: Storage, upserts, and concurrency handled for you

---

## How It Works

### 1. Compile-Time Discovery

```mermaid{caption="Compile-time perspective discovery — the Roslyn generator scans base lists, skips abstract classes, matches IPerspectiveFor / IPerspectiveWithActionsFor with more than one type argument, and emits PerspectiveRegistrations.g.cs." tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_AbstractClass_IsIgnoredAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_WithActionsForInterface_GeneratesMessageAssociationAsync"]}
flowchart TD
    Code["Your Code<br/><br/>public class OrderSummaryPerspective<br/>: IPerspectiveFor&lt;OrderSummary, OrderCreated&gt; {<br/>public OrderSummary Apply(<br/>OrderSummary currentData,<br/>OrderCreated eventData) { ... }<br/>}"]
    Generator["PerspectiveDiscoveryGenerator (Roslyn)<br/><br/>1. Scan classes with base lists<br/>2. Skip abstract classes<br/>3. Match IPerspectiveFor / IPerspectiveWithActionsFor<br/>with &gt;1 type argument<br/>4. Extract: Model type, Event types, model [StreamId]"]
    Generated["Generated Code<br/><br/>PerspectiveRegistrations.g.cs<br/>— AddWhizbangPerspectives() registrations<br/>— MessageAssociation query methods"]

    Code --> Generator
    Generator --> Generated

    class Code layer-read
    class Generator layer-infrastructure
    class Generated layer-core
```

The generator matches both `IPerspectiveFor<TModel, TEvent...>` and `IPerspectiveWithActionsFor<TModel, TEvent...>` variants; single-type-argument marker interfaces (`IPerspectiveFor<TModel>`) are skipped. The model type is the **first** type argument, and its `[StreamId]` property is located for stream addressing.

### 2. Generated File

**PerspectiveRegistrations.g.cs** (emitted into `{AssemblyName}.Generated`):

```csharp{title="Generated File" description="PerspectiveRegistrations.g.cs surface" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Generated", "File"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_ReturnsServiceCollectionForMethodChainingAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GetMessageAssociations_ReturnsCorrectAssociationsAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GetPerspectivesForEvent_HelperMethodGeneratedAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GetEventsForPerspective_HelperMethodGeneratedAsync"]}
public static class PerspectiveRegistrationExtensions {
    /// <summary>
    /// Registers all discovered IPerspectiveFor implementations (Scoped).
    /// Returns a WhizbangPerspectiveBuilder for storage-provider configuration.
    /// </summary>
    public static WhizbangPerspectiveBuilder AddWhizbangPerspectives(this IServiceCollection services) {
        // Serializes Apply calls per (streamId, perspectiveName)
        services.TryAddSingleton<IPerspectiveApplyCoordinator, PerspectiveApplyCoordinator>();

        // One registration per perspective class, with its FULL interface signature:
        services.AddScoped<IPerspectiveFor<OrderSummary, OrderCreated, OrderShipped>, OrderSummaryPerspective>();
        services.AddScoped<IPerspectiveFor<CustomerStats, OrderCreated>, CustomerStatisticsPerspective>();

        return new WhizbangPerspectiveBuilder(services);
    }

    // Event ↔ perspective association queries (used by tooling and sync infrastructure)
    public static IReadOnlyList<MessageAssociation> GetMessageAssociations(string serviceName);
    public static IEnumerable<string> GetPerspectivesForEvent(string eventType, string serviceName);
    public static IEnumerable<string> GetEventsForPerspective(string perspectiveName, string serviceName);
    // + overloads with MatchStrictness fuzzy matching and Regex patterns
}
```

The file also declares two records used by the association queries:

```csharp{title="Association Records" description="MessageAssociation and PerspectiveAssociationInfo" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Associations"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_MessageAssociation_IsGeneratedAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GeneratesPerspectiveAssociationInfoRecordAsync"]}
public sealed record MessageAssociation(
  string MessageType,       // "MyApp.Events.OrderCreated, MyApp"
  string AssociationType,   // "perspective"
  string TargetName,        // "OrderSummaryPerspective"
  string ServiceName        // assembly name
);

public sealed record PerspectiveAssociationInfo<TModel, TEvent>(
  string MessageType,
  string TargetName,
  string ServiceName,
  Func<TModel, TEvent, TModel> ApplyDelegate  // strongly-typed, AOT-compatible
) where TEvent : IEvent;
```

**Key Observations**:
- One perspective class can handle **multiple events** (one interface with up to 20 event type arguments)
- Multiple perspectives can handle the **same event**
- Registered as **Scoped** to match typical database-context lifetime
- `AddWhizbangPerspectives()` returns a **`WhizbangPerspectiveBuilder`** so you can chain storage-provider configuration

Note that `PerspectiveDiscoveryGenerator` produces the DI registrations and association metadata; the sibling `PerspectiveRunnerGenerator`/`PerspectiveInvokerGenerator` generate the runners that actually route stored events into your Apply methods.

---

## Perspective Patterns

### Pattern 1: Single Event

```csharp{title="Pattern 1: Single Event" description="Single event perspective" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Pattern", "Single"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync"]}
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> {
    public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) {
        currentData.OrderId = eventData.OrderId;
        currentData.Status = "Created";
        return currentData;
    }
}
```

**Generated registration**:
```csharp{title="Pattern 1 Registration" description="Generated registration (1 event)" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Pattern", "Single"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync"]}
services.AddScoped<IPerspectiveFor<OrderSummary, OrderCreated>, OrderSummaryPerspective>();
```

### Pattern 2: Multiple Events

```csharp{title="Pattern 2: Multiple Events" description="One perspective, several events" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Pattern", "Multiple"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveMultipleEvents_GeneratesMultipleRegistrationsAsync", "PerspectiveDiscoveryGeneratorTests.Generator_PerspectiveWith10Events_GeneratesRegistrationsAsync"]}
public class OrderSummaryPerspective :
    IPerspectiveFor<OrderSummary, OrderCreated, OrderShipped, OrderCancelled> {

    public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) {
        currentData.OrderId = eventData.OrderId;
        currentData.Status = "Created";
        return currentData;
    }

    public OrderSummary Apply(OrderSummary currentData, OrderShipped eventData) {
        currentData.Status = "Shipped";
        currentData.ShippedAt = eventData.ShippedAt;  // Use event time, never DateTime.UtcNow!
        return currentData;
    }

    public OrderSummary Apply(OrderSummary currentData, OrderCancelled eventData) {
        currentData.Status = "Cancelled";
        return currentData;
    }
}
```

### Pattern 3: Aggregated Statistics

```csharp{title="Pattern 3: Aggregated Statistics" description="Fold aggregations into the model" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Pattern", "Aggregated"]}
public class CustomerStatisticsPerspective :
    IPerspectiveFor<CustomerStats, OrderCreated, OrderShipped> {

    public CustomerStats Apply(CustomerStats currentData, OrderCreated eventData) {
        currentData.TotalOrders += 1;
        currentData.TotalSpent += eventData.Total;
        currentData.LastOrderAt = eventData.CreatedAt;
        return currentData;
    }

    public CustomerStats Apply(CustomerStats currentData, OrderShipped eventData) {
        currentData.LastShippedAt = eventData.ShippedAt;
        return currentData;
    }
}
```

**Use Case**: Pre-computed aggregations for analytics dashboards — the framework upserts the folded model.

---

## Purity Enforcement

Apply methods must be **pure functions**. The `PerspectivePurityAnalyzer` reports build **errors** for violations (WHIZ100-range diagnostics):

| ID | Violation |
|----|-----------|
| WHIZ100 | Apply method returns `Task` (must be synchronous) |
| WHIZ101 | Apply method uses `async`/`await` |
| WHIZ102 | Apply method performs database I/O |
| WHIZ103 | Apply method performs HTTP/network calls |

Practical rules:
- No `DbContext`, `IDbConnection`, HTTP clients, or file I/O inside Apply
- Use **event timestamps**, never `DateTime.UtcNow`
- Return the updated model; the framework persists it

---

## Diagnostics

### WHIZ007: Perspective Discovered

**Severity**: Info

**Message**: `Found perspective '{0}' listening to {1}`

**Example**:
```
info WHIZ007: Found perspective 'OrderSummaryPerspective' listening to OrderCreated, OrderShipped, OrderCancelled
```

### WHIZ030: Perspective Event Missing StreamId

**Severity**: Error

**Message**: `Event type '{0}' used in perspective '{1}' must have exactly one property marked with [StreamId] attribute`

Every event a perspective listens to must carry a `[StreamId]` so the framework can address the model's stream.

### WHIZ031: Multiple StreamId Attributes

**Severity**: Error

**Message**: `Event type '{0}' has multiple properties marked with [StreamId]. Only one property can be the stream ID.`

Related model-side diagnostics from the runner generators: **WHIZ033** (Warning) — a perspective's *model* without a `[StreamId]` property will not get a generated runner.

---

## AOT Compatibility

Generated registration uses **no reflection**:

```csharp{title="Zero Reflection Guarantee" description="Generated registration uses no reflection" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Zero", "Reflection"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GeneratesAOTCompatibleDelegatesAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync"]}
// ✅ Direct type registration (AOT-compatible)
services.AddScoped<IPerspectiveFor<OrderSummary, OrderCreated>, OrderSummaryPerspective>();

// ❌ Reflection-based registration (incompatible with AOT)
var perspectiveType = typeof(IPerspectiveFor<,>).MakeGenericType(modelType, eventType);
var implementationType = assembly.GetTypes().First(t => t.IsAssignableTo(perspectiveType));
services.AddScoped(perspectiveType, implementationType);
```

The `PerspectiveAssociationInfo<TModel, TEvent>.ApplyDelegate` gives strongly-typed, delegate-based Apply invocation with zero reflection.

---

## Debugging Generated Code

### View Generated File

With the shipped defaults (`WhizbangEmitMessageRegistry=true` sets `EmitCompilerGeneratedFiles` and points output at the ignored cache folder):

```
.whizbang/cache/Whizbang.Generators/Whizbang.Generators.PerspectiveDiscoveryGenerator/
└── PerspectiveRegistrations.g.cs
```

Or configure explicitly:
```xml{title="View Generated File" description="Explicit generated-files output" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "View", "Generated"]}
<PropertyGroup>
  <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
  <CompilerGeneratedFilesOutputPath>.whizbang/cache</CompilerGeneratedFilesOutputPath>
</PropertyGroup>
```

---

## Best Practices

### DO ✅

- ✅ **Implement `IPerspectiveFor<TModel, TEvent...>`** with one Apply per event type
- ✅ **Keep Apply pure** — no I/O, no side effects, deterministic
- ✅ **Use event timestamps** for time values
- ✅ **Put `[StreamId]` on the model** and on every event the perspective listens to
- ✅ **Group related events** in one perspective class
- ✅ **Call `AddWhizbangPerspectives()`** and chain a storage provider on the returned builder

### DON'T ❌

- ❌ Perform database or HTTP calls in Apply (build error via purity analyzer)
- ❌ Use `async` Apply methods (build error)
- ❌ Use `DateTime.UtcNow` in Apply (breaks deterministic replay)
- ❌ Put business logic in perspectives (belongs in receptors)
- ❌ Manually register perspectives (generator handles this)
- ❌ Modify generated files (regenerated every build)

---

## Troubleshooting

### Problem: Perspective Not Invoked

**Symptoms**: Event published but the perspective's model never updates.

**Causes**:
1. Class doesn't implement an `IPerspectiveFor<TModel, TEvent...>` variant with the event listed
2. Missing `AddWhizbangPerspectives()` call (or no storage provider configured)
3. Event type missing `[StreamId]` (WHIZ030 build error)

### Problem: Generator Doesn't Find Perspectives

**Symptoms**: `PerspectiveRegistrations.g.cs` has no registrations.

**Causes**:
1. No concrete classes implement a perspective interface with >1 type argument
2. Perspective classes are abstract (skipped — they can't be instantiated)

```csharp{title="Problem: Generator Doesn't Find Perspectives" description="Concrete vs abstract perspectives" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Problem:", "Generator"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_AbstractClass_IsIgnoredAsync"]}
// ✅ Concrete class - discovered
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> { /* ... */ }

// ❌ Abstract class - skipped by generator
public abstract class BasePerspective : IPerspectiveFor<OrderSummary, OrderCreated> { /* ... */ }
```

### Problem: Build Error WHIZ100-WHIZ103

**Symptoms**: Purity analyzer errors on Apply methods.

**Solution**: Remove I/O and async code from Apply. Anything requiring services or awaits belongs in a receptor; Apply only folds the event into the model.

---

## Further Reading

**Source Generators**:
- [Receptor Discovery](receptor-discovery.md) - Compile-time receptor discovery
- [Message Registry](message-registry.md) - VSCode extension integration
- [Aggregate IDs](aggregate-ids.md) - [StreamId] discovery and extraction
- [JSON Contexts](json-contexts.md) - AOT-compatible JSON serialization
- [Configuration](configuration.md) - Perspective table naming configuration

**Core Concepts**:
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Lenses](../../fundamentals/lenses/lenses.md) - Query-optimized repositories

**Data Access**:
- [Perspectives Storage](../../data/perspectives-storage.md) - Read model schema design
- [Event Store](../../data/event-store.md) - Event sourcing and replay

**Workers**:
- [Perspective Worker](../../operations/workers/perspective-worker.md) - Processing lifecycle and runtime behavior
- [Execution Lifecycle](../../operations/workers/execution-lifecycle.md) - Startup/shutdown coordination

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
