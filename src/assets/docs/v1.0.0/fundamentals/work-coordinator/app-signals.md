---
title: App signals
pageType: concept
order: 7
version: 1.0.0
description: >-
  Application-defined signals carried over the same notification channel the coordinator uses, for
  waking your own work without a second listener.
tags: 'work-coordinator, app-signals, listen-notify, channels, notifications'
codeReferences:
  - src/Whizbang.Core/Notifications/AppSignals/IAppSignalChannel.cs
  - src/Whizbang.Core/Notifications/WhizbangNotificationOptions.cs
  - src/Whizbang.Data.Postgres/Notifications/PgWorkNotificationListener.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgAppSignalChannelIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgAppSignalChannelCoverageTests.cs
  - tests/Whizbang.Core.Tests/Notifications/AppSignalTopicValidatorTests.cs
---

# App signals

Whizbang exposes its NOTIFY/LISTEN infrastructure to application code via `IAppSignalChannel`. Use it for ad-hoc cross-pod pub/sub: cache invalidations, feature-flag refresh hints, custom workflow signals — anything where you'd otherwise reach for a separate message bus or polling loop for a low-volume signal.

## API

```csharp{
title: "The IAppSignalChannel contract"
description: "Publish a payload on a topic, or subscribe to one, over the notification connection the coordinator already holds."
framework: "NET10"
category: "Workers"
difficulty: "BEGINNER"
tags: ["app-signals", "pub-sub", "listen-notify", "channels"]
unverified: "library interface declaration - the behaviour is verified on the implementation"
}
public interface IAppSignalChannel {
  Task PublishAsync(string topic, string payload, CancellationToken ct = default);
  IDisposable Subscribe(string topic, Func<string, CancellationToken, Task> handler);
}
```

`topic` is your application's identifier. `payload` is an arbitrary string (often JSON).

## Topic naming rules

Topics must match `^[a-z][a-z0-9_]{0,62}$`. The `wh_` prefix is reserved for Whizbang internal signals — `AppSignalTopicValidator` rejects topics starting with `wh_` at publish/subscribe time:

```csharp{
title: "Which topic names are accepted"
description: "Lower-case application topics are accepted; the framework's own wh_ prefix and any upper-case name are rejected."
framework: "NET10"
category: "Workers"
difficulty: "BEGINNER"
tags: ["app-signals", "topics", "validation", "naming"]
unverified: "topic-rule demonstration - two of the three calls intentionally throw"
}
await channel.PublishAsync("user_signed_up", json);   // OK
await channel.PublishAsync("wh_internal", json);      // throws ArgumentException
await channel.PublishAsync("UserSignedUp", json);     // throws (uppercase not allowed)
await channel.PublishAsync("1signup", json);          // throws (must start with letter)
```

## Isolation from internal signals

App topics live on dedicated postgres channels named `wh_app_<topic>`. Whizbang's internal listeners (`PgWorkNotificationListener`) only listen on `wh_work` and ignore everything else. App subscribers get only the `wh_app_*` channels they subscribed to.

This means:

- App code **cannot** publish to or subscribe to internal `wh_work` signals.
- Internal listeners **cannot** see app traffic.
- Reserved-prefix validation is enforced in C#; you cannot bypass it.

## Usage example

```csharp{
title: "Refresh a cache from an app signal"
description: "A background service subscribes to a topic and invalidates its cache on each delivery, instead of polling for changes."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["app-signals", "cache-invalidation", "background-service", "pub-sub"]
}
// In your service:
public class FeatureFlagRefreshSubscriber : BackgroundService {
  public FeatureFlagRefreshSubscriber(IAppSignalChannel signals, IFeatureFlagCache cache) {
    _subscription = signals.Subscribe("feature_flag_refresh", async (payload, ct) => {
      await cache.RefreshAsync(ct);
    });
  }
  // ... dispose _subscription on shutdown
}

// Anywhere that wants to broadcast a refresh:
await appSignalChannel.PublishAsync("feature_flag_refresh", "");
```

## Transactional publish

`PublishAsync` issues `SELECT pg_notify(...)` on a postgres connection. Notifications queue and deliver at COMMIT — so if you call `PublishAsync` inside a transaction (via your DbContext or a shared connection), the signal is naturally tied to the transaction. Rollback → no signal. Commit → signal delivered.

For ad-hoc fire-and-forget without a transaction context, `PublishAsync` opens a short-lived connection, executes, returns. The notification commits with that short-lived transaction.

## Limitations

- **At-most-once with bounded latency**: notifications are best-effort. If the listener is disconnected when the notify fires, the signal is lost. Use this for "wake up and check" semantics, not for durable pub/sub.
- **No payload size enforcement** beyond postgres's 8 KB notify limit. Large payloads are an anti-pattern — pass an id and let subscribers fetch.
- **Single LISTEN connection per pod** (shared with internal listener). High-throughput app pub/sub may saturate this connection; for that, prefer a dedicated message bus (Service Bus, RabbitMQ).

## NoOp mode

When `WhizbangNotificationOptions.DirectConnectionString` is unset, `IAppSignalChannel` is bound to `NoOpAppSignalChannel`. Publish is a no-op (after topic validation); subscribers never fire.

This means app code that uses `IAppSignalChannel` works without modification in environments without notifications configured — it just becomes silent.

## When to use, when not to

| Use IAppSignalChannel | Don't use IAppSignalChannel |
|---|---|
| Cache invalidation broadcasts | Durable cross-service work (use outbox + transport) |
| Feature flag refresh hints | High-volume event streaming |
| "Reload config" signals | Anything that needs at-least-once semantics |
| Cross-pod debounce/coordination | Anything > 8 KB per signal |

## Related

- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Configuration reference](configuration-reference.md)
