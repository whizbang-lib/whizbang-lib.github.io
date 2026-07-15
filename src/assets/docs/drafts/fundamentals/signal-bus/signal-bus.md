---
title: System Signal Bus
category: Architecture & Design
order: 20
tags: signal-bus, notifications, listen-notify, control-plane, rebalance, instance-lifecycle, reliability
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

Today the control plane uses `LISTEN`/`NOTIFY` in several *bespoke, per-use* wirings: an instance-routed work-availability channel (`wh_work_i_<id>`), a commit-order channel (`wh_committed`), and an app-facing pub/sub channel family (`wh_app_<topic>`). Each has its own producer, subscriber, and fallback logic. Cluster events — a partition **rebalance**, an instance **joining**, an instance **dying** — are handled implicitly inside individual workers rather than surfaced as first-class events that *any* subsystem (or the application developer) can react to.

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
| `IAppSignalChannel` (`wh_app_<topic>`) | app-facing string pub/sub | precedent for developer signals — now typed `ISignal` via the bus; the string channel stays for non-typed app messaging |
| `PgSharedNotifyConnection` | the **one direct connection per pod** (self-test probe, alive-lock) | bus Postgres transport |

Signals are delivered on Postgres channels: `wh_work_i_<instance_id>` (instance-routed via `notify_instance_owners`, resolving stream → owner from `wh_active_streams.assigned_instance_id`), `wh_committed`, and `wh_app_<topic>`. Ownership is a **modulo-rank formula** over live instances — there is no separate partition-assignment table.

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

Under the covers, `SignalTarget.Streams(...)` calls the existing `notify_instance_owners(payload, stream_ids)` SQL helper — the same function today's `_emit_event_store_chain`, `store_outbox_messages`, and `store_inbox_messages` procs invoke — so the routing rule is **unified**: pinned owner from `wh_active_streams`, or the deterministic partition-modulo target for streams that haven't been claimed yet. `SignalTarget.Instance(id)` emits `pg_notify` directly on `wh_work_i_<id>`.

```csharp{title="SignalTarget — per-publish target selector" description="Structured target for a publish call: broadcast (default), streams (owner resolved via notify_instance_owners), or instance (direct)" category="Architecture" difficulty="INTERMEDIATE" tags=["Signal-Bus","Targeting","Control-Plane"] framework="NET10"}
/// <docs>fundamentals/signal-bus/signal-bus</docs>
public readonly struct SignalTarget {
    // No target — every instance's broadcast channel. Default value.
    public static SignalTarget Broadcast => default;

    // Resolve the owning instance(s) via notify_instance_owners(payload, stream_ids).
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

(The legacy string-topic `IAppSignalChannel` / `wh_app_<topic>` pub/sub remains for non-typed app messaging;
the typed signal bus is the control-plane path.)

## Reliability & the durable log (`wh_signals`)

Durable-class signals (e.g. `InstanceDiedSignal`) are appended to **`wh_signals` (`wire_name`, `target_instance_id`) before the NOTIFY is emitted**, so the signal survives connection loss: each instance **tails the log from a persisted cursor** and re-delivers anything the fast-path NOTIFY dropped. Best-effort signals stay purely in-memory-fast (no row written). A **retention-sweep worker** trims the log once every instance's tail cursor has advanced past a row. Reconciliation reads the DB directly, so even a total NOTIFY outage degrades only to bounded-latency polling, never to lost work.

## Hot-path constraints

Dispatch runs subscriber callbacks **synchronously on the shared notify connection's receive loop** (`PgSharedNotifyConnection`). One slow subscriber would block *every* channel on the pod. The bus preserves the existing discipline:

- Handlers **enqueue-and-return** — signal a `SemaphoreSlim`/channel and let a worker do the work off the loop.
- The instance-routed `wh_work_i_<id>` fan-out (one NOTIFY per unique owner) stays a deliberate load reducer for the claim hot path.
- Cold-stream-only NOTIFY during bulk imports is preserved to avoid notify storms.

## Transports & portability

Push and pull are **transports for the same bus** (the pull side is implemented as `BasePollSignalSource` plus the Postgres work-available pull sources), and the bus manages the pull interval adaptively via `INotifySignalingGate`:

- **NOTIFY healthy** — push carries latency; the pull source runs at a **relaxed** interval as the correctness backstop.
- **NOTIFY down** — the pull source **tightens** to carry the load until push recovers.
- **No NOTIFY at all** (e.g. SQLite) — the pull source is the **sole** transport; nothing changes for subscribers.

The single-direct-connection-per-pod topology and the gated/adaptive intervals (`WhizbangNotificationOptions`) are preserved — the difference is that polling now **raises bus signals** rather than living as separate per-worker reconciliation loops.

## Migration (unify-now)

**Done for the work-wake path.** The `ClaimWorker` now **subscribes to the three `Work…AvailableSignal` types on the bus** instead of consuming raw `IWorkNotificationListener` categories. Because those signals' wire-names (`outbox` / `inbox` / `perspective`) are identical to the SQL payloads already emitted, **no SQL changed** — the existing `notify_instance_owners` NOTIFYs are simply *received as bus signals* now. The notification regression suite (`ClaimWorkerNotificationWakeIntegrationTests`, `NotifyInstanceOwnersSqlTests`, `SharedDirectConnectionCountRegressionTests`, `PgWorkNotificationListenerIntegrationTests`, `CommittedNotifyEmissionSqlTests`, and peers) was **greened first as a behavior lock** and stayed green through the migration. Remaining wirings (commit-order, app-signal) migrate onto `ISignalBus` incrementally with the same guardrail.

## Related Documentation

- Temporal Engine — the scheduled/recurring/deadline system that consumes the bus
- Ephemeral Events — self-destruct + the reaper that consumes `DestructionDue`
- Work Coordinator & Notifications — the underlying `LISTEN`/`NOTIFY` transport and fallback model
