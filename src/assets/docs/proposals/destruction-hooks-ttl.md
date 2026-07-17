---
title: Destruction Hooks & TTL
category: Architecture & Design
order: 23
tags: ephemeral, destruction, ttl, retention, lifecycle-hooks, reaper, disposition, snapshot-on-purge, failure-policy
---

# Destruction Hooks & TTL

[Ephemeral Events](ephemeral-events) (E1) gave events a self-destruct lifecycle: an `[Ephemeral]` event is a transient trigger, consumption-gated for deletion, with its body reaped once every perspective has consumed it. **E2 makes self-destruct *interceptable and time-driven*.** Two additions:

- **Destruction hooks** — run your own logic *before* and *after* an ephemeral event / stream / perspective row is destroyed: compact it, snapshot it, archive it, crypto-shred it, cancel it, or defer it. The pre-hook is an awaited receptor on the reaper's critical path.
- **`Destruction.AfterTtl`** — a second self-destruct trigger: a logical `expires_at`, reaped in two phases, driven by the [Temporal Engine](temporal-engine). This is where a [`TransientStorage.TtlRow`](ephemeral-events#transient-storage-where-the-read-model-lives-developer-picks) perspective row finally gets its expiry.

:::planned
E2 is a proposed capability (unreleased, not yet started). It builds directly on E1 (the consumption-gated reaper, `Destruction`/`TransientStorage`, homogeneous streams) and F2 (the temporal engine, which grows an `expires_at` "death" transition here). Archival (A1), carry-forward compaction (E3), and GDPR crypto-shred (G1) are later phases — but their handlers *plug into the destruction hook this proposal defines*, so E2 is the extension point they all share.
:::

## Why hooks — self-destruct is a decision point, not just a delete

E1's reaper is a blunt `DELETE`: once consumed + aged, the body is gone. That's right for presence pings, but the moment a stream carries anything worth summarizing before it evaporates — a chat thread you want to keep the last state of, a draft you want to snapshot, a subject whose key you must shred — deletion needs a **hook the reaper awaits**. The industry precedent is uniform: EventStoreDB scavenge is destructive-and-final, Kafka compaction writes a tombstone, Marten's `CompactStreamAsync` writes a carry-forward event *before* dropping detail. Whizbang already has the machinery to do this well — [lifecycle stages + receptors + the coordinator](../fundamentals/lifecycle/lifecycle-stages) — so destruction becomes just another lifecycle stage, not a bespoke callback.

## The lifecycle stages: `PreDestruction` / `PostDestruction`

E2 adds four members to `LifecycleStage`, following the existing **Inline / Detached** pairing (`Pre*Inline` blocks the unit of work; `*Detached` is fire-and-forget in its own scope):

```csharp{title="New destruction lifecycle stages" description="Pre/PostDestruction in both Inline and Detached forms, matching the existing LifecycleStage convention" category="Core Concepts" difficulty="ADVANCED" tags=["destruction","lifecycle-stages","ephemeral"] framework="NET10"}
public enum LifecycleStage {
  // … existing stages (PreOutbox, PostInbox, PostPerspective, PostLifecycle, …) …

  /// <summary>Detached: fire-and-forget, runs in its own scope. Does not block the reaper.</summary>
  PreDestructionDetached,
  /// <summary>Inline: AWAITED on the reaper's critical path. Its side-effects must durably commit
  /// before the physical delete. This is where compact / snapshot / archive / shred runs.</summary>
  PreDestructionInline,

  /// <summary>Detached: notify / metrics / cascade after the delete has committed.</summary>
  PostDestructionDetached,
  /// <summary>Inline: awaited post-delete confirmation (rare; most post-work is Detached).</summary>
  PostDestructionInline
}
```

Destruction fires at three **granularities**, resolved by the reaper against what it is about to remove:

| Granularity | Fires when | Context carries |
|---|---|---|
| **Event** | a single ephemeral event's body is about to be reaped (consumption-gated, or TTL-expired) | the event + its metadata + scope |
| **Stream** | a whole ephemeral stream is being purged / compacted | the stream id + its perspectives' current models |
| **Perspective row** | a `TtlRow` perspective row is expiring | the `(stream, perspective)` + the row |

Receptors bind to these stages exactly like any other lifecycle receptor — the [`ILifecycleCoordinator`](../fundamentals/lifecycle/lifecycle-coordinator) fires them; no new subscription mechanism.

## The hook contract: `DestructionContext` → `DestructionResult`

A `PreDestruction` receptor receives everything it needs to decide, and returns a decision:

```csharp{title="The destruction hook contract" description="Context in, result out — the hook chooses a disposition, cancels, defers, or runs awaited work" category="Core Concepts" difficulty="ADVANCED" tags=["destruction","hook","disposition"] framework="NET10"}
public sealed record DestructionContext {
  public DestructionReason Reason { get; init; }        // ConsumptionComplete | TtlExpired | StreamPurge | Erasure
  public DestructionGranularity Granularity { get; init; } // Event | Stream | PerspectiveRow
  public Disposition DeclaredDefault { get; init; }     // from [Ephemeral(OnDestroy = …)] or framework default
  public PerspectiveScope? Scope { get; init; }         // tenant / subject, flows as everywhere
  // + the event(s) / stream id / perspective model being destroyed, and the dispatcher.
}

public sealed record DestructionResult {
  public Disposition Disposition { get; init; }         // Delete (default) | Archive | Compact | CryptoShred
  public bool Cancel { get; init; }                     // keep the data, stays ephemeral (leak-risk = your call)
  public DateTimeOffset? DeferUntil { get; init; }      // reschedule the destruction (new expires_at)
}
```

Because the hook is a **full receptor**, "anything a receptor can do" is available *within the ephemeral world* — it can `await` compaction work, and it can emit **new ephemeral events** through the dispatcher (a `Compacted<T>` summary, a notification, a cascade). What it **cannot** do is emit a **Sourced** event carrying the ephemeral payload — see the invariant below.

## Dispositions and the uniform override ladder

The `PreDestruction` hook's `Disposition` collapses E1's "retention strategies" into **built-in + user-pluggable handlers** — "which strategy" becomes "which handler runs":

| Disposition | Does | Lands in phase |
|---|---|---|
| **`Delete`** *(default)* | physical delete, as E1's reaper does today | **E2** |
| **`Compact`** | fold detail into an authoritative *ephemeral* `Compacted<T>` summary, then delete the detail | E3 |
| **`Archive`** | move the detail to cold storage (preserved, auditable), then drop it from the hot store | A1 |
| **`CryptoShred`** | destroy the subject key so ciphertext is unreadable (durable data isn't deleted) | G1 |

E2 wires **`Delete`** and the **hook + `Defer` + `Cancel`** plumbing; `Compact`/`Archive`/`CryptoShred` are their own phases but register as handlers on this same stage, so the extension point ships now.

Every destruction decision — **disposition**, **failure policy**, **retention deadline** — resolves through **one** ladder (the same shape E1 already uses for its mode):

> **framework default → `[Ephemeral(…)]` attribute → named policy → programmable hook.**

So a team can set a default disposition declaratively (`[Ephemeral(OnDestroy = Compact)]`), a `PreDestruction` hook can override it at runtime per instance, or a named policy referenced by attribute can standardize it across many types — all without touching the reaper.

## `Destruction.AfterTtl` — the second self-destruct trigger

E1 self-destructs on **consumption**. E2 adds self-destruct on **age**: `[Ephemeral(Destruction = AfterTtl, Ttl = "90d")]`. This is **two-phase**, the canonical event-store discipline (EventStoreDB `$maxAge` vs scavenge, Redis logical expiry vs eviction):

```mermaid{title="Two-phase TTL destruction" description="Logical expiry (a read-time filter) is decoupled from physical reap (the awaited hook + delete)."}
flowchart LR
  A["event stored<br/>expires_at = now + Ttl"] --> B{"expires_at ≤ now?"}
  B -- no --> R["readable"]
  B -- yes --> F["Phase 1: logically expired<br/>filtered from reads immediately"]
  F --> G["consumption gate + rewind grace<br/>(reuse E1)"]
  G --> H["Phase 2: PreDestruction (awaited)<br/>→ physical reap → PostDestruction"]
```

- **Phase 1 — logical expiry.** `expires_at ≤ now` filters the event from reads *at once* (the model must not see expired data), independent of when the bytes actually go.
- **Phase 2 — physical reap.** The reaper deletes the body only after the same **E1 gates** it already honors — every perspective consumed it, aged past the [rewind grace window](ephemeral-events#out-of-order-arrivals-rewind-the-grace-window-and-ephemeral-snapshots), and snapshot-covered — *and* the `PreDestruction` hook has committed.

**Driven by the temporal engine.** F2 already wakes on time boundaries for *birth* (`scheduled_for`) and *recurrence* (`next_fire`). `AfterTtl` is the **death** transition on that same engine: a partial index on `wh_event_store(expires_at)`, claimed the same leased, DB-clock-authoritative way as any due schedule — no second timer, no polling in the healthy path. A `TransientStorage.TtlRow` perspective row expires through the identical mechanism (`wh_per_*.expires_at`), which is the E1 half [we deferred here](ephemeral-events#transient-storage-where-the-read-model-lives-developer-picks).

**Snapshot-on-purge.** Before the reap deletes a TTL'd stream's tail, the reaper drives a snapshot through the purge boundary — exactly the [reap-driven ephemeral snapshot](ephemeral-events#snapshots-the-rewind-floor) machinery E1 built, reused so a rewind floor survives a TTL purge just as it survives a consumption reap.

## Ordering & durability — the critical path

The whole point of an *awaited* pre-hook is that its work is durable **before** the data it summarizes is gone. The reaper runs a strict sequence per unit of destruction:

```mermaid{title="Destruction critical path" description="The Inline pre-hook and its side-effects commit transactionally before the physical delete; post-work is detached."}
sequenceDiagram
  participant R as Reaper
  participant H as PreDestruction (Inline)
  participant DB as Store
  R->>R: gates satisfied (consumed + aged + covered)
  R->>H: await hook(DestructionContext)
  H->>DB: compact / snapshot / archive / shred (transactional)
  H-->>R: DestructionResult (Disposition / Cancel / Defer)
  alt Cancel or Defer
    R->>DB: keep / reschedule expires_at — no delete
  else Proceed
    R->>DB: physical delete (same tx boundary as the hook's commit)
    R->>R: PostDestruction (Detached): notify / metrics / cascade
  end
```

The pre-hook's side-effects and the physical delete share a transactional boundary, so a crash between "summarized" and "deleted" cannot lose data — you either kept the detail or durably captured its carry-forward first. (Confluent's "crypto on the critical path" caveat applies: the awaited hook adds latency; that's the deliberate trade for correctness.)

## Failure policy — retry, then a bounded forced delete

The awaited pre-hook can fail (a compaction error, an archive timeout, a KMS hiccup). Destruction is therefore a **retryable unit of work** — claimed and leased like outbox / perspective work — with a default policy that is bounded, observable, and overridable:

- **Log + OTel meter on every failure** (never silent).
- **Retry on a decaying, TTL-derived backoff, then a forced delete.** Default cadence halves the remaining TTL each attempt (`60d → +30d → +15d → +7.5d → forced delete`) — it converges, so a permanently-failing hook can't wedge the reaper forever.
- **Disposition caveat:** a forced delete is safe for `Delete`/`CryptoShred` (deleting also satisfies the intent), but it **loses the summary** for `Compact`/`Archive` — so a team with a critical summary overrides the policy.
- **Override** through the same ladder: `[Ephemeral(OnDestroyFailure = …)]`, a named policy, or a programmable hook that decides retry / abort / delete per failure.

## Invariant — ephemeral → Sourced promotion stays forbidden

The [E1 no-laundering rule](ephemeral-events#ephemeral-is-viral-it-taints-derived-read-state) holds through every hook: a `PreDestruction` receptor may `Cancel`, `Defer`, emit ephemeral events, and produce a `Compact` **authoritative ephemeral snapshot** — but it can **never** re-emit the ephemeral event or its payload as a Sourced (durable) event. The one-way boundary is what keeps ephemeral streams honestly ephemeral even at their most powerful extension point. `Compact` shrinks an ephemeral stream while keeping it ephemeral; it does not "promote to durable."

## What E2 builds on, and what it defers

**Reuses (no new mechanism):** the E1 consumption gate, rewind grace window, and reap-driven snapshots; the F2 temporal engine (a new `expires_at` death transition on the existing leased-claim / DB-clock path); the lifecycle-stage + receptor + `ILifecycleCoordinator` machinery.

**Defers (each its own phase, but plugging into this hook):** `Archive` implementation → A1; `Compacted<T>` carry-forward → E3; `CryptoShred` + the subject key store → G1. E2 ships the **stage, the context/result contract, `Delete`, `Defer`, `Cancel`, `AfterTtl`, and the failure policy** — the frame the others hang on.

## Observability & tests

**OTel:** destructions attempted / succeeded by disposition; hook invocations / failures / retries / forced-deletes + duration; TTL fire lateness (`expires_at` → actual reap); consumption-gate + grace backlog; compacted-record created / size.

**Regression invariants to lock (E1 discipline — completion signals, not `Task.Delay`):**
- **Carry-forward commits BEFORE delete** — inject a hook failure at the commit boundary and assert no data loss (kept the detail or its summary).
- Disposition applied; `Cancel` / `Defer` keep the data ephemeral and reschedule `expires_at`.
- Hook-failure → TTL-halving retry → forced delete, bounded and metered.
- **Two-phase TTL:** an expired event is filtered from reads *immediately* (phase 1) yet its body survives until the gates + hook clear (phase 2).
- Snapshot-on-purge leaves a rewind floor after a TTL purge.
- The no-laundering invariant: a hook cannot emit a Sourced event from ephemeral data (analyzer + runtime).

## Build increments (docs-first, then TDD per slice)

1. **Stages + contract** — `PreDestruction`/`PostDestruction` `LifecycleStage` members; `DestructionContext` / `DestructionResult` / `Disposition` / `DestructionReason`; coordinator wiring. Inert until the reaper calls it.
2. **Reaper → awaited pre-hook** — the 073 reaper resolves a `PreDestruction` receptor (optional; today's blunt delete when none) and awaits it transactionally before the delete; `PostDestruction` detached after.
3. **`Defer` / `Cancel`** — the reaper honors a rescheduled `expires_at` / a kept row; the "cancel a pending destruction" primitive.
4. **`AfterTtl` + two-phase** — `expires_at` column + partial index; logical-expiry read filter; the temporal death transition; `[Ephemeral(Ttl = …)]` stamping; `TransientStorage.TtlRow` row-expiry.
5. **Failure policy** — retryable/leased destruction unit; TTL-halving backoff → forced delete; the override ladder (`OnDestroyFailure`).
6. **Snapshot-on-purge** — drive the reap-driven snapshot through the TTL purge boundary.

Increments 1–3 are the extension point A1 / E3 / G1 need; 4–6 complete the TTL strategy.
