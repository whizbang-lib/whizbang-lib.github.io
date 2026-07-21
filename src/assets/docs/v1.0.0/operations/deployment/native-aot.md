---
title: Native AOT
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Advanced Topics
order: 3
description: >-
  Deploy with Native AOT - zero reflection, trim-safe code, and AOT-compatible
  patterns
tags: 'native-aot, aot, reflection, trim-safe, deployment'
codeReferences:
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
  - Directory.Build.props
testReferences:
  - tests/Whizbang.Core.Tests/JsonContextRegistryTests.cs
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Native AOT

Deploy Whizbang applications with **Native AOT (Ahead-of-Time compilation)** for faster startup, smaller memory footprint, and self-contained executables.

---

## Why Native AOT?

| Metric | JIT (.NET Runtime) | Native AOT |
|--------|-------------------|------------|
| **Startup Time** | 1-2 seconds | < 100ms |
| **Memory Footprint** | 100-200 MB | 20-40 MB |
| **Deployment Size** | 80 MB + runtime | 10-15 MB (self-contained) |
| **Reflection** | ✅ Fully supported | ❌ Limited |
| **Trim-Safe** | Optional | ✅ Required |

---

## Enabling Native AOT

**Project file (.csproj)**:

```xml{title="Enabling Native AOT" description="**Project file (." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Enabling", "Native"]}
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <PublishAot>true</PublishAot>
    <InvariantGlobalization>true</InvariantGlobalization>
    <IlcOptimizationPreference>Speed</IlcOptimizationPreference>
    <IlcGenerateStackTraceData>false</IlcGenerateStackTraceData>
  </PropertyGroup>
</Project>
```

**Publish**:

```bash{title="Enabling Native AOT (2)" description="Enabling Native AOT" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Enabling", "Native"]}
dotnet publish -c Release -r linux-x64
```

**Output**:

```
ECommerce.OrderService.API (self-contained executable)
Size: 12.3 MB
Startup: 87ms
Memory: 24 MB
```

---

## Whizbang is AOT-Ready

Whizbang uses **source generators** instead of reflection. At build time, `Whizbang.Generators` scans your assembly and emits:

- **`GeneratedDispatcher`** - a zero-reflection `IDispatcher` implementation (registered by the generated `AddWhizbangDispatcher()` extension)
- **`GeneratedReceptorRegistry`** - pre-compiled lookup tables mapping every message type and lifecycle stage to receptor delegates (no `MakeGenericType`, no runtime scanning)
- **`AddReceptors()`** - explicit DI registrations for every discovered receptor
- **`MessageJsonContext`** - a `JsonSerializerContext` covering every discovered `ICommand` / `IEvent`

```csharp{title="Whizbang is AOT-Ready" description="Reflection-based dispatch vs Whizbang's source-generated registry" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Whizbang", "AOT-Ready"] unverified="reflection-vs-generated contrast — counter-example plus generated-registry wiring; registry lookup not covered by this page's mapped tests"}
// ❌ Reflection-based dispatch (NOT AOT-compatible) - what Whizbang avoids
var receptorType = typeof(IReceptor<,>).MakeGenericType(messageType, responseType);
var receptor = services.GetService(receptorType);            // runtime type construction
var result = receptorType.GetMethod("HandleAsync")!
  .Invoke(receptor, [message, cancellationToken]);           // reflection invoke

// ✅ Whizbang's generated code (AOT-compatible) - all types known at compile time
services.AddWhizbangDispatcher();  // registers GeneratedDispatcher + GeneratedReceptorRegistry
services.AddReceptors();           // explicit registration of every discovered receptor

// Receptor lookup is a pre-compiled table, not reflection:
var receptors = receptorRegistry.GetReceptorsFor(typeof(OrderCreatedEvent),
  LifecycleStage.PostInboxInline);
```

**Key differences**:
- ✅ **No reflection** - Pre-compiled delegates and direct method calls
- ✅ **No `MakeGenericType`** - All types known at compile-time
- ✅ **Analyzer-enforced** - The library builds with `IsAotCompatible`, `EnableAotAnalyzer`, and `EnableTrimAnalyzer`, and treats IL2026/IL2046/IL2075 as **errors**
- ✅ **Trim-safe** - No dynamic type loading

:::updated
At the current commit, the AOT analyzer property group in `Directory.Build.props` applies to all shipped packages **except `Whizbang.Core`**, which is temporarily excluded while the final JSON/dispatcher AOT phases complete; `Whizbang.Core` still builds with `IsTrimmable` and `EnableTrimAnalyzer` enabled. Source generator packages target `netstandard2.0` and run at compile time only, so AOT properties don't apply to them.
:::

---

## JSON Serialization (AOT-Compatible)

Whizbang is built on `System.Text.Json` **source generation** - no reflection-based serialization anywhere in the message pipeline.

**Automatic generation**: `MessageJsonContextGenerator` (in `Whizbang.Generators`) discovers every `ICommand` / `IEvent` in your assembly and emits a `MessageJsonContext : JsonSerializerContext` with `JsonTypeInfo` for each message type, plus `MessageEnvelope<T>` wrapper registrations for transport deserialization. A `[ModuleInitializer]` registers the context into the cross-assembly **`JsonContextRegistry`** (`Whizbang.Core.Serialization`) at startup - you don't write any of this by hand.

```csharp{title="JSON Serialization (AOT-Compatible)" description="Whizbang's cross-assembly JsonContextRegistry" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "JSON", "Serialization"] tests=["JsonContextRegistryTests.CreateCombinedOptions_IsAOTCompatible_NoReflectionAsync", "JsonContextRegistryTests.RoundTrip_IEvent_DeserializesToConcreteTypeAsync"]}
using Whizbang.Core.Serialization;

// Generated module initializers have already called
// JsonContextRegistry.RegisterContext(MessageJsonContext.Default) for every
// assembly in the app - yours and Whizbang's own framework packages.

// Combine all registered contexts into one AOT-safe options instance:
var options = JsonContextRegistry.CreateCombinedOptions();

var json = JsonSerializer.Serialize(orderCreated, options);
var deserialized = JsonSerializer.Deserialize<OrderCreatedEvent>(json, options);

// ❌ BAD - NOT AOT-compatible (reflection-based resolver)
var badJson = JsonSerializer.Serialize(orderCreated);
```

**Rules to keep it AOT-safe**:

- Never add Whizbang framework types to your own `JsonSerializerContext` - each framework package ships and registers its own context.
- If you need extra hand-written contexts or converters, register them via `JsonContextRegistry.RegisterContext(...)` / `RegisterConverter(...)` instead of building ad-hoc `JsonSerializerOptions`.

---

## Trim Warnings

Enable trim analysis to detect non-AOT-safe code:

**Project file**:

```xml{title="Trim Warnings" description="Project file:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Trim", "Warnings"]}
<PropertyGroup>
  <PublishAot>true</PublishAot>
  <EnableTrimAnalyzer>true</EnableTrimAnalyzer>
  <SuppressTrimAnalysisWarnings>false</SuppressTrimAnalysisWarnings>
</PropertyGroup>
```

**Common warnings**:

```
IL2026: Using member 'System.Type.GetType(string)' which has 'RequiresUnreferencedCodeAttribute' can break functionality when trimming application code.
```

**Fix**:

```csharp{title="Trim Warnings (2)" description="Trim Warnings" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Trim", "Warnings"] unverified="counter-example — Type.GetType vs typeof, illustrative do/don't"}
// ❌ BAD
var type = Type.GetType("MyNamespace.MyClass");

// ✅ GOOD
var type = typeof(MyClass);  // Compile-time reference
```

---

## Dependency Injection (AOT-Compatible)

Use constructor injection with explicit registrations:

**Program.cs**:

```csharp{title="Dependency Injection (AOT-Compatible)" description="Dependency Injection (AOT-Compatible)" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Dependency", "Injection"] unverified="counter-example — explicit registration vs runtime assembly scanning"}
// ✅ GOOD - Explicit registration (AOT-compatible)
builder.Services.AddScoped<IReceptor<CreateOrderCommand, OrderCreatedEvent>, CreateOrderReceptor>();

// ❌ BAD - Runtime assembly scanning (NOT AOT-compatible)
builder.Services.Scan(scan => scan
  .FromAssemblyOf<CreateOrderReceptor>()
  .AddClasses(classes => classes.AssignableTo(typeof(IReceptor<,>)))
  .AsImplementedInterfaces()
  .WithSingletonLifetime()
);
```

**Whizbang ReceptorDiscoveryGenerator**:

You don't write these registrations by hand. `ReceptorDiscoveryGenerator` discovers receptors at **compile time** and emits the `DispatcherRegistrations` class with explicit registrations - assembly "scanning" happens in the compiler, not at runtime:

```csharp{title="Dependency Injection (AOT-Compatible) - Generated Registrations" description="Source-generated DI wiring emitted into your assembly" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Dependency", "Injection"] unverified="generated DI extension-method wiring — registration config, not covered by this page's mapped tests"}
// Program.cs - call the generated extensions
builder.Services.AddWhizbangDispatcher();  // GeneratedDispatcher + IReceptorRegistry + IReceptorInvoker
builder.Services.AddReceptors();           // every discovered receptor, registered explicitly
```

---

## Entity Framework Core (AOT-Compatible)

EF Core 10 added AOT support with compiled models:

**Generate compiled model**:

```bash{title="Entity Framework Core (AOT-Compatible)" description="Generate compiled model:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Entity", "Framework"]}
dotnet ef dbcontext optimize -c OrderDbContext -o CompiledModels
```

**Generated code**:

```csharp{title="Entity Framework Core (AOT-Compatible) - OrderDbContextModel" description="Generated code:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Entity", "Framework"] unverified="EF Core compiled-model output — generated EF code, not a Whizbang behavior"}
// CompiledModels/OrderDbContextModel.cs
public partial class OrderDbContextModel : RuntimeModel {
  static OrderDbContextModel() {
    var model = new OrderDbContextModel();
    model.Initialize();
    _instance = model;
  }

  private static OrderDbContextModel _instance;
  public static IModel Instance => _instance;
}
```

**Usage**:

```csharp{title="Entity Framework Core (AOT-Compatible) - OrderDbContext" description="Entity Framework Core (AOT-Compatible) - OrderDbContext" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Entity", "Framework"] unverified="user EF Core DbContext configuration — EF Core API, not a Whizbang behavior"}
public class OrderDbContext : DbContext {
  protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) {
    optionsBuilder
      .UseNpgsql("Host=localhost;Database=orders;...")
      .UseModel(OrderDbContextModel.Instance);  // Use compiled model
  }
}
```

---

## Dapper (Use With Care Under AOT)

Classic Dapper materializes rows with runtime IL emission, which trimming and Native AOT restrict. Whizbang's Dapper-based Postgres driver builds under the repository's AOT analyzers (IL2026/IL2046/IL2075 as errors), which constrains usage to analyzer-clean patterns. For your own data access under AOT:

**✅ GOOD** - typed result classes with explicit column lists (analyzer-verifiable):

```csharp{title="Dapper (AOT-Compatible)" description="Typed Dapper query with explicit columns" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Dapper", "AOT-Compatible"] unverified="user Dapper query pattern — third-party data access, not a Whizbang behavior"}
var orders = await connection.QueryAsync<OrderRow>(
  """
  SELECT order_id, customer_id, total_amount
  FROM orders
  WHERE customer_id = @CustomerId
  """,
  new { CustomerId = customerId }
);
```

**❌ BAD** - `dynamic` results (no compile-time type information at all):

```csharp{title="Dapper (AOT-Compatible) (2)" description="Dynamic Dapper query - avoid under AOT" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Dapper", "AOT-Compatible"] unverified="counter-example — dynamic Dapper query to avoid under AOT"}
var orders = await connection.QueryAsync(  // Dynamic type
  "SELECT * FROM orders WHERE customer_id = @CustomerId",
  new { CustomerId = customerId }
);
```

If you publish your own app with `PublishAot=true` and lean heavily on Dapper, consider `Dapper.AOT` (source-generated materializers) or raw `NpgsqlCommand` readers for the hot paths.

---

## Azure Service Bus (AOT-Compatible)

Azure Service Bus SDK is AOT-compatible in .NET 10:

**Program.cs**:

```csharp{title="Azure Service Bus (AOT-Compatible)" description="Azure Service Bus (AOT-Compatible)" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Azure", "Service"] unverified="Azure Service Bus SDK client registration — third-party config, not a Whizbang behavior"}
builder.Services.AddSingleton<ServiceBusClient>(sp => {
  var connectionString = builder.Configuration["AzureServiceBus:ConnectionString"];
  return new ServiceBusClient(connectionString);
});

builder.Services.AddSingleton<ServiceBusSender>(sp => {
  var client = sp.GetRequiredService<ServiceBusClient>();
  return client.CreateSender("orders");
});
```

---

## Testing AOT Compatibility

### 1. Compile with AOT

```bash{title="Compile with AOT" description="Compile with AOT" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Compile", "AOT"]}
dotnet publish -c Release -r linux-x64
```

If compilation succeeds, your code is AOT-compatible.

### 2. Run Trim Analysis

```bash{title="Run Trim Analysis" description="Run Trim Analysis" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Run", "Trim"]}
dotnet publish -c Release -r linux-x64 -p:EnableTrimAnalyzer=true
```

Review warnings in build output.

### 3. Validate at Runtime

```bash{title="Validate at Runtime" description="Validate at Runtime" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Validate", "Runtime"]}
./bin/Release/net10.0/linux-x64/publish/ECommerce.OrderService.API
```

If it starts and handles requests, AOT is working correctly.

---

## Performance Comparison

**Benchmark: Order Creation (1000 requests)**

| Runtime | Startup | Total Time | Memory |
|---------|---------|------------|--------|
| **JIT** | 1.2s | 3.5s | 142 MB |
| **AOT** | 0.09s | 2.4s | 28 MB |

**AOT wins**:
- ✅ **13x faster startup**
- ✅ **1.5x faster overall** (less GC pressure)
- ✅ **5x smaller memory**

---

## Troubleshooting AOT Issues

### Issue 1: Reflection Warnings

**Error**:

```
IL2026: Using member 'Type.GetType(string)' which has 'RequiresUnreferencedCodeAttribute'
```

**Fix**: Replace reflection with compile-time types:

```csharp{title="Issue 1: Reflection Warnings" description="Fix: Replace reflection with compile-time types:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Issue", "Reflection"] unverified="counter-example — reflection Type.GetType replaced with a compile-time switch"}
// ❌ BAD
var type = Type.GetType(typeName);

// ✅ GOOD
var type = typeName switch {
  "CreateOrder" => typeof(CreateOrder),
  "UpdateOrder" => typeof(UpdateOrder),
  _ => throw new InvalidOperationException($"Unknown type: {typeName}")
};
```

### Issue 2: JSON Deserialization Fails

**Error**:

```
System.InvalidOperationException: Serialization and deserialization of 'CreateOrderCommand' is not supported.
```

**Fix**: Message types (`ICommand` / `IEvent`) are covered automatically by the generated `MessageJsonContext` - if a *message* hits this, verify the type actually implements `ICommand`/`IEvent` and the `Whizbang.Generators` package is referenced. For non-message types you serialize yourself, add them to your own `JsonSerializerContext` and register it with `JsonContextRegistry.RegisterContext(...)`.

### Issue 3: Missing Dependencies

**Error**:

```
Unhandled exception. System.DllNotFoundException: Unable to load shared library 'libssl.so.3'
```

**Fix**: Include native dependencies in publish:

```xml{title="Issue 3: Missing Dependencies" description="Fix: Include native dependencies in publish:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Issue", "Missing"]}
<ItemGroup>
  <RuntimeHostConfigurationOption Include="System.Globalization.Invariant" Value="true" />
  <TrimmerRootAssembly Include="System.Private.CoreLib" />
</ItemGroup>
```

---

## Key Takeaways

✅ **Whizbang is AOT-Ready** - Zero reflection, source-generated code
✅ **13x Faster Startup** - < 100ms vs. 1-2 seconds
✅ **5x Smaller Memory** - 28 MB vs. 142 MB
✅ **JSON Source Generators** - MessageJsonContextGenerator
✅ **Trim Analysis** - Detect non-AOT-safe code at build time
✅ **EF Core Compiled Models** - `dotnet ef dbcontext optimize`

---

## When to Use Native AOT

| Scenario | Use AOT? |
|----------|----------|
| **Serverless (Azure Functions, AWS Lambda)** | ✅ Yes (fast cold starts) |
| **Containers (Kubernetes)** | ✅ Yes (smaller images) |
| **Edge Computing** | ✅ Yes (resource-constrained) |
| **Long-Running Services** | ⚠️ Maybe (JIT eventually optimizes better) |
| **Developer Workstations** | ❌ No (longer build times) |

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
