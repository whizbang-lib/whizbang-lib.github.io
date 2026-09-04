---
title: Configuration Reference
pageType: reference
verifiedAgainstCommit: 9cffab8a
verifiedDate: 2026-08-18
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
testReferences:
  - tests/Whizbang.Core.Tests/ServiceCollectionExtensionsTests.cs
---

This page lists **every configuration surface Whizbang exposes**: the sections the library binds from `IConfiguration` automatically, the sections you can opt into binding with a helper, and the (much larger) set of options classes that are configured in code — plus the recipe for making any of them configuration-driven. Each options class lists its properties, types, defaults, and a link to the page that covers it in depth.

## How Whizbang Reads Configuration

Whizbang follows the standard .NET configuration model ([Microsoft: Configuration in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration)), but — because the library is zero-reflection and AOT-first — it deliberately does **not** reflection-bind every options class from configuration. There are three distinct mechanisms, and knowing which one applies to a given options class tells you whether an `appsettings.json` entry or environment variable will have any effect:

| Mechanism | What it means | Applies to |
|-----------|---------------|------------|
| **Bound automatically** | `AddWhizbang()` / the database driver registration reads these configuration sections with hand-rolled, AOT-safe binders. Setting a key in `appsettings.json` or as an environment variable just works. | `Whizbang:Tracing`, `Whizbang:Database`, `Whizbang:Database:Stamper`, `Whizbang:ServiceName`, `Whizbang:ShowBanner`, `ConnectionStrings:*`, `ConnectionPool:*` |
| **Opt-in binding helper** | A one-line registration call reads the section for you. Without that call, the section is inert. | `Whizbang:BodyOffload` + `Whizbang:Offloads:AzureBlob:<name>` (via `AddWhizbangAzureBlobOffloadsFromConfiguration`) |
| **Code-configured** | The options class is configured through an `Action<TOptions>` lambda (or `services.Configure<TOptions>(...)`). The library never reads a configuration section for it — **a configuration key for one of these does nothing unless your service binds it** (see [the binding recipe](#code-configured-options-the-binding-recipe)). | Everything else on this page |

> **The most common configuration mistake** is setting environment variables for a code-configured section — for example `Whizbang__WorkCoordinator__LeaseSeconds` — and expecting them to take effect. Nothing in the library reads that section. Every class below states which mechanism applies to it.

## Environment Variable Naming

.NET's environment-variable configuration provider maps configuration keys to environment variables by replacing the `:` section separator with a double underscore `__` ([Microsoft: non-prefixed environment variables](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/#non-prefixed-environment-variables), [environment variable provider](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration-providers#environment-variable-configuration-provider)):

| Configuration key | Environment variable |
|-------------------|----------------------|
| `Whizbang:Tracing:Verbosity` | `Whizbang__Tracing__Verbosity` |
| `Whizbang:Database:SignalingMode` | `Whizbang__Database__SignalingMode` |
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
| `Whizbang:ServiceName` (falls back to `ServiceName`) | — (string) | Automatic |
| `Whizbang:ShowBanner` | — (bool) | Automatic |
| `ConnectionStrings:*` | — (strings, naming conventions below) | Automatic |
| `ConnectionPool:*` | — (generated DbContext registration) | Automatic |
| `Whizbang:BodyOffload` | `MessageBodyOffloadOptions` (3 of 8 keys) | Opt-in helper |
| `Whizbang:Offloads:AzureBlob:<name>` | `AzureBlobOffloadOptions` | Opt-in helper |
| `Whizbang:Workers:PinnedPool` | `WhizbangPinnedPoolOptions` | Recommended section — consumer-bound |
| *(any section you choose)* | every other options class below | Code-configured / consumer-bound |

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

| Key | Type | Purpose |
|-----|------|---------|
| `ConnectionPool:MaxPoolSize` | `int` | Npgsql `Maximum Pool Size` |
| `ConnectionPool:MinPoolSize` | `int` | Npgsql `Minimum Pool Size` |
| `ConnectionPool:Timeout` | `int` (seconds) | Npgsql connection `Timeout` |
| `ConnectionPool:CommandTimeout` | `int` (seconds) | Npgsql `Command Timeout` |

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

The helper binds **three** keys from configuration; the rest of `MessageBodyOffloadOptions` is code-configured (see [its full table below](#messagebodyoffloadoptions)).

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `ProviderName` | `string?` | `null` (offload disabled) | `Whizbang__BodyOffload__ProviderName` | Must match a registered provider name |
| `SizeThresholdBytes` | `long` | `65536` (64 KB) | `Whizbang__BodyOffload__SizeThresholdBytes` | Body size at/above which offload kicks in |
| `ActiveCleanup` | `bool` | `false` | `Whizbang__BodyOffload__ActiveCleanup` | Delete the body explicitly after the inbox row is acked |

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

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `AutoRegisterAspNetHosting` | `bool` | `true` | Fold in `AddWhizbangAspNet()` automatically when the Hosting.AspNet assembly is loaded |
| `EnableTagProcessing` | `bool` | `true` | Master switch for message tag hooks |
| `TagProcessingMode` | `TagProcessingMode` | `AfterReceptorCompletion` | When tag hooks run |
| `DefaultQueryScope` | `QueryScope` | `Tenant` | Default scope filtering for `ILensQuery<TModel>.DefaultScope` |
| `ShowBanner` | `bool` | `true` | Print the ASCII banner on startup |
| `ImmediateDetachedChainWarningThreshold` | `int` | `10` | Warn when ImmediateDetached chain depth reaches a multiple of this |
| `EmptyStreamIdPolicy` | `EmptyStreamIdPolicy` | `Reject` | Handling of `Guid.Empty` stream ids (see [Empty Stream ID Policy](empty-stream-id-policy)) |

Sub-option bags on this class: `Tags` ([TagOptions](#tagoptions)), `Tracing` ([TracingOptions](#whizbangtracing--tracingoptions)), `Services` ([ServiceRegistrationOptions](service-registration-options)).

### WhizbangOptions

Runtime guid-tracking and guardrail behavior. **Configure:** `services.Configure<WhizbangOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `DisableGuidTracking` | `bool` | `false` | Disable TrackedGuid validation project-wide |
| `GuidOrderingViolationSeverity` | `GuidOrderingSeverity` | `Warning` | Severity for time-ordering violations in IDs (`Error` also throws) |
| `ShowBanner` | `bool` | `true` | Display the ASCII banner on startup |
| `AutoGenerateStreamIds` | `bool` | `true` | Auto-generate a StreamId for `IHasStreamId` events with `Guid.Empty` |
| `Guardrails` | `WhizbangGuardrailsOptions` | `new()` | Receptor double-fire tracking (below) |

### WhizbangGuardrailsOptions

Guardrails for the "exactly once per receptor per message" contract. **Configure:** via `WhizbangOptions.Guardrails`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ReceptorInvocationTracking` | `ReceptorInvocationTracking` | `TrackAndEnforce` | Whether invocations are recorded and duplicates blocked |
| `OnDoubleFire` | `DoubleFireBehavior` | `Warn` | On duplicate under enforcement: log + skip, or throw |
| `PersistInvocations` | `InvocationPersistence` | `Envelope` | Where records persist (`Envelope` = zero DB writes) |
| `EnableChaosHooks` | `bool` | `false` | Framework workers call `IChaosInjector` at named checkpoints |

### ServiceRegistrationOptions

**Configure:** `AddWhizbang(options => options.Services…)`. **Details:** [ServiceRegistrationOptions](service-registration-options#properties).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `IncludeSelfRegistration` | `bool` | `true` | Register concrete types as themselves in addition to their interfaces |

### SchemaInitializationOptions

How the schema initializer runs at startup. **Configure:** `services.Configure<SchemaInitializationOptions>(…)` — recommended section `Whizbang:SchemaInitialization` (`Whizbang__SchemaInitialization__NonBlockingSchemaInit`). **Details:** [Database Readiness](../workers/database-readiness#who-marks-the-gate-ready), [Turnkey Initialization](../../data/turnkey-initialization#how-it-works).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `NonBlockingSchemaInit` | `bool` | `true` | Initialize in the background; liveness answers while the ready gate stays closed (fail-closed) |
| `MigrationTimeout` | `TimeSpan?` | `null` (none) | Hard ceiling per initialization attempt (non-blocking mode only) |
| `InitRetryDelay` | `TimeSpan` | `00:00:30` | Delay between background init attempts after a failure; never gives up |

### EphemeralOptions

Startup reconciliation of ephemeral-event settings drift. **Configure:** `services.Configure<EphemeralOptions>(…)` — recommended section `Whizbang:Ephemeral`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ReconcileHistoricalOnStartup` | `bool` | `false` | Act on settings drift (reclassify, stamp, offload) instead of detect/report only |

### WhizbangLifecycleOptions

Coordinated lifecycle state machine tunables. **Configure:** the run-control registration lambda. **Details:** [Managed Resource Run Control](../../resilience/managed-resource-run-control).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `TransitionAckTimeout` | `TimeSpan` | `00:00:30` | Per-resource acknowledgement budget per coordinated transition; exceeding faults the system |
| `FaultRecordWindow` | `TimeSpan` | `00:00:05` | How long the system stays Faulted (record/report) before Halted |

### StandbyWatcherOptions

Cadences for the rolling-upgrade standby handshake. **Configure:** `services.Configure<StandbyWatcherOptions>(…)`. **Details:** [Rolling Upgrades](../startup/rolling-upgrades#the-standby-handshake).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `PollInterval` | `TimeSpan` | `00:00:05` | How often the watcher checks for an active standby request |
| `ObsolescenceInterval` | `TimeSpan` | `00:01:00` | How often a serving instance re-assesses its verdict against the ledger |
| `RequesterLivenessWindow` | `TimeSpan` | `00:00:30` | How stale the requester's heartbeat may be before its request is void |

### WhizbangHealthOptions

Maps managed-resource states to health per component. **Configure:** the health registration lambda; per-component overrides via the `Components` dictionary. **Details:** [Managed Resource Health](../../resilience/managed-resource-health).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Default` | `HealthPolicy` | `Lenient` | Policy applied to any component without an explicit override |

### SignalBusOptions

Hosted signal bus wire-route self-test and doorbell liveness. **Configure:** `services.Configure<SignalBusOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ProbeTimeoutMilliseconds` | `int` | `5000` | Max time for a transport's loopback probe before the wire route is marked failed |
| `ReProbeIntervalMilliseconds` | `int` | `300000` (5m) | Runtime re-probe cadence |
| `MissedDoorbellThreshold` | `int` | `3` | Consecutive poll-discovered work batches with no doorbell before the bus reports Degraded |

## Observability and Diagnostics

### UnobservedExceptionDiagnosticsOptions

**Configure:** `services.Configure<UnobservedExceptionDiagnosticsOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `EnableFirstChanceExceptionLogging` | `bool` | `false` | Log `AppDomain.FirstChanceException` at Debug (high volume; short diagnostic deploys only) |
| `FirstChanceExceptionTypeAllowList` | `IReadOnlyList<string>?` | `null` (all non-OCE) | Allow-list of exception type full names to log |

### DebuggerAwareClockOptions

**Configure:** `services.Configure<DebuggerAwareClockOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Mode` | `DebuggerDetectionMode` | `Auto` | Detection mode for identifying paused states |
| `SamplingInterval` | `TimeSpan` | `00:00:00.100` | CPU sampling interval for `CpuTimeSampling` mode |
| `FrozenThreshold` | `double` | `10.0` | Wall/CPU time ratio above which execution counts as frozen |

## Work Coordination, Claims, and Leases

### WorkCoordinatorOptions

Flush strategy and lease behavior for work coordinator strategies. **Configure:** `services.Configure<WorkCoordinatorOptions>(…)` — recommended section `Whizbang:WorkCoordinator` (`Whizbang__WorkCoordinator__LeaseSeconds`). **Details:** [Work Coordinator Strategies](../../data/work-coordinator-strategies#workcoordinatoroptions-properties).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `PartitionCount` | `int` | `10000` | Total partitions for work distribution |
| `ParallelizeStreams` | `bool` | `false` | Process different streams in parallel within an instance |
| `Strategy` | `WorkCoordinatorStrategy` | `Scoped` | Flush strategy (Immediate, Scoped, Interval) |
| `IntervalMilliseconds` | `int` | `100` | Batch-flush interval when `Strategy = Interval` |
| `DebugMode` | `bool` | `false` | Keep completed messages for debugging |
| `LeaseSeconds` | `int` | `300` | Lease duration |
| `AbandonStaleInstanceThresholdSeconds` | `int` | `30` | Grace period before a non-heartbeating instance is abandoned |
| `CoalesceWindowMilliseconds` | `int` | `0` | Window a Required flush waits to pick up queued items (Interval strategy; ~50ms recommended) |
| `BatchSize` | `int` | `100` | Queued-message count triggering an immediate flush when `Strategy = Batch` |

### ClaimWorkerOptions

The claim loop that distributes outbox/inbox/perspective work. **Configure:** bound by the framework from `Whizbang:Workers:Claim` (`Whizbang__Workers__Claim__FreshWorkShare=1.0` works with no service code); override in code via `services.Configure<ClaimWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; worker stays hosted but skips execution |
| `EnableSafetyNetPoll` | `bool` | `true` | Run a safety-net poll on the NOTIFY-healthy cadence even when LISTEN/NOTIFY is healthy |
| `PollingIntervalMilliseconds` | `int` | `250` | Base polling cadence |
| `PollingMaxIntervalMilliseconds` | `int` | `10000` | Adaptive backoff cap (constrained by `AbandonStaleInstanceThresholdSeconds`) |
| `NotifyHealthyPollingIntervalMilliseconds` | `int?` | `5000` | Relaxed base wait while the NOTIFY gate is healthy |
| `MaxStreamsPerBatch` | `int` | `1000` | Cap on rows returned per `claim_work` call |
| `FreshWorkShare` | `double` | `0.5` | Share of each inbox batch reserved for fresh-head streams (head row never attempted). Weighted-fair and work-conserving: an empty class hands its share to the other. Raise toward `1.0` where interactive latency outranks backlog drain — strict oldest-first let a 28k-row retry backlog starve every new arrival |
| `PerspectiveOnly` | `bool` | `false` | Distribute only perspective work (set when the legacy publisher worker is registered) |
| `PartitionCount` | `int` | `10000` | Modulo partition count |
| `LeaseSeconds` | `int` | `300` | Lease duration applied to claimed work |

### HeartbeatWorkerOptions

**Configure:** `services.Configure<HeartbeatWorkerOptions>(…)` — recommended section `Whizbang:Workers:Heartbeat`. **Details:** [Instance Liveness](../../fundamentals/workers/instance-liveness).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; without heartbeats peers eventually flag this instance stale |
| `IntervalSeconds` | `int` | `30` | Heartbeat cadence |
| `SlowIntervalSeconds` | `int` | `60` | Relaxed cadence when the session-level alive-lock is held |
| `LivenessSourceMode` | `HeartbeatLivenessSourceMode` | `AdvisoryLockWhenAvailable` | Adaptive (lock-aware) vs table-only cadence |

### LeaseHandleOptions

**Configure:** `services.Configure<LeaseHandleOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `LeaseGraceSeconds` | `int` | `30` | Seconds before SQL `lease_expiry` at which the in-process token cancels |
| `MaxRenewalsPerWork` | `int` | `6` | Cap on successful deadline extensions per work item |

### LeaseRenewalWorkerOptions

**Configure:** `services.Configure<LeaseRenewalWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `LeaseSeconds` | `int` | `300` | New lease duration applied per renewal |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=200, CoalesceWindowMs=200, ImmediateFlushThreshold=100, ChannelCapacity=5000 | Inner batch flusher tuning |

### BackupTickCoordinatorOptions

Zero-idle-polling backup tick. **Configure:** `services.Configure<BackupTickCoordinatorOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `IdleThreshold` | `TimeSpan` | `00:00:30` | Quiet period before ASLEEP→POLLING; below it, zero DB calls |
| `PollingInterval` | `TimeSpan` | `00:00:30` | Backup-tick cadence while POLLING and NOTIFY healthy |
| `FastPollingInterval` | `TimeSpan` | `00:00:05` | Cadence when the NOTIFY gate reports broken |

### WorkerRetryOptions

Completion retry with exponential backoff. **Configure:** via the owning worker's options (e.g. `PerspectiveWorkerOptions.RetryOptions`). **Details:** [Policy Engine](../infrastructure/policy-engine#worker-retry-with-exponential-backoff).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `RetryTimeoutSeconds` | `int` | `1` | Base retry timeout; first retry after this duration |
| `EnableExponentialBackoff` | `bool` | `true` | Grow the timeout 1s→2s→4s→…→cap |
| `BackoffMultiplier` | `double` | `2.0` | `baseTimeout * multiplier^retryCount` |
| `MaxBackoffSeconds` | `int` | `60` | Cap on retry timeout; keep low — failing messages block streams |

## Outbox and Inbox Pipeline

### OutboxDrainWorkerOptions

The active outbox publish path. **Configure:** `services.Configure<OutboxDrainWorkerOptions>(…)`. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; never enable together with `OutboxPublishWorkerOptions.Enabled` (double publish) |
| `MaxPerStream` | `int` | `100` | Cap on leased outbox rows drained per stream per iteration |
| `MaxBytesPerStream` | `long?` | `4194304` (4 MB) | Cap on payload bytes fetched per stream per iteration |
| `MaxOutboxAttempts` | `int?` | `10` | Publish attempts before the row moves to `wh_dead_letters` |
| `MaxConcurrentStreams` | `int` | `16` | Distinct streams drained concurrently per batch (per-stream FIFO preserved) |
| `Batcher` | `SlidingWindowBatcherOptions` | MaxSize=100, SlidingWindow=50ms, MaxWait=1s | Batching for drain signals |
| `SecurityContextTimeoutSeconds` | `int` | `10` | Timeout for per-message security-context establishment |
| `PublishTimeoutSeconds` | `int` | `60` | Timeout for the transport publish call; 0 disables |

### OutboxPublishWorkerOptions

Legacy publish path (rollback escape hatch). **Configure:** `services.Configure<OutboxPublishWorkerOptions>(…)`. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `false` | Off by default — `OutboxDrainWorker` is the active path |
| `MaxBulkPublishBatchSize` | `int` | `100` | Max batch size per bulk-publish call |
| `TransportNotReadyRetryDelayMilliseconds` | `int` | `100` | Wait after a transport not-ready re-buffer |
| `MaxOutboxAttempts` | `int?` | `10` | Dead-letter threshold; `null` restores retry-forever |

### InboxDrainWorkerOptions

The only source of `InboxWork`. **Configure:** `services.Configure<InboxDrainWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; disabling stops inbox dispatch entirely |
| `MaxPerStream` | `int` | `100` | Cap on leased inbox rows drained per stream per iteration |
| `MaxBytesPerStream` | `long?` | `4194304` (4 MB) | Cap on payload bytes per fetch per stream |
| `Batcher` | `SlidingWindowBatcherOptions` | MaxSize=100, SlidingWindow=50ms, MaxWait=1s | Batching for drain signals |

### InboxDispatchWorkerOptions

**Configure:** `services.Configure<InboxDispatchWorkerOptions>(…)`. **Details:** [Internal DLQ defaults](../dead-letter-queue/internal-dlq#defaults).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `MaxInboxAttempts` | `int?` | `10` | Total attempts before terminal commit (dead-letter) |
| `PartitionCount` | `int` | `10000` | Modulo partition count |
| `MaxConcurrentDispatch` | `int` | `8` | Parallel dispatch consumers; same-stream messages keep per-stream FIFO |
| `SecurityContextTimeoutSeconds` | `int` | `10` | Timeout for per-message security-context establishment; 0 disables |

### InboxHandlerWorkerOptions

**Configure:** `services.Configure<InboxHandlerWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=100, CoalesceWindowMs=25, ImmediateFlushThreshold=50, ChannelCapacity=5000 | Inner batch flusher tuning |

### OutboxCompletionFlushWorkerOptions

**Configure:** `services.Configure<OutboxCompletionFlushWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; producers still enqueue, nothing drains |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=500, CoalesceWindowMs=10, ImmediateFlushThreshold=250, ChannelCapacity=10000 | Inner batch flusher tuning |

### FailureFlushWorkerOptions

**Configure:** `services.Configure<FailureFlushWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=100, CoalesceWindowMs=100, ImmediateFlushThreshold=50, ChannelCapacity=5000 | Inner batch flusher tuning |

### BatchFlusherOptions

Shared tuning shape for the flush workers above. **Configure:** via the owning worker's `Flusher` property.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ChannelCapacity` | `int` | `10000` | Bounded channel capacity (back-pressure when full) |
| `MaxBatchSize` | `int` | `500` | Max items per flush call |
| `CoalesceWindowMs` | `int` | `25` | Max ms coalescing additional items after the first |
| `ImmediateFlushThreshold` | `int` | `250` | Flush immediately if the batch reaches this first |

### MessageProcessingOptions

Transport consumer concurrency and inbox batching. **Configure:** `services.Configure<MessageProcessingOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxConcurrentMessages` | `int` | `40` | Max messages processed concurrently across all subscriptions; 0 disables |
| `InboxBatchSize` | `int` | `100` | Inbox messages collected before flushing the dedup batch |
| `InboxBatchSlideMs` | `int` | `50` | Sliding window; resets on each enqueue |
| `InboxBatchMaxWaitMs` | `int` | `1000` | Hard max wait from the first message in a batch |

### TransportBatchOptions

Transport-level batch collection before `process_work_batch`. **Configure:** the transport registration lambda. **Details:** [Transports](../../messaging/transports/transports#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `BatchSize` | `int` | `200` | Messages collected before flushing immediately |
| `SlideMs` | `int` | `20` | Sliding window; resets on each enqueue |
| `MaxWaitMs` | `int` | `1000` | Hard max wait regardless of arrivals |

### SlidingWindowBatcherOptions

Shared batching shape (drain signals). **Configure:** via the owning worker's `Batcher`/`DrainBatcher` property.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxSize` | `int` | `100` | Max items in a batch; flushed as soon as reached |
| `SlidingWindow` | `TimeSpan` | `00:00:00.050` | Quiet period after the last arrival |
| `MaxWait` | `TimeSpan` | `00:00:01` | Hard cap on wait from the first arrival |

### SlidingWindowInboxOptions / SlidingWindowOutboxOptions / SlidingWindowApplyOptions

Per-stream debounce strategies for the inbox, outbox, and perspective-apply boundaries. **Configure:** `services.Configure<T>(…)`. **Details:** no dedicated page yet.

| Property | Type | Inbox default | Outbox default | Apply default | Purpose |
|----------|------|---------------|----------------|---------------|---------|
| `SlidingWindow` | `TimeSpan` | 300ms | 50ms | 300ms | Per-stream debounce after the last signal |
| `MaxWait` | `TimeSpan` | 3s | 1s | 3s | Hard cap from the first signal in a batch |
| `MaxSize` | `int` | 1000 | 100 | 1000 | Max signals per stream batch |
| `IdleEvictionWindow` | `TimeSpan` | 30s | 30s | 30s | Evict a stream's buffer after this idle duration |
| `IdleSweepInterval` | `TimeSpan` | 10s | 10s | 10s | How often the idle sweep runs |

### PerStreamSerializerOptions

**Configure:** `services.Configure<PerStreamSerializerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `StreamChannelCapacity` | `int` | `1000` | Bounded per-stream channel capacity (backpressure) |
| `DrainBatchWindow` | `TimeSpan` | `00:00:00.050` | Drain accumulator window; `Zero` disables batching |
| `IdleEvictionWindow` | `TimeSpan` | `00:00:30` | Evict a stream's channel + worker after this idle duration |
| `IdleSweepInterval` | `TimeSpan` | `00:00:10` | Idle sweep cadence |

### OrderedStreamProcessorOptions

**Configure:** `services.Configure<OrderedStreamProcessorOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ParallelizeStreams` | `bool` | `false` | Process different streams concurrently within an instance |

### InboxDeserializeCacheOptions

**Configure:** `services.Configure<InboxDeserializeCacheOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch — false re-deserializes from JSON on every dispatch |
| `TtlMinutes` | `int` | `2` | Entry TTL; covers redelivery + lease re-claim cycles |
| `MaxEntries` | `int` | `10000` | Hard cap; oldest ~10% evict on next insert when exceeded |

### RecentlyProcessedEventCacheOptions

**Configure:** `services.Configure<RecentlyProcessedEventCacheOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch — false disables the cooldown short-circuit gate |
| `TtlMinutes` | `int` | `5` | Entry TTL; covers cursor-flush races and orphan-claim cycles |
| `MaxEntries` | `int` | `100000` | Hard cap; oldest ~10% evict on next insert |
| `SweepIntervalSeconds` | `int` | `60` | Background sweep cadence for expired entries |

### RedeliveryPumpOptions

Re-delivery (repair) pump bounds. **Configure:** `services.Configure<RedeliveryPumpOptions>(…)`. **Details:** [Stream Integrity](../../resilience/stream-integrity).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxInnerEventsPerComposite` | `int` | `500` | Repair slices larger than this split into multiple composites |
| `MaxEventsPerRequest` | `int` | `10000` | Hard per-request event cap the origin enforces (clamps, never raises) |
| `MaxBytesPerComposite` | `int` | `192000` | Byte budget per composite over raw stored bodies |
| `SelectPageSize` | `int` | `500` | Origin-side selection page size |
| `PublishRetryAttempts` | `int` | `5` | Attempts per composite send before the serve surfaces failure |
| `PublishRetryBaseDelayMs` | `int` | `2000` | Base retry delay; attempt n waits base × 2^(n-1), capped at 30s |

## Perspectives

### PerspectiveWorkerOptions

**Configure:** `services.Configure<PerspectiveWorkerOptions>(…)` — recommended section `Whizbang:Workers:Perspective`. **Details:** [Perspective Worker](../workers/perspective-worker#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `PollingIntervalMilliseconds` | `int` | `1000` | Wake cadence when no NOTIFY signal is in flight and the listener is unavailable |
| `NotifyHealthyPollingIntervalMilliseconds` | `int` | `1000` | Safety-net cadence when LISTEN/NOTIFY is verified healthy |
| `MaxPerspectiveEventAttempts` | `int?` | `10` | Apply attempts before moving to `wh_dead_letters` |
| `LeaseSeconds` | `int` | `300` | Lease duration for claimed perspective cursors |
| `AbandonStaleInstanceThresholdSeconds` | `int` | `30` | Grace period before a non-heartbeating instance is abandoned |
| `InstanceMetadata` | `Dictionary<string, JsonElement>?` | `null` | Optional metadata attached to this service instance |
| `DebugMode` | `bool` | `false` | Keep completed checkpoints for debugging |
| `PartitionCount` | `int` | `10000` | Partitions for work distribution |
| `IdleThresholdPolls` | `int` | `2` | Consecutive empty polls before `OnWorkProcessingIdle` |
| `PerspectiveBatchSize` | `int` | `100` | Events processed per batch before saving model + checkpoint |
| `MaxConcurrentPerspectives` | `int` | `30` | Max perspective groups processed concurrently per batch |
| `MaxConcurrentDrainConsumers` | `int` | `4` | Parallel consumer loops on the channel reader |
| `MaxStreamsPerBatch` | `int` | `300` | Max streams returned per batch from the SQL function |
| `DrainLoopMaxIterations` | `int` | `5` | Cap on per-stream drain-loop refetch iterations; 1 disables |
| `DrainLoopRefetchMinBatch` | `int` | `2` | Minimum events in an iteration to trigger a refetch |
| `DrainBatcher` | `SlidingWindowBatcherOptions` | SlidingWindow=300ms, MaxWait=3s, MaxSize=1000 | The perspective apply-batching window |
| `RetryOptions` | `WorkerRetryOptions` | `new()` | Completion-acknowledgement retry |

### PerspectiveCompletionFlushWorkerOptions

**Configure:** `services.Configure<PerspectiveCompletionFlushWorkerOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `Flusher` | `BatchFlusherOptions` | MaxBatchSize=1000, CoalesceWindowMs=25, ImmediateFlushThreshold=500, ChannelCapacity=20000 | Inner batch flusher tuning |

### PerspectiveSnapshotOptions

**Configure:** `services.Configure<PerspectiveSnapshotOptions>(…)`. **Details:** [Snapshots](../../fundamentals/perspectives/snapshots).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `SnapshotEveryNEvents` | `int` | `100` | Create a snapshot every N events processed |
| `MaxSnapshotsPerStream` | `int` | `5` | Snapshots kept per (stream, perspective); oldest pruned |
| `EphemeralSnapshotEveryNEvents` | `int` | `10` | Snapshot cadence for EPHEMERAL perspectives |
| `EphemeralMaxSnapshotsPerStream` | `int` | `1` | Snapshots kept for EPHEMERAL perspectives — single slot |
| `Enabled` | `bool` | `true` | When false, rewinds replay from event zero |
| `RewindSnapshotIntervalEvents` | `int` | `10` | Extra snapshot every N events applied during a rewind replay |
| `UpgradePolicy` | `SnapshotUpgradePolicy` | `RebuildFromEvents` | Action when a stored snapshot's serialization version is stale |

### PerspectiveRewindOptions

**Configure:** `services.Configure<PerspectiveRewindOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Master switch; when off, out-of-order events are detected but not replayed |
| `StartupScanEnabled` | `bool` | `true` | Scan for `RewindRequired` cursors and repair on startup |
| `StartupRewindMode` | `RewindStartupMode` | `Blocking` | Startup rewinds block polling vs run in background |
| `MaxConcurrentRewinds` | `int` | `3` | Cap on concurrent rewind operations |
| `DebounceWindow` | `TimeSpan` | `00:00:05` | Sliding window before executing a rewind |
| `MaxDebounceWindow` | `TimeSpan` | `00:00:30` | Hard cap on debounce duration |

### PerspectiveStreamLockOptions

**Configure:** `services.Configure<PerspectiveStreamLockOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `LockTimeout` | `TimeSpan` | `00:00:30` | Lock validity; must exceed `KeepAliveInterval` |
| `KeepAliveInterval` | `TimeSpan` | `00:00:10` | Keepalive renewal cadence; must be < LockTimeout/2 |

### PerspectiveStreamAffinityOptions

Intra-pod per-stream serialization gate. **Configure:** `services.Configure<PerspectiveStreamAffinityOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `IdleEvictionWindow` | `TimeSpan` | `00:15:00` | Idle duration before a stream's gate entry is evictable |
| `SweepInterval` | `TimeSpan` | `00:01:00` | Minimum time between sweeps |

### PerspectiveRowRetentionOptions

Operator rung of the row-retention override ladder. **Configure:** `services.Configure<PerspectiveRowRetentionOptions>(…)`; per-model TTLs via the `Overrides` dictionary (full CLR name → seconds, `null` disables). **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Global kill switch; false resolves every model to no-TTL |

## Maintenance

### MaintenanceWorkerOptions

**Configure:** `services.Configure<MaintenanceWorkerOptions>(…)`. **Details:** [Stuck Row Sentinel](../observability/stuck-row-sentinel#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch |
| `AllowTableRewrite` | `bool` | `false` | Whether maintenance may rewrite a table to reclaim space; false = report only |
| `IntervalMinutes` | `int` | `10` | Minutes between maintenance runs |
| `StuckRowSentinelEnabled` | `bool` | `true` | Emit a Warning per stuck outbox/inbox row once per cycle |
| `StuckRowSentinelMaxAttempts` | `int` | `10` | Stuck = `attempts > this` and unprocessed |
| `StuckRowSentinelLimit` | `int` | `50` | Cap on reported stuck rows per cycle |
| `DestructionRetryBackoffSeconds` | `int` | `300` | Backoff before a failed destruction batch is re-offered |
| `MaxDestructionRetries` | `int` | `5` | Retries of a failing destruction batch before a forced delete |
| `OnDestroyFailure` | `OnDestroyFailure` | `RetryThenForcedDelete` | Policy when a `PreDestruction` hook keeps failing |
| `RowReapBatchSize` | `int` | `5000` | Rows deleted per perspective per cycle by the expiry sweep |
| `LifecycleCompletionRetentionDays` | `int` | `7` | Days a lifecycle-completion marker is kept before the sweep removes it; `0` disables the sweep |
| `RowCapSweepClaimWindowMinutes` | `int` | `60` | Minimum minutes between cap sweeps service-wide |
| `RowGuardCollectLimit` | `int` | `500` | Rows offered per guarded perspective per cycle |
| `RowCascadeDrainLimit` | `int` | `1000` | Origin evictions claimed from the journal per cycle |
| `SettledFoldIdleDays` | `int` | `90` | Idle days before a stream counts as settled |
| `SettledFoldBatchSize` | `int` | `1000` | Streams folded per settled-fold sweep |
| `SettledFoldClaimWindowHours` | `int` | `24` | Minimum hours between settled folds service-wide |

## Stream Integrity

### StreamIntegrityOptions

Self-healing continuity checking; the defaults are the recommended posture. **Configure:** `services.Configure<StreamIntegrityOptions>(…)` — recommended section `Whizbang:StreamIntegrity` (`Whizbang__StreamIntegrity__AuditIntervalMinutes`). **Details:** [Stream Integrity](../../resilience/stream-integrity#how-the-phases-unfold-from-a-cold-start).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `CheckpointsEnabled` | `bool` | `true` | Publish periodic continuity checkpoints |
| `CheckpointIntervalSeconds` | `int` | `60` | Checkpoint cadence |
| `GapDetectionEnabled` | `bool` | `true` | Verify received counts against other origins' checkpoints |
| `RepairMode` | `IntegrityRepairMode` | `AutoRepairCapped` | What to do with a confirmed gap; `ReportOnly` is the opt-down |
| `MaxAutoRepairRequestsPerCheckpoint` | `int` | `10` | Storm cap on auto-repair requests per received checkpoint |
| `RepairTopic` | `string?` | `null` (first subscribed destination) | Wire topic for repair requests and bundles |
| `BackfillOnSubscriptionGrowth` | `bool` | `true` | On consumed-type-set growth, request history for new types |
| `AuditEnabled` | `bool` | `true` | Run the scheduled deep audit |
| `AuditIntervalMinutes` | `int` | `1440` (daily) | Audit cadence |
| `AuditOnStartup` | `bool` | `true` | Run the first deep audit shortly after startup |
| `StartupAuditMaxJitterSeconds` | `int` | `300` | Max random splay added to the startup audit's 30s floor |
| `AuditSettleWindowMinutes` | `int` | `60` | Only events older than this are folded, so in-flight delivery never reads as divergence |
| `MaxDigestsPerManifest` | `int` | `500` | Digest rows per manifest chunk |
| `MaxAutoRepairRequestsPerAudit` | `int` | `25` | Storm cap on stream-scoped repair requests per manifest chunk |
| `MaxManifestPagesPerAudit` | `int` | `8` | Pages of a windowed stream-level answer followed per burst |
| `BulkBackfillThresholdEvents` | `int` | `1000` | Type-level deficit at/above which one bulk backfill replaces per-stream drill-down |
| `MaxAutoRebuildsPerAudit` | `int` | `5` | Storm cap on local rebuilds dispatched per audit cycle |
| `MaxCoverageGapReportsPerAudit` | `int` | `100` | Cap on coverage-gap reports per audit cycle |
| `MaxDivergenceReportsPerManifest` | `int` | `100` | Cap on divergence reports per manifest comparison |
| `MaxGapReportsPerCheckpoint` | `int` | `100` | Cap on confirmed-gap reports per received checkpoint |
| `FullSweepEveryNthAudit` | `int` | `7` | Every Nth audit is a full sweep; ≤0 disables |
| `FullSweepCron` | `string?` | `"0 3 * * *"` | Cron for the full sweep; null/empty disables cron scheduling |
| `MaxEpochVerificationsPerSweep` | `int` | `10000` | Cap on closed epochs recomputed per sweep |
| `MaxDrillDownTypesPerAudit` | `int` | `10` | Storm cap on types escalated to stream-level requests |
| `DivergenceReportCooldownMinutes` | `int` | `60` | Minutes an unchanged divergence stays silent after reporting |
| `RepairRequestBackoffSeconds` | `int` | `300` | Base seconds between repair requests per divergent bucket (doubles per attempt) |
| `MaxRepairAttemptsPerBucket` | `int` | `8` | Repair attempts per bucket before the requester stops asking |
| `RepairDrainEnabled` | `bool` | `true` | Paced repair drain from the durable ledger instead of per-audit bursts |
| `RepairDrainRatePerSecond` | `double` | `5` | Steady-state repair dispatch rate (token bucket, 2× burst) |
| `RepairDrainBatchSize` | `int` | `50` | Max ledger rows claimed per drain pass |
| `EpochClosureEnabled` | `bool` | `true` | Advance the digest-epoch closure frontier on the maintenance cadence |
| `MaxEpochClosuresPerMaintenanceCycle` | `int` | `64` | Max epochs closed per maintenance cycle |
| `PublishReportEvents` | `bool` | `false` | Publish divergence/gap detections as durable events |

## Dead Letters and Recovery

### DeadLetterRecoveryOptions

**Configure:** bound by the framework from `Whizbang:DeadLetterRecovery` (`Whizbang__DeadLetterRecovery__Enabled=false` works with no service code); override in code via `services.Configure<DeadLetterRecoveryOptions>(…)`. Per-reason policies via the `PolicyByReason` dictionary. **Details:** [DLQ Recovery](../dead-letter-queue/recovery#custom-policy).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch for the recovery worker |
| `ScanIntervalMinutes` | `int` | `10` | Backstop minutes between scans |
| `ScanBatchSize` | `int` | `200` | Max DLQ rows fetched per scan cycle |
| `LoopBreakerEnabled` | `bool` | `true` | Suspend recovery when it is generating the dead letters it recovers |
| `LoopBreakerFreshFraction` | `double` | `0.5` | Share of a batch postdating the last scan that reads as self-inflicted |
| `LoopBreakerConsecutiveCycles` | `int` | `3` | Consecutive self-inflicted cycles before recovery suspends |
| `LoopBreakerCooldownMinutes` | `int` | `60` | Minutes suspended before retrying; `0` stays open until restart |
| `WaitForIdle` | `bool` | `true` | Recovery re-drives only when the service is settled, via housekeeping arbitration at the highest rank; `false` re-drives on the scan cadence regardless of load |
| `RetryHeldOnStartup` | `RetryHeldOnStartupMode` | `Off` | Startup campaign over HELD rows: `Canary` probes each fingerprint cohort and releases on all-probes-recover; `Full` releases everything staggered without probing. See [Canary Recovery](../dead-letter-queue/canary-recovery) |
| `CanaryProbeSize` | `int` | `10` | Probe rows per cohort in Canary mode, stratified across message types |
| `ReleaseStaggerMinutes` | `int` | `30` | Window a cohort release is staggered across — release is eligibility for the paced scans, never a firehose |
| `AutoCanaryOnNewGeneration` | `bool` | `true` | A new build generation auto-canaries held cohorts (deploys that fix bugs self-heal their cohorts at probe cost); an explicit `RetryHeldOnStartup` mode always wins |
| `GenerationBudget` | `int` | `3` | Distinct build generations whose campaigns may fail before a cohort becomes permanently pending an operator decision |
| `StackBackfillBatchSize` | `int` | `500` | Dead letters normalized into the relational stack layer per recovery scan; `0` disables the backfill |
| `StackHistoryRetentionDays` | `int` | `90` | Rolling retention for the stack-history log (`wh_stack_daily`): the recovery worker prunes daily rows older than this on its idle-gated scan. A non-positive value disables the rolling cleanup — the log is kept forever |
| `EnableGenerationReplay` | `bool` | `true` | Startup scan auto-replaying rows not yet retried on this build generation |
| `PolicyByReason` | `Dictionary<MessageFailureReason, RecoveryPolicy>` | populated map | Per-failure-reason recovery rules (see the recovery page for the default map) |

### HousekeepingCoordinator.Settings

Arbitration tuning for the ranked housekeeping activities (dead-letter recovery, integrity, maintenance). **Configure:** bound by the framework from `Whizbang:Housekeeping` (`Whizbang__Housekeeping__MaxConsecutiveDeferrals=12` works with no service code); a host can also register its own `HousekeepingCoordinator` instance before the framework's TryAdd. **Details:** [Housekeeping Arbitration](../workers/housekeeping-arbitration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxConsecutiveDeferrals` | `int` | `6` | Busy verdicts tolerated before one pass forces through (`ProceedDeferralLimit`) — the starvation floor for recovery and maintenance, counted per activity. At the 10-minute scan cadence, 6 means a never-idle service still recovers roughly hourly |

### TransportDeadLetterDrainWorkerOptions

**Configure:** bound by the framework from `Whizbang:Workers:TransportDeadLetterDrain`; override in code via `services.Configure<TransportDeadLetterDrainWorkerOptions>(…)`. **Details:** [Transport DLQ Recovery](../dead-letter-queue/transport-recovery#defaults).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch; false leaves broker DLQ messages for manual draining |
| `IntervalMinutes` | `int` | `10` | Backstop cadence between drain sweeps |
| `MaxPerTick` | `int` | `500` | Max messages re-submitted per drainer per tick |

### ThrottleRetryOptions

In-memory retry budget for broker-side throttling. **Configure:** `services.Configure<ThrottleRetryOptions>(…)`. **Details:** no dedicated page yet (mentioned in [Policy Engine](../infrastructure/policy-engine#other-resilience-components)).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxAttempts` | `int` | `5` | Max in-memory attempts on throttle, including the initial try |
| `BaseDelay` | `TimeSpan` | `00:00:00.250` | Base delay before the first retry |
| `BackoffMultiplier` | `double` | `2.0` | Multiplicative growth per retry |
| `MaxDelay` | `TimeSpan` | `00:00:04` | Upper bound on per-attempt delay (total budget ≈ 7.75s at defaults) |

## Transports

### TransportOptions (base class)

Shared knobs every concrete transport inherits; settings are validated against declared transport capabilities at startup (unsupported settings warn and are ignored). **Configure:** the transport registration lambda. **Details:** [Transports](../../messaging/transports/transports#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ConcurrentMessageLimit` | `int` | `10` | Max messages processed concurrently by a single consumer |
| `MessagePrefetchCount` | `int` | `0` (disabled) | Messages pre-fetched into a local buffer ahead of processing |
| `FailedMessageRetryLimit` | `int` | `10` | Max deliveries before dead-lettering |
| `AutoProvisionDeadLetterInfrastructure` | `bool` | `true` | Auto-create DLQ infrastructure |
| `EnableOrderedDelivery` | `bool` | `true` | Enforce FIFO within a stream/partition |
| `ConcurrentOrderedStreams` | `int` | `64` | Max ordered streams processed in parallel |
| `AutoProvisionInfrastructure` | `bool` | `true` | Auto-create topics, subscriptions, queues |
| `InitialConnectionRetryAttempts` | `int` | `5` | Startup connection retries before indefinite-retry mode |
| `InitialConnectionRetryDelay` | `TimeSpan` | `00:00:01` | Delay before the first connection retry |
| `MaxConnectionRetryDelay` | `TimeSpan` | `00:02:00` | Ceiling on connection retry backoff |
| `ConnectionRetryBackoffMultiplier` | `double` | `2.0` | Backoff multiplier |
| `RetryConnectionIndefinitely` | `bool` | `true` | Keep retrying the connection forever |

### AzureServiceBusOptions

**Configure:** the Azure Service Bus transport registration lambda. **Details:** [Azure Service Bus](../../messaging/transports/azure-service-bus#configuration-options).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `AutoProvisionInfrastructure` | `bool` | `true` | Auto-create topics/subscriptions on subscribe |
| `SendTimeout` | `TimeSpan` | `00:00:30` | Max time for a single send before `TimeoutException` |
| `MaxConcurrentCalls` | `int` | `200` | Messages processed in parallel per consumer (non-session mode) |
| `PublishMaxConcurrency` | `int` | `200` | Per-StreamId batches sent in parallel during batch publish |
| `MaxAutoLockRenewalDuration` | `TimeSpan` | `00:05:00` | How long the client auto-renews a message lock |
| `SubscriptionLockDuration` | `TimeSpan` | `00:05:00` | Broker-side lock duration provisioned onto subscriptions (ASB max) |
| `MaxDeliveryAttempts` | `int` | `10` | Redeliveries before dead-lettering (set at subscription creation) |
| `DefaultSubscriptionName` | `string` | `default` | Subscription name when none is specified |
| `EnableSessions` | `bool` | `true` | Session-per-StreamId FIFO ordering; non-session subscriptions auto-migrate |
| `MaxConcurrentSessions` | `int` | `200` | Sessions (streams) processed in parallel per consumer |
| `SessionIdleTimeout` | `TimeSpan` | `00:00:01` | Max wait for a new message before releasing the session |
| `PrefetchCount` | `int` | `50` | Messages buffered locally ahead of processing, per receiver |
| `EnableReceiveLivenessWatchdog` | `bool` | `true` | Detect an "alive but deaf" receiver and trigger recovery |
| `ReceiveLivenessProbeInterval` | `TimeSpan` | `00:01:00` | Watchdog sweep cadence |
| `ReceiveLivenessSilenceThreshold` | `TimeSpan` | `00:05:00` | Message-less duration before the watchdog checks backlog |
| `InitialRetryAttempts` | `int` | `5` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | Delay before the first connection retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | Retry connection forever |

### RabbitMQOptions

**Configure:** the RabbitMQ transport registration lambda. **Details:** [RabbitMQ](../../messaging/transports/rabbitmq#configuration-options).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxChannels` | `int` | `10` | Max pooled channels (one per concurrent publish) |
| `MaxDeliveryAttempts` | `int` | `10` | Redeliveries (via `x-delivery-count`) before NACK to the dead-letter exchange |
| `DefaultQueueName` | `string?` | `null` | Fallback queue name |
| `PrefetchCount` | `ushort` | `200` | Broker push-ahead buffer; match to `TransportBatchOptions.BatchSize` |
| `AutoDeclareDeadLetterExchange` | `bool` | `true` | Auto-declare the dead-letter exchange and queue |
| `EnableSingleActiveConsumer` | `bool` | `false` | Declare queues with `x-single-active-consumer` for FIFO |
| `InitialRetryAttempts` | `int` | `5` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | Delay before the first connection retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | Retry connection forever |

### TransportConsumerOptions

Which destinations to subscribe to. **Configure:** the transport consumer registration; destinations via the `Destinations` list. **Details:** [Transport Consumer](../../messaging/transports/transport-consumer#auto-configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `SubscriberName` | `string?` | `null` (generated) | Subscriber name used to generate queue names |

### ServiceBusConsumerOptions

**Configure:** the consumer registration; subscriptions via the `Subscriptions` list. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Subscriptions` | `List<TopicSubscription>` | `[]` | Topic subscriptions to consume messages from |

### ServiceBusInfrastructureOptions

Service Bus auto-discovery and provisioning. **Configure:** `services.Configure<ServiceBusInfrastructureOptions>(…)`. **Details:** [Azure Service Bus auto-provisioning](../../messaging/transports/azure-service-bus#auto-provisioning).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ServiceName` | `string` | `""` | Name used to generate unique subscription names |
| `RequiredTopics` | `List<TopicRequirement>` | `[]` | Explicit topic requirements; empty auto-discovers |
| `AutoCreateInProduction` | `bool` | `true` | Create topics/subscriptions in production via the Management API |
| `GenerateAspireConfigInDev` | `bool` | `true` | In development, generate and log Aspire AppHost configuration |
| `FailOnProvisioningError` | `bool` | `false` | Fail startup if provisioning fails in production |

### SubscriptionResilienceOptions

**Configure:** `services.Configure<SubscriptionResilienceOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `InitialRetryAttempts` | `int` | `5` | Warning-logged retries before indefinite retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | Delay before the first retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | Backoff multiplier; 1.0 disables |
| `RetryIndefinitely` | `bool` | `true` | Retry until success or cancellation |
| `HealthCheckInterval` | `TimeSpan` | `00:01:00` | Sweep interval recovering failed subscriptions |
| `AllowPartialSubscriptions` | `bool` | `true` | Start the worker even if some subscriptions fail |

## Message Body Offload (code-configured remainder)

### MessageBodyOffloadOptions

Send-side claim-check strategy. Three keys bind from `Whizbang:BodyOffload` [when the opt-in helper is called](#whizbangbodyoffload--messagebodyoffloadoptions); the rest are code-configured. **Details:** [Message Body Store](../../fundamentals/offloads/message-body-store#end-to-end-di).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ProviderName` | `string?` | `null` (disabled) | Must match a registered `IMessageBodyStore` (config-bindable) |
| `SizeThresholdBytes` | `long` | `65536` (64 KB) | Offload threshold; keep below transport max message size (config-bindable) |
| `ActiveCleanup` | `bool` | `false` | Delete the body after the inbox row is acked (config-bindable) |
| `PassiveExpiry` | `TimeSpan?` | `30.00:00:00` (30 days) | Age past which the passive sweep deletes blob + ledger row; must exceed DLQ retention |
| `PassiveSweepClaimWindow` | `TimeSpan` | `01:00:00` | Minimum interval between passive sweeps service-wide |
| `PassiveSweepBatchSize` | `int` | `500` | Ledger rows fetched per sweep batch |
| `PassiveSweepMaxBatchesPerCycle` | `int` | `10` | Upper bound on batches per maintenance cycle |
| `DownloadTimeout` | `TimeSpan` | `00:01:40` (100s) | Bounded timeout for receive-side body download |

## Pinned Connection Pool

### WhizbangPinnedPoolOptions

Dedicated long-lived PostgreSQL connections for background workers, bypassing a transaction pooler. **Configure:** `AddWhizbangPinnedWorkerPool(opts => …)` — the library does **not** bind this section itself; the recommended section is `Whizbang:Workers:PinnedPool` (`Whizbang__Workers__PinnedPool__Enabled`), bound inside your configure callback. **Details:** [Pinned Connection Pool](../../fundamentals/workers/pinned-connection-pool#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `ConnectionStringName` | `string?` | `null` | `ConnectionStrings:*` key resolving to the direct (non-pooler) string; convention `{service}-db-direct` |
| `ConnectionString` | `string?` | `null` | Inline direct string when `ConnectionStringName` is unset; empty = feature no-op |
| `Enabled` | `bool` | `false` | Master switch |
| `Size` | `int` | `1` | Pinned connections held open |
| `IncludeFlushWorkers` | `bool` | `true` | Tier-2 flush workers also borrow from the pool |
| `ExcludeWorkers` | `IList<string>` | `[]` | Worker CLR type names excluded even if their tier opts in |
| `ConnectionLifetimeSeconds` | `int` | `1800` | Per-connection lifetime before recycling |
| `BorrowTimeoutMilliseconds` | `int` | `5000` | Max wait to borrow before throwing (surfaces starvation) |

## Database Driver (PostgreSQL)

### PostgresOptions

Connection retry, command timeout, and collective-apply bounds for the PostgreSQL driver. **Configure:** the Postgres driver registration lambda. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `InitialRetryAttempts` | `int` | `5` | Connection retries before indefinite-retry mode |
| `InitialRetryDelay` | `TimeSpan` | `00:00:01` | Delay before the first retry |
| `MaxRetryDelay` | `TimeSpan` | `00:02:00` | Cap on exponential backoff |
| `BackoffMultiplier` | `double` | `2.0` | Backoff multiplier |
| `RetryIndefinitely` | `bool` | `true` | Retry forever until connect or cancellation |
| `CommandTimeoutSeconds` | `int` | `5` | How long one SQL command (e.g. `process_work_batch`) may run |
| `MaxInFlightCommands` | `int` | `50` | Cap on concurrent work-coordinator calls per process; 0 disables |
| `CollectiveApplyBatchSize` | `int` | `1000` | Rows mutated per batched collective-apply UPDATE |
| `CollectiveApplyStatementTimeoutSeconds` | `int?` | `null` | Server-side `statement_timeout` per collective-apply batch |

## Security and Scope

### MessageSecurityOptions

Message security context establishment. **Configure:** the security registration lambda; exempt types via `ExemptMessageTypes`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `AllowAnonymous` | `bool` | `false` | Allow messages without security context (least privilege by default) |
| `EnableAuditLogging` | `bool` | `true` | Log security context establishment |
| `ValidateCredentials` | `bool` | `true` | Extractors validate tokens/credentials |
| `Timeout` | `TimeSpan` | `00:00:05` | Max wait for security context establishment |
| `PropagateToOutgoingMessages` | `bool` | `true` | Propagate context to cascaded/outgoing messages |

### WhizbangScopeOptions

GraphQL scope-extraction middleware claim/header mappings. **Configure:** `services.Configure<WhizbangScopeOptions>(…)`. **Details:** no dedicated page yet. Highlights (see the class XML docs for the full claim-fallback lists):

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `TenantIdClaimTypes` | `List<string>` | `["tenant_id"]` | Tenant-id claim types tried in order |
| `TenantIdHeaderName` | `string` | `X-Tenant-Id` | Header fallback for tenant id |
| `UserIdClaimTypes` | `List<string>` | Azure AD `oid` variants, `sub`, `NameIdentifier` | User-id claim types tried in order |
| `UserIdHeaderName` | `string` | `X-User-Id` | Header fallback for user id |
| `OrganizationIdClaimTypes` | `List<string>` | `["org_id"]` | Organization-id claim types |
| `CustomerIdClaimTypes` | `List<string>` | `["customer_id"]` | Customer-id claim types |
| `CorrelationIdHeaderName` | `string` | `X-Correlation-ID` | Inbound correlation-id header adopted as ambient correlation |
| `RolesClaimType` | `string` | `ClaimTypes.Role` | Claim type for roles |
| `PermissionsClaimTypes` | `List<string>` | `["permissions"]` | Permissions claim types (aggregation via `PermissionsAggregation`, default `FirstMatch`) |
| `GroupsClaimTypes` | `List<string>` | `["groups"]` | Groups claim types (aggregation via `GroupsAggregation`, default `FirstMatch`) |
| `ExtensionClaimMappings` / `ExtensionHeaderMappings` | `Dictionary<string,string>` | `[]` | Custom claim/header → extension key mappings |

## Tags and System Events

### TagOptions

Payload-size guardrails for tag hooks; hooks themselves register fluently (`UseHook`, `UseUniversalHook`). **Configure:** `AddWhizbang(options => options.Tags…)`. **Details:** [WhizbangCoreOptions — TagOptions](whizbang-options#tagoptions), [Message Tags](../../fundamentals/messages/message-tags#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `PayloadSizeWarningThresholdBytes` | `int?` | `8192` (8 KiB) | Log a warning for built payloads at/above this size; `null` disables |
| `PayloadSizeErrorThresholdBytes` | `int?` | `null` (disabled) | Throw instead of dispatching above this size |

### CoalescePolicyOptions

Per-tag coalesce policy folding tagged singles into composites. **Configure:** registered per tag through the tag fluent API. **Details:** [Message Tags](../../fundamentals/messages/message-tags#configuration).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `SlideSeconds` | `int` | `15` | Quiet window before pending singles fold; 0 ships individually |
| `MaxDelaySeconds` | `int` | `120` | Hard freshness cap on continuous sliding |
| `MaxBatchCount` | `int` | `500` | Max singles folded into one composite |
| `Atomicity` | `FanoutAtomicity` | `Independent` | Per-child failure policy of the shipped composite |
| `CompositeFactory` | `Func<CoalesceFoldBatch, CompositeEventBase>?` | `null` (generic composite) | Builds the composite |

### SystemEventOptions

Which system events are enabled and how audit records ship. **Configure:** the system-events registration lambda (audit toggles are fluent). **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `LocalOnly` | `bool` | `true` | Store system events locally without publishing to the outbox |
| `AuditMode` | `AuditMode` | `OptOut` | Audit all events unless excluded, vs only explicitly marked |
| `EventNameHumanizer` | `Func<string, string?>?` | `null` (built-in) | Custom event-type → label mapping |
| `EventDescriptionHumanizer` | `Func<string, string?>?` | `null` (built-in) | Custom description generator |
| `AuditShipSlideSeconds` | `int` | `15` | Quiet window before audit singles fold into a composite; 0 bypasses |
| `AuditShipMaxDelaySeconds` | `int` | `120` | Safety floor and hard cap on continuous sliding |
| `AuditShipMaxBatchCount` | `int` | `500` | Max audit records per shipped composite |

## Temporal Scheduling

### TemporalOptions

The temporal engine's schedule worker. **Configure:** `services.Configure<TemporalOptions>(…)` — recommended section `Whizbang:Temporal`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Killswitch — worker registers but never fires |
| `BackstopIntervalMilliseconds` | `int` | `5000` | Reconcile cadence for due schedules absent a doorbell |
| `ClaimBatchLimit` | `int` | `100` | Max schedules claimed per call |
| `LeaseDurationSeconds` | `int` | `300` | Outbox lease granted to a spawned occurrence |

## Resilience Primitives

### CircuitBreakerOptions

**Configure:** passed to `CircuitBreaker<TResult>` construction. **Details:** [Policy Engine](../infrastructure/policy-engine).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `FailureThreshold` | `int` | `5` | Consecutive failures before the circuit opens |
| `InitialCooldownSeconds` | `int` | `3` | Initial cooldown on first open; then exponential |
| `CooldownBackoffMultiplier` | `double` | `2.0` | Multiplier per consecutive open |
| `MaxCooldownSeconds` | `int` | `300` | Cap on cooldown backoff |
| `SuccessCacheDurationSeconds` | `int` | `5` | Seconds to cache a successful result; 0 disables |

### StreamRateLimiterOptions

**Configure:** `services.Configure<StreamRateLimiterOptions>(…)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `MaxEventsPerWindow` | `int` | `50` | Max events per stream within the window before throttling |
| `WindowDuration` | `TimeSpan` | `00:01:00` | Sliding window duration |
| `CooldownDuration` | `TimeSpan` | `00:00:30` | How long a throttled stream is paused |
| `StaleEntryTimeout` | `TimeSpan` | `00:05:00` | Idle duration before a stream's tracking entry is cleaned up |

## HTTP Hosting (ASP.NET)

### WhizbangAvailabilityOptions

The schema-availability gate `AddWhizbangAspNet` injects automatically. **Configure:** `services.Configure<WhizbangAvailabilityOptions>(…)`. **Details:** [Database Availability Middleware](../../resilience/database-availability-middleware).

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Whether the availability gate is injected |
| `Mode` | `AvailabilityGateMode` | `MutationsOnly` | Pre-readiness policy (default: serve reads, 503 writes) |
| `ExemptPaths` | `IReadOnlyList<string>?` | `null` (`/alive`, `/health`, `/version`) | Path prefixes that always pass through |

### WhizbangCorrelationOptions

**Configure:** `services.Configure<WhizbangCorrelationOptions>(…)`; populate the `HeaderNames` list in the callback. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `HeaderNames` | `IList<string>` (get-only, mutable) | `["X-Correlation-ID"]` | Request headers read for an inbound correlation id, in priority order |

### WhizbangSecurityHeadersOptions

Hardened response headers; `null` suppresses a header. **Configure:** `UseWhizbangSecurityHeaders(options => …)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Enabled` | `bool` | `true` | Master switch; false makes the middleware a pass-through |
| `StrictTransportSecurity` | `string?` | `max-age=31536000; includeSubDomains; preload` | HSTS value (HTTPS/TLS-proxied requests only) |
| `XContentTypeOptions` | `string?` | `nosniff` | `X-Content-Type-Options` value |
| `XFrameOptions` | `string?` | `DENY` | `X-Frame-Options` value |
| `ContentSecurityPolicy` | `string?` | `frame-ancestors 'none'` | CSP value; HTML-serving services should replace with a full policy |
| `ReferrerPolicy` | `string?` | `strict-origin-when-cross-origin` | `Referrer-Policy` value |
| `PermissionsPolicy` | `string?` | `camera=(), microphone=(), geolocation=()` | `Permissions-Policy` value |
| `AllowedMethods` | `IList<string>` (get-only, mutable) | `[]` (filtering off) | HTTP methods accepted; others get 405 before routing |

## GraphQL

### WhizbangGraphQLOptions

System-wide GraphQL defaults, overridable per lens. **Configure:** the GraphQL registration lambda. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `DefaultScope` | `GraphQLLensScopes` | `DataOnly` | Scope when the lens attribute doesn't specify one |
| `DefaultPageSize` | `int` | `10` | Default cursor-paging page size |
| `MaxPageSize` | `int` | `100` | Max allowed page size |
| `IncludeMetadataInFilters` | `bool` | `true` | Include metadata fields in filter/sort types |
| `IncludeScopeInFilters` | `bool` | `true` | Include scope fields in filter/sort types |

### WhizbangStartupStatusGraphOptions

Settings for the GraphQL startup-status query field. **Configure:** supplied at registration (positional record). **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `IncludeReasons` | `bool` | supplied at construction | Include per-step `reason` strings and raw fleet failure text (opt-in — reasons originate in exception messages) |

## Sagas

### SagaOptions

**Configure:** `AddWhizbangSagas(opts => …)`. **Details:** no dedicated page yet.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `PerItemStreamNamespace` | `Guid` | `SagaItemStreams.DefaultNamespace` | Namespace UUID deriving per-item stream ids; changing it later orphans existing projection rows |
| `MinWatchdogDelay` | `TimeSpan` | `00:00:30` | Floor for the watchdog's next-fire delay |
| `MaxWatchdogDelay` | `TimeSpan` | `00:30:00` | Ceiling, so a stalled saga is still re-checked |
| `WatchdogSafetyMargin` | `TimeSpan` | `00:00:30` | Slack added to the ETA-based next-tick delay |
| `MaxConsecutiveStalls` | `int` | `4` | Zero-progress ticks before the saga is abandoned |
| `StallBackoffMultiplier` | `double` | `2.0` | Exponential widening of the next-tick delay per stalled tick |

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
