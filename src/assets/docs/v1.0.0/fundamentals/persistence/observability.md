---
title: Observability & Message Hops
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 6
description: >-
  Whizbang's hop-based observability - MessageEnvelope and MessageHop carry a
  complete journey (routing, scope, policy decisions, caller info) through every
  service. Query it with ITraceStore for time-travel debugging of distributed flows.
tags: 'observability, message-hops, distributed-tracing, time-travel, debugging, trace-store, causation, correlation'
codeReferences:
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Core/Observability/ServiceInstanceInfo.cs
  - src/Whizbang.Core/Observability/ITraceStore.cs
  - src/Whizbang.Core/Observability/InMemoryTraceStore.cs
  - src/Whizbang.Core/Policies/PolicyDecisionTrail.cs
  - src/Whizbang.Core/Policies/PolicyConfiguration.cs
testReferences:
  - tests/Whizbang.Observability.Tests/MessageTracingTests.cs
  - tests/Whizbang.Observability.Tests/MessageHopTests.cs
  - tests/Whizbang.Observability.Tests/TraceStore/TraceStoreContractTests.cs
  - tests/Whizbang.Observability.Tests/TraceStore/InMemoryTraceStoreTests.cs
  - tests/Whizbang.Observability.Tests/PolicyDecisionTrailTests.cs
---

# Observability & Message Hops

Whizbang implements **hop-based observability**, inspired by network packet routing. Every message travels the system inside a **`MessageEnvelope`** whose **`Hops`** list accumulates a complete snapshot of context at each stage of processing — routing, scope, policy decisions, caller location, and timing.

Traditional debugging shows you **where you are now**. Hop chains show you **how you got here**: the full journey of a message across receptors and services, so you can answer "what happened" and "why" for a distributed flow.

## Core concept: the network packet analogy

Just as IP packets accumulate hops as they cross routers, Whizbang messages accumulate context hops as they cross receptors and services:

```mermaid{caption="Network-packet analogy — just as an IP packet accumulates hops as it crosses routers, a Whizbang message envelope accumulates context hops (routing, scope, policy, caller info) as it crosses receptors and services."}
flowchart LR
    subgraph Packet["Network Packet"]
        direction TB
        IPHeader["IP Header<br/>• Source IP<br/>• Dest IP<br/>• Hop Count: 3"]
        PacketPayload["Payload"]
        IPHeader --- PacketPayload
    end

    subgraph Message["Whizbang Message"]
        direction TB
        Envelope["MessageEnvelope&lt;T&gt;<br/>• MessageId<br/>• Payload (your message)<br/>• Hops: [Hop1, Hop2, …]"]
        HopInfo["each hop carries<br/>routing + scope +<br/>policy + caller info"]
        Envelope --- HopInfo
    end
```

**Key insight**: Hops capture **where the message has been** and **what decisions were made** along the way. Correlation and causation are *derived from the hops* (the first hop establishes them) rather than being separate top-level fields.

---

## MessageEnvelope

`MessageEnvelope<TMessage>` (implements `IMessageEnvelope<TMessage>`) wraps every message:

```csharp{title="MessageEnvelope structure" description="The envelope Whizbang wraps every message in: message id, payload, the additive hop list, dispatch context, and a schema version." category="Observability" difficulty="INTERMEDIATE" tags=["message-envelope","hops","dispatch-context","payload"] tests=["MessageTracingTests.MessageEnvelope_Constructor_SetsAllPropertiesAsync", "MessageTracingTests.MessageEnvelope_RequiresAtLeastOneHopAsync", "MessageTracingTests.MessageEnvelope_AddHop_AddsHopToListAsync"]}
public class MessageEnvelope<TMessage> : IMessageEnvelope<TMessage> {
    public required MessageId MessageId { get; init; }             // unique id for this message
    public required TMessage Payload { get; set; }                 // your command / event / query
    public required List<MessageHop> Hops { get; init; }           // the journey (>= 1 hop)
    public required MessageDispatchContext DispatchContext { get; init; } // dispatch mode + source
    public int Version { get; init; } = 1;                         // envelope schema version
}
```

Notes:

- **At least one hop is required** — the originating hop. `Hops` is additive-only.
- There is **no top-level `CorrelationId`, `CausationId`, or `CreatedAt` property**. Those are read from the first hop via helper methods (below). Causation is simply the `MessageId` of the parent/causing message — there is no separate `CausationId` type.
- The envelope also carries commit-sequence and per-receptor bookkeeping used by the work coordinator and exactly-once machinery; those fields are internal to the runtime and not part of the observability surface.

### Envelope helper methods

The envelope exposes read helpers that walk the hop list for you. Each filters to `HopType.Current` hops (ignoring inherited causation hops) unless noted:

| Method | Returns | Behavior |
|--------|---------|----------|
| `GetCurrentTopic()` | `string?` | Most-recent current hop with a non-empty topic |
| `GetCurrentStreamId()` | `string?` | Most-recent current hop with a non-empty stream id |
| `GetCurrentPartitionIndex()` | `int?` | Most-recent current hop's partition index |
| `GetCurrentSequenceNumber()` | `long?` | Most-recent current hop's sequence number |
| `GetCurrentScope()` | `ScopeContext?` | Merges each current hop's scope delta into the effective scope |
| `GetMessageTimestamp()` | `DateTimeOffset` | Timestamp of the first hop |
| `GetCorrelationId()` | `CorrelationId?` | Correlation id from the first hop |
| `GetCausationId()` | `MessageId?` | Causation id from the first hop |
| `GetMetadata(string key)` | `JsonElement?` | Latest value for a key across current hops |
| `GetAllMetadata()` | `IReadOnlyDictionary<string, JsonElement>` | All metadata stitched (later hops win) |
| `GetAllPolicyDecisions()` | `IReadOnlyList<PolicyDecision>` | Every policy decision, chronological |
| `GetCurrentHops()` | `IReadOnlyList<MessageHop>` | Only `Current` hops |
| `GetCausationHops()` | `IReadOnlyList<MessageHop>` | Only `Causation` hops |
| `AddHop(MessageHop hop)` | `void` | Appends a hop (the runtime calls this) |

> `GetCurrentSecurityContext()` still exists but is **`[Obsolete]`** — it returns a legacy `SecurityContext` projection of the current scope. Use `GetCurrentScope()` for the current scope model. See [Scope propagation](../security/scope-propagation.md).

---

## MessageHop

Each hop is an immutable `record` — a complete snapshot of message state at one point in the journey:

```csharp{title="MessageHop record and HopType enum" description="An immutable snapshot of message state at one hop: service instance, routing, scope delta, policy trail, caller info, timing, and a W3C traceparent." category="Observability" difficulty="INTERMEDIATE" tags=["message-hop","hop-type","causation","traceparent"] tests=["MessageTracingTests.MessageHop_Constructor_SetsAllPropertiesAsync", "MessageTracingTests.MessageHop_Type_DefaultsToCurrentAsync", "MessageTracingTests.MessageHop_Type_CanBeSetToCausationAsync", "MessageHopTests.MessageHop_WithAllProperties_StoresAllValuesAsync"]}
public record MessageHop {
    // Hop type
    public HopType Type { get; init; } = HopType.Current;    // Current or Causation

    // Service/instance identity (produced by the framework's IServiceInstanceProvider)
    public required ServiceInstanceInfo ServiceInstance { get; init; }
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;

    // Routing
    public string Topic { get; init; } = string.Empty;
    public string StreamId { get; init; } = string.Empty;
    public int? PartitionIndex { get; init; }
    public long? SequenceNumber { get; init; }
    public string ExecutionStrategy { get; init; } = string.Empty;

    // Scope (delta storage — only what changed vs. the previous hop)
    public ScopeDelta? Scope { get; init; }

    // Policy decisions made at this hop
    public PolicyDecisionTrail? Trail { get; init; }

    // Arbitrary metadata (JSON values; later hops override earlier for the same key)
    public IReadOnlyDictionary<string, JsonElement>? Metadata { get; init; }

    // Causation (populated on Causation hops)
    public MessageId? CausationId { get; init; }
    public CorrelationId? CorrelationId { get; init; }
    public string? CausationType { get; init; }

    // Caller info (jump-to-source in tooling)
    public string? CallerMemberName { get; init; }
    public string? CallerFilePath { get; init; }
    public int? CallerLineNumber { get; init; }

    // Timing + distributed tracing
    public TimeSpan Duration { get; init; }
    public string? TraceParent { get; init; }   // W3C traceparent for OpenTelemetry correlation
}

public enum HopType {
    Current   = 0,   // processing of THIS message
    Causation = 1    // carried forward from the parent/causing message
}
```

`ServiceInstanceInfo` identifies the exact instance that processed the hop:

```csharp{title="ServiceInstanceInfo identity record" description="Identifies the exact service instance that processed a hop — name, UUIDv7 instance id, host, and process id — with an Unknown sentinel when no provider is configured." category="Observability" difficulty="BEGINNER" tags=["service-instance","instance-id","host-name","process-id"] unverified="supporting identity record — its provider population and Unknown sentinel are verified by ServiceInstanceProviderTests and the SystemEventEmitter Unknown-sentinel test, not by these hop/trace tests"}
public record ServiceInstanceInfo {
    public required string ServiceName { get; init; }   // e.g. "OrderService"
    public required Guid   InstanceId  { get; init; }   // UUIDv7 per running instance
    public required string HostName    { get; init; }
    public required int    ProcessId   { get; init; }
    // ServiceInstanceInfo.Unknown is the sentinel when no provider is configured.
}
```

### Current vs. causation hops

When a message spawns a child message, the parent's **`Current` hops are carried forward as the child's `Causation` hops**. The child always has at least one `Current` hop (its own origin). This preserves the complete causal chain: from any message you can see the hops of everything that led to it.

```mermaid{caption="Current vs. causation hops — when a command spawns a child event, the parent's Current hops are carried forward as the child's Causation hops while the child adds its own Current hop; GetCurrentHops and GetCausationHops split the two." tests=["MessageTracingTests.MessageEnvelope_GetCurrentHops_ReturnsOnlyCurrentHopsAsync", "MessageTracingTests.MessageEnvelope_GetCausationHops_ReturnsOnlyCausationHopsAsync", "MessageTracingTests.MessageHop_Type_CanBeSetToCausationAsync"]}
flowchart LR
    Cmd["CreateOrder command<br/>Hops:<br/>[Current] gateway<br/>[Current] orders"]
    Evt["OrderCreated event<br/>Hops:<br/>[Causation] gateway ← inherited<br/>[Causation] orders ← inherited<br/>[Current] orders (evt) ← this message"]

    Cmd --> Evt
```

Use `envelope.GetCurrentHops()` and `envelope.GetCausationHops()` to split them.

---

## Scope

`MessageHop.Scope` uses **delta storage**: a hop records only what changed from the previous hop (a `ScopeDelta`), not the full context. Reassemble the effective scope with `envelope.GetCurrentScope()`, which folds the deltas across all current hops into a `ScopeContext` (tenant/user, roles, permissions, claims, principals).

```csharp{title="Read effective scope from an envelope" description="GetCurrentScope folds each current hop's ScopeDelta into a ScopeContext; ScopeContext.Scope exposes the string tenant and user." category="Observability" difficulty="INTERMEDIATE" tags=["scope","tenant","user","scope-delta"] tests=["MessageTracingTests.MessageEnvelope_GetCurrentSecurityContext_ReturnsMostRecentNonNullValueAsync", "MessageTracingTests.MessageEnvelope_GetCurrentSecurityContext_ReturnsNull_WhenNoHopsAsync", "MessageHopTests.MessageHop_WithSecurityContext_SetsSecurityContextAsync"]}
var scope  = envelope.GetCurrentScope();
var tenant = scope?.Scope.TenantId;   // string?
var user   = scope?.Scope.UserId;     // string?
```

The full mechanics — how deltas are captured, merged, and enforced across service boundaries — live in [Scope propagation](../security/scope-propagation.md) and [Security context propagation](../security/security-context-propagation.md).

---

## Policy decision trail

Policy decisions made at a hop are recorded in `MessageHop.Trail`. `envelope.GetAllPolicyDecisions()` stitches every current hop's decisions together in chronological order.

```csharp{title="PolicyDecisionTrail and PolicyDecision" description="RecordDecision appends a routing decision to a hop's trail; each PolicyDecision captures the policy, rule, match result, configuration, reason, and timestamp." category="Observability" difficulty="INTERMEDIATE" tags=["policy-decision","decision-trail","routing","audit"] tests=["PolicyDecisionTrailTests.RecordDecision_AddsDecisionWithAllPropertiesAsync", "PolicyDecisionTrailTests.GetMatchedRules_ReturnsOnlyMatchedDecisionsAsync", "PolicyDecisionTrailTests.GetUnmatchedRules_ReturnsOnlyUnmatchedDecisionsAsync", "PolicyDecisionTrailTests.Decisions_IsInitializedEmptyByDefaultAsync"]}
public class PolicyDecisionTrail {
    public List<PolicyDecision> Decisions { get; init; } = [];

    public void RecordDecision(string policyName, string rule, bool matched,
                               object? configuration, string reason);

    public IEnumerable<PolicyDecision> GetMatchedRules();
    public IEnumerable<PolicyDecision> GetUnmatchedRules();
}

public record PolicyDecision {
    public required string          PolicyName    { get; init; }  // e.g. "StreamSelection"
    public required string          Rule          { get; init; }  // e.g. "Order.* → order-{id}"
    public required bool            Matched       { get; init; }  // did this rule match?
    public          object?         Configuration { get; init; }  // usually a PolicyConfiguration
    public required string          Reason        { get; init; }  // human-readable
    public required DateTimeOffset  Timestamp     { get; init; }
}
```

When a rule matches, `Configuration` is typically a `PolicyConfiguration` exposing the resolved routing/execution settings: `Topic`, `StreamId`, `ExecutionStrategyType`, `PartitionRouterType`, `SequenceProviderType`, `PartitionCount`, `MaxConcurrency`.

See [Policy engine](../../operations/infrastructure/policies.md) for how policies are authored and evaluated.

---

## Metadata stitching

Metadata accumulates hop-to-hop. Each hop may **inherit** prior keys, **overwrite** a key, or **add** new ones. `GetAllMetadata()` returns the stitched result (later current hops win); `GetMetadata(key)` returns the latest value for a single key. Values are `JsonElement`, so any JSON shape is allowed.

```csharp{title="Read stitched hop metadata" description="GetAllMetadata and GetMetadata return JsonElement values stitched across current hops, later hops winning; check ValueKind before extracting." category="Observability" difficulty="INTERMEDIATE" tags=["metadata","json-element","stitching","enrichment"] tests=["MessageTracingTests.MessageEnvelope_GetAllMetadata_StitchesAllMetadataAsync", "MessageTracingTests.MessageEnvelope_GetMetadata_ReturnsLatestValue_WhenKeyExistsInMultipleHopsAsync", "MessageTracingTests.MessageEnvelope_GetMetadata_ReturnsNull_WhenKeyNotFoundAsync"]}
var all      = envelope.GetAllMetadata();          // IReadOnlyDictionary<string, JsonElement>
var priority = envelope.GetMetadata("priority");
if (priority is { } p && p.ValueKind == JsonValueKind.String) {
    Console.WriteLine(p.GetString());
}
```

---

## Caller information & timing

Every hop can capture the source location that created it (`CallerMemberName`, `CallerFilePath`, `CallerLineNumber`) and how long it took (`Timestamp`, `Duration`). This turns "where did this originate?" into a file/line answer instead of a distributed stack-trace hunt.

```csharp{title="Find the slowest hops with caller locations" description="Order current hops by Duration and print each hop's service, elapsed time, and captured file and line." category="Observability" difficulty="INTERMEDIATE" tags=["caller-info","duration","timing","profiling"] tests=["MessageTracingTests.MessageEnvelope_GetCurrentHops_ReturnsOnlyCurrentHopsAsync", "MessageTracingTests.RecordHop_CapturesCallerFilePath_AutomaticallyAsync", "MessageTracingTests.RecordHop_CapturesCallerLineNumber_AutomaticallyAsync", "MessageTracingTests.RecordHop_WithDuration_SetsDurationFieldAsync"]}
var slowest = envelope.GetCurrentHops()
    .OrderByDescending(h => h.Duration)
    .Take(5);

foreach (var hop in slowest) {
    Console.WriteLine($"{hop.ServiceInstance.ServiceName}: {hop.Duration.TotalMilliseconds:F1}ms");
    Console.WriteLine($"  at {hop.CallerFilePath}:{hop.CallerLineNumber}");
}
```

`TraceParent` carries the W3C `traceparent` value captured from `Activity.Current`, so hop data correlates with OpenTelemetry spans. See [OpenTelemetry integration](../../operations/observability/opentelemetry-integration.md).

---

## Querying traces: `ITraceStore`

Envelopes are captured into an `ITraceStore` so you can query the message history after the fact. The dispatcher **automatically stores each envelope** as it dispatches — you don't call `StoreAsync` yourself in application code; you query.

```csharp{title="ITraceStore query surface" description="The store the dispatcher writes envelopes to: fetch by message id, by correlation id, by causal chain, or by time range." category="Observability" difficulty="INTERMEDIATE" tags=["trace-store","query","correlation","causal-chain"] tests=["TraceStoreContractTests.TraceStore_StoreAndRetrieve_ShouldStoreAndRetrieveEnvelopeAsync", "TraceStoreContractTests.TraceStore_GetByMessageId_ShouldReturnNullForNonExistentTraceAsync", "TraceStoreContractTests.TraceStore_GetByCorrelation_ShouldReturnAllMessagesWithSameCorrelationIdAsync", "TraceStoreContractTests.TraceStore_GetCausalChain_ShouldReturnMessageAndParentsAsync", "TraceStoreContractTests.TraceStore_GetByTimeRange_ShouldReturnMessagesInRangeAsync"]}
public interface ITraceStore {
    Task StoreAsync(IMessageEnvelope envelope, CancellationToken ct = default);

    Task<IMessageEnvelope?>       GetByMessageIdAsync(MessageId messageId, CancellationToken ct = default);
    Task<List<IMessageEnvelope>>  GetByCorrelationAsync(CorrelationId correlationId, CancellationToken ct = default);
    Task<List<IMessageEnvelope>>  GetCausalChainAsync(MessageId messageId, CancellationToken ct = default);
    Task<List<IMessageEnvelope>>  GetByTimeRangeAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct = default);
}
```

Behavior guarantees (verified by the contract tests):

- **`GetByMessageIdAsync`** returns the envelope for a known id, or `null` when the id is unknown.
- **`GetByCorrelationAsync`** returns every envelope sharing a correlation id, ordered chronologically by the message's first-hop timestamp.
- **`GetCausalChainAsync`** returns the message *plus all ancestors* (walked via causation id) *and all descendants* (children, multi-generation), ordered chronologically, and is **protected against circular references**. It returns an empty list when the message id is unknown.
- **`GetByTimeRangeAsync`** filters and orders by the message's first `Current` hop timestamp.

### Registration & the in-memory store

`AddWhizbang(...)` registers `ITraceStore` as a singleton **`InMemoryTraceStore`** by default. That implementation is thread-safe (backed by a `ConcurrentDictionary` keyed by `MessageId`) and is intended for **testing and development — it is not durable and is bounded by memory**. A couple of concrete behaviors worth knowing:

- `StoreAsync` throws `ArgumentNullException` on a null envelope and **de-dupes on `MessageId`** — the first write for a given id wins (`ConcurrentDictionary.TryAdd`).
- Queries degrade gracefully: an unknown id yields `null`/empty, and an envelope with no `Current` hop sorts as `DateTimeOffset.MinValue` rather than throwing.

For production, register a persistent `ITraceStore` implementation.

---

## Time-travel debugging scenarios

All examples resolve `ITraceStore` from DI.

### "Why did this message route to the wrong topic?"

Inspect the policy decision trail.

```csharp{title="Debug a routing decision from the policy trail" description="Fetch the envelope by id and print each policy decision, showing the resolved PolicyConfiguration when a rule matched." category="Observability" difficulty="INTERMEDIATE" tags=["policy-trail","routing","debugging","trace-store"] tests=["MessageTracingTests.MessageEnvelope_GetAllPolicyDecisions_ReturnsSingleHopDecisionsAsync", "MessageTracingTests.MessageEnvelope_GetAllPolicyDecisions_StitchesDecisionsAcrossMultipleHopsAsync", "TraceStoreContractTests.TraceStore_StoreAndRetrieve_ShouldStoreAndRetrieveEnvelopeAsync"]}
var envelope = await traceStore.GetByMessageIdAsync(messageId);

foreach (var d in envelope!.GetAllPolicyDecisions()) {
    Console.WriteLine($"{d.PolicyName}: rule={d.Rule} matched={d.Matched}");
    if (d.Matched && d.Configuration is PolicyConfiguration cfg) {
        Console.WriteLine($"  → topic={cfg.Topic} stream={cfg.StreamId} " +
                          $"exec={cfg.ExecutionStrategyType?.Name} partitions={cfg.PartitionCount}");
    } else {
        Console.WriteLine($"  → {d.Reason}");
    }
}
```

### "What caused this error?"

Walk the causal chain to find where the failing message came from.

```csharp{title="Walk the causal chain to an error's origin" description="GetCausalChainAsync returns the failing message plus ancestors and descendants in chronological order; print each message's service and caller location." category="Observability" difficulty="INTERMEDIATE" tags=["causal-chain","causation","debugging","caller-info"] tests=["InMemoryTraceStoreTests.GetCausalChainAsync_WithChildren_IncludesChildMessagesAsync", "InMemoryTraceStoreTests.GetCausalChainAsync_WithMultiGenerationChildren_IncludesAllDescendantsAsync", "InMemoryTraceStoreTests.GetCausalChainAsync_SortsResultsByTimestampAsync", "TraceStoreContractTests.TraceStore_GetCausalChain_ShouldReturnMessageAndParentsAsync"]}
var chain = await traceStore.GetCausalChainAsync(failedMessageId);

foreach (var msg in chain) {   // already chronological
    var hop = msg.GetCurrentHops().LastOrDefault();
    Console.WriteLine($"{msg.GetMessageTimestamp():HH:mm:ss.fff}  {msg.Payload.GetType().Name}");
    Console.WriteLine($"  service: {hop?.ServiceInstance.ServiceName}");
    Console.WriteLine($"  caller : {hop?.CallerFilePath}:{hop?.CallerLineNumber}");
}
```

### "How did tenant/user context change?"

Merge scope across the current hops and watch for a drop.

```csharp{title="Inspect tenant and user context on a message" description="Read the merged scope from an envelope to see the effective user and tenant, defaulting to NOT SET when unset." category="Observability" difficulty="INTERMEDIATE" tags=["scope","tenant","user","debugging"] tests=["MessageTracingTests.MessageEnvelope_GetCurrentSecurityContext_ReturnsMostRecentNonNullValueAsync", "MessageTracingTests.MessageEnvelope_GetCurrentSecurityContext_IgnoresCausationHopsAsync", "MessageHopTests.MessageHop_WithSecurityContext_SetsSecurityContextAsync"]}
var envelope = await traceStore.GetByMessageIdAsync(messageId);
var scope = envelope!.GetCurrentScope();
Console.WriteLine($"UserId={scope?.Scope.UserId ?? "NOT SET"} TenantId={scope?.Scope.TenantId ?? "NOT SET"}");
```

To see the progression hop-by-hop, iterate `envelope.GetCurrentHops()` and inspect each `hop.Scope` delta together with `hop.ServiceInstance.ServiceName` and `hop.CallerFilePath`/`CallerLineNumber`.

### "Show me every message in this workflow."

All messages in one workflow share a correlation id.

```csharp{title="List every message in a workflow by correlation id" description="GetByCorrelationAsync returns all envelopes sharing a correlation id, chronological, with service, topic, and stream per message." category="Observability" difficulty="INTERMEDIATE" tags=["correlation","workflow","trace-store","timeline"] tests=["TraceStoreContractTests.TraceStore_GetByCorrelation_ShouldReturnAllMessagesWithSameCorrelationIdAsync", "TraceStoreContractTests.TraceStore_GetByCorrelation_ShouldReturnEmptyListWhenNoMatchesAsync", "InMemoryTraceStoreTests.GetByCorrelationAsync_WithNullCorrelationIdsInStore_FiltersThemOutAsync"]}
var workflow = await traceStore.GetByCorrelationAsync(correlationId);
foreach (var e in workflow) {
    var hop = e.GetCurrentHops().LastOrDefault();
    Console.WriteLine($"{e.GetMessageTimestamp():HH:mm:ss.fff}  {e.Payload.GetType().Name}  " +
                      $"{hop?.ServiceInstance.ServiceName} → {hop?.Topic} ({hop?.StreamId})");
}
```

### "What happened between 2:00 and 2:05 PM?"

```csharp{title="Query messages in a time window" description="GetByTimeRangeAsync filters and orders envelopes by their first current hop timestamp." category="Observability" difficulty="INTERMEDIATE" tags=["time-range","trace-store","timeline","debugging"] tests=["TraceStoreContractTests.TraceStore_GetByTimeRange_ShouldReturnMessagesInRangeAsync", "TraceStoreContractTests.TraceStore_GetByTimeRange_ShouldReturnMessagesInChronologicalOrderAsync", "InMemoryTraceStoreTests.GetByTimeRangeAsync_WithNoHops_UsesMinValueTimestampAsync"]}
var from = new DateTimeOffset(2025, 11, 2, 14, 0, 0, TimeSpan.Zero);
var to   = new DateTimeOffset(2025, 11, 2, 14, 5, 0, TimeSpan.Zero);

var messages = await traceStore.GetByTimeRangeAsync(from, to);
Console.WriteLine($"Found {messages.Count} messages");
foreach (var e in messages) {
    var hop = e.GetCurrentHops().LastOrDefault();
    Console.WriteLine($"{e.GetMessageTimestamp():HH:mm:ss.fff}  {e.Payload.GetType().Name}  " +
                      $"{hop?.ServiceInstance.ServiceName} → {hop?.Topic}");
}
```

---

## Best practices

- **Correlate everything.** Keep the same correlation id across a workflow so `GetByCorrelationAsync` returns the whole flow. Use `CorrelationId.New()` at the start of a new workflow; downstream messages inherit it through the hop chain.
- **Preserve causation.** Child messages should carry the parent's `MessageId` as their causation id so `GetCausalChainAsync` can walk parents and children.
- **Read scope via `GetCurrentScope()`**, not the obsolete `GetCurrentSecurityContext()`.
- **Treat metadata values as JSON.** `GetAllMetadata()`/`GetMetadata()` return `JsonElement`; check `ValueKind` before extracting.
- **Don't hand-store traces.** The dispatcher captures envelopes automatically as it dispatches; an application-level `Task.Run(StoreAsync)` is redundant and can double-write.

---

## Further reading

- [Message context](../messages/message-context.md) — MessageId, CorrelationId, causation
- [Message envelopes](../../messaging/message-envelopes.md) — envelope lifecycle and serialization
- [Scope propagation](../security/scope-propagation.md) — how scope deltas flow across services
- [Policy engine](../../operations/infrastructure/policies.md) — policy authoring and decision trails
- [OpenTelemetry integration](../../operations/observability/opentelemetry-integration.md) — correlating hops with spans
- [Distributed tracing](../../operations/observability/tracing.md) — end-to-end tracing operations
</content>
</invoke>
