---
title: "WhizbangIds: Strongly-Typed Identity Values"
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: "Core Concepts"
order: 24
description: >-
  Whizbang uses strongly-typed identity values based on UUIDv7 for all identifiers.
  Provides compile-time type safety, prevents ID mixing, and enables AOT-compatible
  dependency injection with source-generated value types and TrackedGuid metadata.
tags: 'whizbang-ids, identity, uuidv7, tracked-guid, type-safety, value-objects, time-ordering, guid-interception'
codeReferences:
  - src/Whizbang.Core/ValueObjects/NameBasedGuid.cs
  - src/Whizbang.Core/IWhizbangId.cs
  - src/Whizbang.Core/ValueObjects/WhizbangId.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuid.cs
  - src/Whizbang.Core/ValueObjects/GuidMetadata.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuidJsonConverter.cs
  - src/Whizbang.Core/WhizbangIdProviderRegistry.cs
  - src/Whizbang.Core/WhizbangIdProvider.cs
  - src/Whizbang.Core/IWhizbangIdProvider.cs
  - src/Whizbang.Core/IWhizbangIdProviderGeneric.cs
  - src/Whizbang.Core/Uuid7IdProvider.cs
  - src/Whizbang.Core/WhizbangIdServiceCollectionExtensions.cs
  - src/Whizbang.Core/WhizbangIdAttribute.cs
  - src/Whizbang.Core/SuppressGuidInterceptionAttribute.cs
  - src/Whizbang.Core/Configuration/WhizbangOptions.cs
  - src/Whizbang.Core/Validation/GuidOrderingValidator.cs
  - src/Whizbang.Core/Validation/GuidOrderingException.cs
  - src/Whizbang.Core/Validation/FrameworkNonTimeOrderedIds.cs
  - src/Whizbang.Core/Observability/GuidOrderingMetrics.cs
  - src/Whizbang.Generators/NonTimeOrderedIdAnalyzer.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
  - src/Whizbang.Generators/GuidInterceptorGenerator.cs
  - src/Whizbang.Generators/GuidUsageAnalyzer.cs
  - tools/Whizbang.Migrate/Transformers/GuidToTrackedGuidTransformer.cs
testReferences:
  - tests/Whizbang.Core.Tests/ValueObjects/NameBasedGuidTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/TrackedGuidTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/TrackedGuidJsonConverterTests.cs
  - tests/Whizbang.Core.Component.Tests/ValueObjects/TrackedGuidMonotonicityTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/GuidMetadataTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdVersionAcceptanceTests.cs
  - tests/Whizbang.Generators.Tests/WhizbangIdAcceptAnyVersionTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdProviderTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdProviderRegistryTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/Uuid7IdProviderTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/IWhizbangIdProviderGenericTests.cs
  - tests/Whizbang.Core.Tests/Validation/GuidOrderingValidatorTests.cs
  - tests/Whizbang.Core.Tests/Validation/GuidOrderingEntryPointValidationTests.cs
  - tests/Whizbang.Core.Tests/Validation/GuidOrderingInMemoryAppendTests.cs
  - tests/Whizbang.Core.Tests/Validation/FrameworkNonTimeOrderedIdsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/GuidOrderingRefusalMatrixTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/GuidOrderingEntryPointGuardTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperGuidOrderingRefusalMatrixTests.cs
  - tests/Whizbang.Generators.Tests/GuidInterceptorRuntimeTests.cs
  - tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/GuidInterceptorGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/ThirdPartyGuidInterceptionTests.cs
  - tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs
  - tests/Whizbang.Migrate.Tests/Transformers/GuidToTrackedGuidTransformerTests.cs
lastMaintainedCommit: '01f07906'
---

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

```csharp{title="TrackedGuid: Metadata-Aware GUID Wrapper" description="For scenarios where you need to work with raw GUIDs while preserving generation metadata, Whizbang provides TrackedGuid:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "TrackedGuid:", "Metadata-Aware"] tests=["TrackedGuidTests.TrackedGuid_New_IsTimeOrdered_ReturnsTrueAsync", "TrackedGuidTests.TrackedGuid_New_SubMillisecondPrecision_ReturnsTrueAsync", "TrackedGuidTests.TrackedGuid_New_Timestamp_ReturnsRecentTimeAsync", "TrackedGuidTests.TrackedGuid_New_HasSourceWhizbangMetadataAsync", "TrackedGuidTests.TrackedGuid_ImplicitToGuid_ReturnsUnderlyingValueAsync", "TrackedGuidTests.TrackedGuid_Parse_WithV7Guid_SetsVersion7MetadataAsync", "TrackedGuidTests.TrackedGuid_FromExternal_MarksAsSourceExternalAsync"]}
using Whizbang.Core.ValueObjects;

// Create with sub-millisecond precision (recommended)
var tracked = TrackedGuid.New();  // The framework's UUIDv7 generator

// Check metadata
bool isTimeOrdered = tracked.IsTimeOrdered;           // true
bool subMs = tracked.SubMillisecondPrecision;         // true
DateTimeOffset when = tracked.Timestamp;              // Extracted from UUIDv7
GuidMetadatas metadata = tracked.Metadata;            // Version7 | SourceWhizbang

// Implicit conversion to Guid
Guid guid = tracked;

// Parse from external sources (database, API)
var parsed = TrackedGuid.Parse("550e8400-e29b-41d4-a716-446655440000");
var external = TrackedGuid.FromExternal(someGuid);
```

### Why TrackedGuid?

| Feature | `Guid.NewGuid()` | `Guid.CreateVersion7()` | `TrackedGuid.New()` |
|---------|------------------|-------------------------|-------------------------|
| Time-ordered | ❌ No (v4) | ✅ Yes (v7) | ✅ Yes (v7) |
| Sub-millisecond precision | ❌ N/A | ❌ No (ms only) | ✅ Yes |
| Metadata preserved | ❌ No | ❌ No | ✅ Yes |
| Monotonic counter | ❌ No | ❌ No | ✅ Yes |
| Database index friendly | ❌ Poor | ✅ Good | ✅ Excellent |

**Recommendation**: Use `[WhizbangId]` types for domain identities, `TrackedGuid` for infrastructure code that needs GUID flexibility with metadata preservation.

### How `New()` orders ids {#uuid7-generator}
{verified: Uuid7GeneratorTests.Shared_OneMillionIdsInATightLoop_AreStrictlyIncreasingAsync, Uuid7GeneratorTests.Shared_ManyThreadsAtOnce_AreUniqueAndIncreasingPerThreadAsync, Uuid7GeneratorTests.Shared_IssueOrderIsSortOrder_AcrossThreadsAsync, Uuid7GeneratorTests.NewGuid_CounterExhausted_BorrowsTheNextMillisecondInsteadOfWrappingAsync, Uuid7GeneratorTests.NewGuid_ClockGoesBackwards_KeepsTheLastMillisecondAndKeepsCountingAsync}

`TrackedGuid.New()` is served by the framework's own UUIDv7 generator. Every id it issues sorts after every id issued before it in the process, compared as big-endian bytes, which is how the string form, the wire and PostgreSQL's `uuid` type order them. Events, cursors and claims are ordered by id across the framework, so that one property carries a lot.

| Bits | Content |
|---|---|
| 0 to 47 | Unix time in milliseconds |
| 48 to 51 | Version `0111` |
| 52 to 63 | Counter, high 12 bits |
| 64 to 65 | Variant `10` |
| 66 to 79 | Counter, low 14 bits |
| 80 to 127 | Random |

The 26-bit counter orders ids within one millisecond. The first id of a millisecond seeds it from 25 random bits, leaving at least 2^25 of room; each further id adds a random step of 1 to 16, so the next id is hard to guess without costing the order. Every id is issued under one lock, so the order ids leave the generator is their sort order even across threads.

Two edge cases are handled explicitly:

- **Counter exhausted.** The generator moves to the next millisecond and reseeds, rather than wrapping to a smaller counter inside the same millisecond.
- **Clock goes backwards.** The generator keeps issuing in the last millisecond it used and keeps counting, then resumes real time once the clock passes it again.

The layout is RFC 9562 version 7 with a fixed-length dedicated counter (section 6.2, method 1). Ids used to come from the Medo.Uuid7 package and now come from the framework's own generator, tagged `SourceWhizbang`. They have exactly the shape they had before, so ids already stored or in flight read as they always did.

### Tracking GUID Sources

`TrackedGuid` tracks where and how each GUID was created using the `GuidMetadatas` flags (note the plural — the enum type is `GuidMetadatas`, declared in `GuidMetadata.cs`):

```csharp{title="Tracking GUID Sources" description="TrackedGuid tracks where and how each GUID was created using the GuidMetadatas flags:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Tracking", "GUID"] tests=["TrackedGuidTests.TrackedGuid_IsTracking_OnlyAuthoritativeSourcesReturnTrueAsync", "TrackedGuidTests.TrackedGuid_New_HasSourceWhizbangMetadataAsync", "TrackedGuidTests.TrackedGuid_FromExternal_MarksAsSourceExternalAsync", "TrackedGuidTests.TrackedGuid_FromExternal_DetectsVersionAsync"]}
// Freshly created - full metadata available
var fresh = TrackedGuid.New();
Console.WriteLine(fresh.IsTracking);           // true (authoritative)
Console.WriteLine(fresh.SubMillisecondPrecision); // true (known)
Console.WriteLine(fresh.Metadata);             // Version7 | SourceWhizbang

// Loaded from database - metadata is inferred
var loaded = TrackedGuid.FromExternal(dbGuid);
Console.WriteLine(loaded.IsTracking);          // false (not authoritative)
Console.WriteLine(loaded.SubMillisecondPrecision); // false (unknown source)
Console.WriteLine(loaded.Metadata);            // Version7 | SourceExternal (inferred)
```

**Key Point**: Only GUIDs created through `New()`, `NewMicrosoftV7()`, or `NewRandom()` have **authoritative** metadata (`IsTracking = true`, defined as having a `SourceWhizbang`, `SourceMedo` or `SourceMicrosoft` flag). GUIDs loaded from external sources have **inferred** metadata based on version detection.

### Debugging with TrackedGuid

`TrackedGuid` helps you debug GUID-related issues by tracking creation sources and timestamps:

#### Problem 1: "Where did this GUID come from?"

```csharp{title="Problem 1: 'Where did this GUID come from?'" description="Problem 1: 'Where did this GUID come from?'" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Problem", "'Where"] tests=["TrackedGuidTests.TrackedGuid_IsTracking_OnlyAuthoritativeSourcesReturnTrueAsync", "TrackedGuidTests.TrackedGuid_FromExternal_MarksAsSourceExternalAsync", "TrackedGuidTests.TrackedGuid_New_HasSourceWhizbangMetadataAsync"]}
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
      var m when (m & GuidMetadatas.SourceWhizbang) != 0 => "TrackedGuid.New()",
      var m when (m & GuidMetadatas.SourceMedo) != 0 => "Medo.Uuid7 (called directly)",
      var m when (m & GuidMetadatas.SourceMicrosoft) != 0 => "Microsoft GUID",
      var m when (m & GuidMetadatas.SourceExternal) != 0 => "Database/API",
      var m when (m & GuidMetadatas.SourceParsed) != 0 => "Parsed string",
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

```csharp{title="Problem 2: 'Why are my IDs not sorting chronologically?'" description="Problem 2: 'Why are my IDs not sorting chronologically?'" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Problem", "'Why"] tests=["TrackedGuidTests.TrackedGuid_NewRandom_IsTimeOrdered_ReturnsFalseAsync", "TrackedGuidTests.TrackedGuid_New_IsTimeOrdered_ReturnsTrueAsync", "TrackedGuidTests.TrackedGuid_New_SubMillisecondPrecision_ReturnsTrueAsync", "TrackedGuidTests.TrackedGuid_New_Timestamp_ReturnsRecentTimeAsync"]}
public void DebugIdOrdering(List<TrackedGuid> ids) {
  foreach (var id in ids) {
    var timestamp = id.Timestamp;
    var version = (id.Metadata & GuidMetadatas.Version7) != 0 ? "v7" : "v4";
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

```csharp{title="Problem 3: 'Did I use the right GUID generator?'" description="Problem 3: 'Did I use the right GUID generator?'" category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Identity", "Problem", "'Did"] tests=["TrackedGuidTests.TrackedGuid_New_HasSourceWhizbangMetadataAsync", "TrackedGuidTests.TrackedGuid_NewMicrosoftV7_HasSourceMicrosoftMetadataAsync", "TrackedGuidTests.TrackedGuid_NewRandom_HasVersion4MetadataAsync"]}
public class IdGenerationValidator {
  public void ValidateIdUsage(TrackedGuid id, string context) {
    // Check if using recommended generator
    if ((id.Metadata & GuidMetadatas.SourceWhizbang) != 0) {
      Console.WriteLine($"✅ {context}: Using the recommended TrackedGuid.New()");
      return;
    }

    // Check if using Microsoft v7 (acceptable but not optimal)
    if ((id.Metadata & GuidMetadatas.SourceMicrosoft) != 0 &&
        (id.Metadata & GuidMetadatas.Version7) != 0) {
      Console.WriteLine(
          $"⚠️  {context}: Using Guid.CreateVersion7() - consider TrackedGuid.New() for sub-ms precision");
      return;
    }

    // Check if using v4 (problematic)
    if ((id.Metadata & GuidMetadatas.Version4) != 0) {
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
validator.ValidateIdUsage(TrackedGuid.New(), "OrderId");
validator.ValidateIdUsage(TrackedGuid.NewRandom(), "TestId");
```

**Output**:
```
✅ OrderId: Using the recommended TrackedGuid.New()
❌ TestId: Using UUIDv4 (random) - not time-ordered, fragments indexes
```

#### Problem 4: "When was this GUID created?"

```csharp{title="Problem 4: 'When was this GUID created?'" description="Problem 4: 'When was this GUID created?'" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Problem", "'When"] tests=["TrackedGuidTests.TrackedGuid_New_Timestamp_ReturnsRecentTimeAsync", "TrackedGuidTests.TrackedGuid_NewRandom_IsTimeOrdered_ReturnsFalseAsync"]}
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

```csharp{title="JSON Serialization with TrackedGuidJsonConverter" description="TrackedGuid serializes as a plain UUID string, not as an object with metadata:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "JSON", "Serialization"] tests=["TrackedGuidJsonConverterTests.Write_WithTrackedGuid_SerializesAsPlainUuidStringAsync", "TrackedGuidJsonConverterTests.Write_InObjectProperty_SerializesAsUuidStringNotObjectAsync", "TrackedGuidJsonConverterTests.RoundTrip_MetadataIsLost_AfterDeserializationAsync", "TrackedGuidJsonConverterTests.Read_WithValidGuidString_MarksAsExternalSourceAsync", "TrackedGuidJsonConverterTests.RoundTrip_ObjectWithTrackedGuid_PreservesGuidValueAsync"]}
using System.Text.Json;
using Whizbang.Core.ValueObjects;

public class Order {
  public TrackedGuid OrderId { get; set; }
  public string CustomerName { get; set; }
}

var order = new Order {
  OrderId = TrackedGuid.New(),
  CustomerName = "Alice"
};

// TrackedGuid has no [JsonConverter] attribute — register the converter in your
// options. (Whizbang registers it automatically in its JsonContextRegistry, so
// framework serialization paths already use it.)
var options = new JsonSerializerOptions {
  PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
  Converters = { new TrackedGuidJsonConverter() }
};

// Serialize to JSON
var json = JsonSerializer.Serialize(order, options);
// Result: {"orderId":"019c7df5-494b-77d6-b994-e7145b796ec0","customerName":"Alice"}
// NOT: {"orderId":{"value":"...","metadata":5}}

// Deserialize from JSON
var deserialized = JsonSerializer.Deserialize<Order>(json, options);
Console.WriteLine(deserialized.OrderId.IsTracking); // false (metadata lost)
Console.WriteLine(deserialized.OrderId.Metadata);   // Version7 | SourceExternal (inferred via FromExternal)
```

**Why serialize as string?**
- PostgreSQL UUID column compatibility
- Efficient JSONB queries in databases
- Interoperability with systems expecting standard UUID format
- Smaller JSON payload (no metadata object overhead)

**Important**: Metadata is **not preserved** across serialization boundaries. After deserialization, `IsTracking` will be `false` and metadata is inferred from the GUID version.

## Guid Interception (On by Default) {#guid-interception}

Whizbang ships a compile-time interceptor that replaces `Guid.NewGuid()` and `Guid.CreateVersion7()` with
`TrackedGuid.New()`, the framework's UUIDv7 generator. A `Guid.NewGuid()` written anywhere in your project therefore
returns a time-ordered UUIDv7 with counter precision, so an id minted that way can be used as an event or message id
without being refused by the [time-ordering checks](#time-ordering-checks).

Interception is on by default. A project that never sets `WhizbangGuidInterceptionEnabled` gets it
{verified: GuidInterceptorRuntimeTests.InterceptedNewGuid_WithTheDefaultConfiguration_ReturnsVersion7Async, GuidInterceptorGeneratorTests.Generator_NoOptionSet_InterceptsByDefaultAsync, GuidInterceptorGeneratorTests.Generator_DeclaredButUnsetInterceptionProperty_KeepsInterceptionOnAsync}.

### What is intercepted

| Call written | Returns with interception on |
|--------------|------------------------------|
| `Guid.NewGuid()` | `TrackedGuid.New()`: a UUIDv7, strictly increasing within the process |
| `Guid.CreateVersion7()` | `TrackedGuid.New()`: a UUIDv7 that also orders within a millisecond |

The intercepted method still returns a `Guid`, so no calling code changes
{verified: GuidInterceptorGeneratorTests.Generator_NewGuid_IsReplacedWithTrackedGuidNewAsync, GuidInterceptorGeneratorTests.Generator_CreateVersion7_IsReplacedWithTrackedGuidNewAsync, GuidInterceptorRuntimeTests.InterceptedCreateVersion7_ReturnsVersion7Async, GuidInterceptorRuntimeTests.InterceptedNewGuid_IsTheCounterPrecisionGenerator_StrictlyIncreasingAsync}.

```csharp{title="An intercepted Guid.NewGuid() is a UUIDv7" description="With interception on (the default), Guid.NewGuid() returns TrackedGuid.New()" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Interception", "UUIDv7"] tests=["GuidInterceptorRuntimeTests.InterceptedNewGuid_WithTheDefaultConfiguration_ReturnsVersion7Async", "GuidInterceptorRuntimeTests.InterceptedNewGuid_IsTheCounterPrecisionGenerator_StrictlyIncreasingAsync"]}
// Your code
var id = Guid.NewGuid();

// What runs (generated interceptor)
// internal static Guid Intercept_...() => TrackedGuid.New();

// id.Version == 7, and each call sorts after the one before it
```

Calls the interceptor does not touch:

- Calls inside `Whizbang.*` namespaces; the framework mints its own ids
  {verified: GuidInterceptorGeneratorTests.Generator_CallerInWhizbangNamespace_NotInterceptedAsync}.
- `Guid.Parse`, `Guid.Empty` and constructors such as `new Guid(bytes)`
  {verified: GuidInterceptorGeneratorTests.Generator_GuidParse_NotInterceptedAsync, GuidInterceptorGeneratorTests.Generator_GuidEmpty_NotInterceptedAsync}.
  An interceptor cannot reach these, or a value read from the wire, so [WHIZ037](../../operations/diagnostics/whiz037)
  warns when one of them flows into a message id, an event id or a `[StreamId]` member.
- Third-party generators such as Marten's `CombGuidIdGeneration`, UUIDNext and Medo.Uuid7. They already return
  time-ordered ids, and an interceptor cannot attach metadata to the `Guid` they return, so no interceptor is generated
  for them
  {verified: ThirdPartyGuidInterceptionTests.Generator_ThirdPartyCall_IsNotInterceptedAsync, ThirdPartyGuidInterceptionTests.Generator_ThirdPartyCall_CompilesWithInterceptionOnAsync, ThirdPartyGuidInterceptionTests.Generator_MixedWithSystemGuid_InterceptsOnlySystemGuidAsync}.

### The interceptors namespace

The generated interceptors live in the `Whizbang.Generators.Generated` namespace, which the C# compiler must be told to
allow. The generator package's props adds it to `InterceptorsNamespaces` for every project that references the
package, so a NuGet consumer has nothing to set. A project that references the generator as a project, rather than as a
package, adds it itself:

```xml{title="Allow the interceptors namespace" description="Only for a project that references the generator as a project; the NuGet package sets this for you" category="Configuration" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Interception", "MSBuild"] unverified="MSBuild property; the package's props sets it for consumers"}
<PropertyGroup>
  <InterceptorsNamespaces>$(InterceptorsNamespaces);Whizbang.Generators.Generated</InterceptorsNamespaces>
</PropertyGroup>
```

### Turning interception off {#turning-interception-off}

**Turning interception off is strongly advised against.** Without it, every `Guid.NewGuid()` in your code is a random
UUIDv4 again, and any of them that becomes an event or message id is refused by the
[time-ordering checks](#time-ordering-checks) at runtime instead of being fixed at compile time. Keep a deliberate v4
with `[SuppressGuidInterception]` at the one place that needs it instead.

If you must, only the value `false` turns it off (in any case, with surrounding whitespace ignored); an unset, blank or
unrecognized value leaves it on. With it off, no interceptor is generated and WHIZ058 is not reported
{verified: GuidInterceptorGeneratorTests.IsInterceptionEnabled_OnlyFalseTurnsItOffAsync, GuidInterceptorGeneratorTests.Generator_InterceptionSetToFalse_GeneratesAndReportsNothingAsync, GuidInterceptorGeneratorTests.Generator_BlankInterceptionProperty_KeepsInterceptionOnAsync, GuidInterceptorRuntimeTests.InterceptionTurnedOff_ReturnsVersion4Async}.

```xml{title="Turning interception off (strongly advised against)" description="Only false turns interception off; prefer [SuppressGuidInterception] where one v4 is needed" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Interception", "MSBuild"] tests=["GuidInterceptorGeneratorTests.Generator_InterceptionSetToFalse_GeneratesAndReportsNothingAsync", "GuidInterceptorRuntimeTests.InterceptionTurnedOff_ReturnsVersion4Async"]}
<PropertyGroup>
  <!-- Strongly advised against: Guid.NewGuid() returns a random v4 again -->
  <WhizbangGuidInterceptionEnabled>false</WhizbangGuidInterceptionEnabled>
</PropertyGroup>
```

#### GuidMetadatas Flags {#guid-metadata}

The `GuidMetadatas` flags enum (declared in `GuidMetadata.cs`) tracks both the UUID version and creation source of a
`TrackedGuid`:

```csharp{title="GuidMetadatas Flags" description="The GuidMetadatas flags enum tracks both the UUID version and creation source:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "GuidMetadatas", "Flags"] tests=["GuidMetadataTests.GuidMetadata_Version4_IsBit0Async", "GuidMetadataTests.GuidMetadata_Version7_IsBit1Async", "GuidMetadataTests.GuidMetadata_SourceMedo_IsBit2Async", "GuidMetadataTests.GuidMetadata_SourceWhizbang_IsBit14Async", "GuidMetadataTests.GuidMetadata_SourceMicrosoft_IsBit3Async", "GuidMetadataTests.GuidMetadata_SourceExternal_IsBit5Async", "GuidMetadataTests.GuidMetadata_ThirdPartySources_HaveCorrectBitPositionsAsync", "GuidMetadataTests.GuidMetadata_UnderlyingType_IsUshortAsync", "GuidMetadataTests.GuidMetadata_HasFlagsAttribute_ReturnsTrueAsync"]}
namespace Whizbang.Core.ValueObjects;

[Flags]
public enum GuidMetadatas : ushort {
  None = 0,

  // UUID Version (bits 0-1)
  Version4 = 1 << 0,  // Random UUID - not time-ordered
  Version7 = 1 << 1,  // Time-ordered UUID - chronologically sortable

  // Creation Source (bits 2-6)
  SourceMedo = 1 << 2,       // Medo.Uuid7
  SourceMicrosoft = 1 << 3,  // Guid.NewGuid() / CreateVersion7()
  SourceParsed = 1 << 4,     // Parsed from string
  SourceExternal = 1 << 5,   // From database, API, deserialization
  SourceUnknown = 1 << 6,    // Implicit conversion from Guid
  Reserved = 1 << 7,         // Reserved for future use

  // Third-Party Libraries (bits 8-13)
  SourceMarten = 1 << 8,     // Marten CombGuidIdGeneration
  SourceUuidNext = 1 << 9,   // UUIDNext library
  SourceDaanV2 = 1 << 10,    // DaanV2.UUID library
  SourceUuids = 1 << 11,     // UUIDs library
  SourceGuidOne = 1 << 12,   // GuidOne library
  SourceTaiizor = 1 << 13,   // Taiizor UUID library

  // Framework (bit 14)
  SourceWhizbang = 1 << 14   // TrackedGuid.New() - the framework's own generator, sub-millisecond precision
}
```

**Why Track Sources?**

Different GUID generators have different characteristics:
- **`TrackedGuid.New()`** (the framework's generator): Sub-millisecond precision, monotonic counter
- **Microsoft v7**: Millisecond precision only
- **Microsoft v4**: Random, not time-ordered
- **External**: Unknown precision and ordering guarantees

An intercepted call returns a plain `Guid`, so it carries no metadata; hold a `TrackedGuid` from `TrackedGuid.New()`
where you want the source recorded.

### Suppressing Interception

Use `[SuppressGuidInterception]` to keep the original call where a random v4 is genuinely wanted. The suppressed call
returns a v4, and [WHIZ059](../../operations/diagnostics/whiz059) records it
{verified: GuidInterceptorRuntimeTests.SuppressedNewGuid_ReturnsVersion4Async}. Such an id must not become an event or
message id: the time-ordering checks refuse it.

```csharp{title="Suppressing Interception" description="Use [SuppressGuidInterception] to keep a deliberate v4" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Suppressing", "Interception"] tests=["GuidInterceptorGeneratorTests.Generator_SuppressOnMethod_NoInterceptionAsync", "GuidInterceptorGeneratorTests.Generator_SuppressOnClass_NoInterceptionAsync", "GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync", "GuidInterceptorRuntimeTests.SuppressedNewGuid_ReturnsVersion4Async"]}
using Whizbang.Core;

public class LegacyService {
  [SuppressGuidInterception]
  public Guid CreateLegacyId() {
    return Guid.NewGuid();  // Not intercepted: a random v4
  }
}

// Or suppress entire class
[SuppressGuidInterception]
public class TestFixtures {
  // All Guid calls in this class are not intercepted
}
```

A `#pragma warning disable WHIZ055` (or `WHIZ056`) region around a call also skips interception for that call, without
reporting WHIZ059 {verified: GuidInterceptorGeneratorTests.Generator_PragmaDisableWhiz055_SuppressesInterceptionAsync}.

### Checking a TrackedGuid yourself

`GuidOrderingValidator.ValidateForTimeOrdering` checks one `TrackedGuid` against the same severity the entry points use
(see [Time-ordering checks](#time-ordering-checks)). The framework already runs its checks at every entry point; call
this only for an id of your own that you need to be time-ordered.

```csharp{title="Checking a TrackedGuid" description="ValidateForTimeOrdering throws at Error and logs at Warning or Info" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Runtime", "Validation"] tests=["GuidOrderingValidatorTests.ValidateForTimeOrdering_WithV4Guid_LogsWarningAtWarningAsync", "GuidOrderingValidatorTests.ValidateForTimeOrdering_WithV7Guid_PassesValidationAsync", "GuidOrderingValidatorTests.ValidateForTimeOrdering_WithSeverityError_ThrowsExceptionAsync", "GuidOrderingValidatorTests.WhizbangOptions_HasCorrectDefaultsAsync"]}
using Whizbang.Core.Configuration;
using Whizbang.Core.Validation;

var options = new WhizbangOptions {
  GuidOrderingViolationSeverity = GuidOrderingSeverity.Warning
};
var validator = new GuidOrderingValidator(options, logger);

// Logs a warning if trackedGuid is not a UUIDv7; at Error (the default) it throws GuidOrderingException
validator.ValidateForTimeOrdering(trackedGuid, "EventId");
```

`DisableGuidTracking` bypasses `ValidateForTimeOrdering` only; it does not turn off the entry point checks.

### Diagnostics

- **[WHIZ058](../../operations/diagnostics/whiz058)** - Info: GUID call intercepted and replaced with `TrackedGuid.New()`
- **[WHIZ059](../../operations/diagnostics/whiz059)** - Info: Interception suppressed
- **[WHIZ037](../../operations/diagnostics/whiz037)** - Warning: a constructed or parsed Guid flows into an id

## GuidUsageAnalyzer: Roslyn Analyzer (WHIZ055-WHIZ056) {#analyzer}

Whizbang includes a Roslyn analyzer (`GuidUsageAnalyzer`) that detects problematic GUID generation patterns at compile-time:

```csharp{title="GuidUsageAnalyzer: Roslyn Analyzer (WHIZ055-WHIZ056)" description="Whizbang includes a Roslyn analyzer (GuidUsageAnalyzer) that detects problematic GUID generation patterns at" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "GuidUsageAnalyzer:", "Roslyn"] tests=["GuidUsageAnalyzerTests.Analyzer_GuidNewGuid_ReportsWHIZ055WarningAsync", "GuidUsageAnalyzerTests.Analyzer_GuidCreateVersion7_ReportsWHIZ056WarningAsync"]}
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class GuidUsageAnalyzer : DiagnosticAnalyzer {
  // Detects: Guid.NewGuid() (WHIZ055) and Guid.CreateVersion7() (WHIZ056)
}
```

The analyzer runs during compilation and provides **instant feedback in your IDE** when you use GUID patterns that could cause problems.

### WHIZ055: Guid.NewGuid() Usage

**Severity**: Warning

```csharp{title="WHIZ055: Guid.NewGuid() Usage" description="Severity: Warning" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "WHIZ055:", "Guid.NewGuid"] tests=["GuidUsageAnalyzerTests.Analyzer_GuidNewGuid_ReportsWHIZ055WarningAsync", "GuidUsageAnalyzerTests.Analyzer_TrackedGuidNew_NoErrorAsync", "GuidUsageAnalyzerTests.Analyzer_WhizbangIdNew_NoErrorAsync"]}
// ⚠️ Warning: Use TrackedGuid.New() or a [WhizbangId] type instead
var id = Guid.NewGuid();  // WHIZ055: Detected at compile-time
                          // IDE shows squiggle and warning

// ✅ Fix 1: Use TrackedGuid
var id = TrackedGuid.New();

// ✅ Fix 2: Use strongly-typed ID
var orderId = OrderId.New();
```

**Why**: `Guid.NewGuid()` creates UUIDv4 (random) which:
- Is **not time-ordered** → breaks chronological assumptions
- **Fragments database indexes** → poor query performance
- Has **no timestamp** → can't extract creation time

**Impact**: B-tree indexes in PostgreSQL/SQL Server fragment over time, causing page splits and degraded performance.

With [Guid interception](#guid-interception) on, the default, the call is replaced with `TrackedGuid.New()` at
compile time, so the id is a UUIDv7 anyway. The warning stays so the code says what it gets: write `TrackedGuid.New()`
or a `[WhizbangId]` type.

### WHIZ056: Guid.CreateVersion7() Usage

**Severity**: Warning

```csharp{title="WHIZ056: Guid.CreateVersion7() Usage" description="Severity: Warning" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "WHIZ056:", "Guid.CreateVersion7"] tests=["GuidUsageAnalyzerTests.Analyzer_GuidCreateVersion7_ReportsWHIZ056WarningAsync", "GuidUsageAnalyzerTests.Analyzer_TrackedGuidNew_NoErrorAsync"]}
// ⚠️ Warning: Use TrackedGuid.New() for sub-millisecond precision
var id = Guid.CreateVersion7();  // WHIZ056: Detected at compile-time

// ✅ Fix: Use TrackedGuid for sub-millisecond precision
var id = TrackedGuid.New();
```

**Why**: `Guid.CreateVersion7()` only has **millisecond precision**:
- In high-throughput scenarios, multiple IDs within same millisecond may not sort correctly
- `TrackedGuid.New()` provides **sub-millisecond precision** + a monotonic counter
- Better ordering guarantees in distributed systems

**Real-World Example**:

```csharp{title="WHIZ056: Guid.CreateVersion7() Usage (2)" description="Real-World Example:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "WHIZ056:", "Guid.CreateVersion7"] tests=["TrackedGuidTests.TrackedGuid_New_MultipleIds_AreTimeOrderedAsync"]}
// Problematic with Guid.CreateVersion7()
for (int i = 0; i < 100; i++) {
  var id = Guid.CreateVersion7();  // Multiple IDs in same millisecond
  await InsertEventAsync(id);      // May not sort correctly!
}

// Fixed with TrackedGuid.New()
for (int i = 0; i < 100; i++) {
  var id = TrackedGuid.New();  // Sub-millisecond + monotonic counter
  await InsertEventAsync(id);      // Guaranteed correct ordering
}
```

### Suppressing Analyzer Warnings

For **legitimate cases** where you need raw GUID operations. A `#pragma warning disable WHIZ055` (or `WHIZ056`)
region also skips interception for the calls inside it, so they return their original values; the `SuppressMessage`
attribute and `NoWarn` only hide the warning, and those calls are still intercepted:

```csharp{title="Suppressing Analyzer Warnings" description="For legitimate cases where you need raw GUID operations:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Suppressing", "Analyzer"] tests=["GuidUsageAnalyzerTests.Analyzer_WithPragmaSuppress_NoErrorAsync"]}
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

```csharp{title="How the Analyzer Works" description="The GuidUsageAnalyzer uses syntax node analysis to detect problematic patterns:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Analyzer", "Works"] tests=["GuidUsageAnalyzerTests.Analyzer_GuidNewGuid_ReportsWHIZ055WarningAsync", "GuidUsageAnalyzerTests.Analyzer_GuidCreateVersion7_ReportsWHIZ056WarningAsync"]}
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

## Name-based ids {#name-based-ids}

{verified: NameBasedGuidTests.V5_RfcDnsNamespaceVector_MatchesTheReferenceImplementationAsync, NameBasedGuidTests.V5_SameInputs_ProduceTheSameIdAsync, NameBasedGuidTests.V5_DifferentNames_ProduceDifferentIdsAsync, NameBasedGuidTests.V5_DifferentNamespaces_ProduceDifferentIdsAsync, NameBasedGuidTests.V5_EmptyName_IsAValidNameWithItsOwnIdAsync, NameBasedGuidTests.V5_StampsVersionFiveAndTheRfcVariantAsync}

Most ids are minted: `TrackedGuid.New()` gives a fresh, time-ordered id. Some ids must instead be **derivable without
coordination**: every writer, on every instance, has to arrive at the same id from the same facts. A minted id cannot
serve there, because two writers minting independently land on two different ids. `NameBasedGuid.V5(namespace, name)`
derives an RFC 4122 version 5 id: SHA-1 over the namespace's big-endian bytes followed by the UTF-8 name, the first 16
bytes kept, version 5 and the RFC variant stamped. The same namespace and name always produce the same id, and Postgres
produces it too with `uuid_generate_v5(namespace, name)` from the `uuid-ossp` extension. It uses no reflection and
allocates nothing beyond its input buffer, so it is safe under AOT and on hot paths.

```csharp{title="Derive a name-based id" description="NameBasedGuid.V5 derives the same version 5 id from the same namespace and name on every writer" framework="NET10" category="Identity" difficulty="BEGINNER" tags=["identity", "NameBasedGuid", "uuid-v5", "deterministic-ids"] tests=["NameBasedGuidTests.V5_SameInputs_ProduceTheSameIdAsync", "NameBasedGuidTests.V5_DifferentNamespaces_ProduceDifferentIdsAsync"]}
using Whizbang.Core.ValueObjects;

var ns = NameBasedGuid.V5(Guid.Empty, "my-app.invoice-ledger.v1");
var ledgerStream = NameBasedGuid.V5(ns, tenantId);   // the same tenant always yields the same stream
```

The framework uses it wherever writers must agree:

| Id | Namespace and name | Why it is derived |
|---|---|---|
| A tenant's [audit ledger stream](../security/audit-logging#dedicated-system-stream) | `V5(nil, "sys-audit")`, then the tenant id | Every audit writer appends to one stream per tenant |
| An [audit record](../security/audit-logging#rebuilding-the-audit-ledger) | `V5(nil, "sys-audit-record")`, then the audited event's id | A record derived again from the same event is the same record, so a rebuild reproduces it |
| A chunk of a [split rebuild request](../perspectives/rebuild#large-stream-selections) | the request id, then the chunk index | The same request always splits into the same runs |
| A [repair answer's broker session](../../resilience/stream-integrity#answer-session-key) (`RedeliveryPump.AnswerSessionFor`) | `V5(nil, "whizbang.redelivery-answer-session.v1")`, then the origin, the reply topic, the requester and the scope | Every page of one selection and every instance of the origin derive the same session, so a stream split across bundles keeps its order |

**Never change a name** once ids derived from it are stored: a later derivation has to produce the ids already on
disk. Put a version in the namespace name (`.v1`) so a deliberate change gets a new namespace instead.

## Quick Start

### Defining a WhizbangId

```csharp{title="Defining a WhizbangId" description="Defining a WhizbangId" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Defining", "WhizbangId"] tests=["WhizbangIdGeneratorTests.Generator_WithExplicitTypeDeclaration_GeneratesValueObjectAsync", "WhizbangIdGeneratorTests.Generator_WithMultipleIdTypes_GeneratesAllAsync"]}
using Whizbang.Core;

[WhizbangId]
public readonly partial struct OrderId;

[WhizbangId]
public readonly partial struct CustomerId;
```

The `[WhizbangId]` attribute triggers source generation that creates:
- Value object with `Value` property (Guid)
- `New()` static method for creating new IDs (uses `TrackedGuid.New()` internally)
- `From(Guid)` / `From(TrackedGuid)` static methods for wrapping existing GUIDs: **both validate UUIDv7** and throw `ArgumentException` for non-v7 values (unless the id is declared with [`AcceptAnyVersion`](#accept-any-version))
- `Parse(string)` method for deserialization (validates UUIDv7)
- Equality operators and `IComparable<T>`
- Implicit conversion to Guid (explicit conversion from Guid)
- JSON converter
- **Strongly-typed provider** (`IWhizbangIdProvider<TId>`) via `CreateProvider(...)`
- **Auto-registration** via ModuleInitializer

### Using WhizbangIds

```csharp{title="Using WhizbangIds" description="Using WhizbangIds" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Using", "WhizbangIds"] tests=["WhizbangIdTests.WhizbangId_New_UsesTrackedGuidNewAsync", "WhizbangIdTests.WhizbangId_From_WithV7Guid_SucceedsAsync", "WhizbangIdTests.WhizbangId_From_WithNonV7Guid_ThrowsAsync", "WhizbangIdTests.IWhizbangId_ToGuid_ReturnsUnderlyingValueAsync"]}
// Static creation (uses global WhizbangIdProvider)
var orderId = OrderId.New();

// From existing GUID (must be UUIDv7 — throws ArgumentException otherwise)
var existingId = OrderId.From(guid);

// Parse from string (must parse to a UUIDv7)
var parsedId = OrderId.Parse("3c5e4...");

// Implicit conversion to Guid
Guid guid = orderId;

// Get underlying Guid
Guid underlyingGuid = orderId.Value;
```

### Ids that are not UUIDv7 {#accept-any-version}

Some identities are not UUIDv7 and never will be: name-derived ids (UUIDv5 or v8), ids derived from a hash, and
v4 ids issued by an external identity provider. Declare those ids with `AcceptAnyVersion = true`:

```csharp{title="Accepting any Guid version" description="An id that takes any non-empty Guid, such as one issued by an external identity provider" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "WhizbangId", "AcceptAnyVersion"] tests=["WhizbangIdVersionAcceptanceTests.AnyVersion_FromGuid_RoundTripsAsync", "WhizbangIdVersionAcceptanceTests.AnyVersion_New_StillProducesUuidV7Async", "WhizbangIdVersionAcceptanceTests.AnyVersion_EmptyGuid_IsRejectedByTheCheckedEntryPointsAsync", "WhizbangIdVersionAcceptanceTests.Strict_NonV7_IsRejectedByFromParseCastAndJsonAsync"]}
using Whizbang.Core;

[WhizbangId(AcceptAnyVersion = true)]
public readonly partial struct ExternalUserId;

// A v4 Guid from the identity provider: accepted
var userId = ExternalUserId.From(Guid.Parse("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));

// New() still makes a UUIDv7
var fresh = ExternalUserId.New();

// Guid.Empty is never a valid id: throws ArgumentException
ExternalUserId.From(Guid.Empty);
```

With the option, the checked entry points take any Guid except `Guid.Empty`:

| Way in | Default (`AcceptAnyVersion = false`) | `AcceptAnyVersion = true` |
|--------|--------------------------------------|---------------------------|
| `From(Guid)`, `From(TrackedGuid)` | UUIDv7 only | any non-empty Guid |
| `Parse(string)` | UUIDv7 only | any non-empty Guid |
| Explicit cast from `Guid` | UUIDv7 only | any non-empty Guid |
| Transport JSON reader | UUIDv7 only | any non-empty Guid |
| Public constructor, `Value` initializer | not checked | not checked |
| `New()` | makes a UUIDv7 | makes a UUIDv7 |

Every rejection throws `ArgumentException` (the JSON reader fails the deserialization), and the message names the id
type, for example `ExternalUserId requires a non-empty Guid`.

The public constructor and the `Value` initializer are the load path: EF Core materialization and the persistence
converter go through them, and they store whatever was persisted, on every id. A read model row whose id field was
never set holds `Guid.Empty`, and it still loads. Values arriving from outside your system should come in through
`From`, `Parse`, the cast or the transport JSON reader, which are the checked entry points.

```csharp{title="The load path stays unchecked" description="The constructor and the Value initializer take an empty Guid on an opt-in id, so a stored row whose id was never set still loads" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "WhizbangId", "AcceptAnyVersion"] tests=["WhizbangIdVersionAcceptanceTests.AnyVersion_ConstructorAndValueInit_TakeAnEmptyGuidAsync"]}
var loaded = new ExternalUserId(Guid.Empty);         // does not throw: the load path
var initialized = new ExternalUserId { Value = Guid.Empty }; // does not throw either

ExternalUserId.From(Guid.Empty);                     // throws ArgumentException: a checked entry point
```

#### What the option costs

On an id declared with `AcceptAnyVersion = true`, values are no longer known to be UUIDv7, so:

- `CompareTo` and the `<`, `<=`, `>` and `>=` operators still compare the Guids, but the order no longer reflects
  creation time.
- For a value that is not UUIDv7, `IsTimeOrdered` (`GetIsTimeOrdered()` on the id) is `false`, and `GetTimestamp()`
  returns a time read from bits that do not hold one.
- Database indexes on that id lose the locality that time-ordered values give them.

The framework's own ordering guarantees are unaffected: they rely on event and message ids, which must be UUIDv7
(see [Time-ordering checks](#time-ordering-checks)). A stream id you supply is only hashed for partitioning and sorted
for lock ordering, and neither depends on its version; an `AcceptAnyVersion` stream id is never reported (see
[Stream id versions](#stream-id-versions)).

The default stays strict, so declare the option only on ids whose values come from outside. For ids your system
creates, keep the default, so they stay UUIDv7 and sort by creation time.

#### Declare the option the same way everywhere

An id can be declared through more than one `[WhizbangId]`: on the struct, on a property, or on a constructor
parameter. When some of those set `AcceptAnyVersion = true` and others do not, the id keeps the UUIDv7 rule, whatever
order the attributes are found in, and [WHIZ029](../../operations/diagnostics/whiz029) is reported at each
`AcceptAnyVersion = true` that is ignored.

## Time-ordering checks {#time-ordering-checks}

Event and message ids must be UUIDv7. The framework checks each one where it enters, before any SQL runs, and refuses
an id that is not a UUIDv7 with a `GuidOrderingException`.

Ids the dispatcher derives inside a handling ([emission identity](../dispatcher/message-cascade.md#every-dispatch-path-derives)) are stamped as version 7 by construction, even when their cause is not, so they pass these checks without opting out.
{verified: DerivedIdentityTimeOrderingComponentTests.DerivedIds_QueuedThroughTheStrategyEntryCheck_AreNeitherLoggedNorCountedAsync, DerivedIdentityTimeOrderingComponentTests.EveryDerivedIdKind_FromANonV7Cause_PassesTheCheckSilentlyAsync}

### Why event and message ids must be time-ordered {#why-time-ordered}

The framework reads the time in these ids in several places, and a non-v7 id would put events in the wrong order:

- **Version assignment** orders the events of one stream in a batch by `message_id` before numbering them.
- **Apply order** breaks ties on `event_id` (`ORDER BY version, event_id`) when perspectives apply events.
- **Replay** falls back to `event_id` order when nothing else orders two events.
- **Deduplication** keys on `event_id`, so an id that is not unique in time collides with the wrong event.
- **Lifecycle completions** (`wh_lifecycle_completions`) are partitioned by day using the timestamp in `event_id`. A
  non-v7 id lands in the default partition, which is never dropped.

A random UUIDv4 carries no time, and a UUIDv5 or v8 carries a hash, so any of these orders becomes arbitrary.

### Where ids are checked {#time-ordering-entry-points}

Every path that brings a new event or message id into the framework runs the check
{verified: GuidOrderingEntryPointGuardTests.EveryEntryPointImplementation_RunsTheCheckOrForwardsToOneThatDoesAsync, GuidOrderingEntryPointGuardTests.TheValidator_HasCallersAtEveryNamedEntryPointAsync}:

| Entry point | What is checked |
|-------------|-----------------|
| Work coordinator strategies (Immediate, Interval, Batch, Scoped, StreamAffinity) | Each message passed to `QueueOutboxMessage` and `QueueInboxMessage` |
| EF Core and Dapper work coordinators | Every outbox and inbox write, including dead letters, handler commits and coalesce |
| Event store appends (EF Core, Dapper PostgreSQL, SQLite, in memory) | The envelope's message id, which becomes the event id; the stream id is reported (see [Stream id versions](#stream-id-versions)) |
| Dispatcher | Ids a caller supplies: a cascade's source envelope, a composite's carried child ids, and an id a subclass passes to `CascadeToOutboxAsync` or `CascadeToEventStoreOnlyAsync` |
| Transport receive | The strong id's JSON converter refuses a non-v7 id when the envelope is deserialized |

A batch with one refused id writes none of its rows
{verified: GuidOrderingRefusalMatrixTests.StoreOutbox_NonV7_IsRefusedAndStoresNothingAsync, GuidOrderingRefusalMatrixTests.StoreInbox_NonV7_IsRefusedAndStoresNothingAsync, GuidOrderingRefusalMatrixTests.StoreDeadLetters_NonV7_IsRefusedAndStoresNothingAsync, GuidOrderingRefusalMatrixTests.EventStoreAppend_NonV7_IsRefusedAndStoresNothingAsync, GuidOrderingRefusalMatrixTests.ABatchWithOneRefusedId_StoresNoneOfItsRowsAsync, DapperGuidOrderingRefusalMatrixTests.ABatchWithOneRefusedId_StoresNoneOfItsRowsAsync, GuidOrderingInMemoryAppendTests.Append_NonV7EventId_IsRefusedAndTheStreamStaysEmptyAsync}.

Ids the framework mints itself (`MessageId.New()`, `TrackedGuid.New()`, and ids derived from a message id) are always
UUIDv7 and are never refused.

### GuidOrderingException {#guid-ordering-exception}

The exception names the refused id, the message type, the entry point and the version it received, and exposes them as
`Id`, `MessageType`, `EntryPoint` and `Version`
{verified: GuidOrderingEntryPointValidationTests.ValidateMessageId_NonV7AtError_ThrowsNamingIdTypeEntryPointAndVersionAsync}:

```text{title="GuidOrderingException message" description="The message for a v4 id refused at an outbox write" category="Diagnostics" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "GuidOrderingException"] unverified="message text read from GuidOrderingValidator"}
EFCoreWorkCoordinator.OutboxWrite refused message id 3f2504e0-4f89-41d3-9a0c-0305e82c3301 for OrderPlaced: version 4, but event and message ids must be UUIDv7 (time-ordered). Mint it with TrackedGuid.New() or a [WhizbangId] type; GuidOrderingViolationSeverity can lower this to a warning.
```

The fix is to mint the id with `TrackedGuid.New()`, `MessageId.New()` or a `[WhizbangId]` type's `New()`. With
[Guid interception](#guid-interception) on, the default, a `Guid.NewGuid()` already returns a UUIDv7.

### Severity {#time-ordering-severity}

`WhizbangOptions.GuidOrderingViolationSeverity` (configuration key `Whizbang:GuidOrderingViolationSeverity`) decides
what happens to a non-v7 event or message id. The default is `Error`
{verified: GuidOrderingEntryPointValidationTests.Default_SeverityIsError_AndTheStreamSeverityIsWarningAsync, GuidOrderingEntryPointValidationTests.ValidateMessageId_TheDefaultValidator_RefusesAV4Async}.

| Severity | A non-v7 event or message id |
|----------|------------------------------|
| `Error` (default) | Refused with `GuidOrderingException` |
| `Warning` | Accepted, logged once at Warning, and counted |
| `Info` | Accepted, logged once at Information, and counted |
| `None` | Accepted silently |

Some rules hold at every severity:

- **`Guid.Empty` is always refused**
  {verified: GuidOrderingEntryPointValidationTests.ValidateMessageId_EmptyIsRefusedAtEverySeverityAsync}.
- **A UUIDv7 is always accepted silently**
  {verified: GuidOrderingEntryPointValidationTests.ValidateMessageId_V7_IsAcceptedSilentlyAtEverySeverityAsync}.
- **Transport receive stays strict.** The generated JSON converter for a strong id calls its checked `From`, so a
  non-v7 id on the wire fails deserialization, and the broker dead-letters the message, whatever the severity.

At `Warning` or `Info`, each distinct id is logged once and counted once in the `Whizbang.GuidOrdering` meter (see
[Metrics: time-ordering checks](../../operations/observability/metrics#time-ordering-checks)), so the count is the
number of offending ids and can be driven to zero. The memory of ids already reported is bounded at 100,000
(`GuidOrderingValidator.MAX_REMEMBERED_IDS`); when it fills it is cleared, and an id may then be reported again
{verified: GuidOrderingEntryPointValidationTests.ValidateMessageId_AtWarning_LogsAndCountsEachIdOnceAsync, GuidOrderingEntryPointValidationTests.ValidateMessageId_AtInfo_LogsAtInformationAsync, GuidOrderingEntryPointValidationTests.ValidateMessageId_AtNone_AcceptsSilentlyAsync, GuidOrderingEntryPointValidationTests.ValidateMessageId_TheOncePerIdMemoryIsBounded_AndForgetsWhenFullAsync}.

To move an existing application onto the check, lower the severity to `Warning`, watch
`whizbang.guid_ordering.non_v7_message_ids` until it stays at zero, then return to `Error`:

```csharp{title="Finding non-v7 ids without refusing them" description="Lower the severity while you find and fix the code that mints non-v7 ids" category="Configuration" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "GuidOrdering", "Severity"] tests=["GuidOrderingEntryPointValidationTests.ValidateMessageId_AtWarning_LogsAndCountsEachIdOnceAsync", "GuidOrderingEntryPointValidationTests.Default_SeverityIsError_AndTheStreamSeverityIsWarningAsync"]}
// Temporary: accept, log and count non-v7 event and message ids instead of refusing them.
// The same as setting Whizbang:GuidOrderingViolationSeverity to Warning in configuration.
services.Configure<WhizbangOptions>(options => {
  options.GuidOrderingViolationSeverity = GuidOrderingSeverity.Warning;
});
```

## Stream id versions {#stream-id-versions}

A stream id's version affects only index locality. The framework hashes a stream id for partitioning and lock order,
and sorts it to get a total order, but never reads it for time or for position in the stream; position comes from the
event version. A UUIDv7 stream id keeps related rows close together in the indexes, and another version spreads them
out, which costs some index efficiency and nothing else.

So a stream id that is not a UUIDv7 is **reported, not refused**. `WhizbangOptions.StreamIdOrderingViolationSeverity`
defaults to `Warning`: each such stream id is logged
once and counted in `whizbang.guid_ordering.non_v7_stream_ids`. Raise it to `Error` to refuse non-v7 stream ids, or set
`Info` or `None` to quiet the report
{verified: GuidOrderingEntryPointValidationTests.ReportStreamId_NonV7AtTheDefault_IsAcceptedLoggedOnceAndCountedAsync, GuidOrderingEntryPointValidationTests.ReportStreamId_RaisedToError_IsRefusedAsync, GuidOrderingEntryPointValidationTests.ReportStreamId_AtInfo_LogsAtInformationAsync, GuidOrderingEntryPointValidationTests.ReportStreamId_AtNone_IsSilentAsync, GuidOrderingRefusalMatrixTests.EventStoreAppend_NonV7StreamId_IsStoredByDefault_AndRefusedAtErrorAsync}.

```csharp{title="Strict stream ids" description="Refuse stream ids that are not UUIDv7" category="Configuration" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "StreamId", "Severity"] tests=["GuidOrderingEntryPointValidationTests.ReportStreamId_RaisedToError_IsRefusedAsync", "GuidOrderingInMemoryAppendTests.Append_NonV7StreamId_RaisedToError_IsRefusedAsync"]}
services.Configure<WhizbangOptions>(options => {
  options.StreamIdOrderingViolationSeverity = GuidOrderingSeverity.Error;
});
```

Stream ids that are never reported:

- A stream id whose strong id type is declared with [`[WhizbangId(AcceptAnyVersion = true)]`](#accept-any-version):
  you declared that its values come from outside and are not UUIDv7
  {verified: GuidOrderingEntryPointValidationTests.ReportStreamId_AnIdTypeThatAcceptsAnyVersion_IsNeverReportedAsync, GuidOrderingEntryPointValidationTests.ReportStreamId_AStrictIdType_IsReportedAsync}.
- A UUIDv7, and `Guid.Empty`, which is refused separately as a missing stream id
  {verified: GuidOrderingEntryPointValidationTests.ReportStreamId_V7AndEmpty_AreNeverReportedAsync}.

Stream ids are reported at event store appends and on the dispatcher's outbox path, where the message's .NET type is
known. Outbox and inbox writes carry the message type only as a string, so a stream id that reaches only the inbox
from a remote producer is not reported.

## Framework ids that are not time-ordered {#framework-ids-that-are-not-time-ordered}

A few ids the framework mints are deliberately not UUIDv7: they are derived from a name or a hash so that the same input
always gives the same id. `FrameworkNonTimeOrderedIds.All` lists every such site, with its version, what the id is used
as, and why it is safe. None of them is ever used as an event or message id, so nothing that reads id time order sees
them. A test pins each entry's value, and a source guard test fails when a new non-v7 minting site appears
without an entry
{verified: FrameworkNonTimeOrderedIdsTests.NoEntry_IsAnEventOrMessageIdAsync, FrameworkNonTimeOrderedIdsTests.IntegrityDeliveryId_IsAVersion8IdOfTypeAndPayload_NotAMessageIdAsync, FrameworkNonTimeOrderedIdsTests.AuditRecordId_IsTheVersion5IdOfTheAuditedEvent_APayloadFieldAsync, FrameworkNonTimeOrderedIdsTests.ChunkRequestId_IsTheVersion5IdOfTheChunk_APayloadFieldAsync, FrameworkNonTimeOrderedIdsTests.DeadlineScheduleId_IsARawHashOfSagaAndDeadline_AScheduleIdAsync, GuidOrderingEntryPointGuardTests.EveryNonTimeOrderedMintingSite_IsOnTheListAsync}.

Each entry's use is one of `NotAMessageId` (a payload field, a key of another table, a storage key), `StreamId` (see
[Stream id versions](#stream-id-versions)) or `HashKey` (bytes computed for hashing or comparison, never stored as an
identity). A raw hash's version is arbitrary and is listed as 0.

| Site | Version | Use | Why it is safe |
|------|---------|-----|----------------|
| `IntegrityDeliveryId.For` | 8 | NotAMessageId | The id of a deferred integrity delivery, derived from its type and payload so one delivery is recorded once. It never reaches the inbox, outbox or event store; the drain orders by `queued_at` and uses the id only as a tie-break and the dedup key. |
| `PerspectiveRebuildRequestHandler._runIdFor` | 0 (hash) | NotAMessageId | A multi-stream rebuild run id inside the command payload, derived so a redelivered command finds its run. The command's own message id is minted. |
| `SagaDeadlineScheduler.DeadlineScheduleId` | 0 (hash) | NotAMessageId | A schedule id, derived from the saga stream and the deadline name so re-arming moves the deadline. Occurrences are published with minted message ids. |
| `AuditLedger.RecordIdFor` | 5 | NotAMessageId | The `EventAudited.Id` payload field, derived from the audited event so the same record derived again is the same record. The audit message's own message id is minted. |
| `AuditLedger.StreamFor` | 5 | StreamId | The tenant's audit ledger stream; one stream per tenant. |
| `SystemCommands.ChunkRequestId` | 5 | NotAMessageId | A payload request id of one chunk of a split rebuild request, derived so the same request splits the same way. |
| `RedeliveryPump.AnswerSessionFor` | 5 | StreamId | The broker session and bundle stream of a stream-spanning repair answer; derived so every page agrees. |
| `CollectiveOrdering.StreamIdFor` | 8 | StreamId | The stream of a collective ordering key; one stream per key. |
| `SagaItemStreams.Of` | 5 | StreamId | A saga item's stream, derived from the saga and the item. |
| `NameBasedGuid.V5` | 5 | NotAMessageId | The name-based generator itself; every caller is listed by its own site. |
| `TrackedGuid.NewRandom` | 4 | NotAMessageId | An explicit request for a random v4. A v4 passed to an event or message id entry point is refused there. |
| `TrackedCompletion.TrackingId` | 4 | NotAMessageId | An in-memory handle of a completion being tracked; never stored. |
| `EFCoreWorkCoordinator._instanceId` | 4 | NotAMessageId | A service instance id, not a message id. |
| `EFCorePostgresPerspectiveStore._defaultMetadata` | 4 | NotAMessageId | The placeholder last-applied event id of a row written outside a perspective run. The idempotency filter compares it for equality only, never for order, and a random v4 equals no event. |
| `EFCorePostgresPerspectiveStore._convertPartitionKeyToGuid` | 0 (hash) | HashKey | An MD5 partition key of a perspective row. |
| `DapperPostgresPerspectiveStore._convertPartitionKeyToGuid` | 0 (hash) | HashKey | An MD5 partition key of a perspective row. |
| `RouteNormalizer.RouteId` | 0 (hash) | HashKey | A SHA-256 of a normalized route, used as its identity in trace storage. |
| `IntegrityDigestMath.SingleMissingEventId` | 0 (hash) | HashKey | The XOR of two digests' id lanes. When exactly one event is missing it is that event's id, looked up for presence; otherwise it is only compared. |
| `InMemoryMessageBodyStore.UploadAsync` | 4 | NotAMessageId | A storage key of an offloaded message body. |
| `AzureBlobMessageBodyStore.UploadAsync` | 4 | NotAMessageId | A blob name of an offloaded message body. |

Moving the framework's own stream ids (the four `StreamId` rows) to UUIDv7, for index locality, is an open item.

## Strongly-Typed ID Providers

### The Problem: Generic Code Needs Type-Safe IDs

When writing generic services or utilities, you need type-safe ID generation:

```csharp{title="The Problem: Generic Code Needs Type-Safe IDs" description="When writing generic services or utilities, you need type-safe ID generation:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Problem:", "Generic"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync"]}
// ❌ WRONG: Loses type safety
public class Repository<TEntity> {
    private readonly IWhizbangIdProvider _idProvider;

    public async Task<TEntity> CreateAsync(TEntity entity) {
        entity.Id = _idProvider.NewGuid(); // Returns TrackedGuid - not type-safe!
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

```csharp{title="Interface: `IWhizbangIdProvider<TId>`" description="The generic IWhizbangIdProvider<TId> interface enables type-safe ID generation in generic code:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Interface:", "IWhizbangIdProvider<TId>"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync", "IWhizbangIdProviderGenericTests.NewId_GeneratesUniqueIdsAsync"]}
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

```csharp{title="Interface: `IWhizbangIdProvider<TId>` - Repository" description="Without generic providers, you lose type safety in generic code:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Interface:", "IWhizbangIdProvider<TId>"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync"]}
// ❌ WITHOUT generic provider - loses type safety
public class Repository<TEntity> {
  private readonly IWhizbangIdProvider _provider;

  public TEntity Create() {
    var id = _provider.NewGuid();  // Returns TrackedGuid - not type-safe!
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

```csharp{title="Interface: `IWhizbangIdProvider<TId>` - Order" description="Real-World Example:" category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Identity", "Interface:", "IWhizbangIdProvider<TId>"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync"]}
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

```csharp{title="Auto-Register All Providers (Recommended)" description="When: Standard application setup" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Auto-Register", "All"] tests=["WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_RegistersAllProvidersAsync", "WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_RegistersBaseProviderAsync"]}
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

```csharp{title="Custom Base Provider" description="When: Using database sequences, tenant-specific IDs, or custom ID generation" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Custom", "Base"] unverified="DI-wiring illustration — user-domain SequenceBasedIdProvider registered after AddWhizbangIdProviders (last-registration-wins); no coverage-map test exercises this register-after pattern"}
// Custom ID generator — IWhizbangIdProvider.NewGuid() returns TrackedGuid, not Guid.
// NOTE: generated WhizbangId types validate UUIDv7, so a custom base provider
// must produce time-ordered (v7-form) GUIDs.
public class SequenceBasedIdProvider : IWhizbangIdProvider {
    private readonly IDbConnection _db;

    public TrackedGuid NewGuid() {
        var sequence = _db.GetNextSequence("id_sequence");
        return TrackedGuid.FromExternal(GuidV7FromSequence(sequence));
    }
}

// Register custom provider AFTER AddWhizbangIdProviders — typed providers resolve
// IWhizbangIdProvider from DI lazily, and the LAST registration wins.
builder.Services.AddWhizbangIdProviders();
builder.Services.AddSingleton<IWhizbangIdProvider, SequenceBasedIdProvider>();
// Now ALL typed providers use SequenceBasedIdProvider
// (For a dependency-free provider, pass an instance instead:
//  builder.Services.AddWhizbangIdProviders(new CustomIdProvider());)
```

### 3. Override Specific ID Types

**When**: Some IDs need special generation (e.g., CustomerIds from external system)

```csharp{title="Override Specific ID Types" description="When: Some IDs need special generation (e." category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Override", "Specific"] unverified="DI-wiring illustration — overriding a single typed provider with a user-domain ExternalCustomerIdProvider; no coverage-map test exercises this override"}
builder.Services.AddWhizbangIdProviders();

// Override CustomerIdProvider
builder.Services.AddSingleton<IWhizbangIdProvider<CustomerId>>(sp => {
    var externalSystem = sp.GetRequiredService<IExternalCustomerService>();
    return new ExternalCustomerIdProvider(externalSystem);
});
```

### 4. Test Project Overrides

**When**: Tests need deterministic or custom IDs

```csharp{title="Test Project Overrides" description="When: Tests need deterministic or custom IDs" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Test", "Project"] tests=["WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_WithCustomProvider_UsesCustomProviderAsync"]}
// Test setup
var services = new ServiceCollection();

// Use sequential IDs for tests — pass the instance as the base provider
services.AddWhizbangIdProviders(new SequentialTestIdProvider());

// All typed providers now use SequentialTestIdProvider
var provider = services.BuildServiceProvider();
var orderIdProvider = provider.GetRequiredService<IWhizbangIdProvider<TestOrderId>>();
var id1 = orderIdProvider.NewId(); // TestOrderId(00000000-0000-7000-8000-000000000001)
var id2 = orderIdProvider.NewId(); // TestOrderId(00000000-0000-7000-8000-000000000002)
// Note the v7 version/variant nibbles: generated WhizbangId types reject non-v7 GUIDs.
```

### 5. No DI - Direct Provider Creation

**When**: Console apps, scripts, or areas without DI

```csharp{title="No DI - Direct Provider Creation" description="When: Console apps, scripts, or areas without DI" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Direct", "Provider"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync", "WhizbangIdGeneratorTests.Generator_GeneratesCreateProviderMethodAsync"]}
// Create typed provider directly
var baseProvider = new Uuid7IdProvider();
var orderIdProvider = OrderId.CreateProvider(baseProvider);

var orderId = orderIdProvider.NewId();
```

### 6. Global Provider Configuration

**When**: Want to use the global static provider AND DI

:::updated
The static configuration method is **`WhizbangIdProvider.SetProvider(...)`** (there is no `Configure` method). Note the shipped behavior: the generated static `OrderId.New()` always calls `TrackedGuid.New()` directly — it does **not** consult the global provider. `SetProvider` affects only code that calls `WhizbangIdProvider.NewGuid()` itself. Use the DI-based typed providers (`IWhizbangIdProvider<TId>`) when you need to customize ID generation.
:::

```csharp{title="Global Provider Configuration" description="When: Want to use global static provider AND DI" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Global", "Provider"] tests=["WhizbangIdProviderTests.SetProvider_WithValidProvider_ShouldUseCustomProviderAsync", "WhizbangIdProviderTests.NewGuid_WithDefaultProvider_ShouldReturnUuidV7Async", "WhizbangIdTests.WhizbangId_New_UsesTrackedGuidNewAsync"]}
// Configure the global static provider
WhizbangIdProvider.SetProvider(new Uuid7IdProvider());

// ALSO register with DI (for injection)
builder.Services.AddWhizbangIdProviders();

// Static API — uses the provider set via SetProvider:
TrackedGuid raw = WhizbangIdProvider.NewGuid();

// Generated static factory — always TrackedGuid.New(), ignores SetProvider:
var id1 = OrderId.New();

// DI path — uses the base provider registered with AddWhizbangIdProviders:
var id2 = orderIdProvider.NewId();
```

### 7. Hybrid - Static + DI

**When**: Some code uses static `New()`, some uses DI

```csharp{title="Hybrid - Static + DI" description="When: Some code uses static New(), some uses DI" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Hybrid", "Static"] tests=["WhizbangIdTests.WhizbangId_New_UsesTrackedGuidNewAsync", "WhizbangIdServiceCollectionExtensionsTests.TypedProvider_InjectedInService_CreatesValidIdsAsync"]}
// Configure global static provider (used by WhizbangIdProvider.NewGuid() callers)
WhizbangIdProvider.SetProvider(new Uuid7IdProvider());

// Register for DI
builder.Services.AddWhizbangIdProviders();

public class OrderService {
    // Option 1: Use static New() — always TrackedGuid.New() (see callout above)
    public Order CreateOrder() {
        return new Order {
            Id = OrderId.New()
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

```csharp{title="Multi-Tenant ID Generation" description="When: IDs need tenant prefix or tenant-specific sequences" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Multi-Tenant", "Generation"] unverified="custom-implementation illustration — user-domain TenantAwareIdProvider reading tenant context via IHttpContextAccessor; not covered by any coverage-map test"}
public class TenantAwareIdProvider : IWhizbangIdProvider {
    private readonly IHttpContextAccessor _contextAccessor; // singleton-safe accessor

    public TrackedGuid NewGuid() {
        var tenantId = _contextAccessor.HttpContext?.User.FindFirst("tenant_id")?.Value;
        return TrackedGuid.FromExternal(GenerateTenantPrefixedV7Guid(tenantId));
    }
}

// Register as singleton AFTER AddWhizbangIdProviders (last registration wins);
// typed providers are singletons, so use IHttpContextAccessor for per-request data.
builder.Services.AddWhizbangIdProviders();
builder.Services.AddSingleton<IWhizbangIdProvider, TenantAwareIdProvider>();
// All typed providers now include tenant context
```

### 9. Database Sequence IDs

**When**: Using database-generated sequences for distributed ID generation

```csharp{title="Database Sequence IDs" description="When: Using database-generated sequences for distributed ID generation" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Database", "Sequence"] unverified="custom-implementation illustration — user-domain PostgresSequenceIdProvider backed by a database sequence; not covered by any coverage-map test"}
public class PostgresSequenceIdProvider : IWhizbangIdProvider {
    private readonly NpgsqlConnection _connection;

    public TrackedGuid NewGuid() {
        var sequence = _connection.ExecuteScalar<long>(
            "SELECT nextval('global_id_sequence')"
        );
        return TrackedGuid.FromExternal(ConvertSequenceToV7Guid(sequence));
    }
}

// Register AFTER AddWhizbangIdProviders so this provider wins for typed providers
builder.Services.AddWhizbangIdProviders();
builder.Services.AddSingleton<IWhizbangIdProvider, PostgresSequenceIdProvider>();
```

### 10. Provider Lifetimes (Singleton Only)

**When**: Understanding provider lifetimes in DI

:::updated
Shipped behavior: `AddWhizbangIdProviders()` registers the base `IWhizbangIdProvider` **and every generated `IWhizbangIdProvider<TId>` as singletons**. Scoped base providers are not supported — a scoped `IWhizbangIdProvider` registration would be captured by the singleton typed providers. If a provider needs per-request data, inject a singleton-safe accessor (e.g. `IHttpContextAccessor`) into a singleton provider, as in the multi-tenant pattern above.
:::

```csharp{title="Provider Lifetimes" description="All providers registered by AddWhizbangIdProviders are singletons" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "10.", "Lifetimes"] unverified="conceptual — singleton-lifetime commentary; no coverage-map test asserts the DI ServiceLifetime of AddWhizbangIdProviders registrations (the singleton-lifetime test covers the separate IWhizbangIdFactory API)"}
builder.Services.AddWhizbangIdProviders();

// IWhizbangIdProvider        → singleton (the base provider instance)
// IWhizbangIdProvider<OrderId> → singleton (resolves the base provider from DI lazily)
```

## Advanced Scenarios

### Custom Provider Implementation

```csharp{title="Custom Provider Implementation" description="Custom Provider Implementation" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Custom", "Provider"] unverified="custom-implementation illustration — user-domain CustomOrderIdProvider with logging; not covered by any coverage-map test"}
public class CustomOrderIdProvider : IWhizbangIdProvider<OrderId> {
    private readonly ILogger<CustomOrderIdProvider> _logger;

    public CustomOrderIdProvider(ILogger<CustomOrderIdProvider> logger) {
        _logger = logger;
    }

    public OrderId NewId() {
        var id = OrderId.From(TrackedGuid.New());
        _logger.LogDebug("Generated OrderId: {OrderId}", id);
        return id;
    }
}

// Register custom implementation
builder.Services.AddSingleton<IWhizbangIdProvider<OrderId>, CustomOrderIdProvider>();
```

### Composite Provider (Multiple Strategies)

```csharp{title="Composite Provider (Multiple Strategies)" description="Composite Provider (Multiple Strategies)" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Composite", "Provider"] unverified="custom-implementation illustration — user-domain composite provider with primary/fallback strategy; not covered by any coverage-map test"}
public class CompositeIdProvider : IWhizbangIdProvider {
    private readonly IWhizbangIdProvider _primary;
    private readonly IWhizbangIdProvider _fallback;

    public TrackedGuid NewGuid() {
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

```csharp{title="Logging Wrapper" description="Logging Wrapper" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Logging", "Wrapper"] unverified="custom-implementation illustration — user-domain logging decorator over a typed IWhizbangIdProvider; not covered by any coverage-map test"}
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
```csharp{title="IWhizbangIdProvider&lt;TId&gt;" description="IWhizbangIdProvider&lt;TId&gt;" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "IWhizbangIdProvider&lt;TId&gt;"] tests=["WhizbangIdServiceCollectionExtensionsTests.TypedProvider_InjectedInService_CreatesValidIdsAsync"]}
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
```csharp{title="AddWhizbangIdProviders Extension" description="AddWhizbangIdProviders Extension" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "AddWhizbangIdProviders", "Extension"] tests=["WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_RegistersBaseProviderAsync", "WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_WithCustomProvider_UsesCustomProviderAsync"]}
public static IServiceCollection AddWhizbangIdProviders(
    this IServiceCollection services,
    IWhizbangIdProvider? baseProvider = null
)
```

**Parameters**:
- `baseProvider` - Custom base provider (default: `new Uuid7IdProvider()`)

**Returns**: `IServiceCollection` for chaining

**Example**:
```csharp{title="AddWhizbangIdProviders Extension (2)" description="AddWhizbangIdProviders Extension" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "AddWhizbangIdProviders", "Extension"] tests=["WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_RegistersAllProvidersAsync", "WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_WithCustomProvider_UsesCustomProviderAsync"]}
builder.Services.AddWhizbangIdProviders(); // Uses Uuid7IdProvider
// OR
builder.Services.AddWhizbangIdProviders(new CustomIdProvider());
```

## Testing Patterns

### Test with Sequential IDs

```csharp{title="Test with Sequential IDs" description="Test with Sequential IDs" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Test", "Sequential"] tests=["WhizbangIdServiceCollectionExtensionsTests.AddWhizbangIdProviders_WithCustomProvider_UsesCustomProviderAsync"]}
public class SequentialTestIdProvider : IWhizbangIdProvider {
    private long _counter = 0;

    public TrackedGuid NewGuid() {
        var value = Interlocked.Increment(ref _counter);
        // v7 version/variant nibbles — generated WhizbangId types reject non-v7 GUIDs
        return TrackedGuid.FromExternal(new Guid($"00000000-0000-7000-8000-{value:D12}"));
    }
}

// In tests — pass the instance as the base provider
var services = new ServiceCollection();
services.AddWhizbangIdProviders(new SequentialTestIdProvider());
```

### Test with Known IDs

```csharp{title="Test with Known IDs" description="Test with Known IDs" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Test", "Known"] unverified="test-helper illustration — user-domain KnownIdProvider queue that dequeues preset IDs; not itself a coverage-map test"}
public class KnownIdProvider<TId> : IWhizbangIdProvider<TId>
    where TId : struct {

    private readonly Queue<TId> _ids;

    public KnownIdProvider(params TId[] ids) {
        _ids = new Queue<TId>(ids);
    }

    public TId NewId() => _ids.Dequeue();
}

// In tests — the known Guid must be v7-form (From validates UUIDv7)
var knownOrderId = OrderId.From(new Guid("00000000-0000-7000-8000-111111111111"));
var provider = new KnownIdProvider<OrderId>(knownOrderId);

var order = new Order { Id = provider.NewId() };
Assert.Equal(knownOrderId, order.Id);
```

### Test Direct Provider Creation

```csharp{title="Test Direct Provider Creation" description="Test Direct Provider Creation" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Test", "Direct"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync", "IWhizbangIdProviderGenericTests.NewId_GeneratesUniqueIdsAsync"]}
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

```bash{title="Automated Migration with `whizbang-migrate`" description="Whizbang provides automated code transformation for migrating from raw Guid usage:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Automated", "Migration"]}
# Analyze a project for migration scope (Marten/Wolverine → Whizbang)
whizbang-migrate analyze --project ./src/MyApp.csproj

# Preview transformations without modifying files
whizbang-migrate apply --project ./src/MyApp.csproj --dry-run

# Apply the transformations (Guid → TrackedGuid included)
whizbang-migrate apply --project ./src/MyApp.csproj
```

The CLI exposes `analyze`, `plan`, `apply`, `rollback`, and `status` commands (transformers are not selected individually via flags — they run as part of the `apply` pipeline). The `GuidToTrackedGuidTransformer` automatically:
- Converts `Guid.NewGuid()` → `TrackedGuid.New()`
- Converts `Guid.CreateVersion7()` → `TrackedGuid.New()`
- Converts Marten's `CombGuidIdGeneration.NewGuid()` → `TrackedGuid.New()`
- Adds `using Whizbang.Core.ValueObjects;` directive
- Emits warnings for default-StreamId check patterns and collision-retry patterns that need manual review

A companion `GuidToIdProviderTransformer` rewrites raw Guid generation to the `IWhizbangIdProvider` pattern for DI scenarios.

### Migrating from Guid to WhizbangId

**Before**:
```csharp{title="Migrating from Guid to WhizbangId" description="Migrating from Guid to WhizbangId" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Migrating", "Guid"] unverified="before/counter-example — raw Guid.NewGuid(), the anti-pattern being migrated away from"}
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
```csharp{title="Migrating from Guid to WhizbangId - OrderId" description="Migrating from Guid to WhizbangId - OrderId" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Migrating", "Guid"] tests=["WhizbangIdGeneratorTests.Generator_WithExplicitTypeDeclaration_GeneratesValueObjectAsync", "WhizbangIdServiceCollectionExtensionsTests.TypedProvider_InjectedInService_CreatesValidIdsAsync"]}
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
```csharp{title="Migrating from IWhizbangIdProvider to" description="Migrating from IWhizbangIdProvider to" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Migrating", "IWhizbangIdProvider"] unverified="before — non-generic IWhizbangIdProvider.NewGuid() pattern being migrated away from"}
public class Repository<TEntity> {
    private readonly IWhizbangIdProvider _idProvider;

    public Repository(IWhizbangIdProvider idProvider) {
        _idProvider = idProvider;
    }

    public TEntity Create(TEntity entity) {
        entity.Id = _idProvider.NewGuid(); // ❌ Returns TrackedGuid, needs manual wrapping
        return entity;
    }
}
```

**After**:
```csharp{title="Migrating from IWhizbangIdProvider to" description="Migrating from IWhizbangIdProvider to" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Migrating", "IWhizbangIdProvider"] tests=["IWhizbangIdProviderGenericTests.NewId_WithUuid7Provider_ReturnsValidIdAsync"]}
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
3. **Configure providers early** - Call `AddWhizbangIdProviders()` (and `WhizbangIdProvider.SetProvider()` if you use the static API) in `Program.cs` before any IDs are created
4. **Use auto-registration** - Let ModuleInitializer handle registration automatically
5. **Override specific types when needed** - Register custom implementations after `AddWhizbangIdProviders()`
6. **Test with sequential IDs** - Makes tests predictable and debuggable
7. **Document custom providers** - Explain why/when custom generation is needed

## See Also

- [Message Context](../messages/message-context.md) - How IDs flow through message processing
- [Observability](../persistence/observability.md) - Correlation and causation tracking
- [Testing Strategy](../../learn/tutorial/testing-strategy.md) - Testing with WhizbangIds
