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

- **`Route.LocalNoPersist`** / **`DispatchModes.LocalNoPersist`** (`Dispatch/Route.cs`, `Dispatch/DispatchMode.cs`) — `LocalNoPersist == LocalDispatch` deliberately omits the `EventStore` bit, so the dispatcher (`Dispatcher._dispatchByModeAsync`) invokes in-process receptors but **never** appends to `wh_event_store`. The existing "dispatch, don't persist" path an in-memory ephemeral event rides on.
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

## Transient storage: in-memory or a TTL'd row (developer picks)

Where the authoritative ephemeral *state* lives is **orthogonal** to ephemeral-ness, chosen per perspective:

| Storage | How | Survives restart? | Use |
|---|---|---|---|
| **In-memory** | reuse `InMemoryUpsertStrategy` (`InMemoryDriverExtensions`) + realtime push | No | presence / typing / cursor — losing it is fine |
| **TTL'd `wh_per_*` row** | a normal perspective row with an `expires_at` marker | Yes | chat thread state, session layout — lens-queryable, restart-safe |

Both are read through the existing `ILensQuery` path — **the read side is unaffected**; it already reads only `wh_per_*` rows. An in-memory ephemeral event is routed through `Route.LocalNoPersist` (dispatch-only, no event-store append); a TTL'd one may still publish, flagged ephemeral.

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

**E1 delivers:** the `[Ephemeral]` attribute + mode on `MessageTypeCatalog`; viral perspective-mode derivation; the analyzer + runtime guards; **`Destruction.WhenConsumed`** consumption-gated deletion; in-memory / TTL-row transient storage. It proves the model on the presence/UI case and consumes the [Signal Bus](../fundamentals/signal-bus/signal-bus).

**Deliberately deferred to later phases** (each its own proposal):

- **Destruction hooks + TTL (E2)** — `Pre/PostDestruction` lifecycle stages, dispositions (Delete / Archive / Compact / Shred), the TTL-halving failure ladder, and `expires_at` + two-phase reaper as a general strategy.
- **Archival / compaction (A1)** — "closing the books" for durable **Sourced** streams (domain-authored carry-forward + gated truncate/archive).
- **Carry-forward / Tier-2 (E3)** — `Compacted<T>` ephemeral summary as authority, document-style per-record versioning.
- **GDPR / subject-scoped crypto data-protection (G1)** — crypto-shredding for durable data (a *separate* mechanism: Sourced → crypto-shred, Ephemeral → delete).

## Related Documentation

- Temporal Engine — the `expires_at` (death) side of the same time engine an ephemeral TTL will consume in E2.
- System Signal Bus — the doorbell transport the reaper and destruction-due signals ride on.
- Perspectives & Projections — the read models that become authoritative under Ephemeral.
