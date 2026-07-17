---
title: Ephemeral Events
category: Architecture & Design
order: 22
tags: ephemeral, self-destructing, sourced, consumption-gated, viral, analyzer, transient-state, retention
---

# Ephemeral Events

Whizbang's default is **event sourcing**: an event is an immutable fact appended to a durable log, the log is the source of truth, and perspectives are rebuildable projections. But some data doesn't want those guarantees — a "user is typing" ping, an open-tabs layout, a chat message that only needs to live ~90 days. **Ephemeral Events** make the *event-driven* path first-class and opt-in, running side-by-side with the event-sourced path in the same product: you emit events, write perspectives, and read lenses **exactly as today**, and only the event's declared **mode** changes what the runtime does with the data underneath.

:::planned
Ephemeral Events are a proposed capability (unreleased, not yet started). This proposal covers **E1** — the core mode, the compile-time guardrails, and the first destruction strategy (**`WhenConsumed`**). Destruction hooks + TTL ([E2](#scope-what-e1-does-and-does-not-cover)), archival/compaction (A1), carry-forward (E3), and GDPR crypto-shredding (G1) are separate later phases that build on this foundation and the [Temporal Engine](temporal-engine).
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

- **`Route.LocalNoPersist`** / **`DispatchModes.LocalNoPersist`** (`Dispatch/Route.cs`, `Dispatch/DispatchMode.cs`) — `LocalNoPersist == LocalDispatch` deliberately omits the `EventStore` bit, so the dispatcher (`Dispatcher._dispatchByModeAsync`) invokes in-process receptors but **never** appends to `wh_event_store`. A real "dispatch, don't persist" seam — but **not** the path ephemeral events take: because delivery to a stream's owning instance is DB-mediated (see [Transient storage](#transient-storage-where-the-read-model-lives-developer-picks)), an ephemeral event that fed a stream-routed perspective still persists + routes normally. LocalNoPersist stays a fire-and-forget local-signal primitive, not an ephemeral-persistence mode.
- **`ICompositeEvent`** (`Messaging/ICompositeEvent.cs`) — is `IMessage`-not-`IEvent`, so it is *structurally* excluded from the event-store append and fans out to children that are persisted instead. The closest precedent to "flows through dispatch, is never event-stored."
- **`ModelAction.Purge`** / **`ApplyResult<T>.Purge()`** (`Perspectives/ModelAction.cs`, `ApplyResult.cs`) → the generated runner's `pendingPurge` path → **`IPerspectiveStore.PurgeAsync(streamId, ct)`** (`EFCorePostgresPerspectiveStore`, `ExecuteDeleteAsync`). The read-model **hard-delete** primitive the reaper reuses.
- **`EventFlags`** treatment-bit convention (`Messaging/EventFlags.cs`) — `Collective=1`, `Composite=2`, `NoRebroadcast=4`. Category vs treatment bits, read in SQL as `(flags & N)` (migrations `061`/`062`). The derived hot-path marker for ephemeral is the next bit.
- **`wh_perspective_cursors`** + **`IPerspectiveCursorResolver.GetAsync`** (`Workers/IPerspectiveCursorResolver.cs`) — per-perspective checkpoint ("how far has this perspective advanced on this stream"). The exact question consumption-gated deletion asks.
- **`MessageTypeCatalogEntry`** + **`MessageTypeCatalogGenerator`** (`IMessageTypeCatalog.cs`, `Whizbang.Generators/`) — the AOT-safe compile-time catalog of message types (`Kind` = `"event"`/`"command"`/`"perspective"`). Ephemeral mode metadata rides here, generated — never reflected.

## Declaration: `[Ephemeral]` is the compile-time authority

The **source of truth is a compile-time `[Ephemeral(...)]` attribute** (`Core/Attributes/`) — required so the analyzer, generators, and AOT can evaluate it at build time, and self-describing as part of the contract. It can sit **directly on the event**, or — for reuse — on a **base record or a marker interface** the event derives from ([composition](#composition-ephemeral-is-inheritable), below).

```csharp{title="Declaring an ephemeral event" description="Compile-time authority; the runtime carriers are derived from it" category="Architecture" difficulty="BEGINNER" tags=["Ephemeral"] framework="NET10"}
// Opt in directly (authority for analyzer + generators + AOT).
// Reads plainly: this event is ephemeral, destroyed once every perspective has consumed it.
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.InMemory)]
public sealed record UserIsTyping(Guid ConversationId, Guid UserId) : IEvent;

// …or take the framework's default profile — IEphemeralEvent is just a shipped marker
// interface carrying [Ephemeral] with defaults (WhenConsumed; developer picks storage).
public sealed record CursorMoved(Guid DocumentId, int Line, int Column) : IEvent, IEphemeralEvent;
```

The `Destruction` axis is *how/when the event self-destructs* — named to match the E2 `Pre`/`PostDestruction` hooks and `DestructionContext`, not framed as retention (the event is emphatically **not** retained). There are four values, each landing with its phase:

| `Destruction` | Self-destruct trigger | The state survives in | Phase | Prior art |
|---|---|---|---|---|
| **`WhenConsumed`** | once **every perspective** has consumed it (consumption-gated) | the perspective row / snapshot | **E1** | NATS `InterestPolicy` |
| **`AfterTtl`** | a logical expiry at `expires_at`, then a two-phase reap | the log within the window, then a snapshot | E2 | ES-DB `$maxAge`, Redis `MINID` |
| **`OnCompaction`** | fold the detail into an authoritative ephemeral summary (`Compacted<T>`), then truncate | the carry-forward summary (a new origin) | E3 | Marten `Compacted<T>` |
| **`Archived`** | move the detail to cold storage (preserved, not erased), then drop it from the hot store | the archive store (audit-preserved) | A1 | Marten archived streams |

Only **`WhenConsumed`** is wired in E1; the attribute rejects the others at build time (analyzer) until their phase lands, so the enum is honest about what actually works today. All four share the **two-phase** discipline: logical expire (read-time filter) is decoupled from physical reap.

**Runtime carriers are derived from the attribute, not authoritative.** The compile-time `[Ephemeral]` is *translated* into three runtime carriers at emit time (exactly as `Composite`/`Collective` are derived in `Dispatcher.cs`):

1. **Generated catalog metadata** — the generator stamps the resolved mode onto `MessageTypeCatalogEntry`, the AOT-safe compile-time lookup used in-process.
2. **Envelope metadata** — the **cross-service carrier** (see [Crossing service boundaries](#crossing-service-boundaries-transport)). A receiver can't read a `[Ephemeral]` attribute — it may not have the type, or has a different version — so the emit path **translates the attribute into structured, named envelope metadata** that travels with the event over the wire. This is the same mechanism F2 already uses to carry `scheduleId` / `deliveryGuarantee` / `authorityClaims` in the envelope metadata through `wh_outbox.metadata` → transport → inbox.
3. **Persisted hot-path hint** — an optional `EventFlags` bit + `expires_at` column, an **indexable** marker for the storage gate / reaper only.

None of the three is the source of truth — the attribute is; the carriers are stamped from it. Making the attribute → envelope-metadata translation a first-class step is what lets an ephemeral event be understood, and self-destructed, by a service that never compiled against its type.

## Composition: `[Ephemeral]` is inheritable

`[Ephemeral]` may sit on the event type, on an **abstract base record**, or on a **marker interface** — so a team can define a reusable *ephemeral profile* once and have every member obey it, without repeating the attribute (`AttributeTargets.Class | Interface | Struct`, `Inherited = true`). This is the same idiom Whizbang already uses everywhere (`IEvent`, `ICompositeEvent`, `ICollectiveEvent`) and the same *inheritable-attribute* pattern as `[InheritScope]` — generalized so the composed base carries the full configured behavior, not just a bare flag.

```csharp{title="Composing an ephemeral profile" description="One [Ephemeral] on a base/interface; all members obey it" category="Architecture" difficulty="INTERMEDIATE" tags=["Ephemeral","Composition"] framework="NET10"}
// A reusable profile: everything that is a presence signal is in-memory + WhenConsumed.
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.InMemory)]
public interface IPresenceSignal : IEvent { }

public sealed record UserIsTyping(Guid ConversationId, Guid UserId) : IPresenceSignal;   // ephemeral
public sealed record UserWentIdle(Guid ConversationId, Guid UserId) : IPresenceSignal;   // ephemeral

// A base record works too — good for shared payload/fields plus the shared ephemeral nature.
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.TtlRow)]
public abstract record SessionState(Guid SessionId) : IEvent;

public sealed record TabsReordered(Guid SessionId, int[] Order) : SessionState(SessionId);  // ephemeral
```

Because the runtime is **zero-reflection**, the generator *resolves* a type's effective mode at compile time rather than relying on `AttributeUsage.Inherited` (which the CLR only honors for base classes via reflection, and never for interfaces). Resolution walks **own type → base records → implemented interfaces (and their bases)**, and is deliberately simple:

- **Most-specific wins.** A type's own `[Ephemeral]` refines an inherited one; a base record's refines an interface's. So a member may re-declare `[Ephemeral]` to tweak `Storage`/`Destruction` for its own case.
- **Ephemerality can't be escaped.** A type reachable from an ephemeral base/interface **is** ephemeral — it may refine the profile but cannot flip to Sourced (that is the same one-way [no-laundering boundary](#ephemeral-is-viral-it-taints-derived-read-state)). The analyzer flags an attempt (WHIZ132).
- **Ambiguity is an error, not a silent pick.** If a type implements two ephemeral profiles that disagree and nothing more-specific breaks the tie, the analyzer reports **WHIZ134** — the developer resolves it by declaring an explicit `[Ephemeral]` on the type. No implementation-order-dependent surprises.

`IEphemeralEvent` is therefore not a separate mechanism — it is simply the framework-shipped default profile (an interface carrying `[Ephemeral]` with defaults). Developers ship their own profiles the same way.

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

Nobody in the industry *enforces* virality — everyone documents "don't rebuild from a log you deleted" and hopes. Whizbang makes it **safe by construction** at build time. A new analyzer band (proposed **`WHIZ130`–`WHIZ139`**, following the `PinnedIdAnalyzer` / `InheritScopeAnalyzer` precedent in `Whizbang.Generators/Analyzers/` and the `DiagnosticDescriptors` banding). These are ordinary Roslyn `DiagnosticAnalyzer` diagnostics, so each one surfaces in **both** places at once — the **IDE** (live squiggle) **and** the **compiler build** (`dotnet build` / `csc` output) — no separate mechanism:

| Diagnostic | Severity | Flags |
|---|---|---|
| **WHIZ130** | **Warning** | A perspective with **mixed-mode `Apply` methods** — a *viral* `Apply(model, ephemeralEvent)` alongside a *normal* `Apply(model, sourcedEvent)` on the same perspective. It can't be both authoritative state and a rebuildable cache. Warning (not error): a warning is the right first signal for an opt-in feature, and the [runtime guard](#the-runtime-guard-backstop) is the hard stop; teams can escalate to error via `.editorconfig` / `TreatWarningsAsErrors`. |
| **WHIZ131** | Error | `rebuild` / `rewind` / `RebuildFromEvents` on an Ephemeral-tainted perspective (`PerspectiveRebuilder.RebuildStreamsAsync`, `SnapshotUpgradePolicy.RebuildFromEvents`) — would silently rebuild to **empty** (no log). |
| **WHIZ132** | Error | Re-emitting an ephemeral event / its payload as a **Sourced** event, or a type escaping an ephemeral base/interface back to Sourced (the one-way promotion boundary). |
| **WHIZ133** | Error | A mixed-mode **stream** (an event of the other mode appended to a homogeneous stream). |
| **WHIZ134** | Error | **Ambiguous [composition](#composition-ephemeral-is-inheritable)** — a type inherits two ephemeral profiles that disagree with no more-specific override to break the tie (resolve with an explicit `[Ephemeral]`). |

Severities are the proposed defaults; every one is tunable per project via `.editorconfig`. The mixed-`Apply` case is a **Warning** by request — visible and actionable without blocking a build — while the boundary/data-loss cases (rebuild-to-empty, laundering, ambiguity) default to **Error** because they corrupt silently.

### Escaping WHIZ130 explicitly: `[DangerouslyAllowMixedEphemeralAndSourcedEvents]`

A team that runs **warnings-as-errors with a no-suppression policy** cannot `#pragma warning disable WHIZ130` or relax it in `.editorconfig` — so without an escape hatch they would be *hard-blocked* from ever intentionally building a mixed-mode perspective. So there is a first-class, in-code one: decorate the perspective with **`[DangerouslyAllowMixedEphemeralAndSourcedEvents]`** and WHIZ130 goes silent — *because the developer has acknowledged the dangerous path, right there in the code*. It survives no-suppression policies, shows up in code review as a named choice, and is trivially greppable. The long, alarming name (à la `dangerouslySetInnerHTML`) is deliberate: nobody types it by accident, and the danger stays visible at the call site.

```csharp{title="Deliberately opting into a mixed-mode perspective" description="The explicit in-code escape hatch that silences WHIZ130 and documents the choice." category="Attributes" difficulty="ADVANCED" tags=["Ephemeral","Analyzer","Perspectives"] framework="NET10"}
// WHIZ130 would warn here — this perspective applies both an ephemeral and a Sourced event.
// The attribute says "I know; I accept this can't be rebuilt from a log and its ephemeral inputs die."
[DangerouslyAllowMixedEphemeralAndSourcedEvents]
public sealed class DeliberatelyMixedProjection
  : IPerspectiveFor<Model, PresencePing>,   // ephemeral (viral)
    IPerspectiveFor<Model, OrderPlaced> {   // Sourced
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

### The runtime guard (backstop)

Not every rule is statically resolvable, so the analyzer and the runtime guard split the work:

- **Compile-time (analyzer):** **WHIZ130** and **WHIZ134** — both decide from type symbols alone (a perspective's applied event set; a type's composed profiles).
- **Runtime guard:** **WHIZ131** (a rebuild/rewind call targets a *string* perspective name, not a type), **WHIZ133** (a stream is a runtime id, not a declaration), and **WHIZ132** (re-emit is dataflow) can't be resolved from symbols. Their real enforcement is the guard: the replay/rebuild entry points (`PerspectiveRebuilder.RebuildStreamsAsync`, `RewindAndRunAsync`) **refuse or redirect to load-from-snapshot** for an ephemeral perspective, and the append path refuses a laundered Sourced event. The guard also backstops the WHIZ130 warning a developer ignores.

Either way, a perspective's effective mode is **derived** — a generator step walks the event→perspective `Apply` edges (the perspective generators already know each perspective's event set), and the runtime resolves "is this perspective ephemeral?" from the same catalog mode the generator stamped — zero reflection on both sides.

## `Destruction.WhenConsumed`: consumption-gated deletion

`WhenConsumed` is E1's first (and simplest) destruction strategy: an ephemeral event self-destructs **once every perspective that cares has consumed it** — modeled on NATS `InterestPolicy` ("gone once handled"). This is the **novel, safe-by-construction guarantee**: every other system *warns* "don't delete before all projections have consumed," but none can enforce it. Whizbang can, because `wh_perspective_cursors` already records each perspective's checkpoint. (It is *consumption-gated*, not literally immediate — the honest reason the value isn't called `Immediate`.)

The reaper **provably withholds physical deletion until every registered perspective's cursor has checkpointed past the event** — a join against `wh_perspective_cursors` via `IPerspectiveCursorResolver`. This directly neutralizes the #1 documented hazard in every event store (rebuild-from-a-deleted-log) and is a real differentiator.

```text
ephemeral event E on stream S
  → dispatched to perspectives P1, P2, P3 (all that Apply its type)
  → each Pi advances wh_perspective_cursors[S, Pi] past E
  → reaper deletes E's transient carrier ONLY when
       min(cursor[S, P1], cursor[S, P2], cursor[S, P3]) is past E
  → until then, E is retained (read-time still sees state; the row just isn't reaped)
```

Deletion is **two-phase** everywhere (the canonical pattern from ES-DB `$maxAge` vs scavenge): **logical expire (read-time filter) is decoupled from physical reap**. The `WhenConsumed` reaper attaches to the existing maintenance surface — `perform_maintenance()` (migration `032`, explicitly "add new maintenance operations here") driven by `MaintenanceWorker` — reusing `PurgeAsync` for the read-model hard delete.

## Event storage: a pointer table + a uniform body table

The reaper's physical target is the **event store**, and reaping there must never compromise the durable/Sourced path — a naive `DELETE FROM wh_event_store` bloats the hot table, contends with autovacuum on the claim path, and amplifies WAL. So the store splits into two tables that separate the **index** from the **payload** — the architecture EventStoreDB (a position index over scavengeable chunk data) and Kafka (an offset index over deletable segments) use internally:

- **`wh_event` — the pointer.** One narrow, append-only row per event, kept forever: `event_id`, `stream_id`, `version`, `commit_sequence`, `event_type`, `created_at`, `flags`, `scope`, `storage_class`. It carries the hot path (claim / ordering / dedup / cross-service sequence) and is the **ordering anchor snapshots stay valid against after a body is reaped**.
- **`wh_event_body` — one uniform body.** `event_id → (event_data, metadata)`, exactly the C# envelope shape. Class-specific data (a temporal occurrence's `scheduleId`, an encrypted payload) already rides the `metadata` JSONB or the `event_data` transform, so **every class is the same body shape** — no per-class columns.

```sql{title="Event store split: pointer + uniform body" description="The narrow append-only index table and the single envelope-shaped body table" category="Design" difficulty="ADVANCED" tags=["Ephemeral","Event Store","Storage"]}
CREATE TABLE wh_event (            -- the pointer: narrow, append-only, forever
  event_id UUID PRIMARY KEY, stream_id UUID NOT NULL, version INTEGER NOT NULL,
  commit_sequence BIGINT, event_type VARCHAR(500) NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0, scope JSONB, storage_class SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (stream_id, version)
);
CREATE TABLE wh_event_body (       -- one uniform body, matches the C# envelope
  event_id UUID PRIMARY KEY, event_data JSONB NOT NULL, metadata JSONB NOT NULL
);
```

**An event's mode is a property, not a location.** `storage_class` lives on the pointer (`0` = Sourced, `1` = Ephemeral, room for temporal / crypto later), so reclassifying an event is a one-row `UPDATE wh_event SET storage_class = …` — the body never moves. Reaping is a gated delete of the body only; the pointer stays:

```sql{title="Consumption-gated body reap" description="Delete only consumed ephemeral bodies; the pointer row stays as the ordering anchor" category="Design" difficulty="ADVANCED" tags=["Ephemeral","Reaper","Consumption Gate"]}
DELETE FROM wh_event_body b USING wh_event p
WHERE b.event_id = p.event_id
  AND p.storage_class = 1                                    -- ephemeral
  AND <every registered perspective's cursor is past p.event_id>;  -- the consumption gate
```

Because the pointer survives, a reaped event reads back as **pointer-present / body-NULL** — the exact deterministic signal the [rebuild guard](#the-runtime-guard-backstop) needs: it knows the event existed and refuses/redirects, instead of silently rebuilding a shorter, wrong history.

**Why one body table, not one per class.** A single uniform table keeps the C# model uniform, makes reclassification a flag flip, and makes cross-class reads a single join — at the cost of `O(1)` partition-drop reclaim and per-class `UNLOGGED`. That cost is a non-issue here: high-churn ephemeral (presence / typing) *does* reach the body table — every event persists + routes — but its bodies are **reaped almost immediately** (consumption-gated + a short grace window), so a row-`DELETE` is healthy and **continuous appends recycle the reaped space, so the table converges to a bounded steady state** (Sourced-forever + a rolling ephemeral working set) rather than growing without bound. The body table just gets aggressive per-table autovacuum, with a rare compaction backstop. (If a persisted-ephemeral workload ever outgrows that, time-partitioning `wh_event_body` is a later, reap-logic-preserving lever — it buys vacuum locality, though not partition-drop, since Sourced rows pin every partition.)

The reaper runs in **two tiers**:

| Tier | Cadence | Does |
|---|---|---|
| **Reap** | ~10 min (`MaintenanceWorker`) | gated `DELETE` of consumed ephemeral **bodies**; pointers stay; `debug_mode`-gated |
| **Deep** | ~monthly, **opt-in (disabled by default) + self-gated** | prune ancient ephemeral **pointers** whose bodies are long gone and are past a retention horizon that can never undercut the dedup window (`GREATEST(pointer retention, dedup retention)`; widen it for cross-service replay windows), **keeping the newest pointer per stream**; `debug_mode`-gated |

Pruning old ephemeral pointers never weakens the guard, because the prune always **keeps the newest pointer per stream** as a tombstone: that one surviving row keeps the stream flagged ephemeral (the runtime rebuild guard detects ephemeral streams by their flagged event-store rows), and it is also the perspective cursor's last-event target — so neither the guard nor the cursor ever dangles, no matter how much ancient history is pruned. A pointer is pruned only when its body is already reaped, it is past the horizon, it has no pending perspective work, and it is not the stream's newest. The deep tier is invoked every maintenance cycle but **self-gates** (an atomic watermark CAS, multi-pod safe) so it actually runs at most once per configured interval; space from the monthly bulk delete is reclaimed by autovacuum — explicit `VACUUM` / `pg_repack` cannot run inside the maintenance transaction and remains an operator runbook step for extreme cases.

**Migration (as landed).** The split arrived as a strangler in three steps rather than one rewrite: first an *additive, ephemeral-only* offload (the body table holds only ephemeral bodies; Sourced stays inline; readers COALESCE body-first with inline fallback), then the *write flip* (every body — Sourced included — goes to the body table, with an idempotent backfill moving historical inline bodies out), and finally the *structural cut*: the pointer table's inline body columns are **dropped**, so nothing can ever write an inline body again. Each step shipped independently green; the reaper and the reap-driven snapshot query were explicitly gated on the ephemeral flag *before* Sourced bodies could enter the body table, so the durable log was never reap-eligible at any point in the transition. In the implementation the pointer keeps the existing `wh_event_store` name and the ephemeral bit on `flags` serves as the storage-class discriminator. Pre-1.0, with no production data to rewrite, was the cheapest possible time to do it.

## Out-of-order arrivals: rewind, the grace window, and ephemeral snapshots

Ephemeral events still arrive **out of order** in a short window (transport reordering, retries, concurrent producers). When a straggler with an earlier `commit_sequence` lands after later events were applied, the perspective must **rewind** — re-apply from the inversion point forward, in the correct order. So rewind is not something to forbid for ephemeral streams; it is *required* for them. This is where **rebuild** and **rewind** part ways:

- **Rebuild-from-zero** re-reads a stream's *entire* history — most of which is legitimately reaped. Never valid for ephemeral; the runtime guard **refuses** it.
- **Rewind** is *bounded* — recent events only. It stays **allowed** for ephemeral, made safe by the two mechanisms below.

### The grace window (keeps the bodies)

An ephemeral body is not reaped the instant it is consumed; it is retained for a **rewind grace window** so an out-of-order straggler still has the bodies it needs to re-apply. The reaper's gate gains a second, age-based condition:

```sql{title: "Reaper gate with the grace window" description: "An ephemeral body is reaped only once it is consumed AND older than the (per-type or global) rewind grace window." category: "Design" difficulty: "ADVANCED" tags: ["ephemeral", "reaper", "rewind", "grace-window"]}
DELETE FROM wh_event_body eb USING wh_event_store es
WHERE es.event_id = eb.event_id
  AND es.created_at < NOW() - (COALESCE(type_grace_seconds, global_grace_seconds) * INTERVAL '1 second')  -- aged past grace
  AND NOT EXISTS (unprocessed wh_perspective_events for the event);                                        -- consumed
```

Grace is **globally configurable** (a `wh_settings` default, **300 s**) and **overridable per type** via `[Ephemeral(RewindGrace = …)]` — the generator stamps the override, a small `event_type → grace` lookup is populated at startup, and the reaper's age test resolves `COALESCE(type, global)` per event. This softens "instant expire" to "expire ~5 min after consumption" for the *body* only (the pointer is untouched). A straggler later than the window loses its reorder — a small, transient, logged inaccuracy, acceptable for data that is explicitly not the durable source of truth; widen the window for a transport that reorders more aggressively.

### Snapshots (the rewind floor)

The grace window keeps recent *bodies*; a rewind also needs a **base state** to rewind *from*, because everything below the reap boundary is gone. That base state is a **snapshot** — and for an ephemeral perspective the snapshot **is** the rewind floor. Four properties:

1. **Its own, more-aggressive cadence.** Ephemeral perspectives snapshot far more often than the standard `SnapshotEveryNEvents` default — **separate ephemeral settings**, because an ephemeral stream must keep a *fresh* floor within its (short) grace window.
2. **Driven by cleanup, not just event count.** The decisive trigger is the reap itself: before a maintenance cycle reaps a `(stream, perspective)`'s consumed, aged-past-grace bodies, it first **drives a snapshot** of that perspective through the reap boundary (a bootstrap snapshot from the current authoritative model). This catches the low-volume / idle stream that would never hit an event-count threshold — the snapshot happens exactly when, and only when, cleanup needs it. No blind timer, and no need for a "reap it anyway past a ceiling" valve that would lose the floor.
3. **Coverage gate (the SQL backstop).** The reaper deletes a body only once every consuming `(stream, perspective)` has a snapshot at/past the event's `commit_sequence` (`snapshot_commit_sequence ≥ es.commit_sequence`), so the reap can never outrun the floor even if the reap-driven snapshot missed a pair.
4. **Single-slot + authoritative.** Only the *latest* snapshot matters (you can never rewind below the reap boundary), so ephemeral prunes to one (`MaxSnapshotsPerStream = 1`); and the snapshot is the source of truth — a new `Authoritative` value on the existing `SnapshotUpgradePolicy` (never `RebuildFromEvents`).

### Why "mixed" perspectives are not a third case

Snapshots (`CreateSnapshotAsync(streamId, perspectiveName, …)` with a `snapshot_commit_sequence` anchor), cursors, and rewind are all keyed **per-`(stream, perspective)`**, and streams are **homogeneous** (all-Sourced or all-Ephemeral). So ephemeral-ness is a **per-stream** property, and the policy is per-stream:

| `(stream, perspective)` | Replay floor | Snapshots | Rebuild-from-zero |
|---|---|---|---|
| **Sourced stream** | event zero | optional (perf cache) | allowed |
| **Ephemeral stream** | latest snapshot | mandatory · frequent · single-slot · authoritative | refused |

A "mixed" perspective is simply one that touches some ephemeral streams **and** some sourced streams; each `(stream, perspective)` pair runs its own policy independently. There is no special mixed plumbing — the existing per-stream granularity plus the homogeneous-stream invariant does the work, so **normal, mixed, and ephemeral perspectives all flow through one mechanism** that branches on a single per-stream bit. *(One edge: a **collective** perspective — the `__collective__` sink folding many streams into one shared model — is not per-stream and needs its own snapshot story; rare, handled separately.)*

## Transient storage: where the read model lives (developer picks)

This axis chooses only the **perspective store** strategy — it is **orthogonal** to ephemeral-ness and does **not** change how the event is delivered.

> **The event is always DB-persisted and routed.** Whizbang's delivery is DB-mediated: an instance writes its inbox rows to the database, which assigns each to the stream's owning instance (`wh_active_streams`, stream affinity), and the owner drains it. That hand-off *is* the delivery mechanism, so an ephemeral event **cannot** skip the store and still reach the right instance — there is no `Route.LocalNoPersist` path for anything that feeds a stream-routed perspective. The event-store side is the consumption-gated ephemeral substrate (offloaded body, reaped once consumed + aged, above). This axis is purely about the **read model** built from that event.

| Storage | How | Survives an instance change? | Use |
|---|---|---|---|
| **`PersistedRow`** *(default)* | a normal, persisted `wh_per_*` row — **no expiry**; the row *is* the authoritative source of truth for a `WhenConsumed` stream | Yes — restart- and rebalance-safe, lens-queryable | the safe general choice |
| **`InMemory`** | hold the model in `InMemoryUpsertStrategy` (per-instance RAM) *after* the DB routes the event to the owner + realtime push | **No** — silently lost on rebalance / restart, and an ephemeral stream can't rebuild | presence / typing / cursor **only** — self-heals from the next ping |
| **`TtlRow`** | a `wh_per_*` row with an `expires_at` marker — like `PersistedRow` but the row itself ages out | Yes — restart-safe, lens-queryable | chat thread state, session layout |

All three are read through the existing `ILensQuery` path — **the read side is unaffected**; it already reads only `wh_per_*` rows. The **default is `PersistedRow`** (a bare `[Ephemeral]` / `IEphemeralEvent`): the perspective row persists like any other, which is exactly what a `WhenConsumed` stream wants — its *events* self-destruct, its *row* is the durable result. `InMemory` is a deliberate opt-in and a narrow presence-only optimization — not a way to avoid persistence: it trades the `wh_per_*` write for RAM, accepting that a rebalance wipes the model (fine for presence, a data-loss footgun otherwise). `TtlRow`'s *expiry duration* comes from the TTL machinery (`Destruction.AfterTtl`, phase E2), so its row-expiry half lands with E2. None of the three is enforced at runtime yet — perspectives already persist a `wh_per_*` row today, which is the `PersistedRow` behavior; the explicit modes light up when the store strategy is wired in E2.

## Keeping it alive: renew, defer, hold

Destruction is **not one-way** — a deadline can be moved, or lifted. This is deliberate: a live session, an active presence, an in-progress draft should stay alive as long as it's being used. Because ephemeral death (`expires_at`) is the [Temporal Engine](temporal-engine)'s other end, these operations are the **death-side twin of the birth-side controls the temporal engine already ships** (`IScheduleManager` create / update / `trigger-now` / cancel; `wh_update_schedule`; `wh_defer_occurrence`) — the same durable temporal row, the same arm-on-mutation doorbell, so a keep-alive is just a DB mutation + a signal, exactly like re-arming a schedule:

- **Renew / extend** — push the deadline out: `Renew(ttl)` ⇒ `expires_at = now + ttl` (sliding expiration — the "touch-on-access / still-here heartbeat" pattern, cf. Redis `EXPIRE`). Idempotent; re-arming just moves the deadline.
- **Set a new expiry** — pin a specific instant: `ExpireAt(when)`.
- **Hold / release** — keep it alive until explicitly released (`Hold()` / `Release()`) — even a `WhenConsumed` event that every perspective has already consumed. (An unbounded hold is a leak the developer owns — observable via metrics, the same caveat as declining a destruction.)
- **Defer at the boundary** — the E2 `PreDestruction` hook receives the imminent destruction and may return `Defer(newDeadline)` — "not yet." The same decision reached *reactively* rather than proactively.

**A keep-alive is scoped to the copy it acts on** — the direct consequence of [no global purge coordination](#crossing-service-boundaries-transport). Three rules fall out:

- A change made **before emit** is stamped into the [envelope metadata](#crossing-service-boundaries-transport) and travels — it becomes each downstream service's **initial** deadline.
- A change made **after transport** — in the origin *or* any receiver — affects only **that service's** copy. Peers are not notified, and none is promised (the deadline is advisory across the wire, like the ephemeral color itself).
- **Every service may manipulate its own copy independently.** Consumer sovereignty extends to the lifecycle, not just first-touch handling: a receiver renews, holds, or expires what it holds on its own terms, without coordinating with the origin. This is the natural model — each service knows whether *its* users/perspectives still need the data; the origin can't.

The `expires_at` the [reaper](#destructionwhenconsumed-consumption-gated-deletion) reads is authoritative *for that service*, so a local renew that lands before the local reap wins — the two-phase split (logical expire vs physical reap) leaves a safe window for the extension to take effect. Phasing: the proactive renew/extend/set API and the `PreDestruction` `Defer` ride the time-based strategies and land with **`AfterTtl` (E2)**; E1's `WhenConsumed` ships **hold / release** (a pin against the consumption-gate).

## Crossing service boundaries (transport)

**An ephemeral event is not confined to the emitting service** — a published one (e.g. a TTL-row ephemeral, or any ephemeral event routed to the outbox rather than `Route.LocalNoPersist`) travels over the transport like any other, and the downstream service **uses and destructs it there too**. What crosses is *color, not coordination*:

- **Virality crosses the wire by default.** The ephemeral mode + its `Destruction`/storage config ride the envelope as **structured, named metadata** (self-describing and version-robust across service/version boundaries — deliberately *not* a bare `EventFlags` bit, though a coarse flag may accompany it as a cheap hint). A receiver that projects the event derives **ephemeral** read-state too, and runs its **own** local self-destruct (its own consumption-gate / TTL) — the same safe-by-construction model, applied independently on each side.
- **Consumer sovereignty.** A receiving service **may override** handling at its receive boundary (inbox dispatch / `IInboundEnvelopeInterceptor`, configured via `EphemeralOptions`) — treat it as fire-and-forget, apply its own policy, or (subject to the [no-laundering rule](#ephemeral-is-viral-it-taints-derived-read-state)) decline it. Each service owns its local copy's lifecycle.
- **In-process is strong; cross-wire is advisory.** Within a process the consumption-gate sees *every* local perspective cursor, so the guarantee is exact. Across the wire it is **advisory metadata + per-service policy**: there is **no global purge coordination**, and none is promised — which is fine, because an ephemeral event is *never the durable source of truth* anywhere. Each service's copy self-destructs on its own terms.

This is why the wire carrier is structured metadata rather than a bitmask: a downstream on a different version must still read "this is ephemeral, `WhenConsumed`" without the compiled contract.

### A shared carrier, not an ephemeral one-off

Translating a **declared behavior** into structured envelope metadata so it travels and is honored cross-service is a **general Whizbang mechanism**, not ephemeral-specific. F2 already rides it — a scheduled occurrence carries its `scheduleId` / `deliveryGuarantee` / `authorityPrincipalId` / `authorityClaims` in the same envelope metadata — and future declared behaviors can too. So ephemeral **joins** an existing pattern: one metadata carrier, one place a receiver looks to learn how a message wants to be treated, whether that message is a scheduled occurrence, an ephemeral trigger, or both. (An occurrence *can* be ephemeral — the two colors are orthogonal and compose on the same envelope.) The E1 work factors the ephemeral keys onto that shared carrier rather than adding a new one.

## Scope: what E1 does (and does not) cover

**E1 delivers:** the `[Ephemeral]` attribute + mode on `MessageTypeCatalog`; the runtime `IEphemeralModeResolver`; viral perspective-mode derivation; the analyzer + runtime guards; the **event-store split** (`wh_event` pointer + uniform `wh_event_body`) + migration; **`Destruction.WhenConsumed`** consumption-gated body reaping (the two-tier maintenance); in-memory / TTL-row transient storage. It proves the model on the presence/UI case and consumes the [Signal Bus](../fundamentals/signal-bus/signal-bus).

**Deliberately deferred to later phases** (each its own proposal):

- **Destruction hooks + TTL (E2)** — `Pre/PostDestruction` lifecycle stages, dispositions (Delete / Archive / Compact / Shred), the TTL-halving failure ladder, and `expires_at` + two-phase reaper as a general strategy.
- **Archival / compaction (A1)** — "closing the books" for durable **Sourced** streams (domain-authored carry-forward + gated truncate/archive).
- **Carry-forward / Tier-2 (E3)** — `Compacted<T>` ephemeral summary as authority, document-style per-record versioning.
- **GDPR / subject-scoped crypto data-protection (G1)** — crypto-shredding for durable data (a *separate* mechanism: Sourced → crypto-shred, Ephemeral → delete).

## Related Documentation

- Temporal Engine — the `expires_at` (death) side of the same time engine an ephemeral TTL will consume in E2.
- System Signal Bus — the doorbell transport the reaper and destruction-due signals ride on.
- Perspectives & Projections — the read models that become authoritative under Ephemeral.
