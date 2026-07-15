---
title: Ephemeral Events
category: Architecture & Design
order: 22
tags: ephemeral, self-destructing, sourced, consumption-gated, viral, analyzer, transient-state, retention
---

# Ephemeral Events

Whizbang's default is **event sourcing**: an event is an immutable fact appended to a durable log, the log is the source of truth, and perspectives are rebuildable projections. But some data doesn't want those guarantees — a "user is typing" ping, an open-tabs layout, a chat message that only needs to live ~90 days. **Ephemeral Events** make the *event-driven* path first-class and opt-in, running side-by-side with the event-sourced path in the same product: you emit events, write perspectives, and read lenses **exactly as today**, and only the event's declared **mode** changes what the runtime does with the data underneath.

:::planned
Ephemeral Events are a proposed capability (unreleased, not yet started). This proposal covers **E1** — the core mode, the compile-time guardrails, and the first retention strategy (**Immediate**). Destruction hooks + TTL ([E2](#scope-what-e1-does-and-does-not-cover)), archival/compaction (A1), carry-forward (E3), and GDPR crypto-shredding (G1) are separate later phases that build on this foundation and the [Temporal Engine](temporal-engine).
:::

## Motivation

Three cases want state-based, self-destructing behavior — and today each would force a developer out of Whizbang into a separate channel (Redis, a CRDT, an ad-hoc table):

- **Transient UI / presence** — "user is typing," cursor position, open panels. Barely needs durability; self-destructs on session end or idle. Losing it is fine.
- **Chat-style history** — keep the current thread state, let the keystroke-by-keystroke detail disappear after a window. The snapshot is enough; the full history isn't worth storing forever.
- **Perspective-as-source-of-truth** — deliberately *degrade* event sourcing to traditional state-based storage for data that needs no replay/audit. Events drive the read model, then self-destruct; the perspective row becomes authoritative.

The industry never event-sources this data — Phoenix Presence is an in-memory CRDT, Yjs Awareness is a *separate* channel explicitly "not stored in the doc," NATS `InterestPolicy` deletes on ack. The consistent signal is that transient state is its own mechanism. Whizbang's contribution is to keep it in the **same programming model** — no second API to learn — while being honest that the durability semantics differ.

## Two modes per event: Sourced vs Ephemeral

This is **not** a new tier bolted onto the event store. It is a per-event **consistency mode** with two values, chosen by opt-in:

| | **Sourced** (default, today) | **Ephemeral** (new, opt-in) |
|---|---|---|
| The event is | an **immutable fact** in the durable log | a **transient trigger** that drives state, then self-destructs |
| Source of truth | the event log | the **read model / snapshot** (never the log) |
| Perspectives are | **rebuildable projections** (cache) | **authoritative state** (never rebuilt) |
| Replay / audit / temporal | full | none — no log to replay from |

Same programming model, different durability semantics. **Mode name = `Ephemeral`** (the durable default stays "event-sourced / Sourced").

## What exists today (the seeds)

Ephemeral builds on existing "never persisted" and "hard delete" seams rather than inventing new ones:

- **`Route.LocalNoPersist`** / **`DispatchModes.LocalNoPersist`** (`Dispatch/Route.cs`, `Dispatch/DispatchMode.cs`) — `LocalNoPersist == LocalDispatch` deliberately omits the `EventStore` bit, so the dispatcher (`Dispatcher._dispatchByModeAsync`) invokes in-process receptors but **never** appends to `wh_event_store`. The existing "dispatch, don't persist" path an in-memory ephemeral event rides on.
- **`ICompositeEvent`** (`Messaging/ICompositeEvent.cs`) — is `IMessage`-not-`IEvent`, so it is *structurally* excluded from the event-store append and fans out to children that are persisted instead. The closest precedent to "flows through dispatch, is never event-stored."
- **`ModelAction.Purge`** / **`ApplyResult<T>.Purge()`** (`Perspectives/ModelAction.cs`, `ApplyResult.cs`) → the generated runner's `pendingPurge` path → **`IPerspectiveStore.PurgeAsync(streamId, ct)`** (`EFCorePostgresPerspectiveStore`, `ExecuteDeleteAsync`). The read-model **hard-delete** primitive the reaper reuses.
- **`EventFlags`** treatment-bit convention (`Messaging/EventFlags.cs`) — `Collective=1`, `Composite=2`, `NoRebroadcast=4`. Category vs treatment bits, read in SQL as `(flags & N)` (migrations `061`/`062`). The derived hot-path marker for ephemeral is the next bit.
- **`wh_perspective_cursors`** + **`IPerspectiveCursorResolver.GetAsync`** (`Workers/IPerspectiveCursorResolver.cs`) — per-perspective checkpoint ("how far has this perspective advanced on this stream"). The exact question consumption-gated deletion asks.
- **`MessageTypeCatalogEntry`** + **`MessageTypeCatalogGenerator`** (`IMessageTypeCatalog.cs`, `Whizbang.Generators/`) — the AOT-safe compile-time catalog of message types (`Kind` = `"event"`/`"command"`/`"perspective"`). Ephemeral mode metadata rides here, generated — never reflected.

## Declaration: `[Ephemeral]` is the compile-time authority

The **source of truth is a compile-time `[Ephemeral(...)]` attribute** (`Core/Attributes/`) on the event type — required so the analyzer, generators, and AOT can evaluate it at build time, and self-describing as part of the contract. An optional `IEphemeralEvent` marker covers the no-config default.

```csharp{title="Declaring an ephemeral event" description="Compile-time authority; the runtime carriers are derived from it" category="Architecture" difficulty="BEGINNER" tags=["Ephemeral"] framework="NET10"}
// Opt in with the attribute (authority for analyzer + generators + AOT).
[Ephemeral(Strategy = RetentionStrategy.Immediate, Storage = TransientStorage.InMemory)]
public sealed record UserIsTyping(Guid ConversationId, Guid UserId) : IEvent;

// …or the marker for the no-config default (Immediate, developer picks storage).
public sealed record CursorMoved(Guid DocumentId, int Line, int Column) : IEvent, IEphemeralEvent;
```

**Runtime carriers are derived, not authoritative.** The generator stamps the mode onto `MessageTypeCatalogEntry` for AOT-safe lookup; the wire carries **structured, named envelope metadata** (self-describing, version-robust across service/version boundaries); and an optional persisted `EventFlags` bit + `expires_at` marker exists only as an **indexable hot-path hint** for the storage gate — never the source of truth, derived at emit time exactly as `Composite`/`Collective` are in `Dispatcher.cs`.

## Ephemeral is viral (it taints derived read-state)

Choosing `Ephemeral` for an event is **not local** — correctness demands it propagate to everything that derives state from it. A perspective fed by a self-destructing event **cannot** be a rebuildable projection (nothing to rebuild from), so it must be **authoritative state**. That taint flows transitively.

**Viral — inherits Ephemeral:**

- Perspectives that `Apply` an Ephemeral event → **state-based read models** (authoritative, never `RebuildFromEvents`); their snapshots become authoritative.
- Sagas / process managers gated on an Ephemeral event → non-replayable.
- **Temporal perspectives** (`ITemporalPerspectiveFor`) → can't provide history for an ephemeral stream (no log) → unavailable there.
- Anything transitively derived from the above.

**NOT viral — the boundary (`no-laundering`):**

- Virality flows to **derived read-state**, NOT to every event a receptor emits in reaction.
- **Ephemeral → Sourced promotion is forbidden** — you cannot re-emit an ephemeral event or its payload as a durable Sourced event.
- **Causal-downstream IS allowed** — a receptor may make an independent business decision that emits a Sourced fact carrying its **own** durable data (ephemeral "buy clicked" → durable `OrderPlaced` with its own orderId/items). **Causation crosses the boundary; the ephemeral payload does not.**

## Homogeneous streams

A stream is **all-Sourced or all-Ephemeral, never mixed** (analyzer + runtime guard enforce it). Ephemerality is therefore effectively a **per-stream property**, which keeps the reaper, the consumption-gate, snapshot-authority, and the replay-guards all operating at simple **stream granularity**. Ephemeral data lives in its own short streams.

## Enforcement: a Roslyn analyzer *and* a runtime guard

Nobody in the industry *enforces* virality — everyone documents "don't rebuild from a log you deleted" and hopes. Whizbang makes it **safe by construction** at build time. A new analyzer band (proposed **`WHIZ130`–`WHIZ139`**, following the `PinnedIdAnalyzer` / `InheritScopeAnalyzer` precedent in `Whizbang.Generators/Analyzers/` and the `DiagnosticDescriptors` banding) flags:

| Diagnostic | Flags |
|---|---|
| **WHIZ130** | A perspective fed by **both** a Sourced and an Ephemeral event (a contradiction — can't be both cache and authority). |
| **WHIZ131** | `rebuild` / `rewind` / `RebuildFromEvents` on an Ephemeral-tainted perspective (`PerspectiveRebuilder.RebuildStreamsAsync`, `SnapshotUpgradePolicy.RebuildFromEvents`). |
| **WHIZ132** | Re-emitting an ephemeral event / its payload as a **Sourced** event (the promotion boundary). |
| **WHIZ133** | A mixed-mode **stream** (an event of the other mode appended to a homogeneous stream). |

The analyzer is paired with a **runtime guard** (the same replay/rebuild entry points refuse or redirect to load-from-snapshot for an ephemeral stream), so enforcement holds even for dynamically-composed cases the analyzer can't see. Perspective **mode is derived** by a generator step that walks the event→perspective `Apply` edges (the perspective generators already know each perspective's event set) — zero reflection.

## Immediate retention: consumption-gated deletion

`Immediate` is E1's first (and simplest) retention strategy: an ephemeral event self-destructs **once every perspective that cares has consumed it** — modeled on NATS `InterestPolicy` ("gone once handled"). This is the **novel, safe-by-construction guarantee**: every other system *warns* "don't delete before all projections have consumed," but none can enforce it. Whizbang can, because `wh_perspective_cursors` already records each perspective's checkpoint.

The reaper **provably withholds physical deletion until every registered perspective's cursor has checkpointed past the event** — a join against `wh_perspective_cursors` via `IPerspectiveCursorResolver`. This directly neutralizes the #1 documented hazard in every event store (rebuild-from-a-deleted-log) and is a real differentiator.

```text{title="Consumption-gated deletion" description="Withhold physical delete until every perspective's cursor passes" category="Architecture" difficulty="INTERMEDIATE" tags=["Ephemeral","Retention"] framework="NET10"}
ephemeral event E on stream S
  → dispatched to perspectives P1, P2, P3 (all that Apply its type)
  → each Pi advances wh_perspective_cursors[S, Pi] past E
  → reaper deletes E's transient carrier ONLY when
       min(cursor[S, P1], cursor[S, P2], cursor[S, P3]) is past E
  → until then, E is retained (read-time still sees state; the row just isn't reaped)
```

Deletion is **two-phase** everywhere (the canonical pattern from ES-DB `$maxAge` vs scavenge): **logical expire (read-time filter) is decoupled from physical reap**. The Immediate reaper attaches to the existing maintenance surface — `perform_maintenance()` (migration `032`, explicitly "add new maintenance operations here") driven by `MaintenanceWorker` — reusing `PurgeAsync` for the read-model hard delete.

## Transient storage: in-memory or a TTL'd row (developer picks)

Where the authoritative ephemeral *state* lives is **orthogonal** to ephemeral-ness, chosen per perspective:

| Storage | How | Survives restart? | Use |
|---|---|---|---|
| **In-memory** | reuse `InMemoryUpsertStrategy` (`InMemoryDriverExtensions`) + realtime push | No | presence / typing / cursor — losing it is fine |
| **TTL'd `wh_per_*` row** | a normal perspective row with an `expires_at` marker | Yes | chat thread state, session layout — lens-queryable, restart-safe |

Both are read through the existing `ILensQuery` path — **the read side is unaffected**; it already reads only `wh_per_*` rows. An in-memory ephemeral event is routed through `Route.LocalNoPersist` (dispatch-only, no event-store append); a TTL'd one may still publish, flagged ephemeral.

## Scope: what E1 does (and does not) cover

**E1 delivers:** the `[Ephemeral]` attribute + mode on `MessageTypeCatalog`; viral perspective-mode derivation; the analyzer + runtime guards; **Immediate** consumption-gated deletion; in-memory / TTL-row transient storage. It proves the model on the presence/UI case and consumes the [Signal Bus](../fundamentals/signal-bus/signal-bus).

**Deliberately deferred to later phases** (each its own proposal):

- **Destruction hooks + TTL (E2)** — `Pre/PostDestruction` lifecycle stages, dispositions (Delete / Archive / Compact / Shred), the TTL-halving failure ladder, and `expires_at` + two-phase reaper as a general strategy.
- **Archival / compaction (A1)** — "closing the books" for durable **Sourced** streams (domain-authored carry-forward + gated truncate/archive).
- **Carry-forward / Tier-2 (E3)** — `Compacted<T>` ephemeral summary as authority, document-style per-record versioning.
- **GDPR / subject-scoped crypto data-protection (G1)** — crypto-shredding for durable data (a *separate* mechanism: Sourced → crypto-shred, Ephemeral → delete).

## Related Documentation

- Temporal Engine — the `expires_at` (death) side of the same time engine an ephemeral TTL will consume in E2.
- System Signal Bus — the doorbell transport the reaper and destruction-due signals ride on.
- Perspectives & Projections — the read models that become authoritative under Ephemeral.
