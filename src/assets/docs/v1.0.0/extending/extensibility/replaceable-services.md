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
  - src/Whizbang.Core/ContributionServiceCollectionExtensions.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunnerRegistry.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerRegistryServiceCollectionExtensions.cs
  - src/Whizbang.Core/Perspectives/CompositePerspectiveRunnerRegistry.cs
  - src/Whizbang.Core/RegistrationCollision.cs
  - src/Whizbang.Core/RegistrationCollisionStartupValidator.cs
  - src/Whizbang.Core/Messaging/ReceptorRegistryServiceCollectionExtensions.cs
  - src/Whizbang.Core/Messaging/CompositeReceptorRegistry.cs
  - src/Whizbang.Core/CompositePinnedIdRegistry.cs
  - src/Whizbang.Core/Perspectives/CompositePerspectiveInvoker.cs
  - src/Whizbang.Core/ServiceRegistrationCallbacks.cs
  - src/Whizbang.Core/ServiceAssemblyScope.cs
  - src/Whizbang.Core/WhizbangServiceAssemblies.cs
  - src/Whizbang.Core/WhizbangServiceScopeExtensions.cs
  - src/Whizbang.Core/ServiceAssemblyScopeStartupReporter.cs
  - src/Whizbang.Generators/ServiceAssemblyFactsGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres/ModelRegistrationRegistry.cs
  - src/Whizbang.Core/Messaging/IDeadLetterStore.cs
  - src/Whizbang.Core/Notifications/INotifySignalingGate.cs
  - src/Whizbang.Core/Messaging/DetachedLifecycleWork.cs
  - src/Whizbang.Core/Workers/BatchStrategyShutdownFlush.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Documentation/InjectedExtensibilityPointsAreDocumentedTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/OptionalInjectedParameterAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventTypeProviderContributionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/MultiAssemblyEventTypeProviderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRunnerRegistryContributionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/MultiAssemblyPerspectiveRunnerRegistryTests.cs
  - tests/Whizbang.Core.Tests/RegistrationCollisionsTests.cs
  - tests/Whizbang.Core.Component.Tests/RegistrationCollisionStartupValidatorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorRegistryContributionTests.cs
  - tests/Whizbang.Core.Tests/PinnedIdRegistryContributionTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveInvokerContributionTests.cs
  - tests/Whizbang.Core.Tests/ServiceRegistrationCallbacksAccumulateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ModelRegistrationRegistryTests.cs
  - tests/Whizbang.Generators.Tests/PerAssemblyRegistrationGuardTests.cs
  - tests/Whizbang.Core.Tests/ServiceScope/ServiceAssemblyScopeTests.cs
  - tests/Whizbang.Core.Tests/ServiceScope/ServiceScopedRegistrationTests.cs
  - tests/Whizbang.Core.Tests/ServiceScope/ScopedReceptorRegistryQueryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ServiceScopedModelRegistrationTests.cs
  - tests/Whizbang.Generators.Tests/ServiceScopedRegistrationGuardTests.cs
  - tests/Whizbang.Generators.Tests/ServiceAssemblyFactsGeneratorTests.cs
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
{verified: EventTypeProviderContributionTests.ATypeTwoAssembliesKnow_IsNoCollisionAsync, EventTypeProviderContributionTests.TwoAssemblies_TheServedProvider_ListsBothAssembliesTypes_CollectiveIncludedAsync, EventTypeProviderContributionTests.TwoAssemblies_AfterTheDefaults_TheServedProviderIsTheUnionAndAvailableAsync, EventTypeProviderContributionTests.TheDefaults_AfterTheContributions_DoNotDisplaceThemAsync, EventTypeProviderContributionTests.AnAssemblyRegisteredTwice_ContributesItsTypesOnceAsync, EventTypeProviderContributionTests.AHostsOwnProvider_RegisteredFirst_IsTheOneServedAsync, EventTypeProviderContributionTests.OnlyUnavailableContributions_TheServedProviderReportsUnavailableAsync, MultiAssemblyEventTypeProviderTests.TwoPerspectiveAssemblies_TheServedProvider_ListsBothAsync}

`IEventTypeProvider` lists the events a service's perspectives fold, plus the collective events it knows. Unlike
the other seams in the table, it has more than one supplier: every assembly that declares perspectives generates a
provider of its own. So its generated registration does not register that provider as the service. It contributes
it through `AddEventTypeProviderContribution<T>()`, which the generated registration reaches through
`AddPerspectiveRunnerRegistryContribution<T>()` ([below](#perspective-runner-registry-contributions)):

```csharp{title="How a perspective assembly contributes its event types" description="Each assembly's generated registration adds its provider as a contribution, and the container serves one provider over every contribution." category="Extensibility" difficulty="ADVANCED" tags=["dependency-injection", "perspectives", "event-types", "replaceable-services"] tests=["MultiAssemblyEventTypeProviderTests.TwoPerspectiveAssemblies_TheServedProvider_ListsBothAsync", "EventTypeProviderContributionTests.AnAssemblyRegisteredTwice_ContributesItsTypesOnceAsync"]}
// What a contribution of event types amounts to. Each perspective assembly's generated AddPerspectiveRunners
// reaches this through AddPerspectiveRunnerRegistryContribution<PerspectiveRunnerRegistry>() (you do not write this):
services.AddSingleton<PerspectiveRunnerRegistry>();
services.AddEventTypeProviderContribution<PerspectiveRunnerRegistry>();

// What every consumer resolves: one provider listing every contribution's types.
var eventTypes = serviceProvider.GetRequiredService<IEventTypeProvider>().GetEventTypes();
```

- **Every assembly contributes.** The resolved `IEventTypeProvider` is a `CompositeEventTypeProvider` over every
  contribution: their event types, the latest registered contribution's first ([the rule](#registration-collisions)),
  each type listed once. An assembly registered twice contributes once. A type two assemblies both know is not a
  collision: both name the same type, so neither registration is hidden.
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

### Perspective runners: every perspective assembly contributes {#perspective-runner-registry-contributions}
{verified: PerspectiveRunnerRegistryContributionTests.TwoAssemblies_EachAssemblysRunnerIsFound_WhicheverRegisteredLastAsync, PerspectiveRunnerRegistryContributionTests.APerspectiveNoAssemblyDeclares_IsNotFoundAsync, PerspectiveRunnerRegistryContributionTests.TwoAssemblies_TheServedRegistry_ListsBothAssembliesPerspectives_LatestRegisteredFirstAsync, PerspectiveRunnerRegistryContributionTests.SamePerspectiveInTwoAssemblies_TheLatestContributionAnswers_AndIsListedOnceAsync, PerspectiveRunnerRegistryContributionTests.SamePerspectiveInTwoAssemblies_IsReportedAsACollisionAsync, PerspectiveRunnerRegistryContributionTests.AnAssemblyRegisteredTwice_ListsItsPerspectivesOnceAsync, PerspectiveRunnerRegistryContributionTests.TwoAssemblies_EventTypes_AreTheUnion_OnTheRegistryAndTheServedProviderAsync, PerspectiveRunnerRegistryContributionTests.TwoAssemblies_LifecycleStagesWithReceptors_AreTheUnionAsync, PerspectiveRunnerRegistryContributionTests.AHostsOwnRegistry_RegisteredFirst_IsTheOneServedAsync, MultiAssemblyPerspectiveRunnerRegistryTests.TwoPerspectiveAssemblies_TheServedRegistry_FindsBothAssembliesRunnersAsync}

`IPerspectiveRunnerRegistry` finds the runner for a perspective by name. Like `IEventTypeProvider`, it has one
supplier per assembly that declares perspectives, and it has no default: a host with no perspectives registers none.
Each assembly's generated registration calls `AddPerspectiveRunnerRegistryContribution<T>()`, which contributes the
registry's runners and its event types in one call:

```csharp{title="How a perspective assembly contributes its runners" description="Each assembly's generated registration adds its runner registry as a contribution, and the container serves one registry over every contribution." category="Extensibility" difficulty="ADVANCED" tags=["dependency-injection", "perspectives", "runners", "replaceable-services"] tests=["MultiAssemblyPerspectiveRunnerRegistryTests.TwoPerspectiveAssemblies_TheServedRegistry_FindsBothAssembliesRunnersAsync", "PerspectiveRunnerRegistryContributionTests.TwoAssemblies_EachAssemblysRunnerIsFound_WhicheverRegisteredLastAsync"]}
// What each perspective assembly's generated AddPerspectiveRunners does (you do not write this):
services.AddSingleton<PerspectiveRunnerRegistry>();
services.AddPerspectiveRunnerRegistryContribution<PerspectiveRunnerRegistry>();

// What the perspective worker, the rebuilder and the maintenance worker resolve: one registry over every contribution.
var runner = serviceProvider.GetRequiredService<IPerspectiveRunnerRegistry>()
  .GetRunner(perspectiveName, scope.ServiceProvider);
```

- **Every assembly's runners are found.** The resolved registry is a `CompositePerspectiveRunnerRegistry`. A lookup
  asks each contribution, the latest registered first, and returns the first runner found, and a name no assembly
  declares is not found, as before. The listing of registered perspectives, the event types and the lifecycle stages with
  receptors cover every contribution. An assembly registered twice contributes once.
- **The latest declaration answers, and the other is reported.** When two assemblies declare a perspective with the
  same CLR type name, the latest contribution registered answers for it and is the one listed, and startup logs a
  warning naming the perspective and both assemblies ([the rule](#registration-collisions)). Avoid the situation:
  the name keys the perspective's rows and cursors, so the two would share them.
- **A host's own registry wins when it comes first.** A host that registers its own `IPerspectiveRunnerRegistry`
  before the perspective registrations run is served that one, and the contributions do not override it.

**Why one registry over every contribution.** The perspective worker, the rebuilder, the maintenance worker and the
stream disposition step each resolve a single `IPerspectiveRunnerRegistry`. When each assembly registered its
registry as that service, the last registration displaced the others: in a host with two perspective assemblies, no
runner for any perspective the other assembly declared could be found, whatever order the host composed them in.

### Every per-assembly registration: the latest wins, and a hidden one is reported {#registration-collisions}
{verified: RegistrationCollisionsTests.TheLatestAssemblyWins_EachEarlierAssemblyIsHiddenAsync, RegistrationCollisionsTests.AnItemOneAssemblyListsTwice_IsNotACollisionAsync, RegistrationCollisionsTests.AContribution_ComposesLatestRegisteredFirstAsync, RegistrationCollisionsTests.AContributionWithItems_ReportsAnItemTwoAssembliesShare_NamingBothAsync, RegistrationCollisionStartupValidatorTests.ACollision_UnderWarn_IsLoggedNamingBothAssemblies_AndStartsAsync, RegistrationCollisionStartupValidatorTests.CollisionsUnderFail_StopStartup_NamingEveryCollision_AfterWarningForEachAsync, RegistrationCollisionStartupValidatorTests.SeveralSources_ShareOneCheckAsync, PerAssemblyRegistrationGuardTests.EveryGeneratedRegistrationOfAHostWideService_GoesThroughAContributionAsync}

Every assembly compiled with the Whizbang generators registers its own part of several services the host resolves
once. All of them follow one rule, through one mechanism:

- **Every assembly's registration is used.** Each assembly contributes, and the host serves one composite over every
  contribution. An assembly registered twice contributes once.
- **When two different assemblies register the same item, the latest registration wins.** The composite asks the
  latest registered contribution first, so its item is the one used and the earlier one is hidden.
- **A hidden registration is reported.** At startup, one warning per collision names the item and both assemblies
  and says which one was hidden (logger category `Whizbang.Core.RegistrationCollisionStartupValidator`, event id 1):
  `IPerspectiveRunnerRegistry 'Orders.OrderSummaryPerspective' is registered by both Orders and Billing. Billing was
  registered latest and is used; Orders's registration is hidden`.
- **One setting decides whether a collision stops startup.**

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `Whizbang:Startup:RegistrationCollisions` | `Warn` \| `Fail` | `Warn` | `Whizbang__Startup__RegistrationCollisions` | `Warn` logs one warning per collision and starts with the latest registration of each. `Fail` logs the same warnings, then fails host start with an error naming every collision |

The registrations that follow the rule, and what counts as the same item in each:

| Registration | Contributed through | The same item |
|---|---|---|
| Perspective runners (`IPerspectiveRunnerRegistry`) | `AddPerspectiveRunnerRegistryContribution<T>()` ([above](#perspective-runner-registry-contributions)) | A perspective's CLR type name |
| Event types (`IEventTypeProvider`) | `AddEventTypeProviderContribution<T>()` ([above](#event-type-provider-contributions)) | Never a collision: two assemblies that know a type name the same type |
| Lifecycle receptors (`IReceptorRegistry`) | `AddReceptorRegistryContribution<T>()` ([below](#receptor-registry-contributions)) | A receptor's id (its class name) |
| Pinned identities (`IPinnedIdRegistry`) | `AddPinnedIdRegistryContribution<T>()` ([below](#pinned-id-registry-contributions)) | A pinned type |
| Perspective invokers (`IPerspectiveInvoker`) | `AddPerspectiveInvokerContribution<T>()` ([below](#perspective-invoker-contributions)) | Reported by the runner registry, which names the same perspective |
| Raw receptors, lenses, perspective services | each assembly's startup callback ([below](#startup-callbacks)) | Each assembly registers its own types; nothing is shared |
| EF Core perspective models | `ModelRegistrationRegistry.RegisterModels` ([below](#ef-core-model-registrations)) | A model type in one DbContext |

**Why one rule and one mechanism.** Each of these began as a plain registration that let the last assembly displace
the others, or as a single startup slot the next assembly overwrote, and each was found separately (#2146, #2191,
#2197 to #2201). A shared contribution mechanism makes the correct registration the only one the generated code
makes, and a generator test fails when a generated registration of a host-wide service bypasses it, so a new
per-assembly registration gets the rule by construction.

### Lifecycle receptors: every assembly contributes {#receptor-registry-contributions}
{verified: ReceptorRegistryContributionTests.TwoAssemblies_EachAssemblysLifecycleReceptorFires_WhicheverRegisteredLastAsync, ReceptorRegistryContributionTests.AReceptorTwoAssembliesDeclare_AnswersOnce_FromTheLatestAsync, ReceptorRegistryContributionTests.RuntimeRegistrations_GoToTheLatestContribution_AndAreAskedThereAsync, ReceptorRegistryContributionTests.TheContributions_ReplaceTheNullDefault_WhicheverComesFirstAsync}

Each assembly's generated dispatcher registration contributes its `GeneratedReceptorRegistry` through
`AddReceptorRegistryContribution<T>()`, and the host serves one `CompositeReceptorRegistry`. A lookup returns every
assembly's receptors for the message and stage, and a receptor two assemblies declare under one id runs once, from
the latest registration. **Runtime registrations go to the latest contribution**: `Register`, `Unregister` and the
runtime queries all go to it, so a receptor registered once is found once and unregistered from where it was
registered. Before this, the last assembly's registry displaced the others, and no lifecycle receptor (`[FireAt]`)
declared in any other assembly fired at a worker stage.

### Pinned identities: every assembly contributes {#pinned-id-registry-contributions}
{verified: PinnedIdRegistryContributionTests.TwoAssemblies_EachAssemblysPinnedTypeIsKnownAsync, PinnedIdRegistryContributionTests.ATypeTwoAssembliesPin_AnswersFromTheLatest_AndIsListedOnceAsync}

Whizbang.Core pins types of its own, so every host has at least two pinned-identity registries: Whizbang.Core's and
its own. Each assembly's registry is contributed through `AddPinnedIdRegistryContribution<T>()`, and the host serves
one `CompositePinnedIdRegistry` that knows every assembly's pinned types.

### Perspective invokers: every assembly contributes {#perspective-invoker-contributions}
{verified: PerspectiveInvokerContributionTests.TwoAssemblies_AnEventReachesEveryAssemblysInvokerAsync, PerspectiveInvokerContributionTests.EachScope_GetsItsOwnInvokersAsync}

Each assembly's generated perspective invoker runs only that assembly's perspectives. It is contributed through
`AddPerspectiveInvokerContribution<T>()`, and each scope gets one `CompositePerspectiveInvoker` that queues every
event with, and invokes, every assembly's invoker. An event store that invokes perspectives inline (the Dapper event
store) runs every assembly's perspectives.

### Startup callbacks: every assembly's runs {#startup-callbacks}
{verified: ServiceRegistrationCallbacksAccumulateTests.RawReceptors_RunsEveryAssemblysCallback_InTheOrderSetAsync, ServiceRegistrationCallbacksAccumulateTests.PinnedIdRegistry_RunsEveryAssemblysCallback_InTheOrderSetAsync, ServiceRegistrationCallbacksAccumulateTests.LensServices_RunsEveryAssemblysCallback_InTheOrderSetAsync, ServiceRegistrationCallbacksAccumulateTests.PerspectiveServices_RunsEveryAssemblysCallback_InTheOrderSetAsync}

`AddWhizbang()` registers what each assembly's generated module initializer hands it through
`ServiceRegistrationCallbacks`: raw receptors, pinned identities, lenses and perspective services, as it already did
for dispatchers and message-type catalogs. Each slot accumulates: every assembly's callback runs, in the order the
assemblies loaded. A single-valued slot used to keep only the last assembly's, so raw receptors, lenses and
perspective services declared in every other assembly were never registered.

### EF Core perspective models: every assembly's are registered {#ef-core-model-registrations}
{verified: ModelRegistrationRegistryTests.InvokeRegistration_EveryAssemblysRegistrar_RunsAsync, ModelRegistrationRegistryTests.RegisterModels_TheSameAssemblyAgain_ReplacesOnlyItsOwnEntryAsync, ModelRegistrationRegistryTests.InvokeRegistration_AModelTwoAssembliesRegister_IsReportedAsync}

Each assembly's generated model registration registers itself with `ModelRegistrationRegistry`, keyed by the
assembly, together with the models it registers for each DbContext. The driver runs every assembly's registration
for its DbContext, in the order the assemblies registered, so the latest assembly's registration of a model is the
one the container serves, and a model two assemblies both register for the same DbContext is reported at startup. A
re-registration from the same assembly (a test calling the generated `Initialize()` again, or a hot reload) replaces
only that assembly's own entry. Before this, only the latest registration ran, and models declared in every other
assembly were not registered.

### Which assemblies a host gets: its own service's {#service-scope}
{verified: ServiceAssemblyScopeTests.TwoServicesInOneProcess_EachHostIncludesItsOwnServiceAndTheSharedAssemblies_NotTheOtherAsync, ServiceAssemblyScopeTests.SingleServiceProcess_ExcludesNothing_WhicheverAssemblyTheHostAnchorsOnAsync, ServiceAssemblyScopeTests.ServiceSplitOverSeveralAssemblies_KeepsEveryOneOfThem_BesideAnotherServiceAsync, ServiceAssemblyScopeTests.ModularMonolith_AHostPerModule_GetsItsModuleAndTheCompositionRoot_NotTheOtherModuleAsync, ServiceAssemblyScopeTests.NoAnchor_IncludesEveryAssembly_SoAHostThatNamesNoServiceKeepsTodaysRegistrationsAsync, ServiceAssemblyScopeTests.AnAnchorWithNoRecordedFacts_LeavesTheHostUnscoped_RatherThanGuessAtItsReferencesAsync, ServiceScopedRegistrationTests.TwoHostsInOneProcess_EachGetsOnlyItsOwnServicesRegistrationsAsync, ServiceScopedRegistrationTests.EverySlot_ReplaysOnlyTheHostsOwnServiceAsync, ServiceScopedRegistrationTests.RegistrationsMadeBeforeAndAfterTheReplay_KeepTheirPlaceAsync, ServiceScopedModelRegistrationTests.WithEFCore_AnchorsTheHostOnTheDbContextsAssemblyAsync, ScopedReceptorRegistryQueryTests.AScopedHost_AnswersForItsOwnServicesReceptorsOnlyAsync, PerspectiveRunnerRegistryContributionTests.AContributionWhoseRegistryWasRemoved_IsSkipped_AndTheHostStillBuildsAsync, ServiceScopedRegistrationGuardTests.EveryServiceRegistrationAModuleInitializerHandsOver_NamesItsAssemblyAsync}

Every assembly's registrations are used, but only by a host of the service the assembly belongs to. A process that
holds one service is unaffected. A process that builds several hosts, one per service (an integration-test process,
or a modular monolith that hosts each module separately), gives each host its own service's generated registrations
and none of the others': perspective runners and event types, receptors and the receive-side consumer query, raw
receptors, lenses and perspective services, pinned identities, the message-type catalog and EF Core models.

**What each assembly records.** Every assembly compiled with the generators records, at build time, three facts:
its name, whether it is a *service root* (an executable, or an assembly that declares a `[WhizbangDbContext]`), and
the generated assemblies it was compiled against. Nothing is read by reflection at run time; the host compares names.

**What names a host's service: its anchors.** A host *anchors* on the assembly of every DbContext it registers, so
`WithEFCore<TDbContext>()` is all a host with a DbContext needs. A host with no DbContext, in a process that holds
several services, names its service itself:

```csharp{title="Naming a host's service without a DbContext" description="A host with no DbContext in a multi-service process anchors on any type in one of its service's assemblies." category="Configuration" difficulty="INTERMEDIATE" tags=["dependency-injection", "service-scope", "multi-service", "replaceable-services"]}
services.AddWhizbang()
  .ForServiceOf<NotificationsWorker>();   // any type in one of the service's assemblies

// or, on the service collection, before or after AddWhizbang():
services.AddWhizbangServiceAnchor<NotificationsWorker>();
```

**The rule: a host excludes another service's assemblies, and only those.**

- The host's own assemblies are every anchor, everything an anchor is built on, and every service root built on an
  anchor (the executable above a data assembly, a composition root, a test assembly).
- Another service is a service root that is not the host's own. It, and everything only it is built on, is excluded.
  An assembly both services are built on (a shared contracts assembly) stays.
- Everything else stays: a helper assembly no other service is built on, an assembly compiled without the
  generators, and a registration made without an assembly name.

**A single-service process excludes nothing.** Only another service's root can make an assembly someone else's, so
when the process holds one service, every assembly is included wherever its DbContext lives. A service split over
several assemblies keeps all of them, which is what the contribution rules above rely on.

**A host that names no service keeps everything,** as before: so does a host whose anchor recorded no facts (an
assembly compiled without the generators, or one whose module initializer has not run yet).

**Why the DbContext, and not the code that calls `AddWhizbang()`.** A test process typically composes every host
from one test assembly that references every service, so the caller cannot tell the services apart; the DbContext
a host registers always names its service.

**The startup report.** At startup the host logs, at Debug (logger category
`Whizbang.Core.ServiceAssemblyScopeStartupReporter`), the anchors and the assemblies it included and excluded, or
why it is unscoped:
`Generated registrations are scoped to the service anchored on [Orders]: included [Orders, Shared.Contracts];
excluded as another service's [Billing]`.

**No hygiene code.** Nothing needs removing from a host's service collection. A contribution whose implementation was
removed anyway contributes nothing, instead of failing the host with `No service for type`.

**Behavior changes.**

- `AddWhizbang()` replays the generated registrations once per service collection. A second `AddWhizbang()` call
  re-applies the replay (picking up assemblies loaded since) instead of registering every callback a second time.
- When an anchor arrives after `AddWhizbang()` (as `WithEFCore<TDbContext>()` does), the replayed registrations are
  re-applied under the new scope, in the same place in the collection. Registrations you make before and after
  `AddWhizbang()` keep their place. Change or remove generated registrations after the `AddWhizbang()...WithEFCore`
  chain, not between its calls.
- A callback assigned directly to a `ServiceRegistrationCallbacks` slot (`ServiceRegistrationCallbacks.Dispatcher =
  ...`) carries no assembly name, so every host replays it.

**Not scoped yet: Dapper hosts.** A Dapper-backed host registers no DbContext, so it has no anchor and keeps every
assembly's registrations, and its perspective registry is reconciled from every loaded assembly. Anchor it with
`ForServiceOf<TMarker>()` when it shares a process with other services.

## How this is enforced

- WHIZ501 reports an optional interface-typed constructor parameter at its declaration. It
  exempts positional records (data carriers) and BCL collection interfaces such as
  `IReadOnlyList<T>`, which describe a value rather than a collaborator.
- A repository test walks every `TryAdd`/`Add` registration under `src/`, and fails if the
  interface it registers lacks a `<docs>` tag or the tag points at a page that does not exist.
- A generator test runs every Whizbang generator over a source that declares every kind of per-assembly item and
  fails if the generated code registers a host-wide service directly instead of contributing to it
  ([the rule](#registration-collisions)).
- A generator test runs every Whizbang generator and fails when a generated module initializer hands a service
  registration to the framework without naming its assembly, so a new per-assembly registration is service-scoped
  by construction ([service scope](#service-scope)).
