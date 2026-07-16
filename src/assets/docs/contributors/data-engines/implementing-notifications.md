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

The listener is a `BackgroundService` that:
1. Opens a long-lived connection that bypasses any session-state-breaking pooler.
2. Subscribes to the engine's pub/sub mechanism for the `wh_work` channel (or equivalent).
3. Dispatches received notifications to `OnSignal(WorkSignalCategory)`.
4. Reconnects with exponential backoff on disconnect.
5. Surfaces health via `IsHealthy` + `OnHealthChanged`.

## Postgres reference

`Whizbang.Data.Postgres/Notifications/PgWorkNotificationListener.cs` is the reference. ~120 lines:

```csharp
public sealed partial class PgWorkNotificationListener : BackgroundService, IWorkNotificationListener {
  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    if (string.IsNullOrWhiteSpace(_options.DirectConnectionString) || _options.DisableNotifications) {
      return;  // NoOp mode
    }

    var attempt = 0;
    while (!stoppingToken.IsCancellationRequested) {
      try {
        await using var conn = new NpgsqlConnection(_options.DirectConnectionString);
        conn.Notification += _onNotification;
        await conn.OpenAsync(stoppingToken);

        await using (var cmd = new NpgsqlCommand("LISTEN wh_work", conn)) {
          await cmd.ExecuteNonQueryAsync(stoppingToken);
        }

        _setHealthy(true);
        attempt = 0;

        while (!stoppingToken.IsCancellationRequested) {
          // WaitAsync blocks until a notification arrives or keepalive timeout.
          // On keepalive: SELECT 1 to prove the connection is alive.
        }
      } catch (Exception ex) when (ex is not OperationCanceledException) {
        _setHealthy(false);
        attempt++;
        var delay = _computeBackoff(attempt);
        await Task.Delay(delay, stoppingToken);
      }
    }
  }
}
```

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

If `SupportsServerSideNotifications`, also implement `IAppSignalChannel` for application pub/sub. Postgres reference: `PgAppSignalChannel.cs`.

App channels share the listener connection but use distinct postgres channel names (`wh_app_<topic>`). The validator in `Whizbang.Core/Notifications/AppSignals/AppSignalTopicValidator.cs` enforces the `wh_` prefix is reserved for internal use.

## NOTIFY emission contract

The corresponding write side is in your SQL functions. After successful inserts in `commit_handler_result` and `complete_perspective`, emit:

```sql
PERFORM pg_notify('wh_work', 'outbox');       -- if outbox rows inserted
PERFORM pg_notify('wh_work', 'inbox');        -- if inbox rows inserted
PERFORM pg_notify('wh_work', 'perspective');  -- if perspective rows created
```

Postgres dedups `(channel, payload)` pairs at COMMIT — burst inserts collapse to one delivered notification per category. Free.

## DI registration

```csharp
public static IServiceCollection AddWhizbangPostgresNotifications(
  this IServiceCollection services) {
  services.AddSingleton<PgWorkNotificationListener>();
  services.AddSingleton<IWorkNotificationListener>(sp =>
    sp.GetRequiredService<PgWorkNotificationListener>());
  services.AddHostedService(sp =>
    sp.GetRequiredService<PgWorkNotificationListener>());
  services.AddSingleton<IAppSignalChannel, PgAppSignalChannel>();
  return services;
}
```

The same listener instance is bound as `IWorkNotificationListener`, the hosted service, and (when applicable) the dispatcher for `IAppSignalChannel`. This consolidates to one direct connection per pod.

## When to skip

If your engine doesn't have native pub/sub, skip the listener. Set `SupportsServerSideNotifications = false`; Whizbang binds `NoOpWorkNotificationListener` automatically. The system runs polling-only — fully correct, just higher idle baseline. The default polling cadence (250 ms base, 10 s adaptive cap) is reasonable for most workloads without notifications.

## Related

- [Overview](overview.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Fundamentals: notifications and pgbouncer](../../fundamentals/work-coordinator/notifications-and-pgbouncer.md)
