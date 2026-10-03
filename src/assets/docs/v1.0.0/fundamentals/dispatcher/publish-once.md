---
title: PublishOnceAsync — Exactly-Once Event Emission
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 4
description: >-
  Publish an event at most once per claim key under concurrent emitters.
  Replaces fragile read-then-check guards with an atomic claim primitive
  backed by a single Postgres INSERT.
tags: 'dispatcher, events, idempotency, exactly-once, sagas, race-conditions'
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatch/IClaimedEmissionStore.cs
  - src/Whizbang.Data.EFCore.Postgres/Dispatch/EFCoreClaimedEmissionStore.cs
  - src/Whizbang.Data.Postgres/Migrations/060_CreateUniqueEmissionClaims.sql
  - src/Whizbang.Core/Workers/ClaimedEmissionPruneStep.cs
  - src/Whizbang.Core/Dispatch/RetainedClaimKeyPrefix.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/ClaimedEmissionPruneStepTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherPublishOnceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Dispatch/ClaimedEmissionStoreTests.cs
  - tests/Whizbang.Sagas.Tests/BaseSagaServiceTests.cs
  - tests/Whizbang.Sagas.Tests/DispatcherSagaEventEmitterTests.cs
---

# PublishOnceAsync — Exactly-Once Event Emission

## When you need it

You have a logical event that should be emitted **exactly once**, but two or more concurrent callers might attempt to emit it.

The motivating case: a saga that fans out to N per-item handlers, where the last item to finish emits a `SagaCompletedEvent`. When items 342, 343, 344, and 348 all complete within the same millisecond, four handlers all observe `CompletedItems == TotalItems`, all conclude "I'm the last one," and all call `PublishAsync(new SagaCompletedEvent { ... })`. The downstream system sees the saga complete 1–4× depending on the race outcome.

The old pattern — `SELECT … WHERE already_emitted; INSERT IF NOT EXISTS` — has a check-to-commit window. Under high concurrency it collapses many duplicates to a few, but never to one.

`PublishOnceAsync` closes the window at the storage layer using `INSERT … ON CONFLICT DO NOTHING`. Exactly one caller wins the claim and emits; the rest intentionally no-op.

## API

```csharp{title="PublishOnceAsync signature" category="Architecture" tags=["Dispatcher", "Idempotency"] unverified="verified by DispatcherPublishOnceTests, which is outside the current coverage map"}
namespace Whizbang.Core;

public interface IDispatcher {
  // …existing methods…

  Task<bool> PublishOnceAsync<TEvent>(
      string claimKey,
      TEvent eventData,
      CancellationToken cancellationToken = default);
}
```

**Returns** `true` if this caller won the claim and the event was published; `false` if another caller already won it for the same key.

The `claimKey` is opaque to the framework — choose any string unique within your domain. Convention for sagas is the saga id.

## Worked example — saga completion

Before:

```csharp{title="Before: read-then-check (racy)" category="Architecture" tags=["AntiPattern"] unverified="racy anti-pattern — intentionally wrong, nothing to assert"}
public async Task TryEmitCompletionAsync(Guid sagaId, IDispatcher dispatcher, ISagaRepository repo) {
  var saga = await repo.LoadAsync(sagaId);
  if (saga.CompletionEventDispatched) {
    return;  // Check-then-act window: another emitter may pass this check between here and PublishAsync.
  }
  if (await CompletionGuard.AlreadyEmittedAsync(sagaId)) {
    return;  // Same problem one layer deeper.
  }
  await dispatcher.PublishAsync(new SagaCompletedEvent { SagaId = sagaId, … });
}
```

After:

```csharp{title="After: atomic claim" category="Architecture" tags=["Idempotency", "PublishOnce"] tests=["BaseSagaServiceTests.CompleteSagaAsync_RoutesThroughPublishOnceWithSagaClaimKeyAsync", "DispatcherSagaEventEmitterTests.PublishOnceAsync_ForwardsClaimKeyAndEventToDispatcherAsync"]}
public async Task TryEmitCompletionAsync(Guid sagaId, IDispatcher dispatcher) {
  await dispatcher.PublishOnceAsync(
    claimKey: sagaId.ToString(),
    eventData: new SagaCompletedEvent { SagaId = sagaId, … },
    cancellationToken: CancellationToken.None);
  // Multiple concurrent callers safely no-op. Exactly one event lands.
}
```

No projection-side flag, no read-then-check guard. The framework enforces the invariant at the dispatcher.

## How the claim works

`PublishOnceAsync` calls `IClaimedEmissionStore.TryClaimAsync(claimKey, …)`. The Postgres implementation runs:

```sql{
title: "Atomic claim via INSERT ... ON CONFLICT DO NOTHING"
description: "The Postgres statement behind PublishOnceAsync that lets exactly one concurrent emitter win a claim key while the losers affect zero rows, closing the check-to-commit race window at the storage layer."
category: "Messaging"
difficulty: "ADVANCED"
tags: ["publish-once", "exactly-once", "postgres", "on-conflict", "idempotency"]
}
INSERT INTO wh_unique_emission_claims (claim_key, claimed_by_event_id)
VALUES (@key, @eventId)
ON CONFLICT (claim_key) DO NOTHING;
```

For a contested key, exactly one INSERT affects one row; the others affect zero. The caller whose `ExecuteNonQueryAsync` returns `1` proceeds to `PublishAsync`; the rest return `false`.

### Schema

Migration `060_CreateUniqueEmissionClaims.sql` creates:

```sql{title="wh_unique_emission_claims" category="Schema"}
CREATE TABLE wh_unique_emission_claims (
  claim_key            text         PRIMARY KEY,
  claimed_at           timestamptz  NOT NULL DEFAULT now(),
  claimed_by_event_id  uuid         NOT NULL,
  expires_at           timestamptz  NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX idx_wh_unique_emission_claims_expires
  ON wh_unique_emission_claims (expires_at);
```

- **`claim_key`** — your idempotency key, opaque to the framework.
- **`claimed_by_event_id`** — audit only; the framework writes it but never reads it.
- **`expires_at`** — defaults to 30 minutes after the claim is taken. A claim still holds its key until it is deleted, because `TryClaimAsync` conflicts on the key alone; the [expiry prune](#claim-expiry) deletes it one day after `expires_at`.

### Reading and releasing claims

Two more members of `IClaimedEmissionStore` serve callers that must respect a decision another caller
already made:

- **`FindClaimedAsync(keys)`** returns the held subset of `keys`. A key reads as held for exactly as long
  as `TryClaimAsync` would lose on it, so it ignores `expires_at`. The stranded-saga sweep uses it to
  leave [abandoned sagas](../sagas/completion-orchestration#abandoned-sagas) alone.
- **`ReleaseAsync(key)`** deletes a held claim, so the gated side effect can happen once more. It is an
  operator's act, used to re-drive an abandoned saga; releasing a claim another caller still relies on
  lets its side effect happen twice.

A third, **`PruneAsync(keyPrefix, claimedBefore)`**, deletes the claims under a literal key prefix
taken before a cutoff, for the owner of a key convention that knows when its claims are spent.

All three have defaults, so a store written before them still compiles: `FindClaimedAsync` returns `null`
(cannot tell), `ReleaseAsync` returns `false` and `PruneAsync` returns 0. The Postgres store
implements all three.

### Claim expiry {#claim-expiry}

{verified: ClaimedEmissionPruneStepTests.Run_PrunesClaimsADayPastTheirExpiry_InOneBoundedBatchAsync, ClaimedEmissionPruneStepTests.Run_KeepsEveryRegisteredPrefix_OnceEachAsync, ClaimedEmissionStoreTests.PruneExpired_RemovesExpiredClaims_AndKeepsRetainedPrefixesAndUnexpiredOnesAsync}

A claim is deleted **one day after its `expires_at`**, by the `claimed-emission-prune` maintenance step,
so a key passed to `PublishOnceAsync` stays once-only for at least a day and a day and a half at most.
The table no longer grows by a row per key for good: the docs and migration 060 always said expired
claims were pruned, and until this step nothing did.

The step runs in the periodic maintenance cycle on the instance that holds the maintainer duty (on every
instance where role assignment does not manage that duty, where the repeat is a no-op). It deletes the
oldest expiries first, at most 5,000 claims per delete and ten deletes per cycle, so a table that grew for
a long time drains over several cycles instead of in one long delete. The Postgres driver registers it with
the store; another store takes part by implementing `PruneExpiredAsync`.

**Retained prefixes.** A package that owns a key convention and prunes its claims on its own terms keeps
them out of the expiry prune by registering the prefix:

```csharp{title="Keep a key convention out of the expiry prune" category="DI" unverified="DI registration snippet — configuration, not asserted by a test"}
services.AddRetainedClaimKeyPrefix("billing-period-close:");
```

The saga framework registers all four of its prefixes. It prunes its spent sweep, completion and
continuation claims after its own [claim retention](../sagas/completion-orchestration#claim-retention),
and never prunes its abandonment claims (`saga-abandoned:{name}:{id}`): those are the record that stops
the stranded-saga sweep re-arming an abandoned saga.

### Transaction semantics

When the caller is inside an ambient transaction, the claim INSERT participates. **Invariant:** claim is taken iff the emission committed. A rollback of the outer scope releases the claim, so a downstream caller can re-attempt.

When called outside a transaction, the claim commits independently. If the receptor crashes between claim and emission, the claim is "stranded" until it is deleted: an operator releases it with `ReleaseAsync`, its owner prunes it, or the [expiry prune](#claim-expiry) deletes it a day after it expires.

## DI registration

The Postgres driver registers `EFCoreClaimedEmissionStore` automatically. If you implement a custom store, register it scoped against the same DI scope as `PublishOnceAsync`'s callers (so it participates in their transactions):

```csharp{title="Custom claim store registration" category="DI" unverified="DI registration snippet — configuration, not asserted by a test"}
services.AddScoped<IClaimedEmissionStore, MyCustomClaimedEmissionStore>();
```

If no store is registered, `PublishOnceAsync` throws `InvalidOperationException` rather than silently degrading to `PublishAsync` — the framework's exactly-once guarantee would otherwise be a lie.

## Telemetry

Two counters surface the race:

| Counter | Meaning |
|---|---|
| `whizbang.dispatcher.publish_once.claims_won` | This caller won the claim and proceeded to emit. |
| `whizbang.dispatcher.publish_once.claims_lost` | This caller lost the claim and intentionally no-opped. |

Both are tagged with `message_type`. The expression `lost / (won + lost)` is the **observed race rate** for the gated emission.

A persistently nonzero loss rate is expected for any saga completing under N concurrent terminal handlers. Spikes — particularly on a single event type — point at a specific concurrency source worth investigating.

## When NOT to use it

- **Single-emitter cases.** A regular command handler that emits one event has no race. `PublishAsync` is the right tool.
- **Throw-away or non-idempotent payloads.** PublishOnce protects a specific logical emission, not a category. Don't reuse the same claim key for different payloads.
- **Fan-out where each emission is meaningful.** Bulk-update events where every emission represents a distinct change should use `ICompositeEvent` or `ICollectiveEvent`, not PublishOnce.

## Related

- [Dispatcher Deep Dive](dispatcher) — the broader `IDispatcher` API surface.
- [Collective Events](../messaging/collective-events) — when one event applies set-wise across many streams.
