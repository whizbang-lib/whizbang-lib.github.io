---
title: Perspective Association Info
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
order: 4
description: >-
  Type metadata linking perspectives to their models and tracked types for
  source generator discovery
tags: 'perspectives, association, metadata, source-generators, registration'
codeReferences:
  - src/Whizbang.Generators/PerspectiveInfo.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Generators/PerspectiveRunnerRegistryGenerator.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerClassTemplate.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunnerRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveAssociationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratedSizeTests.cs
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveAssociationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Association Info

Perspective association metadata tracks the relationship between perspective implementations, their model types, and the event types they handle. It enables compile-time discovery and runtime registration of perspectives without reflection.

:::updated
This page covers the **compile-time discovery metadata** used by source generators. The primary metadata record at the shipped commit is the generator-internal `PerspectiveInfo` (in `Whizbang.Generators`); a smaller internal record named `PerspectiveAssociationInfo` exists inside the EF Core association generator. Neither is a public runtime type — the public runtime metadata surface is `MessageAssociation` and `PerspectiveRegistrationInfo`. For the **generic** `PerspectiveAssociationInfo<TModel, TEvent>` record used for **runtime invocation** of perspective Apply methods via strongly-typed delegates, see [PerspectiveAssociationInfo (Typed Delegates)](association-info.md).
:::

## Purpose

The perspective discovery system needs to know:
- Which model type a perspective projects to
- Which event types the perspective handles
- How to construct and invoke the perspective runner

The discovery metadata provides this bridge between compile-time analysis and runtime execution.

## Structure

### Compile-time: `PerspectiveInfo` (generator-internal)

`PerspectiveDiscoveryGenerator` extracts one `PerspectiveInfo` per discovered perspective interface. It is a value-equality record (critical for incremental generator performance) defined in `Whizbang.Generators`:

```csharp{title="PerspectiveInfo (abridged)" description="Generator-internal discovery metadata record" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Structure"] unverified="abridged generator-internal record, not asserted verbatim by a test"}
namespace Whizbang.Generators;

/// <summary>
/// Value type containing information about a discovered perspective.
/// This record uses value equality which is critical for incremental generator performance.
/// </summary>
internal sealed record PerspectiveInfo(
    string ClassName,              // Fully qualified class name (global:: prefixed)
    string SimpleName,             // Simple class name (incl. parent for nested classes)
    string ClrTypeName,            // CLR format name for database storage ("Namespace.Parent+Child")
    string[] InterfaceTypeArguments, // TModel, TEvent1, TEvent2, ... from IPerspectiveFor
    string[] EventTypes,           // Fully qualified event type names
    string[] MessageTypeNames,     // Event names in database format ("TypeName, AssemblyName")
    string? StreamIdPropertyName = null,
    // ... validation, physical fields, storage mode, record-model flag, scope inheritance
    bool IsWithActionsInterface = false,
    bool IsModelRecord = false
);
```

### Runtime: `PerspectiveRegistrationInfo` (public)

The generated `PerspectiveRunnerRegistry` exposes registered perspectives through `IPerspectiveRunnerRegistry.GetRegisteredPerspectives()`:

```csharp{title="PerspectiveRegistrationInfo" description="Public runtime metadata exposed by IPerspectiveRunnerRegistry" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Structure"] unverified="hand-written public record definition, no generator test asserts its shape"}
namespace Whizbang.Core.Perspectives;

/// <summary>
/// Information about a registered perspective for diagnostic purposes.
/// </summary>
public sealed record PerspectiveRegistrationInfo(
    string ClrTypeName,                 // Lookup key ("MyApp.Perspectives.OrderPerspective")
    string FullyQualifiedName,          // For code generation ("global::MyApp.Perspectives.OrderPerspective")
    string ModelType,                   // "global::MyApp.Models.OrderModel"
    IReadOnlyList<string> EventTypes    // Fully qualified event types handled
);
```

### EF Core generator: internal `PerspectiveAssociationInfo`

The EF Core association generator carries its own minimal internal record — a (perspective, message-type) pair used to emit JSON association registrations:

```csharp{title="EF Core PerspectiveAssociationInfo" description="Internal record in Whizbang.Data.EFCore.Postgres.Generators" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Structure"] unverified="abridged internal EF Core generator record, not asserted verbatim"}
namespace Whizbang.Data.EFCore.Postgres.Generators;

internal sealed record PerspectiveAssociationInfo(
    string PerspectiveClrTypeName,  // "Namespace.Parent+Child" for nested types
    string MessageTypeName          // Database format: "TypeName, AssemblyName"
);
```

## How It Works

### Compile-Time Discovery

The `PerspectiveDiscoveryGenerator` scans for types implementing the `IPerspectiveFor<TModel, TEvent...>` family (and `IPerspectiveWithActionsFor<TModel, TEvent...>`), including classes that implement multiple perspective interfaces:

```csharp{title="Compile-Time Discovery" description="The PerspectiveDiscoveryGenerator scans for types implementing IPerspectiveFor<TModel, TEvent>:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Compile-Time", "Discovery"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveMultipleEvents_GeneratesMultipleRegistrationsAsync"]}
// Your code
public class OrderSummaryPerspective :
    IPerspectiveFor<OrderSummaryDto, OrderCreated>,
    IPerspectiveFor<OrderSummaryDto, OrderShipped> {

  public OrderSummaryDto Apply(OrderSummaryDto current, OrderCreated evt) { ... }
  public OrderSummaryDto Apply(OrderSummaryDto current, OrderShipped evt) { ... }
}
```

### Generated Associations

From the extracted `PerspectiveInfo`, the generator emits `MessageAssociation` entries into `PerspectiveRegistrationExtensions.GetMessageAssociations(serviceName)`:

```csharp{title="Generated Association" description="The generator creates association entries:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Generated", "Association"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GetMessageAssociations_ReturnsCorrectAssociationsAsync", "PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_TopLevelPerspective_UsesClrTypeNameInMessageAssociationAsync"]}
// Auto-generated inside GetMessageAssociations(serviceName)
return new MessageAssociation[] {
  new MessageAssociation("MyApp.Events.OrderCreated, MyApp", "perspective", "MyApp.Perspectives.OrderSummaryPerspective", serviceName),
  new MessageAssociation("MyApp.Events.OrderShipped, MyApp", "perspective", "MyApp.Perspectives.OrderSummaryPerspective", serviceName)
};
```

### Runtime Registration

`AddWhizbangPerspectives()` (generated into `{AssemblyName}.Generated`) registers each perspective against its interface as a **Scoped** service — one registration per implemented perspective interface:

```csharp{title="Runtime Registration" description="Runtime Registration" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Runtime", "Registration"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveOneEvent_GeneratesRegistrationAsync"]}
// Auto-generated registration inside AddWhizbangPerspectives()
services.AddScoped<IPerspectiveFor<OrderSummaryDto, OrderCreated>, OrderSummaryPerspective>();
services.AddScoped<IPerspectiveFor<OrderSummaryDto, OrderShipped>, OrderSummaryPerspective>();
```

## Generated Components

For each discovered perspective, the generators create:

### 1. Perspective Runner

`PerspectiveRunnerGenerator` emits a runner class per perspective. Each runner derives from the generated `PerspectiveRunnerBase<TPerspective, TModel>`, which implements `IPerspectiveRunner`; its `RunAsync` returns a `PerspectiveCursorCompletion`:

```csharp{title="Perspective Runner" description="Perspective Runner" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Perspective", "Runner"] unverified="illustrative generated runner skeleton with placeholder bodies"}
internal sealed class OrderSummaryPerspectiveRunner
    : PerspectiveRunnerBase<OrderSummaryPerspective, OrderSummaryDto> {
  // The event types, and the traits that differ from their defaults
  private static readonly RunnerTraits _traits = new() { /* ... */ };

  // The DI constructor passes the traits and services to the base
  public OrderSummaryPerspectiveRunner(/* services */) : base(_traits /* , services */) { }

  protected override OrderSummaryDto CreateEmptyModel(Guid streamId) {
    // The model's empty value
  }

  protected override (OrderSummaryDto?, ModelAction) ApplyEventCore(
      OrderSummaryPerspective perspective,
      OrderSummaryDto? currentModel,
      IEvent @event) {
    // One case per event type, calling Apply through the interface that lists it
  }
}
```

:::note
The runner logic every perspective shares (loading the model, applying events, saving the row and cursor, rewinds, rebuilds and snapshots) lives in Whizbang.Core, as `PerspectiveRunnerBase<TPerspective, TModel>`, and is not generated. Each runner holds only its varying parts: its event list, its traits, its `Apply` dispatch, its empty model, any overrides it needs and its registrations. A simple runner is about 4 KB of generated source. See [Build Cost](../../operations/performance/build-cost#perspective-runners) for what this saves.
:::
{verified: PerspectiveRunnerGeneratedSizeTests.ARunner_EmitsOnlyWhatItsPerspectiveVaries_NotTheSharedRunnerLogicAsync, PerspectiveRunnerGeneratedSizeTests.ASecondPerspective_AddsOnlyItsOwnRunner_NoRunnerBaseIsGeneratedAsync}

### 2. Registry Entry

`PerspectiveRunnerRegistryGenerator` emits a `PerspectiveRunnerRegistry` class implementing `IPerspectiveRunnerRegistry` with a zero-reflection switch on the CLR type name:

```csharp{title="Registry Entry" description="Registry Entry" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Registry", "Entry"] tests=["PerspectiveRunnerRegistryGeneratorTests.Generator_WithNonNestedPerspective_UsesSimpleNameAsync"]}
// In generated PerspectiveRunnerRegistry
public IPerspectiveRunner? GetRunner(string perspectiveName, IServiceProvider serviceProvider) {
  return perspectiveName switch {
    "MyApp.Perspectives.OrderSummaryPerspective"
        => serviceProvider.GetRequiredService<OrderSummaryPerspectiveRunner>(),
    _ => null
  };
}
```

### 3. Event Namespace Subscriptions

Module initializers populate the `EventNamespaceRegistry` with the namespaces of handled events. At transport startup, the runtime `EventSubscriptionDiscovery` service (in `Whizbang.Core.Routing`) combines these auto-discovered namespaces with manual `RoutingOptions.SubscribeTo()` subscriptions — minus owned domains — to determine which event topics the service subscribes to.

## Example Workflow

### Step 1: Define Perspective

```csharp{title="Step 1: Define Perspective" description="Step 1: Define Perspective" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Step", "Define"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_SinglePerspectiveMultipleEvents_GeneratesMultipleRegistrationsAsync"]}
public class ProductCatalogPerspective :
    IPerspectiveFor<ProductDto, ProductCreated>,
    IPerspectiveFor<ProductDto, ProductUpdated> {

  public ProductDto Apply(ProductDto current, ProductCreated evt) {
    return new ProductDto {
      ProductId = evt.ProductId,
      Name = evt.Name,
      Price = evt.Price
    };
  }

  public ProductDto Apply(ProductDto current, ProductUpdated evt) {
    return current with {
      Name = evt.Name ?? current.Name,
      Price = evt.Price ?? current.Price
    };
  }
}
```

### Step 2: Generator Extracts Metadata

```csharp{title="Step 2: Generator Extracts Metadata" description="Step 2: Generator Extracts Metadata" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Step", "Generator"] unverified="illustrative metadata extraction example, not asserted verbatim"}
// Extracted at compile time (generator-internal, one per perspective interface)
new PerspectiveInfo(
  ClassName: "global::MyApp.Perspectives.ProductCatalogPerspective",
  SimpleName: "ProductCatalogPerspective",
  ClrTypeName: "MyApp.Perspectives.ProductCatalogPerspective",
  InterfaceTypeArguments: ["global::MyApp.Models.ProductDto", "global::MyApp.Events.ProductCreated"],
  EventTypes: ["global::MyApp.Events.ProductCreated"],
  MessageTypeNames: ["MyApp.Events.ProductCreated, MyApp"]
)
```

### Step 3: Generator Creates Runner

```csharp{title="Step 3: Generator Creates Runner" description="Step 3: Generator Creates Runner" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Step", "Generator"] unverified="simplified illustrative generated runner"}
// Auto-generated runner (simplified): only what this perspective varies
internal sealed class ProductCatalogPerspectiveRunner
    : PerspectiveRunnerBase<ProductCatalogPerspective, ProductDto> {
  private static readonly RunnerTraits _traits = new() {
    EventTypes = new global::System.Type[] { typeof(ProductCreated), typeof(ProductUpdated) }
  };

  protected override ProductDto CreateEmptyModel(Guid streamId) {
    return new ProductDto();
  }

  protected override (ProductDto?, ModelAction) ApplyEventCore(
      ProductCatalogPerspective perspective,
      ProductDto? currentModel,
      IEvent @event) {
    switch (@event) {
      case ProductCreated created:
        return (((IPerspectiveFor<ProductDto, ProductCreated>)perspective).Apply(currentModel!, created), ModelAction.None);
      case ProductUpdated updated:
        return (((IPerspectiveFor<ProductDto, ProductUpdated>)perspective).Apply(currentModel!, updated), ModelAction.None);
      default:
        throw new InvalidOperationException($"Unhandled event type {@event.GetType().Name}");
    }
  }
}

// RunAsync, the event read, the model upsert and the cursor save are inherited from
// PerspectiveRunnerBase<ProductCatalogPerspective, ProductDto>, generated once per assembly.
```

## Benefits

**Compile-Time Safety**:
- Type errors caught at build time
- No runtime reflection needed

**AOT Compatibility**:
- All associations resolved at compile-time
- Zero runtime type scanning

**Performance**:
- Direct method calls (no reflection)
- Optimal code generation

**Observability**:
- Clear mapping between perspectives and models
- Easy to debug perspective registration

## Diagnostics

The generators emit diagnostics when processing perspectives:

**WHIZ007**: Perspective discovered (Info)
```
info WHIZ007: Found perspective 'OrderSummaryPerspective' listening to OrderCreated, OrderShipped
```

**WHIZ028**: Perspective runner registry generated (Info)
```
info WHIZ028: Generated perspective runner registry with 4 runner(s) for zero-reflection lookup (AOT-compatible)
```

**WHIZ032**: Perspective name collision (Error)
```
error WHIZ032: Multiple perspectives found with name 'OrderSummaryPerspective': MyApp.A.OrderSummaryPerspective, MyApp.B.OrderSummaryPerspective. Use unique class names.
```

## See Also

- [Perspectives Guide](./perspectives.md) - Perspective fundamentals
- [PerspectiveAssociationInfo (Typed Delegates)](association-info.md) - Runtime invocation via delegates
- [Typed Associations](typed-associations.md) - GetPerspectiveAssociations method details
- [Perspective Worker](../../operations/workers/perspective-worker.md) - Runtime execution

---

*Version 1.0.0 - Foundation Release*
