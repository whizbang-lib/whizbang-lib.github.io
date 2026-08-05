# Docs ↔ Tests Backfill Plan

**Updated:** 2026-08-04 · **Docs:** `develop` (v1.0.0 doc set, 260 content pages) · **Library:** `develop` @ `a64ba9a`

Docs-side companion to [`plans/missing-tests.md`](missing-tests.md) (code-block coverage-map gaps, Track 1/Track 2) and [`plans/verified-coverage-burndown.md`](verified-coverage-burndown.md) (per-page verified-coverage floor). Those plans work the **code-block** layer; this one works the **symbol / stamp / diagram / sample** layers, from the 2026-07-30 audit refreshed 2026-08-04.


## Progress log

- **2026-08-05 — Phases 1–3 DONE** (docs PR #280): 2 broken refs fixed; all 6 unstamped pages verified against `a64ba9a0`, corrected (root README rewritten; stream-integrity 19 corrections; migration-guide CLI section rewritten; health fault-mapping fixed) and stamped with full `testReferences`; both maps regenerated; generators ported off undeclared `glob`.
- **2026-08-05 — Phase 4 (mechanical) DONE** (library PR #415): 97 stale `<docs>` tags across 57 files retargeted to real pages (incl. the whole `Integrity*` family off `proposals/stream-integrity`). Remaining Phase 4 items are user decisions — see "Phase 4 decisions needed" below.
- **2026-08-05 — Phase 5 wave 1 DONE** (library PR #418): the 6 worst published targets (84 symbols) investigated; **81 were tested-but-unlinked** → 223 `<tests>` tags added; 1 fabricated tag removed; 2 map-parser misattributions fixed. Doc-linked uncovered symbols: **718 → 638**. Confirmed Track-2 gaps (tests to write): `PinnedPoolMetrics`, `CollectiveApplyBatchSize` DI wiring, `DapperCollectiveTableRegistry`.
- **Remaining**: Phase 4 decisions (below) · Phase 5 waves 2+ (638 uncovered symbols, 229 published targets — same investigate→tag pipeline) · Phase 6/7 (97 diagram pins + sample tagging; unblocked per-page as symbol tags land) · Phase 8 (re-verification sweep of 173 stale pages).

## Phase 4 decisions needed (user)

Library `<docs>` tags point at doc targets that are not published pages. Per target: **promote** the page into v1.0.0, **write** it, or **retarget/drop** the tags.

**Drafts referenced by code (11 targets → promote or hold):**
- `drafts/core-concepts/pinned-identity.md`
- `drafts/fundamentals/signal-bus/signal-bus.md`
- `drafts/fundamentals/work-coordinator/app-signals.md`
- `drafts/fundamentals/work-coordinator/batched-flushers.md`
- `drafts/fundamentals/work-coordinator/claim-loop.md`
- `drafts/fundamentals/work-coordinator/configuration-reference.md`
- `drafts/fundamentals/work-coordinator/handler-commit.md`
- `drafts/fundamentals/work-coordinator/notifications-and-pgbouncer.md`

**Proposals referenced by code (graduate or retarget):**
- `proposals/carry-forward-tier2.md`
- `proposals/ephemeral-events.md`
- `proposals/temporal-engine.md`
- `proposals/type-definition-fingerprint.md`

**Never-written targets (54, by symbol count — write the page or drop the tag):**
-  13 syms — `fundamentals/work-coordinator/per-stream-drain`
-   8 syms — `fundamentals/temporal/pre-fire-hook`
-   8 syms — `fundamentals/temporal/recurrence`
-   6 syms — `fundamentals/work-coordinator/commit-sequence`
-   5 syms — `fundamentals/work-coordinator/backup-tick-coordinator`
-   5 syms — `internals/outbox-batch-strategy`
-   4 syms — `testing/multi-service-harness`
-   4 syms — `fundamentals/work-coordinator/lease-cancellation`
-   4 syms — `internals/receptor-registry-query`
-   3 syms — `fundamentals/lifecycle/lifecycle-reconciliation`
-   3 syms — `fundamentals/work-coordinator/idle-activity-tracking`
-   3 syms — `fundamentals/work-coordinator/startup-ordering`
-   3 syms — `internals/inbox-batch-strategy`
-   3 syms — `fundamentals/perspectives/drain-mode`
-   3 syms — `internals/apply-batch-strategy`
-   3 syms — `fundamentals/messaging/directed-messages`
-   3 syms — `internals/message-discard-policy`
-   3 syms — `fundamentals/receptors/raw-receptors`
-   2 syms — `apis/graphql/authorization#require-permission`
-   2 syms — `fundamentals/perspectives/cursor-inversion`
-   2 syms — `fundamentals/work-coordinator/inbox-dispatch`
-   2 syms — `internals/stream-affinity`
-   2 syms — `operations/workers/processing-hooks`
-   2 syms — `operations/workers/outbox-publish-worker#processing-hooks`
-   2 syms — `fundamentals/temporal/saga-deadlines`
-   2 syms — `resilience/stream-rate-limiter`
-   2 syms — `operations/testing/chaos-injection`
-   2 syms — `messaging/inbox-channel`
-   1 syms — `fundamentals/transport/asb-receive`
-   1 syms — `fundamentals/security/token-refresh#signalr-default`
-   1 syms — `operations/diagnostics/whiz900`
-   1 syms — `operations/infrastructure/deadlock-retry`
-   1 syms — `operations/workers/inbox-dispatch-worker`
-   1 syms — `fundamentals/work-coordinator/inbox-drain`
-   1 syms — `fundamentals/work-coordinator/per-stream-drain#sliding-window`
-   1 syms — `fundamentals/work-coordinator/maintenance`
-   1 syms — `operations/workers/publisher-worker`
-   1 syms — `fundamentals/work-coordinator/per-stream-drain#cross-stream-parallelism`
-   1 syms — `fundamentals/work-coordinator/outbox-publish`
-   1 syms — `fundamentals/perspectives/drain-mode#sliding-window`
-   1 syms — `docs/transport-routing-architecture.md#transport-echo-suppression`
-   1 syms — `messaging/transports/transport-options`
-   1 syms — `fundamentals/security/effective-permissions`
-   1 syms — `fundamentals/security/token-refresh`
-   1 syms — `fundamentals/security/effective-permissions#in-memory`
-   1 syms — `fundamentals/security/jwt-claim-builder`
-   1 syms — `resilience/circuit-breaker`
-   1 syms — `operations/observability/logging#startup`
-   1 syms — `fundamentals/serialization/type-binding`
-   1 syms — `operations/testing/receptor-firing-observer`
-   1 syms — `operations/maintenance`
-   1 syms — `fundamentals/transport/message-headers`
-   1 syms — `internals/ordering-invariant`
-   1 syms — `operations/observability/receptor-logging`

## 1. Verification staleness

- 254 pages stamped `verifiedAgainstCommit: 1b31f58d` / `verifiedDate: 2026-07-16` (July sweep; rewritten-history equivalent `cc220ec`).
- Library has changed **698 files** since the sweep (0.957 → 0.962+).
- **173 of 260 pages** reference at least one changed file → re-verification candidates.
- **6 pages have no stamp** (post-sweep additions):
  - `README.md` (root)
  - `migration-guide/README.md`
  - `resilience/database-availability-middleware.md`
  - `resilience/managed-resource-health.md`
  - `resilience/managed-resource-run-control.md`
  - `resilience/stream-integrity.md` ← merged 2026-08-04 (PR #255, implemented + live-validated; verify against HEAD and stamp)

## 2. Mechanical validity (as of 2026-08-04)

- `validate-frontmatter`: PASS (97 mermaid `tests=[…]` warnings, §3C). `verify-sample-drift`: PASS (1 tagged sample, §3D).
- All `testReferences` resolve. **2 broken `codeReferences`:**

  | Page | Broken ref | Fix |
  |---|---|---|
  | `apis/graphql/lens-integration.md` | `…/Attributes/GraphQLLensScopes.cs` | type moved into `Attributes/GraphQLLensAttribute.cs` |
  | `migration-guide/README.md` | `tools/Whizbang.Migrate/Core/MigrationEngine.cs` | tool restructured — retarget (`Core/MigrationTypes.cs` / `Program.cs`) |

- **Library `<docs>` tags → unpublished/missing pages:** of 296 doc targets carrying untested symbols — 237 published, 11 drafts, 3 proposals, 3 path mismatches, **42 with no page anywhere** (work-coordinator / temporal / internals families dominate).
- `code-tests-map.json` was generated **2026-07-25** — it predates Stream Integrity, so the eight `Integrity*` classes aren't represented in §3A yet. **Regenerate the map** (see burndown plan's follow-up) before working §3A so new symbols are counted.

## 3. The missing-tests backfill list

### A. Doc-linked symbols with no linked test — 669 of 1,066 (63%)

438 of 669 on published pages. By doc target, worst first (full symbol lists in appendix):

| # | Doc target | Status | Untested symbols |
|---|---|---|---|
| 37 | `fundamentals/events/ephemeral-events` | proposal (proposals/ephemeral-events.md) | `ArchivedEvent`, `Compacted`, `CompactionResult`, `DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute`, `Destruction`, `DestructionContext`, `DestructionGranularity`, `DestructionReason` … |
| 26 | `fundamentals/messaging/collective-events` | published | `CollectiveApplyBatchSize`, `CollectiveApplyEntry`, `CollectiveApplyLockKey`, `CollectiveApplyOptions`, `CollectiveDispatchResult`, `CollectiveEventBase`, `CollectiveEventsDapperExtensions`, `CollectiveEventsEFCoreExtensions` … |
| 21 | `fundamentals/signal-bus/signal-bus` | draft (drafts/fundamentals/signal-bus/signal-bus.md) | `BasePollSignalSource`, `IPollSignalSource`, `ISignal`, `ISignalBus`, `ISignalSink`, `ISignalSource`, `ISignalSubscription`, `ISignalTransport` … |
| 16 | `fundamentals/perspectives/perspective-sync` | published | `AllPendingFilter`, `AndFilter`, `AwaitPerspectiveSyncAttribute`, `CurrentScopeFilter`, `EventTypeFilter`, `IPerspectiveSyncAwaiter`, `IPerspectiveSyncSignaler`, `IScopedEventTracker` … |
| 14 | `offloads` | path-mismatch (v1.0.0/fundamentals/offloads/) | `AddWhizbangAzureBlobOffloadsFromConfiguration`, `AzureBlobMessageBodyStore`, `AzureBlobOffloadOptions`, `AzureBlobOffloadServiceCollectionExtensions`, `BodyClaimEnvelopePayload`, `IMessageBodyStore`, `IPostSerializeHook`, `InMemoryOffloadServiceCollectionExtensions` … |
| 14 | `fundamentals/work-coordinator/configuration-reference` | draft (drafts/fundamentals/work-coordinator/configuration-reference.md) | `ClaimWorkerOptions`, `FailureFlushWorkerOptions`, `HeartbeatRequest`, `HeartbeatWorkerOptions`, `InboxDeserializeCacheOptions`, `InboxDispatchWorkerOptions`, `InboxHandlerWorkerOptions`, `LeaseRenewalWorkerOptions` … |
| 13 | `fundamentals/messaging/apply-hooks` | published | `ApplyHookColumns`, `ApplyHookContext`, `ApplyHookOp`, `CollectiveApplyHookPlan`, `CollectiveApplyHookRegistry`, `IApplyHook`, `IApplyHookBuilder`, `ICollectiveApplyHook` … |
| 12 | `fundamentals/work-coordinator/notifications-and-pgbouncer` | draft (drafts/fundamentals/work-coordinator/notifications-and-pgbouncer.md) | `AddWhizbangNotificationDataSource`, `INotificationConnectionStringFallback`, `INotificationDataSource`, `INotifySignalingGate`, `INotifySubscription`, `ISharedNotifyConnection`, `IWorkNotificationListener`, `PgSearchPath` … |
| 11 | `extending/attributes/auto-populate` | published | `AutoPopulateRegistration`, `AutoPopulateRegistry`, `ContextKind`, `IAutoPopulatePopulator`, `IAutoPopulateProcessor`, `IAutoPopulateRegistry`, `IdentifierKind`, `PopulateFromHttpHeaderAttribute` … |
| 10 | `fundamentals/temporal/temporal-engine` | proposal (proposals/temporal-engine.md) | `IScheduleClaimer`, `IScheduleManager`, `MisfirePolicy`, `PgScheduleClaimer`, `PgScheduleDuePollSource`, `PgScheduleManager`, `ScheduleDefinition`, `ScheduleDeliveryGuarantee` … |
| 10 | `fundamentals/work-coordinator/per-stream-drain` | MISSING | `IInboxDrainChannel`, `IOutboxDrainChannel`, `InboxBatchRow`, `InboxDrainChannel`, `InboxDrainWorkerOptions`, `OutboxBatchRow`, `OutboxDrainChannel`, `OutboxDrainWorkerOptions` … |
| 9 | `fundamentals/workers/pinned-connection-pool` | published | `IBorrowedConnection`, `IPinnedConnectionPool`, `NoOpPinnedConnectionPool`, `PinnedConnectionContext`, `PinnedConnectionPool`, `PinnedPoolMetrics`, `PinnedPoolServiceCollectionExtensions`, `PostgresPinnedPoolServiceCollectionExtensions` … |
| 9 | `fundamentals/events/type-definition-fingerprint` | proposal (proposals/type-definition-fingerprint.md) | `DefinitionRelationship`, `EphemeralOptions`, `RecordDefinitionLineageAsync`, `SchemaHash`, `SettingsHash`, `TypeDefinitionInfo`, `TypeDefinitionReconcileSummary`, `TypeDefinitionReconcilerHostedService` … |
| 9 | `fundamentals/work-coordinator/batched-flushers` | draft (drafts/fundamentals/work-coordinator/batched-flushers.md) | `BatchFlusherOptions`, `CompletePerspectiveAsync`, `FailureFlushWorker`, `FlushCompletionsAsync`, `FlushCompletionsRequest`, `LeaseRenewalWorker`, `PerspectiveCompletionFlushWorker`, `ReportFailuresAsync` … |
| 9 | `resilience/managed-resource-run-control` | published | `IWhizbangKillswitch`, `IWhizbangLifecycleState`, `IWhizbangRunControl`, `LifecycleAckTimeoutException`, `LifecyclePhaseExtensions`, `RunPermitControl`, `RunState`, `WhizbangLifecycleOptions` … |
| 8 | `resilience/managed-resource-health` | published | `ComponentState`, `ConnectivityRequirement`, `HealthPolicy`, `HealthProbe`, `IWhizbangHealthSource`, `WhizbangHealthOptions`, `WhizbangHealthServiceCollectionExtensions`, `WhizbangManagedHealthCheckExtensions` |
| 8 | `operations/dead-letter-queue/internal-dlq` | published | `EnqueueSecurityContextTimeoutFailureAsync`, `IDeadLetterStore`, `IGenerationProvider`, `PublishTimeoutSeconds`, `SecurityContextEstablishmentOutcome`, `SecurityContextTimeoutSeconds`, `UnobservedExceptionDiagnosticsOptions`, `identifier` |
| 7 | `fundamentals/temporal/pre-fire-hook` | MISSING | `FireAction`, `IOccurrencePublishGate`, `IScheduleFireHook`, `IScheduleOccurrenceStore`, `NoOpOccurrencePublishGate`, `OccurrencePublishDecision`, `PgScheduleOccurrenceStore` |
| 6 | `fundamentals/events/event-store-query` | published | `EventStoreQueryFactory`, `GetEventStoreQuery`, `GetGlobalEventStoreQuery`, `GetTenantEventStoreQuery`, `GetUserEventStoreQuery`, `IEventStoreQueryFactory` |
| 6 | `fundamentals/work-coordinator/commit-sequence` | MISSING | `CommitOrderStamperOptions`, `CreateSnapshotAsync`, `GetLatestSnapshotAsync`, `PgCommitOrderStamperWorker`, `SourceCommitSequence`, `SourceServiceId` |
| 6 | `fundamentals/receptors/lifecycle-receptors` | published | `GeneratedReceptorRegistry`, `ILifecycleContext`, `IReceptorInvoker`, `IReceptorRegistry`, `LifecycleExecutionContext`, `last` |
| 6 | `fundamentals/temporal/recurrence` | MISSING | `CronRecurrenceRule`, `DefaultRecurrenceRuleFactory`, `IRecurrenceRule`, `IRecurrenceRuleFactory`, `OneShotRecurrenceRule`, `RecurrenceKind` |
| 6 | `event-upcasting` | path-mismatch (v1.0.0/fundamentals/events/event-upcasting.md) | `IVersionedJsonSerializer`, `IVersionedJsonSerializerRegistry`, `SerializationOptions`, `SerializationResult`, `SerializationVersion`, `SnapshotUpgradePolicy` |
| 5 | `messaging/transports/rabbitmq#connection-retry` | published | `BackoffMultiplier`, `InitialRetryAttempts`, `InitialRetryDelay`, `MaxRetryDelay`, `RetryIndefinitely` |
| 5 | `fundamentals/perspectives/physical-fields` | published | `PhysicalFieldHydratorRegistry`, `PhysicalFieldMaterializationInterceptor`, `PhysicalFieldQueryInterceptor`, `SplitModeChangeTrackerHydrator`, `UseWhizbangPhysicalFields` |
| 5 | `operations/dead-letter-queue/recovery` | published | `DeadLetterRecoveryOptions`, `DeadLetterRecoveryStatus`, `IDeadLetterRecoveryPolicy`, `IDeadLetterRecoveryService`, `RecoveryPolicy` |
| 5 | `operations/infrastructure/migrations#migration-events` | published | `MigrationBatchCompleted`, `MigrationBatchStarted`, `MigrationItemCompleted`, `MigrationItemFailed`, `MigrationItemStarted` |
| 4 | `fundamentals/sagas/completion-orchestration` | published | `ISagaCompletionAbandonedEvent`, `SagaCompletionAbandonedEvent`, `SagaCompletionWatchdogTickEvent`, `SagaOptions` |
| 4 | `data/work-coordinator-strategies` | published | `IWorkFlusher`, `WhizbangFlushMiddlewareExtensions`, `WorkCoordinatorOptions`, `WorkCoordinatorStrategy` |
| 4 | `resilience/database-availability-middleware` | published | `AddWhizbangSchemaReadyCheck`, `AvailabilityGateMode`, `UseDatabaseAvailabilityGate`, `WhizbangAvailabilityOptions` |
| 4 | `fundamentals/perspectives/rebuild` | published | `EFCorePostgresPerspectiveCheckpointCompleter`, `IPerspectiveCheckpointCompleter`, `RebuildCommandReceptorRegistrar`, `RebuildPerspectiveCommandReceptor` |
| 4 | `fundamentals/security/security#principal-filtering` | published | `JsonArrayContainsAnyTranslator`, `WhizbangDbContextOptionsExtensions`, `WhizbangJsonDbFunctions`, `WhizbangMethodCallTranslatorPlugin` |
| 4 | `messaging/transports/transport-consumer#subscription-resilience` | published | `AllowPartialSubscriptions`, `HealthCheckInterval`, `ResilienceOptions`, `SubscriptionStatus` |
| 4 | `messaging/transports/transport-consumer#batch-options` | published | `BatchSize`, `MaxWaitMs`, `SlideMs`, `TransportBatchOptions` |
| 4 | `internals/outbox-batch-strategy` | MISSING | `IOutboxBatchStrategy`, `ImmediateOutboxBatchStrategy`, `QueueOutboxMessageAsync`, `SlidingWindowOutboxOptions` |
| 4 | `operations/observability/stuck-row-sentinel` | published | `StuckRow`, `StuckRowSentinelEnabled`, `StuckRowSentinelLimit`, `StuckRowSentinelMaxAttempts` |
| 4 | `messaging/transports/transports` | published | `BulkPublishItem`, `BulkPublishItemResult`, `ITransportManager`, `ITransportReadinessCheck` |
| 4 | `fundamentals/receptors/exactly-once-firing` | published | `Guardrails`, `IReceptorDedupStore`, `ReceptorInvocationRecord`, `WhizbangGuardrailsOptions` |
| 4 | `fundamentals/messaging/composite-events#fanout-control` | published | `DispatchFanoutControl`, `FanoutAtomicity`, `FanoutDirective`, `FanoutMode` |
| 4 | `fundamentals/perspectives/perspectives#rebuild-events` | published | `PerspectiveRebuildCompleted`, `PerspectiveRebuildFailed`, `PerspectiveRebuildProgress`, `PerspectiveRebuildStarted` |
| 3 | `core-concepts/pinned-identity` | draft (drafts/core-concepts/pinned-identity.md) | `IMessageTypeCatalog`, `IMessageTypeRegistryPopulator`, `IPinnedIdRegistry` |
| 3 | `fundamentals/dispatcher/dispatcher` | published | `IDeliveryReceipt`, `IDispatcher`, `IExecutionStrategy` |
| 3 | `fundamentals/dispatcher/publish-once` | published | `EFCoreClaimedEmissionStore`, `IClaimedEmissionStore`, `message` |
| 3 | `internals/inbox-batch-strategy` | MISSING | `IInboxBatchStrategy`, `ImmediateInboxBatchStrategy`, `SlidingWindowInboxOptions` |
| 3 | `fundamentals/perspectives/drain-mode` | MISSING | `IPerspectiveDrainChannel`, `PerspectiveDrainChannel`, `_processDrainModeStreamsAsync` |
| 3 | `messaging/transports/transport-consumer#inbox-batching` | published | `InboxBatchMaxWaitMs`, `InboxBatchSize`, `InboxBatchSlideMs` |
| 3 | `fundamentals/security/security#receptor-permission-gate` | published | `DefaultRequirePermissionInterceptor`, `DeniedAction`, `IReceptorInterceptor` |
| 3 | `fundamentals/security/scoping#marker-interfaces` | published | `ICustomerScoped`, `IOrganizationScoped`, `IUserScoped` |
| 3 | `fundamentals/perspectives/rewind` | published | `IPerspectiveApplyCoordinator`, `PerspectiveApplyCoordinator`, `RewindCursorInfo` |
| 3 | `fundamentals/perspectives/perspectives#rebuild` | published | `CancelPerspectiveRebuildCommand`, `IPerspectiveRebuilder`, `RebuildPerspectiveCommand` |
| 3 | `internals/receptor-registry-query` | MISSING | `IReceptorRegistryQuery`, `ReceptorRegistryContribution`, `WhizbangReceptorRegistryQuery` |
| 3 | `extending/features/debugger-aware-clock` | published | `DebuggerAwareClockOptions`, `IActiveStopwatch`, `IDebuggerAwareClock` |
| 2 | `messaging/transports/azure-service-bus#auto-provisioning` | published | `AutoProvisionInfrastructure`, `_ensureInfrastructureExistsAsync` |
| 2 | `messaging/transports/azure-service-bus#sessions` | published | `EnableSessions`, `MaxConcurrentSessions` |
| 2 | `fundamentals/security/http-security-headers` | published | `WhizbangSecurityHeadersMiddlewareExtensions`, `WhizbangSecurityHeadersOptions` |
| 2 | `extending/source-generators/polymorphic-serialization` | published | `InheritanceInfo`, `PolymorphicTypeInfo` |
| 2 | `fundamentals/identity/pinned-type-ledger` | published | `IEventTypeRenameTool`, `_generateRenameAliasRegistrations` |
| 2 | `data/efcore-complex-types#in-place-updates` | published | `UpdateMetadataInPlace`, `UpdateScopeInPlace` |
| 2 | `fundamentals/identity/whizbang-ids` | published | `IWhizbangId`, `constraint` |
| 2 | `fundamentals/dispatcher/dispatch-patterns#localsendmanyasync` | published | `ONLY`, `routing` |
| 2 | `fundamentals/lifecycle/lifecycle-stages#immediate-async` | published | `ImmediateDetachedChainWarningThreshold`, `_invokeImmediateDetachedReceptorsAsync` |
| 2 | `fundamentals/work-coordinator/claim-loop` | draft (drafts/fundamentals/work-coordinator/claim-loop.md) | `ProcessChannelBatchAsync`, `WorkCoordinatorPumpAdapter` |
| 2 | `fundamentals/messages/message-associations` | published | `MessageAssociationRecord`, `MessageAssociationsSchema` |
| 2 | `fundamentals/work-coordinator/app-signals` | draft (drafts/fundamentals/work-coordinator/app-signals.md) | `IAppSignalChannel`, `PgAppSignalChannel` |
| 2 | `operations/workers/processing-hooks` | MISSING | `WorkProcessingIdleHandler`, `WorkProcessingStartedHandler` |
| 2 | `operations/workers/outbox-publish-worker#processing-hooks` | MISSING | `OutboxMessagePublishedEvent`, `OutboxMessagePublishedHandler` |
| 2 | `operations/workers/perspective-worker#processing-hooks` | published | `PerspectiveEventProcessedEvent`, `PerspectiveEventProcessedHandler` |
| 2 | `operations/dead-letter-queue/transport-recovery` | published | `ITransportDeadLetterDrainer`, `TransportDeadLetterDrainWorkerOptions` |
| 2 | `internals/apply-batch-strategy` | MISSING | `IApplyBatchStrategy`, `SlidingWindowApplyOptions` |
| 2 | `operations/workers/perspective-worker` | published | `IPerspectiveCompletionStrategy`, `PerspectiveWorker` |
| 2 | `fundamentals/perspectives/rewind#startup-scan` | published | `PerspectiveStartupScanLog`, `_scanAndRepairRewindsOnStartupAsync` |
| 2 | `fundamentals/work-coordinator/idle-activity-tracking` | MISSING | `IIdleActivityTracker`, `IdleActivityTouchHookBinder` |
| 2 | `fundamentals/work-coordinator/startup-ordering` | MISSING | `ISchemaReadyGate`, `SchemaReadyGate` |
| 2 | `fundamentals/work-coordinator/backup-tick-coordinator` | MISSING | `BackupTickRegistration`, `IBackupTickRegistry` |
| 2 | `fundamentals/messages/message-tags#registry` | published | `IMessageTagRegistry`, `MessageTagRegistry` |
| 2 | `fundamentals/messages/message-tags#dispatcher-registry` | published | `IMessageTagHookDispatcher`, `MessageTagHookDispatcherRegistry` |
| 2 | `fundamentals/messages/cascade-context#pointer-properties` | published | `IScopeContext`, `InitiatingContext` |
| 2 | `internals/message-discard-policy` | MISSING | `IMessageDiscardPolicy`, `MessageDiscardReason` |
| 2 | `fundamentals/perspectives/stream-locking` | published | `IPerspectiveStreamLocker`, `PerspectiveStreamLockOptions` |
| 2 | `fundamentals/perspectives/snapshots` | published | `IPerspectiveSnapshotStore`, `PerspectiveSnapshotOptions` |
| 2 | `fundamentals/perspectives/rewind#debounce` | published | `DebounceWindow`, `MaxDebounceWindow` |
| 2 | `fundamentals/dispatcher/routing#dispatch-context` | published | `DispatchContext`, `MessageDispatchContext` |
| 2 | `fundamentals/work-coordinator/notifications-and-pgbouncer#tcp-keepalive` | draft (drafts/fundamentals/work-coordinator/notifications-and-pgbouncer.md) | `TcpKeepAliveInterval`, `TcpKeepAliveTime` |
| 2 | `fundamentals/work-coordinator/handler-commit` | draft (drafts/fundamentals/work-coordinator/handler-commit.md) | `CommitHandlerResultAsync`, `HandlerCommitRequest` |
| 2 | `fundamentals/lifecycle/lifecycle-reconciliation` | MISSING | `OrphanedLifecycleEvent`, `RecordLifecycleCompletionAsync` |
| 2 | `fundamentals/receptors/raw-receptors` | MISSING | `IRawReceptor`, `IRawReceptorRegistry` |
| 2 | `operations/testing/lifecycle-synchronization` | published | `IAcceptsLifecycleContext`, `ILifecycleContextAccessor` |
| 2 | `fundamentals/events/event-upcasting` | published | `EventUpcasterServiceCollectionExtensions`, `IEventUpcaster` |
| 2 | `fundamentals/messages/envelope-serialization` | published | `IEnvelopeSerializer`, `SerializedEnvelope` |
| 2 | `data/work-coordinator-strategies#flush-events` | published | `FlushTrigger`, `WorkBatchFlushedArgs` |
| 2 | `fundamentals/lenses/temporal-query` | published | `follows`, `stream` |
| 2 | `fundamentals/dispatcher/message-cascade#routed-message-cascading` | published | `DispatchModes`, `IRouted` |
| 2 | `fundamentals/perspectives/perspective-sync#callbacks` | published | `SyncDecisionContext`, `SyncWaitingContext` |
| 2 | `fundamentals/perspectives/perspectives#rewind-events` | published | `PerspectiveRewindCompleted`, `PerspectiveRewindStarted` |
| 2 | `fundamentals/perspectives/rewind#stream-events` | published | `StreamRewindCompleted`, `StreamRewindStarted` |
| 2 | `fundamentals/lifecycle/lifecycle#pause-resume` | published | `PauseProcessingCommand`, `ResumeProcessingCommand` |
| 1 | `messaging/transports/rabbitmq` | published | `RabbitMQOptions` |
| 1 | `messaging/transports/rabbitmq#channels` | published | `MaxChannels` |
| 1 | `messaging/transports/rabbitmq#dead-lettering` | published | `MaxDeliveryAttempts` |
| 1 | `messaging/transports/rabbitmq#prefetch` | published | `PrefetchCount` |
| 1 | `messaging/transports/rabbitmq#single-active-consumer` | published | `EnableSingleActiveConsumer` |
| 1 | `messaging/transports/azure-service-bus#admin-client` | published | `IServiceBusAdminClient` |
| 1 | `messaging/transports/azure-service-bus#subscription-naming` | published | `_deriveSubscriptionName` |
| 1 | `messaging/transports/azure-service-bus#routing-filters` | published | `_applyRoutingPatternFilterAsync` |
| 1 | `messaging/transports/azure-service-bus#publish-auto-provisioning` | published | `_ensureTopicExistsViaAdminAsync` |
| 1 | `messaging/transports/azure-service-bus` | published | `AzureServiceBusOptions` |
| 1 | `messaging/transports/azure-service-bus#concurrency` | published | `MaxConcurrentCalls` |
| 1 | `messaging/transports/azure-service-bus#publish-concurrency` | published | `PublishMaxConcurrency` |
| 1 | `messaging/transports/azure-service-bus#lock-renewal` | published | `MaxAutoLockRenewalDuration` |
| 1 | `messaging/transports/azure-service-bus#session-idle-timeout` | published | `SessionIdleTimeout` |
| 1 | `data/schema-generation-pattern` | published | `ISchemaBuilder` |
| 1 | `data/postgres` | published | `PostgresOptions` |
| 1 | `data/postgres#command-timeout` | published | `CommandTimeoutSeconds` |
| 1 | `fundamentals/work-coordinator/configuration-reference#max-in-flight-commands` | draft (drafts/fundamentals/work-coordinator/configuration-reference.md) | `MaxInFlightCommands` |
| 1 | `extending/features/vector-search#auto-config` | published | `VectorConfigurationRegistry` |
| 1 | `operations/diagnostics/whiz080` | published | `response` |
| 1 | `operations/diagnostics/whiz802` | published | `dimensions` |
| 1 | `operations/diagnostics/whiz807` | published | `field` |
| 1 | `extending/internals/json-serialization-customizations` | published | `ArrayTypeInfo` |
| 1 | `data/turnkey-initialization` | published | `WhizbangHostExtensions` |
| 1 | `data/turnkey-initialization#multi-instance` | published | `SchemaInitializationLog` |
| 1 | `fundamentals/identity/type-qualification` | published | `TypeQualifications` |
| 1 | `fundamentals/identity/time-provider` | published | `ITimeProvider` |
| 1 | `fundamentals/messages/delivery-receipts` | published | `IStreamIdExtractor` |
| 1 | `fundamentals/receptors/receptors` | published | `IReceptor` |
| 1 | `fundamentals/messages/message-context` | published | `IMessageContext` |
| 1 | `fundamentals/messages/messages` | published | `IMessage` |
| 1 | `fundamentals/events/stream-id` | published | `IHasStreamId` |
| 1 | `fundamentals/dispatcher/message-cascade#cascade-to-outbox` | published | `CascadeMessageAsync` |
| 1 | `fundamentals/dispatcher/dispatch-patterns#local-invoke-and-sync` | published | `LocalInvokeAndSyncAsync` |
| 1 | `fundamentals/perspectives/perspective-sync#awaiter-identity` | published | `IAwaiterIdentity` |
| 1 | `extending/attributes/generatestreamid` | published | `GenerateStreamIdAttribute` |
| 1 | `fundamentals/receptors/receptors#synchronous-receptors` | published | `VoidSyncReceptorInvoker` |
| 1 | `fundamentals/dispatcher/routing#owned-domain-routing` | published | `_isOwnedNamespace` |
| 1 | `fundamentals/perspectives/perspective-sync#dispatcher-integration` | published | `_awaitPerspectiveSyncIfNeededAsync` |
| 1 | `fundamentals/perspectives/event-completion#dispatcher-integration` | published | `_waitForPerspectivesIfNeededAsync` |
| 1 | `fundamentals/lifecycle/lifecycle-stages#post-lifecycle` | published | `_invokePostLifecycleReceptorsAsync` |
| 1 | `fundamentals/messaging/composite-events#publish-time-local-fan-out` | published | `_fanOutCompositeLocallyAtPublishAsync` |
| 1 | `fundamentals/dispatcher/message-cascade#auto-cascade-to-outbox` | published | `PublishToOutboxDynamicAsync` |
| 1 | `apis/graphql/lens-integration#scope` | published | `data` |
| 1 | `apis/graphql/authorization#require-permission` | MISSING | `JobMutations` |
| 1 | `apis/graphql/sorting` | published | `UseOrderByStrippingAttribute` |
| 1 | `apis/graphql/scoping#claim-aggregation` | published | `ClaimAggregation` |
| 1 | `apis/rest/setup` | published | `FastEndpointsWhizbangExtensions` |
| 1 | `apis/rest/mutations` | published | `endpoint` |
| 1 | `apis/signalr/signalr` | published | `AddWhizbangSignalR` |
| 1 | `apis/mutations/hooks#before` | published | `OnBeforeExecuteAsync` |
| 1 | `apis/mutations/hooks#after` | published | `OnAfterExecuteAsync` |
| 1 | `apis/mutations/custom-request-dto#mapping` | published | `NotImplementedException` |
| 1 | `apis/mutations/custom-request-dto#execution` | published | `MapRequestToCommandAsync` |
| 1 | `apis/mutations/hooks#context` | published | `IMutationContext` |
| 1 | `fundamentals/perspectives/registry` | published | `PerspectiveRegistrySchema` |
| 1 | `extending/extensibility/database-schema-framework` | published | `table` |
| 1 | `operations/observability/metrics` | published | `NotifyMetrics` |
| 1 | `operations/infrastructure/database-limits` | published | `length` |
| 1 | `fundamentals/perspectives/perspective-sync#auto-registration` | published | `SyncEventTypeAutoRegistration` |
| 1 | `operations/configuration/service-registration-options` | published | `ServiceRegistrationOptions` |
| 1 | `operations/configuration/service-registration` | published | `ServiceRegistrationExtensions` |
| 1 | `operations/configuration/perspective-services` | published | `AddPerspectiveServices` |
| 1 | `operations/configuration/lens-services` | published | `AddLensServices` |
| 1 | `operations/configuration/all-services` | published | `AddAllWhizbangServices` |
| 1 | `fundamentals/perspectives/association-metadata` | published | `PerspectiveAssociationInfo` |
| 1 | `messaging/transports/transport-consumer#batch-handler` | published | `_handleMessageBatchAsync` |
| 1 | `docs/transport-routing-architecture.md#transport-echo-suppression` | MISSING | `_isKnownEventType` |
| 1 | `messaging/transports/transport-consumer#additional-destinations` | published | `TransportConsumerConfiguration` |
| 1 | `messaging/transports/transport-consumer` | published | `ServiceBusConsumerWorker` |
| 1 | `operations/workers/perspective-worker#event-deduplication` | published | `acknowledgement` |
| 1 | `operations/workers/perspective-worker#immediate-poll` | published | `RequestImmediatePoll` |
| 1 | `operations/workers/perspective-worker#security-context` | published | `_establishSecurityContextAsync` |
| 1 | `fundamentals/perspectives/drain-mode#sliding-window` | MISSING | `DrainBatcher` |
| 1 | `internals/stream-affinity` | MISSING | `PerStreamSerializerOptions` |
| 1 | `fundamentals/work-coordinator/outbox-publish` | MISSING | `registered` |
| 1 | `operations/workers/publisher-worker` | MISSING | `transition` |
| 1 | `fundamentals/work-coordinator/per-stream-drain#cross-stream-parallelism` | MISSING | `MaxConcurrentStreams` |
| 1 | `fundamentals/work-coordinator/per-stream-drain#sliding-window` | MISSING | `Batcher` |
| 1 | `messaging/transports/transport-consumer#concurrency` | published | `MaxConcurrentMessages` |
| 1 | `fundamentals/work-coordinator/lease-cancellation` | MISSING | `LeaseHandleOptions` |
| 1 | `fundamentals/work-coordinator/inbox-drain` | MISSING | `_drainStreamBatchAsync` |
| 1 | `operations/workers/perspective-worker#dedup-observer` | published | `IProcessedEventCacheObserver` |
| 1 | `fundamentals/perspectives/cursor-inversion` | MISSING | `IPerspectiveCursorResolver` |
| 1 | `fundamentals/workers/instance-liveness` | published | `IInstanceAliveLockSource` |
| 1 | `fundamentals/work-coordinator/configuration-reference#backup-tick-coordinator` | draft (drafts/fundamentals/work-coordinator/configuration-reference.md) | `BackupTickCoordinatorOptions` |
| 1 | `fundamentals/security/message-security#service-bus-metadata` | published | `ServiceBusTransportMetadata` |
| 1 | `fundamentals/security/message-security#transport-metadata` | published | `ITransportMetadata` |
| 1 | `messaging/transports/transports#transport-message` | published | `struct` |
| 1 | `messaging/transports/transports#max-message-size` | published | `destination` |
| 1 | `fundamentals/dispatcher/routing#domain-topic-provisioning` | published | `IInfrastructureProvisioner` |
| 1 | `fundamentals/events/stream-id#validation` | published | `InvalidStreamIdException` |
| 1 | `fundamentals/identity/whizbang-ids#guid-metadata` | published | `GuidMetadatas` |
| 1 | `fundamentals/temporal/saga-deadlines` | MISSING | `ISagaDeadlineScheduler` |
| 1 | `fundamentals/events/system-events#stream` | published | `SystemEventStreams` |
| 1 | `fundamentals/events/system-events#audit-mode` | published | `AuditMode` |
| 1 | `fundamentals/events/system-events#transport-filtering` | published | `ITransportPublishFilter` |
| 1 | `fundamentals/events/system-events#emitter` | published | `ISystemEventEmitter` |
| 1 | `fundamentals/security/audit-logging#command-auditing` | published | `CommandAudited` |
| 1 | `fundamentals/messages/message-tags#hook-registration` | published | `handles` |
| 1 | `fundamentals/messages/message-tags#registration` | published | `MessageTagRegistration` |
| 1 | `fundamentals/messages/message-tags#processing` | published | `IMessageTagProcessor` |
| 1 | `fundamentals/messages/message-tags#hooks` | published | `IMessageTagHook` |
| 1 | `fundamentals/security/message-security#extraction` | published | `SecurityExtraction` |
| 1 | `fundamentals/security/effective-permissions#in-memory` | MISSING | `InMemoryEffectivePermissionsStore` |
| 1 | `fundamentals/security/token-refresh` | MISSING | `ITokenRefreshNotifier` |
| 1 | `fundamentals/security/message-security#extractors` | published | `JwtPayloadExtractor` |
| 1 | `fundamentals/security/security#scope-context-accessor` | published | `OrderService` |
| 1 | `fundamentals/security/security#extractors` | published | `IPermissionExtractor` |
| 1 | `fundamentals/security/message-security#message-context-accessor` | published | `IMessageContextAccessor` |
| 1 | `fundamentals/security/effective-permissions` | MISSING | `IEffectivePermissionsStore` |
| 1 | `resilience/stream-rate-limiter` | MISSING | `StreamRateLimiterOptions` |
| 1 | `resilience/circuit-breaker` | MISSING | `CircuitBreakerOptions` |
| 1 | `fundamentals/dispatcher/routing#own-namespace-of` | published | `InvalidOperationException` |
| 1 | `fundamentals/events/system-events#subscribe-to-audit` | published | `SubscribeToAudit` |
| 1 | `fundamentals/dispatcher/routing#message-kind` | published | `MessageKindAttribute` |
| 1 | `fundamentals/dispatcher/routing#inbox-subscription` | published | `InboxSubscription` |
| 1 | `fundamentals/dispatcher/routing#outbox-routing` | published | `IOutboxRoutingStrategy` |
| 1 | `fundamentals/dispatcher/routing#inbox-routing` | published | `IInboxRoutingStrategy` |
| 1 | `fundamentals/dispatcher/routing#event-namespace-source` | published | `IEventNamespaceSource` |
| 1 | `fundamentals/dispatcher/routing#event-namespace-registry` | published | `IEventNamespaceRegistry` |
| 1 | `extending/extensibility/hooks-and-middleware` | published | `IPipelineBehavior` |
| 1 | `fundamentals/perspectives/polymorphic-discriminator` | published | `Field` |
| 1 | `fundamentals/perspectives/rewind#startup-modes` | published | `RewindStartupMode` |
| 1 | `operations/workers/perspective-worker#rewind-replay` | published | `IPerspectiveReplayReader` |
| 1 | `fundamentals/perspectives/perspectives` | published | `IPerspectiveBase` |
| 1 | `operations/observability/logging#startup` | MISSING | `WhizbangStartupLogger` |
| 1 | `fundamentals/security/message-security#envelope-reconstruction` | published | `ReconstructWithPayload` |
| 1 | `fundamentals/persistence/observability` | published | `ITraceStore` |
| 1 | `operations/observability/metrics#table-statistics` | published | `ITableStatisticsProvider` |
| 1 | `fundamentals/messages/envelope-registry` | published | `IEnvelopeRegistry` |
| 1 | `fundamentals/messages/cascade-context#enrichers` | published | `ICascadeContextEnricher` |
| 1 | `fundamentals/messages/message-context#caller-info` | published | `ICallerInfo` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#diagnostics` | published | `StageRecord` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#tracking-state` | published | `LifecycleTrackingState` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#context` | published | `ILifecycleTrackingContext` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#tracking` | published | `ILifecycleTracking` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#perspective-context` | published | `ILifecyclePerspectiveStageContext` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator` | published | `ILifecycleCoordinator` |
| 1 | `fundamentals/lifecycle/lifecycle-coordinator#whenall` | published | `PostLifecycleCompletionSource` |
| 1 | `operations/observability/receptor-logging` | MISSING | `_invokeReceptorAsync` |
| 1 | `fundamentals/transport/message-headers` | MISSING | `MessageHeaders` |
| 1 | `operations/workers/transport-consumer` | path-mismatch (v1.0.0/messaging/transports/transport-consumer.md) | `StoreInboxMessagesAsync` |
| 1 | `operations/maintenance` | MISSING | `MaintenanceResult` |
| 1 | `fundamentals/perspectives/rewind#metrics` | published | `EventsProcessed` |
| 1 | `operations/testing/receptor-firing-observer` | MISSING | `IReceptorFiringObserver` |
| 1 | `fundamentals/serialization/type-binding` | MISSING | `IMessageTypeBinder` |
| 1 | `fundamentals/lifecycle/lifecycle-stages` | published | `ILifecycleMessageDeserializer` |
| 1 | `messaging/inbox-channel` | MISSING | `IInboxChannelWriter` |
| 1 | `fundamentals/receptors/lifecycle-receptors#event-cascading` | published | `IEventCascader` |
| 1 | `fundamentals/dispatcher/message-cascade#deferred-event-channel` | published | `IDeferredOutboxChannel` |
| 1 | `fundamentals/messaging/composite-events` | published | `ICompositeEvent` |
| 1 | `operations/testing/chaos-injection` | MISSING | `IChaosInjector` |
| 1 | `operations/configuration/empty-stream-id-policy` | published | `typed` |
| 1 | `operations/dead-letter-queue/operator-api` | published | `DeadLetterDisposition` |
| 1 | `fundamentals/security/multi-tenancy` | published | `TenantConstants` |
| 1 | `fundamentals/security/scoping#filter-patterns` | published | `ScopeFilterExtensions` |
| 1 | `fundamentals/security/scoping#scope-inheritance` | published | `ScopeFields` |
| 1 | `fundamentals/lenses/scoped-queries#query-scope` | published | `QueryScope` |
| 1 | `fundamentals/lenses/scoped-lenses#configuration` | published | `LensOptions` |
| 1 | `fundamentals/lenses/scoped-queries#scoped-multi-lens-access` | published | `IScopedMultiLensAccess` |
| 1 | `fundamentals/lenses/scoped-queries` | published | `IScopedLensQuery` |
| 1 | `fundamentals/lenses/scoped-lenses` | published | `IScopedLensFactory` |
| 1 | `fundamentals/lenses/scoped-queries#scoped-lens-access` | published | `IScopedLensAccess` |
| 1 | `fundamentals/lenses/lens-query-factory` | published | `ILensQueryFactory` |
| 1 | `fundamentals/dispatcher/dispatch-patterns#local-invoke-with-receipt` | published | `InvokeResult` |
| 1 | `fundamentals/security/scope-propagation` | published | `DispatcherSecurityExtensions` |
| 1 | `fundamentals/security/scope-propagation#system-operations` | published | `AsSystem` |
| 1 | `fundamentals/security/scope-propagation#impersonation-operations` | published | `RunAs` |
| 1 | `operations/infrastructure/migrations` | published | `IMigrationProvider` |
| 1 | `fundamentals/events/stream-id#auto-generation` | published | `AutoGenerateStreamIds` |
| 1 | `operations/observability/tracing#configuration` | published | `Tracing` |
| 1 | `fundamentals/lenses/scoped-queries#default-scope` | published | `DefaultQueryScope` |
| 1 | `operations/configuration/whizbang-options#banner` | published | `ShowBanner` |
| 1 | `operations/configuration/whizbang-options#tag-processing-mode` | published | `TagProcessingMode` |
| 1 | `extending/source-generators/json-contexts#serializing-additional-types` | published | `WhizbangSerializableAttribute` |
| 1 | `fundamentals/persistence/persistence#per-receptor-strategy` | published | `PersistenceStrategyAttribute` |
| 1 | `fundamentals/events/system-events#audit-projection` | published | `AuditEventProjection` |
| 1 | `fundamentals/events/system-events#scope-context-established` | published | `ScopeContextEstablished` |
| 1 | `fundamentals/events/system-events#permission-changed` | published | `PermissionChanged` |
| 1 | `fundamentals/events/system-events#access-granted` | published | `AccessGranted` |
| 1 | `fundamentals/events/system-events#access-denied` | published | `AccessDenied` |
| 1 | `fundamentals/security/security#row-level-security` | published | `Order` |
| 1 | `fundamentals/security/security#permission-based-rls` | published | `ScopeOperation` |
| 1 | `fundamentals/security/security#column-level-security` | published | `Customer` |
| 1 | `fundamentals/security/security#masking-strategies` | published | `MaskingStrategy` |
| 1 | `fundamentals/perspectives/perspectives#status-model` | published | `PerspectiveStatusModel` |
| 1 | `fundamentals/perspectives/perspective-sync#tracked-events` | published | `TrackedSyncEvent` |
| 1 | `fundamentals/dispatcher/sync-mode` | published | `SyncMode` |
| 1 | `fundamentals/perspectives/sync` | published | `SyncInquiryResult` |
| 1 | `fundamentals/perspectives/perspective-sync#is-fully-synced` | published | `is` |
| 1 | `fundamentals/perspectives/perspective-sync#explicit-event-tracking` | published | `IncludeProcessedEventIds` |
| 1 | `fundamentals/perspectives/perspective-sync#cross-scope-sync` | published | `DiscoverPendingFromOutbox` |
| 1 | `fundamentals/perspectives/perspective-sync#scoped-tracker-accessor` | published | `ScopedEventTrackerAccessor` |
| 1 | `fundamentals/perspectives/perspective-sync#type-registry` | published | `ITrackedEventTypeRegistry` |
| 1 | `fundamentals/perspectives/perspective-sync#event-tracking` | published | `ISyncEventTracker` |
| 1 | `fundamentals/perspectives/perspective-sync#sync-context` | published | `ISyncContextAccessor` |
| 1 | `fundamentals/perspectives/event-completion` | published | `IEventCompletionAwaiter` |
| 1 | `data/caching#clear-cache` | published | `ClearCacheCommand` |
| 1 | `operations/observability/diagnostics#system-diagnostics` | published | `DiagnosticsCommand` |

### B. Pages with `codeReferences` but zero `testReferences` — 10 pages

- `fundamentals/lenses/vector-search.md` (2 code refs)
- `learn/tutorial/deployment.md` (4 code refs)
- `migration-guide/README.md` (3 code refs)
- `operations/diagnostics/whiz802.md` (3 code refs)
- `operations/observability/logging-categories.md` (8 code refs)
- `resilience/database-availability-middleware.md` (4 code refs)
- `resilience/managed-resource-health.md` (4 code refs)
- `resilience/managed-resource-run-control.md` (5 code refs)
- `resilience/stream-integrity.md` (8 code refs) ← new (Stream Integrity, 8 code refs)
- `tools/mcp-server.md` (3 code refs)

### C. Mermaid diagrams with no `tests=[…]` annotation — 97 diagrams on 51 pages

| Diagrams | Page |
|---|---|
| 12 | `messaging/multi-instance-coordination.md` |
| 6 | `extending/internals/message-lifecycle.md` |
| 3 | `fundamentals/lifecycle/lifecycle-stages.md` |
| 3 | `fundamentals/perspectives/perspective-sync.md` |
| 3 | `learn/tutorial/customer-service.md` |
| 3 | `learn/tutorial/inventory-service.md` |
| 3 | `learn/tutorial/payment-processing.md` |
| 3 | `messaging/failure-handling.md` |
| 3 | `messaging/inbox-pattern.md` |
| 3 | `messaging/work-coordination.md` |
| 2 | `extending/extensibility/custom-receptors.md` |
| 2 | `fundamentals/messaging/collective-events.md` |
| 2 | `fundamentals/messaging/composite-events.md` |
| 2 | `fundamentals/perspectives/event-completion.md` |
| 2 | `fundamentals/security/multi-tenancy.md` |
| 2 | `getting-started/project-structure.md` |
| 2 | `learn/examples/microservices-orchestration.md` |
| 2 | `learn/tutorial/order-management.md` |
| 2 | `learn/tutorial/tutorial-overview.md` |
| 2 | `messaging/idempotency-patterns.md` |
| 2 | `messaging/transports/azure-service-bus.md` |
| 2 | `messaging/transports/rabbitmq.md` |
| 2 | `operations/deployment/deployment-strategies.md` |
| 2 | `operations/workers/perspective-worker.md` |
| 1 | `apis/graphql/index.md` |
| 1 | `data/event-store.md` |
| 1 | `extending/source-generators/attribute-utilities.md` |
| 1 | `fundamentals/dispatcher/routing.md` |
| 1 | `fundamentals/events/event-store.md` |
| 1 | `fundamentals/lenses/lenses.md` |
| 1 | `fundamentals/messages/message-associations.md` |
| 1 | `fundamentals/persistence/observability.md` |
| 1 | `fundamentals/perspectives/perspectives.md` |
| 1 | `fundamentals/perspectives/registry.md` |
| 1 | `fundamentals/security/implementing-multi-tenancy.md` |
| 1 | `fundamentals/workers/perspective-worker-notify.md` |
| 1 | `fundamentals/workers/pinned-connection-pool.md` |
| 1 | `learn/examples/event-sourcing-cqrs.md` |
| 1 | `learn/examples/multi-tenant-saas.md` |
| 1 | `learn/examples/real-time-analytics.md` |
| 1 | `learn/tutorial/analytics-service.md` |
| 1 | `learn/tutorial/deployment.md` |
| 1 | `learn/tutorial/notification-service.md` |
| 1 | `learn/tutorial/shipping-service.md` |
| 1 | `learn/tutorial/testing-strategy.md` |
| 1 | `messaging/message-envelopes.md` |
| 1 | `messaging/work-coordinator.md` |
| 1 | `operations/deployment/scaling.md` |
| 1 | `operations/infrastructure/health-checks.md` |
| 1 | `operations/testing/lifecycle-synchronization.md` |
| 1 | `operations/workers/execution-lifecycle.md` |

### D. Inline C# samples not drift-verified — 2,701 of 2,702

One sample declares `{testFile, testMethod}`; every other sample can silently rot.

## 4. Execution phases

1. **Fix the 2 broken codeReferences** (§2) — minutes.
2. **Verify + stamp the 6 unstamped pages** (§1) — Stream Integrity first: it's freshly implemented, live-validated, and already has its 8 `codeReferences`; add `testReferences` while the work is hot.
3. **Regenerate `code-tests-map.json`** so post-July symbols (incl. `Integrity*`) enter the ledger.
4. **Resolve non-published doc targets** (§2) — promote the 11 drafts or retarget their `<docs>` tags; write or drop the 42 never-written targets.
5. **Symbol test backfill (§A), worst-first** — `ephemeral-events` (37), `collective-events` (26), `signal-bus` (21), `perspective-sync` (16); tag existing tests where coverage exists but isn't linked (Track 1 of `missing-tests.md`), write tests where it doesn't (Track 2).
6. **Diagram annotations (§C)** — pin the 97 diagrams to `tests=[Class.MethodAsync]` as symbol tests land.
7. **Sample tagging (§D)** — during the re-verification sweep, convert key samples to test-backed form (getting-started + tutorials first).
8. **Re-verification sweep of the 173 stale pages** — July-style semantic pass, restamping to a current commit.

## Appendix: full untested-symbol list per doc target


**`fundamentals/events/ephemeral-events`** (37, proposal (proposals/ephemeral-events.md)):
`ArchivedEvent`, `Compacted`, `CompactionResult`, `DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute`, `Destruction`, `DestructionContext`, `DestructionGranularity`, `DestructionReason`, `DestructionResult`, `DestructionRetryBackoffSeconds`, `Disposition`, `EphemeralDestructionTarget`, `EphemeralInfo`, `EphemeralMaxSnapshotsPerStream`, `EphemeralPointerPruneResult`, `EphemeralReclassificationResult`, `EphemeralSnapshotEveryNEvents`, `EphemeralSnapshotTarget`, `EphemeralTypeGrace`, `EventBodyRecord`, `EventFlagsExtensions`, `FullHistoryAttribute`, `HoldEphemeralDestructionAsync`, `ICompactedEvent`, `IDestructionHook`, `IEphemeralEvent`, `IEphemeralModeResolver`, `IStreamCloser`, `IStreamCompactor`, `MaxDestructionRetries`, `OnDestroyFailure`, `ScheduledStreamClose`, `ScheduledStreamCloseReceptorRegistrar`, `StreamCloseResult`, `SyncEphemeralTypeGraceAsync`, `TransientStorage`, `event`

**`fundamentals/messaging/collective-events`** (26, published):
`CollectiveApplyBatchSize`, `CollectiveApplyEntry`, `CollectiveApplyLockKey`, `CollectiveApplyOptions`, `CollectiveDispatchResult`, `CollectiveEventBase`, `CollectiveEventsDapperExtensions`, `CollectiveEventsEFCoreExtensions`, `CollectiveReplayApplier`, `CollectiveScope`, `CollectiveScopeHandling`, `CollectiveSpecKind`, `DapperCollectiveEventApplier`, `DapperCollectiveEventExecutor`, `DapperCollectiveSessionAccessor`, `DapperCollectiveTableRegistry`, `EFCoreCollectiveQuery`, `EFCoreCollectiveSessionAccessor`, `ICollectiveDispatcher`, `ICollectiveInMemoryExecutor`, `ICollectiveQuery`, `ICollectiveReplayApplier`, `ICollectiveSessionAccessor`, `ICollectiveSiblingTableSource`, `ReferencedJsonPath`, `helpers`

**`fundamentals/signal-bus/signal-bus`** (21, draft (drafts/fundamentals/signal-bus/signal-bus.md)):
`BasePollSignalSource`, `IPollSignalSource`, `ISignal`, `ISignalBus`, `ISignalSink`, `ISignalSource`, `ISignalSubscription`, `ISignalTransport`, `ISignalTypeSource`, `PgDurableSignalRetentionWorker`, `PgDurableSignalTailWorker`, `PgInstanceLifecycleMonitor`, `PgWorkAvailablePollSourceBase`, `PgWorkAvailablePollSourcesOverview`, `PostgresSignalTransport`, `SignalBusServiceCollectionExtensions`, `SignalDeliveryClass`, `SignalTargetKind`, `SignalTargeting`, `SignalTypeEntry`, `WireNameAttribute`

**`fundamentals/perspectives/perspective-sync`** (16, published):
`AllPendingFilter`, `AndFilter`, `AwaitPerspectiveSyncAttribute`, `CurrentScopeFilter`, `EventTypeFilter`, `IPerspectiveSyncAwaiter`, `IPerspectiveSyncSignaler`, `IScopedEventTracker`, `ISyncAwareLensQuery`, `LensQueryExtensions`, `LocalSyncSignaler`, `OrFilter`, `PerspectiveSyncOptions`, `ReceptorSyncAttributeInfo`, `StreamFilter`, `SyncFilter`

**`offloads`** (14, path-mismatch (v1.0.0/fundamentals/offloads/)):
`AddWhizbangAzureBlobOffloadsFromConfiguration`, `AzureBlobMessageBodyStore`, `AzureBlobOffloadOptions`, `AzureBlobOffloadServiceCollectionExtensions`, `BodyClaimEnvelopePayload`, `IMessageBodyStore`, `IPostSerializeHook`, `InMemoryOffloadServiceCollectionExtensions`, `MessageBodyClaim`, `MessageBodyDeleteOptions`, `MessageBodyDownloadOptions`, `MessageBodyOffloadOptions`, `MessageBodyUploadOptions`, `OffloadServiceCollectionExtensions`

**`fundamentals/work-coordinator/configuration-reference`** (14, draft (drafts/fundamentals/work-coordinator/configuration-reference.md)):
`ClaimWorkerOptions`, `FailureFlushWorkerOptions`, `HeartbeatRequest`, `HeartbeatWorkerOptions`, `InboxDeserializeCacheOptions`, `InboxDispatchWorkerOptions`, `InboxHandlerWorkerOptions`, `LeaseRenewalWorkerOptions`, `MaintenanceWorkerOptions`, `OutboxCompletionFlushWorkerOptions`, `OutboxPublishWorkerOptions`, `PerspectiveCompletionFlushWorkerOptions`, `RecentlyProcessedEventCacheOptions`, `WorkerPipelineExtensions`

**`fundamentals/messaging/apply-hooks`** (13, published):
`ApplyHookColumns`, `ApplyHookContext`, `ApplyHookOp`, `CollectiveApplyHookPlan`, `CollectiveApplyHookRegistry`, `IApplyHook`, `IApplyHookBuilder`, `ICollectiveApplyHook`, `ICollectiveApplyHookBuilder`, `PerEventApplyHookPlan`, `TimestampsApplyHook`, `WhizbangApplyHookKeys`, `WhizbangApplyHooks`

**`fundamentals/work-coordinator/notifications-and-pgbouncer`** (12, draft (drafts/fundamentals/work-coordinator/notifications-and-pgbouncer.md)):
`AddWhizbangNotificationDataSource`, `INotificationConnectionStringFallback`, `INotificationDataSource`, `INotifySignalingGate`, `INotifySubscription`, `ISharedNotifyConnection`, `IWorkNotificationListener`, `PgSearchPath`, `PostgresNotificationsServiceCollectionExtensions`, `WhizbangNotificationOptions`, `WorkSignalCategory`, `WorkSignalingMode`

**`extending/attributes/auto-populate`** (11, published):
`AutoPopulateRegistration`, `AutoPopulateRegistry`, `ContextKind`, `IAutoPopulatePopulator`, `IAutoPopulateProcessor`, `IAutoPopulateRegistry`, `IdentifierKind`, `PopulateFromHttpHeaderAttribute`, `PopulateKind`, `ServiceKind`, `TimestampKind`

**`fundamentals/temporal/temporal-engine`** (10, proposal (proposals/temporal-engine.md)):
`IScheduleClaimer`, `IScheduleManager`, `MisfirePolicy`, `PgScheduleClaimer`, `PgScheduleDuePollSource`, `PgScheduleManager`, `ScheduleDefinition`, `ScheduleDeliveryGuarantee`, `ScheduleUpdate`, `TemporalOptions`

**`fundamentals/work-coordinator/per-stream-drain`** (10, MISSING):
`IInboxDrainChannel`, `IOutboxDrainChannel`, `InboxBatchRow`, `InboxDrainChannel`, `InboxDrainWorkerOptions`, `OutboxBatchRow`, `OutboxDrainChannel`, `OutboxDrainWorkerOptions`, `PendingPerspectiveEvent`, `RecentlyProcessedEventCacheSweepWorker`

**`fundamentals/workers/pinned-connection-pool`** (9, published):
`IBorrowedConnection`, `IPinnedConnectionPool`, `NoOpPinnedConnectionPool`, `PinnedConnectionContext`, `PinnedConnectionPool`, `PinnedPoolMetrics`, `PinnedPoolServiceCollectionExtensions`, `PostgresPinnedPoolServiceCollectionExtensions`, `WhizbangPinnedPoolOptions`

**`fundamentals/events/type-definition-fingerprint`** (9, proposal (proposals/type-definition-fingerprint.md)):
`DefinitionRelationship`, `EphemeralOptions`, `RecordDefinitionLineageAsync`, `SchemaHash`, `SettingsHash`, `TypeDefinitionInfo`, `TypeDefinitionReconcileSummary`, `TypeDefinitionReconcilerHostedService`, `TypeDefinitionRegistration`

**`fundamentals/work-coordinator/batched-flushers`** (9, draft (drafts/fundamentals/work-coordinator/batched-flushers.md)):
`BatchFlusherOptions`, `CompletePerspectiveAsync`, `FailureFlushWorker`, `FlushCompletionsAsync`, `FlushCompletionsRequest`, `LeaseRenewalWorker`, `PerspectiveCompletionFlushWorker`, `ReportFailuresAsync`, `WorkCategory`

**`resilience/managed-resource-run-control`** (9, published):
`IWhizbangKillswitch`, `IWhizbangLifecycleState`, `IWhizbangRunControl`, `LifecycleAckTimeoutException`, `LifecyclePhaseExtensions`, `RunPermitControl`, `RunState`, `WhizbangLifecycleOptions`, `WhizbangRunControlServiceCollectionExtensions`

**`resilience/managed-resource-health`** (8, published):
`ComponentState`, `ConnectivityRequirement`, `HealthPolicy`, `HealthProbe`, `IWhizbangHealthSource`, `WhizbangHealthOptions`, `WhizbangHealthServiceCollectionExtensions`, `WhizbangManagedHealthCheckExtensions`

**`operations/dead-letter-queue/internal-dlq`** (8, published):
`EnqueueSecurityContextTimeoutFailureAsync`, `IDeadLetterStore`, `IGenerationProvider`, `PublishTimeoutSeconds`, `SecurityContextEstablishmentOutcome`, `SecurityContextTimeoutSeconds`, `UnobservedExceptionDiagnosticsOptions`, `identifier`

**`fundamentals/temporal/pre-fire-hook`** (7, MISSING):
`FireAction`, `IOccurrencePublishGate`, `IScheduleFireHook`, `IScheduleOccurrenceStore`, `NoOpOccurrencePublishGate`, `OccurrencePublishDecision`, `PgScheduleOccurrenceStore`

**`fundamentals/events/event-store-query`** (6, published):
`EventStoreQueryFactory`, `GetEventStoreQuery`, `GetGlobalEventStoreQuery`, `GetTenantEventStoreQuery`, `GetUserEventStoreQuery`, `IEventStoreQueryFactory`

**`fundamentals/work-coordinator/commit-sequence`** (6, MISSING):
`CommitOrderStamperOptions`, `CreateSnapshotAsync`, `GetLatestSnapshotAsync`, `PgCommitOrderStamperWorker`, `SourceCommitSequence`, `SourceServiceId`

**`fundamentals/receptors/lifecycle-receptors`** (6, published):
`GeneratedReceptorRegistry`, `ILifecycleContext`, `IReceptorInvoker`, `IReceptorRegistry`, `LifecycleExecutionContext`, `last`

**`fundamentals/temporal/recurrence`** (6, MISSING):
`CronRecurrenceRule`, `DefaultRecurrenceRuleFactory`, `IRecurrenceRule`, `IRecurrenceRuleFactory`, `OneShotRecurrenceRule`, `RecurrenceKind`

**`event-upcasting`** (6, path-mismatch (v1.0.0/fundamentals/events/event-upcasting.md)):
`IVersionedJsonSerializer`, `IVersionedJsonSerializerRegistry`, `SerializationOptions`, `SerializationResult`, `SerializationVersion`, `SnapshotUpgradePolicy`

**`messaging/transports/rabbitmq#connection-retry`** (5, published):
`BackoffMultiplier`, `InitialRetryAttempts`, `InitialRetryDelay`, `MaxRetryDelay`, `RetryIndefinitely`

**`fundamentals/perspectives/physical-fields`** (5, published):
`PhysicalFieldHydratorRegistry`, `PhysicalFieldMaterializationInterceptor`, `PhysicalFieldQueryInterceptor`, `SplitModeChangeTrackerHydrator`, `UseWhizbangPhysicalFields`

**`operations/dead-letter-queue/recovery`** (5, published):
`DeadLetterRecoveryOptions`, `DeadLetterRecoveryStatus`, `IDeadLetterRecoveryPolicy`, `IDeadLetterRecoveryService`, `RecoveryPolicy`

**`operations/infrastructure/migrations#migration-events`** (5, published):
`MigrationBatchCompleted`, `MigrationBatchStarted`, `MigrationItemCompleted`, `MigrationItemFailed`, `MigrationItemStarted`

**`fundamentals/sagas/completion-orchestration`** (4, published):
`ISagaCompletionAbandonedEvent`, `SagaCompletionAbandonedEvent`, `SagaCompletionWatchdogTickEvent`, `SagaOptions`

**`data/work-coordinator-strategies`** (4, published):
`IWorkFlusher`, `WhizbangFlushMiddlewareExtensions`, `WorkCoordinatorOptions`, `WorkCoordinatorStrategy`

**`resilience/database-availability-middleware`** (4, published):
`AddWhizbangSchemaReadyCheck`, `AvailabilityGateMode`, `UseDatabaseAvailabilityGate`, `WhizbangAvailabilityOptions`

**`fundamentals/perspectives/rebuild`** (4, published):
`EFCorePostgresPerspectiveCheckpointCompleter`, `IPerspectiveCheckpointCompleter`, `RebuildCommandReceptorRegistrar`, `RebuildPerspectiveCommandReceptor`

**`fundamentals/security/security#principal-filtering`** (4, published):
`JsonArrayContainsAnyTranslator`, `WhizbangDbContextOptionsExtensions`, `WhizbangJsonDbFunctions`, `WhizbangMethodCallTranslatorPlugin`

**`messaging/transports/transport-consumer#subscription-resilience`** (4, published):
`AllowPartialSubscriptions`, `HealthCheckInterval`, `ResilienceOptions`, `SubscriptionStatus`

**`messaging/transports/transport-consumer#batch-options`** (4, published):
`BatchSize`, `MaxWaitMs`, `SlideMs`, `TransportBatchOptions`

**`internals/outbox-batch-strategy`** (4, MISSING):
`IOutboxBatchStrategy`, `ImmediateOutboxBatchStrategy`, `QueueOutboxMessageAsync`, `SlidingWindowOutboxOptions`

**`operations/observability/stuck-row-sentinel`** (4, published):
`StuckRow`, `StuckRowSentinelEnabled`, `StuckRowSentinelLimit`, `StuckRowSentinelMaxAttempts`

**`messaging/transports/transports`** (4, published):
`BulkPublishItem`, `BulkPublishItemResult`, `ITransportManager`, `ITransportReadinessCheck`

**`fundamentals/receptors/exactly-once-firing`** (4, published):
`Guardrails`, `IReceptorDedupStore`, `ReceptorInvocationRecord`, `WhizbangGuardrailsOptions`

**`fundamentals/messaging/composite-events#fanout-control`** (4, published):
`DispatchFanoutControl`, `FanoutAtomicity`, `FanoutDirective`, `FanoutMode`

**`fundamentals/perspectives/perspectives#rebuild-events`** (4, published):
`PerspectiveRebuildCompleted`, `PerspectiveRebuildFailed`, `PerspectiveRebuildProgress`, `PerspectiveRebuildStarted`

**`core-concepts/pinned-identity`** (3, draft (drafts/core-concepts/pinned-identity.md)):
`IMessageTypeCatalog`, `IMessageTypeRegistryPopulator`, `IPinnedIdRegistry`

**`fundamentals/dispatcher/dispatcher`** (3, published):
`IDeliveryReceipt`, `IDispatcher`, `IExecutionStrategy`

**`fundamentals/dispatcher/publish-once`** (3, published):
`EFCoreClaimedEmissionStore`, `IClaimedEmissionStore`, `message`

**`internals/inbox-batch-strategy`** (3, MISSING):
`IInboxBatchStrategy`, `ImmediateInboxBatchStrategy`, `SlidingWindowInboxOptions`

**`fundamentals/perspectives/drain-mode`** (3, MISSING):
`IPerspectiveDrainChannel`, `PerspectiveDrainChannel`, `_processDrainModeStreamsAsync`

**`messaging/transports/transport-consumer#inbox-batching`** (3, published):
`InboxBatchMaxWaitMs`, `InboxBatchSize`, `InboxBatchSlideMs`

**`fundamentals/security/security#receptor-permission-gate`** (3, published):
`DefaultRequirePermissionInterceptor`, `DeniedAction`, `IReceptorInterceptor`

**`fundamentals/security/scoping#marker-interfaces`** (3, published):
`ICustomerScoped`, `IOrganizationScoped`, `IUserScoped`

**`fundamentals/perspectives/rewind`** (3, published):
`IPerspectiveApplyCoordinator`, `PerspectiveApplyCoordinator`, `RewindCursorInfo`

**`fundamentals/perspectives/perspectives#rebuild`** (3, published):
`CancelPerspectiveRebuildCommand`, `IPerspectiveRebuilder`, `RebuildPerspectiveCommand`

**`internals/receptor-registry-query`** (3, MISSING):
`IReceptorRegistryQuery`, `ReceptorRegistryContribution`, `WhizbangReceptorRegistryQuery`

**`extending/features/debugger-aware-clock`** (3, published):
`DebuggerAwareClockOptions`, `IActiveStopwatch`, `IDebuggerAwareClock`

**`messaging/transports/azure-service-bus#auto-provisioning`** (2, published):
`AutoProvisionInfrastructure`, `_ensureInfrastructureExistsAsync`

**`messaging/transports/azure-service-bus#sessions`** (2, published):
`EnableSessions`, `MaxConcurrentSessions`

**`fundamentals/security/http-security-headers`** (2, published):
`WhizbangSecurityHeadersMiddlewareExtensions`, `WhizbangSecurityHeadersOptions`

**`extending/source-generators/polymorphic-serialization`** (2, published):
`InheritanceInfo`, `PolymorphicTypeInfo`

**`fundamentals/identity/pinned-type-ledger`** (2, published):
`IEventTypeRenameTool`, `_generateRenameAliasRegistrations`

**`data/efcore-complex-types#in-place-updates`** (2, published):
`UpdateMetadataInPlace`, `UpdateScopeInPlace`

**`fundamentals/identity/whizbang-ids`** (2, published):
`IWhizbangId`, `constraint`

**`fundamentals/dispatcher/dispatch-patterns#localsendmanyasync`** (2, published):
`ONLY`, `routing`

**`fundamentals/lifecycle/lifecycle-stages#immediate-async`** (2, published):
`ImmediateDetachedChainWarningThreshold`, `_invokeImmediateDetachedReceptorsAsync`

**`fundamentals/work-coordinator/claim-loop`** (2, draft (drafts/fundamentals/work-coordinator/claim-loop.md)):
`ProcessChannelBatchAsync`, `WorkCoordinatorPumpAdapter`

**`fundamentals/messages/message-associations`** (2, published):
`MessageAssociationRecord`, `MessageAssociationsSchema`

**`fundamentals/work-coordinator/app-signals`** (2, draft (drafts/fundamentals/work-coordinator/app-signals.md)):
`IAppSignalChannel`, `PgAppSignalChannel`

**`operations/workers/processing-hooks`** (2, MISSING):
`WorkProcessingIdleHandler`, `WorkProcessingStartedHandler`

**`operations/workers/outbox-publish-worker#processing-hooks`** (2, MISSING):
`OutboxMessagePublishedEvent`, `OutboxMessagePublishedHandler`

**`operations/workers/perspective-worker#processing-hooks`** (2, published):
`PerspectiveEventProcessedEvent`, `PerspectiveEventProcessedHandler`

**`operations/dead-letter-queue/transport-recovery`** (2, published):
`ITransportDeadLetterDrainer`, `TransportDeadLetterDrainWorkerOptions`

**`internals/apply-batch-strategy`** (2, MISSING):
`IApplyBatchStrategy`, `SlidingWindowApplyOptions`

**`operations/workers/perspective-worker`** (2, published):
`IPerspectiveCompletionStrategy`, `PerspectiveWorker`

**`fundamentals/perspectives/rewind#startup-scan`** (2, published):
`PerspectiveStartupScanLog`, `_scanAndRepairRewindsOnStartupAsync`

**`fundamentals/work-coordinator/idle-activity-tracking`** (2, MISSING):
`IIdleActivityTracker`, `IdleActivityTouchHookBinder`

**`fundamentals/work-coordinator/startup-ordering`** (2, MISSING):
`ISchemaReadyGate`, `SchemaReadyGate`

**`fundamentals/work-coordinator/backup-tick-coordinator`** (2, MISSING):
`BackupTickRegistration`, `IBackupTickRegistry`

**`fundamentals/messages/message-tags#registry`** (2, published):
`IMessageTagRegistry`, `MessageTagRegistry`

**`fundamentals/messages/message-tags#dispatcher-registry`** (2, published):
`IMessageTagHookDispatcher`, `MessageTagHookDispatcherRegistry`

**`fundamentals/messages/cascade-context#pointer-properties`** (2, published):
`IScopeContext`, `InitiatingContext`

**`internals/message-discard-policy`** (2, MISSING):
`IMessageDiscardPolicy`, `MessageDiscardReason`

**`fundamentals/perspectives/stream-locking`** (2, published):
`IPerspectiveStreamLocker`, `PerspectiveStreamLockOptions`

**`fundamentals/perspectives/snapshots`** (2, published):
`IPerspectiveSnapshotStore`, `PerspectiveSnapshotOptions`

**`fundamentals/perspectives/rewind#debounce`** (2, published):
`DebounceWindow`, `MaxDebounceWindow`

**`fundamentals/dispatcher/routing#dispatch-context`** (2, published):
`DispatchContext`, `MessageDispatchContext`

**`fundamentals/work-coordinator/notifications-and-pgbouncer#tcp-keepalive`** (2, draft (drafts/fundamentals/work-coordinator/notifications-and-pgbouncer.md)):
`TcpKeepAliveInterval`, `TcpKeepAliveTime`

**`fundamentals/work-coordinator/handler-commit`** (2, draft (drafts/fundamentals/work-coordinator/handler-commit.md)):
`CommitHandlerResultAsync`, `HandlerCommitRequest`

**`fundamentals/lifecycle/lifecycle-reconciliation`** (2, MISSING):
`OrphanedLifecycleEvent`, `RecordLifecycleCompletionAsync`

**`fundamentals/receptors/raw-receptors`** (2, MISSING):
`IRawReceptor`, `IRawReceptorRegistry`

**`operations/testing/lifecycle-synchronization`** (2, published):
`IAcceptsLifecycleContext`, `ILifecycleContextAccessor`

**`fundamentals/events/event-upcasting`** (2, published):
`EventUpcasterServiceCollectionExtensions`, `IEventUpcaster`

**`fundamentals/messages/envelope-serialization`** (2, published):
`IEnvelopeSerializer`, `SerializedEnvelope`

**`data/work-coordinator-strategies#flush-events`** (2, published):
`FlushTrigger`, `WorkBatchFlushedArgs`

**`fundamentals/lenses/temporal-query`** (2, published):
`follows`, `stream`

**`fundamentals/dispatcher/message-cascade#routed-message-cascading`** (2, published):
`DispatchModes`, `IRouted`

**`fundamentals/perspectives/perspective-sync#callbacks`** (2, published):
`SyncDecisionContext`, `SyncWaitingContext`

**`fundamentals/perspectives/perspectives#rewind-events`** (2, published):
`PerspectiveRewindCompleted`, `PerspectiveRewindStarted`

**`fundamentals/perspectives/rewind#stream-events`** (2, published):
`StreamRewindCompleted`, `StreamRewindStarted`

**`fundamentals/lifecycle/lifecycle#pause-resume`** (2, published):
`PauseProcessingCommand`, `ResumeProcessingCommand`

**`messaging/transports/rabbitmq`** (1, published):
`RabbitMQOptions`

**`messaging/transports/rabbitmq#channels`** (1, published):
`MaxChannels`

**`messaging/transports/rabbitmq#dead-lettering`** (1, published):
`MaxDeliveryAttempts`

**`messaging/transports/rabbitmq#prefetch`** (1, published):
`PrefetchCount`

**`messaging/transports/rabbitmq#single-active-consumer`** (1, published):
`EnableSingleActiveConsumer`

**`messaging/transports/azure-service-bus#admin-client`** (1, published):
`IServiceBusAdminClient`

**`messaging/transports/azure-service-bus#subscription-naming`** (1, published):
`_deriveSubscriptionName`

**`messaging/transports/azure-service-bus#routing-filters`** (1, published):
`_applyRoutingPatternFilterAsync`

**`messaging/transports/azure-service-bus#publish-auto-provisioning`** (1, published):
`_ensureTopicExistsViaAdminAsync`

**`messaging/transports/azure-service-bus`** (1, published):
`AzureServiceBusOptions`

**`messaging/transports/azure-service-bus#concurrency`** (1, published):
`MaxConcurrentCalls`

**`messaging/transports/azure-service-bus#publish-concurrency`** (1, published):
`PublishMaxConcurrency`

**`messaging/transports/azure-service-bus#lock-renewal`** (1, published):
`MaxAutoLockRenewalDuration`

**`messaging/transports/azure-service-bus#session-idle-timeout`** (1, published):
`SessionIdleTimeout`

**`data/schema-generation-pattern`** (1, published):
`ISchemaBuilder`

**`data/postgres`** (1, published):
`PostgresOptions`

**`data/postgres#command-timeout`** (1, published):
`CommandTimeoutSeconds`

**`fundamentals/work-coordinator/configuration-reference#max-in-flight-commands`** (1, draft (drafts/fundamentals/work-coordinator/configuration-reference.md)):
`MaxInFlightCommands`

**`extending/features/vector-search#auto-config`** (1, published):
`VectorConfigurationRegistry`

**`operations/diagnostics/whiz080`** (1, published):
`response`

**`operations/diagnostics/whiz802`** (1, published):
`dimensions`

**`operations/diagnostics/whiz807`** (1, published):
`field`

**`extending/internals/json-serialization-customizations`** (1, published):
`ArrayTypeInfo`

**`data/turnkey-initialization`** (1, published):
`WhizbangHostExtensions`

**`data/turnkey-initialization#multi-instance`** (1, published):
`SchemaInitializationLog`

**`fundamentals/identity/type-qualification`** (1, published):
`TypeQualifications`

**`fundamentals/identity/time-provider`** (1, published):
`ITimeProvider`

**`fundamentals/messages/delivery-receipts`** (1, published):
`IStreamIdExtractor`

**`fundamentals/receptors/receptors`** (1, published):
`IReceptor`

**`fundamentals/messages/message-context`** (1, published):
`IMessageContext`

**`fundamentals/messages/messages`** (1, published):
`IMessage`

**`fundamentals/events/stream-id`** (1, published):
`IHasStreamId`

**`fundamentals/dispatcher/message-cascade#cascade-to-outbox`** (1, published):
`CascadeMessageAsync`

**`fundamentals/dispatcher/dispatch-patterns#local-invoke-and-sync`** (1, published):
`LocalInvokeAndSyncAsync`

**`fundamentals/perspectives/perspective-sync#awaiter-identity`** (1, published):
`IAwaiterIdentity`

**`extending/attributes/generatestreamid`** (1, published):
`GenerateStreamIdAttribute`

**`fundamentals/receptors/receptors#synchronous-receptors`** (1, published):
`VoidSyncReceptorInvoker`

**`fundamentals/dispatcher/routing#owned-domain-routing`** (1, published):
`_isOwnedNamespace`

**`fundamentals/perspectives/perspective-sync#dispatcher-integration`** (1, published):
`_awaitPerspectiveSyncIfNeededAsync`

**`fundamentals/perspectives/event-completion#dispatcher-integration`** (1, published):
`_waitForPerspectivesIfNeededAsync`

**`fundamentals/lifecycle/lifecycle-stages#post-lifecycle`** (1, published):
`_invokePostLifecycleReceptorsAsync`

**`fundamentals/messaging/composite-events#publish-time-local-fan-out`** (1, published):
`_fanOutCompositeLocallyAtPublishAsync`

**`fundamentals/dispatcher/message-cascade#auto-cascade-to-outbox`** (1, published):
`PublishToOutboxDynamicAsync`

**`apis/graphql/lens-integration#scope`** (1, published):
`data`

**`apis/graphql/authorization#require-permission`** (1, MISSING):
`JobMutations`

**`apis/graphql/sorting`** (1, published):
`UseOrderByStrippingAttribute`

**`apis/graphql/scoping#claim-aggregation`** (1, published):
`ClaimAggregation`

**`apis/rest/setup`** (1, published):
`FastEndpointsWhizbangExtensions`

**`apis/rest/mutations`** (1, published):
`endpoint`

**`apis/signalr/signalr`** (1, published):
`AddWhizbangSignalR`

**`apis/mutations/hooks#before`** (1, published):
`OnBeforeExecuteAsync`

**`apis/mutations/hooks#after`** (1, published):
`OnAfterExecuteAsync`

**`apis/mutations/custom-request-dto#mapping`** (1, published):
`NotImplementedException`

**`apis/mutations/custom-request-dto#execution`** (1, published):
`MapRequestToCommandAsync`

**`apis/mutations/hooks#context`** (1, published):
`IMutationContext`

**`fundamentals/perspectives/registry`** (1, published):
`PerspectiveRegistrySchema`

**`extending/extensibility/database-schema-framework`** (1, published):
`table`

**`operations/observability/metrics`** (1, published):
`NotifyMetrics`

**`operations/infrastructure/database-limits`** (1, published):
`length`

**`fundamentals/perspectives/perspective-sync#auto-registration`** (1, published):
`SyncEventTypeAutoRegistration`

**`operations/configuration/service-registration-options`** (1, published):
`ServiceRegistrationOptions`

**`operations/configuration/service-registration`** (1, published):
`ServiceRegistrationExtensions`

**`operations/configuration/perspective-services`** (1, published):
`AddPerspectiveServices`

**`operations/configuration/lens-services`** (1, published):
`AddLensServices`

**`operations/configuration/all-services`** (1, published):
`AddAllWhizbangServices`

**`fundamentals/perspectives/association-metadata`** (1, published):
`PerspectiveAssociationInfo`

**`messaging/transports/transport-consumer#batch-handler`** (1, published):
`_handleMessageBatchAsync`

**`docs/transport-routing-architecture.md#transport-echo-suppression`** (1, MISSING):
`_isKnownEventType`

**`messaging/transports/transport-consumer#additional-destinations`** (1, published):
`TransportConsumerConfiguration`

**`messaging/transports/transport-consumer`** (1, published):
`ServiceBusConsumerWorker`

**`operations/workers/perspective-worker#event-deduplication`** (1, published):
`acknowledgement`

**`operations/workers/perspective-worker#immediate-poll`** (1, published):
`RequestImmediatePoll`

**`operations/workers/perspective-worker#security-context`** (1, published):
`_establishSecurityContextAsync`

**`fundamentals/perspectives/drain-mode#sliding-window`** (1, MISSING):
`DrainBatcher`

**`internals/stream-affinity`** (1, MISSING):
`PerStreamSerializerOptions`

**`fundamentals/work-coordinator/outbox-publish`** (1, MISSING):
`registered`

**`operations/workers/publisher-worker`** (1, MISSING):
`transition`

**`fundamentals/work-coordinator/per-stream-drain#cross-stream-parallelism`** (1, MISSING):
`MaxConcurrentStreams`

**`fundamentals/work-coordinator/per-stream-drain#sliding-window`** (1, MISSING):
`Batcher`

**`messaging/transports/transport-consumer#concurrency`** (1, published):
`MaxConcurrentMessages`

**`fundamentals/work-coordinator/lease-cancellation`** (1, MISSING):
`LeaseHandleOptions`

**`fundamentals/work-coordinator/inbox-drain`** (1, MISSING):
`_drainStreamBatchAsync`

**`operations/workers/perspective-worker#dedup-observer`** (1, published):
`IProcessedEventCacheObserver`

**`fundamentals/perspectives/cursor-inversion`** (1, MISSING):
`IPerspectiveCursorResolver`

**`fundamentals/workers/instance-liveness`** (1, published):
`IInstanceAliveLockSource`

**`fundamentals/work-coordinator/configuration-reference#backup-tick-coordinator`** (1, draft (drafts/fundamentals/work-coordinator/configuration-reference.md)):
`BackupTickCoordinatorOptions`

**`fundamentals/security/message-security#service-bus-metadata`** (1, published):
`ServiceBusTransportMetadata`

**`fundamentals/security/message-security#transport-metadata`** (1, published):
`ITransportMetadata`

**`messaging/transports/transports#transport-message`** (1, published):
`struct`

**`messaging/transports/transports#max-message-size`** (1, published):
`destination`

**`fundamentals/dispatcher/routing#domain-topic-provisioning`** (1, published):
`IInfrastructureProvisioner`

**`fundamentals/events/stream-id#validation`** (1, published):
`InvalidStreamIdException`

**`fundamentals/identity/whizbang-ids#guid-metadata`** (1, published):
`GuidMetadatas`

**`fundamentals/temporal/saga-deadlines`** (1, MISSING):
`ISagaDeadlineScheduler`

**`fundamentals/events/system-events#stream`** (1, published):
`SystemEventStreams`

**`fundamentals/events/system-events#audit-mode`** (1, published):
`AuditMode`

**`fundamentals/events/system-events#transport-filtering`** (1, published):
`ITransportPublishFilter`

**`fundamentals/events/system-events#emitter`** (1, published):
`ISystemEventEmitter`

**`fundamentals/security/audit-logging#command-auditing`** (1, published):
`CommandAudited`

**`fundamentals/messages/message-tags#hook-registration`** (1, published):
`handles`

**`fundamentals/messages/message-tags#registration`** (1, published):
`MessageTagRegistration`

**`fundamentals/messages/message-tags#processing`** (1, published):
`IMessageTagProcessor`

**`fundamentals/messages/message-tags#hooks`** (1, published):
`IMessageTagHook`

**`fundamentals/security/message-security#extraction`** (1, published):
`SecurityExtraction`

**`fundamentals/security/effective-permissions#in-memory`** (1, MISSING):
`InMemoryEffectivePermissionsStore`

**`fundamentals/security/token-refresh`** (1, MISSING):
`ITokenRefreshNotifier`

**`fundamentals/security/message-security#extractors`** (1, published):
`JwtPayloadExtractor`

**`fundamentals/security/security#scope-context-accessor`** (1, published):
`OrderService`

**`fundamentals/security/security#extractors`** (1, published):
`IPermissionExtractor`

**`fundamentals/security/message-security#message-context-accessor`** (1, published):
`IMessageContextAccessor`

**`fundamentals/security/effective-permissions`** (1, MISSING):
`IEffectivePermissionsStore`

**`resilience/stream-rate-limiter`** (1, MISSING):
`StreamRateLimiterOptions`

**`resilience/circuit-breaker`** (1, MISSING):
`CircuitBreakerOptions`

**`fundamentals/dispatcher/routing#own-namespace-of`** (1, published):
`InvalidOperationException`

**`fundamentals/events/system-events#subscribe-to-audit`** (1, published):
`SubscribeToAudit`

**`fundamentals/dispatcher/routing#message-kind`** (1, published):
`MessageKindAttribute`

**`fundamentals/dispatcher/routing#inbox-subscription`** (1, published):
`InboxSubscription`

**`fundamentals/dispatcher/routing#outbox-routing`** (1, published):
`IOutboxRoutingStrategy`

**`fundamentals/dispatcher/routing#inbox-routing`** (1, published):
`IInboxRoutingStrategy`

**`fundamentals/dispatcher/routing#event-namespace-source`** (1, published):
`IEventNamespaceSource`

**`fundamentals/dispatcher/routing#event-namespace-registry`** (1, published):
`IEventNamespaceRegistry`

**`extending/extensibility/hooks-and-middleware`** (1, published):
`IPipelineBehavior`

**`fundamentals/perspectives/polymorphic-discriminator`** (1, published):
`Field`

**`fundamentals/perspectives/rewind#startup-modes`** (1, published):
`RewindStartupMode`

**`operations/workers/perspective-worker#rewind-replay`** (1, published):
`IPerspectiveReplayReader`

**`fundamentals/perspectives/perspectives`** (1, published):
`IPerspectiveBase`

**`operations/observability/logging#startup`** (1, MISSING):
`WhizbangStartupLogger`

**`fundamentals/security/message-security#envelope-reconstruction`** (1, published):
`ReconstructWithPayload`

**`fundamentals/persistence/observability`** (1, published):
`ITraceStore`

**`operations/observability/metrics#table-statistics`** (1, published):
`ITableStatisticsProvider`

**`fundamentals/messages/envelope-registry`** (1, published):
`IEnvelopeRegistry`

**`fundamentals/messages/cascade-context#enrichers`** (1, published):
`ICascadeContextEnricher`

**`fundamentals/messages/message-context#caller-info`** (1, published):
`ICallerInfo`

**`fundamentals/lifecycle/lifecycle-coordinator#diagnostics`** (1, published):
`StageRecord`

**`fundamentals/lifecycle/lifecycle-coordinator#tracking-state`** (1, published):
`LifecycleTrackingState`

**`fundamentals/lifecycle/lifecycle-coordinator#context`** (1, published):
`ILifecycleTrackingContext`

**`fundamentals/lifecycle/lifecycle-coordinator#tracking`** (1, published):
`ILifecycleTracking`

**`fundamentals/lifecycle/lifecycle-coordinator#perspective-context`** (1, published):
`ILifecyclePerspectiveStageContext`

**`fundamentals/lifecycle/lifecycle-coordinator`** (1, published):
`ILifecycleCoordinator`

**`fundamentals/lifecycle/lifecycle-coordinator#whenall`** (1, published):
`PostLifecycleCompletionSource`

**`operations/observability/receptor-logging`** (1, MISSING):
`_invokeReceptorAsync`

**`fundamentals/transport/message-headers`** (1, MISSING):
`MessageHeaders`

**`operations/workers/transport-consumer`** (1, path-mismatch (v1.0.0/messaging/transports/transport-consumer.md)):
`StoreInboxMessagesAsync`

**`operations/maintenance`** (1, MISSING):
`MaintenanceResult`

**`fundamentals/perspectives/rewind#metrics`** (1, published):
`EventsProcessed`

**`operations/testing/receptor-firing-observer`** (1, MISSING):
`IReceptorFiringObserver`

**`fundamentals/serialization/type-binding`** (1, MISSING):
`IMessageTypeBinder`

**`fundamentals/lifecycle/lifecycle-stages`** (1, published):
`ILifecycleMessageDeserializer`

**`messaging/inbox-channel`** (1, MISSING):
`IInboxChannelWriter`

**`fundamentals/receptors/lifecycle-receptors#event-cascading`** (1, published):
`IEventCascader`

**`fundamentals/dispatcher/message-cascade#deferred-event-channel`** (1, published):
`IDeferredOutboxChannel`

**`fundamentals/messaging/composite-events`** (1, published):
`ICompositeEvent`

**`operations/testing/chaos-injection`** (1, MISSING):
`IChaosInjector`

**`operations/configuration/empty-stream-id-policy`** (1, published):
`typed`

**`operations/dead-letter-queue/operator-api`** (1, published):
`DeadLetterDisposition`

**`fundamentals/security/multi-tenancy`** (1, published):
`TenantConstants`

**`fundamentals/security/scoping#filter-patterns`** (1, published):
`ScopeFilterExtensions`

**`fundamentals/security/scoping#scope-inheritance`** (1, published):
`ScopeFields`

**`fundamentals/lenses/scoped-queries#query-scope`** (1, published):
`QueryScope`

**`fundamentals/lenses/scoped-lenses#configuration`** (1, published):
`LensOptions`

**`fundamentals/lenses/scoped-queries#scoped-multi-lens-access`** (1, published):
`IScopedMultiLensAccess`

**`fundamentals/lenses/scoped-queries`** (1, published):
`IScopedLensQuery`

**`fundamentals/lenses/scoped-lenses`** (1, published):
`IScopedLensFactory`

**`fundamentals/lenses/scoped-queries#scoped-lens-access`** (1, published):
`IScopedLensAccess`

**`fundamentals/lenses/lens-query-factory`** (1, published):
`ILensQueryFactory`

**`fundamentals/dispatcher/dispatch-patterns#local-invoke-with-receipt`** (1, published):
`InvokeResult`

**`fundamentals/security/scope-propagation`** (1, published):
`DispatcherSecurityExtensions`

**`fundamentals/security/scope-propagation#system-operations`** (1, published):
`AsSystem`

**`fundamentals/security/scope-propagation#impersonation-operations`** (1, published):
`RunAs`

**`operations/infrastructure/migrations`** (1, published):
`IMigrationProvider`

**`fundamentals/events/stream-id#auto-generation`** (1, published):
`AutoGenerateStreamIds`

**`operations/observability/tracing#configuration`** (1, published):
`Tracing`

**`fundamentals/lenses/scoped-queries#default-scope`** (1, published):
`DefaultQueryScope`

**`operations/configuration/whizbang-options#banner`** (1, published):
`ShowBanner`

**`operations/configuration/whizbang-options#tag-processing-mode`** (1, published):
`TagProcessingMode`

**`extending/source-generators/json-contexts#serializing-additional-types`** (1, published):
`WhizbangSerializableAttribute`

**`fundamentals/persistence/persistence#per-receptor-strategy`** (1, published):
`PersistenceStrategyAttribute`

**`fundamentals/events/system-events#audit-projection`** (1, published):
`AuditEventProjection`

**`fundamentals/events/system-events#scope-context-established`** (1, published):
`ScopeContextEstablished`

**`fundamentals/events/system-events#permission-changed`** (1, published):
`PermissionChanged`

**`fundamentals/events/system-events#access-granted`** (1, published):
`AccessGranted`

**`fundamentals/events/system-events#access-denied`** (1, published):
`AccessDenied`

**`fundamentals/security/security#row-level-security`** (1, published):
`Order`

**`fundamentals/security/security#permission-based-rls`** (1, published):
`ScopeOperation`

**`fundamentals/security/security#column-level-security`** (1, published):
`Customer`

**`fundamentals/security/security#masking-strategies`** (1, published):
`MaskingStrategy`

**`fundamentals/perspectives/perspectives#status-model`** (1, published):
`PerspectiveStatusModel`

**`fundamentals/perspectives/perspective-sync#tracked-events`** (1, published):
`TrackedSyncEvent`

**`fundamentals/dispatcher/sync-mode`** (1, published):
`SyncMode`

**`fundamentals/perspectives/sync`** (1, published):
`SyncInquiryResult`

**`fundamentals/perspectives/perspective-sync#is-fully-synced`** (1, published):
`is`

**`fundamentals/perspectives/perspective-sync#explicit-event-tracking`** (1, published):
`IncludeProcessedEventIds`

**`fundamentals/perspectives/perspective-sync#cross-scope-sync`** (1, published):
`DiscoverPendingFromOutbox`

**`fundamentals/perspectives/perspective-sync#scoped-tracker-accessor`** (1, published):
`ScopedEventTrackerAccessor`

**`fundamentals/perspectives/perspective-sync#type-registry`** (1, published):
`ITrackedEventTypeRegistry`

**`fundamentals/perspectives/perspective-sync#event-tracking`** (1, published):
`ISyncEventTracker`

**`fundamentals/perspectives/perspective-sync#sync-context`** (1, published):
`ISyncContextAccessor`

**`fundamentals/perspectives/event-completion`** (1, published):
`IEventCompletionAwaiter`

**`data/caching#clear-cache`** (1, published):
`ClearCacheCommand`

**`operations/observability/diagnostics#system-diagnostics`** (1, published):
`DiagnosticsCommand`