---
title: Replaceable Services
pageType: guide
verifiedAgainstCommit: 4f73ec2e5
verifiedDate: 2026-09-21
version: 1.0.0
category: Extensibility
order: 13
description: >-
  Every interface a framework type takes by constructor has a registered default and can be
  replaced by registering your own - the contract, the full list, and how a subsystem supplies one
tags: 'extensibility, dependency-injection, tryadd, null-object, defaults, overrides'
codeReferences:
  - src/Whizbang.Core/WhizbangDefaultsServiceCollectionExtensions.cs
  - src/Whizbang.Core/INullDefault.cs
  - src/Whizbang.Core/NullDefaultServiceCollectionExtensions.cs
  - src/Whizbang.Core/Workers/IMessagePublishStrategy.cs
  - src/Whizbang.Core/Messaging/IEventTypeProvider.cs
  - src/Whizbang.Core/Messaging/EventTypeProviderServiceCollectionExtensions.cs
  - src/Whizbang.Core/Messaging/CompositeEventTypeProvider.cs
  - src/Whizbang.Core/Messaging/IDeadLetterStore.cs
  - src/Whizbang.Core/Notifications/INotifySignalingGate.cs
  - src/Whizbang.Core/Messaging/DetachedLifecycleWork.cs
  - src/Whizbang.Core/Workers/BatchStrategyShutdownFlush.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Documentation/InjectedExtensibilityPointsAreDocumentedTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/OptionalInjectedParameterAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventTypeProviderContributionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/MultiAssemblyEventTypeProviderTests.cs
---

# Replaceable Services

Every interface a framework type takes through its constructor is an extensibility point: the
framework registers a default for it, and a host that registers its own implementation first
gets that one instead. This page is the contract behind that sentence, the list of every such
service, and the two rules a subsystem (a storage driver, a transport, a notification
listener) follows when it supplies the real implementation of one.

## The contract

1. **Required, never optional.** A framework constructor never declares an interface parameter
   as optional. An optional parameter is null at every construction site that forgets it, and
   the code that depends on it then has to ask "was I given one?" at every use. The repository's
   own analyzer, WHIZ501, reports any such declaration.
2. **A default for every seam, registered with TryAdd.** `TryAddWhizbangDefaults()` registers one
   default per interface. `AddWhizbang()` calls it, and so does every extension that can be composed
   on its own (the worker pipeline, the routing builder, the transports, the notification stack), so a
   type any of them registers is constructible. TryAdd means your registration wins whenever it comes
   first, and a host composing pieces by hand can call it directly.
3. **A null default says so.** Where no real default exists - a dead-letter store needs a
   database, a signal bus needs a transport - the default is a null object that reports itself
   through a capability flag on the interface (`IsConfigured`, or `IsAvailable` where the
   interface already meant something else by "configured"). Consumers branch on the flag and
   take the same skip path a missing registration used to produce, with no null check anywhere.
   Every such placeholder implements `INullDefault`.
4. **Subsystems displace the placeholder without displacing you.** A storage driver registers
   its dead-letter store with `TryAddSingletonOverNullDefault`, which removes the framework's
   `INullDefault` registration and then adds with TryAdd. The outcome no longer depends on
   whether the driver was registered before or after `AddWhizbang()`, and a host's own
   registration is still left alone.

## Overriding a service

Register yours before `AddWhizbang()`, or use `Replace` afterward:

```csharp{title="Overriding a turnkey default" description="Registering before AddWhizbang lets the framework's TryAdd stand aside; Replace afterward swaps the descriptor the framework added." category="Configuration" difficulty="BEGINNER" tags=["dependency-injection", "tryadd", "replace", "replaceable-services"]}
// Before AddWhizbang: TryAdd inside the framework sees yours and leaves it.
services.AddSingleton<IPerspectiveCompletionStrategy, MyCompletionStrategy>();
services.AddWhizbang(...);

// After AddWhizbang: replace the descriptor the framework added.
services.Replace(ServiceDescriptor.Singleton<IPerspectiveCompletionStrategy, MyCompletionStrategy>());
```

The two worker concurrency governors are **keyed**, because each worker sizes its own:

```csharp{title="Replacing a keyed worker governor" description="Each worker resolves its concurrency governor by its own key, so a replacement is registered under that key." category="Configuration" difficulty="INTERMEDIATE" tags=["dependency-injection", "keyed-services", "concurrency", "replaceable-services"]}
services.AddKeyedSingleton<IConcurrencyGovernor>(OutboxDrainWorker.GOVERNOR_KEY, new FixedWidthGovernor(8));
services.AddKeyedSingleton<IConcurrencyGovernor>(PerspectiveWorker.GOVERNOR_KEY, new FixedWidthGovernor(4));
```

## Supplying a subsystem's implementation

If you are writing a storage driver, transport, or listener that provides the real implementation
of a null-defaulted seam, register it so it wins regardless of order but yields to the host:

```csharp{title="Supplying a subsystem's implementation over a null default" description="TryAddSingletonOverNullDefault displaces the framework's placeholder regardless of registration order while leaving a host's own registration alone." category="Extensibility" difficulty="INTERMEDIATE" tags=["dependency-injection", "null-object", "extensibility", "replaceable-services"]}
services.TryAddSingletonOverNullDefault<IDeadLetterStore>(sp => new MyDeadLetterStore(...));
```

Plain `TryAddSingleton` would lose to the placeholder when your extension runs after
`AddWhizbang()`; plain `AddSingleton` would override a host's own store. The helper does neither.

## Every replaceable service

### Turnkey: a real default is registered

| Interface | Default | What it does |
|---|---|---|
| `IWorkChannelWriter` | `WorkChannelWriter` | In-process channel that carries claimed outbox work to the publish workers |
| `IInboxChannelWriter` | `InboxChannelWriter` | Same, for inbox work |
| `IPerspectiveChannelWriter` | `PerspectiveChannelWriter` | Same, for perspective work |
| `IPerspectiveDrainChannel`, `IOutboxDrainChannel`, `IInboxDrainChannel` | the in-process drain channels | Stream-level drain requests between claim and drain workers |
| `IFailureChannel`, `ILeaseRenewalChannel`, `IPerspectiveCompletionChannel`, `IOutboxCompletionChannel` | the flush workers | Batch failures, renewals and completions into single writes |
| `IDeferredOutboxChannel` | `DeferredOutboxChannel` | Holds outbox messages deferred until the next batch |
| `IEnvelopeRegistry` | `EnvelopeRegistry` | Maps an in-flight message to the envelope that carries it |
| `IEnvelopeSerializer` | `EnvelopeSerializer` | Serializes envelopes for storage and the wire |
| `ILifecycleMessageDeserializer` | `JsonLifecycleMessageDeserializer` | Rebuilds a typed envelope from stored JSON for lifecycle receptors |
| `IPerspectiveCompletionStrategy` | `BatchedCompletionStrategy`, sized from `PerspectiveWorkerOptions.RetryOptions` | Decides when a perspective's completions are reported |
| `IStreamIdExtractor` | the composite over every registered extractor | Finds the stream a message belongs to |
| `IEventNamespaceRegistry` | `StaticEventNamespaceRegistry` | Namespaces the generated registrations declared |
| `ICommandInboxAddressResolver` | derived from the registered outbox strategy, else a null resolver whose address is the shared inbox | Where a command's inbox lives when namespace routing is not in play |
| `IEventMarkerResolver`, `IEphemeralModeResolver` | over the message-type catalog | Event and ephemeral flags derived from message types |
| `IReceptorRegistryQuery` | adapter over `IReceptorRegistry` | Answers "does anything handle this message at this stage?" |
| `IMessageDiscardPolicy` | `MessageDiscardPolicy` | Drops messages no receptor consumes |
| `IGenerationProvider` | `DefaultGenerationProvider` | The deployment generation stamped on dead letters |
| `IReadModelsReadyGate`, `ISchemaReadyGate` | the startup gates | Signal that the schema and the read models are ready; the host starts workers registered at schema ready on the schema gate (workers never wait on it themselves), and lens reads are refused while the read-model gate is closed |
| `ILibraryVersionProvider` | the assembly version | The version an instance records and compares during rolling upgrades |
| `IScopedEventTracker`, `ISyncEventTracker`, `IEventCompletionAwaiter`, `ITrackedEventTypeRegistry`, `IPerspectiveSyncSignaler` | the local sync machinery | Append-and-wait perspective synchronization |
| `ILifecycleContextAccessor` | `AsyncLocalLifecycleContextAccessor` | The lifecycle stage of the current flow |
| `IConcurrencyGovernor` (keyed per worker) | adaptive governor from the worker's options | Concurrency for the outbox drain and perspective workers |
| `IConfiguration` | an empty root | Lets `Whizbang:*` keys be read in a host without configuration |
| `IServiceInstanceProvider` | from configuration and the entry assembly | The instance's identity |

`TryAddWhizbangDefaults()` also registers two concrete services that are not seams: `DetachedLifecycleWork`, the one record per container of the background work a stopping host waits for, and the stop-time flush `BatchStrategyShutdownFlush` as an `IHostedService`. Every entry point registers them, so a host without the worker pipeline also waits for its detached work before it disposes the service provider. See [Detached Work When the Host Stops](../../fundamentals/lifecycle/lifecycle-stages.md#host-stop).

### Null default: `IsConfigured` (or `IsAvailable`) is false until a subsystem supplies one

| Interface | Null default | Supplied by | Behavior while null |
|---|---|---|---|
| `IMessagePublishStrategy` | `NullMessagePublishStrategy` (`IsConfigured`) | a transport package | Publish workers log once and idle |
| `IEventTypeProvider` | `NullEventTypeProvider` (`IsAvailable`) | every assembly's generated perspective registration, as a contribution to one union ([below](#event-type-provider-contributions)) | Event-type-driven subscriptions and repairs skip |
| `IMessageTypeCatalog` | `NullMessageTypeCatalog` (`IsAvailable`) | generated registrations | Catalog-driven passes skip |
| `IReceptorRegistry` | `NullReceptorRegistry` | generated registrations | No receptors; `Register` throws |
| `INotifySignalingGate` | `NullNotifySignalingGate` (`IsConfigured`; `IsAvailable` is the transport's health) | a notification transport | Workers poll at their normal cadence |
| `IWorkNotificationListener` | `NoOpWorkNotificationListener` (`IsConfigured`) | a notification transport | Workers poll instead of waking on signal |
| `ISignalBus` | `NullSignalBus` (`IsConfigured`) | `AddWhizbangSignalBus` | Workers fall back to polling |
| `IDeadLetterStore` | `NullDeadLetterStore` (`IsConfigured`) | a storage driver | No dead-letter queue; rows keep accumulating |
| `IPerspectiveSnapshotStore` | `NullPerspectiveSnapshotStore` (`IsConfigured`) | a storage driver | Rewinds replay from the first event |
| `IPerspectiveStreamLocker` | `NullPerspectiveStreamLocker` (`IsConfigured`) | a storage driver | Rewinds run unlocked |
| `IStartupAssessor` | `NullStartupAssessor` (`IsConfigured`) | a storage driver (both the EF Core and the Dapper Postgres drivers) | The assess step is skipped, and the schema initializer runs with no verdict, so it can neither skip the locks on a `Current` schema nor stand down on a newer one. A registered assessor is read once per host through `StartupAssessmentSource` ([Assess](../../operations/startup/rolling-upgrades#assess)) {verified: StartupVerdictBindingTests.WithNoHost_NoSource_OrNoAssessor_ThePassIsUnassessedAsync, StartupParityTests.EachDriver_SuppliesAnAssessor_ThatReadsTheVersionRecordAsync} |
| `IDutyElector` | `NullDutyElector` (`IsConfigured`) | a notification transport | Exclusive startup duties run on every instance |
| `IPinnedConnectionPool` | `NoOpPinnedConnectionPool` | a storage driver | No connection pinning |
| `IOccurrencePublishGate` | `NoOpOccurrencePublishGate` | a notification transport | Every occurrence publishes |
| `IProcessedEventCacheObserver` | `NullProcessedEventCacheObserver` | the host | Cache activity is not observed |

### Event types: every perspective assembly contributes {#event-type-provider-contributions}
{verified: EventTypeProviderContributionTests.TwoAssemblies_TheServedProvider_ListsBothAssembliesTypes_CollectiveIncludedAsync, EventTypeProviderContributionTests.TwoAssemblies_AfterTheDefaults_TheServedProviderIsTheUnionAndAvailableAsync, EventTypeProviderContributionTests.TheDefaults_AfterTheContributions_DoNotDisplaceThemAsync, EventTypeProviderContributionTests.AnAssemblyRegisteredTwice_ContributesItsTypesOnceAsync, EventTypeProviderContributionTests.AHostsOwnProvider_RegisteredFirst_IsTheOneServedAsync, EventTypeProviderContributionTests.OnlyUnavailableContributions_TheServedProviderReportsUnavailableAsync, MultiAssemblyEventTypeProviderTests.TwoPerspectiveAssemblies_TheServedProvider_ListsBothAsync}

`IEventTypeProvider` lists the events a service's perspectives fold, plus the collective events it knows. Unlike
the other seams in the table, it has more than one supplier: every assembly that declares perspectives generates a
provider of its own. So its generated registration does not register that provider as the service. It calls
`AddEventTypeProviderContribution<T>()`:

```csharp{title="How a perspective assembly contributes its event types" description="Each assembly's generated registration adds its provider as a contribution, and the container serves one provider over every contribution." category="Extensibility" difficulty="ADVANCED" tags=["dependency-injection", "perspectives", "event-types", "replaceable-services"] tests=["MultiAssemblyEventTypeProviderTests.TwoPerspectiveAssemblies_TheServedProvider_ListsBothAsync", "EventTypeProviderContributionTests.AnAssemblyRegisteredTwice_ContributesItsTypesOnceAsync"]}
// What each perspective assembly's generated AddPerspectiveRunners does (you do not write this):
services.AddSingleton<PerspectiveRunnerRegistry>();
services.AddEventTypeProviderContribution<PerspectiveRunnerRegistry>();

// What every consumer resolves: one provider listing every contribution's types.
var eventTypes = serviceProvider.GetRequiredService<IEventTypeProvider>().GetEventTypes();
```

- **Every assembly contributes.** The resolved `IEventTypeProvider` is a `CompositeEventTypeProvider` over every
  contribution: their event types in contribution order, each type listed once. An assembly registered twice
  contributes once.
- **Order does not matter.** The union replaces the `NullEventTypeProvider` placeholder whether the contributions are
  registered before or after `AddWhizbang()`, the same way `TryAddSingletonOverNullDefault` works for the seams
  above.
- **A host's own provider wins when it comes first.** A host that registers its own `IEventTypeProvider` before the
  perspective registrations run is served that one, and the contributions do not override it.
- **Available when a contribution is.** The union reports `IsAvailable` true when at least one contribution does, so
  a host whose contributions are all unavailable keeps the "no event types known" path.

**Why a union and not one registration.** The perspective worker and its drain, the inbox pre-filter and the
polymorphic event reader each resolve a single `IEventTypeProvider`. When each assembly registered its provider as
that service, the last registration displaced the others: in a host with two perspective assemblies, every event
(collective events included) that only the other assembly knew was invisible to all of them, and nothing reported
it. A union keeps the single provider every consumer reads, and no assembly can hide another's types, whatever order
the host composes them in.

## How this is enforced

- WHIZ501 reports an optional interface-typed constructor parameter at its declaration. It
  exempts positional records (data carriers) and BCL collection interfaces such as
  `IReadOnlyList<T>`, which describe a value rather than a collaborator.
- A repository test walks every `TryAdd`/`Add` registration under `src/`, and fails if the
  interface it registers lacks a `<docs>` tag or the tag points at a page that does not exist.
