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
  - src/Whizbang.Core/Signals/SignalBus.cs
  - src/Whizbang.Core/Signals/ISignalTopicTransport.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresSignalTransport.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AppSignalsOnTheBusIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresSignalTransportTopicTests.cs
  - tests/Whizbang.Core.Component.Tests/Signals/SignalBusAppTopicTests.cs
  - tests/Whizbang.Core.Tests/Notifications/AppSignalTopicValidatorTests.cs
---

# App signals

Whizbang exposes its NOTIFY/LISTEN infrastructure to application code via `IAppSignalChannel`. Use it for ad-hoc cross-pod pub/sub: cache invalidations, feature-flag refresh hints, custom workflow signals — anything where you'd otherwise reach for a separate message bus or polling loop for a low-volume signal.

## The channel is the signal bus {#the-channel-is-the-bus}

`IAppSignalChannel` is the [signal bus](../signal-bus/signal-bus): `SignalBus` implements it, and the container
resolves `IAppSignalChannel` to the same `SignalBus` instance. The bus validates the topic and hands it to every
transport that carries topics (`ISignalTopicTransport`); the Postgres transport carries each topic on
`wh_app_<topic>`, on the same shared connection as the framework's own signals. `PgAppSignalChannel`, the separate
Postgres implementation earlier releases registered, is deleted ([#2046](https://github.com/whizbang-lib/whizbang/issues/2046)).

| Behavior | Why | Verified by |
|---|---|---|
| A publish is handed to every topic transport; a subscription registers with each, and disposing it releases each once. | One bus, one place that owns `NOTIFY` and `LISTEN`: an application topic is not a second, hand-wired channel beside the framework's. | {verified: SignalBusAppTopicTests.Publish_HandsTheTopicToEveryTopicTransportAsync, SignalBusAppTopicTests.Subscribe_RegistersWithEveryTopicTransport_AndDisposingReleasesEachAsync, AppSignalsOnTheBusIntegrationTests.SubscribeAndPublish_RoundTripsThroughTheBusAsync} |
| Topics are validated, and a handler is required, before any transport sees them. | The `wh_` prefix stays the framework's whichever transport carries the topic. | {verified: SignalBusAppTopicTests.Topics_AreValidated_AndAHandlerIsRequiredAsync} |
| With no topic transport registered, a publish sends nothing and a subscription holds nothing. | A host composed without the Postgres transport still resolves the channel; it is silent rather than failing. | {verified: SignalBusAppTopicTests.WithNoTopicTransport_PublishSendsNothing_AndSubscribeHoldsNothingAsync} |
| The channel name and payload are unchanged (`wh_app_<topic>`, your text). | An older instance's `PgAppSignalChannel` and this release's bus hear each other during a rolling deploy, so no deprecation window is needed. | {verified: AppSignalsOnTheBusIntegrationTests.Publish_EmitsPgNotify_OnDedicatedAppChannelAsync, AppSignalsOnTheBusIntegrationTests.AnOlderInstancesRawNotify_ReachesABusSubscriberAsync} |
| One `LISTEN` per topic, however many handlers; each payload fans out in memory, and a handler that throws is logged while the others still receive it. | A topic costs one channel registration on the one connection, and one bad handler cannot starve the rest. | {verified: AppSignalsOnTheBusIntegrationTests.Subscribe_MultipleHandlersOnSameTopic_AllReceiveDeliveriesAsync, PostgresSignalTransportTopicTests.ATopicNotification_WhenAHandlerThrows_LogsItAndStillDeliversToTheOtherHandlersAsync} |
| Disposing a subscription handle twice, or from many threads at once, releases it once and leaves the topic reusable. | Teardown paths often dispose more than once; a second release must not drop another subscriber's `LISTEN`. | {verified: PostgresSignalTransportTopicTests.SubscribeTopic_DisposingTheReturnedHandleTwice_IsIdempotentAsync, PostgresSignalTransportTopicTests.SubscribeTopic_DisposedConcurrentlyFromManyThreads_NeverThrowsAndLeavesTheTopicReusableAsync} |

Your code does not change: keep injecting `IAppSignalChannel`.

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

App topics live on dedicated postgres channels named `wh_app_<topic>`. The framework's own signals travel on their own channels (`wh_signal_broadcast`, `wh_work_i_<instance>` and the [coordination channels](../signal-bus/signal-bus#coordination-signals)), and the bus's transport delivers each to its typed subscribers only. App subscribers get only the `wh_app_*` channels they subscribed to.

This means:

- App code **cannot** publish to or subscribe to the framework's channels through `IAppSignalChannel`.
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

## Publish is not transactional {#transactional-publish}

`PublishAsync` opens a short-lived connection of its own, issues `SELECT pg_notify(...)` and returns; the notification
commits with that statement. It does not join a transaction you have open on your DbContext, so a publish made inside
your transaction is delivered even if your transaction later rolls back. Publish after your transaction commits.

## Limitations

- **At-most-once with bounded latency**: notifications are best-effort. If the listener is disconnected when the notify fires, the signal is lost. Use this for "wake up and check" semantics, not for durable pub/sub.
- **No payload size enforcement** beyond postgres's 8 KB notify limit. Large payloads are an anti-pattern — pass an id and let subscribers fetch.
- **Single LISTEN connection per pod** (shared with internal listener). High-throughput app pub/sub may saturate this connection; for that, prefer a dedicated message bus (Service Bus, RabbitMQ).

## Without a notification connection {#noop-mode}

When no notification connection string resolves, a publish is dropped after topic validation (logged at Debug) and
never reaches the wire through some other connection; subscribers never fire.
{verified: AppSignalsOnTheBusIntegrationTests.Publish_WithNoConnectionStringResolved_NoOpsAsync}

This means app code that uses `IAppSignalChannel` works without modification in environments without notifications configured — it just becomes silent.

## When to use, when not to

| Use IAppSignalChannel | Don't use IAppSignalChannel |
|---|---|
| Cache invalidation broadcasts | Durable cross-service work (use outbox + transport) |
| Feature flag refresh hints | High-volume event streaming |
| "Reload config" signals | Anything that needs at-least-once semantics |
| Cross-pod debounce/coordination | Anything > 8 KB per signal |

## Related

- [System Signal Bus](../signal-bus/signal-bus): the bus this channel is
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Configuration reference](configuration-reference.md)
