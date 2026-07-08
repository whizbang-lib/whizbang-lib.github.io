---
title: Exactly-Once Receptor Firing
version: 1.0.0
category: Core Concepts
order: 11
description: >-
  The firing contract for Whizbang receptors — exactly once per receptor per
  message, unless explicitly declared idempotent — plus the guardrail that
  enforces it and the opt-out for legitimate multi-fire scenarios
tags: >-
  receptors, firing contract, idempotency, guardrail, dedup, ReceptorIdempotent,
  double fire, at-most-once
codeReferences:
  - src/Whizbang.Core/Messaging/ReceptorInvoker.cs
  - src/Whizbang.Core/Messaging/IReceptorDedupStore.cs
  - src/Whizbang.Core/Messaging/EnvelopeReceptorDedupStore.cs
  - src/Whizbang.Core/Messaging/ReceptorIdempotentAttribute.cs
  - src/Whizbang.Core/Messaging/LifecycleStageTracker.cs
  - src/Whizbang.Core/Observability/ReceptorInvocationRecord.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Configuration/WhizbangOptions.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/ReceptorInvokerExactlyOnceTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageTrackerTests.cs
  - samples/ECommerce/tests/ECommerce.Lifecycle.Integration.Tests/PostAllPerspectivesTests.cs
  - samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests/Lifecycle/PerspectiveLifecycleTests.cs
---

# Exactly-Once Receptor Firing

Whizbang's firing contract is straightforward: **a receptor fires exactly once in the lifetime of a message**, unless the receptor explicitly declares itself idempotent via `[ReceptorIdempotent]`. This page documents how that contract is tracked and enforced.

## The contract

A receptor registered at one or more lifecycle stages (explicit `[FireAt]` or the three default stages) is only expected to produce **one invocation per message**. The stage-level filters in [`ReceptorInvoker`](lifecycle-receptors) (`source-service` filtering at `PostInbox`, namespace routing at `PreOutbox`, the `LocalDispatch` flag) are designed so that exactly one of a receptor's registered stages fires per message lifetime — the other stages short-circuit.

If a receptor fires twice for the same message — whether at the same stage or across two different stages — that is a bug. The guardrail described below catches it.

### Exception: perspective-scoped stages fire once per perspective

Not every stage is per-message. The perspective-scoped stages (`PrePerspectiveInline`, `PrePerspectiveDetached`, `PostPerspectiveInline`, `PostPerspectiveDetached`, and `ImmediateDetached` when invoked under a perspective context) are fan-out points: an event processed by N perspectives produces N invocations at each of those stages — one per perspective. A receptor registered at `PostPerspectiveInline` that needs to observe per-perspective outcomes (test synchronization counters, per-perspective derived projections, metrics) is *expected* to fire N times per message, not once.

The guardrail recognizes these stages and does not raise a double-fire warning for them. Dedup key for perspective-scoped stages is effectively `(messageId, receptorId, perspectiveType)` rather than `(messageId, receptorId)`.

`PostAllPerspectivesInline` and `PostAllPerspectivesDetached` are **not** perspective-scoped — they are the "all done" WhenAll signal that fires exactly once per message after every perspective has completed. They remain governed by the standard per-receptor-per-message rule.

| Stage | Fires per message | Dedup key |
|---|---|---|
| `LocalImmediateInline`, `LocalImmediateDetached` | 1 | `(messageId, receptorId)` |
| `PreOutboxInline`, `PreOutboxDetached`, `PostOutboxInline`, `PostOutboxDetached` | 1 | `(messageId, receptorId)` |
| `PreInboxInline`, `PreInboxDetached`, `PostInboxInline`, `PostInboxDetached` | 1 | `(messageId, receptorId)` |
| `PreDistributeInline`, `DistributeInline`, `PostDistributeInline`, and their `Detached` siblings | 1 | `(messageId, receptorId)` |
| `PrePerspectiveInline`, `PrePerspectiveDetached` | **N** (one per perspective) | `(messageId, receptorId, perspectiveType)` |
| `PostPerspectiveInline`, `PostPerspectiveDetached` | **N** (one per perspective) | `(messageId, receptorId, perspectiveType)` |
| `ImmediateDetached` under a perspective context | **N** (one per perspective) | `(messageId, receptorId, perspectiveType)` |
| `PostAllPerspectivesInline`, `PostAllPerspectivesDetached` | 1 (WhenAll gate) | `(messageId, receptorId)` |
| `PostLifecycleInline`, `PostLifecycleDetached` | 1 | `(messageId, receptorId)` |

## The guardrail

Every successful receptor invocation is recorded on the envelope itself via a `List<ReceptorInvocationRecord>` in `MessageEnvelope.ReceptorInvocations`. Before any receptor fires, the invoker consults an `IReceptorDedupStore` for a prior invocation of this receptor against this message; if one exists and the receptor is not declared idempotent, the second attempt is skipped (or thrown, depending on configuration).

The check is **per-receptor, not per-stage**. That's intentional: a filter bug that allowed the same receptor to fire at both `LocalImmediateInline` *and* `PreOutboxInline` for one message would slip past a per-stage guard. Per-receptor catches it.

The check is **skipped** for perspective-scoped stages (listed above) so that N-per-perspective fan-out doesn't trip the guardrail. The framework's lifecycle stage tracker (`LifecycleStageTracker`) also scopes its cross-worker dedup by `perspectiveType` when called from one of those stages.

## Opting out: `[ReceptorIdempotent]`

Some receptors are legitimately safe to re-invoke — dependent read-model updaters, derived-perspective maintainers, and anything idempotent by design. Decorate with `[ReceptorIdempotent]` to bypass the guardrail:

```csharp{title="Idempotent Receptor" description="Opt out of the exactly-once guardrail when the receptor is safe to re-fire" category="Architecture" difficulty="INTERMEDIATE" tags=["Receptors", "Idempotency"]}
[ReceptorIdempotent]
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class DependentReadModelUpdater : IReceptor<OrderCreatedEvent> {
  public ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
    // Safe to replay / re-fire — updates a dependent read model deterministically.
    return ValueTask.CompletedTask;
  }
}
```

`[ReceptorIdempotent]` also controls replay/rebuild behavior via its `AlwaysFire` property — see the [Replay Safety](lifecycle-receptors#replay-safety) section of the lifecycle-receptors page. The double-fire guardrail treats any `[ReceptorIdempotent]` declaration as an opt-out, regardless of `AlwaysFire`.

## Configuration

```json{title="Guardrail Configuration" description="Tune the exactly-once guardrail via WhizbangOptions" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Guardrails"]}
{
  "Whizbang": {
    "Guardrails": {
      "ReceptorInvocationTracking": "TrackAndEnforce",
      "OnDoubleFire": "Warn",
      "PersistInvocations": "Envelope"
    }
  }
}
```

| Setting | Options | Default | Notes |
|---|---|---|---|
| `ReceptorInvocationTracking` | `Off`, `Track`, `TrackAndEnforce` | `TrackAndEnforce` | `Track` records without skipping — useful during rollout to gather observability data before flipping enforcement on. `Off` disables both reads and writes. |
| `OnDoubleFire` | `Warn`, `Throw` | `Warn` | On `Warn` a `Warning` log is emitted (EventId 18) and the duplicate attempt is skipped. On `Throw` a `DuplicateReceptorFireException` is raised from `ReceptorInvoker.InvokeAsync`. Canary / pre-prod environments may prefer `Throw`. |
| `PersistInvocations` | `Envelope`, `Database` | `Envelope` | Only `Envelope` is implemented today. `Database` is reserved for a future DB-backed `IReceptorDedupStore` — the enum value exists so future wire-up is a DI swap, not an API change. |

## How records flow

`ReceptorInvocationRecord` is attached to `MessageEnvelope.ReceptorInvocations`, parallel to `Hops`. Like hops, records ride along with the message through every serialization boundary — outbox → transport → inbox → next dispatch. The record itself carries `ReceptorId`, `Stage`, `CompletedAt`, `Duration`, and `ServiceName`.

**Important invariant**: `ReceptorInvocations` is **not consulted** by security, scope, source-service, or trace-context extraction. Those all walk `Hops` only. The two lists are intentionally parallel so the guardrail cannot accidentally leak into security-critical paths.

## Recovery boundary

Records become durable when the envelope next hits a durable write (outbox row, inbox row, event-store append). A record written in-memory during a purely-local flow that crashes before the first durable write is lost — an explicit tradeoff of the "no hot-path DB writes" design. For flows that cross the outbox / transport / inbox, the record is preserved across process restarts.

## Pluggable store: `IReceptorDedupStore`

The default implementation is `EnvelopeReceptorDedupStore` (registered via `TryAddSingleton` in `AddWhizbangReceptorRegistry`). A consumer can replace it with a custom implementation — e.g., a database-backed store that writes to a `wh_receptor_invocations(message_id, receptor_id)` composite-PK table for stronger cross-process guarantees. Register a replacement before calling `AddWhizbang()` and the default registration is skipped.

```csharp{title="Custom IReceptorDedupStore" description="Replace the default envelope-backed dedup store" category="Architecture" difficulty="ADVANCED" tags=["Receptors", "Guardrails", "DI"]}
services.AddSingleton<IReceptorDedupStore, MyDatabaseReceptorDedupStore>();
services.AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres();
```

## Observability

- **EventId 16** `ReceptorFiring` (Debug) — immediately before dispatch.
- **EventId 17** `ReceptorFired` (Debug) — in `finally`, so exceptions are still reported.
- **EventId 18** `ReceptorAlreadyFiredSkip` (Warning) — emitted only when the guardrail catches a duplicate. In a healthy system you should see zero of these; any occurrence is worth investigating.

See [Logging Categories → Receptor Firing Diagnostics](../../operations/observability/logging-categories#receptor-firing-diagnostics) for filter patterns.
