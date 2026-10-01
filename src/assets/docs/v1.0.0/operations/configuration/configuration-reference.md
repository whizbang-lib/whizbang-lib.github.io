---
title: Configuration Reference
pageType: reference
verifiedAgainstCommit: b21e129e9
verifiedDate: 2026-10-01
version: 1.0.0
category: Configuration
order: 2
description: >-
  Every Whizbang configuration key on one page - which sections bind
  automatically, which you bind yourself, defaults, environment-variable names,
  and links to the detail pages
tags: >-
  configuration, options, environment variables, appsettings, reference,
  binding
codeReferences:
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresNotificationsServiceCollectionExtensions.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Workers/PinnedPoolServiceCollectionExtensions.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorGateOptions.cs
  - src/Whizbang.Core/Workers/BatchFlusher.cs
  - src/Whizbang.Core/Workers/PerspectiveStreamAffinityOptions.cs
  - src/Whizbang.Core/Resilience/CircuitBreakerOptionsPostConfigure.cs
  - src/Whizbang.Core/Transports/TransportConfigurationSection.cs
  - src/Whizbang.Core/Workers/TransportConsumerOptionsBinder.cs
  - src/Whizbang.Core/Workers/ServiceBusConsumerOptionsConfiguration.cs
  - src/Whizbang.Core/Tags/TagCoalesceConfigurationBinder.cs
  - src/Whizbang.Core/Configuration/ConfigurationValueBinder.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQOptionsConfigurationBinder.cs
  - src/Whizbang.Data.Postgres/PostgresOptionsConfiguration.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorGateInteractiveReserveTests.cs
  - tests/Whizbang.Core.Tests/ServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorGateRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Workers/BatchFlusherRetryTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerAffinityHoldWatchdogTests.cs
  - tests/Whizbang.Core.Tests/Resilience/CircuitBreakerOptionsConfigurationTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerOptionsConfigurationTests.cs
  - tests/Whizbang.Core.Tests/Workers/ServiceBusConsumerOptionsConfigurationTests.cs
  - tests/Whizbang.Core.Tests/Tags/TagCoalesceConfigurationBinderTests.cs
  - tests/Whizbang.Core.Tests/Configuration/ConfigurationValueBinderTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQOptionsConfigurationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresOptionsConfigurationTests.cs
---

This page lists **every configuration surface Whizbang exposes**: the sections the library binds from `IConfiguration` automatically, the sections you can opt into binding with a helper, and the (much larger) set of options classes that are configured in code — plus the recipe for making any of them configuration-driven. Each options class lists its properties, types, defaults, and a link to the page that covers it in depth.

## How Whizbang Reads Configuration

Whizbang follows the standard .NET configuration model ([Microsoft: Configuration in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration)), but — because the library is zero-reflection and AOT-first — it deliberately does **not** reflection-bind every options class from configuration. There are three distinct mechanisms, and knowing which one applies to a given options class tells you whether an `appsettings.json` entry or environment variable will have any effect:

| Mechanism | What it means | Applies to |
|-----------|---------------|------------|
| **Bound automatically** | `AddWhizbang()` / the database driver registration reads these configuration sections with hand-rolled, AOT-safe binders. Setting a key in `appsettings.json` or as an environment variable just works. | **44 sections** — `Whizbang` itself, `Whizbang:Tracing`, `Whizbang:SchemaInitialization`, `Whizbang:WorkCoordinator`, every `Whizbang:Workers:*` worker, `Whizbang:StreamIntegrity`, `Whizbang:DeadLetterRecovery`, `Whizbang:Temporal`, `Whizbang:Tags` and the rest listed in the [Quick Map](#quick-map); plus `Whizbang:Database*` with the Postgres driver, `Whizbang:Transports:AzureServiceBus` / `Whizbang:Transports:RabbitMQ` with those transports, the [per-instance sections](#per-instance-sections) keyed by breaker, transport, database and tag, and `Whizbang:ServiceName`, `Whizbang:ShowBanner`, `ConnectionStrings:*`, `ConnectionPool:*` |
| **Opt-in binding helper** | A one-line registration call reads the section for you. Without that call, the section is inert. | `Whizbang:BodyOffload` + `Whizbang:Offloads:AzureBlob:<name>` (via `AddWhizbangAzureBlobOffloadsFromConfiguration`) |
| **Code-configured** | The options class is configured through an `Action<TOptions>` lambda (or `services.Configure<TOptions>(...)`). The library never reads a configuration section for it — **a configuration key for one of these does nothing unless your service binds it**. Every table below carries an environment-variable column; these read `— *code-only*`, so a blank is always deliberate rather than an omission (see [the binding recipe](#code-configured-options-the-binding-recipe)). | The classes with no configuration section in the [Quick Map](#quick-map): `WhizbangCoreOptions`, `ServiceRegistrationOptions`, `WhizbangLifecycleOptions`, `StandbyWatcherOptions`, `WhizbangHealthOptions`, `DebuggerAwareClockOptions`, `WorkerRetryOptions`, `BatchFlusherOptions`, `SlidingWindowBatcherOptions` and the other shared shapes |

> **The most common configuration mistake** is setting environment variables for a code-configured section — for example `Whizbang__StandbyWatcher__PollInterval` — and expecting them to take effect. Nothing in the library reads that section. Every class below states which mechanism applies to it.
>
> Note that `Whizbang:WorkCoordinator` **is** bound automatically (`Whizbang__WorkCoordinator__LeaseSeconds` works, default `300`). Earlier revisions of this page used it as the example of a key that does nothing, which was wrong.

## Environment Variable Naming

.NET's environment-variable configuration provider maps configuration keys to environment variables by replacing the `:` section separator with a double underscore `__` ([Microsoft: non-prefixed environment variables](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/#non-prefixed-environment-variables), [environment variable provider](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration-providers#environment-variable-configuration-provider)):

| Configuration key | Environment variable |
|-------------------|----------------------|
| `Whizbang:Tracing:Verbosity` | `Whizbang__Tracing__Verbosity` |
| `Whizbang:Database:SignalingMode` | `Whizbang__Database__SignalingMode` |
| `Whizbang:WorkCoordinatorGate:MaxConcurrent` | `Whizbang__WorkCoordinatorGate__MaxConcurrent` |
| `Whizbang:Offloads:AzureBlob:my-provider:ContainerName` | `Whizbang__Offloads__AzureBlob__my-provider__ContainerName` |
| `ConnectionStrings:myservice-db` | `ConnectionStrings__myservice-db` |
| `ConnectionPool:MaxPoolSize` | `ConnectionPool__MaxPoolSize` |

Environment variables are added **after** `appsettings.json` and `appsettings.{Environment}.json` in the default host builder, so they override both; command-line arguments override everything ([Microsoft: default configuration sources and precedence](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/#default-application-configuration-sources)). `TimeSpan` values use the standard `d.hh:mm:ss` string form (`00:00:30` = 30 seconds); enums parse case-insensitively by name.

## Quick Map

| Configuration section | Options class | Binding |
|-----------------------|---------------|---------|
| `Whizbang:Tracing` | `TracingOptions` | Automatic |
| `Whizbang:Database` | `WhizbangNotificationOptions` | Automatic (Postgres driver) |
| `Whizbang:Database:Stamper` | `CommitOrderStamperOptions` | Automatic (Postgres driver) |
| `Whizbang:WorkCoordinatorGate` | `WorkCoordinatorGateOptions` | Automatic (worker pipeline); a Postgres driver's `MaxInFlightCommands` fills `MaxConcurrent` when the section leaves it unset |
| `Whizbang:ServiceName` (falls back to `ServiceName`) | — (string) | Automatic |
| `Whizbang:ShowBanner` | — (bool) | Automatic |
| `ConnectionStrings:*` | — (strings, naming conventions below) | Automatic |
| `ConnectionPool:*` | — (generated DbContext registration) | Automatic |
| `Whizbang:BodyOffload` | `MessageBodyOffloadOptions` (4 of 9 keys) | Opt-in helper |
| `Whizbang:BodyOffload:Cipher` | the built-in body cipher (`AesGcmEnvelopeCipher`) | Opt-in helper |
| `Whizbang:Offloads:AzureBlob:<name>` | `AzureBlobOffloadOptions` | Opt-in helper |
| `Whizbang:Workers:PinnedPool` | `WhizbangPinnedPoolOptions` | Automatic (`AddWhizbangPinnedPool()`) |
| `Whizbang` | `WhizbangOptions` | Automatic (worker pipeline) |
| `Whizbang:SchemaInitialization` | `SchemaInitializationOptions` | Automatic |
| `Whizbang:Ephemeral` | `EphemeralOptions` | Automatic |
| `Whizbang:SignalBus` | `SignalBusOptions` | Automatic |
| `Whizbang:UnobservedExceptionDiagnostics` | `UnobservedExceptionDiagnosticsOptions` | Automatic |
| `Whizbang:WorkCoordinator` | `WorkCoordinatorOptions` | Automatic |
| `Whizbang:Housekeeping` | `HousekeepingCoordinator.Settings` | Automatic |
| `Whizbang:BacklogAge` | `BacklogAgeOptions` | Automatic |
| `Whizbang:StreamIntegrity` | `StreamIntegrityOptions` | Automatic |
| `Whizbang:DeadLetterRecovery` | `DeadLetterRecoveryOptions` | Automatic |
| `Whizbang:OrderedStreamProcessor` | `OrderedStreamProcessorOptions` | Automatic |
| `Whizbang:PerspectiveRowRetention` | `PerspectiveRowRetentionOptions` | Automatic |
| `Whizbang:Temporal` | `TemporalOptions` | Automatic |
| `Whizbang:Tags` | `TagOptions` | Automatic |
| `Whizbang:Workers:*` (Claim, Heartbeat, LeaseHandle, LeaseRenewal, BackupTick, Maintenance, OutboxDrain, OutboxPublish, OutboxBatch, OutboxCompletionFlush, InboxDrain, InboxDispatch, InboxHandler, InboxBatch, InboxDeserializeCache, FailureFlush, Perspective, PerspectiveCompletionFlush, RecentlyProcessedEventCache, TransportDeadLetterDrain) | the matching `*WorkerOptions` | Automatic (worker pipeline) |
| `Whizbang:Transports:AzureServiceBus` | `AzureServiceBusOptions` | Automatic (ASB transport) |
| `Whizbang:Transports:RabbitMQ` | `RabbitMQOptions` | Automatic (RabbitMQ transport) |
| `Whizbang:Transports:<transport>:MessageProcessing`, `:Batch`, `:SubscriptionResilience`, `:Consumer` | `MessageProcessingOptions`, `TransportBatchOptions`, `SubscriptionResilienceOptions`, `TransportConsumerOptions` | Automatic (transport consumer, for each registered transport) — see [Transport Sections](#transport-sections) |
| `Whizbang:Transports:AzureServiceBus:Consumer:Subscriptions` | `ServiceBusConsumerOptions` | Automatic (ASB transport) |
| `Whizbang:CircuitBreakers:<name>` | `CircuitBreakerOptions` | Automatic, per named breaker — see [Circuit Breakers](#circuit-breakers) |
| `Whizbang:Postgres:<database>` | `PostgresOptions` | Automatic (EF Core Postgres driver), per database — see [Postgres Databases](#postgres-databases) |
| `Whizbang:Tags:Coalesce:<tag>` | `CoalescePolicyOptions` | Automatic, per tag — see [Coalesce Bindings](#coalesce-bindings) |
| `Whizbang:Routing`, `Whizbang:Routing:ControlClass`, `Whizbang:Routing:PoisonMessages` | `RoutingOptions`, `ControlClassOptions`, `PoisonMessageOptions` | Opt-in (`.WithRouting(…)`) |
| *(any section you choose)* | the remaining shared shapes below | Code-configured / consumer-bound |

## Sections the Library Binds Automatically

### Whizbang:Tracing → TracingOptions

Bound by `AddWhizbang()` through an AOT-safe post-configure binder. Programmatic configuration (`options.Tracing` inside `AddWhizbang`) runs first; configuration keys override it. **Details:** [Tracing](../observability/tracing#tracingoptions-properties-reference).

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `Verbosity` | `TraceVerbosity` | `Off` | `Whizbang__Tracing__Verbosity` | Global verbosity; traces at or below this level are emitted |
| `Components` | `TraceComponents` (flags) | `None` | `Whizbang__Tracing__Components` | Which components emit traces |
| `EnableOpenTelemetry` | `bool` | `true` | `Whizbang__Tracing__EnableOpenTelemetry` | Emit OpenTelemetry spans via ActivitySource |
| `EnableStructuredLogging` | `bool` | `true` | `Whizbang__Tracing__EnableStructuredLogging` | Emit structured log messages via ILogger |
| `TracedHandlers:<name>` | `TraceVerbosity` | — | `Whizbang__Tracing__TracedHandlers__<name>` | Per-handler verbosity override (always traced regardless of global verbosity) |
| `TracedMessages:<name>` | `TraceVerbosity` | — | `Whizbang__Tracing__TracedMessages__<name>` | Per-message-type verbosity override |

Code-only (not read from configuration): `EnableWorkerBatchSpans` (default `false`), `EnablePerspectiveEventSpans` (default `false`) — set these in the `AddWhizbang` lambda.

### Whizbang:Database → WhizbangNotificationOptions

Bound during Postgres driver registration with a hand-rolled binder. Controls the LISTEN/NOTIFY work-signal listener. **Details:** no dedicated page yet; the wake semantics are covered in [Perspective Worker](../workers/perspective-worker#wake-semantics-notify--safety-net-polling).

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `SignalingMode` | `WorkSignalingMode` | `Auto` | `Whizbang__Database__SignalingMode` | Polling vs LISTEN/NOTIFY mode selection |
| `ConnectionStringKey` | `string?` | `null` | `Whizbang__Database__ConnectionStringKey` | `ConnectionStrings` key for the listener connection; resolution prefers `{key}-direct`, then `{key}` |
| `DirectConnectionString` | `string?` | `null` | `Whizbang__Database__DirectConnectionString` | Explicit direct connection string; overrides key-based lookup |
| `DisableNotifications` | `bool` | `false` | `Whizbang__Database__DisableNotifications` | Kill switch forcing polling-only mode |
| `PollingFallbackInterval` | `TimeSpan` | `00:00:30` | `Whizbang__Database__PollingFallbackInterval` | Safety-net polling cadence while the listener is healthy |
| `ListenKeepaliveInterval` | `TimeSpan` | `00:00:30` | `Whizbang__Database__ListenKeepaliveInterval` | Cadence of `SELECT 1` keepalive on the listener connection |
| `ListenReconnectInitialDelay` | `TimeSpan` | `00:00:01` | `Whizbang__Database__ListenReconnectInitialDelay` | First reconnect attempt delay after a disconnect |
| `ListenReconnectMaxDelay` | `TimeSpan` | `00:00:30` | `Whizbang__Database__ListenReconnectMaxDelay` | Cap on reconnect backoff |
| `ListenReconnectBackoffMultiplier` | `double` | `2.0` | `Whizbang__Database__ListenReconnectBackoffMultiplier` | Exponential growth factor for reconnect backoff |
| `TcpKeepAliveTime` | `int` (seconds) | `60` | `Whizbang__Database__TcpKeepAliveTime` | Idle seconds before the OS probes connection liveness |
| `TcpKeepAliveInterval` | `int` (seconds) | `10` | `Whizbang__Database__TcpKeepAliveInterval` | Seconds between keepalive probes once idle |

Code-only (not read from configuration): `SearchPath` (default: EF model schema), `SelfTestTimeout` (2s), `PeriodicReprobeInterval` (5m), `FailuresBeforeFallback` (5).

### Whizbang:Database:Stamper → CommitOrderStamperOptions

Bound alongside `Whizbang:Database`. Controls the per-database commit-order stamper singleton. **Details:** no dedicated page yet.

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `PollingInterval` | `TimeSpan` | `00:00:00.250` | `Whizbang__Database__Stamper__PollingInterval` | How often the lock-holder stamps pending commit sequences absent a NOTIFY |
| `LeaderElectionRetry` | `TimeSpan` | `00:00:01.500` | `Whizbang__Database__Stamper__LeaderElectionRetry` | How long a non-holder waits before retrying advisory-lock acquisition |
| `BatchSize` | `int` | `1000` | `Whizbang__Database__Stamper__BatchSize` | Max rows stamped per call |
| `DisableStamper` | `bool` | `false` | `Whizbang__Database__Stamper__DisableStamper` | Killswitch — worker exits early, never acquires the lock |
| `AdvisoryLockKey` | `long` | `0x57480001_5557_5048` | `Whizbang__Database__Stamper__AdvisoryLockKey` | Advisory lock key; must match across all instances sharing a database |

### Service Name and Banner

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `Whizbang:ServiceName` | `string` | assembly name | `Whizbang__ServiceName` | Logical service name used for instance registration and subscriptions; falls back to root-level `ServiceName`, then the entry assembly name |
| `Whizbang:ShowBanner` | `bool` | `true` | `Whizbang__ShowBanner` | Print the ASCII banner at startup (the version log line always prints) |

### ConnectionStrings Conventions

Whizbang resolves database connections through `ConnectionStrings:*` keys with these conventions (environment form `ConnectionStrings__<key>` — note there is **no** `Whizbang` prefix):

| Key pattern | Purpose |
|-------------|---------|
| `ConnectionStrings:{key}` | The pooled (e.g. pgbouncer) connection for a DbContext or notification listener |
| `ConnectionStrings:{key}-direct` | Preferred over `{key}` for connections that must bypass a transaction pooler: LISTEN/NOTIFY listeners, the commit-order stamper, and the pinned worker pool. Falls back to `{key}` when absent |
| `ConnectionStrings:{dbContextKey}` | Generated DbContext registration reads the key named for your DbContext registration |
| `ConnectionStrings:{dbContextKey}-init` | Optional higher-privilege connection used only for schema initialization/migrations |

### ConnectionPool (root section)

The generated DbContext registration reads a root-level `ConnectionPool` section (environment form `ConnectionPool__<Key>`) and applies the values to the Npgsql connection string:

| Key | Type | Environment variable | Purpose |
|-----|------|----------------------|---------|
| `ConnectionPool:MaxPoolSize` | `int` | — *code-only* | Npgsql `Maximum Pool Size` |
| `ConnectionPool:MinPoolSize` | `int` | — *code-only* | Npgsql `Minimum Pool Size` |
| `ConnectionPool:Timeout` | `int` (seconds) | — *code-only* | Npgsql connection `Timeout` |
| `ConnectionPool:CommandTimeout` | `int` (seconds) | — *code-only* | Npgsql `Command Timeout` |

## Per-Instance Sections

Some options classes have more than one instance in a process — several circuit breakers, one consumer per transport, one set of options per database — so a single global section cannot express them. Each of these binds from a section **keyed by the instance's name**. The values set in code stay the defaults; configuration overrides them **per key and per name**, and an instance with no section keeps its code values. A key under another instance's name never leaks into this one.

All of these read their keys by hand or through the configuration binder source generator, so none of them uses reflection (AOT-safe).

### Circuit Breakers

`Whizbang:CircuitBreakers:<name>` binds the `CircuitBreakerOptions` of the breaker named `<name>`. A breaker picks up its section by resolving its options **by name**:

```csharp{
title: "Bind a named circuit breaker"
description: "Code values are the defaults; Whizbang:CircuitBreakers:payments overrides them per key."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["configuration", "circuit-breaker", "named-options"]
unverified: "illustration - binding locked by CircuitBreakerOptionsConfigurationTests"
}
// Code values are the defaults for this breaker...
services.Configure<CircuitBreakerOptions>("payments", o => {
  o.FailureThreshold = 10;
});

// ...and Whizbang__CircuitBreakers__payments__FailureThreshold=3 overrides them.
var options = provider.GetRequiredService<IOptionsMonitor<CircuitBreakerOptions>>().Get("payments");
var breaker = new CircuitBreaker<Quote>(options, logger);
```

The unnamed instance (`IOptions<CircuitBreakerOptions>`) has no section and keeps its code values. Keys: every property in [CircuitBreakerOptions](#circuitbreakeroptions). {verified: CircuitBreakerOptionsConfigurationTests.NamedBreaker_PicksUpItsOwnKeys_AndNotAnotherBreakersAsync, CircuitBreakerOptionsConfigurationTests.UnnamedInstance_KeepsDefaultsAsync}

### Transport Sections

`Whizbang:Transports:<transport>`, where `<transport>` is `AzureServiceBus` or `RabbitMQ`, is the section of a transport. A transport's section is read **only when that transport is registered** (`AddAzureServiceBusTransport`, `AddRabbitMQTransport`); a section for a transport the host does not run is inert.

| Section | Options class | Read by |
|---------|---------------|---------|
| `Whizbang:Transports:AzureServiceBus` | [AzureServiceBusOptions](#azureservicebusoptions) | the Service Bus transport |
| `Whizbang:Transports:RabbitMQ` | [RabbitMQOptions](#rabbitmqoptions) | the RabbitMQ transport |
| `Whizbang:Transports:<transport>:MessageProcessing` | [MessageProcessingOptions](#messageprocessingoptions) | the transport consumer (`AddTransportConsumer`) |
| `Whizbang:Transports:<transport>:Batch` | [TransportBatchOptions](#transportbatchoptions) | the transport consumer |
| `Whizbang:Transports:<transport>:SubscriptionResilience` | [SubscriptionResilienceOptions](#subscriptionresilienceoptions) | the transport consumer |
| `Whizbang:Transports:<transport>:Consumer:AdditionalDestinations:<n>` | [TransportConsumerOptions](#transportconsumeroptions) `Destinations` | the transport consumer |
| `Whizbang:Transports:AzureServiceBus:Consumer:Subscriptions:<n>` | [ServiceBusConsumerOptions](#servicebusconsumeroptions) | `ServiceBusConsumerWorker`, when resolved from the container |

The transport consumer is named by the transport it consumes: there is one per host, and its `MessageProcessing`, `Batch`, `SubscriptionResilience` and `Consumer` children live under that transport's section.

```bash{
title: "Per-transport consumer keys"
description: "Each transport's section carries its own consumer, batch and resilience keys."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["configuration", "transports", "environment-variables"]
unverified: "illustration - binding locked by TransportConsumerOptionsConfigurationTests and RabbitMQOptionsConfigurationTests"
}
Whizbang__Transports__AzureServiceBus__MessageProcessing__MaxConcurrentMessages=20
Whizbang__Transports__AzureServiceBus__SubscriptionResilience__HealthCheckInterval=00:00:30
Whizbang__Transports__RabbitMQ__PrefetchCount=100
Whizbang__Transports__RabbitMQ__Batch__BatchSize=100
```

**Code values.** `MessageProcessingOptions` and `TransportBatchOptions` registered as an instance or a factory **before** `AddTransportConsumer` are kept, and configuration is applied over them. A type registration (`AddSingleton<TransportBatchOptions>()`) is constructed by the container, so there is nothing to bind over and it is left as registered. `SubscriptionResilienceOptions` set in the `AddTransportConsumer(config => config.ResilienceOptions…)` callback, and `RabbitMQOptions` set in the `AddRabbitMQTransport` callback, are likewise the defaults that configuration overrides. {verified: TransportConsumerOptionsConfigurationTests.RegisteredTransport_BindsEachConsumerSection_AndIgnoresOtherTransportsAsync, TransportConsumerOptionsConfigurationTests.InstanceRegisteredInCode_KeepsItsValues_ConfigurationOverridesPerKeyAsync, RabbitMQOptionsConfigurationTests.CodeCallback_StaysTheDefault_ConfigurationOverridesPerKeyAsync}

**Lists.** `Consumer:AdditionalDestinations` entries (`Address`, optional `RoutingKey`) are **added** to the destinations routing generates; an entry without an `Address`, or one the consumer already subscribes to, is skipped. `Consumer:Subscriptions` entries (`TopicName`, `SubscriptionName`, optional `DestinationFilter`) **replace** the code list when at least one entry has both names; a section with no complete entry leaves the code list alone.

### Postgres Databases

`Whizbang:Postgres:<database>` binds the [PostgresOptions](#postgresoptions) of one database, where `<database>` is the database's **connection-string name** — the same name `ConnectionStrings:<database>` uses. The EF Core Postgres driver (`.WithEFCore<TDbContext>().WithDriver.Postgres`) registers its DbContext's database: the name passed to `WithEFCore<T>("name")`, or the derived one (`OrdersDbContext` → `orders-db`).

```bash{
title: "Per-database Postgres keys"
description: "Whizbang:Postgres:<database> keys are the database's connection-string name."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["configuration", "postgres", "environment-variables"]
unverified: "illustration - binding locked by PostgresOptionsConfigurationTests"
}
Whizbang__Postgres__orders-db__CommandTimeoutSeconds=60
Whizbang__Postgres__orders-db__MaxInFlightCommands=20
```

Every registered database is reachable by name through `IOptionsMonitor<PostgresOptions>.Get("<database>")`. The unnamed instance, which the framework itself reads through `IOptions<PostgresOptions>` (the work-coordinator gate cap, collective apply), binds from the **first** database registered; with none registered it keeps its code values. `services.Configure<PostgresOptions>(…)` values are the defaults that configuration overrides. `AddWhizbangPostgresOptionsBinding("<database>")` registers a database by hand. {verified: PostgresOptionsConfigurationTests.NamedDatabase_PicksUpItsOwnKeys_AndNotAnotherDatabasesAsync, PostgresOptionsConfigurationTests.Driver_BindsTheDbContextsDatabase_IntoTheWorkCoordinatorGateAsync}

The Dapper driver's `AddWhizbangPostgres(…, configureOptions)` uses its options at registration time, before configuration is available, so it stays code-configured.

### Coalesce Bindings

`Whizbang:Tags:Coalesce:<tag>` is the bindable map beside `TagOptions.CoalesceBindings`. Each child is a tag; its keys override that tag's code policy, and a configured tag with no code policy gets one built from the defaults. A tag with no section keeps its code policy.

| Key | Type | Environment variable |
|-----|------|----------------------|
| `SlideSeconds` | `int` | `Whizbang__Tags__Coalesce__<tag>__SlideSeconds` |
| `MaxDelaySeconds` | `int` | `Whizbang__Tags__Coalesce__<tag>__MaxDelaySeconds` |
| `MaxBatchCount` | `int` | `Whizbang__Tags__Coalesce__<tag>__MaxBatchCount` |
| `Atomicity` | `FanoutAtomicity` | `Whizbang__Tags__Coalesce__<tag>__Atomicity` |
| `PriorityFold` | `CompositePriorityFold` | `Whizbang__Tags__Coalesce__<tag>__PriorityFold` |

The delegates (`CompositeFactory`, `PriorityFor`) are code-only. Setting `SlideSeconds` to `0` turns a tag's coalescing off without a redeploy. Configured policies are validated at startup like code ones. {verified: TagCoalesceConfigurationBinderTests.ConfiguredTag_OverridesItsCodePolicyPerKey_KeepingCodeOnlyMembersAsync, TagCoalesceConfigurationBinderTests.Resolver_SeesConfigurationBoundCoalesceBindingsAsync}

### What Stays Code-Only

- **`TransportOptions`** is an abstract base class with no concrete transport deriving from it, so nothing would read its keys. It has no section.
- **`ServiceBusInfrastructureOptions`** is not read by the framework, so it has no section.
- **`TransportConsumerOptions.SubscriberName`** is not read by the consumer; only `Destinations` binds.

## Opt-In Binding: Message Body Offload

Calling the helper reads both offload sections; without the call, both sections are inert and offload stays disabled:

```csharp{
title: "Opt into configuration-driven offload registration"
description: "One call reads Whizbang:Offloads:AzureBlob:* and Whizbang:BodyOffload from IConfiguration; without it both sections are inert."
framework: "NET10"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["configuration", "body-offload", "azure-blob", "binding"]
unverified: "wiring illustration - covered by the offload provider integration tests"
}
builder.Services.AddWhizbangAzureBlobOffloadsFromConfiguration(builder.Configuration);
```

Every child of `Whizbang:Offloads:AzureBlob` registers one named provider. The provider whose name matches `Whizbang:BodyOffload:ProviderName` becomes the active offload target. **Details:** [Message Body Store](../../fundamentals/offloads/message-body-store#end-to-end-di), [Azure Blob provider](../../fundamentals/offloads/providers/azure-blob).

### Whizbang:Offloads:AzureBlob:&lt;name&gt; → AzureBlobOffloadOptions

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `ConnectionString` | `string?` | `null` | `Whizbang__Offloads__AzureBlob__<name>__ConnectionString` | Azure Storage connection string (emulator or live) |
| `ContainerName` | `string` | `whizbang-offload-bodies` | `Whizbang__Offloads__AzureBlob__<name>__ContainerName` | Container holding offloaded bodies; lazily created on first upload |
| `DefaultAccessTier` | `AccessTier?` | `null` (account default) | `Whizbang__Offloads__AzureBlob__<name>__DefaultAccessTier` | Blob access tier for uploads (Hot/Cool/Cold/Archive) |
| `MaxDownloadBytes` | `long?` | `null` (no cap) | `Whizbang__Offloads__AzureBlob__<name>__MaxDownloadBytes` | Defensive cap on download size; refuses claims reporting a larger body |

### Whizbang:BodyOffload → MessageBodyOffloadOptions

The helper binds **four** keys from configuration; the rest of `MessageBodyOffloadOptions` is code-configured (see [its full table below](#messagebodyoffloadoptions)).

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `ProviderName` | `string?` | `null` (offload disabled) | `Whizbang__BodyOffload__ProviderName` | Must match a registered provider name |
| `SizeThresholdBytes` | `long` | `65536` (64 KB) | `Whizbang__BodyOffload__SizeThresholdBytes` | Body size at/above which offload kicks in |
| `ActiveCleanup` | `bool` | `false` | `Whizbang__BodyOffload__ActiveCleanup` | Delete the body explicitly after the inbox row is acked |
| `CipherName` | `string?` | `null` (bodies stored as serialized) | `Whizbang__BodyOffload__CipherName` | Names the cipher every offloaded body is sealed with; the cipher itself is registered from the `Cipher` subsection below |

### Whizbang:BodyOffload:Cipher → the built-in AES-256-GCM cipher

Read by the same helper (through `AddWhizbangBodyCipherFromConfiguration`) whenever `Whizbang:BodyOffload:CipherName` is set. A name without a valid key, or a half-configured rotation window, fails at startup naming the setting. **Details, key generation, rotation and the operations checklist:** [Message Body Store](../../fundamentals/offloads/message-body-store#cipher-from-settings). {verified: BodyCipherFromConfigurationTests.WithANameAndAKey_RegistersTheAesGcmCipherByName_AndNamesItOnTheOptionsAsync, BodyCipherFromConfigurationTests.WithANameButNoKey_ThrowsAtStartup_NamingTheSettingAsync, AzureBlobOffloadFromConfigurationTests.FromConfiguration_WithACipherInSettings_BindsTheCipherName_AndRegistersTheCipherAsync}

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `KeyId` | `string` | required with a cipher name | `Whizbang__BodyOffload__Cipher__KeyId` | Rotation label of the current key encryption key; recorded on every claim, never the key |
| `KeyEncryptionKey` | `string` (base64, 32 bytes) | required with a cipher name | `Whizbang__BodyOffload__Cipher__KeyEncryptionKey` | The current key encryption key; a secret, `openssl rand -base64 32` |
| `PreviousKeyId` | `string?` | `null` | `Whizbang__BodyOffload__Cipher__PreviousKeyId` | During a rotation window, the label being retired; requires `PreviousKeyEncryptionKey` |
| `PreviousKeyEncryptionKey` | `string?` (base64, 32 bytes) | `null` | `Whizbang__BodyOffload__Cipher__PreviousKeyEncryptionKey` | During a rotation window, the key being retired; a secret |

## Code-Configured Options: The Binding Recipe

Every other options class on this page is configured in code — typically an `Action<TOptions>` lambda on its registration call, or `services.Configure<TOptions>(...)`. The library never reads configuration for them, which keeps `Whizbang.Core` zero-reflection. To make any of them environment-tunable in **your** service, bind them yourself. Two flavors:

```csharp{
title: "Bind a code-configured options class from configuration"
description: "Two flavors for making any Whizbang options class environment-tunable: reflection binding for non-AOT services, manual key binding matching the library's AOT-safe convention."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["configuration", "options", "binding", "aot"]
unverified: "consumer-side wiring recipe - no single library test exercises it"
}
// Flavor 1 - reflection binding (fine when your service is not NativeAOT):
builder.Services.Configure<StreamIntegrityOptions>(
  builder.Configuration.GetSection("Whizbang:StreamIntegrity"));

// Flavor 2 - manual key binding (AOT-safe, mirrors the library's own convention):
var section = builder.Configuration.GetSection("Whizbang:StreamIntegrity");
builder.Services.Configure<StreamIntegrityOptions>(options => {
  if (int.TryParse(section["AuditIntervalMinutes"], out var minutes)) {
    options.AuditIntervalMinutes = minutes;
  }
  if (Enum.TryParse<IntegrityRepairMode>(section["RepairMode"], ignoreCase: true, out var mode)) {
    options.RepairMode = mode;
  }
  // ...one guard per key you want to expose
});
```

**Recommended section naming:** use `Whizbang:<Area>` (for example `Whizbang:StreamIntegrity`, `Whizbang:Workers:Claim`, `Whizbang:Workers:PinnedPool`) so environment variables follow the same `Whizbang__<Area>__<Key>` shape as the automatically-bound sections. The env-var examples in the sections below assume this convention — **they only work once the section is bound**.

**Framework-bound sections (no service code needed):** the worker pipeline binds `Whizbang:DeadLetterRecovery`, `Whizbang:Workers:TransportDeadLetterDrain`, `Whizbang:Workers:Claim`, and `Whizbang:Housekeeping` itself — setting those env vars just works. The binding is compile-time (configuration binder source generator), so it costs no reflection. Every other section still needs the service to bind it; the lesson behind this feature was a production kill switch (`Whizbang__DeadLetterRecovery__Enabled=false`) that sat on pods for weeks binding to nothing while the worker ran on code defaults.

> **Operational tip:** keep a service's bound sections documented next to its `Program.cs`. When someone later finds `Whizbang__X__Y` in a deployment manifest, the first question is always "does anything bind `Whizbang:X`?" — and for code-configured options the answer is "only if this service does".

## Core Behavior and Startup

### WhizbangCoreOptions

Entry point to subsystem configuration. **Configure:** `AddWhizbang(options => …)`. **Details:** [WhizbangCoreOptions](whizbang-options#properties).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `AutoRegisterAspNetHosting` | `bool` | `true` | — *code-only* | Fold in `AddWhizbangAspNet()` automatically when the Hosting.AspNet assembly is loaded |
| `EnableTagProcessing` | `bool` | `true` | — *code-only* | Master switch for message tag hooks |
| `TagProcessingMode` | `TagProcessingMode` | `AfterReceptorCompletion` | — *code-only* | When tag hooks run |
| `DefaultQueryScope` | `QueryScope` | `Tenant` | — *code-only* | Default scope filtering for `ILensQuery<TModel>.DefaultScope` |
| `ShowBanner` | `bool` | `true` | — *code-only* | Print the ASCII banner on startup |
| `ImmediateDetachedChainWarningThreshold` | `int` | `10` | — *code-only* | Warn when ImmediateDetached chain depth reaches a multiple of this |
| `EmptyStreamIdPolicy` | `EmptyStreamIdPolicy` | `Reject` | — *code-only* | Handling of `Guid.Empty` stream ids (see [Empty Stream ID Policy](empty-stream-id-policy)) |

Sub-option bags on this class: `Tags` ([TagOptions](#tagoptions)), `Tracing` ([TracingOptions](#whizbangtracing--tracingoptions)), `Services` ([ServiceRegistrationOptions](service-registration-options)).

### WhizbangOptions

Runtime guid-tracking and guardrail behavior. **Configure:** bound automatically from `Whizbang` — no registration call needed. `services.Configure<WhizbangOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `DisableGuidTracking` | `bool` | `false` | `Whizbang__DisableGuidTracking` | Disable TrackedGuid validation project-wide |
| `GuidOrderingViolationSeverity` | `GuidOrderingSeverity` | `Warning` | `Whizbang__GuidOrderingViolationSeverity` | Severity for time-ordering violations in IDs (`Error` also throws) |
| `ShowBanner` | `bool` | `true` | `Whizbang__ShowBanner` | Display the ASCII banner on startup |
| `AutoGenerateStreamIds` | `bool` | `true` | `Whizbang__AutoGenerateStreamIds` | Auto-generate a StreamId for `IHasStreamId` events with `Guid.Empty` |
| `Guardrails` | `WhizbangGuardrailsOptions` | `new()` | `Whizbang__Guardrails` | Receptor double-fire tracking (below) |

### WhizbangGuardrailsOptions

Guardrails for the "exactly once per receptor per message" contract. **Configure:** via `WhizbangOptions.Guardrails`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `ReceptorInvocationTracking` | `ReceptorInvocationTracking` | `TrackAndEnforce` | `Whizbang__Guardrails__ReceptorInvocationTracking` | Whether invocations are recorded and duplicates blocked |
| `OnDoubleFire` | `DoubleFireBehavior` | `Warn` | `Whizbang__Guardrails__OnDoubleFire` | On duplicate under enforcement: log + skip, or throw |
| `PersistInvocations` | `InvocationPersistence` | `Envelope` | `Whizbang__Guardrails__PersistInvocations` | Where records persist (`Envelope` = zero DB writes) |
| `EnableChaosHooks` | `bool` | `false` | `Whizbang__Guardrails__EnableChaosHooks` | Framework workers call `IChaosInjector` at named checkpoints |

### ServiceRegistrationOptions

**Configure:** `AddWhizbang(options => options.Services…)`. **Details:** [ServiceRegistrationOptions](service-registration-options#properties).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `IncludeSelfRegistration` | `bool` | `true` | — *code-only* | Register concrete types as themselves in addition to their interfaces |

### SchemaInitializationOptions

How the schema initializer runs at startup. **Configure:** bound automatically from `Whizbang:SchemaInitialization` — no registration call needed. `services.Configure<SchemaInitializationOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Database Readiness](../workers/database-readiness#who-marks-the-gate-ready), [Turnkey Initialization](../../data/turnkey-initialization#how-it-works).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `NonBlockingSchemaInit` | `bool` | `true` | `Whizbang__SchemaInitialization__NonBlockingSchemaInit` | Initialize in the background; liveness answers while the ready gate stays closed (fail-closed) |
| `MigrationTimeout` | `TimeSpan?` | `null` (none) | `Whizbang__SchemaInitialization__MigrationTimeout` | Hard ceiling per initialization attempt (non-blocking mode only) |
| `InitRetryDelay` | `TimeSpan` | `00:00:30` | `Whizbang__SchemaInitialization__InitRetryDelay` | Delay between background init attempts after a failure; never gives up |

### EphemeralOptions

Startup reconciliation of ephemeral-event settings drift. **Configure:** bound automatically from `Whizbang:Ephemeral` — no registration call needed. `services.Configure<EphemeralOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `ReconcileHistoricalOnStartup` | `bool` | `false` | `Whizbang__Ephemeral__ReconcileHistoricalOnStartup` | Act on settings drift (reclassify, stamp, offload) instead of detect/report only |

### WhizbangLifecycleOptions

Coordinated lifecycle state machine tunables. **Configure:** the run-control registration lambda. **Details:** [Managed Resource Run Control](../../resilience/managed-resource-run-control).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `TransitionAckTimeout` | `TimeSpan` | `00:00:30` | — *code-only* | Per-resource acknowledgement budget per coordinated transition; exceeding faults the system |
| `FaultRecordWindow` | `TimeSpan` | `00:00:05` | — *code-only* | How long the system stays Faulted (record/report) before Halted |

### StandbyWatcherOptions

Cadences for the rolling-upgrade standby handshake. **Configure:** `services.Configure<StandbyWatcherOptions>(…)`. **Details:** [Rolling Upgrades](../startup/rolling-upgrades#the-standby-handshake).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `PollInterval` | `TimeSpan` | `00:00:05` | — *code-only* | How often the watcher checks for an active standby request |
| `ObsolescenceInterval` | `TimeSpan` | `00:01:00` | — *code-only* | How often a serving instance re-assesses its verdict against the ledger |
| `RequesterLivenessWindow` | `TimeSpan` | `00:00:30` | — *code-only* | How stale the requester's heartbeat may be before its request is void |

### WhizbangHealthOptions

Maps managed-resource states to health per component. **Configure:** the health registration lambda; per-component overrides via the `Components` dictionary. **Details:** [Managed Resource Health](../../resilience/managed-resource-health).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Default` | `HealthPolicy` | `Lenient` | — *code-only* | Policy applied to any component without an explicit override |

### SignalBusOptions

Hosted signal bus wire-route self-test and doorbell liveness. **Configure:** bound automatically from `Whizbang:SignalBus` — no registration call needed. `services.Configure<SignalBusOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `ProbeTimeoutMilliseconds` | `int` | `5000` | `Whizbang__SignalBus__ProbeTimeoutMilliseconds` | Max time for a transport's loopback probe before the wire route is marked failed |
| `ReProbeIntervalMilliseconds` | `int` | `300000` (5m) | `Whizbang__SignalBus__ReProbeIntervalMilliseconds` | Runtime re-probe cadence |
| `MissedDoorbellThreshold` | `int` | `3` | `Whizbang__SignalBus__MissedDoorbellThreshold` | Consecutive poll-discovered work batches with no doorbell before the bus reports Degraded |

## Observability and Diagnostics

### UnobservedExceptionDiagnosticsOptions

**Configure:** bound automatically from `Whizbang:UnobservedExceptionDiagnostics` — no registration call needed. `services.Configure<UnobservedExceptionDiagnosticsOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `EnableFirstChanceExceptionLogging` | `bool` | `false` | `Whizbang__UnobservedExceptionDiagnostics__EnableFirstChanceExceptionLogging` | Log `AppDomain.FirstChanceException` at Debug (high volume; short diagnostic deploys only) |
| `FirstChanceExceptionTypeAllowList` | `IReadOnlyList<string>?` | `null` (all non-OCE) | `Whizbang__UnobservedExceptionDiagnostics__FirstChanceExceptionTypeAllowList` | Allow-list of exception type full names to log |

### DebuggerAwareClockOptions

**Configure:** `services.Configure<DebuggerAwareClockOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Mode` | `DebuggerDetectionMode` | `Auto` | — *code-only* | Detection mode for identifying paused states |
| `SamplingInterval` | `TimeSpan` | `00:00:00.100` | — *code-only* | CPU sampling interval for `CpuTimeSampling` mode |
| `FrozenThreshold` | `double` | `10.0` | — *code-only* | Wall/CPU time ratio above which execution counts as frozen |

## Work Coordination, Claims, and Leases

### WorkCoordinatorOptions

Flush strategy and lease behavior for work coordinator strategies. **Configure:** bound automatically from `Whizbang:WorkCoordinator` — no registration call needed. `services.Configure<WorkCoordinatorOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Work Coordinator Strategies](../../data/work-coordinator-strategies#workcoordinatoroptions-properties).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `PartitionCount` | `int` | `10000` | `Whizbang__WorkCoordinator__PartitionCount` | Total partitions for work distribution |
| `ParallelizeStreams` | `bool` | `false` | `Whizbang__WorkCoordinator__ParallelizeStreams` | Process different streams in parallel within an instance |
| `Strategy` | `WorkCoordinatorStrategy` | `Scoped` | `Whizbang__WorkCoordinator__Strategy` | Flush strategy (Immediate, Scoped, Interval) |
| `IntervalMilliseconds` | `int` | `100` | `Whizbang__WorkCoordinator__IntervalMilliseconds` | Batch-flush interval when `Strategy = Interval` |
| `DebugMode` | `bool` | `false` | `Whizbang__WorkCoordinator__DebugMode` | Keep completed messages for debugging |
| `LeaseSeconds` | `int` | `300` | `Whizbang__WorkCoordinator__LeaseSeconds` | Lease duration |
| `AbandonStaleInstanceThresholdSeconds` | `int` | `30` | `Whizbang__WorkCoordinator__AbandonStaleInstanceThresholdSeconds` | Grace period before a non-heartbeating instance is abandoned |
| `CoalesceWindowMilliseconds` | `int` | `0` | `Whizbang__WorkCoordinator__CoalesceWindowMilliseconds` | Window a Required flush waits to pick up queued items (Interval strategy; ~50ms recommended) |
| `BatchSize` | `int` | `100` | `Whizbang__WorkCoordinator__BatchSize` | Queued-message count triggering an immediate flush when `Strategy = Batch` |

### WorkCoordinatorGateOptions

{verified: WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_BindsTheGateFromConfigurationAsync, WorkCoordinatorGateRegistrationTests.AGateRegisteredBeforeThePipeline_IsKeptAsync}

The process-wide `WorkCoordinatorGate`: a cap on concurrent `IWorkCoordinator` calls and the deadline a caller waits for a slot. **Configure:** bound automatically by `AddWhizbang()` (through `AddWhizbangWorkers()`) from `Whizbang:WorkCoordinatorGate` (`Whizbang__WorkCoordinatorGate__MaxConcurrent`, `Whizbang__WorkCoordinatorGate__AcquireTimeoutMilliseconds`). **Details:** [Pinned Connection Pool](../../fundamentals/workers/pinned-connection-pool#coordinator-gate-exemption) for the callers that bypass the gate; [Perspective Worker](../workers/perspective-worker#drain-width-and-the-coordinator-gate) for how the perspective drain budgets against it.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `MaxConcurrent` | `int?` | unset (50 when nothing sets it) | `Whizbang__WorkCoordinatorGate__MaxConcurrent` | Cap on concurrent coordinator calls per process. Each slot holds at most one pooled connection, so the effective ceiling is `min(MaxConcurrent, Maximum Pool Size)`; 0 or less disables the gate |
| `AcquireTimeoutMilliseconds` | `int` | `30000` | `Whizbang__WorkCoordinatorGate__AcquireTimeoutMilliseconds` | How long a caller waits for a slot. On expiry the gate logs a Warning that names the current holders and lets the call through without a slot rather than hanging it; 0 or less waits without a deadline |
| `InteractiveReserve` | `int?` | one tenth of `MaxConcurrent`, rounded down (nothing under ten permits), never the whole gate | `Whizbang__WorkCoordinatorGate__InteractiveReserve` | Permits held back for callers running inside an interactive handling (the ambient parent is in the interactive bucket); everyone else can never take the last reserved permits. See [bulkheads](../../fundamentals/messaging/message-priority.md#bulkheads). 0 disables it. {verified: WorkCoordinatorGateInteractiveReserveTests.Reserve_DefaultsToOneTenthOfThePermits_AndNeverTheWholeGateAsync, WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_BindsTheInteractiveReserveFromConfigurationAsync, WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_WithInteractiveReserveZero_DisablesTheReserveAsync} |

Precedence for `MaxConcurrent`, lowest to highest:

1. The default, `WorkCoordinatorGateOptions.DefaultMaxConcurrent` (50), when neither of the next two set it.
2. A Postgres driver's `PostgresOptions.MaxInFlightCommands` (the EF Core `AddWhizbangPostgres` / `PostgresOptions` path, or the Dapper `AddWhizbangPostgres` overloads that take `MaxInFlightCommands`). The driver fills the gap only: it sets `MaxConcurrent` when the section left it unset.
3. The `Whizbang:WorkCoordinatorGate` section. A value set here is the operator's explicit word and is never overwritten by a driver. `AcquireTimeoutMilliseconds` always comes from the section.
4. A `WorkCoordinatorGate` the consumer registers in DI before the worker pipeline runs, which is kept as is.

Before this options class existed the pipeline built the gate with a literal 50, so `MaxInFlightCommands` was documented but reached nothing.

### ClaimWorkerOptions

The claim loop that distributes outbox/inbox/perspective work. **Configure:** bound by the framework from `Whizbang:Workers:Claim` (`Whizbang__Workers__Claim__FreshWorkShare=1.0` works with no service code); override in code via `services.Configure<ClaimWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__Claim__Enabled` | Killswitch; worker stays hosted but skips execution |
| `EnableSafetyNetPoll` | `bool` | `true` | `Whizbang__Workers__Claim__EnableSafetyNetPoll` | Run a safety-net poll on the NOTIFY-healthy cadence even when LISTEN/NOTIFY is healthy |
| `PollingIntervalMilliseconds` | `int` | `250` | `Whizbang__Workers__Claim__PollingIntervalMilliseconds` | Base polling cadence |
| `PollingMaxIntervalMilliseconds` | `int` | `10000` | `Whizbang__Workers__Claim__PollingMaxIntervalMilliseconds` | Adaptive backoff cap (constrained by `AbandonStaleInstanceThresholdSeconds`) |
| `NotifyHealthyPollingIntervalMilliseconds` | `int?` | `5000` | `Whizbang__Workers__Claim__NotifyHealthyPollingIntervalMilliseconds` | Relaxed base wait while the NOTIFY gate is healthy |
| `MaxStreamsPerBatch` | `int` | `1000` | `Whizbang__Workers__Claim__MaxStreamsPerBatch` | Cap on rows returned per `claim_work` call |
| `AdaptiveOutstandingBudget` | `bool` | `true` | `Whizbang__Workers__Claim__AdaptiveOutstandingBudget` | Bounds total claimed-but-unprocessed inbox rows. On by default now that it is per work category (reads inbox rows only) and row-bound (its headroom is passed to the store as `MaxAcquireRows`); set `false` to fall back to the churn-based claim window alone (see [Claim backpressure](../workers/claim-backpressure)) |
| `MaxPerspectiveDrainBacklog` | `int` | `2000` | `Whizbang__Workers__Claim__MaxPerspectiveDrainBacklog` | Perspective drain channel backlog (stream ids queued and not yet drained) above which the claim loop stops leasing new perspective work; re-emission of held work continues. `0` disables the cap |
| `FreshWorkShare` | `double` | `0.5` | `Whizbang__Workers__Claim__FreshWorkShare` | Share of each inbox batch reserved for fresh-head streams (head row never attempted). Weighted-fair and work-conserving: an empty class hands its share to the other. Raise toward `1.0` where interactive latency outranks backlog drain — strict oldest-first let a 28k-row retry backlog starve every new arrival |
| `PerspectiveOnly` | `bool` | `false` | `Whizbang__Workers__Claim__PerspectiveOnly` | Distribute only perspective work (set when the legacy publisher worker is registered) |
| `PartitionCount` | `int` | `10000` | `Whizbang__Workers__Claim__PartitionCount` | Modulo partition count |
| `LeaseSeconds` | `int` | `300` | `Whizbang__Workers__Claim__LeaseSeconds` | Lease duration applied to claimed work |

### HeartbeatWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:Heartbeat` — no registration call needed. `services.Configure<HeartbeatWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Instance Liveness](../../fundamentals/workers/instance-liveness).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__Heartbeat__Enabled` | Killswitch; without heartbeats peers eventually flag this instance stale |
| `IntervalSeconds` | `int` | `30` | `Whizbang__Workers__Heartbeat__IntervalSeconds` | Heartbeat cadence |
| `SlowIntervalSeconds` | `int` | `60` | `Whizbang__Workers__Heartbeat__SlowIntervalSeconds` | Relaxed cadence when the session-level alive-lock is held |
| `LivenessSourceMode` | `HeartbeatLivenessSourceMode` | `AdvisoryLockWhenAvailable` | `Whizbang__Workers__Heartbeat__LivenessSourceMode` | Adaptive (lock-aware) vs table-only cadence |

### LeaseHandleOptions

**Configure:** bound automatically from `Whizbang:Workers:LeaseHandle` — no registration call needed. `services.Configure<LeaseHandleOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `LeaseGraceSeconds` | `int` | `30` | `Whizbang__Workers__LeaseHandle__LeaseGraceSeconds` | Seconds before SQL `lease_expiry` at which the in-process token cancels |
| `MaxRenewalsPerWork` | `int` | `6` | `Whizbang__Workers__LeaseHandle__MaxRenewalsPerWork` | Cap on successful deadline extensions per work item |

### LeaseRenewalWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:LeaseRenewal` — no registration call needed. `services.Configure<LeaseRenewalWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__LeaseRenewal__Enabled` | Killswitch |
| `LeaseSeconds` | `int` | `300` | `Whizbang__Workers__LeaseRenewal__LeaseSeconds` | New lease duration applied per renewal |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=200, CoalesceWindowMs=200, ImmediateFlushThreshold=100, ChannelCapacity=5000 | `Whizbang__Workers__LeaseRenewal__Flusher` | Inner batch flusher tuning |

### BackupTickCoordinatorOptions

Zero-idle-polling backup tick. **Configure:** bound automatically from `Whizbang:Workers:BackupTick` — no registration call needed. `services.Configure<BackupTickCoordinatorOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__BackupTick__Enabled` | Killswitch |
| `IdleThreshold` | `TimeSpan` | `00:00:30` | `Whizbang__Workers__BackupTick__IdleThreshold` | Quiet period before ASLEEP→POLLING; below it, zero DB calls |
| `PollingInterval` | `TimeSpan` | `00:00:30` | `Whizbang__Workers__BackupTick__PollingInterval` | Backup-tick cadence while POLLING and NOTIFY healthy |
| `FastPollingInterval` | `TimeSpan` | `00:00:05` | `Whizbang__Workers__BackupTick__FastPollingInterval` | Cadence when the NOTIFY gate reports broken |

### WorkerRetryOptions

Completion retry with exponential backoff. **Configure:** via the owning worker's options (e.g. `PerspectiveWorkerOptions.RetryOptions`). **Details:** [Policy Engine](../infrastructure/policy-engine#worker-retry-with-exponential-backoff).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `RetryTimeoutSeconds` | `int` | `1` | `Whizbang__Workers__Perspective__RetryOptions__RetryTimeoutSeconds` | Base retry timeout; first retry after this duration |
| `EnableExponentialBackoff` | `bool` | `true` | `Whizbang__Workers__Perspective__RetryOptions__EnableExponentialBackoff` | Grow the timeout 1s→2s→4s→…→cap |
| `BackoffMultiplier` | `double` | `2.0` | `Whizbang__Workers__Perspective__RetryOptions__BackoffMultiplier` | `baseTimeout * multiplier^retryCount` |
| `MaxBackoffSeconds` | `int` | `60` | `Whizbang__Workers__Perspective__RetryOptions__MaxBackoffSeconds` | Cap on retry timeout; keep low — failing messages block streams |

## Outbox and Inbox Pipeline

### OutboxDrainWorkerOptions

The active outbox publish path. **Configure:** bound automatically from `Whizbang:Workers:OutboxDrain` — no registration call needed. `services.Configure<OutboxDrainWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__OutboxDrain__Enabled` | Killswitch; never enable together with `OutboxPublishWorkerOptions.Enabled` (double publish) |
| `MaxPerStream` | `int` | `100` | `Whizbang__Workers__OutboxDrain__MaxPerStream` | Cap on leased outbox rows drained per stream per iteration |
| `MaxBytesPerStream` | `long?` | `4194304` (4 MB) | `Whizbang__Workers__OutboxDrain__MaxBytesPerStream` | Cap on payload bytes fetched per stream per iteration |
| `MaxOutboxAttempts` | `int?` | `10` | `Whizbang__Workers__OutboxDrain__MaxOutboxAttempts` | Publish attempts before the row moves to `wh_dead_letters` |
| `MaxConcurrentStreams` | `int` | `16` | `Whizbang__Workers__OutboxDrain__MaxConcurrentStreams` | Distinct streams drained concurrently per batch (per-stream FIFO preserved) |
| `Batcher` | `SlidingWindowBatcherOptions` | MaxSize=100, SlidingWindow=50ms, MaxWait=1s | `Whizbang__Workers__OutboxDrain__Batcher` | Batching for drain signals |
| `SecurityContextTimeoutSeconds` | `int` | `10` | `Whizbang__Workers__OutboxDrain__SecurityContextTimeoutSeconds` | Timeout for per-message security-context establishment |
| `PublishTimeoutSeconds` | `int` | `60` | `Whizbang__Workers__OutboxDrain__PublishTimeoutSeconds` | Timeout for the transport publish call; 0 disables |

### OutboxPublishWorkerOptions

Legacy publish path (rollback escape hatch). **Configure:** bound automatically from `Whizbang:Workers:OutboxPublish` — no registration call needed. `services.Configure<OutboxPublishWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `false` | `Whizbang__Workers__OutboxPublish__Enabled` | Off by default — `OutboxDrainWorker` is the active path |
| `MaxBulkPublishBatchSize` | `int` | `100` | `Whizbang__Workers__OutboxPublish__MaxBulkPublishBatchSize` | Max batch size per bulk-publish call |
| `TransportNotReadyRetryDelayMilliseconds` | `int` | `100` | `Whizbang__Workers__OutboxPublish__TransportNotReadyRetryDelayMilliseconds` | Wait after a transport not-ready re-buffer |
| `MaxOutboxAttempts` | `int?` | `10` | `Whizbang__Workers__OutboxPublish__MaxOutboxAttempts` | Dead-letter threshold; `null` restores retry-forever |

### InboxDrainWorkerOptions

The only source of `InboxWork`. **Configure:** bound automatically from `Whizbang:Workers:InboxDrain` — no registration call needed. `services.Configure<InboxDrainWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__InboxDrain__Enabled` | Killswitch; disabling stops inbox dispatch entirely |
| `MaxPerStream` | `int` | `100` | `Whizbang__Workers__InboxDrain__MaxPerStream` | Cap on leased inbox rows drained per stream per iteration |
| `MaxBytesPerStream` | `long?` | `4194304` (4 MB) | `Whizbang__Workers__InboxDrain__MaxBytesPerStream` | Cap on payload bytes per fetch per stream |
| `Batcher` | `SlidingWindowBatcherOptions` | MaxSize=100, SlidingWindow=50ms, MaxWait=1s | `Whizbang__Workers__InboxDrain__Batcher` | Batching for drain signals |

### InboxDispatchWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:InboxDispatch` — no registration call needed. `services.Configure<InboxDispatchWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__InboxDispatch__Enabled` | Killswitch |
| `MaxInboxAttempts` | `int?` | `10` | `Whizbang__Workers__InboxDispatch__MaxInboxAttempts` | Total attempts before terminal commit (dead-letter) |
| `PartitionCount` | `int` | `10000` | `Whizbang__Workers__InboxDispatch__PartitionCount` | Modulo partition count |
| `MaxConcurrentDispatch` | `int` | `8` | `Whizbang__Workers__InboxDispatch__MaxConcurrentDispatch` | Parallel dispatch consumers; same-stream messages keep per-stream FIFO |
| `SecurityContextTimeoutSeconds` | `int` | `10` | `Whizbang__Workers__InboxDispatch__SecurityContextTimeoutSeconds` | Timeout for per-message security-context establishment; 0 disables |

### InboxHandlerWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:InboxHandler` — no registration call needed. `services.Configure<InboxHandlerWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__InboxHandler__Enabled` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=100, CoalesceWindowMs=25, ImmediateFlushThreshold=50, ChannelCapacity=5000 | `Whizbang__Workers__InboxHandler__Flusher` | Inner batch flusher tuning |

### OutboxCompletionFlushWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:OutboxCompletionFlush` — no registration call needed. `services.Configure<OutboxCompletionFlushWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__OutboxCompletionFlush__Enabled` | Killswitch; producers still enqueue, nothing drains |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=500, CoalesceWindowMs=10, ImmediateFlushThreshold=250, ChannelCapacity=10000 | `Whizbang__Workers__OutboxCompletionFlush__Flusher` | Inner batch flusher tuning |

### FailureFlushWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:FailureFlush` — no registration call needed. `services.Configure<FailureFlushWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__FailureFlush__Enabled` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=100, CoalesceWindowMs=100, ImmediateFlushThreshold=50, ChannelCapacity=5000 | `Whizbang__Workers__FailureFlush__Flusher` | Inner batch flusher tuning |

### BatchFlusherOptions

Shared tuning shape for the flush workers above. **Configure:** bound as the owning worker's `Flusher`, so these keys work from configuration with no service code — `Whizbang__Workers__FailureFlush__Flusher__MaxBatchSize` and the equivalents for `InboxHandler`, `LeaseRenewal`, `OutboxCompletionFlush` and `PerspectiveCompletionFlush`. The defaults below are this shape's own; each worker overrides some of them, and the per-worker `Flusher` rows above state the effective values.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `ChannelCapacity` | `int` | `10000` | `Whizbang__Workers__<Worker>__Flusher__ChannelCapacity` | Bounded channel capacity (back-pressure when full) |
| `MaxBatchSize` | `int` | `500` | `Whizbang__Workers__<Worker>__Flusher__MaxBatchSize` | Max items per flush call |
| `CoalesceWindowMs` | `int` | `25` | `Whizbang__Workers__<Worker>__Flusher__CoalesceWindowMs` | Max ms coalescing additional items after the first |
| `ImmediateFlushThreshold` | `int` | `250` | `Whizbang__Workers__<Worker>__Flusher__ImmediateFlushThreshold` | Flush immediately if the batch reaches this first |
| `MaxFlushAttempts` | `int` | `5` | `Whizbang__Workers__<Worker>__Flusher__MaxFlushAttempts` | Consecutive failed flushes of one batch before it is dropped |
| `FlushRetryBackoffMs` | `int` | `250` | `Whizbang__Workers__<Worker>__Flusher__FlushRetryBackoffMs` | Backoff before the first retry of a failed flush; doubles per attempt |
| `FlushRetryMaxBackoffMs` | `int` | `5000` | `Whizbang__Workers__<Worker>__Flusher__FlushRetryMaxBackoffMs` | Cap on the retry backoff |

A flush that throws is retried in place with the same batch (Warning, EventId 1: `BatchFlusher flush failed for batch of {Count} (attempt {Attempt} of {MaxAttempts}); retrying the same batch in {BackoffMs}ms`) rather than discarded. The items are completions, lease renewals and failures, so a dropped batch leaves its rows leased until their lease expires, after which they are re-claimed and redone; that consequence is named in the Error (EventId 3) logged when `MaxFlushAttempts` is exhausted, and the count is visible on the flusher's `ItemsDropped` counter beside `ItemsFlushed`. {verified: BatchFlusherRetryTests.FlushFailsOnce_RetriesTheSameBatchAndDeliversItAsync, BatchFlusherRetryTests.FlushAlwaysFails_DropsAfterMaxAttemptsAndNamesTheConsequenceAsync}

### MessageProcessingOptions

Transport consumer concurrency and inbox batching. **Configure:** bound from `Whizbang:Transports:<transport>:MessageProcessing` when that transport is registered ([Transport Sections](#transport-sections)); an instance or factory registered before `AddTransportConsumer` supplies the code values configuration overrides. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxConcurrentMessages` | `int` | `40` | `Whizbang__Transports__<transport>__MessageProcessing__MaxConcurrentMessages` | Max messages processed concurrently across all subscriptions; 0 disables |
| `InboxBatchSize` | `int` | `100` | `Whizbang__Transports__<transport>__MessageProcessing__InboxBatchSize` | Inbox messages collected before flushing the dedup batch |
| `InboxBatchSlideMs` | `int` | `50` | `Whizbang__Transports__<transport>__MessageProcessing__InboxBatchSlideMs` | Sliding window; resets on each enqueue |
| `InboxBatchMaxWaitMs` | `int` | `1000` | `Whizbang__Transports__<transport>__MessageProcessing__InboxBatchMaxWaitMs` | Hard max wait from the first message in a batch |

### TransportBatchOptions

Transport-level batch collection before `process_work_batch`. **Configure:** bound from `Whizbang:Transports:<transport>:Batch` when that transport is registered ([Transport Sections](#transport-sections)); an instance or factory registered before `AddTransportConsumer` supplies the code values configuration overrides. **Details:** [Transports](../../messaging/transports/transports#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `BatchSize` | `int` | `200` | `Whizbang__Transports__<transport>__Batch__BatchSize` | Messages collected before flushing immediately |
| `SlideMs` | `int` | `20` | `Whizbang__Transports__<transport>__Batch__SlideMs` | Sliding window; resets on each enqueue |
| `MaxWaitMs` | `int` | `1000` | `Whizbang__Transports__<transport>__Batch__MaxWaitMs` | Hard max wait regardless of arrivals |

### SlidingWindowBatcherOptions

Shared batching shape (drain signals). **Configure:** bound as the owning worker's `Batcher` (`InboxDrain`, `OutboxDrain`) or `DrainBatcher` (`Perspective`), so these keys work from configuration with no service code — for example `Whizbang__Workers__InboxDrain__Batcher__MaxSize`.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxSize` | `int` | `100` | `Whizbang__Workers__<Worker>__Batcher__MaxSize` | Max items in a batch; flushed as soon as reached |
| `SlidingWindow` | `TimeSpan` | `00:00:00.050` | `Whizbang__Workers__<Worker>__Batcher__SlidingWindow` | Quiet period after the last arrival |
| `MaxWait` | `TimeSpan` | `00:00:01` | `Whizbang__Workers__<Worker>__Batcher__MaxWait` | Hard cap on wait from the first arrival |

### SlidingWindowInboxOptions / SlidingWindowOutboxOptions / SlidingWindowApplyOptions

Per-stream debounce strategies for the inbox, outbox, and perspective-apply boundaries. **Configure:** the inbox and outbox shapes bind automatically from `Whizbang:Workers:InboxBatch` and `Whizbang:Workers:OutboxBatch` — no registration call needed, and `services.Configure<T>(…)` still applies and runs first. The apply shape (`SlidingWindowApplyOptions`) has no configuration section and is code-configured. **Details:** no dedicated page yet.

| Property | Type | Inbox default | Outbox default | Apply default | Environment variable (inbox / outbox) | Purpose |
|----------|------|---------------|----------------|---------------|----------------------------------------|---------|
| `SlidingWindow` | `TimeSpan` | 300ms | 50ms | 300ms | `Whizbang__Workers__InboxBatch__SlidingWindow` / `Whizbang__Workers__OutboxBatch__SlidingWindow` | Per-stream debounce after the last signal |
| `MaxWait` | `TimeSpan` | 3s | 1s | 3s | `Whizbang__Workers__InboxBatch__MaxWait` / `Whizbang__Workers__OutboxBatch__MaxWait` | Hard cap from the first signal in a batch |
| `MaxSize` | `int` | 1000 | 100 | 1000 | `Whizbang__Workers__InboxBatch__MaxSize` / `Whizbang__Workers__OutboxBatch__MaxSize` | Max signals per stream batch |
| `IdleEvictionWindow` | `TimeSpan` | 30s | 30s | 30s | `Whizbang__Workers__InboxBatch__IdleEvictionWindow` / `Whizbang__Workers__OutboxBatch__IdleEvictionWindow` | Evict a stream's buffer after this idle duration |
| `IdleSweepInterval` | `TimeSpan` | 10s | 10s | 10s | `Whizbang__Workers__InboxBatch__IdleSweepInterval` / `Whizbang__Workers__OutboxBatch__IdleSweepInterval` | How often the idle sweep runs |

### PerStreamSerializerOptions

**Configure:** `services.Configure<PerStreamSerializerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `StreamChannelCapacity` | `int` | `1000` | — *code-only* | Bounded per-stream channel capacity (backpressure) |
| `DrainBatchWindow` | `TimeSpan` | `00:00:00.050` | — *code-only* | Drain accumulator window; `Zero` disables batching |
| `IdleEvictionWindow` | `TimeSpan` | `00:00:30` | — *code-only* | Evict a stream's channel + worker after this idle duration |
| `IdleSweepInterval` | `TimeSpan` | `00:00:10` | — *code-only* | Idle sweep cadence |

### OrderedStreamProcessorOptions

**Configure:** bound automatically from `Whizbang:OrderedStreamProcessor` — no registration call needed. `services.Configure<OrderedStreamProcessorOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `ParallelizeStreams` | `bool` | `false` | `Whizbang__OrderedStreamProcessor__ParallelizeStreams` | Process different streams concurrently within an instance |

### InboxDeserializeCacheOptions

**Configure:** bound automatically from `Whizbang:Workers:InboxDeserializeCache` — no registration call needed. `services.Configure<InboxDeserializeCacheOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__InboxDeserializeCache__Enabled` | Killswitch — false re-deserializes from JSON on every dispatch |
| `TtlMinutes` | `int` | `2` | `Whizbang__Workers__InboxDeserializeCache__TtlMinutes` | Entry TTL; covers redelivery + lease re-claim cycles |
| `MaxEntries` | `int` | `10000` | `Whizbang__Workers__InboxDeserializeCache__MaxEntries` | Hard cap; oldest ~10% evict on next insert when exceeded |

### RecentlyProcessedEventCacheOptions

**Configure:** bound automatically from `Whizbang:Workers:RecentlyProcessedEventCache` — no registration call needed. `services.Configure<RecentlyProcessedEventCacheOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__RecentlyProcessedEventCache__Enabled` | Killswitch — false disables the cooldown short-circuit gate |
| `TtlMinutes` | `int` | `5` | `Whizbang__Workers__RecentlyProcessedEventCache__TtlMinutes` | Entry TTL; covers cursor-flush races and orphan-claim cycles |
| `MaxEntries` | `int` | `100000` | `Whizbang__Workers__RecentlyProcessedEventCache__MaxEntries` | Hard cap; oldest ~10% evict on next insert |
| `SweepIntervalSeconds` | `int` | `60` | `Whizbang__Workers__RecentlyProcessedEventCache__SweepIntervalSeconds` | Background sweep cadence for expired entries |

### RedeliveryPumpOptions

Re-delivery (repair) pump bounds. **Configure:** `services.Configure<RedeliveryPumpOptions>(…)`. **Details:** [Stream Integrity](../../resilience/stream-integrity).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxInnerEventsPerComposite` | `int` | `500` | — *code-only* | Repair slices larger than this split into multiple composites |
| `MaxEventsPerRequest` | `int` | `10000` | — *code-only* | Hard per-request event cap the origin enforces (clamps, never raises) |
| `MaxBytesPerComposite` | `int` | `192000` | — *code-only* | Byte budget per composite over raw stored bodies |
| `SelectPageSize` | `int` | `500` | — *code-only* | Origin-side selection page size |
| `PublishRetryAttempts` | `int` | `5` | — *code-only* | Attempts per composite send before the serve surfaces failure |
| `PublishRetryBaseDelayMs` | `int` | `2000` | — *code-only* | Base retry delay; attempt n waits base × 2^(n-1), capped at 30s |

## Perspectives

### PerspectiveWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:Perspective` — no registration call needed. `services.Configure<PerspectiveWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Perspective Worker](../workers/perspective-worker#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `PollingIntervalMilliseconds` | `int` | `1000` | `Whizbang__Workers__Perspective__PollingIntervalMilliseconds` | Wake cadence when no NOTIFY signal is in flight and the listener is unavailable |
| `NotifyHealthyPollingIntervalMilliseconds` | `int` | `1000` | `Whizbang__Workers__Perspective__NotifyHealthyPollingIntervalMilliseconds` | Safety-net cadence when LISTEN/NOTIFY is verified healthy |
| `MaxPerspectiveEventAttempts` | `int?` | `10` | `Whizbang__Workers__Perspective__MaxPerspectiveEventAttempts` | Apply failures (`failures` column) before moving to `wh_dead_letters`; `attempts` counts leases and is diagnostic only |
| `LeaseSeconds` | `int` | `300` | `Whizbang__Workers__Perspective__LeaseSeconds` | Lease duration for claimed perspective cursors |
| `AbandonStaleInstanceThresholdSeconds` | `int` | `30` | `Whizbang__Workers__Perspective__AbandonStaleInstanceThresholdSeconds` | Grace period before a non-heartbeating instance is abandoned |
| `InstanceMetadata` | `Dictionary<string, JsonElement>?` | `null` | `Whizbang__Workers__Perspective__InstanceMetadata` | Optional metadata attached to this service instance |
| `DebugMode` | `bool` | `false` | `Whizbang__Workers__Perspective__DebugMode` | Keep completed checkpoints for debugging |
| `PartitionCount` | `int` | `10000` | `Whizbang__Workers__Perspective__PartitionCount` | Partitions for work distribution |
| `IdleThresholdPolls` | `int` | `2` | `Whizbang__Workers__Perspective__IdleThresholdPolls` | Consecutive empty polls before `OnWorkProcessingIdle` |
| `PerspectiveBatchSize` | `int` | `100` | `Whizbang__Workers__Perspective__PerspectiveBatchSize` | Events processed per batch before saving model + checkpoint |
| `MaxConcurrentPerspectives` | `int` | `30` | `Whizbang__Workers__Perspective__MaxConcurrentPerspectives` | Max perspective groups processed concurrently per batch; the effective per-consumer width is clamped against the coordinator gate (note below) |
| `MaxConcurrentDrainConsumers` | `int` | `4` | `Whizbang__Workers__Perspective__MaxConcurrentDrainConsumers` | Parallel consumer loops on the channel reader; consumers × per-consumer width may use at most half of `WorkCoordinatorGateOptions.MaxConcurrent` (note below) |
| `MaxStreamsPerBatch` | `int` | `300` | `Whizbang__Workers__Perspective__MaxStreamsPerBatch` | Max streams returned per batch from the SQL function |
| `DrainLoopMaxIterations` | `int` | `5` | `Whizbang__Workers__Perspective__DrainLoopMaxIterations` | Cap on per-stream drain-loop refetch iterations; 1 disables |
| `DrainLoopRefetchMinBatch` | `int` | `2` | `Whizbang__Workers__Perspective__DrainLoopRefetchMinBatch` | Minimum events in an iteration to trigger a refetch |
| `DrainBatcher` | `SlidingWindowBatcherOptions` | SlidingWindow=300ms, MaxWait=3s, MaxSize=1000 | `Whizbang__Workers__Perspective__DrainBatcher` | The perspective apply-batching window |
| `RetryOptions` | `WorkerRetryOptions` | `new()` | `Whizbang__Workers__Perspective__RetryOptions` | Completion-acknowledgement retry |

`PerspectiveWorker` clamps its per-consumer drain width to `max(1, min(requested, MaxConcurrent / 2 / MaxConcurrentDrainConsumers))`, so the drain can never hold every gate slot while the completion flusher and lease renewal wait for one. With the defaults (4 consumers against a 50-slot gate) each consumer runs at most 6 (stream, perspective) groups at a time, so raising `MaxConcurrentPerspectives` alone changes nothing until the gate cap (`MaxConcurrent`, or `MaxInFlightCommands` with a Postgres driver) is raised with it. A disabled gate (`MaxConcurrent` of 0 or less) leaves the width as requested. The clamp is logged once at Warning (EventId 61). See [Perspective Worker](../workers/perspective-worker#drain-width-and-the-coordinator-gate). {verified: PerspectiveWorkerParallelismTests.ClampWidthToGate_LeavesHalfTheGateForEverythingElseAsync, PerspectiveWorkerParallelismTests.ClampWidthToGate_NeverBelowOne_AndIgnoresADisabledGateAsync}

### PerspectiveCompletionFlushWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:PerspectiveCompletionFlush` — no registration call needed. `services.Configure<PerspectiveCompletionFlushWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__PerspectiveCompletionFlush__Enabled` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=1000, CoalesceWindowMs=25, ImmediateFlushThreshold=500, ChannelCapacity=20000 | `Whizbang__Workers__PerspectiveCompletionFlush__Flusher` | Inner batch flusher tuning |

### PerspectiveSnapshotOptions

**Configure:** `services.Configure<PerspectiveSnapshotOptions>(…)`. **Details:** [Snapshots](../../fundamentals/perspectives/snapshots).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `SnapshotEveryNEvents` | `int` | `100` | — *code-only* | Create a snapshot every N events processed |
| `MaxSnapshotsPerStream` | `int` | `5` | — *code-only* | Snapshots kept per (stream, perspective); oldest pruned |
| `EphemeralSnapshotEveryNEvents` | `int` | `10` | — *code-only* | Snapshot cadence for EPHEMERAL perspectives |
| `EphemeralMaxSnapshotsPerStream` | `int` | `1` | — *code-only* | Snapshots kept for EPHEMERAL perspectives — single slot |
| `Enabled` | `bool` | `true` | — *code-only* | When false, rewinds replay from event zero |
| `RewindSnapshotIntervalEvents` | `int` | `10` | — *code-only* | Extra snapshot every N events applied during a rewind replay |
| `UpgradePolicy` | `SnapshotUpgradePolicy` | `RebuildFromEvents` | — *code-only* | Action when a stored snapshot's serialization version is stale |

### PerspectiveRewindOptions

**Configure:** `services.Configure<PerspectiveRewindOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Enabled` | `bool` | `true` | — *code-only* | Master switch; when off, out-of-order events are detected but not replayed |
| `StartupScanEnabled` | `bool` | `true` | — *code-only* | Scan for `RewindRequired` cursors and repair on startup |
| `StartupRewindMode` | `RewindStartupMode` | `Blocking` | — *code-only* | Startup rewinds block polling vs run in background |
| `MaxConcurrentRewinds` | `int` | `3` | — *code-only* | Cap on concurrent rewind operations |
| `DebounceWindow` | `TimeSpan` | `00:00:05` | — *code-only* | Sliding window before executing a rewind |
| `MaxDebounceWindow` | `TimeSpan` | `00:00:30` | — *code-only* | Hard cap on debounce duration |

### PerspectiveStreamLockOptions

**Configure:** `services.Configure<PerspectiveStreamLockOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `LockTimeout` | `TimeSpan` | `00:00:30` | — *code-only* | Lock validity; must exceed `KeepAliveInterval` |
| `KeepAliveInterval` | `TimeSpan` | `00:00:10` | — *code-only* | Keepalive renewal cadence; must be < LockTimeout/2 |

### PerspectiveStreamAffinityOptions

Intra-pod per-stream serialization gate. **Configure:** `services.Configure<PerspectiveStreamAffinityOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `IdleEvictionWindow` | `TimeSpan` | `00:15:00` | — *code-only* | Idle duration before a stream's gate entry is evictable |
| `SweepInterval` | `TimeSpan` | `00:01:00` | — *code-only* | Minimum time between sweeps |
| `LongHoldWarning` | `TimeSpan` | `00:01:00` | — *code-only* | Age at which a held (stream, perspective) gate is named at Warning (EventId 64) by the affinity-hold watchdog; `00:00:00` turns the watchdog off |

The watchdog runs every `max(5 s, LongHoldWarning / 2)` and reports each hold once when it crosses the threshold and once per further threshold while it persists, naming the processing path and the step the holder is in. See [Perspective Worker](../workers/perspective-worker#affinity-hold-watchdog). {verified: PerspectiveWorkerAffinityHoldWatchdogTests.LongHold_IsNamedAtWarning_OncePerThresholdAsync, PerspectiveWorkerAffinityHoldWatchdogTests.WatchdogOff_ReportsNothingAsync}

### PerspectiveRowRetentionOptions

Operator rung of the row-retention override ladder. **Configure:** bound automatically from `Whizbang:PerspectiveRowRetention` — no registration call needed. `services.Configure<PerspectiveRowRetentionOptions>(…)` still applies and runs before configuration, so a configuration key overrides it.; per-model TTLs via the `Overrides` dictionary (full CLR name → seconds, `null` disables). **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__PerspectiveRowRetention__Enabled` | Global kill switch; false resolves every model to no-TTL |

## Maintenance

### MaintenanceWorkerOptions

**Configure:** bound automatically from `Whizbang:Workers:Maintenance` — no registration call needed. `services.Configure<MaintenanceWorkerOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Stuck Row Sentinel](../observability/stuck-row-sentinel#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__Maintenance__Enabled` | Killswitch |
| `AllowTableRewrite` | `bool` | `false` | `Whizbang__Workers__Maintenance__AllowTableRewrite` | Whether maintenance may rewrite a table to reclaim space; false = report only |
| `IntervalMinutes` | `int` | `10` | `Whizbang__Workers__Maintenance__IntervalMinutes` | Minutes between maintenance runs |
| `StuckRowSentinelEnabled` | `bool` | `true` | `Whizbang__Workers__Maintenance__StuckRowSentinelEnabled` | Emit a Warning per stuck outbox/inbox row once per cycle |
| `StuckRowSentinelMaxAttempts` | `int` | `10` | `Whizbang__Workers__Maintenance__StuckRowSentinelMaxAttempts` | Stuck = `attempts > this` and unprocessed |
| `StuckRowSentinelLimit` | `int` | `50` | `Whizbang__Workers__Maintenance__StuckRowSentinelLimit` | Cap on reported stuck rows per cycle |
| `DestructionRetryBackoffSeconds` | `int` | `300` | `Whizbang__Workers__Maintenance__DestructionRetryBackoffSeconds` | Backoff before a failed destruction batch is re-offered |
| `MaxDestructionRetries` | `int` | `5` | `Whizbang__Workers__Maintenance__MaxDestructionRetries` | Retries of a failing destruction batch before a forced delete |
| `OnDestroyFailure` | `OnDestroyFailure` | `RetryThenForcedDelete` | `Whizbang__Workers__Maintenance__OnDestroyFailure` | Policy when a `PreDestruction` hook keeps failing |
| `RowReapBatchSize` | `int` | `5000` | `Whizbang__Workers__Maintenance__RowReapBatchSize` | Rows deleted per perspective per cycle by the expiry sweep |
| `LifecycleCompletionRetentionDays` | `int` | `7` | `Whizbang__Workers__Maintenance__LifecycleCompletionRetentionDays` | Days a lifecycle-completion marker is kept before the sweep removes it; `0` disables the sweep |
| `RowCapSweepClaimWindowMinutes` | `int` | `60` | `Whizbang__Workers__Maintenance__RowCapSweepClaimWindowMinutes` | Minimum minutes between cap sweeps service-wide |
| `RowGuardCollectLimit` | `int` | `500` | `Whizbang__Workers__Maintenance__RowGuardCollectLimit` | Rows offered per guarded perspective per cycle |
| `RowCascadeDrainLimit` | `int` | `1000` | `Whizbang__Workers__Maintenance__RowCascadeDrainLimit` | Origin evictions claimed from the journal per cycle |
| `SettledFoldIdleDays` | `int` | `90` | `Whizbang__Workers__Maintenance__SettledFoldIdleDays` | Idle days before a stream counts as settled |
| `SettledFoldBatchSize` | `int` | `1000` | `Whizbang__Workers__Maintenance__SettledFoldBatchSize` | Streams folded per settled-fold sweep |
| `SettledFoldClaimWindowHours` | `int` | `24` | `Whizbang__Workers__Maintenance__SettledFoldClaimWindowHours` | Minimum hours between settled folds service-wide |

## Stream Integrity

### StreamIntegrityOptions

Self-healing continuity checking; the defaults are the recommended posture. **Configure:** bound automatically from `Whizbang:StreamIntegrity` — no registration call needed. `services.Configure<StreamIntegrityOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** [Stream Integrity](../../resilience/stream-integrity#how-the-phases-unfold-from-a-cold-start).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `CheckpointsEnabled` | `bool` | `true` | `Whizbang__StreamIntegrity__CheckpointsEnabled` | Publish periodic continuity checkpoints. Off: unpublished checkpoints are swept from the outbox each maintenance cycle |
| `CheckpointIntervalSeconds` | `int` | `60` | `Whizbang__StreamIntegrity__CheckpointIntervalSeconds` | Checkpoint cadence |
| `GapDetectionEnabled` | `bool` | `true` | `Whizbang__StreamIntegrity__GapDetectionEnabled` | Verify received counts against other origins' checkpoints. Off: received checkpoints are swept from the inbox each maintenance cycle |
| `RepairMode` | `IntegrityRepairMode` | `ReportOnly` | `Whizbang__StreamIntegrity__RepairMode` | What to do with a confirmed gap: report and let an operator decide; `AutoRepairCapped` is the opt-in to self-healing with storm caps. Bilateral: a `ReportOnly` service also declines re-delivery requests as an origin, drops re-delivery bundles as a consumer, and sweeps parked repair rows in maintenance, so healing needs the opt-in on both sides |
| `MaxAutoRepairRequestsPerCheckpoint` | `int` | `10` | `Whizbang__StreamIntegrity__MaxAutoRepairRequestsPerCheckpoint` | Storm cap on auto-repair requests per received checkpoint |
| `RepairTopic` | `string?` | `null` (first subscribed destination) | `Whizbang__StreamIntegrity__RepairTopic` | Wire topic for repair requests and bundles |
| `BackfillOnSubscriptionGrowth` | `bool` | `true` | `Whizbang__StreamIntegrity__BackfillOnSubscriptionGrowth` | On consumed-type-set growth, request history for new types |
| `AuditEnabled` | `bool` | `true` | `Whizbang__StreamIntegrity__AuditEnabled` | Run the scheduled deep audit. Off: this service's unsent manifest requests (outbox) and received manifest answers (inbox) are swept each maintenance cycle; peers' requests are still answered |
| `AuditIntervalMinutes` | `int` | `1440` (daily) | `Whizbang__StreamIntegrity__AuditIntervalMinutes` | Audit cadence |
| `AuditOnStartup` | `bool` | `true` | `Whizbang__StreamIntegrity__AuditOnStartup` | Run the first deep audit shortly after startup |
| `StartupAuditMaxJitterSeconds` | `int` | `300` | `Whizbang__StreamIntegrity__StartupAuditMaxJitterSeconds` | Max random splay added to the startup audit's 30s floor |
| `AuditSettleWindowMinutes` | `int` | `60` | `Whizbang__StreamIntegrity__AuditSettleWindowMinutes` | Only events older than this are folded, so in-flight delivery never reads as divergence |
| `MaxDigestsPerManifest` | `int` | `500` | `Whizbang__StreamIntegrity__MaxDigestsPerManifest` | Digest rows per manifest chunk |
| `MaxAutoRepairRequestsPerAudit` | `int` | `25` | `Whizbang__StreamIntegrity__MaxAutoRepairRequestsPerAudit` | Storm cap on stream-scoped repair requests per manifest chunk |
| `MaxManifestPagesPerAudit` | `int` | `8` | `Whizbang__StreamIntegrity__MaxManifestPagesPerAudit` | Pages of a windowed stream-level answer followed per burst |
| `BulkBackfillThresholdEvents` | `int` | `1000` | `Whizbang__StreamIntegrity__BulkBackfillThresholdEvents` | Type-level deficit at/above which one bulk backfill replaces per-stream drill-down |
| `MaxAutoRebuildsPerAudit` | `int` | `5` | `Whizbang__StreamIntegrity__MaxAutoRebuildsPerAudit` | Storm cap on local rebuilds dispatched per audit cycle |
| `MaxCoverageGapReportsPerAudit` | `int` | `100` | `Whizbang__StreamIntegrity__MaxCoverageGapReportsPerAudit` | Cap on coverage-gap reports per audit cycle |
| `MaxDivergenceReportsPerManifest` | `int` | `100` | `Whizbang__StreamIntegrity__MaxDivergenceReportsPerManifest` | Cap on divergence reports per manifest comparison |
| `MaxGapReportsPerCheckpoint` | `int` | `100` | `Whizbang__StreamIntegrity__MaxGapReportsPerCheckpoint` | Cap on confirmed-gap reports per received checkpoint |
| `FullSweepEveryNthAudit` | `int` | `7` | `Whizbang__StreamIntegrity__FullSweepEveryNthAudit` | Every Nth audit is a full sweep; ≤0 disables |
| `FullSweepCron` | `string?` | `"0 3 * * *"` | `Whizbang__StreamIntegrity__FullSweepCron` | Cron for the full sweep; null/empty disables cron scheduling |
| `MaxEpochVerificationsPerSweep` | `int` | `10000` | `Whizbang__StreamIntegrity__MaxEpochVerificationsPerSweep` | Cap on closed epochs recomputed per sweep |
| `MaxDrillDownTypesPerAudit` | `int` | `10` | `Whizbang__StreamIntegrity__MaxDrillDownTypesPerAudit` | Storm cap on types escalated to stream-level requests |
| `DivergenceReportCooldownMinutes` | `int` | `60` | `Whizbang__StreamIntegrity__DivergenceReportCooldownMinutes` | Minutes an unchanged divergence stays silent after reporting |
| `RepairRequestBackoffSeconds` | `int` | `300` | `Whizbang__StreamIntegrity__RepairRequestBackoffSeconds` | Base seconds between repair requests per divergent bucket (doubles per attempt) |
| `MaxRepairAttemptsPerBucket` | `int` | `8` | `Whizbang__StreamIntegrity__MaxRepairAttemptsPerBucket` | Repair attempts per bucket before the requester stops asking |
| `RepairDrainEnabled` | `bool` | `true` | `Whizbang__StreamIntegrity__RepairDrainEnabled` | Paced repair drain from the durable ledger instead of per-audit bursts |
| `RepairDrainRatePerSecond` | `double` | `5` | `Whizbang__StreamIntegrity__RepairDrainRatePerSecond` | Steady-state repair dispatch rate (token bucket, 2× burst) |
| `RepairDrainBatchSize` | `int` | `50` | `Whizbang__StreamIntegrity__RepairDrainBatchSize` | Max ledger rows claimed per drain pass |
| `EpochClosureEnabled` | `bool` | `true` | `Whizbang__StreamIntegrity__EpochClosureEnabled` | Advance the digest-epoch closure frontier on the maintenance cadence |
| `MaxEpochClosuresPerMaintenanceCycle` | `int` | `64` | `Whizbang__StreamIntegrity__MaxEpochClosuresPerMaintenanceCycle` | Max epochs closed per maintenance cycle |
| `PublishReportEvents` | `bool` | `false` | `Whizbang__StreamIntegrity__PublishReportEvents` | Publish divergence/gap detections as durable events. Off (the default): unpublished report events are swept from the outbox each maintenance cycle |

## Dead Letters and Recovery

### DeadLetterRecoveryOptions

**Configure:** bound by the framework from `Whizbang:DeadLetterRecovery` (`Whizbang__DeadLetterRecovery__Enabled=false` works with no service code); override in code via `services.Configure<DeadLetterRecoveryOptions>(…)`. Per-reason policies via the `PolicyByReason` dictionary. **Details:** [DLQ Recovery](../dead-letter-queue/recovery#custom-policy).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__DeadLetterRecovery__Enabled` | Killswitch for the recovery worker |
| `ScanIntervalMinutes` | `int` | `10` | `Whizbang__DeadLetterRecovery__ScanIntervalMinutes` | Backstop minutes between scans |
| `ScanBatchSize` | `int` | `2000` | `Whizbang__DeadLetterRecovery__ScanBatchSize` | Max DLQ rows fetched per scan cycle |
| `LoopBreakerEnabled` | `bool` | `true` | `Whizbang__DeadLetterRecovery__LoopBreakerEnabled` | Suspend recovery when it is generating the dead letters it recovers |
| `LoopBreakerFreshFraction` | `double` | `0.5` | `Whizbang__DeadLetterRecovery__LoopBreakerFreshFraction` | Share of a batch postdating the last scan that reads as self-inflicted |
| `LoopBreakerConsecutiveCycles` | `int` | `3` | `Whizbang__DeadLetterRecovery__LoopBreakerConsecutiveCycles` | Consecutive self-inflicted cycles before recovery suspends |
| `LoopBreakerCooldownMinutes` | `int` | `60` | `Whizbang__DeadLetterRecovery__LoopBreakerCooldownMinutes` | Minutes suspended before retrying; `0` stays open until restart |
| `WaitForIdle` | `bool` | `true` | `Whizbang__DeadLetterRecovery__WaitForIdle` | Recovery re-drives only when the service is settled, via housekeeping arbitration at the highest rank; `false` re-drives on the scan cadence regardless of load |
| `RetryHeldOnStartup` | `RetryHeldOnStartupMode` | `Off` | `Whizbang__DeadLetterRecovery__RetryHeldOnStartup` | Startup campaign over HELD rows: `Canary` probes each fingerprint cohort and releases on all-probes-recover; `Full` releases everything staggered without probing. See [Canary Recovery](../dead-letter-queue/canary-recovery) |
| `CanaryProbeSize` | `int` | `10` | `Whizbang__DeadLetterRecovery__CanaryProbeSize` | Probe rows per cohort in Canary mode, stratified across message types |
| `ReleaseStaggerMinutes` | `int` | `30` | `Whizbang__DeadLetterRecovery__ReleaseStaggerMinutes` | Window a cohort release is staggered across — release is eligibility for the paced scans, never a firehose |
| `AutoCanaryOnNewGeneration` | `bool` | `true` | `Whizbang__DeadLetterRecovery__AutoCanaryOnNewGeneration` | A new build generation auto-canaries held cohorts (deploys that fix bugs self-heal their cohorts at probe cost); an explicit `RetryHeldOnStartup` mode always wins |
| `GenerationBudget` | `int` | `3` | `Whizbang__DeadLetterRecovery__GenerationBudget` | Distinct build generations whose campaigns may fail before a cohort becomes permanently pending an operator decision |
| `StackBackfillBatchSize` | `int` | `500` | `Whizbang__DeadLetterRecovery__StackBackfillBatchSize` | Dead letters normalized into the relational stack layer per recovery scan; `0` disables the backfill |
| `StackHistoryRetentionDays` | `int` | `90` | `Whizbang__DeadLetterRecovery__StackHistoryRetentionDays` | Rolling retention for the stack-history log (`wh_stack_daily`): the recovery worker prunes daily rows older than this on its idle-gated scan. A non-positive value disables the rolling cleanup — the log is kept forever |
| `PressuredScanBatchSize` | `int` | `20` | `Whizbang__DeadLetterRecovery__PressuredScanBatchSize` | Recovery scan batch when the pass was FORCED through the settledness gate by the bounded-deferral escape — a trickle under load, never a flood (#669) |
| `GenerationReplayStaggerMinutes` | `int` | `30` | `Whizbang__DeadLetterRecovery__GenerationReplayStaggerMinutes` | Window over which a new build's generation replay spreads its re-offers; `0` restores schedule-all-now (#669) |
| `Workers:Claim:NotifyDrainLingerSeconds` | `int` | `8` | `Whizbang__DeadLetterRecovery__Workers__Claim__NotifyDrainLingerSeconds` | Drain linger (doorbell debounce, C# half): after a claim finds fresh work, empty polls keep a tight ~500 ms cadence for this many seconds before the elevated idle cadence resumes. MUST stay above the SQL `notify_debounce_seconds` setting (default 7) so suppression self-expires while the drainer still polls. `0` disables the linger |
| `EnableGenerationReplay` | `bool` | `true` | `Whizbang__DeadLetterRecovery__EnableGenerationReplay` | Startup scan auto-replaying rows not yet retried on this build generation |
| `PolicyByReason` | `Dictionary<MessageFailureReason, RecoveryPolicy>` | populated map | `Whizbang__DeadLetterRecovery__PolicyByReason` | Per-failure-reason recovery rules (see the recovery page for the default map) |

### HousekeepingCoordinator.Settings

Arbitration tuning for the ranked housekeeping activities (dead-letter recovery, integrity, maintenance). **Configure:** bound by the framework from `Whizbang:Housekeeping` (`Whizbang__Housekeeping__MaxConsecutiveDeferrals=12` works with no service code); a host can also register its own `HousekeepingCoordinator` instance before the framework's TryAdd. **Details:** [Housekeeping Arbitration](../workers/housekeeping-arbitration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxConsecutiveDeferrals` | `int` | `6` | `Whizbang__Housekeeping__MaxConsecutiveDeferrals` | Busy verdicts tolerated before one pass forces through (`ProceedDeferralLimit`) — the starvation floor for recovery and maintenance, counted per activity. At the 10-minute scan cadence, 6 means a never-idle service still recovers roughly hourly |
| `SettledCooldown` | `TimeSpan` | `00:02:00` | `Whizbang__Housekeeping__SettledCooldown` | How long an activity that reported nothing to do is skipped before it is ranked again |

### TransportDeadLetterDrainWorkerOptions

**Configure:** bound by the framework from `Whizbang:Workers:TransportDeadLetterDrain`; override in code via `services.Configure<TransportDeadLetterDrainWorkerOptions>(…)`. **Details:** [Transport DLQ Recovery](../dead-letter-queue/transport-recovery#defaults).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Workers__TransportDeadLetterDrain__Enabled` | Killswitch; false leaves broker DLQ messages for manual draining |
| `IntervalMinutes` | `int` | `10` | `Whizbang__Workers__TransportDeadLetterDrain__IntervalMinutes` | Backstop cadence between drain sweeps |
| `MaxPerTick` | `int` | `500` | `Whizbang__Workers__TransportDeadLetterDrain__MaxPerTick` | Max messages re-submitted per drainer per tick |

### ThrottleRetryOptions

In-memory retry budget for broker-side throttling. **Configure:** `services.Configure<ThrottleRetryOptions>(…)`. **Details:** no dedicated page yet (mentioned in [Policy Engine](../infrastructure/policy-engine#other-resilience-components)).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxAttempts` | `int` | `5` | — *code-only* | Max in-memory attempts on throttle, including the initial try |
| `BaseDelay` | `TimeSpan` | `00:00:00.250` | — *code-only* | Base delay before the first retry |
| `BackoffMultiplier` | `double` | `2.0` | — *code-only* | Multiplicative growth per retry |
| `MaxDelay` | `TimeSpan` | `00:00:04` | — *code-only* | Upper bound on per-attempt delay (total budget ≈ 7.75s at defaults) |

## Transports

### TransportOptions (base class)

Shared knobs every concrete transport inherits; settings are validated against declared transport capabilities at startup (unsupported settings warn and are ignored). **Configure:** no concrete transport derives from this class, so nothing reads it and it has no section ([What Stays Code-Only](#what-stays-code-only)). **Details:** [Transports](../../messaging/transports/transports#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `ConcurrentMessageLimit` | `int` | `10` | — *code-only* | Max messages processed concurrently by a single consumer |
| `MessagePrefetchCount` | `int` | `0` (disabled) | — *code-only* | Messages pre-fetched into a local buffer ahead of processing |
| `FailedMessageRetryLimit` | `int` | `10` | — *code-only* | Max deliveries before dead-lettering |
| `AutoProvisionDeadLetterInfrastructure` | `bool` | `true` | — *code-only* | Auto-create DLQ infrastructure |
| `EnableOrderedDelivery` | `bool` | `true` | — *code-only* | Enforce FIFO within a stream/partition |
| `ConcurrentOrderedStreams` | `int` | `64` | — *code-only* | Max ordered streams processed in parallel |
| `AutoProvisionInfrastructure` | `bool` | `true` | — *code-only* | Auto-create topics, subscriptions, queues |
| `InitialConnectionRetryAttempts` | `int` | `5` | — *code-only* | Startup connection retries before indefinite-retry mode |
| `InitialConnectionRetryDelay` | `TimeSpan` | `00:00:01` | — *code-only* | Delay before the first connection retry |
| `MaxConnectionRetryDelay` | `TimeSpan` | `00:02:00` | — *code-only* | Ceiling on connection retry backoff |
| `ConnectionRetryBackoffMultiplier` | `double` | `2.0` | — *code-only* | Backoff multiplier |
| `RetryConnectionIndefinitely` | `bool` | `true` | — *code-only* | Keep retrying the connection forever |

### AzureServiceBusOptions

**Configure:** bound automatically from `Whizbang:Transports:AzureServiceBus` when the transport is registered; the registration lambda still applies and runs first. **Details:** [Azure Service Bus](../../messaging/transports/azure-service-bus#configuration-options).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `AutoProvisionInfrastructure` | `bool` | `true` | `Whizbang__Transports__AzureServiceBus__AutoProvisionInfrastructure` | Auto-create topics/subscriptions on subscribe |
| `SendTimeout` | `TimeSpan` | `00:00:30` | `Whizbang__Transports__AzureServiceBus__SendTimeout` | Max time for a single send before `TimeoutException` |
| `MaxConcurrentCalls` | `int` | `200` | `Whizbang__Transports__AzureServiceBus__MaxConcurrentCalls` | Messages processed in parallel per consumer (non-session mode) |
| `PublishMaxConcurrency` | `int` | `200` | `Whizbang__Transports__AzureServiceBus__PublishMaxConcurrency` | Per-StreamId batches sent in parallel during batch publish |
| `MaxAutoLockRenewalDuration` | `TimeSpan` | `00:05:00` | `Whizbang__Transports__AzureServiceBus__MaxAutoLockRenewalDuration` | How long the client auto-renews a message lock |
| `SubscriptionLockDuration` | `TimeSpan` | `00:05:00` | `Whizbang__Transports__AzureServiceBus__SubscriptionLockDuration` | Broker-side lock duration provisioned onto subscriptions (ASB max) |
| `MaxDeliveryAttempts` | `int` | `10` | `Whizbang__Transports__AzureServiceBus__MaxDeliveryAttempts` | Redeliveries before dead-lettering (set at subscription creation) |
| `DefaultSubscriptionName` | `string` | `default` | `Whizbang__Transports__AzureServiceBus__DefaultSubscriptionName` | Subscription name when none is specified |
| `EnableSessions` | `bool` | `true` | `Whizbang__Transports__AzureServiceBus__EnableSessions` | Session-per-StreamId FIFO ordering; non-session subscriptions auto-migrate |
| `MaxConcurrentSessions` | `int` | `200` | `Whizbang__Transports__AzureServiceBus__MaxConcurrentSessions` | Sessions (streams) processed in parallel per consumer |
| `SessionIdleTimeout` | `TimeSpan` | `00:01:00` | `Whizbang__Transports__AzureServiceBus__SessionIdleTimeout` | Max wait for a new message before releasing the session |
| `PrefetchCount` | `int` | `50` | `Whizbang__Transports__AzureServiceBus__PrefetchCount` | Messages buffered locally ahead of processing, per receiver |
| `EnableReceiveLivenessWatchdog` | `bool` | `true` | `Whizbang__Transports__AzureServiceBus__EnableReceiveLivenessWatchdog` | Detect an "alive but deaf" receiver and trigger recovery |
| `ReceiveLivenessProbeInterval` | `TimeSpan` | `00:01:00` | `Whizbang__Transports__AzureServiceBus__ReceiveLivenessProbeInterval` | Watchdog sweep cadence |
| `ReceiveLivenessSilenceThreshold` | `TimeSpan` | `00:05:00` | `Whizbang__Transports__AzureServiceBus__ReceiveLivenessSilenceThreshold` | Message-less duration before the watchdog checks backlog |
| `InitialRetryAttempts` | `int` | `5` | `Whizbang__Transports__AzureServiceBus__InitialRetryAttempts` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | `Whizbang__Transports__AzureServiceBus__InitialRetryDelay` | Delay before the first connection retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | `Whizbang__Transports__AzureServiceBus__MaxRetryDelay` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | `Whizbang__Transports__AzureServiceBus__BackoffMultiplier` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | `Whizbang__Transports__AzureServiceBus__RetryIndefinitely` | Retry connection forever |

### RabbitMQOptions

**Configure:** bound automatically from `Whizbang:Transports:RabbitMQ` when the transport is registered; the registration lambda still applies and runs first, so a configuration key overrides it. **Details:** [RabbitMQ](../../messaging/transports/rabbitmq#configuration-options).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxChannels` | `int` | `10` | `Whizbang__Transports__RabbitMQ__MaxChannels` | Max pooled channels (one per concurrent publish) |
| `MaxDeliveryAttempts` | `int` | `10` | `Whizbang__Transports__RabbitMQ__MaxDeliveryAttempts` | Redeliveries (via `x-delivery-count`) before NACK to the dead-letter exchange |
| `DefaultQueueName` | `string?` | `null` | `Whizbang__Transports__RabbitMQ__DefaultQueueName` | Fallback queue name |
| `PrefetchCount` | `ushort` | `200` | `Whizbang__Transports__RabbitMQ__PrefetchCount` | Broker push-ahead buffer; match to `TransportBatchOptions.BatchSize` |
| `AutoDeclareDeadLetterExchange` | `bool` | `true` | `Whizbang__Transports__RabbitMQ__AutoDeclareDeadLetterExchange` | Auto-declare the dead-letter exchange and queue |
| `EnableSingleActiveConsumer` | `bool` | `false` | `Whizbang__Transports__RabbitMQ__EnableSingleActiveConsumer` | Declare queues with `x-single-active-consumer` for FIFO |
| `InitialRetryAttempts` | `int` | `5` | `Whizbang__Transports__RabbitMQ__InitialRetryAttempts` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | `Whizbang__Transports__RabbitMQ__InitialRetryDelay` | Delay before the first connection retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | `Whizbang__Transports__RabbitMQ__MaxRetryDelay` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | `Whizbang__Transports__RabbitMQ__BackoffMultiplier` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | `Whizbang__Transports__RabbitMQ__RetryIndefinitely` | Retry connection forever |

### TransportConsumerOptions

Which destinations to subscribe to. **Configure:** the transport consumer registration; destinations come from routing, `AdditionalDestinations` in the `AddTransportConsumer` callback, and `Whizbang:Transports:<transport>:Consumer:AdditionalDestinations:<n>` (`Address`, optional `RoutingKey`), which adds entries ([Transport Sections](#transport-sections)). `SubscriberName` is not read by the consumer. **Details:** [Transport Consumer](../../messaging/transports/transport-consumer#auto-configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `SubscriberName` | `string?` | `null` (generated) | — *code-only* | Subscriber name used to generate queue names |

### ServiceBusConsumerOptions

**Configure:** registered by `AddAzureServiceBusTransport` and bound from `Whizbang:Transports:AzureServiceBus:Consumer:Subscriptions:<n>` (`TopicName`, `SubscriptionName`, optional `DestinationFilter`); a configured list replaces the code list ([Transport Sections](#transport-sections)). Read by `ServiceBusConsumerWorker` when it is resolved from the container. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Subscriptions` | `List<TopicSubscription>` | `[]` | `Whizbang__Transports__AzureServiceBus__Consumer__Subscriptions` | Topic subscriptions to consume messages from |

### ServiceBusInfrastructureOptions

Service Bus auto-discovery and provisioning. **Configure:** `services.Configure<ServiceBusInfrastructureOptions>(…)`; the framework does not read this class, so it has no section ([What Stays Code-Only](#what-stays-code-only)). **Details:** [Azure Service Bus auto-provisioning](../../messaging/transports/azure-service-bus#auto-provisioning).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `ServiceName` | `string` | `""` | — *code-only* | Name used to generate unique subscription names |
| `RequiredTopics` | `List<TopicRequirement>` | `[]` | — *code-only* | Explicit topic requirements; empty auto-discovers |
| `AutoCreateInProduction` | `bool` | `true` | — *code-only* | Create topics/subscriptions in production via the Management API |
| `GenerateAspireConfigInDev` | `bool` | `true` | — *code-only* | In development, generate and log Aspire AppHost configuration |
| `FailOnProvisioningError` | `bool` | `false` | — *code-only* | Fail startup if provisioning fails in production |

### SubscriptionResilienceOptions

**Configure:** the `AddTransportConsumer(config => config.ResilienceOptions…)` callback, then bound from `Whizbang:Transports:<transport>:SubscriptionResilience` when that transport is registered (`Whizbang:Transports:AzureServiceBus:SubscriptionResilience` for Service Bus); configuration overrides the callback ([Transport Sections](#transport-sections)). **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `InitialRetryAttempts` | `int` | `5` | `Whizbang__Transports__<transport>__SubscriptionResilience__InitialRetryAttempts` | Warning-logged retries before indefinite retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | `Whizbang__Transports__<transport>__SubscriptionResilience__InitialRetryDelay` | Delay before the first retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | `Whizbang__Transports__<transport>__SubscriptionResilience__MaxRetryDelay` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | `Whizbang__Transports__<transport>__SubscriptionResilience__BackoffMultiplier` | Backoff multiplier; 1.0 disables |
| `RetryIndefinitely` | `bool` | `true` | `Whizbang__Transports__<transport>__SubscriptionResilience__RetryIndefinitely` | Retry until success or cancellation |
| `HealthCheckInterval` | `TimeSpan` | `00:01:00` | `Whizbang__Transports__<transport>__SubscriptionResilience__HealthCheckInterval` | Sweep interval recovering failed subscriptions |
| `AllowPartialSubscriptions` | `bool` | `true` | `Whizbang__Transports__<transport>__SubscriptionResilience__AllowPartialSubscriptions` | Start the worker even if some subscriptions fail |

## Message Body Offload (code-configured remainder)

### MessageBodyOffloadOptions

Send-side claim-check strategy. Four keys bind from `Whizbang:BodyOffload` [when the opt-in helper is called](#whizbangbodyoffload--messagebodyoffloadoptions); the rest are code-configured. **Details:** [Message Body Store](../../fundamentals/offloads/message-body-store#end-to-end-di).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `ProviderName` | `string?` | `null` (disabled) | `Whizbang__BodyOffload__ProviderName` | Must match a registered `IMessageBodyStore` (config-bindable) |
| `SizeThresholdBytes` | `long` | `65536` (64 KB) | `Whizbang__BodyOffload__SizeThresholdBytes` | Offload threshold; keep below transport max message size (config-bindable) |
| `ActiveCleanup` | `bool` | `false` | `Whizbang__BodyOffload__ActiveCleanup` | Delete the body after the inbox row is acked (config-bindable) |
| `PassiveExpiry` | `TimeSpan?` | `30.00:00:00` (30 days) | `Whizbang__BodyOffload__PassiveExpiry` | Age past which the passive sweep deletes blob + ledger row; must exceed DLQ retention |
| `PassiveSweepClaimWindow` | `TimeSpan` | `01:00:00` | `Whizbang__BodyOffload__PassiveSweepClaimWindow` | Minimum interval between passive sweeps service-wide |
| `PassiveSweepBatchSize` | `int` | `500` | `Whizbang__BodyOffload__PassiveSweepBatchSize` | Ledger rows fetched per sweep batch |
| `PassiveSweepMaxBatchesPerCycle` | `int` | `10` | `Whizbang__BodyOffload__PassiveSweepMaxBatchesPerCycle` | Upper bound on batches per maintenance cycle |
| `DownloadTimeout` | `TimeSpan` | `00:01:40` (100s) | `Whizbang__BodyOffload__DownloadTimeout` | Bounded timeout for receive-side body download |

## Pinned Connection Pool

### WhizbangPinnedPoolOptions

Dedicated long-lived PostgreSQL connections for background workers, bypassing a transaction pooler. **Configure:** bound automatically from `Whizbang:Workers:PinnedPool` by `AddWhizbangPinnedPool()`; `AddWhizbangPinnedWorkerPool(opts => …)` — the library does **not** bind this section itself; the recommended section is `Whizbang:Workers:PinnedPool` (`Whizbang__Workers__PinnedPool__Enabled`), bound inside your configure callback. **Details:** [Pinned Connection Pool](../../fundamentals/workers/pinned-connection-pool#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `ConnectionStringName` | `string?` | `null` | `Whizbang__Workers__PinnedPool__ConnectionStringName` | `ConnectionStrings:*` key resolving to the direct (non-pooler) string; convention `{service}-db-direct` |
| `ConnectionString` | `string?` | `null` | `Whizbang__Workers__PinnedPool__ConnectionString` | Inline direct string when `ConnectionStringName` is unset; empty = feature no-op |
| `Enabled` | `bool` | `false` | `Whizbang__Workers__PinnedPool__Enabled` | Master switch |
| `Size` | `int` | `1` | `Whizbang__Workers__PinnedPool__Size` | Pinned connections held open |
| `IncludeFlushWorkers` | `bool` | `true` | `Whizbang__Workers__PinnedPool__IncludeFlushWorkers` | Tier-2 flush workers also borrow from the pool |
| `ExcludeWorkers` | `IList<string>` | `[]` | `Whizbang__Workers__PinnedPool__ExcludeWorkers` | Worker CLR type names excluded even if their tier opts in |
| `ConnectionLifetimeSeconds` | `int` | `1800` | `Whizbang__Workers__PinnedPool__ConnectionLifetimeSeconds` | Per-connection lifetime before recycling |
| `BorrowTimeoutMilliseconds` | `int` | `5000` | `Whizbang__Workers__PinnedPool__BorrowTimeoutMilliseconds` | Max wait to borrow before throwing (surfaces starvation) |

## Database Driver (PostgreSQL)

### PostgresOptions

Connection retry, command timeout, and collective-apply bounds for the PostgreSQL driver. **Configure:** `services.Configure<PostgresOptions>(…)`, then bound per database from `Whizbang:Postgres:<database>`, where `<database>` is the connection-string name the EF Core Postgres driver registers ([Postgres Databases](#postgres-databases)). The Dapper driver's registration lambda stays code-configured. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `InitialRetryAttempts` | `int` | `5` | `Whizbang__Postgres__<database>__InitialRetryAttempts` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | `Whizbang__Postgres__<database>__InitialRetryDelay` | Delay before the first retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | `Whizbang__Postgres__<database>__MaxRetryDelay` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | `Whizbang__Postgres__<database>__BackoffMultiplier` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | `Whizbang__Postgres__<database>__RetryIndefinitely` | Retry forever until connect or cancellation |
| `CommandTimeoutSeconds` | `int` | `120` | `Whizbang__Postgres__<database>__CommandTimeoutSeconds` | How long one SQL command (e.g. `process_work_batch`) may run; shorter than the worst commit batch loses completions |
| `MaxInFlightCommands` | `int` | `50` | `Whizbang__Postgres__<database>__MaxInFlightCommands` | Cap on concurrent work-coordinator calls per process; post-configured into `WorkCoordinatorGateOptions.MaxConcurrent` (see [WorkCoordinatorGateOptions](#workcoordinatorgateoptions)), so it is the effective gate cap whenever a Postgres driver is registered; 0 disables the gate |
| `CollectiveApplyBatchSize` | `int` | `1000` | `Whizbang__Postgres__<database>__CollectiveApplyBatchSize` | Rows mutated per batched collective-apply UPDATE |
| `CollectiveApplyStatementTimeoutSeconds` | `int?` | `null` | `Whizbang__Postgres__<database>__CollectiveApplyStatementTimeoutSeconds` | Server-side `statement_timeout` per collective-apply batch |

## Security and Scope

### MessageSecurityOptions

Message security context establishment. **Configure:** the security registration lambda; exempt types via `ExemptMessageTypes`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `AllowAnonymous` | `bool` | `false` | — *code-only* | Allow messages without security context (least privilege by default) |
| `EnableAuditLogging` | `bool` | `true` | — *code-only* | Log security context establishment |
| `ValidateCredentials` | `bool` | `true` | — *code-only* | Extractors validate tokens/credentials |
| `Timeout` | `TimeSpan` | `00:00:05` | — *code-only* | Max wait for security context establishment |
| `PropagateToOutgoingMessages` | `bool` | `true` | — *code-only* | Propagate context to cascaded/outgoing messages |

### WhizbangScopeOptions

GraphQL scope-extraction middleware claim/header mappings. **Configure:** `services.Configure<WhizbangScopeOptions>(…)`. **Details:** no dedicated page yet. Highlights (see the class XML docs for the full claim-fallback lists):

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `TenantIdClaimTypes` | `List<string>` | `["tenant_id"]` | — *code-only* | Tenant-id claim types tried in order |
| `TenantIdHeaderName` | `string` | `X-Tenant-Id` | — *code-only* | Header fallback for tenant id |
| `UserIdClaimTypes` | `List<string>` | Azure AD `oid` variants, `sub`, `NameIdentifier` | — *code-only* | User-id claim types tried in order |
| `UserIdHeaderName` | `string` | `X-User-Id` | — *code-only* | Header fallback for user id |
| `OrganizationIdClaimTypes` | `List<string>` | `["org_id"]` | — *code-only* | Organization-id claim types |
| `CustomerIdClaimTypes` | `List<string>` | `["customer_id"]` | — *code-only* | Customer-id claim types |
| `CorrelationIdHeaderName` | `string` | `X-Correlation-ID` | — *code-only* | Inbound correlation-id header adopted as ambient correlation |
| `RolesClaimType` | `string` | `ClaimTypes.Role` | — *code-only* | Claim type for roles |
| `PermissionsClaimTypes` | `List<string>` | `["permissions"]` | — *code-only* | Permissions claim types (aggregation via `PermissionsAggregation`, default `FirstMatch`) |
| `GroupsClaimTypes` | `List<string>` | `["groups"]` | — *code-only* | Groups claim types (aggregation via `GroupsAggregation`, default `FirstMatch`) |
| `ExtensionClaimMappings` / `ExtensionHeaderMappings` | `Dictionary<string,string>` | `[]` | — *code-only* | Custom claim/header → extension key mappings |

## Tags and System Events

### TagOptions

Payload-size guardrails for tag hooks; hooks themselves register fluently (`UseHook`, `UseUniversalHook`). **Configure:** the size guardrails bind automatically from `Whizbang:Tags`; `AddWhizbang(options => options.Tags…)`. **Details:** [WhizbangCoreOptions — TagOptions](whizbang-options#tagoptions), [Message Tags](../../fundamentals/messages/message-tags#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `PayloadSizeWarningThresholdBytes` | `int?` | `8192` (8 KiB) | `Whizbang__Tags__PayloadSizeWarningThresholdBytes` | Log a warning for built payloads at/above this size; `null` disables |
| `PayloadSizeErrorThresholdBytes` | `int?` | `null` (disabled) | `Whizbang__Tags__PayloadSizeErrorThresholdBytes` | Throw instead of dispatching above this size |

### CoalescePolicyOptions

Per-tag coalesce policy folding tagged singles into composites. **Configure:** registered per tag through the tag fluent API, then bound per tag from `Whizbang:Tags:Coalesce:<tag>`, which overrides the code policy ([Coalesce Bindings](#coalesce-bindings)). The delegates are code-only. **Details:** [Message Tags](../../fundamentals/messages/message-tags#configuration).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `SlideSeconds` | `int` | `15` | `Whizbang__Tags__Coalesce__<tag>__SlideSeconds` | Quiet window before pending singles fold; 0 ships individually |
| `MaxDelaySeconds` | `int` | `120` | `Whizbang__Tags__Coalesce__<tag>__MaxDelaySeconds` | Hard freshness cap on continuous sliding |
| `MaxBatchCount` | `int` | `500` | `Whizbang__Tags__Coalesce__<tag>__MaxBatchCount` | Max singles folded into one composite |
| `Atomicity` | `FanoutAtomicity` | `Independent` | `Whizbang__Tags__Coalesce__<tag>__Atomicity` | Per-child failure policy of the shipped composite |
| `CompositeFactory` | `Func<CoalesceFoldBatch, CompositeEventBase>?` | `null` (generic composite) | — *code-only* | Builds the composite |
| `PriorityFold` | `CompositePriorityFold` | `MostUrgent` | `Whizbang__Tags__Coalesce__<tag>__PriorityFold` | How the composite's priority folds from its children's |

### SystemEventOptions

Which system events are enabled and how audit records ship. **Configure:** the system-events registration lambda (audit toggles are fluent). **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `LocalOnly` | `bool` | `true` | — *code-only* | Store system events locally without publishing to the outbox |
| `AuditMode` | `AuditMode` | `OptOut` | — *code-only* | Audit all events unless excluded, vs only explicitly marked |
| `EventNameHumanizer` | `Func<string, string?>?` | `null` (built-in) | — *code-only* | Custom event-type → label mapping |
| `EventDescriptionHumanizer` | `Func<string, string?>?` | `null` (built-in) | — *code-only* | Custom description generator |
| `AuditShipSlideSeconds` | `int` | `15` | — *code-only* | Quiet window before audit singles fold into a composite; 0 bypasses |
| `AuditShipMaxDelaySeconds` | `int` | `120` | — *code-only* | Safety floor and hard cap on continuous sliding |
| `AuditShipMaxBatchCount` | `int` | `500` | — *code-only* | Max audit records per shipped composite |

## Temporal Scheduling

### TemporalOptions

The temporal engine's schedule worker. **Configure:** bound automatically from `Whizbang:Temporal` — no registration call needed. `services.Configure<TemporalOptions>(…)` still applies and runs before configuration, so a configuration key overrides it. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|--------------------|---------|
| `Enabled` | `bool` | `true` | `Whizbang__Temporal__Enabled` | Killswitch — worker registers but never fires |
| `BackstopIntervalMilliseconds` | `int` | `5000` | `Whizbang__Temporal__BackstopIntervalMilliseconds` | Reconcile cadence for due schedules absent a doorbell |
| `ClaimBatchLimit` | `int` | `100` | `Whizbang__Temporal__ClaimBatchLimit` | Max schedules claimed per call |
| `LeaseDurationSeconds` | `int` | `300` | `Whizbang__Temporal__LeaseDurationSeconds` | Outbox lease granted to a spawned occurrence |

## Resilience Primitives

### CircuitBreakerOptions

**Configure:** passed to `CircuitBreaker<TResult>` construction; resolve it by name with `IOptionsMonitor<CircuitBreakerOptions>.Get("<name>")` to bind `Whizbang:CircuitBreakers:<name>` over `services.Configure<CircuitBreakerOptions>("<name>", …)` ([Circuit Breakers](#circuit-breakers)). **Details:** [Policy Engine](../infrastructure/policy-engine).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `FailureThreshold` | `int` | `5` | `Whizbang__CircuitBreakers__<name>__FailureThreshold` | Consecutive failures before the circuit opens |
| `InitialCooldownSeconds` | `int` | `3` | `Whizbang__CircuitBreakers__<name>__InitialCooldownSeconds` | Initial cooldown on first open; then exponential |
| `CooldownBackoffMultiplier` | `double` | `2.0` | `Whizbang__CircuitBreakers__<name>__CooldownBackoffMultiplier` | Multiplier per consecutive open |
| `MaxCooldownSeconds` | `int` | `300` | `Whizbang__CircuitBreakers__<name>__MaxCooldownSeconds` | Cap on cooldown backoff |
| `SuccessCacheDurationSeconds` | `int` | `5` | `Whizbang__CircuitBreakers__<name>__SuccessCacheDurationSeconds` | Seconds to cache a successful result; 0 disables |

### StreamRateLimiterOptions

**Configure:** `services.Configure<StreamRateLimiterOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `MaxEventsPerWindow` | `int` | `50` | — *code-only* | Max events per stream within the window before throttling |
| `WindowDuration` | `TimeSpan` | `00:01:00` | — *code-only* | Sliding window duration |
| `CooldownDuration` | `TimeSpan` | `00:00:30` | — *code-only* | How long a throttled stream is paused |
| `StaleEntryTimeout` | `TimeSpan` | `00:05:00` | — *code-only* | Idle duration before a stream's tracking entry is cleaned up |

## HTTP Hosting (ASP.NET)

### WhizbangAvailabilityOptions

The schema-availability gate `AddWhizbangAspNet` injects automatically. **Configure:** `services.Configure<WhizbangAvailabilityOptions>(…)`. **Details:** [Database Availability Middleware](../../resilience/database-availability-middleware).

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Enabled` | `bool` | `true` | — *code-only* | Whether the availability gate is injected |
| `Mode` | `AvailabilityGateMode` | `MutationsOnly` | — *code-only* | Pre-readiness policy (default: serve reads, 503 writes) |
| `ExemptPaths` | `IReadOnlyList<string>?` | `null` (`/alive`, `/health`, `/version`) | — *code-only* | Path prefixes that always pass through |

### WhizbangCorrelationOptions

**Configure:** `services.Configure<WhizbangCorrelationOptions>(…)`; populate the `HeaderNames` list in the callback. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `HeaderNames` | `IList<string>` (get-only, mutable) | `["X-Correlation-ID"]` | — *code-only* | Request headers read for an inbound correlation id, in priority order |

### WhizbangSecurityHeadersOptions

Hardened response headers; `null` suppresses a header. **Configure:** `UseWhizbangSecurityHeaders(options => …)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `Enabled` | `bool` | `true` | — *code-only* | Master switch; false makes the middleware a pass-through |
| `StrictTransportSecurity` | `string?` | `max-age=31536000; includeSubDomains; preload` | — *code-only* | HSTS value (HTTPS/TLS-proxied requests only) |
| `XContentTypeOptions` | `string?` | `nosniff` | — *code-only* | `X-Content-Type-Options` value |
| `XFrameOptions` | `string?` | `DENY` | — *code-only* | `X-Frame-Options` value |
| `ContentSecurityPolicy` | `string?` | `frame-ancestors 'none'` | — *code-only* | CSP value; HTML-serving services should replace with a full policy |
| `ReferrerPolicy` | `string?` | `strict-origin-when-cross-origin` | — *code-only* | `Referrer-Policy` value |
| `PermissionsPolicy` | `string?` | `camera=(), microphone=(), geolocation=()` | — *code-only* | `Permissions-Policy` value |
| `AllowedMethods` | `IList<string>` (get-only, mutable) | `[]` (filtering off) | — *code-only* | HTTP methods accepted; others get 405 before routing |

## GraphQL

### WhizbangGraphQLOptions

System-wide GraphQL defaults, overridable per lens. **Configure:** the GraphQL registration lambda. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `DefaultScope` | `GraphQLLensScopes` | `DataOnly` | — *code-only* | Scope when the lens attribute doesn't specify one |
| `DefaultPageSize` | `int` | `10` | — *code-only* | Default cursor-paging page size |
| `MaxPageSize` | `int` | `100` | — *code-only* | Max allowed page size |
| `IncludeMetadataInFilters` | `bool` | `true` | — *code-only* | Include metadata fields in filter/sort types |
| `IncludeScopeInFilters` | `bool` | `true` | — *code-only* | Include scope fields in filter/sort types |

### WhizbangStartupStatusGraphOptions

Settings for the GraphQL startup-status query field. **Configure:** supplied at registration (positional record). **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `IncludeReasons` | `bool` | supplied at construction | — *code-only* | Include per-step `reason` strings and raw fleet failure text (opt-in — reasons originate in exception messages) |

## Sagas

### SagaOptions

**Configure:** `AddWhizbangSagas(opts => …)`. **Details:** no dedicated page yet.

| Property | Type | Default | Environment variable | Purpose |
|----------|------|---------|----------------------|---------|
| `PerItemStreamNamespace` | `Guid` | `SagaItemStreams.DefaultNamespace` | — *code-only* | Namespace UUID deriving per-item stream ids; changing it later orphans existing projection rows |
| `MinWatchdogDelay` | `TimeSpan` | `00:00:30` | — *code-only* | Floor for the watchdog's next-fire delay |
| `MaxWatchdogDelay` | `TimeSpan` | `00:30:00` | — *code-only* | Ceiling, so a stalled saga is still re-checked |
| `WatchdogSafetyMargin` | `TimeSpan` | `00:00:30` | — *code-only* | Slack added to the ETA-based next-tick delay |
| `MaxConsecutiveStalls` | `int` | `4` | — *code-only* | Zero-progress ticks before the saga is abandoned |
| `StallBackoffMultiplier` | `double` | `2.0` | — *code-only* | Exponential widening of the next-tick delay per stalled tick |

## Per-Call Options (Not Startup Configuration)

These option types are parameters to individual API calls, not startup configuration — they never bind from `IConfiguration`:

- `DispatchOptions` — per-dispatch cancellation, timeout, perspective-wait, and scheduling (`ScheduledFor`)
- `CollectiveApplyOptions` — batch size, statement timeout, and advisory-lock serialization for one collective apply
- `MessageBodyUploadOptions` / `MessageBodyDownloadOptions` / `MessageBodyDeleteOptions` — per-call body-store knobs (metadata, TTL, byte caps, provider hints)
- `PerspectiveSyncOptions` — filter tree and timeout for one synchronization call
- `ApplyStackQueryOptions` — filters for one apply-stack query
- `SerializationOptions` — forward-extensible serialize-call options bag

## Fluent-Only Configuration Surfaces

These classes have no settable properties; they are configured entirely through fluent registration APIs (and therefore have no meaningful configuration keys):

- `RoutingOptions` — domain ownership and inbox/outbox routing strategies (fluent builder on the routing registration)
- `LensOptions` — named lens scopes via `DefineScope(name, configure)`
- `SecurityOptions` — RBAC/ABAC roles and permission extractors via fluent registration

## Database-side settings (`wh_settings`)

Live-tunable without a redeploy; read by the SQL functions themselves.

| key | default | Environment variable | purpose |
|---|---|----------------------|---|
| `notify_debounce_seconds` | `7` | — *code-only* | Doorbell debounce window (must stay below the C# `NotifyDrainLingerSeconds`, default 8). Non-positive disables |
| `integrity_epoch_max_stall_seconds` | `3600` | — *code-only* | Digest-epoch stall escape: a lane whose frontier has not advanced this long closes its first blocked epoch anyway (once per sweep). Non-positive disables |

## Turnkey-bound options sections (complete sweep)

Every options class the framework registers now binds from configuration (issue #646) — a
documented section that binds to nothing is treated as a defect. Newly bound sections:
`Whizbang:Ephemeral`, `Whizbang:PerspectiveRowRetention`, `Whizbang:SchemaInitialization`,
`Whizbang:UnobservedExceptionDiagnostics`, `Whizbang:BacklogAge`, `Whizbang:WorkCoordinator`,
`Whizbang:Temporal`, `Whizbang:SignalBus`, `Whizbang:OrderedStreamProcessor`, `Whizbang`
(root, e.g. `ShowBanner`), `Whizbang:StreamIntegrity`, and under `Whizbang:Workers:` —
`BackupTick`, `Heartbeat`, `OutboxCompletionFlush`, `PerspectiveCompletionFlush`,
`FailureFlush`, `LeaseRenewal`, `InboxHandler`, `OutboxPublish`, `InboxDispatch`,
`Maintenance`, `OutboxDrain`, `InboxDrain`, `RecentlyProcessedEventCache`,
`InboxDeserializeCache`, `LeaseHandle`, `OutboxBatch`, `InboxBatch`, `Perspective`,
`PinnedPool`. Section shape mirrors each options class's properties; every binding is
locked by a test in `AllOptionsBindingMatrixTests`. `Whizbang:WorkCoordinatorGate`
(`WorkCoordinatorGateOptions`) binds the same way from the worker pipeline; its binding is locked
by `WorkCoordinatorGateRegistrationTests`.
