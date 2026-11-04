---
title: System Signal Bus
pageType: concept
category: Architecture & Design
order: 20
tags: signal-bus, notifications, listen-notify, control-plane, rebalance, instance-lifecycle, reliability
version: 1.0.0
description: >-
  The in-process signal bus the framework's own components use to wake each other, and the targets
  a signal can be addressed to.
codeReferences:
  - src/Whizbang.Core/Signals/ISignalBus.cs
  - src/Whizbang.Core/Signals/SignalBus.cs
  - src/Whizbang.Core/Signals/SignalBusOptions.cs
  - src/Whizbang.Core/Signals/SignalBusServiceCollectionExtensions.cs
  - src/Whizbang.Core/Signals/SignalBusHostedService.cs
  - src/Whizbang.Core/Signals/SignalTarget.cs
  - src/Whizbang.Core/Signals/InstanceLifecycleSignals.cs
  - src/Whizbang.Core/Signals/WorkAvailableSignals.cs
  - src/Whizbang.Core/Signals/CoordinationSignals.cs
  - src/Whizbang.Core/Signals/IPayloadSignal.cs
  - src/Whizbang.Core/Signals/ISignalTopicTransport.cs
  - src/Whizbang.Data.Postgres/Notifications/PgSignalWire.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresSignalTransport.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDurableSignalTailWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/330_CoordinationOnTheSignalBus.sql
  - src/Whizbang.Data.Postgres/Notifications/PgWorkAvailablePollSourceBase.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Signals/SignalBusProbeBackoffTests.cs
  - tests/Whizbang.Core.Component.Tests/Signals/SignalBusHostingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageWiringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupPreflightHostTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgDurableSignalRetentionWindowTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgDurableSignalRetentionIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/SignalPartitionCarryForwardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgWorkAvailablePollSourceSchemaGateTests.cs
  - tests/Whizbang.Core.Tests/Signals/CoordinationSignalsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CoordinationSignalsSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresSignalTransportUnitTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/CoordinationSourceGuardTests.cs
---

# System Signal Bus

Whizbang's control plane — waking the work pump, arming scheduled timers, reacting to rebalances and instance failures — is coordinated by lightweight **signals** delivered over PostgreSQL `LISTEN`/`NOTIFY` with a polling fallback. The **System Signal Bus** unifies these into one typed, multicast, developer-extensible abstraction (`ISignalBus`) built on a **doorbell-not-data** discipline and a **hybrid reliability** model: best-effort signals for low latency, a durable log for the few signals that must not be missed, and periodic reconciliation as the correctness backstop.

:::planned
The System Signal Bus is a foundational capability. **The core (F1) is implemented (unreleased):** the
transport-agnostic bus, the cross-assembly signal-type registry + generator (with `[WireName]`), the
Postgres push transport (broadcast **and** targeted) plus polling pull-sources, the durable `wh_signals`
log, the instance-lifecycle signals, and the work-pump migration onto the bus are all in place. It
**generalizes the existing `Whizbang.Core/Notifications` subsystem** rather than replacing it — current
behavior is preserved (the existing notification regression suite stays green throughout). Signals that
belong to later phases (scheduling, destruction, rebalance, commit-order) are noted as *planned* below.
:::

## Motivation

Before the bus, the control plane used `LISTEN`/`NOTIFY` in several *bespoke, per-use* wirings: an instance-routed work-availability channel (`wh_work_i_<id>`), a commit-order channel (`wh_committed`), a role-release channel (`wh_role_released`), a partition-assignment channel (`wh_partition_assignment`), a multi-stream run channel (`wh_multi_stream_work`), and an app-facing pub/sub channel family (`wh_app_<topic>`). Each had its own producer, subscriber, and fallback logic. Every one of them is now a signal on the bus (see [Coordination signals](#coordination-signals)). Cluster events (a partition **rebalance**, an instance **joining**, an instance **dying**) are handled implicitly inside individual workers rather than surfaced as first-class events that *any* subsystem (or the application developer) can react to.

The Signal Bus makes that control plane **one typed, multicast bus**:

- **Typed & multicast** — publish a `TSignal`; any number of internal or developer subscribers receive it.
- **Foundational** — the work pump, the temporal engine (scheduled/recurring events), and the ephemeral reaper all become *consumers* of the same bus.
- **Extensible** — developers subscribe to system signals ("on rebalance, warm my cache") and publish their own.

## What exists today

The bus builds directly on the mature `Whizbang.Core/Notifications` subsystem:

| Existing abstraction | Role | Becomes |
|---|---|---|
| `INotifySubscription` / `ISharedNotifyConnection` | multiplexed `LISTEN` over one connection | bus transport (subscribe primitive) |
| `NotifySubscriptionRegistry` | channel → subscribers multicast map | bus subscriber registry |
| `IWorkNotificationListener` + `WorkSignalCategory` | category-typed multicast of work signals | typed `WorkAvailable` signals |
| `INotifySignalingGate` | availability killswitch + reconnect | bus health + reconciliation trigger |
| `IAppSignalChannel` (`wh_app_<topic>`) | app-facing string pub/sub | the bus itself: `SignalBus` implements `IAppSignalChannel`, and its Postgres transport carries each topic (see [App signals](../work-coordinator/app-signals)) |
| `PgSharedNotifyConnection` | the **one direct connection per pod** (self-test probe, alive-lock) | bus Postgres transport |

Signals are delivered on Postgres channels: `wh_signal_broadcast`, `wh_work_i_<instance_id>` (instance-routed via `notify_instance_owners`, resolving stream → owner from `wh_active_streams.assigned_instance_id`), the four [coordination channels](#coordination-signals), and `wh_app_<topic>`. The bus's Postgres transport is the only subscriber to the shared connection, and apart from that connection's own self-test probe nothing else in the library issues `LISTEN`. Unowned work is spread across instances by partition, by the [partition assignment](../work-coordinator/partition-assignment) the elected assigner publishes.

## Design principles

### Doorbell, not data

A signal says **"go look"** — it never carries authoritative payload. On receipt, a subscriber fetches the current state from the database (the source of truth). This removes any dependence on delivery ordering or payload freshness, and means a *lost* signal only ever costs latency, never correctness.

### Push and pull are the same bus

Signals reach subscribers through pluggable **signal sources**, and **polling is a first-class source, not a bolt-on fallback**:

- **Push source** (`NOTIFY`/`LISTEN`) — raises a signal the moment a producer notifies.
- **Pull source** (polling) — periodically runs a detection query against authoritative state and, on a change, **raises the *same* typed signal locally** — exactly as if a NOTIFY had arrived.

Both feed the **same multicast dispatch**, so subscribers are identical and **transport-agnostic**. Because signals are **doorbell-not-data**, it doesn't matter whether a signal was pushed or discovered by a poll — the subscriber fetches current state from the DB either way, and a duplicate signal is harmless (idempotent). This unifies what used to be two mechanisms (NOTIFY plus ad-hoc per-worker reconciliation loops) into one design: **the pull source for a signal type *is* its reconciliation.**

```csharp{title="ISignalSource — push and pull transports feed one bus" description="Both NOTIFY-push and polling-pull raise the same typed signals into the same multicast dispatch" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Transport","Polling"] framework="NET10"}
// A source raises signals INTO the bus. NOTIFY and polling are both sources.
public interface ISignalSource {
    // Begin producing signals (LISTEN, or start the poll loop). Raised signals
    // go through the bus's multicast dispatch — subscribers can't tell which source.
    Task StartAsync(ISignalSink sink, CancellationToken ct);
}

// A pull source detects a condition on an interval and raises the equivalent signal.
public interface IPollSignalSource<TSignal> : ISignalSource where TSignal : ISignal {
    // Interval is managed by the bus: relaxed when NOTIFY is healthy, tight when it
    // is down, and sole transport where NOTIFY is unavailable.
    ValueTask<bool> DetectAsync(CancellationToken ct);  // true -> raise TSignal
}
```

**Transports are injected implementations.** `ISignalSource` / `ISignalTransport` are ordinary DI registrations — the framework ships a **Postgres NOTIFY push transport**, a **polling pull transport**, and an **in-memory transport**, and **anyone can register their own** (a different broker, a test double). The bus itself is transport-ignorant. Each transport exposes **hooks** (connect · publish · receive · fallback-transition) for observability and customization.

This makes the bus **trivially testable**: unit tests inject the **in-memory transport** — no Postgres, no `LISTEN`/`NOTIFY`, fully deterministic — and drive signals directly, asserting subscriber reactions through the hooks and **completion signals** (never `Task.Delay`/timing). Integration tests swap in the Postgres transport to exercise the real `wh_work_i_<id>` / `wh_committed` / `wh_app_<topic>` channels.

### Delivery classes (hybrid reliability)

Most signals are **best-effort** (doorbell + reconciliation). A small set — e.g. *instance-died* triggering orphan takeover — are **must-not-miss** and additionally write to a **durable signal log** (`wh_signals`) that instances tail with a cursor. Each signal type declares its delivery class:

```csharp{title="Signal delivery class" description="Per-signal-type reliability selection: best-effort doorbell vs durable log" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Reliability","Control-Plane"] framework="NET10"}
public enum SignalDeliveryClass {
    // Fire over NOTIFY; correctness comes from the per-type reconciliation backstop.
    BestEffort = 0,

    // ALSO persisted to wh_signals and tailed with a cursor — guaranteed delivery
    // for signals that must never be missed (e.g. InstanceDied -> orphan takeover).
    Durable = 1,
}
```

### Targeting: instance-routed vs broadcast

Signal types choose their reach:

- **Targeted** (e.g. work-available, schedule-armed) — routed to the owning instance's channel (`wh_work_i_<id>`), so only the owner wakes.
- **Broadcast** (e.g. rebalance, instance-lifecycle) — every instance receives it and reacts.

The signal type's `Targeting` declaration is compile-time authority; the publish call carries a `SignalTarget` that says *which* target for a **Targeted** signal (which streams' owners to wake, or which instance directly). Broadcast signals default their target to `SignalTarget.Broadcast` — no extra parameters needed at the call site.

Under the covers, `SignalTarget.Streams(...)` calls `notify_instance_owners_with_payload(kind, payload, stream_ids)`, the general form of the SQL helper whose doorbell form (`notify_instance_owners(payload, stream_ids)`) today's `_emit_event_store_chain`, `store_outbox_messages`, and `store_inbox_messages` procs invoke — so the routing rule is **unified**: pinned owner from `wh_active_streams`, or the deterministic partition-modulo target for streams that haven't been claimed yet. `SignalTarget.Instance(id)` emits `pg_notify` directly on `wh_work_i_<id>`.

The two forms exist because the doorbell debounce keys its state on a **kind** while the wire carries a **payload**. For a doorbell the two coincide by definition (`outbox`, `inbox`, `perspective`, `schedule`), and the doorbell form accepts only that vocabulary. A signal carries its wire name (by default the fully qualified type name) as both its key and its payload, so it needs the general form; a signal's debounce row is never armed by `claim_work`, so a signal is never suppressed. {verified: NotifyKindAndPayloadSqlTests.NotifyInstanceOwners_SignalWireNameLongerThanTwentyCharacters_FiresAsync, NotifyKindAndPayloadSqlTests.NotifyInstanceOwners_DoorbellForm_AcceptsOnlyTheDoorbellVocabularyAsync, PostgresSignalTransportIntegrationTests.StreamsTargetedSignal_WithAFullyQualifiedWireName_RoutesToTheOwningInstanceAsync}

```csharp{title="SignalTarget — per-publish target selector" description="Structured target for a publish call: broadcast (default), streams (owner resolved via notify_instance_owners), or instance (direct)" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Targeting","Control-Plane"] framework="NET10"}
/// <docs>fundamentals/signal-bus/signal-bus</docs>
public readonly struct SignalTarget {
    // No target — every instance's broadcast channel. Default value.
    public static SignalTarget Broadcast => default;

    // Resolve the owning instance(s) via notify_instance_owners_with_payload(kind, payload, stream_ids).
    // One NOTIFY per unique owner, exactly like today's work-wake fan-out.
    public static SignalTarget Streams(IReadOnlyList<Guid> streamIds);

    // Direct-route to a specific instance's channel: wh_work_i_<instanceId>.
    // Used when the caller already knows the target (e.g. instance-lifecycle triggers).
    public static SignalTarget Instance(Guid instanceId);

    public SignalTargetKind Kind { get; }
}

public enum SignalTargetKind {
    Broadcast = 0,
    Streams   = 1,
    Instance  = 2,
}
```

A publish call must supply a target whose `Kind` matches the signal type's static `Targeting` — a `Broadcast` signal with a `Streams`/`Instance` target throws, and a `Targeted` signal with `Broadcast` throws. Mismatches are programmer errors, not silent no-ops (correctness > convenience for the control plane).

## The `ISignalBus` abstraction

```csharp{title="ISignalBus" description="Typed, multicast publish/subscribe over the notification transport with a polling fallback" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Pub-Sub","Control-Plane"] framework="NET10"}
/// <docs>fundamentals/signal-bus/signal-bus</docs>
public interface ISignalBus {
    // Publish a control-plane signal. Doorbell semantics: no authoritative payload.
    // `target` defaults to Broadcast — Targeted signals must pass Streams or Instance.
    ValueTask PublishAsync<TSignal>(
        TSignal signal,
        SignalTarget target = default,
        CancellationToken ct = default)
        where TSignal : ISignal;

    // Subscribe a fast, non-blocking handler. Returns a handle; dispose to unsubscribe.
    ISignalSubscription Subscribe<TSignal>(Func<TSignal, ValueTask> handler)
        where TSignal : ISignal;
}

// Marker for all control-plane signals. Declares delivery class + targeting.
public interface ISignal {
    static abstract SignalDeliveryClass DeliveryClass { get; }
    static abstract SignalTargeting Targeting { get; }
}
```

Handlers follow the **enqueue-and-return** contract (see [Hot-path constraints](#hot-path-constraints)): they must not block, because dispatch runs on the shared notify connection's loop.

## Signal catalog

Built-in control-plane signals (developers can add their own — see below).

**Implemented (F1):**

| Signal type | Wire-name | Targeting | Delivery | Reconciliation backstop |
|---|---|---|---|---|
| `WorkOutboxAvailableSignal` | `outbox` | targeted | best-effort | adaptive claim poll |
| `WorkInboxAvailableSignal` | `inbox` | targeted | best-effort | adaptive claim poll |
| `WorkPerspectiveAvailableSignal` | `perspective` | targeted | best-effort | adaptive claim poll |
| `InstanceJoinedSignal` | `instance-joined` | broadcast | best-effort | heartbeat scan |
| `InstanceLeavingSignal` | `instance-leaving` | broadcast | best-effort | heartbeat scan |
| `InstanceDiedSignal` | `instance-died` | broadcast | **durable** | stale-instance cleanup |
| `RoleReleasedSignal` | `role-released` | broadcast | **durable** | the holder loop's renew interval |
| `PartitionAssignmentPublishedSignal` | `partition-assignment-published` | broadcast | **durable** | a claim that reports its copy stale |
| `RowsCommittedSignal` | `committed` | broadcast | best-effort | the stamper's backstop tick |
| `MultiStreamWorkSignal` | `multi-stream-work` | broadcast | best-effort | the multi-stream worker's poll |
| `WorkOrphanedSignal` | `orphan` | targeted | best-effort | the claim loop's poll |
| `DeadLetterReadySignal` | `deadletter` | targeted | best-effort | the dead-letter recovery worker's poll |

The last six are the [coordination signals](#coordination-signals): the channels that used to be wired by hand.

The three `Work…AvailableSignal` wire-names (`outbox` / `inbox` / `perspective`) are deliberately identical
to the SQL payloads `notify_instance_owners` and the store procs already emit — so the existing work-wake
NOTIFYs are received *as bus signals* with **no SQL change** (see [Migration](#migration-unify-now)).

**Planned (later phases):**

| Signal | Targeting | Delivery | Phase |
|---|---|---|---|
| `ScheduleArmed` / `ScheduleChanged` | targeted | best-effort | temporal engine (F2) |
| `DestructionDue` | targeted | best-effort | ephemeral reaper (E2) |
| `RebalanceOccurred` | broadcast | best-effort | future |
| `CommitCompleted` | broadcast | best-effort | future |

## Instance-lifecycle signals

Instance lifecycle rides the existing heartbeat/lease/alive-lock machinery (`wh_service_instances`, `register_instance_heartbeat`, `claim_instance_alive_lock`, `cleanup_stale_instances`) and surfaces it as bus signals — published by the heartbeat worker and a `PgInstanceLifecycleMonitor`:

- **`InstanceJoinedSignal`** — first heartbeat registers the instance.
- **`InstanceLeavingSignal`** — graceful shutdown (via `deregister_instance`).
- **`InstanceDiedSignal`** — ungraceful loss detected by lease/heartbeat expiry (`cleanup_stale_instances`); **durable** (persisted to `wh_signals`) because it drives orphan takeover and must never be missed.

## Developer-defined signals

Applications define their own signals as plain `ISignal` types. The signal-type **generator discovers them
across the whole dependency chain** (each assembly self-registers via a `[ModuleInitializer]`), and the bus
routes them exactly like built-in signals — broadcast over `wh_signal_broadcast`, targeted over
`wh_work_i_<id>`. No string topics, no manual wiring. The optional **`[WireName]`** attribute overrides the
default wire-name (the fully-qualified type name) when you need to match a fixed external format — this is
how the three `Work…AvailableSignal` types map onto the legacy `outbox`/`inbox`/`perspective` payloads.

```csharp{title="Custom developer signal" description="Applications define their own typed control-plane signals; the generator collects them and the bus routes them like built-in signals" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Extensibility"] framework="NET10"}
[WireName("cache-invalidated")]   // optional — defaults to the fully-qualified type name
public readonly record struct CacheInvalidated : ISignal {
    public static SignalDeliveryClass DeliveryClass => SignalDeliveryClass.BestEffort;
    public static SignalTargeting Targeting => SignalTargeting.Broadcast;
}

// Publish it (broadcast is the default target):
await signalBus.PublishAsync(new CacheInvalidated());

// React to any signal — built-in or your own:
using var sub = signalBus.Subscribe<CacheInvalidated>(async _ => {
    await warmLocalCachesAsync();   // fetch fresh state from the DB (doorbell-not-data)
});
```

The string-topic `IAppSignalChannel` (`wh_app_<topic>`) stays for non-typed app messaging, and it is the same
bus: `SignalBus` implements it and hands each topic to every transport that carries topics
(`ISignalTopicTransport`), so a topic travels on the same connection as the framework's own signals. See
[App signals](../work-coordinator/app-signals).
{verified: SignalBusAppTopicTests.Publish_HandsTheTopicToEveryTopicTransportAsync, SignalBusAppTopicTests.Subscribe_RegistersWithEveryTopicTransport_AndDisposingReleasesEachAsync}

## Reliability & the durable log (`wh_signals`)

Durable-class signals (e.g. `InstanceDiedSignal`) are appended to **`wh_signals` (`wire_name`, `target_instance_id`, and since migration 330 `payload`) before the NOTIFY is emitted**, so the signal survives connection loss: each instance **tails the log from a persisted cursor** and re-delivers anything the fast-path NOTIFY dropped. Best-effort signals stay purely in-memory-fast (no row written). A **retention-sweep worker** trims the log once every instance's tail cursor has advanced past a row. Reconciliation reads the DB directly, so even a total NOTIFY outage degrades only to bounded-latency polling, never to lost work.

### Retention {#retention}

{verified: PgDurableSignalRetentionWindowTests.Sweep_UsesTheConfiguredWindowAsync, PgDurableSignalRetentionWindowTests.Sweep_DeletesInBatches_UntilNothingIsLeftAsync, PgDurableSignalRetentionWindowTests.Sweep_NeverPassesTheSlowestCursorAsync, PgDurableSignalRetentionIntegrationTests.Sweep_ACursorWhoseInstanceIsNoLongerRegistered_DoesNotHoldBackTheSweepAsync, PgDurableSignalRetentionIntegrationTests.Sweep_ARegisteredInstancesCursor_StillHoldsBackTheSweepAsync, PgDurableSignalRetentionIntegrationTests.Sweep_WithOnlyCursorsOfUnregisteredInstances_DeletesNothingAsync, SignalPartitionCarryForwardTests.ALiveInstanceBehindTheWindow_KeepsEveryUnconsumedSignalAcrossTheDrop_AndReceivesThemInOrderAsync, SignalPartitionCarryForwardTests.ADeadInstancesCursor_CarriesNothing_AndThePartitionIsDroppedAsync}

The retention sweep runs hourly and deletes a signal when it is older than `SignalRetention` **and** every **live** instance's cursor has passed it. A signal some live instance has not yet delivered is kept whatever its age, and nothing is deleted while no live instance has a cursor. Deletes run in batches until a batch comes back short, so a large backlog is cleared in one cycle without one long delete.

An instance is live while it is registered in `wh_service_instances`, the same rule the partition carry below uses. An instance that stopped without being reaped leaves its cursor behind; that cursor no longer holds the sweep back, so the log does not grow while the instance waits for the stale-instance reap.

| Setting | Default | Environment variable |
|---|---|---|
| `Whizbang:Database:SignalRetention` | `7.00:00:00` | `Whizbang__Database__SignalRetention` |

A window of zero or less is rejected at startup, naming the key.

With [partition maintenance](../../operations/infrastructure/partitioned-ledgers#signals) enabled, `wh_signals` is
partitioned daily by `created_at` and a day is dropped whole once it ends more than `SignalRetention` ago. The sweep
then clears only the default partition. Before a day is dropped, the signals a **live** instance has not consumed
(an id past the slowest live instance's cursor) move into the current day, keeping their ids, so that instance's tail
still delivers them, in order. An instance is live while it is registered; once the stale-instance reap removes a
dead instance, its cursor holds nothing back. A moved signal starts a fresh `SignalRetention` window.

## Coordination signals {#coordination-signals}

Every channel instances coordinate on is a signal on the bus ([#2046](https://github.com/whizbang-lib/whizbang/issues/2046)).
The bus alone issues `NOTIFY` and `LISTEN`: a feature publishes or subscribes a typed signal, and the bus's Postgres
transport owns the wire. A coordination signal is one of two kinds:

- **A decision** says something changed that the hearer must act on: a role was released, an assignment was
  published. A decision is **durable**.
- **A doorbell** says "go look", and a poll stands behind it. A doorbell is **best-effort**.

| Channel (payload) | Publisher | Subscriber | Kind | Signal |
|---|---|---|---|---|
| `wh_role_released` (the role) | `wh_release_role` | [the holder loop](../../operations/startup/capabilities-and-duties#the-holder-loop), [the commit-order stamper](../work-coordinator/commit-sequence#leadership) | decision | `RoleReleasedSignal`, durable |
| `wh_partition_assignment` (`epoch:revision`) | `wh_publish_partition_assignment` | [the claimers' assignment cache](../work-coordinator/partition-assignment#cost) | decision | `PartitionAssignmentPublishedSignal`, durable |
| `wh_committed` (none) | the store procedures, after commit | [the commit-order stamper](../work-coordinator/commit-sequence) | doorbell; the stamper's backstop tick polls | `RowsCommittedSignal`, best-effort |
| `wh_multi_stream_work` (the run id) | `wh_record_multi_stream_run` | [the multi-stream worker](../dispatcher/multi-stream-commands#worker) | doorbell; the worker polls | `MultiStreamWorkSignal`, best-effort |
| `wh_work_i_<instance>` (`orphan`) | the reap, `cleanup_stale_instances` | the work listener | doorbell | `WorkOrphanedSignal`, best-effort |
| `wh_work_i_<instance>` (`deadletter`) | the dead-letter insert trigger | the work listener | doorbell | `DeadLetterReadySignal`, best-effort |
| `wh_work_i_<instance>` (`outbox`, `inbox`, `perspective`) | the doorbell queue | the work listener | doorbell | the `Work…AvailableSignal` types, best-effort |
| `wh_app_<topic>` (yours) | application code | application code | pub/sub | [`IAppSignalChannel`](../work-coordinator/app-signals), which is the bus |

A signal that carries a payload implements `IPayloadSignal<TSelf>`: it names the one fact its subscriber needs (which
role, which version) and rebuilds itself from that text through its own static factory, so the transport and the tail
need no reflection. It is still a doorbell in spirit: the payload names what changed, and the database stays the
authority on what it now is.
{verified: CoordinationSignalsTests.Decisions_AreDurableBroadcastsAsync, CoordinationSignalsTests.Doorbells_AreBestEffortAsync, CoordinationSignalsTests.PayloadSignals_CarryTheirPayloadBothWaysAsync, CoordinationSignalsTests.WireNames_AreRegisteredAsync, PostgresSignalTransportUnitTests.EveryPayloadSignal_HasAWireBindingAsync}

### Decisions are durable {#coordination-durability}

One SQL function publishes: `wh_publish_signal(channel, payload, durable_wire_name)`. It notifies the channel at
commit and, for a decision, also records the signal and its payload in the durable log (`wh_signals`, whose `payload`
column migration 330 adds), in the caller's transaction. The role release, the partition-assignment publish, the
multi-stream run and the reap's orphan wake all call it, and the bus's Postgres transport calls it when C# publishes a
coordination signal.

| Behavior | Why | Verified by |
|---|---|---|
| A decision is recorded in `wh_signals` with its payload, in the same transaction as its `NOTIFY`. | A notification is lost if the hearer is disconnected at that moment. A decision recorded beside it can be replayed, and a hearer that missed a release would otherwise wait out a whole renew interval, or a stale assignment until its next claim. | {verified: CoordinationSignalsSqlTests.PublishSignal_ADecision_IsRecordedWithItsPayload_AndNotifiedAtCommitAsync, RoleAssignmentSqlTests.Release_IsRecordedDurably_SoAnInstanceThatMissedTheNotificationIsStillToldAsync, PartitionAssignmentSqlTests.Publish_ByTheRoleHolder_WritesTheAssignmentAndAnnouncesItAsync, CoordinationSignalsSqlTests.PublishingADecisionOnTheBus_RecordsIt_AndRingsTheOlderChannelAsync} |
| Each instance's tail replays a decision it missed, payload included, as the typed signal. | The subscriber is told *what* changed (which role, which version), not only that something did, so it acts exactly as if the notification had arrived. | {verified: CoordinationSignalsSqlTests.TheTail_ReplaysAMissedDecision_WithItsPayloadAsync, CoordinationSignalsSqlTests.ADecision_OnOneInstancesBus_ReachesAnotherInstancesSubscriberAsync} |
| A release, or a publish, that rolls back announces nothing and records nothing. | The record and the notification ride the caller's transaction; a decision that did not happen must not be heard. | {verified: CoordinationSignalsSqlTests.PublishSignal_InsideATransactionThatRollsBack_LeavesNoTraceAsync} |
| A doorbell is notified and never recorded. | A poll stands behind every doorbell, so a lost one costs latency only. Recording it would add a write to the commit hot path; `ring_doorbells` is unchanged. | {verified: CoordinationSignalsSqlTests.PublishSignal_ADoorbell_IsNotifiedButNeverRecordedAsync, CoordinationSignalsSqlTests.PublishingADoorbellOnTheBus_RingsTheOlderChannel_AndRecordsNothingAsync, CoordinationSignalsSqlTests.RecordingAMultiStreamRun_RingsTheOlderChannelWithTheRunId_AndRecordsNothingAsync} |
| Hearing a decision twice (the notification, then the tail's replay) is harmless. | Every subscriber treats a decision as a wake, not a command: a second release is one vacancy for the stamper, and an assignment version the cache already holds reads nothing. | {verified: PgCommitOrderStamperWorkerCoverageTests.TheBus_WakesTheStamperOnACommit_AndAWaiterOnItsRolesReleaseAsync, PartitionAssignmentCacheTests.OnPublished_ForTheVersionAlreadyHeld_ReadsNothingAsync} |
| `wh_release_role`, `wh_publish_signal` and the `payload` column are in the bootstrap region; on a fresh database where `wh_signals` does not exist yet, the publish notifies without recording. | The role release is Preflight's (migration 184), so what it calls must exist when the bootstrap closure applies, before migration 065 creates the log, and until then there is nothing to record into. | {verified: MigrationBootstrapRegionsTests.TheBootstrapSubsetIsTheMigrationsStartupNeedsAsync} |

### The wire did not change {#coordination-wire-names}

Every channel name and payload is the one an older release uses: `wh_role_released` with the role,
`wh_partition_assignment` with `epoch:revision`, `wh_multi_stream_work` with the run id, `wh_committed` with nothing,
and `wh_work_i_<instance>` with `orphan` or `deadletter`. The bus's Postgres transport `LISTEN`s on each coordination
channel by that name, and `PgSignalWire` is the one place in the library that names the four coordination channels. An older instance's
listeners therefore hear this release's SQL, and this release's bus hears an older release's SQL, in both directions
during a rolling deploy. An older instance's tail does not know the two new durable wire names
(`role-released`, `partition-assignment-published`), skips them and advances its cursor past them; it never reads
`payload`.
{verified: PostgresSignalTransportUnitTests.StartAsync_ListensOnEachCoordinationChannel_ByTheNameAnOlderReleaseUsesAsync, PostgresSignalTransportUnitTests.ACoordinationChannel_DeliversItsTypedSignal_WithThePayloadAsync, PostgresSignalTransportUnitTests.TheWorkChannel_DeliversOrphanedWorkAndDeadLetters_AsSignalsAsync, AppSignalsOnTheBusIntegrationTests.AnOlderInstancesRawNotify_ReachesABusSubscriberAsync, CoordinationSourceGuardTests.CoordinationChannels_AreNamedOnlyByTheBussWireAsync}

**Why no deprecation window.** Because nothing on the wire changed, a mixed fleet needs no period in which both old
and new channels are spoken. The alternative, collapsing every coordination channel onto the bus's single broadcast
channel (`wh_signal_broadcast`), would have needed one, and would have bought only cosmetic uniformity, so it was not
done. The channels stay distinct; what changed is who owns them.

A subscriber that throws is logged with the signal's wire name and the transport keeps delivering; one bad handler
does not stop the shared connection's loop.
{verified: PostgresSignalTransportUnitTests.ACoordinationChannel_WhoseSubscriberThrows_IsLoggedAndTheLoopContinuesAsync, PostgresSignalTransportUnitTests.ACoordinationChannel_WhoseDispatchThrowsSynchronously_IsLoggedAndTheLoopContinuesAsync}

### What it costs {#coordination-cost}

Measured on PostgreSQL 17 with 50 live instances, both on cold paths:

| Path | Cost |
|---|---|
| The reap's orphan wake, per reap | about 38 µs, from about 7 µs (each live instance's wake goes through `wh_publish_signal`) |
| A durable role release | about 4 µs (the `wh_signals` insert beside the `NOTIFY`) |

The commit hot path is unchanged: doorbells are never recorded, and `ring_doorbells`, the after-commit ringer, is the
same function.

## Hot-path constraints

Dispatch runs subscriber callbacks **synchronously on the shared notify connection's receive loop** (`PgSharedNotifyConnection`). One slow subscriber would block *every* channel on the pod. The bus preserves the existing discipline:

- Handlers **enqueue-and-return** — signal a `SemaphoreSlim`/channel and let a worker do the work off the loop.
- The instance-routed `wh_work_i_<id>` fan-out (one NOTIFY per unique owner) stays a deliberate load reducer for the claim hot path.
- Cold-stream-only NOTIFY during bulk imports is preserved to avoid notify storms.

## Hosting, wire-route self-test & doorbell liveness {#hosting-self-test-and-liveness}

The bus is **hosted by the framework**: `AddWhizbangSignalBus` registers a `SignalBusHostedService`
that starts every transport and pull source. It starts at the
[Elect startup stage](../../operations/startup/startup-status#signal-bus-at-elect), once, together with the
notification connection its Postgres transport listens on, not when the host starts: while Preflight runs, no
transport is started and no self-test is sent. Registering the bus more than once still hosts it once, and a host
composed without the worker pipeline (no stage gate) starts it with the host. No application code ever calls
`SignalBus.StartAsync` — a bus that is registered but not started silently drops every wire doorbell
(the transports never subscribe their channels), leaving all work pumps on polling cadence with no
error anywhere. That failure mode is now impossible to miss, through two layers:
{verified: StartupStageWiringTests.TheSignalBus_StartsAtElect_WithTheNotificationConnection_OnceAsync, StartupPreflightHostTests.HeldInPreflight_TheSignalBusStartsNoTransport_AndStartsItAtElectAsync, SignalBusHostingTests.AddWhizbangSignalBus_CalledTwice_HostedStartIsIdempotentAsync}

### Startup wire-route self-test

After the transports start at Elect, the host probes the wire route **functionally**: each transport publishes
a loopback `SignalBusProbeSignal` targeted at the *own* instance and must deliver it back through the
full route — routing maps → wire → typed dispatch — within `SignalBusOptions.ProbeTimeoutMilliseconds`
(default 5 s). Transports are probed **individually**, so the in-memory loopback can never vouch for a
dead Postgres transport. A connection-level self-test is deliberately not enough: the socket can be
healthy while the routing layer drops everything, which produces a false-healthy with no symptoms
except latency.

- **Pass** — logged at Information; the `signal-bus` health component reports `Operational`.
- **Fail** — the `signal-bus` component reports **`Degraded`**, and the log names the failing
  transport and the timeout. The verdict feeds the health component only: it does not switch any work
  pump to polling. If the route really is down, doorbells do not reach this instance and work is
  discovered at the poll interval, which is the designed fallback, so the degradation is loud instead
  of silent.

The probe re-runs every `SignalBusOptions.ReProbeIntervalMilliseconds` (default 5 min), so a listener
that dies mid-run is caught even on an idle service.

### Probe backoff and recovery

A single failed probe is often transient: on a cold start, when many services start at once against
one PostgreSQL server, the first loopback can miss the timeout while the route itself works. So a
failed probe does not hold the component `Degraded` for the whole re-probe interval:

- **Short retry backoff.** After a failed probe the loop retries after 5 s, 15 s, 30 s and 60 s
  (`SignalBusOptions.FailedProbeRetryDelaysMilliseconds`), then returns to the normal interval. The
  first probe that passes clears the failure and logs a recovery line at Information. Set the option to
  an empty array to disable the backoff.
- **Recovery on evidence.** A real wire signal arriving after the failed probe (`LastWireSignalAt`
  later than `LastProbeAt`) proves the route delivers, and clears the failure at once without waiting
  for a probe. A signal never sets a verdict before the startup probe has run.
- **Log levels follow the evidence.** A failure with retries left is a **Warning** that says when the
  next probe runs. Once the backoff is exhausted, each failure is an **ERROR** that counts the
  consecutive failures and lists what to check, so a route that is really dead keeps being reported.
- **Startup grace (optional).** `SignalBusOptions.FirstProbeTimeoutMilliseconds` gives the first probe
  after startup a longer timeout than later ones. Unset, it uses `ProbeTimeoutMilliseconds`.

```json{title="appsettings.json" description="Signal-bus probe tuning" category="Configuration" difficulty="INTERMEDIATE" tags=["Signal-Bus","Health"]}
{
  "Whizbang": {
    "SignalBus": {
      "ProbeTimeoutMilliseconds": 5000,
      "FirstProbeTimeoutMilliseconds": 15000,
      "ReProbeIntervalMilliseconds": 300000,
      "FailedProbeRetryDelaysMilliseconds": [5000, 15000, 30000, 60000]
    }
  }
}
```

### Runtime doorbell-liveness monitor

The re-probe is corroborated by a zero-cost empirical check on real traffic. The store guarantees a
doorbell rings on every **empty→non-empty edge** (a stream's first pending row per category). When the
claim loop discovers *fresh* work on that edge by a plain poll — no doorbell preceded it, while the
notify gate believes NOTIFY is healthy — it records a **missed doorbell** on `SignalBusLivenessState`;
a doorbell-preceded discovery resets the streak. After `SignalBusOptions.MissedDoorbellThreshold`
consecutive misses (default 3) the `signal-bus` component degrades with the reason. Transports also
stamp `LastWireSignalAt` on every received notification, so "when did a doorbell last actually arrive"
is always answerable.

Together the layers answer both halves of the operational question: *does the route work at all*
(probe, on a schedule) and *is it actually being used* (edge accounting, from live traffic).

## Transports & portability

Push and pull are **transports for the same bus** (the pull side is implemented as `BasePollSignalSource` plus the Postgres work-available pull sources), and the bus manages the pull interval adaptively via `INotifySignalingGate`:

- **NOTIFY healthy** — push carries latency; the pull source runs at a **relaxed** interval as the correctness backstop.
- **NOTIFY down** — the pull source **tightens** to carry the load until push recovers.
- **No NOTIFY at all** (e.g. SQLite) — the pull source is the **sole** transport; nothing changes for subscribers.

The Postgres work-available pull sources also read the schema-ready gate: while it is closed a tick detects nothing
and sends no query, because the tables they read may not exist yet and nothing claims work before the gate opens
(see [what runs in each stage](../../operations/startup/startup-status#what-runs-in-each-stage)).
{verified: PgWorkAvailablePollSourceSchemaGateTests.WhileTheSchemaGateIsClosed_ATickSendsNothing_AndOnceOpenItQueriesAsync, StartupStageWiringTests.EveryWorkAvailableProbe_ReadsTheSchemaReadyGateAsync}

The single-direct-connection-per-pod topology and the gated/adaptive intervals (`WhizbangNotificationOptions`) are preserved — the difference is that polling now **raises bus signals** rather than living as separate per-worker reconciliation loops.

## Migration (unify-now)

**Done.** The `ClaimWorker` now **subscribes to the three `Work…AvailableSignal` types on the bus** instead of consuming raw `IWorkNotificationListener` categories. Because those signals' wire-names (`outbox` / `inbox` / `perspective`) are identical to the SQL payloads already emitted, **no SQL changed**: the existing `notify_instance_owners` NOTIFYs are simply *received as bus signals* now. The notification regression suite (`ClaimWorkerNotificationWakeIntegrationTests`, `NotifyInstanceOwnersSqlTests`, `SharedDirectConnectionCountRegressionTests`, `PgWorkNotificationListenerIntegrationTests`, `CommittedNotifyEmissionSqlTests`, and peers) was **greened first as a behavior lock** and stayed green through the migration. The remaining wirings (the commit-order doorbell, role release, partition assignment, multi-stream runs, the orphan and dead-letter wakes, and app topics) moved onto the bus in [#2046](https://github.com/whizbang-lib/whizbang/issues/2046), with the same guardrail and the same wire; see [Coordination signals](#coordination-signals).

## Related Documentation

- Temporal Engine — the scheduled/recurring/deadline system that consumes the bus
- Ephemeral Events — self-destruct + the reaper that consumes `DestructionDue`
- Work Coordinator & Notifications — the underlying `LISTEN`/`NOTIFY` transport and fallback model
