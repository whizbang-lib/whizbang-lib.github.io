---
title: Implementing notifications
order: 5
---

# Implementing notifications

If your engine supports server-side pub/sub, implement `IWorkNotificationListener` to wake C# workers immediately when new work arrives. If not, set `SupportsServerSideNotifications = false` and Whizbang's polling fallback handles correctness.

## The contract

```csharp
public interface IWorkNotificationListener {
  bool IsHealthy { get; }
  DateTimeOffset? LastSignalAt { get; }
  event Action<WorkSignalCategory>? OnSignal;
  event Action<bool>? OnHealthChanged;
}
```

Behind it, the engine's push side:
1. Opens a long-lived connection that bypasses any session-state-breaking pooler.
2. Subscribes to the engine's pub/sub mechanism for each instance's work channel (`wh_work_i_<instance>` on Postgres) and the signal bus's other channels, as the bus's transport.
3. Dispatches received notifications as typed signals, which the listener turns into `OnSignal(WorkSignalCategory)`.
4. Reconnects with exponential backoff on disconnect.
5. Surfaces health via `IsHealthy` + `OnHealthChanged`.

## Postgres reference

On Postgres the push side is the [signal bus](../../v1.0.0/fundamentals/signal-bus/signal-bus.md), and only the bus
issues `NOTIFY` and `LISTEN` ([#2046](https://github.com/whizbang-lib/whizbang/issues/2046)):

- `PgSharedNotifyConnection` is the one long-lived direct connection per instance. It owns reconnect, backoff,
  keepalive and the self-test probe, and implements `INotifySignalingGate`.
- `PostgresSignalTransport` is the bus's Postgres transport and the connection's only subscriber. It `LISTEN`s on the
  broadcast channel, the instance's own channel (`wh_work_i_<instance>`), the
  [coordination channels](../../v1.0.0/fundamentals/signal-bus/signal-bus.md#coordination-signals) and each
  application topic, and delivers typed signals to the bus.
- `PgWorkNotificationListener` implements `IWorkNotificationListener` as a **subscriber of the bus**: it subscribes to
  the work doorbells, the orphan wake and the dead-letter doorbell, and raises `OnSignal(WorkSignalCategory)`. It owns
  no channel and no connection; `IsHealthy` is the gate's availability.

A new engine with server-side pub/sub follows the same shape: implement the bus's transport (`ISignalTransport`, and
`ISignalTopicTransport` to carry application topics) over one long-lived connection, and let the existing subscribers
hear it through the bus. A coordination test guard fails when a raw channel subscription appears outside the bus's
files (see [Gravity](../gravity.md#coordination-source-guard)).

## Engine equivalents

| Engine | Mechanism | Bypass requirement |
|---|---|---|
| Postgres | `NOTIFY` / `LISTEN` | Direct connection (bypasses pgbouncer transaction-pooling). |
| SQL Server | Service Broker (`CREATE QUEUE` + `WAITFOR (RECEIVE ...)`) | Service Broker has its own session model; no special connection needed but configuration is non-trivial. |
| MySQL | None native | Use polling (`SupportsServerSideNotifications = false`). |
| SQLite | None native | Polling. |

## Required behaviors

### Reconnect with exponential backoff

```csharp
private TimeSpan _computeBackoff(int attempt) {
  var ms = _options.ListenReconnectInitialDelay.TotalMilliseconds *
           Math.Pow(_options.ListenReconnectBackoffMultiplier, attempt - 1);
  return TimeSpan.FromMilliseconds(Math.Min(ms, _options.ListenReconnectMaxDelay.TotalMilliseconds));
}
```

Defaults: 1 s → 2 s → 4 s → 8 s → 16 s → 30 s cap.

### Keepalive

Send a cheap query (`SELECT 1` for SQL backends) periodically to prove the connection is alive. If the keepalive fails, treat as disconnect and trigger reconnect.

### Health flip

`IsHealthy` flips on (re)connect success and off on disconnect. Fire `OnHealthChanged` so subscribers (typically `ClaimWorker`) can adjust polling cadence.

## App signals (if your engine supports it)

Application pub/sub needs no separate implementation: `IAppSignalChannel` is the signal bus, which hands each topic
to every transport that implements `ISignalTopicTransport`. Postgres reference: `PostgresSignalTransport.cs`
(`PublishTopicAsync`, `SubscribeTopic`). `PgAppSignalChannel` is deleted.

`PublishTopicAsync(topic, payload, DbTransaction? transaction, ...)` receives the caller's open transaction when the
publish was made inside one. Send the notification inside it, on its connection, so it is delivered only on commit and
never on rollback; treat a transaction of another provider as none; inside a `TransactionScope`, send on a connection of
your own once the scope commits (never on an enlisted one, which makes the commit two-phase). See
[Publish inside a transaction](../../v1.0.0/fundamentals/work-coordinator/app-signals.md#transactional-publish).

App channels share the listener connection but use distinct postgres channel names (`wh_app_<topic>`). The validator in `Whizbang.Core/Notifications/AppSignals/AppSignalTopicValidator.cs` enforces the `wh_` prefix is reserved for internal use.

## NOTIFY emission contract

The corresponding write side is in your SQL functions. On Postgres a store or handler commit that inserted work rings the owners of the streams it touched (`notify_instance_owners(payload, stream_ids)`, payload `outbox`, `inbox` or `perspective`); the hot transaction only queues the doorbell, and `ring_doorbells`, the signal bus's after-commit ringer, sends it on `wh_work_i_<owner>` once the transaction has committed (see [Doorbells ring after commit](../../v1.0.0/fundamentals/work-coordinator/notifications-and-pgbouncer.md#doorbells-ring-after-commit)). A coordination decision is published through `wh_publish_signal`. No other SQL function notifies.

Postgres dedups `(channel, payload)` pairs at COMMIT: burst inserts collapse to one delivered notification per category.

## DI registration

```csharp
public static IServiceCollection AddWhizbangPostgresNotifications(
  this IServiceCollection services) {
  services.AddSingleton<PgWorkNotificationListener>();
  services.AddSingleton<IWorkNotificationListener>(sp =>
    sp.GetRequiredService<PgWorkNotificationListener>());
  services.AddHostedService(sp =>
    sp.GetRequiredService<PgWorkNotificationListener>());
  // App signals ride the signal bus: the channel is the bus itself.
  services.TryAddSingleton<IAppSignalChannel>(static sp => sp.GetRequiredService<SignalBus>());
  return services;
}
```

The same listener instance is bound as `IWorkNotificationListener` and the hosted service, and `IAppSignalChannel` resolves to the signal bus. Every signal, work, coordination or application, rides the bus's one transport over one direct connection per pod.

## When to skip

If your engine doesn't have native pub/sub, skip the listener. Set `SupportsServerSideNotifications = false`; Whizbang binds `NoOpWorkNotificationListener` automatically. The system runs polling-only — fully correct, just higher idle baseline. The default polling cadence (250 ms base, 10 s adaptive cap) is reasonable for most workloads without notifications.

## Related

- [Overview](overview.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Fundamentals: notifications and pgbouncer](../../v1.0.0/fundamentals/work-coordinator/notifications-and-pgbouncer.md)
