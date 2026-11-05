---
title: Stream Integrity
pageType: guide
version: 1.0.0
category: Resilience
order: 4
description: Cross-service anti-entropy — continuity checkpoints, digest audits, and idempotent re-delivery repair; report-only by default, self-healing as the opt-in
tags: 'stream-integrity, anti-entropy, re-delivery, backfill, digest, manifest, continuity, checkpoint, repair, cross-service, bootstrap'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/214_AtMostOnceEventsCarryAFlag.sql
  - src/Whizbang.Core/Messaging/IntegrityCheckpoint.cs
  - src/Whizbang.Core/Messaging/IntegrityDomainOwnership.cs
  - src/Whizbang.Core/Messaging/OriginReattribution.cs
  - src/Whizbang.Core/Workers/OriginReattributionWorker.cs
  - src/Whizbang.Core/Routing/OwnedNamespaceMatcher.cs
  - src/Whizbang.Data.Postgres/Migrations/325_LocalLaneFollowsOwnership.sql
  - src/Whizbang.Core/Messaging/IntegrityAudit.cs
  - src/Whizbang.Core/Messaging/IntegrityGapTracker.cs
  - src/Whizbang.Core/Workers/IntegrityCheckpointWorker.cs
  - src/Whizbang.Core/Workers/IntegrityAuditWorker.cs
  - src/Whizbang.Core/Transports/ControlPlaneDestination.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityCheckpointReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityManifestReceptors.cs
  - src/Whizbang.Core/Messaging/Redelivery.cs
  - src/Whizbang.Core/SystemEvents/AuditLedgerRebuild.cs
  - src/Whizbang.Data.EFCore.Postgres/AuditRebuildRequestReceptor.cs
  - src/Whizbang.Core/Messaging/RedeliveryComposite.cs
  - src/Whizbang.Core/Messaging/RedeliveryPump.cs
  - src/Whizbang.Core/Workers/SubscriptionExpansionWorker.cs
  - src/Whizbang.Core/Observability/StreamIntegrityMetrics.cs
  - src/Whizbang.Data.EFCore.Postgres/RedeliveryRequestReceptor.cs
  - src/Whizbang.Core/Messaging/StreamRedeliveryRequester.cs
  - src/Whizbang.Core/Messaging/RedeliveryRequestDispatch.cs
  - src/Whizbang.Hosting.AspNet/StreamRedeliveryEndpoints.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/087_StreamDigests.sql
  - src/Whizbang.Data.Postgres/Migrations/086_ConsumedTypeRegistry.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityCheckpointReceptorRegistrar.cs
  - src/Whizbang.Core/Workers/ReceivedOriginStampMonitor.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Core/SystemEvents/DigestExemptTypes.cs
  - src/Whizbang.Data.Postgres/Migrations/216_AuditRecordPositionAndDigestExemption.sql
  - src/Whizbang.Data.Postgres/Migrations/228_StreamsNeverMixEphemeralAndSourcedEvents.sql
  - src/Whizbang.Core/Messaging/RedeliveryReconciliation.cs
  - src/Whizbang.Core/Messaging/IntegrityRepairLedger.cs
  - src/Whizbang.Data.EFCore.Postgres/CoordinatorIntegrityRepairLedger.cs
  - src/Whizbang.Data.Postgres/Migrations/249_RedeliveredHistoryAdoptsItsOrigin.sql
  - src/Whizbang.Data.Postgres/Migrations/250_TypeDigestWaitsForTheStamp.sql
  - src/Whizbang.Data.EFCore.Postgres/PerspectiveCoverageGapSql.cs
  - src/Whizbang.Core/Messaging/StreamIntegrityOptionsValidator.cs
  - src/Whizbang.Core/Messaging/IIntegrityRepairLedger.cs
  - src/Whizbang.Data.Postgres/Migrations/251_RepairDrainClaimsOnlyDeficits.sql
  - src/Whizbang.Data.Postgres/Migrations/252_RepairRestoresWhatDeduplicationRemembers.sql
  - src/Whizbang.Data.Postgres/Migrations/253_RedeliveredOriginChecksTheFirstHop.sql
  - src/Whizbang.Core/Messaging/CompositeInboxFanout.cs
  - src/Whizbang.Data.Postgres/Migrations/301_StreamDigestsAreFoundByStream.sql
  - src/Whizbang.Data.Postgres/Migrations/302_IntegrityDeliveriesWaitForTheMaintainer.sql
  - src/Whizbang.Core/Workers/IntegrityDeliveryWorker.cs
  - src/Whizbang.Core/Workers/IntegrityAdmission.cs
  - src/Whizbang.Core/Workers/RepairDrainWorker.cs
  - src/Whizbang.Core/Workers/HousekeepingCoordinator.cs
  - src/Whizbang.Core/Messaging/IntegrityDeferringReceptor.cs
  - src/Whizbang.Core/Messaging/IntegrityDeliveryRegistration.cs
  - src/Whizbang.Core/Messaging/IntegrityDeliveryRegistry.cs
  - src/Whizbang.Core/Messaging/IntegrityDeliveryId.cs
  - src/Whizbang.Core/Startup/MaintainerDuty.cs
  - src/Whizbang.Data.Postgres/Migrations/320_RepairWaitsForItsAnswer.sql
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Messaging/IConsumerRegistry.cs
  - src/Whizbang.Core/Messaging/ConsumedMessageTypes.cs
  - src/Whizbang.Core/Workers/RepairTopicResolver.cs
  - src/Whizbang.Core/Transports/IntegrityControlDestination.cs
  - src/Whizbang.Data.Postgres/Migrations/331_LedgerKeepsOnlyConsumedTypes.sql
  - src/Whizbang.Data.Postgres/Migrations/332_DigestWindowsReadOnlyTheirWindow.sql
testReferences:
  - tests/Whizbang.Core.Tests/Routing/OwnedNamespaceMatcherLocalLaneTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityDomainOwnershipTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityCheckpointOwnershipTests.cs
  - tests/Whizbang.Core.Tests/Workers/SubscriptionExpansionTargetingTests.cs
  - tests/Whizbang.Core.Tests/Workers/OriginReattributionWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OriginReattributionWorkerLoopTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityDomainClaimsSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OriginReattributionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AtMostOnceOccurrenceIntegrityTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditLedgerRebuildTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AuditRebuildRequestReceptorTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/IntegrityCheckpointWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/IntegrityAuditWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SubscriptionExpansionWorkerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityGapTrackerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityCheckpointWireSerializationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamIntegrityOptionsDefaultsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryPumpTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamRedeliveryRequesterTests.cs
  - tests/Whizbang.Hosting.AspNet.Component.Tests/StreamRedeliveryEndpointsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryCompositeWireSerializationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeInboxFanoutTests.cs
  - tests/Whizbang.Core.Component.Tests/MultiService/StreamIntegrityRedeliveryE2ETests.cs
  - tests/Whizbang.Core.Tests/Observability/EnvelopeOriginWireTests.cs
  - tests/Whizbang.Core.Tests/Workers/ReceivedOriginStampMonitorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ReceivedEventOriginStampTests.cs
  - tests/Whizbang.Core.Component.Tests/MultiService/DirectedMessageE2ETests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerDirectedTargetTests.cs
  - tests/Whizbang.Core.Tests/Observability/StreamIntegrityMetricsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PacedRepairDrainSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityRepairBacklogProbeSqlTests.cs
  - tests/Whizbang.Core.Tests/Security/ControlPlaneSecurityExemptionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityCheckpointAdvanceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityCheckpointReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityManifestReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RedeliveryRequestReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SelectRedeliveryEventsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamDigestTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamDigestTableSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ConsumedTypeRegistryTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Integration.Tests/ControlPlaneSessionIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AuditDigestLaneSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DirectAppendStreamDigestTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RedeliveredOriginAdoptionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityLedgerUnhealableSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CoordinatorIntegrityRepairLedgerUnhealableTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryReconcilerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityRepairLedgerUnhealableTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerCompositeCommitTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerCoverageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EpochServedTypeDigestSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityManifestDrainAdmissionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityRepairBacklogProbeSqlTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamIntegrityOptionsValidatorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RedeliveredMissingEventRestoreSqlTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeInboxFanoutIdentityAndSubscriptionTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityDeliveryWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/IntegrityDeliveryWorkerLoopTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityTimerWorkersOnTheMaintainerTests.cs
  - tests/Whizbang.Core.Tests/Workers/HousekeepingIntegrityAdmissionTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityDeliveryDeferralTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryReconcileDeferralTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityDeliverySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityReceptorRegistrationEnforcementTests.cs
  - tests/Whizbang.Core.Tests/Startup/MaintainerDutyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityRepairAnswerSqlTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryReconcileCommitTimeTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/RepairDrainWorkerTests.cs
  - tests/Whizbang.Core.Tests/Observability/StreamIntegrityMetricsCoverageTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerIntegrityGaugeTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityAuditWorkerBranchCoverageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ConsumedMessageTypesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityLedgerForgetUnconsumedSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ConsumedEventReachesEventStoreTests.cs
  - tests/Whizbang.Core.Tests/Workers/RepairTopicResolverTests.cs
  - tests/Whizbang.Core.Tests/Transports/IntegrityControlDestinationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WindowedDigestLaneReadTests.cs
verifiedAgainstCommit: a64ba9a0
verifiedDate: 2026-08-04
---

# Stream Integrity (Cross-Service Anti-Entropy & Repair)

Whizbang's cross-service delivery is **store-and-forward**: an origin service persists an event, the
outbox publishes it to a topic, and each consuming service stores its own copy and projects its own
read models. The design is deliberately decoupled — there is no shared log, no consumer cursor over
the origin's store — which means there is also **no built-in answer to the question "did every
consumer actually get everything?"**

In practice, divergence happens. A real (generalized) incident that motivated this proposal: a
consumer service went through a window in which composite events arrived but their **inner events
were silently dropped** at the receive boundary (an unrelated storage defect zeroed the flags the
fan-out keyed on). The origin's store was complete; the consumer's copy was missing thousands of
events; nothing errored anywhere. The gap surfaced **weeks later** when a person noticed two UI
counts disagreeing — and the only repair available was bespoke, app-level re-ingestion.

Stream integrity is a **first-class, self-healing framework capability**: detect divergence in
bounded time, name it precisely, and repair it idempotently — the same philosophy the
migration-ledger redefinition closure applies to schema, applied to data. Detection is ON by default;
repair is `ReportOnly` by default: report the divergence and let an operator decide, which also serves
as the dry run. `AutoRepairCapped` (storm caps bound every rung) is the explicit opt-in to self-healing.
A default that mutates data unasked is not a default a consumer can trust out of the box.

---

:::note
Stream integrity runs on the EF Core driver only. On the Dapper driver every integrity switch defaults to off, and a
host whose configuration turns one on is refused at startup: see
[What the Dapper driver refuses at startup](../data/drivers.md#what-dapper-refuses-at-startup).
:::

## Goals

1. **Repair** — an origin can re-deliver any subset of its persisted events to the wire, and
   consumers converge idempotently, with no bespoke application code.
2. **Fast detection** — a consumer discovers *missing subscribed events* in minutes, not weeks.
3. **Deep audit** — a scheduled cycle proves consumer copies complete against the origin
   (existence-level), with drill-down that names exactly which streams/events differ.
4. **Backfill as a feature, not an accident** — a service that *grows* its consumption (a new
   perspective; a perspective adding an event type; an entirely new consumer service) gets the
   history it now needs, automatically.
5. **Local coverage** — a perspective whose coverage starts later than the history it should fold
   (born after the events) is detected and rebuilt locally.
6. All of it **configurable with safe defaults**, observable, AOT-clean, and off the hot path.

## Non-goals (with rationale)

- **Payload/body verification.** Digests cover event *identity* (existence), not payload bytes.
  Payloads legitimately differ across services (envelope metadata, serialization shape) and must
  survive crypto-shredding; content verification is a separable follow-up that can ride the
  fingerprint subsystem's optional per-event body hash.
- **Tamper-evidence.** A forward-only hash *chain* proves an untampered prefix, but breaks on
  out-of-order arrival and on Whizbang's deliberate deletions (ephemeral reap, close-stream
  truncation, pointer pruning). Integrity between trusted services needs an order-independent,
  removable digest instead (see below). Audit-grade tamper-evidence is a different threat model
  and a different feature.
- **Pull-based consumer cursors over the origin's store** (the KurrentDB/Debezium shape). It makes
  gaps impossible by construction but inverts Whizbang's delivery architecture: origins would serve
  their event stores to consumers, coupling availability and databases. Rejected for Whizbang.
- **Read-model *content* verification.** Perspectives are locally rebuildable projections; if the
  local event copy is right and coverage is right, rebuild reproduces content. We verify the two
  preconditions, not projected values.

---

## The divergence taxonomy

| # | Scenario | Local store state | Detection | Repair |
|---|---|---|---|---|
| 1 | Subscribed events dropped in flight (the incident class) | Missing rows | Continuity checkpoints (fast) / digest audit (deep) | Origin re-delivery → conflict-skip + inversion-rewind convergence |
| 2 | Consumer corruption/loss after receipt (bad restore, data loss) | Missing rows | Digest audit | Same re-delivery |
| 3 | New perspective over event types the service **already stores** | Complete | Local coverage audit (perspective born after history) | **Local rebuild** — no cross-service traffic |
| 4 | Perspective adds an event type the service **never subscribed to** (or a brand-new consumer service) | Missing that type's history entirely | Startup reconciler detects the consumption-set growth (proactive); digest audit is the safety net | Subscription-expansion backfill (re-delivery scoped to the new types) → local rebuild |
| 5 | Consumer has **extras** the origin lacks | Extra rows | Digest audit (set difference is bidirectional) | Policy: extras below the origin's close/archival floor are legitimate; extras above it are surfaced for investigation, never auto-deleted |
| 6 | Events present but a projection missed applying them | Complete | Local cursor-coverage audit | Local rewind/rebuild via existing machinery |

The repair primitive is one mechanism with four consumers: incident repair (1, 2), new-perspective
coverage (3), subscription growth / consumer bootstrap (4), and scheduled-audit remediation.

---

## Ephemeral and temporal traffic (wire-covered, window-matched)

Ephemeral events and schedule occurrences cross the wire like any event, and both are protected —
each phase applies where the payload's *lifetime* makes protection meaningful, rather than blanket
inclusion or blanket exclusion.

**Ephemeral events** are included in **continuity checkpoints by default**. A dropped ephemeral
delivery is detected within a checkpoint interval — inside the rewind **grace window**, while the
origin still retains the body — so repair is **grace-bounded best-effort**: standard re-delivery
while the origin's copy lives, and on a confirmed gap the origin may place a **destruction hold**
(the existing destruction-hold mechanism) on the gap's events until re-delivery completes, so
prompt detection actively extends repairability instead of racing the reaper *(design intent —
the hold mechanism exists, but no integrity code path invokes it as of a64ba9a)*. Once genuinely
reaped, the gap is reported as *accepted ephemeral loss* — the same acceptance the out-of-grace
rewind already makes. The **deep audit excludes ephemeral by mode** — a tautology, not a gap:
digests cannot converge across sovereign purge lifecycles, and ephemeral has no deep history to
audit; its entire integrity window *is* the grace window, which the checkpoint phase owns.
**Backfill** likewise excludes ephemeral types (nothing is retained to deliver; ephemeral state is
now-scoped by design).

**Schedule occurrences** are ordinary persisted events on the wire: checkpoints detect their drops
and re-delivery repairs them. Refinements:

- **At-least-once occurrences are fully repairable** — deterministic occurrence ids make
  re-delivery idempotent by contract, and a recently dropped occurrence is a job the consumer was
  supposed to run and still should.
- **At-most-once occurrences are detect-and-report only** — re-delivery would violate the exact
  guarantee they were declared for. An at-most-once occurrence carries the `EventFlags.AtMostOnce`
  bit (`flags & 32`) on its stored row, set when the occurrence is spawned, and every exclusion
  (re-delivery selection, digest and epoch folds, verify-and-heal, checkpoint counts, close and
  purge) tests that bit. See [How at-most-once events are excluded](#at-most-once-exclusion).
- **Old occurrence gaps are report-only past a window** *(design intent — the config knob for
  this window is not yet built as of a64ba9a; the intended default is the checkpoint confirmation
  horizon)*: whether a *late* fire is wanted is per-schedule taste already expressed by the
  temporal engine's misfire policy, and integrity does not override it.
- **Backfill builds state and never re-fires triggers** — as built, this rides the request, not a
  per-type key: backfill requests set `RequestRedeliveryCommand.StateOnly`, so backfilled
  occurrences are event-stored and projected without firing trigger receptors, and the selection
  itself excludes at-most-once occurrences outright. A per-type opt-in for including occurrence
  history in backfill is design intent, not yet built. The governing line: **repair delivers what
  a live subscriber missed; backfill builds state — and never re-fires triggers.**

Schedule **definitions** (`wh_schedules`) are service-local durable configuration, outside stream
integrity entirely: missed fires at the origin are governed solely by the temporal engine's
misfire policy (coalesce / catch-up / skip, with burst caps) — integrity adds no second mechanism
that could fight it. Commands and composite envelopes remain structurally out of scope (never
persisted); composite *inner* events are ordinary facts and fully in scope.

---

## Design

### Phase R1 — the re-delivery primitive (everything else depends on it)

`IWorkCoordinator.SelectRedeliveryEventsAsync(RedeliveryRequest)` on the **origin**: select
persisted events by (tenant scope, event types, stream ids, commit-sequence range); the
`RedeliveryPump` publishes the selection **wire-only, directly through `ITransport`** — no outbox
row, no local dispatch (the origin already holds these events, so its own pipeline has nothing to
do with them). The events go to the same topics as the original publish.

**The origin's memory and message sizes are bounded by design**, not by hoping requests stay
small — a first full audit against a large store arrives as a burst of wide repair requests, and
an unbounded answer path takes the origin down with it. Four knobs on `RedeliveryPumpOptions`
(register the instance in DI to override; every default is production-safe):

| Option | Default | Bounds |
|---|---|---|
| `MaxEventsPerRequest` | 10,000 | Hard per-request clamp — a requester's `MaxEvents` is never raised above the origin's cap (the storm-cap rung) |
| `SelectPageSize` | 500 | The origin selects and publishes in **keyset-continued pages** — memory holds one page of bodies regardless of how wide the request is |
| `MaxInnerEventsPerComposite` | 500 | Per-composite chunk bound by **count** (`CompositeEventBase.MaxInnerEventsAllowed` defends the receiver) |
| `MaxBytesPerComposite` | 192,000 | Per-composite chunk bound by **raw stored body bytes** — large-bodied histories flush below the count bound instead of exhausting memory during serialization or exceeding the broker's message-size limit; a single event larger than the budget still ships alone |

Pages continue strictly after the previous page's last (stream, version) — no loss, no overlap,
per-stream order preserved across page boundaries. Additionally, an origin runs **one repair
build at a time per process**: concurrent request bursts (per-bucket auto-repair and
subscription-expansion broadcasts land together after a deploy) queue instead of multiplying
page-plus-serialization footprints.

**Convergence needs no new consumer code** — it composes from delivery semantics that already exist:

- An event the consumer **already has** hits the event-id conflict skip at the store seam: no row,
  no work items, zero perspective churn. Re-delivery is free where nothing is wrong.
- An event the consumer **was missing** appends normally and generates perspective work. Because it
  is *older* than the perspective's cursor, the **cursor-inversion detector** fires and the rewind
  path replays the stream from its snapshot/anchor with the now-complete event set. Late history
  folds in correctly because the pipeline already knows what late history means.

**Re-delivery rides composites, and the children ride RAW.** A repair set is "many events for one
stream" — the composite decision-table row, with its measured bulk-transport win. The redelivery
pump bundles each stream's ordered repair slice into a framework `RedeliveryComposite`
(`Independent` atomicity — one poison inner event must not dead-letter a stream's whole repair;
the next cycle re-detects any remainder) and publishes it **wire-only** (the origin already holds
these events; no local re-processing). Inner events are carried as the **raw stored wire JSON**
(`IRawInnerComposite.InnerPayloads`) plus their stored wire type names — the origin never
rehydrates typed payloads. Re-serializing typed payloads polymorphically was redundant work, an
upcast/version-skew fidelity risk, and an AOT cliff: a consumer payload shape whose metadata is
not reachable through the polymorphic resolver chain made the re-serialization throw, so the
repair never shipped. Raw carry removes the class — the origin needs **no type knowledge at all**
to repair, and the receive-side fan-out builds children directly from the raw payloads (the child
envelope IS the inbox storage form; no serializer runs on the path). Original ids and continuity
sequences ride as `RedeliveryComposite.InnerEventIds` / `OriginServiceId` /
`InnerCommitSequences` — identity and gap-tracking are preserved; there is no dedicated
`redelivery` marker — the directed `tgt` (and, for backfill, state-only `sto`) envelope markers
ride the composite and its fanned-out children. Ordering by stream version makes damaged streams
append-only composites and wholly-missing streams (bootstrap) naturally init-first.
`MaxInnerEventsPerComposite` is the sender-side chunker; `CompositeEventBase.MaxInnerEventsAllowed`
defends the receiver. One honest note: repair thereby uses the same fan-out
machinery whose (storage-defect-induced) failure motivated this proposal — acceptable because
**repair traffic is itself integrity-checked**: re-delivered events carry original sequences, so
a dropped repair re-alarms at the next checkpoint instead of silently "completing."

**Directed messages (`target`) — a general capability this feature consumes twice.** Repair sets
are computed per (consumer, origin) pair, so repair traffic is inherently addressed to one
service; rather than a repair-branded header, Whizbang gains a first-class **`target`** address —
the *logical service identity* that names the target's subscription (never an instance id) —
carried as portable envelope metadata (wire key `tgt`). As built, non-target consumers skip it at
the receive seam before fan-out (one property compare), storing it settled with the reason
`foreign_target` so it is never claimed or dispatched, the same treatment as an unsubscribed
message (see [skipped messages](../messaging/transports/transport-consumer#skipped-messages)). Mapping
`target` to the transport's **native `To`/`ReplyTo`** properties where they exist (AMQP
bare-message `to`; Service Bus `To` with SQL-filterable rules) and broker-side filtering
(`target IS NULL OR target = @me`, wired through the infrastructure-provisioner seam and
advertised via transport capabilities, so non-targets never receive the message at all) are
design intent — not yet wired in any transport as of a64ba9a. An **absent** target means
broadcast, as today.

The defining semantic rule — which is what keeps targeting coherent with the rest of this
proposal: **a targeted message is point-to-point by definition and therefore outside the
broadcast-integrity universe.** It never increments shared continuity sequences and never enters
digests; its delivery assurance comes from its own loop (re-delivery is self-checking via
re-alarm; request/response has a waiting requester). Without this rule, a targeted message would
punch a permanent false gap into every non-target's continuity tracker. Guidance (a future
analyzer nudge, not a prohibition): **facts broadcast — direction is for control-plane, repair,
and response traffic**; targeting ordinary domain events undermines "events are facts anyone can
consume."

Within this feature: re-delivery composites carry `target` = the damaged consumer (a mis-targeted
repair is benign — the needing service discards, the gap persists, the next checkpoint
re-alarms); **manifest responses** carry `target` = the requester (sparing every other service
even the relevance-discard); Phase S backfill targets the expanding consumer. *Considered and
rejected:* opportunistic acceptance by non-targets that coincidentally share a gap — it reinstates
the broadcast cost for everyone to serve a rare coincidence that the coincident consumer's own
detection loop repairs anyway; strict discard keeps the cost model predictable.

A request/response wrapper (`RequestRedeliveryCommand` on the wire, origin-routed) lets any
consumer ask an origin for re-delivery without out-of-band coordination — the request carries the
requester's service identity (`RequesterService`, which becomes the response and re-delivery
`target`) and the reply `Topic` the bundles publish back on.

### Phase B — continuity checkpoints (fast drop detection)

:::updated
**Design amendment (emit-chain spike result).** The original sketch stamped a NEW monotone
per-(origin, tenant, type) sequence at emit. The spike showed that cannot ride the wire without
either hot-path per-(tenant,type) counter rows in the emit chain or publish-time byte patching —
and it is unnecessary: the origin's **commit sequence already rides every wire envelope**
(`SourceServiceId` + `SourceCommitSequence`, injected at outbox publish from the async
commit-order stamper) and **already persists at consumers** (`wh_inbox.source_commit_sequence`;
received events keep `origin_service_id` + `origin_commit_sequence` in the consumer's event
store). Phase B therefore adds NO per-event stamping at all — it verifies **counts over origin
commit-sequence windows**.
:::

The origin periodically publishes a lightweight **`IntegrityCheckpoint`** (an `[Ephemeral]` system
event, default 60s): "between commit-sequence watermark W₁ (exclusive) and W₂ (inclusive), I
emitted these per-(tenant, type) counts" — a bounded bucket list. Consumers count the events they
have persisted from that origin inside the same window (keyed by the already-stored origin
sequence) for the types they subscribe to, and compare.

- A deficit that persists past the NEXT checkpoint (two-cycle confirmation, absorbing in-flight
  stragglers) is a **confirmed gap** → typed integrity report event, and — when auto-repair is
  enabled on the ladder — a scoped `RequestRedeliveryCommand` for exactly that window
  (`FromCommitSequence = W₁`, `ToCommitSequence = W₂`, the deficit's types/tenant). Window repair
  converges by identity: already-present events conflict-skip, missing ones land.
- Detects the incident class **within one to two checkpoint intervals**, not at the next nightly
  audit.
- Near-zero origin cost: one `GROUP BY` over the stamped window per interval; checkpoints are
  doorbell-sized control messages. Checkpoints publish even when the window is empty — a missing
  checkpoint (3× interval) is itself a **liveness alarm**.
- Subscription subsets are handled by construction — buckets are per *type*, so a consumer only
  compares types it consumes. At-most-once schedule occurrences are excluded from the counts (a
  non-delivered at-most-once occurrence is its declared behavior, not a gap).
- Re-delivered events carry their ORIGINAL origin identity (`OriginServiceId` + per-child original
  commit sequences ride the re-delivery composite and are stamped onto the fanned-out children),
  so a repaired window recounts correctly.

Ephemeral types are **included** here by default — for a self-destructing event the checkpoint
window is the only integrity window there is (see *Ephemeral and temporal traffic*).

:::updated
**Design amendment (live-validation result) — checkpoints ride the origin's own event topics.**
The first live deployment on a domain-ownership transport topology (per-namespace topics,
subscriptions generated from the compile-time registry) exposed a delivery hole: publishing the
checkpoint through the normal dispatcher routes it to the *control-plane namespace topic*, and no
consumer ever subscribes there — the integrity receptors are **runtime-registered** framework
receptors, invisible to subscription generation, so the broker silently dropped every checkpoint.
Origin tracking never populated, and the deep audit (whose origin set is the checkpoint tracker)
was permanently inert. The checkpoint publisher therefore publishes **directly through the
transport to the DISTINCT topics of the origin's own audited event types** — the current window's
types unioned with the historically-emitted own-lane digest types, so quiet periods still
heartbeat every covered topic — resolved with the production outbox routing strategy. Consumers
receive checkpoints on exactly the topics they already subscribe to for the origin's events; the
receive-side receptor ignores the origin's own self-delivered copy. Hosts without transport
infrastructure (in-memory) keep the dispatcher publish as the fallback. A companion fix from the
same live validation: the receive-side discard gates initially dropped messages consumed only by
these runtime-registered integrity receptors as "unsubscribed" — the
`IReceptorRegistry.HasRuntimeConsumerFor` seam (commit a64ba9a, PR #412) teaches the discard
gates to recognize runtime-registered receptors as consumers.
:::

What it cannot see: loss *after* successful receipt (case 2) and anything historical. That is the
deep audit's job.

#### Where counting starts: the history floor {#checkpoint-history-floor}

{verified: IntegrityCheckpointAdvanceTests.Advance_HistoryStampedAfterTheBaseline_IsNotCountedAsALiveWindowAsync, IntegrityCheckpointAdvanceTests.Advance_AStoreBaselinedBeforeTheHistoryFloorExisted_TakesTheFloorOnceAsync, IntegrityCheckpointAdvanceTests.Advance_ANewBaseline_MovesTheHistoryFloorWithItAsync}

The first checkpoint baselines: it records the highest stamped commit sequence as its watermark and counts nothing.
A window holds the sequences above the watermark, but a sequence is not proof that an event is new. After an upgrade
the history is unstamped, and the stamper hands it sequences over the following minutes or hours, all of them above
the baseline. Those events were delivered long before, under no sequence, so no consumer can hold them under the one
they get later, and counting them would turn every bucket of every window into a gap.

So the baseline records a second value beside the watermark, the **history floor**: the last insertion-order value
(`wh_event_store.insert_order`) handed out when counting began, kept in `wh_settings` as
`integrity_checkpoint_history_floor`. A window counts only the events in its sequence range that were written after
the floor. History below it is left to the [digests](#phase-a-digest-manifests), which compare event identities
rather than sequence windows.

| Case | What happens |
|---|---|
| First advance on a store | The watermark and the floor are written together by one statement, by the instance whose baseline wins |
| A store an earlier version baselined (a watermark and no floor) | The next advance takes the floor at the current insertion order; whatever history is still being stamped is left out from then on |
| The watermark is removed to restart counting | The next baseline takes the floor again with it |

An event whose transaction drew its insertion order before the floor and committed after it is left out of the window
as well. It is still covered by the digests.

### Phase S — subscription-expansion backfill (startup, on by default) {#phase-s-subscription-expansion-backfill}

The startup type-definition reconciler already diffs each service's catalog against its persisted
registration. It gains one comparison: **the consumed-type set**. When a deploy grows it (new
perspective; perspective adds a type; first boot of a new consumer), the
`SubscriptionExpansionWorker` records the expansion in the consumed-type registry and sends **one
broadcast, state-only `RequestRedeliveryCommand`** for the new types' history. Delivered history
folds into projections through the normal pipeline (state-only children are event-stored and
projected); an explicit "schedule the local rebuild once delivery completes" step is design
intent, not yet wired as of a64ba9a.

This turns "we added a perspective over old events" and "we stood up a new consumer service" from
runbook procedures into a deploy-time non-event. Configurable, **on by default**
(`StreamIntegrityOptions.BackfillOnSubscriptionGrowth = true`); disabling leaves the expansion
*recorded* as Pending in the registry. (Surfacing that Pending state through the deep audit as
"pending backfill" is design intent — as of a64ba9a the registry is read only by the startup
worker itself.)

:::updated
**Design specifics (as built):**

- **The backfill request BROADCASTS** (no `Target`) — an expanding consumer cannot know which
  origins emitted a type's history. Every service's re-delivery receptor runs the scoped selection;
  origins holding matching events answer with bundles targeted back at the requester, everyone
  else selects nothing. A consumer that persisted forwarded copies may answer too — extra sources
  converge harmlessly by event-id identity.
- **"Backfill builds state, never re-fires triggers" rides the ENVELOPE**: a `stateOnly` delivery
  marker (wire key `sto`, sibling of the directed `tgt`) stamped on the bundle by the pump and
  inherited by every fanned-out child. A state-only child is event-stored and projected normally,
  but the inbox dispatch SKIPS its trigger-receptor stages. The perspective-side lifecycle
  completion stages still fire — they are completion accounting, not domain triggers.
- **First boot baselines**: an empty consumed-type registry records the whole catalog WITHOUT
  backfilling (nothing existed to miss). Only types appearing on a LATER boot are expansions.
  The registry (`wh_consumed_types`) carries per-type backfill status
  (Baseline/Pending/Requested); today only the startup worker reads it — wiring it into the
  deep audit as the "pending backfill" surface is not yet done as of a64ba9a.
:::

### Phase A: digest manifests (the scheduled deep audit) {#phase-a-digest-manifests}

**Both halves of the exchange are storm-bounded.** Audit traffic is inherently bursty — after a
deploy, every consumer audits on a similar cadence and every origin answers at once. An origin
runs **one manifest answer at a time** per process, and a consumer runs **one manifest
comparison at a time**; concurrent chunks queue instead of multiplying recompute footprints
(observed live: consumers with unpopulated digest lanes memory-cycled through their first full
audit wave). Types-level digests — both the origin's answer and the consumer's comparison side —
**roll up at the store** (`IWorkCoordinator.ComputeTypeDigestsAsync`, a per-(tenant, type)
`GROUP BY` bounded by types × tenants) instead of materializing one row per stream in memory to
answer a types-level question; the SQL fold is bit-identical to the C# roll-up of stream buckets
because the buckets partition the type's events.

**The repair loop is convergence-bounded.** Detection being bounded is not enough — the *repair
loop* must converge even when it cannot repair (the origin is down, or a bucket is genuinely
damaged). Without memory of what it already said and asked, a consumer re-reports and re-requests
every divergent bucket on every audit cycle forever; observed live, that flood alone — an
`IntegrityDivergenceDetected` per bucket per cycle, minted faster than the outbox drained —
saturated a shared database server, which kept the one origin that could heal the divergence from
ever finishing a startup. Three rules make the loop convergent, all carried by the in-memory
`IntegrityRepairLedger` (a singleton sibling of the gap tracker; a restart re-reports once, then
re-bounds):

- **Reports cool down.** An UNCHANGED divergence re-reports only once per
  `DivergenceReportCooldownMinutes` (default 60) — the audit cadence is not news. A **changed
  signature** (either side's digest moved: progress, or fresh damage) always reports immediately,
  and a bucket that heals is forgotten entirely, so a later re-divergence is a brand-new incident.
- **Repair requests back off.** Each divergent bucket's first repair request goes immediately;
  every further attempt doubles the wait (`RepairRequestBackoffSeconds` base, default 300), and
  the doubling stops after six steps. In the durable ledger the Postgres driver registers, a sent
  request waits for its answer before the bucket can be asked for again
  ([repair waits for its answer](#repair-waits-for-its-answer)), and past
  `MaxRepairAttemptsPerBucket` (default 8) the bucket is not asked for at all: a repair that has not
  worked eight times needs operator eyes, not a loop. The divergence still re-reports at the
  cooldown cadence. Only a change repair can act on resets the budget
  ([what resets the repair ladder](#what-resets-the-repair-ladder)), and a bucket a redelivery
  answered without changing it stops at once, with one report
  ([repair that cannot change a bucket](#unhealable-buckets)). The in-memory ledger, used only
  without a durable store, follows the same cap.
- **Requests batch and are directed or not at all.** Divergent streams of one (tenant, type)
  batch into ONE `RequestRedeliveryCommand` (the origin's selection takes a stream set — per-stream
  commands multiplied wire volume by the stream count for nothing). And every integrity request —
  repair, drill-down, manifest — publishes ONLY to the origin-carried request address learned from
  its checkpoints. When that address is not yet known the request is **withheld and logged**, never
  published to the requester's own topic: on a shared topic that "fallback" fanned each request out
  to every service (and back to the requester itself), turning one unhealed divergence into
  all-to-all noise.

**Digest algebra.** The atomic unit is an order-independent **set hash** per
**(tenant, event type, stream)**: the XOR (or 128-bit additive) fold of `H(event_id)` over the
bucket's events. Properties that fit Whizbang's real lifecycle:

- **O(1) add** on append and — critically — **O(1) remove** on deletion: the ephemeral reaper,
  `wh_truncate_stream_prefix` truncation, and pointer pruning subtract the same hashes in the same transaction.
  (A forward-only chain hash fails here: it cannot unhash a removed element and it breaks on
  out-of-order arrival, forcing recomputes exactly where Whizbang reorders and deletes by design.)
- **Arrival-order independence** — consumers fold in receive order, origins in commit order, same
  digest.
- Identity-only hashing survives crypto-shredding and serialization differences.

Rollups: per (tenant, type) digests derive from the atomic buckets, giving a two-level drill-down
as built (`ManifestLevel` has exactly `Types` and `Streams`) — mismatch at type level → compare
that type's stream digests → a mismatched stream goes straight to a stream-scoped re-delivery
request, which converges by event-id identity. An id-level third step — exchanging the stream's
event-id list so the set difference IS the repair set (streams are short by design; a
set-reconciliation encoding à la IBLT as an optimization) — is a future refinement, not yet built
as of a64ba9a.

**Maintenance strategy.** Digests are maintained **incrementally, transactionally, at batch
granularity** inside the existing emit chain: one digest upsert per distinct (tenant, type) in the
batch — not per event — so bulk imports do not serialize on a hot digest row. Deletion paths
subtract in their own transactions. Because incremental state can rot (the hard-won lesson of
Cassandra's incremental repair), a low-frequency **self-verification** recomputes a sample of
buckets from the store and alarms on drift between the digest table and reality.

**Comparison protocol.**

- Manifests settle **by time**, not by commit-sequence watermark: buckets updated inside
  `AuditSettleWindowMinutes` (default 60) on either side are settle-skipped, so in-flight events
  never read as divergence. (The original commit-sequence watermark — "complete up to origin
  commit sequence ≤ N" — remains design intent; as built the audit reports a mismatch on the
  first settled cycle, while two-cycle confirmation is Phase B's checkpoint discipline.)
- Scope is **pair-relative and catalog-anchored**: the comparison covers the intersection of the
  origin's published types and the consumer's consumed types, referenced by type-definition ids
  from the fingerprint subsystem, so both sides provably compare the same universe even across
  deploys and reclassifications.
- **Expected vs unexpected missing** *(design intent — not yet built as of a64ba9a)*: history
  older than a subscription's recorded birth (Phase S lineage) would be *pending-backfill*
  (informational, auto-resolvable) — not an integrity violation. An audit that cries wolf on every
  deploy trains everyone to ignore it; this discriminator is what would keep the alarms
  meaningful. As built, the audit compare takes no birth-lineage input (the registry's
  `first_seen_at` is recorded but never read by the audit), so backfill-pending history reads the
  same as any other divergence.
- **Lifecycle floors:** ephemeral types are excluded by mode (see *Ephemeral and temporal
  traffic* — the checkpoint phase owns their window); each stream's comparison floor is the
  origin's close/archival point, so closing-the-books truncation never reads as loss.

**Message economics (chatter scales with divergence, not data).** Per (consumer, origin) pair per
audit cycle, the healthy path is **two messages**: one manifest request, one sparse top-level
response (per-(tenant, type) digests, ~60 bytes per non-empty bucket; claim-check offload past the
size threshold). The consumer diffs locally against its own digest table — a match ends the cycle.
Origins serve manifests from the maintained digest table (a rollup `SELECT`, never a store scan)
and may cache the answer per cycle for multi-consumer fan-in (not yet implemented). Drill-down is
**one batched round-trip per level, never per bucket**: all mismatched (tenant, type) buckets in
one stream-level exchange — a mismatched stream then goes straight to stream-scoped re-delivery
(the id-level exchange is a future refinement) — so even a messy divergence costs a handful of
control messages plus the repair payload itself. The steady-state hum
belongs to Phase B's checkpoints (one doorbell-sized ephemeral event per origin per interval),
tunable as emit-on-publish with a slow max-idle heartbeat — never fully silent, because
checkpoint absence is the transport-liveness alarm.

### Windowed manifests read only their window {#windowed-manifests}
{verified: WindowedDigestLaneReadTests.ManifestStreamWindow_ReadsTheWindow_NotTheLaneAsync, WindowedDigestLaneReadTests.TypeDigestWindow_ReadsTheWindow_NotTheLaneAsync}

A windowed stream-level answer, and the windowed type-level fold behind a sealed epoch
(`compute_type_digests_epoch_window`), each cover one range of a lane: the local lane by `commit_sequence`, an
origin's lane by `origin_commit_sequence`. Both queries read the lane as two branches of a `UNION ALL`, one per lane,
each with the window as a direct range on its own indexed column (`idx_event_store_commit_sequence` for the local
lane, `idx_event_store_origin_lane` for an origin's). Exactly one branch is live per call; the other is pruned by its
constant predicate on the lane. A call therefore reads the rows in its window, and its cost follows the window, not
the size of the store.

**Why two branches.** The lane's sequence used to come from one `CASE` expression, with the window filtered
afterwards. No index can serve a range on a `CASE`, so every call read the whole lane, and the paged answers of a
large store each paid for all of it. Migration 332 split the lane; no new index was needed, because both columns
were already indexed. The tests count the rows each call actually reads (`pg_stat_xact_user_tables`) against a lane
much larger than the window, so a return to the whole-lane read fails them.

### Phase L — local perspective-coverage audit {#phase-l-local-perspective-coverage-audit}

Entirely local, no manifest exchange: verify per (stream, perspective) that cursor coverage reaches
the stream head and that the perspective's birth does not postdate history it should have folded
(case 3/6). Remediation is the existing targeted rebuild — the same non-destructive
"find only the broken streams and replay just those" shape proven by prior consumer-side repairs.

{verified: StreamDigestTests.CoverageGaps_FindUncursoredPerspectiveHistoryAsync, StreamDigestTests.CoverageGaps_SkipEventsTheStamperHasNotSequencedAsync, StreamDigestTests.CoverageGaps_CountEachPerspective_LeavingOutPendingEphemeralAndUnsettledEventsAsync, StreamDigestTests.CoverageGaps_ReadWhatTheReportCapNeeds_NotTheWholeStoreAsync}

A coverage gap is a (stream, perspective) pair where the perspective is registered for some of the stream's event
types, has no cursor on the stream, and no work item is pending for those events. Only events that are settled (older
than the settle window), durable (not ephemeral) and **stamped** count. An event without a commit sequence is held back
from every perspective by the stamp fence until the stamper reaches it, so its missing cursor is the fence working, not
a perspective that never folded it.

The report cap (`MaxCoverageGapReportsPerAudit`) bounds what the query reads, not only what it returns. The query walks
the store's streams one at a time through the `(stream_id, version)` index, reads each stream's events once, and stops
as soon as it has found as many gaps as the cap allows. A store with many gaps costs the audit about the cap's worth of
streams; a store with none still reads every stream once, since proving there is no gap needs that.

---

### History the stamper has not reached {#unstamped-history}

{verified: EpochServedTypeDigestSqlTests.LocalLane_AnUnstampedRow_IsLeftOutOfTheOpenWindowUntilItIsStampedAsync, EpochServedTypeDigestSqlTests.ReceivedLane_ARowWithNoOriginSequence_StillFoldsInTheOpenWindowAsync, IntegrityCheckpointAdvanceTests.Advance_HistoryStampedAfterTheBaseline_IsNotCountedAsALiveWindowAsync, StreamDigestTests.CoverageGaps_SkipEventsTheStamperHasNotSequencedAsync}

The commit-order stamper gives every stored event its `commit_sequence` shortly after it commits. After an upgrade from
a version that had no commit sequence, the whole history is unstamped at once, and the stamper works through it over
the next minutes or hours. Until it is done, that history is old by its creation time and has no sequence. Stream
integrity treats it as follows:

| Phase | An event with no commit sequence |
|---|---|
| Checkpoints (Phase B) | Never in a window. Once stamped, it is counted only if it was written after the [history floor](#checkpoint-history-floor) |
| Type-level digest, local lane | Left out of the open window until it is stamped, then folded wherever its sequence falls (migration 250). The windowed answer and the settled maximum already waited for the sequence |
| Type-level digest, received lane | A received event with no origin sequence still folds in the open window: it may never get one (published before its stamp, or received before the origin columns existed), and the open window is the only place it can fold |
| Coverage gaps (Phase L) | Never a gap; the stamp fence holds it back from the perspectives |

The local lane waiting for the stamp means a consumer can, for a while, hold an event its origin does not yet count.
That reads as a surplus, which raises an alarm and never a redelivery (see
[Deficit repairs; mismatch alarms](#deficit-repairs-mismatch-alarms)), and it clears when the stamper reaches the event.
Counting the history while it is unstamped did the opposite: a deficit, which is repaired, and with a whole history
unstamped that was a repair storm.

### The integrity surface is what the service consumes {#the-integrity-surface-is-what-the-service-consumes}
{verified: IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_ConsumerWithNoPerspectives_RequestsOnlyTheEventItsReceptorConsumesAsync, IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_PerspectiveAndReceptorConsumer_RequestIncludesTheReceptorOnlyEventAsync, IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_ConsumesNoEvents_RequestsNothingAsync}

Stream integrity compares what an origin wrote with what this service holds, so it can only ask about events this
service actually stores. A service stores an inbound event when something here consumes it, and the receive boundary
discards the rest. The integrity surface is therefore the same set the receive boundary keeps:

- the event types the [consumer registry](../extending/internals/receptor-registry-query#what-a-service-consumes)
  lists (perspectives, inbox and lifecycle receptors, synchronous receptors, notification tags and the collective
  sink), and
- every event in a namespace this service absorbs (`RoutingOptions.AbsorbNamespaces`): absorbed events are stored on
  purpose with no consumer, so a later perspective can rebuild from them.

Every integrity phase reads that one surface: the audit's manifest request, the checkpoint verification, the manifest
comparison, the repair ledger and the subscription-expansion backfill.

| Service | Types its audit requests |
|---|---|
| Perspectives only | The events its perspectives fold |
| Perspectives and receptors | The events its perspectives fold plus the events only a receptor handles |
| Receptors only, no perspectives | The events its receptors consume |
| Absorbs a namespace | The above, plus the absorbed namespaces on the request |
| Consumes no events | Nothing: no request is sent |

**Why not every known type.** The audit used to take its types from the perspective event list. A service with no
perspectives sent no type list, which an origin reads as "every type", and a service with perspectives never audited
the events only a receptor handles. A type nothing here consumes is never stored here, so every bucket of it reads as
a deficit, and its redelivery is discarded at the receive boundary: the repair-ledger row can never heal. Those rows
held `whizbang.stream_integrity.unhealed_buckets` up and kept the repair budget cycling. An empty consumed set now
requests nothing, never every type.

#### Absorbed namespaces travel on the request {#absorbed-namespaces-on-the-request}
{verified: IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_AbsorbedNamespace_WithNothingConsumingIt_IsStillAuditedAsync, IntegrityManifestReceptorTests.RequestReceptor_AbsorbedNamespaces_AddTheOriginsOwnTypesInThemAsync, IntegrityManifestReceptorTests.RequestReceptor_AbsorbedNamespacesWithoutATypeList_AnswerTheNamespacesTypesAsync, IntegrityManifestReceptorTests.RequestReceptor_EmptyAbsorbedNamespaces_AnswerTheTypeListAsItCameAsync}

The requester cannot list the types in an absorbed namespace: nothing here references them, so they are not in its
consumer registry. `RequestIntegrityManifest.EventNamespaces` carries the namespaces instead, and the origin expands
them into the types it audits in those namespaces before it answers. The field is additive: an origin that predates
it answers the type list alone, and an empty list answers the type list as it came.

#### Comparisons skip what nothing here consumes {#comparisons-skip-unconsumed-types}
{verified: IntegrityManifestReceptorTests.ManifestReceptor_OnlyTypesNothingHereConsumes_ComparesNothingAsync, IntegrityManifestReceptorTests.ManifestReceptor_TypeLevelMismatch_OfATypeNothingHereConsumes_IsNeverEscalatedAsync, IntegrityManifestReceptorTests.ManifestReceptor_StreamLevelDivergence_OfATypeNothingHereConsumes_IsNeverRepairedAsync, ConsumedMessageTypesTests.Keeps_AnUnconsumedTypeInAnAbsorbedNamespace_WhenTheDiscardPolicyKeepsItAsync}

An origin's answer, and its checkpoint, can still name types outside the surface (an origin that predates the
narrowed request answers every type). The checkpoint and manifest receptors filter what the origin reported through
the receive boundary's own keep decision (`ConsumedMessageTypes.Keeps`), so a type the receive boundary would discard
is never counted, escalated or repaired. The filter combines with
[ownership](#the-local-lane-follows-ownership): a bucket must be both kept here and owned by the reporting origin.

#### Rows outside the surface are forgotten {#rows-outside-the-surface-are-forgotten}
{verified: IntegrityLedgerForgetUnconsumedSqlTests.Forget_RemovesEveryRowOfAnUnconsumedType_AndKeepsTheConsumedOnesAsync, IntegrityLedgerForgetUnconsumedSqlTests.Forget_KeepsTheRowsOfATypeInAnAbsorbedNamespaceAsync, IntegrityLedgerForgetUnconsumedSqlTests.Forget_ANullConsumedSet_ForgetsNothingAsync, IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_ForgetsTheLedgerRowsOfEveryTypeOutsideTheConsumedSetAsync}

Each audit cycle calls `wh_integrity_forget_unconsumed` (migration 331) with the consumed event types and the
absorbed namespaces. It deletes the repair-ledger rows of every other type, so a ledger recorded before the surface
was narrowed, or before a consumer was removed, heals itself on the next cycle. A row's namespace is the part of its
type name before the last `.`, the form the receive boundary derives, so a nested type belongs to its outer type's
namespace. A null consumed set forgets nothing: only an explicit set may empty the ledger. The audit logs how many
rows it forgot.

#### After upgrading {#integrity-surface-after-upgrading}
{verified: SubscriptionExpansionTargetingTests.Backfill_FirstPassAfterUpgrade_AsksTheReceptorOnlyEventOfItsOwner_NeverBroadcastsAsync, SubscriptionExpansionTargetingTests.Backfill_MixedOwnership_DirectsTheOwnedTypesAndBroadcastsTheRestAsync, ConsumedEventReachesEventStoreTests.WithNoPerspectives_AConsumedEvent_IsCopiedIntoTheEventStoreAsync}

The same change makes the receive path store every consumed event, whether or not a perspective folds it (see
[classifying a received message](../extending/internals/receptor-registry-query#classifying-a-received-message)).
On the first start after upgrading, the [subscription-expansion backfill](#phase-s-subscription-expansion-backfill)
sees those newly stored types as an expansion of the consumed set and asks for their history under its existing caps.
A type with a known owner is asked of that owner directly; only a type with no known owner is broadcast.
`whizbang.stream_integrity.backfills_requested` counts the requests, so an operator can see the one-time backfill.
Set `BackfillOnSubscriptionGrowth` to `false` before upgrading to record the expansion as Pending instead.

### What is digested {#what-is-digested}

{verified: DigestExemptTypesTests.TypeNames_AreTheAuditSystemEventsAsync, DirectAppendStreamDigestTests.MixedPathStream_TableDigestEqualsARecomputationOverAllItsEventsAsync, AuditDigestLaneSqlTests.InboxStoredAuditRecord_LeavesTheOriginsDigestLaneUntouched_WhileADomainEventFoldsAsync}

A digest covers the durable events a service stores in `wh_event_store`, and only their identities. Each bucket is
one (origin, tenant, event type, stream), and its value is the order-independent fold of each event's id hash, kept
in `wh_stream_digests` and sealed into epochs as described in [Phase A](#phase-a-digest-manifests).

| Event | Digested | Where it is explained |
|---|---|---|
| A durable event stored through the emit chain, from the service's own outbox or received through its inbox | Yes, in its origin's lane | [Phase A](#phase-a-digest-manifests) |
| A durable event stored with `IEventStore.AppendAsync` | Yes, in the local lane, under the same per-stream lock as the store | [Direct appends are digested like emitted events](#direct-appends-digested) |
| An ephemeral event (`flags & 8`) | No: the checkpoints match its window instead | [Ephemeral and temporal traffic](#ephemeral-and-temporal-traffic-wire-covered-window-matched) |
| An at-most-once schedule occurrence (`flags & 32`) | No | [How at-most-once events are excluded](#at-most-once-exclusion) |
| An audit record (`EventAudited`, `CommandAudited`) | No, on either side | [Audit records are not digested](#audit-records-not-digested) |

The same rules hold in every place that folds: both emit chains, direct appends, epoch seals, the type-level and
windowed answers, the stream recomputes, and the verification sweep that heals the table from a recompute. A row the
store removes (the ephemeral reaper, `wh_truncate_stream_prefix` truncation, pointer pruning) is subtracted in the same transaction,
so a deletion never reads as a loss. A removal subtracts only what was folded: a [prefix truncate](../fundamentals/events/event-streams#truncate-effects)
leaves the exempt types out of its subtraction and of the epochs it refolds, and advances the
[origin generation](#origin-generation) only when it removes folded events, so truncating a prefix of only audit
records changes nothing consumers verify (migration 263)
{verified: StreamDigestTableSqlTests.TruncateStreamPrefix_APrefixOfOnlyAnAuditRecord_IsNotAMutationOfFoldedHistoryAsync, StreamDigestTableSqlTests.TruncateStreamPrefix_APrefixHoldingAnAuditRecord_LeavesTheDigestEqualToAFreshFoldAsync}. Payloads, metadata and the order of arrival play no part, which is why a
crypto-shredded or re-serialized event digests the same.

### How at-most-once events are excluded {#at-most-once-exclusion}

The delivery guarantee of a schedule occurrence lives on the outbox row's metadata, and the outbox
row is deleted once processed, so the integrity queries cannot read it there. Instead the occurrence
is flagged when it is spawned: `_wh_spawn_occurrence` sets `EventFlags.AtMostOnce` (bit 32) on the
outbox row, and the emit chain copies `flags` to `wh_event_store`. Every place that must leave
at-most-once events out tests `flags & 32` on the event-store row, exactly as ephemeral events are
tested with `flags & 8`. The bit costs no stored bytes, and the digest, checkpoint and verify
queries no longer join the event body at all.

Before migration 214 the exclusions read a metadata key that the event store never stored, so no
occurrence was ever excluded. Migration 214 backfills the bit on past occurrences (found through
`wh_schedule_runs`, taking the guarantee from the surviving outbox row or else the schedule's current
setting), removes them from the stream digests, refolds the sealed epochs that held them, and bumps
the origin generation (see [Origin generation](#origin-generation)) once. Consumers therefore see one deliberate history change and
reset their seals instead of reporting drift.

### Audit records are not digested {#audit-records-not-digested}

{verified: AuditDigestLaneSqlTests.InboxStoredAuditRecord_LeavesTheOriginsDigestLaneUntouched_WhileADomainEventFoldsAsync, AuditDigestLaneSqlTests.Reconciliation_AuditTraffic_OriginAndSubscriberAnswerTheSameAsync, AuditDigestLaneSqlTests.VerifyDigestTable_RemovesAnAuditBucketInsteadOfHealingItAsync, IntegrityCheckpointAdvanceTests.CheckpointCounts_LeaveAuditRecordsOut_OnBothSidesAsync}

`EventAudited` and `CommandAudited` are left out of every integrity fold: both emit chains, epoch seals, the type-level and windowed answers, the stream recomputes and the verification sweep, and the [prefix truncate](../fundamentals/events/event-streams#truncate-effects), which neither subtracts nor refolds them (migration 263). They are matched on the type-name part of `event_type` against `DigestExemptTypes.TypeNames` (the SQL constant `__DIGEST_EXEMPT_TYPES__`).

Audit records are a function of the origin's events and scope, and the origin does not store most of them, so folding them made the two sides disagree: a subscriber that stored fanned-out audit records counted them in the origin's lane, where the origin had nothing to match. Migration 216 removes the audit buckets and sealed epochs already stored, once.

The continuity checkpoints apply the same exclusion. The origin's checkpoint window and a subscriber's count of what it received from that origin both leave the audit types out, so audit traffic never reads as a count the origin did not declare.

Because audit records never take part in digest sync, a lost or incomplete audit ledger is not repaired by redelivery. It is [rebuilt](../fundamentals/security/audit-logging#rebuilding-the-audit-ledger) instead: `RequestAuditRebuildCommand` makes the origin run the redelivery selection over its stored events, keep the types audit eligibility admits, and queue their records again under the ids their live writers gave them, so the audit perspective converges on one row per audited event however often the rebuild runs.

{verified: AuditLedgerRebuildTests.RunAsync_Twice_YieldsOneRecordPerOriginEventAsync, AuditRebuildRequestReceptorTests.Rebuild_Twice_YieldsOneRecordPerOriginEventAsync}

### Direct appends are digested like emitted events {#direct-appends-digested}

{verified: DirectAppendStreamDigestTests.MixedPathStream_TableDigestEqualsARecomputationOverAllItsEventsAsync, DirectAppendStreamDigestTests.DirectAppend_FoldsByTenantIntoTheLocalBucketAsync, DirectAppendStreamDigestTests.DirectAppend_OfADigestExemptType_IsNotFoldedAsync, DirectAppendStreamDigestTests.CloseStream_AfterDirectAppends_TableStillMatchesTheRecomputeAsync}

An event stored with `IEventStore.AppendAsync` (either driver, through `wh_append_event`) is folded into `wh_stream_digests` in the same call and under the same per-stream lock as the store itself, with the emit chain's bucket and rules: the local origin, the scope's tenant, the stored event type, and the same two hash lanes. Ephemeral and at-most-once rows and the digest-exempt types are left out exactly as the chain leaves them out, so an audit record appended directly is never folded.

The stream recompute the verification sweep trusts has always counted directly-appended events in the local lane. Before migration 225 the incremental table did not, so a stream written by both paths (the global `$wb-system` stream, or any stream an application appends to directly) had a table digest that missed some of its events, and closing such a stream subtracted events that had never been added. Rows appended before migration 225 are not refolded by the migration; the verification sweep heals any bucket that still differs from the recompute.

## Scheduling, startup, and the repair policy ladder

### How the phases unfold from a cold start

A restarted service reconciles in **layers** — the local layer immediately, the cross-service
layer as soon as it has *heard from* its origins. The origin set is deliberately in-memory
(a restart re-baselines it), so the first audit after a fleet-wide deploy usually runs only the
local half; the next cycle has a warm tracker and runs the full exchange.

**A cycle that reached no origins re-arms the startup window instead of the steady interval.**
That matters because the interval defaults to a day. On a cold fleet start the audit can fire
before any peer has checkpointed — its origin set is still empty, so the cross-service half has
nobody to ask and audits nothing. Sleeping out the full interval before looking again would be
indistinguishable from never discovering the fleet at all, and it fails worst in exactly the
situation that most needs the audit: when peers are slow to start, their checkpoints are late,
and cross-service divergence is most likely. The retry keeps the same jitter, so a fleet whose
instances all reached nobody do not then all retry in unison.

The distinction is between *nobody to ask* and *nothing to ask about*. A deployment with no
cross-service transport configured is a configuration rather than a cold start, and retrying
sooner would never help — it keeps the steady interval. So does a cycle another instance already
claimed. Only a service that has cross-service infrastructure and reached none of its origins
retries early, and it logs that it is doing so.

```mermaid {caption="One reconcile cycle: checkpoints warm the origin tracker, the audit exchanges digest manifests, divergence drills down to an exact re-delivery" tests=["IntegrityCheckpointWorkerTests.RunCheckpointOnce_WithTransport_PublishesToOwnEventTopicsAsync","IntegrityAuditWorkerTests.KnownOrigins_GetDirectedManifestRequestsAsync","ControlPlaneSessionIntegrationTests.ControlPlanePublish_SessionRequiredSubscription_DeliversAsync"]}
sequenceDiagram
    autonumber
    participant O as Origin service
    participant B as Broker (origin's event topics)
    participant C as Consumer service

    Note over C: boot: runtime receptors register,<br/>workers start
    Note over C: AUDIT #1 (t+30s…jitter):<br/>LOCAL half — coverage gaps →<br/>capped reports + rebuilds.<br/>Origin set still empty →<br/>cross-service half skipped.
    loop every checkpoint interval (60s)
        O->>B: IntegrityCheckpoint (session = origin's checkpoint stream)
        B->>C: delivered on the topics C already subscribes to
        C->>C: track origin + verify fresh-window counts (Phase B)
    end
    Note over C: AUDIT #2 (next cycle):<br/>origin tracker is warm
    C->>O: RequestIntegrityManifest (directed, type-level)
    O->>C: IntegrityManifest — per-type digests (chunked, one session)
    C->>C: compare vs own received-lane digests
    alt type digests disagree
        C->>O: drill-down request (stream-level)
        O->>C: stream-level manifest
        C->>O: RequestRedeliveryCommand (exact missing window)
        O->>B: re-publish missing events (per-stream sessions)
        B->>C: conflict-skip idempotent landing → perspectives fold
    else all types agree
        Note over C: nothing lost — cycle complete
    end
```

```mermaid {caption="A consumer's first minutes after a deploy — local repair immediately, cross-service exchange once the origin tracker is warm" tests=["IntegrityAuditWorkerTests.FirstAuditDelay_OnStartupDefault_IsJitteredStartupWindowAsync","IntegrityCheckpointWorkerTests.RunCheckpointOnce_PublishesWindowWithOriginIdentityAsync"]}
timeline
    title One consumer's first minutes after deploy
    t+0s : boot — receptors registered, workers start
    t+30s…5m : AUDIT #1 (jittered) — local gaps repaired; origin set empty
    every 60s : checkpoints flow — origin tracker fills, fresh-window verify active
    t+~24h : AUDIT #2 (one AuditIntervalMinutes later — only the first cycle is jittered) — manifest exchange per known origin → divergence → repair
```

**Scheduling (as built): a plain background loop.** The deep audit and the local audit run from
the `IntegrityAuditWorker` — a `BackgroundService` whose first cycle waits a jittered startup
window and whose subsequent cycles `Task.Delay` for `AuditIntervalMinutes` (default 1440 —
daily). There is no work-pump-depth check and no grace deadline yet: dogfooding the temporal
engine — recurring `ScheduleDefinition`s with a **pre-fire hook** supplying idle-or-force
semantics (defer while busy, a configurable weekly **grace deadline** forcing the run
regardless) — remains design intent, not yet wired as of a64ba9a. Continuity checkpoints
are continuous (default interval 60s). Each audit cycle runs only on the instance holding the
maintainer duty and only once the housekeeping idle gate admits integrity work, forced through
after `Whizbang:Housekeeping:MaxDeferral` (see
[integrity work runs on the maintainer](#integrity-work-runs-on-the-maintainer)). Everything is
standard options-pattern configuration:

```csharp{title="StreamIntegrityOptions" description="The shipped self-healing defaults and their storm caps" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","StreamIntegrity"] tests=["StreamIntegrityOptionsDefaultsTests.Defaults_SelfHealingOutOfTheBoxAsync","StreamIntegrityOptionsDefaultsTests.Defaults_StormCapsBoundEveryRepairRungAsync"]}
services.Configure<StreamIntegrityOptions>(o => {
  // Phase B — continuity checkpoints (fast drop detection)
  o.CheckpointsEnabled = true;               // ON by default
  o.CheckpointIntervalSeconds = 60;
  o.GapDetectionEnabled = true;

  // Phases A + L — the scheduled deep audit
  o.AuditEnabled = true;                     // ON by default
  o.AuditOnStartup = true;                   // first audit ~30s + jitter after boot
  o.StartupAuditMaxJitterSeconds = 300;      // de-synchronizes a fleet rollout
  o.AuditIntervalMinutes = 1440;             // daily
  o.AuditSettleWindowMinutes = 60;           // in-flight deliveries are not gaps
  o.FullSweepEveryNthAudit = 7;              // trust-but-verify digest sweep (weekly at daily cadence)

  // Repair posture + storm caps (always enforced)
  o.RepairMode = IntegrityRepairMode.AutoRepairCapped;  // ladder: ReportOnly is the opt-down/dry-run
  o.RepairTopic = null;                      // topic repair requests publish to AND bundles return on
                                             // (null = this service's own command inbox, else its first
                                             //  consumed destination; see Directed integrity traffic)
  o.MaxAutoRepairRequestsPerCheckpoint = 10;
  o.MaxAutoRepairRequestsPerAudit = 25;     // per manifest comparison; see "Repair caps" below
  o.MaxRepairDrainBacklog = 10_000;          // total bound on the paced repair drain's ledger
  o.MaxAutoRebuildsPerAudit = 5;
  o.MaxCoverageGapReportsPerAudit = 100;     // both the query and the report loop are bounded
  o.MaxDrillDownTypesPerAudit = 10;
  o.MaxDigestsPerManifest = 500;

  // Convergence bounding (the IntegrityRepairLedger's dials)
  o.DivergenceReportCooldownMinutes = 60;    // unchanged divergence re-reports once per hour, not per cycle
  o.RepairRequestBackoffSeconds = 300;       // per-bucket retry base; each attempt doubles the wait
  o.MaxRepairAttemptsPerBucket = 8;          // then the bucket is exhausted: no more asks (reports continue) until a local change or a grown deficit
  o.RepairAnswerTimeoutMinutes = 180;        // a requested bucket waits this long for its answer before it may be asked for again

  // The maintainer's integrity delivery drain (see "Integrity work runs on the maintainer")
  o.IntegrityDeliveryIntervalSeconds = 15;   // how often the drain runs
  o.IntegrityDeliveryBatchSize = 50;         // deliveries leased per round trip
  o.MaxIntegrityDeliveriesPerPass = 500;     // bound on one admitted (or forced) pass
  o.IntegrityDeliveryLeaseSeconds = 300;     // covers a duty failover that briefly overlaps two drains
  o.MaxIntegrityDeliveryAttempts = 5;        // then the delivery is dropped with a warning
  o.IntegrityDeliveryRetryBackoffSeconds = 30;  // doubles per attempt, capped at one hour

  // Phase S — subscription growth
  o.BackfillOnSubscriptionGrowth = true;
});
```

**Startup activity is configurable and on by default** — the boot-time reconciler work (consumption-
set diff, pending-backfill registration, digest-table presence checks) runs unless explicitly
disabled, mirroring the detect-by-default / act-by-opt-in convention — except that Phase S's *act*
defaults on too, because its action is additive and idempotent (delivering history a service has
declared it needs).

:::updated
**Startup audit (as built): the deep audit ALSO runs at startup by default.** The original
interval-first scheduling (first audit a full interval after boot, to avoid deploy-time audit
storms) predates A1c — with the type-level exchange an audit costs O(types) on the wire, so the
storm rationale no longer holds. `AuditOnStartup` (default true) fires the first audit after a
30-second floor plus a random splay of up to `StartupAuditMaxJitterSeconds` (default 300), so a
fleet deploy's audits de-synchronize; subsequent cycles follow `AuditIntervalMinutes`. The
consequence that motivated the change: historical divergence (a consumer that drifted BEFORE the
current boot — e.g. a read model missing events from an origin) now heals minutes after a deploy
instead of a day later. Opting out restores interval-first.
:::

**Repair is a ladder, not a reflex.** `ReportOnly` is the default release posture: typed integrity
events + metrics (a dedicated integrity health source is still planned; none is registered as of
a64ba9a), no writes, with `AutoRepairCapped` as the opt-in. The industry lesson (repair storms taking
down clusters that were merely *suspected* of divergence) is encoded twice: caps always on and every
repair loudly attributed, and the mutation itself behind an explicit opt-in.

:::updated
**Default history.** For a period the shipped default was `AutoRepairCapped`, on the reasoning that a
capped repair of a provably-missing delivery is additive and idempotent (the same event id folds
once), so the risk that made auto-repair dangerous elsewhere (destructive repair of *suspected*
divergence) would not apply to confirmed-gap, identity-preserving re-delivery. The warning below
records why that premise fails for a consumer that is merely behind, and the default returned to
`ReportOnly`. The caps (`MaxAutoRepairRequestsPerAudit` / `MaxAutoRepairRequestsPerCheckpoint` per
batch, `RepairRequestBackoffSeconds` / `MaxRepairAttemptsPerBucket` per bucket across occurrences)
still bound every rung of `AutoRepairCapped`; they are why the opt-in is safe to take, not a reason to
take it unasked. `ReportOnly` states exactly what auto-repair would have done, so it is also the dry
run.
:::

:::warning
**The confirmed-gap premise fails when a consumer is BEHIND.** The reasoning above rests on repair
acting only on a gap that is provably real. Confirmation is two-cycle: a deficit seen on one
checkpoint, still short when the origin's next checkpoint arrives. That window is the checkpoint
cadence — `CheckpointIntervalSeconds`, **60 seconds** by default.

A consumer running minutes or hours behind reports the same shortfall on BOTH checks and confirms a
gap while nothing has been lost. The events are not missing; they are queued. Repair then requests
redelivery, those events land at the back of the same backlog, they cannot arrive within the next
cadence either, the deficit re-confirms, and repair fires again. **Each cycle adds load, which
increases lag, which manufactures more false gaps.**

Neither protection above holds in this state:

- *"additive and idempotent — the same event id folds once"* assumes the redelivered event carries
  the original identity. A consumer whose receptors raise their own events in response mints NEW
  ids, so nothing folds and the volume compounds.
- *"every rung hard-capped"* used to bound a SINGLE checkpoint and nothing more. Checkpoints keep
  arriving on cadence, pendings are re-added from the current window as fast as they are drained, so
  every individual checkpoint was capped while the aggregate rate was unbounded. **Fixed:** the
  checkpoint rung now consults the repair ledger before requesting, the same guard the manifest rung
  has always used, so `RepairRequestBackoffSeconds` and `MaxRepairAttemptsPerBucket` bound how often
  the SAME bucket may be re-requested. The ledger is the memory that was missing. A per-batch cap
  bounds the storm's rate; only the per-bucket ledger bounds its size, and both are needed.

Measured in a real deployment: one consumer left on the default emitted roughly **thirty times**
the events its producer did, for a workload that had previously completed in minutes. Its five
peers, pinned to `ReportOnly`, were unaffected. Pinning that consumer to `ReportOnly` dropped its
event production by more than two orders of magnitude and drained its queue to empty.

### Repair caps {#repair-caps}

`MaxAutoRepairRequestsPerAudit` is a cap per **manifest comparison**: one received manifest chunk. A
window followed across several pages, or several origins audited in one cycle, each get their own
allowance. What it counts depends on who sends the repairs.

| Mode | Who sends | What `MaxAutoRepairRequestsPerAudit` bounds | What bounds the total |
| --- | --- | --- | --- |
| Paced repair drain on (`RepairDrainEnabled`, the default) | The drain worker, from the repair ledger, at `RepairDrainRatePerSecond` | The **new** deficit buckets one comparison adds to the ledger | `MaxRepairDrainBacklog` (default 10,000 ledger rows) |
| Burst path (`RepairDrainEnabled = false`) | The comparison itself | The repair requests the comparison sends | The per-bucket backoff and attempt cap |

With the drain on, a ledger row **is** a queued repair: the drain claims rows, not requests. A
comparison therefore decides, for each deficit bucket in manifest order, whether it may have a row:

```mermaid {caption="Drain admission: which deficit buckets one comparison may add to the repair ledger" tests=["IntegrityManifestDrainAdmissionTests.DrainOn_TrackedDeficits_AreRefreshedWithoutSpendingTheCapAsync","IntegrityManifestDrainAdmissionTests.DrainOn_BacklogAtTheBound_AdmitsNoNewDeficit_ButRefreshesTrackedOnesAsync","IntegrityManifestDrainAdmissionTests.DrainOn_NewDeficitsPastThePerComparisonCap_AreNotAddedToTheLedgerAsync"]}
flowchart TD
  D[Deficit bucket] --> T{Already tracked<br/>by the ledger?}
  T -- yes --> R[Refresh the row<br/>does not count]
  T -- no --> B{Backlog below<br/>MaxRepairDrainBacklog?}
  B -- no --> DB[Defer: backlog_cap]
  B -- yes --> C{Fewer than MaxAutoRepairRequestsPerAudit<br/>new rows from this comparison?}
  C -- no --> DC[Defer: per_audit_cap]
  C -- yes --> A[Add the row<br/>the drain will dispatch it]
```

- **A tracked bucket never counts.** Re-admitting it adds nothing to the backlog, and counting it would
  let a few stuck buckets at the head of every manifest take the whole allowance forever.
- **Deferred is not dropped.** Nothing is written for a deferred bucket, so it stays divergent and a
  later audit re-detects it once the drain has made room. Each comparison that defers logs one warning
  with the counts and the current backlog, and `repairs_deferred` counts the buckets by origin and
  `reason` (`per_audit_cap`, `backlog_cap`). Deferred buckets still count in `divergences_detected`.
- **Only deficits are admitted this way.** An identity mismatch or a local surplus is never repaired, so
  it is recorded as before, and the drain never claims its row (see
  [which rows the drain claims](#drain-claims-deficits-only)).
- **The backlog is read once per comparison**, in the same round trip that says which buckets are
  already tracked, and counted only up to the bound so the read stays cheap on a large ledger. It
  counts exactly the rows the drain's claim can take: deficits on a per-stream lane, every origin,
  leaving out the bulk-backfill lane, mismatches, surpluses, rows of unknown kind and buckets marked as
  ones repair cannot change. "Already tracked" means the ledger holds the bucket as a deficit. Comparisons on
  several replicas can each add up to one allowance past the bound before they see each other's rows.
- **Without a backlog reading** (an engine that cannot provide one, or a read that failed, which is
  logged) the per-comparison cap alone applies and every bucket counts as new.

`MaxRepairDrainBacklog` must be at least 1; host start fails otherwise, because a bound of zero would
admit nothing to repair while every comparison logged a deferral. At the default drain rate of 5 rows
per second, 10,000 rows is a little over half an hour of dispatch. The admission rule applies only at
`AutoRepairCapped` with the drain on: at `ReportOnly` the drain sends nothing, and the burst path keeps
its own cap.

:::updated
**Before this was fixed ([#1792](https://github.com/whizbang-lib/whizbang/issues/1792)),** the cap was
consulted only on the burst path. With the drain on, a comparison wrote every deficit bucket of every
chunk into the ledger, so an operator who set the cap to 25 still had every divergent stream queued,
and the ledger grew with the number of divergent streams and accumulated across audits. A field
environment that had just upgraded across many migrations, with a large unstamped history, filled the
ledger faster than the drain could empty it.
:::

### Which rows the drain claims {#drain-claims-deficits-only}

A manifest comparison writes a ledger row for every divergence it reports, whatever its kind, because
the ledger is the operator's record of what is divergent. The drain claims only the rows a redelivery
can repair:

| Divergence | Recorded kind | Claimed by the drain | Counted in the drain backlog |
| --- | --- | --- | --- |
| Deficit: this store holds fewer events than the origin | deficit | Yes | Yes |
| Identity mismatch: equal counts, different folds | not a deficit | Never | No |
| Local surplus: more events than the origin | not a deficit | Never | No |
| Kind unknown (see below) | unknown | Never | No |
| Deficit a redelivery [could not change](#unhealable-buckets) | deficit | Never, until its local digest changes, its deficit grows, or it heals | No |
| Deficit whose request is out, awaiting its [answer](#repair-waits-for-its-answer) | deficit | Not until the answer lands or `RepairAnswerTimeoutMinutes` passes | Yes |
| Deficit a redelivery [answered](#repair-waits-for-its-answer), awaiting the next comparison | deficit | Not until a comparison sights it again | No |
| Deficit past `MaxRepairAttemptsPerBucket` ([exhausted](#what-resets-the-repair-ladder)) | deficit | Never, until its local digest changes or its deficit grows | No |

The comparison states the kind when it reports the bucket, because the ledger row cannot work it out:
it holds each side's fold digest, which is a hash of the event set, not a count. The kind follows the
latest sighting, so a deficit that turns into a surplus leaves the drain, and returns to it if it
becomes a deficit again.

A row's kind is **unknown**, and the row is never claimed, in two cases:

- **Rows recorded before the kind was** (an upgrade from a version without it). No backfill is
  possible, for the reason above. The next comparison that sees the bucket records its kind; until
  then the bucket is reported but not redelivered. After an upgrade, the drain therefore resumes for
  existing deficits on the first audit that covers them, admitted under the [repair caps](#repair-caps).
- **A report that does not carry the kind moved the bucket's signature.** That is the per-bucket
  fallback the ledger takes when its batch call fails, and the only report a version older than this
  one sends during a rolling upgrade. An unchanged signature keeps the kind already recorded, because
  the kind is a property of the two event sets and the signature is their digest.

The claim and the backlog count read a partial index that holds only the claimable rows, in the
claim's order, so their cost does not grow with the number of mismatches and surpluses in the ledger.

:::updated
**Before this was fixed ([#1842](https://github.com/whizbang-lib/whizbang/issues/1842)),** the drain
claimed every per-stream ledger row past its backoff, whatever its kind. Identity mismatches and local
surpluses were re-requested from the origin at `RepairDrainRatePerSecond` on every backoff step, a
redelivery that could not change them, and they counted toward `MaxRepairDrainBacklog`, so a store
with many of them could fill the backlog and defer real deficits.
:::

### Report-only is bilateral {#report-only-is-bilateral}

`ReportOnly` means a service takes no part in repair in either direction, not only that it stops
asking:

- **As an origin** it declines `RequestRedeliveryCommand`: the request completes without a selection
  and is never retried. Serving a request is the repair act on the origin side, and the memory-heavy
  one.
- **As a consumer** it completes a `RedeliveryComposite` without fanning it out: no child rows, no
  pre-fanout receptors, the same terminal shape as a `Skip` directive. A bundle can reach a consumer
  that never asked for it (a peer on the same topic did, or this service did before the operator
  opted down), and folding it in would be the unasked-for mutation the mode exists to prevent.
- **In maintenance** it sweeps parked repair rows (unleased requests and bundles waiting out a retry
  backoff) every cycle through `IWorkCoordinator.DiscardPendingInboxMessagesAsync`, so a row that
  failed while the service was still repairing does not come back when its schedule arrives. Leased
  rows are left to the dispatch seam, which applies the same check.

Detection is untouched: checkpoints, manifests and gap reports still flow, so report-only still
reports. The consequence for operators is that healing needs the opt-in on both sides: an
`AutoRepairCapped` consumer asking a `ReportOnly` origin gets a declined request, logged at the
origin and counted on `whizbang.stream_integrity.repair_traffic_discarded` (tag `role`:
`origin_request`, `consumer_bundle`, `maintenance_sweep`; tag `table`: `inbox`, `outbox`).

**Operator-requested redelivery is the exception.** Report-only opts a service out of *automatic* repair. A
request an operator makes for named streams (see [operator redelivery](#operator-redelivery)) carries
`OperatorRequested`, and so do the bundles that answer it: the origin serves it and the consumer applies them
whatever either side's `RepairMode`. A parked operator bundle is still swept in maintenance like any other repair
row on a report-only consumer; send the request again if one was.

### Operator redelivery: repairing events lost in transport {#operator-redelivery}

{verified: StreamRedeliveryRequesterTests.Request_SendsOneDirectedOperatorRequestPerChunkOfStreamsAsync, RedeliveryRequestReceptorTests.Receptor_UnderReportOnly_ServesAnOperatorRequest_AndMarksItsBundlesAsync, InboxDispatchWorkerTests.OperatorRequestedBundle_UnderReportOnly_FansOutAsync, StreamRedeliveryEndpointsTests.Post_SendsTheRequest_AndAnswersAcceptedWithTheReceiptAsync}

The ledger drives redelivery only for what it tracked. Events lost before the ledger was enabled, and traffic
that carries no `origin_service_id`, can be repaired without custom code in the origin by naming the streams:
the receiving service asks the origin to republish their stored events, and then:

- the origin's built-in receptor selects the streams' stored events, in version order, and publishes them back
  as `RedeliveryComposite` bundles directed at the receiving service, with their **original event ids**;
- the receiving service's inbox expands each bundle, **stores the events it lacks and skips the ones it already
  has** by event id, and its perspectives apply what was missing, so the projection catches up and nothing is
  applied twice.

From code, on the receiving service:

```csharp{title="Request origin redelivery for named streams" category="Operations" difficulty="INTERMEDIATE" tags=["Resilience", "Stream Integrity", "Redelivery"] tests=["StreamRedeliveryRequesterTests.Request_SendsOneDirectedOperatorRequestPerChunkOfStreamsAsync"]}
var receipt = await requester.RequestAsync(new StreamRedeliveryRequest {
  OriginService = "order-service",
  StreamIds = lostStreamIds,
  OriginRequestTopic = "order-service-requests", // omit when learned from the origin's checkpoints
});
```

Over HTTP, after the host mounts the endpoint (behind its own authorization):

```csharp{title="Mount the operator endpoint" category="Operations" difficulty="BEGINNER" tags=["Resilience", "Stream Integrity", "Redelivery"] tests=["StreamRedeliveryEndpointsTests.Post_SendsTheRequest_AndAnswersAcceptedWithTheReceiptAsync"]}
app.MapWhizbangStreamRedeliveryEndpoints().RequireAuthorization("operators");
// POST /whizbang/redelivery/streams
// { "originService": "order-service", "streamIds": ["..."], "originRequestTopic": "order-service-requests" }
```

and from the command line, which posts to that endpoint:

```bash{title="Request a redelivery from the command line" description="Posts the stream list to the receiving service's redelivery endpoint." category="Operations" difficulty="BEGINNER" tags=["cli", "Resilience", "Stream Integrity", "Redelivery"]}
whizbang redeliver --service https://receiver.internal --origin order-service \
  --streams-file lost-streams.txt --origin-topic order-service-requests
```

`202 Accepted` returns what was sent: the origin, the request and reply topics, how many streams and how many
requests. `400` means the request named no origin or no stream; `409` means this service cannot send it, with
the reason (most often an origin request topic it has not learned).

- **Topics.** The request goes on the origin's request topic: the one learned from its integrity checkpoints, or
  the one named. The republished events come back on `StreamIntegrityOptions.RepairTopic`, else the service's
  own command inbox, else its first consumer destination, or a reply topic named in the request (see
  [directed integrity traffic](#directed-integrity-traffic)).
- **Filters.** `TenantScope` and `EventTypes` narrow the selection; `StateOnly` stores and projects the events
  without running trigger receptors again, for a backfill rather than a missed delivery.
- **Bounds.** Streams are sent 500 to a request. The origin still caps each request at its
  `RedeliveryPumpOptions.MaxEventsPerRequest` and builds one request at a time, so a long list is served in turn.
- **Repair mode.** An operator's request is served and applied whatever either side's `RepairMode`
  ([report-only](#report-only-is-bilateral) opts out of automatic repair only), and is counted on
  `whizbang.stream_integrity.repairs_requested` with `source` = `operator`.

### A feature that is off leaves nothing behind {#feature-off-leaves-nothing-behind}

The same sweep covers every stream-integrity feature, not only repair. Each control-plane message
belongs to one feature; when that feature is off, pending rows of that type are work the service has
decided not to do (minted before the operator opted out, or delivered by a peer that does not know),
and every maintenance cycle discards them from the inbox and the outbox
(`IWorkCoordinator.DiscardPendingInboxMessagesAsync` / `DiscardPendingOutboxMessagesAsync`, both
drivers):

| Feature off | Swept from the outbox (minted here, never published) | Swept from the inbox (received, nobody consumes) |
|-------------|------------------------------------------------------|--------------------------------------------------|
| `RepairMode = ReportOnly` | `RequestRedeliveryCommand`, `RedeliveryComposite` | `RequestRedeliveryCommand`, `RedeliveryComposite` |
| `CheckpointsEnabled = false` | `IntegrityCheckpoint` | |
| `GapDetectionEnabled = false` | | `IntegrityCheckpoint` |
| `AuditEnabled = false` | `RequestIntegrityManifest` | `IntegrityManifest` (answers to this service's own audits) |
| `PublishReportEvents = false` | `IntegrityGapDetected`, `IntegrityDivergenceDetected`, `PerspectiveCoverageGapDetected` | |

Two deliberate omissions. Requests from peers (`RequestIntegrityManifest` in the inbox) are still
answered when this service's own audit is off: a service that does not audit can still be audited.
And `RebuildPerspectiveCommand` is never swept, because an operator issues the same command by hand;
a stale auto-rebuild left over from an `AutoRepairCapped` period is indistinguishable from one.

A feature that is on is never touched: the sweep names only the types of features that are off, so
with everything enabled it does nothing, and with the defaults it drops repair traffic (report-only)
and unpublished report events (publishing them is opt-in). Leased rows are skipped either way; the
dispatch seams apply the same checks to the rows they reach.

### The repair decision pipeline (as wired) {#the-repair-decision-pipeline-as-wired}

Every confirmed gap on the checkpoint path now passes through gates in strict order, cheapest
first. The pipeline is implemented by `IntegrityCheckpointReceptor` consulting
`IntegrityRepairPolicy` and the repair ledger:

```
confirmed gap
  |
  |- 1. mode == AutoRepairCapped, per-checkpoint budget left    (cheap flags)
  |
  |- 2. policy.Evaluate(observation)                            (pure; no side effects)
  |       |- settledness: depth / lag / leases; ANY one vetoes  -> ConsumerBehind
  |       |- this window's attempt budget spent?                -> AttemptsExhausted
  |       |- too many windows already under repair?             -> GlobalBudgetExhausted
  |
  |- 3. ledger.TryBeginRepair                                   (durable; RECORDS an attempt)
  |
  |- 4. send the request -> policy.RecordRequested              (charged only if actually sent)
```

The ordering is the design. The policy is pure evaluation, so asking it costs nothing. The
ledger's grant IS its accounting: a grant that is then discarded burns that bucket's budget on a
request never sent, so the ledger is consulted last, after everything that could still say no.

**Why three settledness signals.** Each alone is fooled, so any one vetoes:

| signal | catches | fooled by |
| --- | --- | --- |
| depth (unprocessed rows) | a queued backlog | reads zero in the gap between claim cycles, even mid-storm |
| lag (age of the oldest unprocessed row) | a small queue holding a row stuck for an hour | looks healthy on a service idle for unrelated reasons |
| live leases | a sibling replica dispatching the "missing" events right now | neither of the above sees it |

All three are measured SERVICE-wide, never per instance. An instance that finished its own claimed
streams looks idle from the inside while its peers are still draining; deciding from that local
view re-requests events its own siblings are actively processing, and the storm returns through
whichever replica happened to be free.

The insight behind the veto: a big apparent gap on a backlogged consumer is the STRONGEST evidence
of lag, not the strongest case for repair. Treating it as urgent is what turns a slow consumer
into a storm, because repair re-delivers into the very queue that is behind, which adds load,
deepens lag, and manufactures more false gaps.

**The two budgets.** Per window: a bounded number of requests, and the count RESETS whenever the
window's received count has risen since the last request. Healing counts as working, and a budget
must not expire mid-recovery. Globally: a bound on how many windows may be under repair at once.
This is the cap that was missing everywhere; per-checkpoint caps reset every cadence, so they
bound one batch while the aggregate series is infinite. Only a concurrent-windows bound limits the
total rate at which repair adds load to a struggling system. When a window heals between
checkpoints its slot is released, so healed windows cannot starve genuinely stuck ones.

**Policy and ledger overlap on purpose.** The policy is in-memory and per process: the richer
decision (lag, global budget, heal-reset), lost on restart. The ledger is database-backed and
shared across replicas: per-bucket backoff and attempts that survive restarts, which matters
because restarts are frequently CAUSED by storms, so boot-time state loss used to clear exactly
the memory that would have suppressed one. Composed, each covers the other's blind spot.

**What the pipeline deliberately does not do.** Detection is never gated: `GapsDetected` fires and
the confirmation is logged before any repair decision, on every checkpoint. When repair is vetoed
or exhausted, the system slows or stops ASKING, never stops KNOWING. A vetoed repair is not asked
for at all; an exhausted one is not asked for again until a change repair can act on resets it
([what resets the repair ladder](#what-resets-the-repair-ladder)), and a bucket a redelivery could
not change is not asked for again. A gap that survived
its attempt budget is unlikely to be fixed by one more request; it needs an operator, and it keeps
surfacing in reports and metrics until someone acts.

**Note the asymmetry with the deep audit,** which already guarded against exactly this:
`AuditSettleWindowMinutes` (default 60) exists so that an in-flight delivery never reads as
divergence. The checkpoint path originally had no equivalent; it now has a stronger one, described
in [the repair decision pipeline](#the-repair-decision-pipeline-as-wired). That was the defect
tracked as
[#582](https://github.com/whizbang-lib/whizbang/issues/582).

**Settledness is a property of the SERVICE, never of one instance.** A service runs many instances
against one shared inbox. An instance that has finished its own claimed streams looks completely
idle from the inside while peers are still draining, so an instance deciding from its LOCAL view
re-requests events its own siblings are actively processing — the storm returning through whichever
replica happened to be free. Any gate must read the shared store: unprocessed rows across the whole
inbox, consumer lag (depth alone reads zero between claim cycles), and rows currently leased by ANY
instance.

**Until that lands:** set `RepairMode = ReportOnly` on any consumer that can fall meaningfully
behind its producers — bulk imports, batch jobs, anything with a fan-out multiplier. Repair is
background self-healing; waiting for genuine quiet costs nothing, and not waiting is what produced
the storm.
:::

**Observability (as built): meter `Whizbang.StreamIntegrity`.** Self-healing by default demands
visibility into what the healer does. Counters:
`checkpoints_published` / `checkpoints_received` (the liveness beat), `gaps_detected` +
`divergences_detected` + `coverage_gaps_detected` (the three detection surfaces — sustained
non-zero means deliveries are being lost; find the infrastructure cause),
`repairs_requested` (tagged `source=checkpoint|audit`) + `rebuilds_requested` (what the healer
did about it), `manifests_requested` / `manifest_chunks_sent` / `drill_downs_requested` (audit
wire activity), `backfills_requested` (Phase S), `redelivery_requests_received` (re-delivery
requests served as an origin — repair + backfill flows), and `digest_buckets_verified` +
`digest_drift_healed` (the trust-but-verify sweep — any drift healed means an unaccounted write
path touched audited rows and warrants investigation).

### Repair that cannot change a bucket {#unhealable-buckets}

{verified: IntegrityLedgerUnhealableSqlTests.TryBeginRepair_AnUnhealableBucket_IsRefusedPastItsTerminalCadenceAsync, IntegrityLedgerUnhealableSqlTests.ClaimRepairDrain_SkipsAnUnhealableBucketAsync, IntegrityLedgerUnhealableSqlTests.TryBeginReport_ASignatureChange_LiftsTheMarkAndRepairResumesAsync, RedeliveryReconcilerTests.Reconcile_EveryEventAlreadyPresentAndNothingAdopted_MarksTheBucketUnhealableOnceAsync}

A bucket whose origin never answered has spent its attempt budget against an origin that may simply
have been down: it is [exhausted](#what-resets-the-repair-ladder), not marked. A bucket whose origin did
answer is different. When a redelivery bundle commits and every event it carries was already stored
under its origin, with nothing to adopt, the redelivery changed nothing, and the next one would ship the
same events again.

The receiver records that on the bucket's ledger row (`wh_integrity_ledger.unhealable_at`) when the
bundle's children commit ([below](#unhealable-recorded-at-commit)). From then on:

- neither the burst grant (`wh_integrity_try_begin_repair`) nor the paced drain
  (`wh_integrity_claim_repair_drain`) asks for the bucket again;
- the divergence cooldown stops re-reporting it;
- one Warning names the bucket (event type, tenant, stream, origin) when it is marked, and the
  `repairs_unhealable` counter counts it once.

A change in this store's digest of the bucket, or a deficit that grew, is a fresh incident: it lifts the
mark, resets the attempt budget and reports again. New events at the origin alone do not lift it; see
[what resets the repair ladder](#what-resets-the-repair-ladder). A heal deletes the row. Only buckets the ledger already tracks are
marked, so a redelivery nobody asked this ledger for leaves nothing behind. The usual causes of a bucket
repair cannot change are an event stored under another origin or another stream; compare the stream on
both sides. A bucket is also marked when the store refused to restore one of its events because the stream's
earlier history was truncated here ([events deduplication remembers but the store lost](#remembered-but-missing)).

The checkpoint path keys its ledger rows by type and window rather than by stream, and its
[repair policy](#the-repair-decision-pipeline-as-wired) already stops a window whose count stopped
improving, so it is unaffected by the mark.

### Repair waits for its answer {#repair-waits-for-its-answer}

{verified: IntegrityRepairAnswerSqlTests.Claim_ABucketWithItsAnswerPending_IsNotClaimed_UntilTheAnswerTimeoutPassesAsync, IntegrityRepairAnswerSqlTests.TryBeginRepair_WhileItsOwnAnswerIsPending_IsRefusedAsync, IntegrityRepairAnswerSqlTests.RecordBundleAnswer_ClearsThePending_AndTheBucketWaitsForTheNextComparisonAsync, IntegrityRepairAnswerSqlTests.Claim_PastTheAttemptBudget_StopsForGood_AndCountsAsExhaustedAsync, IntegrityRepairAnswerSqlTests.TryBeginRepair_PastTheAttemptBudget_IsRefusedForGoodAsync, RepairDrainWorkerTests.DrainTick_MarksTheDispatchedBucketsAnswerPending_ButNotAGroupWhoseSendFailedAsync, StreamIntegrityOptionsValidatorTests.RepairAnswerTimeout_DefaultsToThreeHoursAsync}

A repair request is answered by a redelivery bundle, and the answer takes time to arrive: the origin
records the request for its maintainer, which handles it under the housekeeping idle gate, and the bundle
then waits in this service's inbox like any other message. A request is not a reason to ask again, so
every repair ledger row moves through explicit states:

| State | How a bucket gets there | What repair does with it |
| --- | --- | --- |
| **Claimable** | A comparison reported a deficit, the bucket is under its attempt budget, and its backoff has passed | The paced drain may claim it (or the burst path may grant it) and send a request |
| **Answer pending** | A request for the bucket was sent (`wh_integrity_ledger.answer_pending_until`) | Neither the drain nor the burst grant asks again until the answer lands or `RepairAnswerTimeoutMinutes` passes |
| **Answered** | A redelivery bundle for the bucket committed (`answered_at`) | The drain does not claim it until the next comparison sights the bucket again; a heal deletes the row |
| **Exhausted** | The claim or grant that spent the last of `MaxRepairAttemptsPerBucket` attempts (`exhausted_at`) | Never asked for again until a [reset](#what-resets-the-repair-ladder) |
| **Unhealable** | A bundle for the bucket [changed nothing](#unhealable-buckets) | Never asked for again until a [reset](#what-resets-the-repair-ladder) |

```mermaid{caption="The repair ladder of one ledger row: a request waits for its answer, an answered bucket waits for the next comparison, and only a local change or a grown deficit re-arms a bucket that spent its budget or that repair cannot change." tests=["IntegrityRepairAnswerSqlTests.Claim_ABucketWithItsAnswerPending_IsNotClaimed_UntilTheAnswerTimeoutPassesAsync", "IntegrityRepairAnswerSqlTests.RecordBundleAnswer_ClearsThePending_AndTheBucketWaitsForTheNextComparisonAsync", "IntegrityRepairAnswerSqlTests.RecordBundleAnswer_ABundleWhoseEventsWereAllStoredAlready_MarksTheBucketAtCommitAsync", "IntegrityRepairAnswerSqlTests.Claim_PastTheAttemptBudget_StopsForGood_AndCountsAsExhaustedAsync", "IntegrityRepairAnswerSqlTests.Report_TheLocalDigestMoved_ResetsTheLadder_AndLiftsTheMarkAsync", "IntegrityRepairAnswerSqlTests.Report_TheDeficitGrew_ResetsTheLadder_AndLiftsTheMarkAsync", "IntegrityRepairAnswerSqlTests.Report_OnlyTheOriginsDigestMoved_KeepsTheAttempts_AndTheMarkAsync"]}
stateDiagram-v2
  [*] --> Claimable: a comparison reports a deficit
  Claimable --> AnswerPending: request sent (an attempt is spent)
  AnswerPending --> Claimable: RepairAnswerTimeoutMinutes passes with no answer
  AnswerPending --> Answered: a redelivery bundle commits
  Answered --> Claimable: the next comparison still sees a deficit
  Answered --> Unhealable: the bundle changed nothing (judged at commit)
  AnswerPending --> Exhausted: the last attempt is spent and the bucket is not healed
  Exhausted --> Claimable: re-armed by a local change or a grown deficit
  Unhealable --> Claimable: re-armed by a local change or a grown deficit
  Claimable --> Healed: a comparison finds both sides equal
  Answered --> Healed: a comparison finds both sides equal
  Healed --> [*]: the ledger row is deleted
  classDef stopped fill:#f8d7da,stroke:#dc3545,stroke-width:2px
  classDef healed fill:#d4edda,stroke:#28a745,stroke-width:2px
  class Exhausted,Unhealable stopped
  class Healed healed
```

**Answer pending.** The drain records every bucket of a request that left, and only those: a group
whose send failed is not marked and is claimed again after its backoff. The mark lasts
`Whizbang:StreamIntegrity:RepairAnswerTimeoutMinutes` (default **180**). The default is three hours
because the answer can wait in the origin's integrity queue for up to `Whizbang:Housekeeping:MaxDeferral`
(one hour by default) before a forced pass, and then in this service's inbox, so three hours covers both
with room to spare. It also stays well inside the daily audit (`AuditIntervalMinutes`, 1440), so a
request that was lost on the way is asked for again the same day rather than the next. The timeout must
be at least one minute; host start fails otherwise, naming the key, because a timeout below a minute
makes every requested bucket claimable again at once, which is the re-asking the timeout exists to
stop. The attempt was spent when the request was sent, so a timeout followed by a new request counts
against the budget like any other attempt.

**Answered.** When a redelivery bundle's children commit, every ledger row it covered stops waiting and
is marked answered, together with the type lane of its type. The drain then leaves the bucket alone
until a comparison sights it again: either both sides now agree and the heal deletes the row, or the
deficit remains and the bucket becomes claimable on its ladder. A received answer used to stop nothing,
and the drain kept asking for the bucket on its backoff until the next audit healed it. The price of
waiting is that a bundle that repaired only part of a bucket is asked for again after the next
comparison, not before.

**The budget is a real cap.** The claim or grant that spends the last of `MaxRepairAttemptsPerBucket`
(default 8) attempts marks the bucket exhausted, and neither path asks for it again. It still re-reports
at the divergence cooldown and counts in `repair_exhausted_buckets`. The last request still waits for its
answer, and a bundle that lands for it can still heal the bucket. Before this, a bucket past its
budget was asked for again at a terminal cadence (the backoff base doubled six times, every 5 h 20 m at
the default base) for as long as it stayed divergent.

**The type lane stands down for its streams.** A bulk backfill and a checkpoint gap request ask for a
whole type over a window, on the type lane (the row with the empty stream id), and re-ship every stream
of that type inside it. So:

- while per-stream rows of the type await their answers, a type-lane grant is refused: those answers
  already re-ship the events;
- when a type-lane request is granted and sent, it marks its own row and every per-stream row of the
  type whose window lies inside the request's window as answer pending, so the drain does not ask for
  the same events stream by stream;
- the checkpoint path's type-lane row is forgotten when its gap heals.

**One request per window.** The drain groups the rows it claims by origin, tenant, event type and window,
and sends one request per group. Before, it sent one request per origin, tenant and type over the union
of the group's windows, which re-shipped every stream over the widest range any of them needed. Rows one
comparison stamped share their window, so the change costs few extra requests. A row recorded before
windows were (a null window) asks for the stream's whole history on its own, without widening its
windowed neighbors.

### What resets the repair ladder {#what-resets-the-repair-ladder}

{verified: IntegrityRepairAnswerSqlTests.Report_TheLocalDigestMoved_ResetsTheLadder_AndLiftsTheMarkAsync, IntegrityRepairAnswerSqlTests.Report_TheDeficitGrew_ResetsTheLadder_AndLiftsTheMarkAsync, IntegrityRepairAnswerSqlTests.Report_OnlyTheOriginsDigestMoved_KeepsTheAttempts_AndTheMarkAsync, IntegrityManifestReceptorTests.ManifestReceptor_StreamLevelReport_CarriesEachDeficitsSize_SoTheLedgerCanTellAGrowingDeficitAsync}

A bucket's ladder is its attempt count, its last attempt, its exhausted and unhealable marks and any
pending answer. Exactly two things reset all of them:

1. **This store's digest of the bucket moved.** Events arrived here, or were lost here, so what a
   redelivery can do here has changed.
2. **The deficit grew.** Each comparison records how many events the origin holds that this store does
   not (`wh_integrity_ledger.deficit_events`); a later comparison that reports a larger deficit is a new
   incident. An unknown size keeps the size already recorded.

**New events at the origin alone do not reset it.** An active origin's digest moves with every event it
appends, and that says nothing about whether a redelivery can repair this store. Before, a change on
either side reset the ladder and lifted the unhealable mark, so every audit of a busy, still-divergent
stream started a fresh ladder and the budget never ran out. Reporting is unchanged: a changed signature
on either side is still reported at once, so detection does not wait for the cooldown.

The in-memory ledger, used only when no durable store is registered, keeps the same ladder, and one shared
contract test runs against both ledgers so they cannot drift apart:

- **The cap.** It is exhausted by the grant that spends the budget, with no terminal cadence.
- **The pending answer.** It is kept until the answer arrives or the timeout passes.
- **What resets it.** Only a local digest change or a grown deficit, and a reset clears the pending answer
  too.
- **The type-lane stand-down.** It applies while per-stream buckets of the type are pending.

Two things differ, because only the durable store has them:

- **Windowed type-lane marks.** In-memory buckets carry no window, so a type-lane mark with a window
  marks none.
- **The separate answered state.** Only the paced drain reads it, and the in-memory ledger has no drain.
  There, an answer simply clears the pending answer.

The integrity gauges are always read from the durable store.

A reset also clears a pending answer, so a bucket whose local digest moved is claimable at once instead
of waiting out the timeout for an answer to a question about a store that has since changed. Any
sighting by a comparison, changed or not, clears the answered state: the comparison has judged the
answer.

:::updated
**Behavior change.** An exhausted bucket is re-armed by its next local change or by a grown deficit,
never by time. A bucket whose budget burned against an origin that was unreachable stays exhausted
after the origin comes back, until one of those resets happens or an operator repairs it (for example
with an [operator redelivery](#operator-redelivery)). Raising `MaxRepairAttemptsPerBucket` does not
revive buckets that are already exhausted, because the mark, not the count, keeps them out: they stay
in `repair_exhausted_buckets` until a reset.
:::

#### Unhealable is recorded at commit {#unhealable-recorded-at-commit}

{verified: IntegrityRepairAnswerSqlTests.RecordBundleAnswer_ABundleWhoseEventsWereAllStoredAlready_MarksTheBucketAtCommitAsync, IntegrityRepairAnswerSqlTests.RecordBundleAnswer_ChildrenTheBundleJustBrought_AreAbsentAtCommit_ThoughAReconcileAfterTheyAreStoredFindsThemPresentAsync, IntegrityRepairAnswerSqlTests.RecordBundleAnswer_AStoredEventWithoutItsOrigin_IsLeftForTheReconcile_NotMarkedAtCommitAsync, RedeliveryReconcileCommitTimeTests.Reconcile_RecordsTheAnswerAtCommit_AndReportsTheBucketsItMarked_BeforeDeferringTheRestAsync, RedeliveryReconcileCommitTimeTests.TheDrain_ChildrenAbsentAtCommit_AreNotJudgedUnchanged_ThoughStoredWhenTheReconcileRunsAsync, RedeliveryReconcileCommitTimeTests.Reconcile_RecordingTheAnswerFails_IsLogged_AndTheReconcileIsStillDeferredAsync}

A redelivery bundle's answer is recorded when its children commit, with one small query keyed by the
bundle's event ids: for each bucket, how many of its events the store already held, how many it did not
(the bundle stores them), how many the store refused to restore, and how many present events could still
take an origin. The covered rows become answered, and the buckets of a bundle that changed nothing are
marked unhealable at once, each named in one Warning and counted once in `repairs_unhealable`. Adopting
origins and moving digests stay with the maintainer's deferred reconcile; an event stored without its
origin is left for that reconcile to adopt, not marked.

Before, the mark waited for the deferred reconcile, which runs under the housekeeping idle gate and can
wait up to `MaxDeferral` on a busy service, while the drain kept asking for the bucket.

"Changed nothing" is judged on what the store held **at commit**, on purpose. By the time the deferred
reconcile runs, the bundle's own children are stored, and they read as present: judged then, a bundle
that had just repaired a bucket would look like one that changed nothing, and the bucket would be marked
unhealable for the repair that worked. The commit-time view travels with the deferred reconcile, which
uses it instead of its own reading. A reconcile recorded by a version without the commit-time answer
judges by presence as before. If recording the answer fails, a Warning says so, the buckets wait out
their answer timeout, and the reconcile judges the bundle without the commit's view.

#### Per-bundle work keeps its working table for the connection {#per-bundle-work-table}

{verified: RedeliveryBundleCatalogChurnSqlTests.RecordBundleAnswer_ASecondCallOnTheConnection_WritesNothingToTheSystemCatalogAsync, RedeliveryBundleCatalogChurnSqlTests.ReconcileBundle_ASecondCallOnTheConnection_WritesNothingToTheSystemCatalogAsync, RedeliveryBundleCatalogChurnSqlTests.RecordBundleAnswer_TwiceInOneTransaction_AnswersEachBundleForItsOwnEventsAsync, RedeliveryBundleCatalogChurnSqlTests.ReconcileBundle_TwiceInOneTransaction_StartsFromAnEmptyWorkingTableAsync}

The commit-time answer and the deferred reconcile each gather a bundle's rows in a temporary working
table. The table is created once per database connection and emptied at commit, not created and dropped
by every call. A consumer can receive hundreds of small bundles a minute, and a table created per call
cost far more than the bundle's own work: system catalog rows written and deleted on every bundle, cache
invalidations sent to every other connection to the database, and every statement in the function planned
again because each call's table was a new one. Each call empties the table before it starts, so a second
bundle in the same transaction sees only its own rows.

---

## Directed integrity traffic {#directed-integrity-traffic}
{verified: RepairTopicResolverTests.Unset_OwnCommandInbox_IsPreferredOverASharedFirstDestinationAsync, RepairTopicResolverTests.Unset_NoOwnCommandInbox_KeepsTheFirstDestination_AndSaysOnceThatItIsSharedAsync, RepairTopicResolverTests.Configured_WinsAsync, IntegrityControlDestinationTests.ADirectedMessage_ToTheAddresseesAdvertisedTopic_ReachesOnlyTheAddresseeAsync}

Most integrity traffic is addressed to one service: a manifest request and its answer, a drill-down, a page follow, a
redelivery request and the bundle that answers it. Each service advertises the address it wants that traffic on in
its [checkpoint](#ownership-is-exchanged-on-the-checkpoint), and every peer sends to that address.

The address is resolved in this order:

| Order | Address | When |
|---|---|---|
| 1 | `StreamIntegrityOptions.RepairTopic` | Configured explicitly |
| 2 | This service's own command inbox | The [namespace inbox strategy](../fundamentals/dispatcher/routing) provisioned a command inbox for a command namespace this service handles. Only this service subscribes to it |
| 3 | The first destination this service consumes | No command inbox of its own. Usually a topic other services read too, so the service logs once that its integrity traffic is on a shared topic |

```mermaid{caption="A directed integrity request reaches only its addressee's own command inbox; a broadcast backfill still rides the shared topic." tests=["IntegrityControlDestinationTests.ADirectedMessage_ToTheAddresseesAdvertisedTopic_ReachesOnlyTheAddresseeAsync","RepairTopicResolverTests.Broadcast_IsTheSharedTopic_NeverTheOwnCommandInboxAsync"]}
flowchart LR
  C[Consumer] -->|manifest request, TTL| OI[(Origin's own command inbox)]
  OI --> O[Origin]
  O -->|answer, TTL| CI[(Consumer's own command inbox)]
  CI --> C
  C -->|broadcast backfill| S[(Shared inbox topic)]
  S --> O
  S --> P[Every other service]
```

**Why the own inbox.** The default used to be the first destination a service consumes, which in practice is the
shared inbox every service reads. Every directed integrity message was then copied to every service, which read it
only to discard it, and a stopped service's subscription kept growing until the shared topic reached its size cap.
The own command inbox is subscribed by exactly one service, so a directed message reaches exactly one. A
[subscription-expansion backfill](#phase-s-subscription-expansion-backfill) for a type with no known owner is a
broadcast by design, so it still goes on the shared topic.

### Integrity control messages expire {#integrity-control-message-ttl}
{verified: IntegrityControlDestinationTests.For_StampsTheIntegrityTimeToLive_ByDefaultAnHourAsync, IntegrityControlDestinationTests.For_StampsTheConfiguredTimeToLiveAsync, IntegrityAuditWorkerBranchCoverageTests.RunAuditOnce_TheManifestRequest_ExpiresWithTheIntegrityTimeToLiveAsync, StreamIntegrityOptionsValidatorTests.Validate_AControlMessageTimeToLiveBelowOneMinute_FailsNamingTheKeyAsync}

Every directed integrity message carries a time to live, `Whizbang:StreamIntegrity:ControlMessageTimeToLiveMinutes`
(default 60). The transports lift it to the broker's own expiry (see the
[control-plane rail](../fundamentals/dispatcher/routing#control-class)), so a message nobody reads in time is dropped
by the broker instead of piling up. Integrity requests are regenerated every cycle, so an expired one costs nothing:
the next checkpoint, audit or repair pass asks again. The value must be at least 1; a smaller one fails at host start
naming the key.

```json{title="Shorten the integrity time to live" description="Directed integrity messages expire at the broker after 15 minutes" category="Configuration" difficulty="INTERMEDIATE" tags=["stream-integrity","time-to-live","configuration"]}
{
  "Whizbang": {
    "StreamIntegrity": {
      "ControlMessageTimeToLiveMinutes": 15
    }
  }
}
```

**Mixed versions.** The address is advertised on the checkpoint, so an upgraded service sends to whatever each peer
advertises. A peer that has not upgraded advertises the shared topic and keeps receiving its integrity traffic there
until it upgrades; nothing needs to be deployed in a particular order.

## Integrity work runs on the maintainer {#integrity-work-runs-on-the-maintainer}

{verified: IntegrityTimerWorkersOnTheMaintainerTests.TheAudit_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_DoesNothingAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheRepairDrain_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_ClaimsNothingAsync, IntegrityTimerWorkersOnTheMaintainerTests.Checkpoints_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_AreNotPublishedAsync, IntegrityDeliveryWorkerTests.OnAnInstanceThatDoesNotHoldTheMaintainerDuty_ThePassDoesNothingAsync, IntegrityDeliveryWorkerTests.WithoutRoleAssignment_EveryInstanceDrainsAsync, IntegrityReceptorRegistrationEnforcementTests.EveryIntegrityReceptor_IsRegisteredDeferred_AtEveryStageAsync}

Stream-integrity work is fleet-wide background work, and it runs where the rest of that work runs: on the instance
holding the [maintainer duty](../operations/startup/capabilities-and-duties#the-maintainer-duty-governs-fleet-wide-work).
When role assignment does not manage that duty (no duty loop, or a loop without the `maintainer` role), every instance
does the work, as the maintenance sweep does: there is no holder to defer to, and a gate that waited for one would
disable what it gates. Every caller asks the same question through one helper, `MaintainerDuty.IsThisInstancesTurn`.

The deferrable parts are also **idle-gated**: they ask the
[housekeeping coordinator](../operations/workers/housekeeping-arbitration#integrity-is-idle-gated) for the integrity
slot, are deferred while the service is busy or cooling down, and are forced through once they have been deferred for
`Whizbang:Housekeeping:MaxDeferral` (one hour by default).

| Integrity activity | Where it runs | Idle-gated |
| --- | --- | --- |
| Draining integrity deliveries (received checkpoints, manifest requests, manifest chunks, redelivery requests, bundle reconciles) | The maintainer, in the `IntegrityDeliveryWorker` | Yes |
| The deep and local audit (`IntegrityAuditWorker`) | The maintainer | Yes |
| The paced repair drain (`RepairDrainWorker`) | The maintainer | Yes |
| Publishing continuity checkpoints (`IntegrityCheckpointWorker`) | The maintainer | **No**, see [checkpoints are not gated](#checkpoints-are-not-idle-gated) |
| Storing a redelivery bundle's events | Whichever instance receives the bundle | No: that is ordinary event storage |

**Why.** Nothing in stream integrity reads the same data twice: checkpoint windows are won by compare-and-swap, audit
cycles and repair-drain rows are claimed, and each integrity message is leased to one instance. But with N instances,
N instances put integrity work on the database at once, and the receive side is the expensive part: reconciling a
redelivery bundle, comparing a manifest chunk, building a redelivery for another service. Each ran on whichever
instance leased the message, alongside that instance's ordinary traffic and with no regard for how busy the service
was. Integrity work verifies and repairs history; none of it has a deadline measured in seconds, and all of it
competes for the same database as the traffic it verifies. The maintainer duty and the idle gate already existed for
exactly this kind of work.

### Integrity deliveries are queued {#integrity-deliveries-are-queued}

{verified: IntegrityDeliveryDeferralTests.Registration_WrapsTheReceptorAtAllThreeStagesAsync, IntegrityDeliveryDeferralTests.OutsideTheDrain_EveryStageRecordsTheDelivery_AndDoesNotRunTheReceptorAsync, IntegrityDeliveryDeferralTests.OneMessageAtEveryStage_IsRecordedOnceAsync, IntegrityDeliveryDeferralTests.TheDeliveryId_IsAFunctionOfTypeAndPayloadAsync, IntegrityDeliveryDeferralTests.InsideTheDrain_TheWrapperRunsTheReceptorAsync, RedeliveryReconcileDeferralTests.Reconcile_WithTheQueue_IsRecordedForTheMaintainer_NotRunHereAsync, RedeliveryReconcileDeferralTests.TheDrain_ReconcilesWithExactlyWhatTheInlineReconcilePassesAsync, RedeliveryReconcileDeferralTests.Reconcile_ARedeliveredBundle_IsRecordedOnceAsync, IntegrityDeliverySqlTests.Enqueue_TheSameDeliveryTwice_RecordsItOnceAsync}

Every integrity receptor (received checkpoints, manifest requests, manifest chunks, redelivery requests) is registered
wrapped, through `IntegrityDeliveryRegistration.RegisterIntegrityReceptor`, at all three stages a framework receptor
runs at: local dispatch, the sending service's outbox copy, and a copy received from another service. Invoked
anywhere other than the maintainer's drain, the wrapper records the message as a row in `wh_integrity_deliveries`
(migration 302) and returns without running the receptor. Inside the drain it runs the receptor it wraps.

Reconciling a committed redelivery bundle is recorded the same way, under the delivery type
`whizbang:redelivery-reconcile`, with the bundle's origin, the origin's name, the children's event ids and their origin
sequences. The drain reconciles with exactly those, as the inline reconcile would have. The bundle's events are still
stored at receipt, so only the reconcile waits.

**A delivery is recorded once.** Its id is derived from its type and payload bytes (SHA-256 over the length-prefixed
type and the payload, truncated to a version 8 UUID), and recording an id that is already present does nothing. The
inbox, outbox and local copies of one message, a delivery retried after a failed commit, and a redelivered bundle with
the same children all land as one row.

A registration enforcement test finds every integrity receptor registrar in the Postgres driver by shape and fails,
naming the receptor, if any integrity message is registered without the wrapper at any of the three stages. A receptor
added the ordinary way would run its integrity work inline on whichever instance received the message, which is the
load this design removes.

### The integrity delivery drain {#the-integrity-delivery-drain}

{verified: IntegrityDeliveryWorkerTests.TheDrain_HandlesDeliveriesInArrivalOrder_InsideTheDrain_AndCompletesEachAsync, IntegrityDeliveryWorkerTests.AFailedDelivery_IsRetriedAfterAnExponentialBackoffAsync, IntegrityDeliveryWorkerTests.TheBackoff_IsCappedAtAnHourAsync, IntegrityDeliveryWorkerTests.ADeliveryThatHasSpentItsAttempts_IsDropped_WithAWarningNamingItsTypeAndErrorAsync, IntegrityDeliveryWorkerTests.ADeliveryNoHandlerIsRegisteredFor_IsDropped_WithAWarningAsync, IntegrityDeliveryWorkerTests.APass_IsBoundedByMaxDeliveriesPerPass_LeasedInBatchesAsync, IntegrityDeliveryWorkerTests.APass_StopsWhenALeaseComesBackShortAsync, IntegrityDeliveryWorkerTests.EveryOutcome_IsCountedAsync, IntegrityDeliverySqlTests.Lease_ReturnsDueDeliveriesInArrivalOrder_AndPushesThemOutByTheLeaseAsync, IntegrityDeliverySqlTests.Lease_SkipsADeliveryAnotherDrainHoldsLockedAsync, IntegrityDeliverySqlTests.Fail_CountsTheAttempt_KeepsTheError_AndHoldsItForTheBackoffAsync, IntegrityDeliveryWorkerLoopTests.TheLoop_RunsAPass_AndStopsCleanlyAsync, IntegrityDeliveryWorkerLoopTests.AFailedPass_IsLogged_AndTheNextIntervalRunsAgainAsync}

The `IntegrityDeliveryWorker` is hosted at Accept commands, so it starts once the instance is eligible for work, and runs a pass every `IntegrityDeliveryIntervalSeconds`
(15 by default). A pass does nothing on an instance that is not the maintainer, and nothing while the idle gate defers
integrity work. Once admitted, or forced through after `MaxDeferral`, it:

1. leases due deliveries in arrival order, `IntegrityDeliveryBatchSize` at a time, skipping rows another drain holds
   locked and pushing each leased row out of view for `IntegrityDeliveryLeaseSeconds`, so a drain that overlaps this
   one during a maintainer-duty failover does not take the same rows;
2. handles them one at a time, each in its own scope and inside the drain context, so the wrapped receptor does the
   work instead of recording it again;
3. deletes each delivery it handled;
4. stops at `MaxIntegrityDeliveriesPerPass` deliveries, or as soon as a lease comes back short, and leaves the rest for
   the next pass.

**Failures back off, then drop.** A handler that throws is retried after `IntegrityDeliveryRetryBackoffSeconds`
(30 by default), doubled on each further attempt and capped at one hour; the row keeps the latest error in
`last_error` for an operator. A delivery that has spent `MaxIntegrityDeliveryAttempts` (5 by default) is deleted and
logged as a Warning that names its type and its error. So is a delivery whose type no handler on this instance is
registered for, such as one recorded by a different library version. Integrity traffic is control-plane traffic and
is dropped at its bound rather than dead-lettered: the next checkpoint, audit or repair cycle asks again. A pass that
fails as a whole is logged and leaves every delivery queued for the next pass.

Because the drain handles deliveries one at a time on one instance, redelivery reconciles no longer run in parallel.
Bundles for the same streams used to queue on the per-stream advisory locks inside the database, each waiting
session holding a pooled connection that ordinary message work needed.

The table needs no retention in maintenance: the drain deletes every delivery it handles and every delivery it drops.

### When the store cannot queue {#integrity-inline-fallback}

{verified: IntegrityDeliveryDeferralTests.ACoordinatorWithoutTheQueue_RunsTheReceptorInline_AsBeforeAsync, IntegrityDeliveryDeferralTests.AHostWithoutACoordinator_RunsTheReceptorInlineAsync, IntegrityDeliveryDeferralTests.AHostWithoutTheDrain_RunsTheReceptorInline_AndRecordsNothingAsync, RedeliveryReconcileDeferralTests.Reconcile_WithoutTheDrain_RunsInlineAsync}

Recording a delivery that nothing will drain would lose it, so integrity work runs inline, where it arrives, as it did
before, in three cases: the host has no drain registered, there is no work coordinator in scope, or the coordinator
cannot record deliveries (a store without `wh_integrity_deliveries` reports the queue as unsupported). The Dapper
driver never gets here: stream integrity is off on Dapper and refused at startup when configured on (see
[What the Dapper driver refuses at startup](../data/drivers.md#what-dapper-refuses-at-startup)).

### The idle gate, one budget per requester {#integrity-idle-gate}

{verified: IntegrityTimerWorkersOnTheMaintainerTests.TheAudit_OnTheMaintainerOfAQuietService_RunsAndReleasesTheSlotAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheAudit_OnABusyService_WaitsUntilMaxDeferral_ThenIsForcedThroughAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheRepairDrain_OnTheMaintainerOfAQuietService_ClaimsAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheRepairDrain_OnABusyService_WaitsUntilMaxDeferral_ThenIsForcedThroughAsync, IntegrityDeliveryWorkerTests.OnABusyService_ThePassIsDeferred_AndTheSlotIsNotHeldAsync, IntegrityDeliveryWorkerTests.AfterMaxDeferral_ThePassIsForcedThrough_AndDeferredSinceClearsAsync, IntegrityDeliveryWorkerTests.AnUnmeasuredService_DrainsAsBefore_AndTheFailureIsLoggedAsync, IntegrityDeliveryWorkerTests.WithoutTheHousekeepingCoordinator_DrainsUngatedAsync, HousekeepingIntegrityAdmissionTests.Integrity_EachRequesterSpendsAndRearmsItsOwnBudgetAsync}

The drain, the audit and the repair drain each measure the service's settledness and ask the housekeeping coordinator
for the integrity slot under their own name. The rule is the one dead-letter recovery uses, described in
[housekeeping arbitration](../operations/workers/housekeeping-arbitration#integrity-is-idle-gated): deferred while the
service is busy or still cooling down, forced through once deferred for `MaxDeferral`, and still ranked above the
cleanup sweep and below dead-letter recovery.

- **The audit** treats a cycle it could not run like a cycle that reached no origins: it retries on the startup window,
  not a full `AuditIntervalMinutes` later.
- **The repair drain** asks only once it has something to send, so an idle drain does not measure the backlog every
  second. Its tokens keep accruing, up to the burst cap, while it waits.
- **A reading that cannot be taken** is logged as a Warning and admitted unmeasured, and a host without a housekeeping
  coordinator runs integrity work ungated: a gate that cannot measure must never silently disable what it gates.

**Each requester has its own deferral budget.** The three requesters share one slot, but they tick at very different
rates. With one shared budget, whichever requester asked first after the ceiling would take the forced pass and re-arm
the ceiling for all of them, so a requester on a slower tick could be starved for as long as the load lasted. Each
requester's ceiling is measured from its own first deferral and re-armed only by its own completed pass.

### Checkpoints are not idle-gated {#checkpoints-are-not-idle-gated}

{verified: IntegrityTimerWorkersOnTheMaintainerTests.Checkpoints_AreNotIdleGated_BecauseAMissingCheckpointIsTheConsumersLivenessAlarmAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheLivenessCheck_AllowsForTheTimeReceivedCheckpointsWaitedInTheQueueAsync}

Checkpoint publishing runs only on the maintainer (the watermark compare-and-swap still picks one winner per window
when every instance publishes), but it never asks for the integrity slot. A consumer reads a missing checkpoint as its
liveness alarm, so a checkpoint deferred because its origin is busy would make every busy service look dead to its
consumers. Publishing one is a watermark advance and a publish, cheap enough to keep its cadence under any load.

The receiving side is different: a received checkpoint is an integrity delivery and waits in the queue while the idle
gate defers the drain. The stale-origin warning would then report a live origin as silent, so its bound widens by how
long the drain has been deferred. The bound is three checkpoint intervals plus the time since the drain's current run
of deferrals began (`IntegrityDeliveryWorker.DeferredSince`); once a pass is admitted, it returns to three intervals.

### Options {#integrity-delivery-options}

All bound from `Whizbang:StreamIntegrity`, like the rest of `StreamIntegrityOptions`; the full table is in the
[configuration reference](../operations/configuration/configuration-reference#streamintegrityoptions).

| Option | Default | Meaning |
| --- | --- | --- |
| `IntegrityDeliveryIntervalSeconds` | `15` | How often the maintainer's drain runs a pass |
| `IntegrityDeliveryBatchSize` | `50` | Deliveries leased per round trip of the drain |
| `MaxIntegrityDeliveriesPerPass` | `500` | The most deliveries one admitted or forced pass handles; the rest waits for the next pass |
| `IntegrityDeliveryLeaseSeconds` | `300` | How long a leased delivery stays invisible to another drain; covers a maintainer-duty failover that briefly overlaps two drains |
| `MaxIntegrityDeliveryAttempts` | `5` | Attempts before a delivery is dropped with a Warning naming its type and error |
| `IntegrityDeliveryRetryBackoffSeconds` | `30` | The wait before retrying a failed delivery, doubled per further attempt and capped at one hour |

The gate itself is configured under `Whizbang:Housekeeping` (`SettledCooldown`, `MaxDeferral`), shared with
dead-letter recovery and maintenance.

The four `deliveries_*` counters on this page's [meter](#observability) show the queue at work.

## Bounded reconciliation — epochs, negotiated scope, seals

The phases above answer *"do two services hold the same events?"* correctly — but as originally
built, the **cost of asking grew with accumulated history** rather than with the size of the
discrepancy. This layer (designed in the
[bounded-integrity-reconciliation proposal](/proposals/bounded-integrity-reconciliation) after a
live deployment paid a year's history per audit) changes the asymptote: the exchange becomes
proportional to **what is missing**, verified history is **sealed and never re-read on the hot
path**, and the expensive full verification is **scheduled at an idle hour**.

### Epoch seals (the substrate)

Each origin lane's sequence space is partitioned into fixed-width **epochs** (migration 092,
`integrity_epoch_width`, default 100 000). One immutable XOR fold per
`(origin lane, tenant, type, epoch)` bucket lives in `wh_digest_epochs`; a contiguous per-lane
**frontier** records how far closure has advanced, with the width **pinned per lane at first
close** (epoch identity is `floor(seq / width)` — a changed setting must never remap existing
boundaries).

Three deliberate design points:

- **Derived at closure, not on the write path.** The local lane's `commit_sequence` is stamped
  asynchronously after emit, so emit-time epoch assignment is impossible — and the emit chain is
  the hottest path in the system. Closure rides the maintenance cycle
  (`CloseDigestEpochsAsync`, bounded by `MaxEpochClosuresPerMaintenanceCycle`) and recomputes each
  epoch once; the emit chain is byte-identical to before.
- **The redelivery guard.** An epoch closes only when the lane's settled max lies beyond it AND no
  *unsettled* event sits inside its range — redelivery can land a **fresh** event carrying an
  **old** origin sequence, and a settled-max frontier alone would seal over it.
- **One canonical fold.** Close, refold (repair), and verify all read the same SQL function
  (`_wh_epoch_buckets`), so the fold predicates — ephemeral (`flags & 8`) and at-most-once
  (`flags & 32`) excluded, mirroring the emit-chain digest fold — cannot drift apart across consumers.

### Answers come from seals, not scans

Type-level digest answers (`ComputeTypeDigestsAsync` and the windowed variants) compose sealed
epochs by XOR and fold **only the open window** live — O(open window), not O(store). Once sealed,
an epoch is **authoritative for answers**: re-verifying it per answer would re-buy the full-scan
cost the epochs exist to end. Detecting a bad seal is the sweep's job (below), and the regression
suite pins the semantics from both directions — a corrupted seal *must* flow into a
fully-covering answer, and must *not* leak into a partially-covering one (a seal is indivisible;
fringes fold live).

### Negotiated scope and the two-dimensional cursor

A windowed manifest exchange agrees on a **half-open sequence window `[since, until)`** — chosen
half-open so epoch boundaries align exactly and the answer's watermark (`ComputedThrough`, the
exclusive end actually covered, always capped at the origin's settled max) IS the next ask's
`since`. Stream-level answers additionally page by stream id (`MaxDigests` — the *asker's* memory
is the constraint — plus `ResumeAfterStreamId`); pages walk whole streams, and a non-null
returned cursor means the window is incomplete. A **quiet window still answers** (only an answer
can carry the watermark; silence would freeze the asker forever), and an engine that cannot
window falls back to the legacy full answer with **no watermark claimed**.

The consumer records its verified watermark per origin in `wh_integrity_seals` and advances it
only on a window that **provably** passed whole: every bucket matched, `ChunkCount == 1`, no
resume cursor. Chunks carry no assembly protocol, so a multi-chunk window still compares and
repairs — it just never certifies. The seal is GREATEST-monotonic (a replayed stale advance can
never re-open verified history), and steady-state audits ask windowed **from the seal**; the
sweep deliberately asks full history — it is trust-but-verify for exactly the state the seals
assume is fine, and a windowed sweep would be circular trust.

### Deficit repairs; mismatch alarms {#deficit-repairs-mismatch-alarms}

Only a **deficit** (`localCount < originCount`) is repairable. Equal counts with differing folds
mean the consumer holds the same *number* of events with different *identity* — redelivery
re-ships what the origin has, dedup drops what the consumer already holds, the fold never moves,
and the repair loop can never converge (observed live as an unbounded redelivery storm). A local
*surplus* cannot be fixed by asking the origin for more, and local history is never auto-deleted
on a remote's say-so. Both still **alarm** (ledger + report + `reason` metric tag:
`deficit | identity_mismatch | local_extra`); neither mints a redelivery request, and the paced
drain never claims their ledger rows ([which rows the drain claims](#drain-claims-deficits-only)). A deficit found
comparing a *windowed* manifest is a deficit **in that window** — the repair request carries the
range, so the origin re-ships a slice, never a stream's whole history.

### The scheduled sweep and the seal backstop

The full sweep moves off the every-Nth-audit counter onto the temporal engine
(`FullSweepCron`, default `"0 3 * * *"`): the heaviest verification runs at a configured idle
hour, with the default minute replaced by a **stable per-service splay** (FNV-1a of the service
name — `string.GetHashCode` is randomized per process and would re-randomize the very collisions
the splay prevents). The counter stands down only once the schedule actually registered
(`IntegritySweepScheduleState.CronActive`); no engine, a disabled cron, or a registration failure
all leave `FullSweepEveryNthAudit` in charge — the sweep is never silently lost.

Each sweep also runs the **seal backstop** (`verify_digest_epochs`, bounded by
`MaxEpochVerificationsPerSweep`): every closed epoch recomputed from the store, compared
bucket-for-bucket, refolded on drift. Non-zero drift means an unaccounted write path touched
sealed history — logged as the alarm it is. Epochs holding an unsettled arrival are skipped
whole, exactly like closure.

### Origin generation — seals survive legitimate mutation {#origin-generation}

A close-the-books truncation or a reclassification **legitimately changes** what a fold over
sealed history computes. The two mutation sites (migration 093) now refold the affected sealed
epochs **inline** — the origin's own answers are correct immediately, not next sweep — and bump
the **origin generation** (`integrity_origin_generation`), which rides every manifest. The
consumer-side guard (`integrity_seal_generation_guard`) is one atomic call: an unchanged
generation proceeds; a changed one **resets the seal once**, records the new generation, and
skips that comparison round (its windows were aligned to the old world) — the next audit
re-verifies from the beginning, cheaply, because the origin answers from epochs. Sealed-range
divergence *without* a generation change remains what it always was: damage.

---

## Standards compliance (definition of done)

- **AOT / zero reflection.** Type sets, consumed-type derivations, and digest scopes come from the
  generated message-type catalog and the fingerprint registries — no runtime reflection anywhere.
  Digest arithmetic is SQL + plain code; new metadata rides existing generated carriers.
- **Strict TDD (red → green).** Every increment starts with a failing test failing for the right
  reason — including the SQL (digest add/remove/recompute parity) and the reconciler diffs.
- **True multi-service integration tests.** The multi-service harness (in-memory wire transport,
  per-service catalogs) is the proving ground: *inject a drop* at one consumer (the harness can
  suppress delivery of selected inner events), then assert detection (checkpoint gap; digest
  mismatch naming the exact stream) and repair (re-delivery → conflict-skip on the healthy
  consumer, inversion-rewind convergence on the damaged one, byte-equal read models afterward).
  Postgres integration covers the emit-chain digest maintenance, deletion subtraction, and the
  recompute self-verification. Multi-tenant isolation gets its own regression locks; the
  expected-vs-unexpected discriminator's lock rides its future implementation (the discriminator
  is not yet built as of a64ba9a).
- **Docs.** This proposal graduates alongside the implementation: behavior + configuration
  reference for `StreamIntegrityOptions`, the integrity event types, the health signal (planned —
  no integrity health source is registered as of a64ba9a), and an
  operations note (reading a mismatch report, running a manual audit, invoking re-delivery).
  Code↔docs↔tests linking per the standard: `<docs>` tags on all new public surface, `<tests>`
  tags where convention needs help, maps regenerated and link-validated.
- **Observability.** Meters: checkpoint gaps detected/confirmed, digest mismatches by class
  (expected/unexpected), events re-delivered, repairs deferred by caps, audit duration, digest
  self-verification drift. A health source that degrades on confirmed-unrepaired divergence is
  planned — not yet registered as of a64ba9a.

## Implementation status

**Every phase is implemented, shipped, and live-validated** on a real multi-service deployment:
continuity checkpoints ride the origin's own event topics with session keys, the incremental
digest table feeds the hierarchical manifest exchange, local coverage gaps rebuild under storm
caps, and repairs converge idempotently. The increments below are kept as the build record —
each amendment callout marks where live validation refined the original sketch.

### Build record

1. **R1** — re-delivery primitive + request command + convergence integration test (drop-injection
   harness scenario end-to-end). Independently valuable on day one.

   :::new
   **R1 is built** (with its R0 prerequisite), in four steps:

   - **R0 — directed messages.** `IMessageEnvelope.Target` (wire key `tgt`, omitted when null =
     broadcast); the transport consumer discards a foreign-targeted message at the receive seam
     (ordinal match against the service's own identity, fail-open when identity is unknown).
   - **R1a — selection.** `RedeliveryRequest`/`RedeliveryEvent` + the coordinator's
     `SelectRedeliveryEventsAsync` (EFCore Postgres, raw SQL, no migration): conjunctive optional
     filters (tenant, event types, streams, commit-sequence window), ordered `(stream, version)`,
     hard `MaxEvents` cap; at-most-once occurrences excluded by delivery guarantee, reaped
     ephemeral bodies excluded structurally by the body join.
   - **R1a2 — identity-preserving composites.** Composite fan-out ordinarily mints fresh child ids;
     `IIdentityPreservingComposite` lets `RedeliveryComposite` stamp the ORIGINAL event ids onto
     its children (strict pairing — a count mismatch dead-letters the bundle). `RedeliveryPump`
     bundles a selection per stream (chunked), rehydrates payloads through the event store's AOT
     path, and publishes wire-only through the envelope-serializer seam with `Target` set.
   - **R1b — the request command.** `RequestRedeliveryCommand` (framework command; auto
     wire-registered) rides directed messaging: the requester stamps `Target` = origin service and
     names itself as `RequesterService` + the reply `Topic`. The origin's built-in receptor
     (driver assembly, runtime-registered) runs the selection and pumps targeted bundles back.
     The origin clamps every request's `MaxEvents` by its configured
     `RedeliveryPumpOptions.MaxEventsPerRequest` — a requester can never raise an origin's cap.
     This command is also the OPERATOR surface: dispatch it in-process on the origin (or targeted
     from anywhere) to trigger a manual repair.
   - **R1c — the convergence proof.** The multi-service harness gained per-consumer delivery-fault
     injection (`SuppressDeliveries`); the flagship test drops deliveries at one consumer,
     re-delivers via a targeted bundle over the real JSON wire, and proves: the healthy consumer
     discards at the receive seam, the damaged consumer's fan-out yields children carrying the
     original event ids and original bodies — convergence is idempotent by identity. The proof
     surfaced and fixed two real defects: the envelope serializer dropped `Target` on conversion,
     and generated JSON contexts bound a composite's inner `IMessage` list to their own assembly's
     options (cross-assembly inner events serialized as empty objects) — now bound to the
     serializing options via cycle-safe lazy registry accessors.
   :::
2. **B** — per-type sequence stamping + checkpoint signal + consumer gap tracker (report-only), then
   the auto-repair hookup behind the ladder.

   :::new
   **Phase B is built** (per the amended windowed-count design above): re-delivery bundles carry
   original origin identity (B0); the origin publishes `IntegrityCheckpoint` windows through a
   multi-instance-safe watermark advance, empty windows included as the liveness beat (B1); the
   consumer verifies windowed receipt counts with two-cycle confirmation, reports
   `IntegrityGapDetected`, and — at `AutoRepairCapped` — sends the scoped, directed, wire-only
   `RequestRedeliveryCommand` back to the origin, storm-capped per checkpoint (B2–B4). Checkpoints
   and gap detection default ON; repair defaulted to `AutoRepairCapped` when this phase shipped. That
   default was later reverted: repair is `ReportOnly` by default, with `AutoRepairCapped` the opt-in
   (see **Default history** above).
   :::
3. **S** — reconciler consumption-set diff + birth lineage + startup backfill orchestration.

   :::new
   **Phase S is built**: the state-only envelope marker (`sto`) with its dispatch-seam gate (S0);
   the consumed-type registry `wh_consumed_types` with Baseline/Pending/Requested lifecycle (S1);
   and the startup `SubscriptionExpansionWorker` — first boot baselines, later-boot additions
   register Pending and repair via one broadcast state-only re-delivery request, with disabled
   mode recording Pending as the audit surface (S2/S3). On by default.
   :::
4. **A1a** — digest table + emit-chain batch maintenance + deletion subtraction + recompute
   self-verification (SQL-first, both Postgres providers).

   :::updated
   **As built (two passes).** Digest algebra: **two-lane 64-bit XOR** of
   `hashtextextended(event_id, seed)` with seeds 0 and 1 — 128-bit-equivalent collision
   resistance, order-independent, self-inverse (a deletion is subtracted by folding the same
   hashes again), pure SQL. Ephemeral (mode-excluded) and at-most-once occurrences are excluded,
   matching Phase B's counts. The first pass shipped digests as COMPUTED on demand (one indexed
   `GROUP BY` at audit time); a scalability review then landed the proposal's original incremental
   design in full — see **A1c** below. The recompute survives as the sweep/verification path.
   :::
5. **A1b** — manifest exchange + comparison protocol (watermarks, two-cycle confirmation,
   catalog anchoring, floors) + drill-down + report pipeline.

   :::updated
   **As built: consumer-driven manifest exchange.** Each consumer's audit worker asks every origin
   it knows (the checkpoint tracker's origin set — an origin that never checkpoints is already a
   liveness alarm) for a manifest: a DIRECTED `RequestIntegrityManifest` command; the origin
   answers with `[Ephemeral]` `IntegrityManifest` events (digest rows, chunked) TARGETED back.
   The consumer compares against its own from-that-origin digests for subscribed types; a
   mismatched (tenant, type, stream) bucket raises `IntegrityDivergenceDetected` (Sourced report)
   and — on the `AutoRepairCapped` rung — a stream-scoped `RequestRedeliveryCommand`. Extras
   (consumer-only streams) are never auto-deleted (taxonomy #5), but they are NOT yet reported
   either: extra detection needs the full manifest set and rides a later increment — as of
   a64ba9a only origin-reported buckets are compared.
   :::

   **A1c** — the incremental digest table + hierarchical exchange (the scale story).

   :::new
   **Built as the proposal originally specified, after a scalability review of the computed-only
   pass.** Growth no longer grows the audit: cost scales with *what changed*, not store size.

   - **`wh_stream_digests`** — one row per (origin, tenant, event type, stream) bucket, PK on
     those four columns; the zero-uuid origin is this service's own lane, a non-zero origin is
     the local copy of events received FROM that origin. Maintained by the write paths
     themselves: both emit-chain functions gain a `digest_folds` CTE (joined to the stored-events
     CTE so idempotent re-stores never double-fold); `wh_truncate_stream_prefix` and
     `reclassify_events_ephemeral` XOR the rows they remove back out — and these two are provably
     the ONLY deletion paths touching audited buckets, because the reaper and pointer-prune act
     exclusively on ephemeral rows, which the mode exclusion keeps out of digests entirely. An
     idempotent backfill seeds buckets from existing history; a ledger replay never clobbers
     maintained values.
   - **Origin identity, live.** The inbox emit chain now stamps
     `wh_event_store.origin_service_id / origin_commit_sequence` from the transport-delivered
     source columns (normalized: a self/zero source is locally-originated and stays NULL). The
     columns' contract predates this proposal but no writer ever populated them — without this
     stamp, every consumer-side origin-keyed comparison (checkpoint counts, consumer digests)
     was inert in production.
   - **Hierarchical exchange.** Scheduled audits request **type-level roll-ups** first (XOR of a
     type's stream buckets — valid because they partition the type's events): O(types) wire cost,
     one comparison proving every stream bucket of the type complete. Mismatched types drill down
     (capped, `MaxDrillDownTypesPerAudit`) to a directed stream-level exchange; only divergent
     buckets ever pay stream-level cost. Table-driven compares **settle-skip** buckets whose
     `updated_at` is inside the settle window on either side — the incremental equivalent of the
     recompute's created-at filter.
   - **Trust-but-verify sweep.** Every `FullSweepEveryNthAudit`-th cycle (default 7 — weekly at
     the daily default), each service reconciles its own table against a full recompute and
     HEALS it (drifted buckets updated, phantoms removed, missing added; non-zero drift is a loud
     alarm — an unaccounted write path), and the manifest exchange runs recompute-to-recompute
     end to end, covering busy buckets that settle-skip on table-driven cycles. Providers without
     the digest table transparently fall back to the recompute.
   :::
6. **L** — local coverage audit + targeted rebuild remediation.

   :::new
   **Phases A and L are built** (per the amendments above): computed two-lane XOR digests, the
   consumer-driven manifest exchange with per-bucket comparison and stream-scoped capped repair,
   and the local coverage audit with capped local rebuilds — all ON by default, daily, ladder at
   `AutoRepairCapped` when these phases shipped (since reverted: `ReportOnly` is the default and
   `AutoRepairCapped` the opt-in, see **Default history** above). With
   R0–R1, B, and S, **every phase of this proposal is implemented**; the
   `ReportOnly` reports double as the dry-run for `AutoRepairCapped`. Graduation of this proposal
   into the behavior/configuration reference rides this PR's merge.
   :::
7. **Ladder completion** — AutoRepairCapped mode, dry-run, storm caps, operations doc.

   :::new
   **Closed**: `AutoRepairCapped` is implemented at every repair site (checkpoint gaps, audit
   divergences, local rebuilds); `ReportOnly` IS the dry-run (every report carries exactly what
   auto-repair would have done); storm caps exist at every rung, in both the per-batch and the
   per-bucket dimension.
   :::

8. **Bounded reconciliation** — epochs, negotiated scope, seals, deficit exchange, scheduled
   sweep, origin generation (the [proposal](/proposals/bounded-integrity-reconciliation),
   motivated by a live deployment whose audits paid a year's history to find nothing wrong).

   :::new
   **Built end to end** (see the *Bounded reconciliation* section above), in six increments:
   the epoch substrate + closure/refold primitives (migration 092, closure on the maintenance
   cadence); epoch-served type answers (sealed-epoch authority, sabotage-tested both
   directions); the negotiated half-open window + two-dimensional resume cursor (origin
   honoring, watermark on every chunk, quiet-window answers); the deficit/alarm taxonomy +
   range-bounded repair (only a deficit can converge under redelivery — the equal-count
   identity mismatch that stormed live now alarms instead of looping); the consumer seal store
   + windowed asking end to end (GREATEST-monotonic seals, single-chunk certification rule);
   the idle-time cron sweep with stable per-service splay + counter fallback, carrying the
   `verify_digest_epochs` seal backstop; and origin generation (migration 093 — the two
   legitimate fold-mutation sites refold sealed epochs inline and bump the generation; the
   consumer guard resets its seal once per change instead of alarming on deliberate history).
   Implementation refined the design in three places worth naming: windows are half-open
   `[since, until)` so epoch boundaries align exactly and the watermark IS the next `since`; a
   receiver certifies only single-chunk windows (chunks carry no assembly protocol, so seeing
   ALL of a window must be provable, not assumed); and mutation sites refold inline rather than
   waiting for the sweep, so an origin never serves stale seals between a close and 3 AM.
   :::

## The origin stamp {#origin-stamp}

Every check on this page attributes a received event to the service that produced it. The producer's
outbox stamps each wire envelope with its service id (`sid`) and commit sequence (`sseq`); the consumer
copies both onto its inbox row, and the inbox emit chain writes them to the stored event as
`wh_event_store.origin_service_id` / `origin_commit_sequence`. A row whose source is empty, or is the
consumer's own id, is stored as **locally originated**: `origin_service_id` stays NULL, and checkpoints,
gap detection and the audit cannot see that traffic at all.

:::updated
**Received events were never stamped.** The typed receive contract the JSON generator emits for
`MessageEnvelope<T>` named only the id, payload, hops, target, state-only flag and priority. It did not
name `sid` or `sseq`, so every ordinary delivery lost the producer's identity at deserialization. The
consumer then stored the row under its own id and the event as locally originated. Only re-delivery
bundles carried an origin, because they set it from their own payload. The contract now carries the
origin pair, the causality pair (`cbid` / `cbseq`), the envelope version (`v`) and the dispatch
context (`dc`). The storage-form conversion and envelope reconstruction keep them too.
:::

**Wire compatibility holds in both directions.** The origin fields were already on the wire, written by
the outbox drain, so an older receiver skips them as unknown properties, exactly as it always has. A
newer receiver reading an older sender's envelope binds the missing fields to their unstamped
defaults (an empty `sid`, `sseq` 0, version 1, the v1 dispatch context). The row stays unstamped and
`origin_service_id` stays NULL, as before.

**The receive path watches for an unstamped stream.** When gap detection or the audit is enabled, the
consumer counts the events it receives with and without an origin. Once per five-minute window in
which any received event lacked one, it logs a warning naming how many. Control-plane traffic is
excluded, since it never carries an origin. The count is two interlocked increments per received event
and needs no query. The usual causes are a producer running a version from before the origin stamp, or
one whose outbox never resolved its service id; the producer logs the second case at startup.

### History received before origins were recorded {#pre-stamp-history}

{verified: RedeliveredOriginAdoptionSqlTests.Adopt_EventsStoredWithoutAnOrigin_TakeTheBundlesOriginAndSequencesAsync, RedeliveredOriginAdoptionSqlTests.Adopt_TheNextCheckpointCountsTheAdoptedEvents_InsteadOfAskingForThemAgainAsync, RedeliveredOriginAdoptionSqlTests.Adopt_AnEventWhoseFirstHopNamesThisService_IsRefusedAndStaysLocalAsync, RedeliveryReconcilerTests.Reconcile_EventsStoredWithoutTheirOrigin_AdoptTheOriginTheBundleCarriesAsync, RedeliveryReconcilerTests.Reconcile_EventsWhoseFirstHopNamesAnotherService_AreCountedAndLoggedOnceAsync}

Migration 087 started writing `origin_service_id` and `origin_commit_sequence` on received events. Events a
service received before it ran 087 have both columns empty, and their digests sit in the local lane, the
lane this service advertises as its own. Origin-keyed verification therefore counts every one of them as
missing: the checkpoint count windows on the origin commit sequence, and the audit compares the origin's
digest lane, which holds none of them.

Only the origin knows those sequences, so the receiver cannot backfill them from its own store. The
redelivery that verification asks for is the source. When a redelivery bundle has committed, the receiver
reconciles it with the events it already holds (`RedeliveryReconciler`, backed by
`wh_reconcile_redelivered_bundle_by_first_hop`, migration 253, which extends 249's `wh_adopt_redelivered_origin`
and also reports the [children the store refused to restore](#remembered-but-missing)).
For each event already stored:

- an empty origin takes the bundle's origin, and an empty origin commit sequence takes the event's
  sequence from the bundle. A recorded origin or sequence is never overwritten, an event recorded under
  another origin is never re-attributed, and a bundle naming this service (or no service) adopts nothing;
- an empty origin is filled only on an event the origin authored: the receiver reads the stored event's
  hops and adopts only when the first hop names the bundle's origin service (see
  [events this service authored](#pre-stamp-history-first-hop) below);
- an event that leaves the local lane takes its digest with it: its hash leaves the local bucket and joins
  the origin's, under the same predicates every digest fold uses, and a local bucket left empty is removed;
- the sealed [epochs](#epoch-seals-the-substrate) either lane holds over the moved events are refolded, and
  when a sealed epoch of the local lane changed, the [origin generation](#origin-generation) advances so
  this service's own consumers re-verify that history instead of alarming on it.

The next checkpoint then counts those events and the next audit finds the origin's digest, so the bucket
heals and its ledger row is deleted. Each piece of pre-087 history costs one redelivery, paced by the
[repair drain](#the-repair-decision-pipeline-as-wired), and then verifies like any other. The
`origins_adopted` counter rises while that happens and stops once the history has been redelivered once;
an Information line per bundle names the origin and how many of its events adopted it.

The reconcile is integrity work, so it runs on the maintainer's
[integrity delivery drain](#integrity-deliveries-are-queued), one bundle at a time, rather than on the inbox worker
that committed the bundle.

:::updated
**Reconciling a bundle reads only the digests it changes ([#2000](https://github.com/whizbang-lib/whizbang/issues/2000)).**
`wh_stream_digests` holds one row per lane, tenant, type and stream, and its only index was the primary key
`(origin_service_id, scope_tenant, event_type, stream_id)`. A read or delete that names a stream without its tenant
and type could use only the leading column, which matches a whole lane. The reconcile did exactly that when it moved
digests out of the local lane: once per bundle, it read every bucket of this service's local lane, about half the
table on a mature store. During the catch-up that fills in origins on this history, every consumer receives a steady
stream of bundles, and that per-bundle read of the whole local lane held a shared database server's CPU at its
ceiling.

Migration 301 adds `idx_stream_digests_stream` on `(stream_id)`, so every stream-keyed digest read and delete (stream
close, prefix truncation, supersession, fan-out filing and the reconcile) is an index lookup. `stream_id` never changes
after insert, so the per-event digest updates stay heap-only and pay nothing for the index. The reconcile also names
the streams the bundle moved when it subtracts from and deletes emptied local buckets, so the delete matches the full
key and touches only the buckets the bundle changed.
:::

#### Events this service authored {#pre-stamp-history-first-hop}

{verified: RedeliveredOriginAdoptionSqlTests.Adopt_AnEventWhoseFirstHopNamesTheBundlesOrigin_AdoptsAsync, RedeliveredOriginAdoptionSqlTests.Adopt_AnEventWhoseFirstHopNamesThisService_IsRefusedAndStaysLocalAsync, RedeliveredOriginAdoptionSqlTests.Adopt_AFirstHopWithoutAServiceIdentity_AdoptsAsync, RedeliveredOriginAdoptionSqlTests.Adopt_EmptyHops_AdoptsAsync, RedeliveredOriginAdoptionSqlTests.Adopt_AnEventAlreadyCarryingAnOrigin_IsUntouchedWhateverItsFirstHopNamesAsync, InboxDispatchWorkerCompositeCommitTests.Redelivery_IsReconciledUnderTheServiceNameOfTheBundlesFirstHopAsync, RedeliveredOriginAdoptionSqlTests.Adopt_WithoutTheOriginsName_AdoptsAsBeforeAsync, RedeliveredOriginAdoptionSqlTests.Adopt_ABlankOrUnknownOriginName_AdoptsAsBeforeAsync, RedeliveredOriginAdoptionSqlTests.Adopt_ServiceNamesCompareWithoutCase_AndAnotherServiceInAnyCaseIsRefusedAsync, RedeliveredOriginAdoptionSqlTests.Adopt_TheLegacyLongFormHop_IsReadAndComparedWithoutCaseAsync, RedeliveryReconcilerTests.OriginServiceNameOf_NoHops_IsNullAsync, RedeliveryReconcilerTests.OriginServiceNameOf_AFirstHopWithABlankServiceName_IsNullAsync, RedeliveryReconcilerTests.OriginServiceNameOf_TheUnknownSentinelInAnyCase_IsNullAsync}

Empty origin columns cannot tell an event received before origins were recorded from an event this service
authored: both have none. That matters when the exchange ran both ways before 087. The origin's own store
then holds events it received from this service, filed in its local lane as if it had written them, and its
redelivery names itself as their origin. Adopting that origin would stamp it on events this service wrote.
Nothing is lost if that happens, but the origin then alarms on a surplus it can never repair.

So before an empty origin is filled, the receiver reads the stored event's hops (the `Hops` of
`wh_event_body.metadata`) and compares the first hop's service with the bundle's origin service, the service
on the bundle's own publish hop (`RedeliveryReconciler.OriginServiceNameOf`).

| The stored event's first hop | Result |
| --- | --- |
| Names the bundle's origin service, in any case (`OrdersService` matches `ordersservice`) | Adopts the origin, as above. |
| Names another service (this one, or a third), in any case | Refused: the event keeps its empty origin, its digest stays in the local lane, and it is counted as refused. |
| Carries no service identity (the [slim stored form](../messaging/message-envelopes#stored-form) leaves it out, or it names `Unknown`) | Adopts, so that history still converges. |
| No hops, or no stored body | Adopts, for the same reason. |
| The bundle names no service (its envelope has no hop, a blank name, or `Unknown` in any case) | Adopts: there is nothing to compare. |

**Names compare without case.** The transport consumer already compares service names that way, and one
service's name can be configured with different casing on different hosts. A difference in case must not turn
the origin into another service and leave its history refused.

**A bundle that names no service adopts.** With no name there is nothing to compare, and refusing would leave
history received before origins were recorded counted as missing and requested forever, which is the loop this
reconciliation exists to end. A stored first hop without a service identity adopts for the same reason.

An event that already carries an origin is not checked. Its recorded origin already says where it came
from, and the rules above apply to it unchanged.

The check reads one body row per present event whose origin is empty, by primary key. Those events exist only
until the history from before 087 has been redelivered once, so the read happens during that one-time
catch-up and not afterwards.

A refusal is reported once per bundle: a Warning names the origin, its service name and how many of the
bundle's events were refused, and the `origins_refused` counter adds them. A bundle whose present events were
all refused or already stored under their origin also changes nothing, so its buckets are
[marked as ones repair cannot change](#unhealable-buckets) and are not requested again.

```mermaid{caption="A redelivery bundle at the receiver: missing events are stored or restored, history without an origin adopts it, and each refusal or a bundle that changes nothing ends the asking." tests=["RedeliveredOriginAdoptionSqlTests.Adopt_EventsStoredWithoutAnOrigin_TakeTheBundlesOriginAndSequencesAsync", "RedeliveredOriginAdoptionSqlTests.Adopt_AnEventWhoseFirstHopNamesThisService_IsRefusedAndStaysLocalAsync", "RedeliveredMissingEventRestoreSqlTests.ARepairedEvent_DeduplicationRemembers_TheStoreLost_IsRestored_AndTheBucketHealsAsync", "RedeliveredMissingEventRestoreSqlTests.ARepairedEvent_OnAStreamWhoseEarlierHistoryWasTruncated_IsRefused_AndReportedAsync", "RedeliveryReconcilerTests.Reconcile_EveryEventAlreadyPresentAndNothingAdopted_MarksTheBucketUnhealableOnceAsync", "RedeliveryReconcilerTests.Reconcile_EveryPresentEventRefused_MarksTheBucketUnhealable_AndReportsTheRefusalAsync", "RedeliveryReconcilerTests.Reconcile_ARestoreTheStoreRefused_MarksTheBucketUnhealableOnce_NamingTheReasonAsync", "InboxDispatchWorkerCompositeCommitTests.Redelivery_OnceCommitted_IsReconciledWithTheEventsTheStoreAlreadyHoldsAsync"]}
flowchart TD
  A[Verification counts a bucket short] --> B[Repair asks the origin]
  B --> C[Redelivery bundle commits at the receiver]
  C --> D{Child already in the event store?}
  D -- no, its id is new --> E[The bundle stores it]
  D -- no, but deduplication remembers it --> T{Stream's earlier history truncated here?}
  T -- no --> R[Stored again, state only]
  T -- yes --> X[Refused as truncated: stored settled with the reason]
  D -- yes --> F{Empty origin or sequence?}
  F -- yes --> J{First hop names the origin, or no service?}
  J -- yes --> G[Adopts the bundle's origin; digest moves to the origin's lane]
  J -- no --> K[Refused as a foreign origin: stays local; counted and reported once]
  F -- no --> U[Nothing to change]
  E --> H[Next check counts them; the bucket heals]
  R --> H
  G --> H
  X --> I[Bucket marked unhealable; reported once; never asked for again]
  U -- every child --> I
  K -- nothing adopted --> I
```

A redelivered event the receiver already holds still never reaches the inbox emit chain: the inbox
deduplication or the chain's "already stored" test skips it, as before. The reconciliation runs beside the
bundle's commit, not inside the store path, so live delivery pays nothing for it.

### Events deduplication remembers but the store lost {#remembered-but-missing}

{verified: RedeliveredMissingEventRestoreSqlTests.ARepairedEvent_DeduplicationRemembers_TheStoreLost_IsRestored_AndTheBucketHealsAsync, RedeliveredMissingEventRestoreSqlTests.ADuplicateOfAStoredEvent_IsStillDropped_EvenAsRepairTrafficAsync, RedeliveredMissingEventRestoreSqlTests.ARepairedEvent_OnAStreamWhoseEarlierHistoryWasTruncated_IsRefused_AndReportedAsync, RedeliveryReconcilerTests.Reconcile_ARestoreTheStoreRefused_MarksTheBucketUnhealableOnce_NamingTheReasonAsync, RedeliveredMissingEventRestoreSqlTests.ARestoredEvent_IsStoredStateOnly_SoTriggerReceptorsThatRanOnItsFirstArrivalDoNotRunAgainAsync, InboxDispatchWorkerCoverageTests.StateOnlyDelivery_IsStored_ButRunsNoTriggerReceptorAsync, InboxDispatchWorkerCoverageTests.OrdinaryDelivery_RunsItsTriggerReceptorsAsync}

Inbox deduplication (`wh_message_deduplication`) records a message id when the message is received. The
event-store row can be lost afterwards: a fan-out that failed or rolled back in an older version, manual
cleanup, or an event store restored from an older backup while the deduplication table survived. Verification
then counts the bucket short and repair asks the origin to redeliver, but deduplication alone would drop every
redelivered copy, the bundle would store nothing, and the bucket would be asked for again on the terminal
cadence forever.

For repair traffic, deduplication is checked against the event store instead of being trusted alone
(migration 252). The children of a redelivery bundle carry `InboxMessage.RestoreIfMissing`, and
`store_inbox_messages` applies these rules to each one:

| The child's id is | The store holds it | The inbox holds it | Outcome |
|---|---|---|---|
| new | n/a | n/a | Stored, as for any arrival |
| remembered | yes | n/a | Dropped as a duplicate, as before |
| remembered | no | yes (still pending) | Left alone: the pending row stores it on its next claim |
| remembered | no | no | **Stored again, state only**, and the bucket heals once it is copied |
| remembered | no | no, and the stream's earlier history was truncated here | **Refused**: stored settled with the reason, reported once |

A restored event is stored **state only**: it is appended and projected, but trigger receptors (the PreInbox
and PostInbox stages) do not run. Deduplication remembers the message, so the reactions to it already had their
chance, and repair restores state without running a reaction twice. The caveat is a fan-out that rolled back
before its reactions ran: the event was lost before any reaction ran, and the restore does not run them either.
Repair restores state, not side effects; a reaction that must still happen is the application's to re-drive. Ephemeral and at-most-once events are never restored, because
verification never counts them and their absence is not a gap. Ordinary traffic, meaning anything that is
not a redelivery child, keeps relying on deduplication alone, so a live duplicate is still dropped.

One case is refused. [Truncating a stream prefix](../fundamentals/events/event-streams#truncating-a-stream-prefix)
keeps the truncated events' deduplication rows on purpose, so a redelivered copy is not stored again below the
truncation point, and a lost event cannot be told apart from a truncated one. When the stream's lowest stored
version is above 1, the child is stored already settled (processed, never claimed or copied) with
`repair refused: stream prefix truncated` in `wh_inbox_state.error`. The redelivery's reconciliation
(`wh_reconcile_redelivered_bundle_by_first_hop`, migration 253) counts it per bucket as
`RedeliveredBucketPresence.RefusedTruncated`, apart from the [first-hop refusals](#pre-stamp-history-first-hop)
(`RefusedForeignOrigin`), and the bucket
is marked as one [repair cannot change](#unhealable-buckets): one Warning names it and the truncation, and the
`repairs_unhealable` counter counts it once.

The [reconciliation diagram](#pre-stamp-history) shows where a restored or refused child sits beside origin
adoption.

The extra checks run only for a redelivery child whose id deduplication has already seen, by primary key and by
the stream's version index; live delivery evaluates one flag.

## The local lane follows ownership {#the-local-lane-follows-ownership}

{verified: OwnedNamespaceMatcherLocalLaneTests.IsLocalEventType_NoOwnedDomains_EveryTypeIsLocalAsync, OwnedNamespaceMatcherLocalLaneTests.IsLocalEventType_TypeInAnOwnedNamespace_IsLocalAsync, OwnedNamespaceMatcherLocalLaneTests.IsLocalEventType_TypeOutsideEveryOwnedNamespace_IsNotLocalAsync, IntegrityCheckpointOwnershipTests.RunCheckpointOnce_OwnedDomainsRegistered_CountsOnlyOwnedTypesAsync, IntegrityCheckpointOwnershipTests.RunCheckpointOnce_NoOwnedDomains_AnnouncesNoneAndKeepsEveryBucketAsync, IntegrityManifestReceptorTests.RequestReceptor_OwnedDomainsRegistered_AdvertisesOnlyOwnedTypesAsync, RedeliveryRequestReceptorTests.Receptor_ShipsOnlyEventsOfOwnedTypes_AndPagesPastTheRestAsync}

A service's **local lane** is the set of events it vouches for as their author: the events its checkpoints
count, its manifests advertise and its redelivery ships under its own identity. It used to be every stored
event with no origin recorded. A store that received other services' events before origins were recorded
holds those events with no origin too, so it advertised them as its own, consumers counted them as surplus,
it redelivered them under its own name, and every receiver refused them (the first hop names the real
author, see [events this service authored](#pre-stamp-history-first-hop)). Repair never converged,
because the side holding the misfiled copy was the side being asked.

The local lane now follows registered ownership. An event whose type's namespace is not in
`RoutingOptions.OwnedDomains` (the `OwnDomains(...)` declaration) is **never** local, whatever its origin
column says:

- **Checkpoints** count only owned types.
- **Manifest answers** advertise only owned types; a store that holds only other services' types answers
  nothing, as an origin with nothing to report does.
- **Redelivery** ships only owned types (see [redelivery ships only what the origin wrote](#redelivery-ships-only-what-the-origin-wrote)).

The namespace rule is the one routing already uses: a type is owned when its namespace equals an owned
domain or is a child of one (the domain followed by a `.`), compared without case. It is one shared helper,
`OwnedNamespaceMatcher`, used by the dispatcher, the receptor invoker, the transport consumer and stream
integrity alike, so the lane and routing can never disagree about who owns a type.

**A service with no owned domains registered keeps the earlier behavior exactly:** every stored event
without an origin is still its own.

### Ownership is exchanged on the checkpoint {#ownership-is-exchanged-on-the-checkpoint}

{verified: IntegrityCheckpointOwnershipTests.RunCheckpointOnce_OwnedDomainsRegistered_AnnouncesThemOnTheCheckpointAsync, IntegrityCheckpointWireSerializationTests.IntegrityCheckpoint_CarriesTheOriginsOwnedDomainsAsync, IntegrityCheckpointWireSerializationTests.IntegrityCheckpoint_FromAnOlderOriginWithoutOwnedDomains_ReadsAsEmptyAsync, IntegrityCheckpointReceptorTests.Checkpoint_RecordsTheOriginsAnnouncedDomainsAsync, IntegrityCheckpointReceptorTests.Checkpoint_AContestedDomain_WarnsAndCountsOncePerPairAsync, IntegrityCheckpointReceptorTests.Checkpoint_ABucketOfATypeAnotherServiceOwns_IsNotVerifiedAgainstThisOriginAsync, IntegrityManifestReceptorTests.ManifestReceptor_DigestsOfATypeAnotherServiceOwns_AreNotComparedAsync, IntegrityDomainClaimsSqlTests.Record_AnAnnouncementReplacesTheOwnersClaimSetAsync, IntegrityDomainClaimsSqlTests.Record_ADomainAnotherOwnerClaims_ComesBackAsAConflictAsync, IntegrityDomainOwnershipTests.FindOwner_ADomainTwoServicesClaim_UsesNeitherAsync, IntegrityDomainOwnershipTests.FindOwner_NestedDomainsClaimedByDifferentServices_TheMostSpecificWinsAsync}

Every service announces the domains it owns on the checkpoint it already sends each minute:
`IntegrityCheckpoint.OwnedDomains`, trimmed and without a trailing dot. The field is additive. A
checkpoint from an origin built before it reads as announcing no domains, and claims nothing.

Each consumer keeps what it hears as **domain claims** (`wh_integrity_domain_claims`, migration 325):

- An announcement **replaces** that origin's claim set. A domain it no longer announces is given up, and an
  empty list gives up all of them.
- Domains key without case. An announcement without a request topic keeps the request address already on
  record, so a restart does not lose where to reach an owner.
- Unchanged claims are not rewritten, so a checkpoint every minute per origin costs nothing on disk.

The claims form a domain to owner map. The owner of a stored event type is the claim of the **most
specific** domain containing its namespace. When **two owners claim one domain**, the consumer logs a
Warning naming both (once per pair and domain), counts it on `ownership_conflicts`, and uses **neither**
for that domain; a parent domain's claim does not stand in for it. The conflict lasts while both claims are
on record, so fix it by correcting one service's `OwnDomains` declaration.

The map is used for three things:

1. **Re-attribution** of the store's own pre-origin history to its author (see [re-attribution](#re-attribution)).
2. **Directing repair and backfill at the owner.** A consumer neither verifies a checkpoint bucket nor
   compares a manifest digest against an origin when another service owns the type: an older origin still
   advertising a type it received is not authoritative for it, and asking it for repair would only ship
   events every receiver refuses. A pending gap recorded before the owner was known is dropped once it is.
3. **Answering redelivery only for owned domains**, on the answering side, from the service's own
   declaration.

### One checkpoint copy per consumer {#one-checkpoint-copy-per-consumer}

{verified: IntegrityCheckpointOwnershipTests.RunCheckpointOnce_OwnedDomainsRegistered_RidesOnlyTheOwnedTypesTopicsAsync, IntegrityCheckpointOwnershipTests.RunCheckpointOnce_OwnedDomainsWithNoCatalogType_FallsBackToTheDispatcherAsync, IntegrityCheckpointWorkerBranchCoverageTests.RunCheckpointOnce_RoutingOptionsRegistered_PassesOwnedDomainsCaseInsensitivelyToTheStrategyAsync}

The checkpoint rides the origin's own event topics, one publish per distinct topic, because a
namespace-routed control topic is one no consumer subscribes to. The topic set used to be every type in the
window plus every type in the store's digest lane. Since that lane could include other services' types, a
consumer subscribed to many topics received one copy of the same checkpoint per topic, about 25 a minute,
each paying a broker delivery, deserialization and an inbox upsert before deduplication dropped it.

With owned domains registered, the topic set is the topics of the **catalog event types the service owns**,
read from the message-type catalog, not from a scan of the store. Under domain-topic routing that is one
topic per owned domain, so each consumer of an owned topic gets the liveness beat once per owned domain it
subscribes to. When no owned type resolves to a topic, the checkpoint still goes out through the dispatcher:
the beat is never dropped. With no owned domains registered, the topic set is unchanged.

### Redelivery ships only what the origin wrote {#redelivery-ships-only-what-the-origin-wrote}

{verified: SelectRedeliveryEventsTests.Select_AuthoredBy_ShipsOnlyEventsTheAnsweringServiceWroteAsync, SelectRedeliveryEventsTests.Select_WithoutAuthoredBy_KeepsTheEarlierSelectionAsync, RedeliveryRequestReceptorTests.Receptor_AsksTheSelectionForEventsThisServiceAuthoredAsync, RedeliveryRequestReceptorTests.Receptor_ARequestThisServiceMadeItself_IsIgnoredAsync, RedeliveryRequestReceptorTests.Receptor_ShipsOnlyEventsOfOwnedTypes_AndPagesPastTheRestAsync, SubscriptionExpansionTargetingTests.Backfill_TypesWithAKnownOwner_AreAskedOfThatOwnerOnlyAsync, SubscriptionExpansionTargetingTests.Backfill_TypesWithNoUsableOwner_FallBackToOneBroadcastAsync, SubscriptionExpansionTargetingTests.Backfill_MixedOwnership_DirectsTheOwnedTypesAndBroadcastsTheRestAsync, SubscriptionExpansionTargetingTests.Backfill_AnOwnerThatIsThisService_IsNotAskedAsync}

A redelivery bundle names the answering service as its origin, so it may carry only events that service
wrote. Three rules make that hold:

- **The selection filters by author.** `RedeliveryRequest.AuthoredBy` (set by the built-in receptor to its own
  service name) selects only events with **no origin recorded** whose stored first hop names the answering
  service, names no service (or the `Unknown` sentinel), or is absent. Names compare without case. An event
  received from another service, whether it carries that origin or only a first hop naming it, is no longer
  shipped; receivers refused it anyway. Without `AuthoredBy` the selection is unchanged.
- **Only owned types are shipped**, page by page; a page of other services' types still advances the keyset,
  so the owned events behind it are reached.
- **An origin never answers its own request.** The subscription-growth backfill on a shared topic reaches its
  sender too, and answering it re-shipped the sender's own store to itself. A request whose requester is this
  service (compared without case) is ignored and counted on `redelivery_requests_ignored` with
  `reason=own_request`.

**The backfill asks the owner.** When the consumed-type set grows, the backfill no longer broadcasts one
request every holder answers. Each new type whose owner is known from the domain claims, with a request
address, is asked of that owner alone: one directed state-only request per owner, on the owner's request
topic. Only the types with no usable owner (none known, an owner that announced no request address, or this
service itself) fall back to the single broadcast, which the rules above keep cheap: in practice only the
author answers.

### Re-attribution {#re-attribution}

{verified: OriginReattributionWorkerTests.Pass_HandsNonOwnedTypesToTheStoreWithTheirOwner_AndUnclaimedOnesAsUnattributedAsync, OriginReattributionWorkerTests.Pass_RunsBatchesUntilTheWalkCatchesUpAsync, OriginReattributionWorkerTests.Pass_StopsAtTheBatchesPerPassCapAsync, OriginReattributionWorkerTests.Pass_WithNoOwnedDomains_LeavesTheStoreAsItWasAsync, OriginReattributionWorkerTests.Pass_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_DoesNothingAsync, OriginReattributionWorkerTests.Pass_OnABusyService_WaitsUntilMaxDeferral_ThenIsForcedThroughAsync, OriginReattributionSqlTests.Window_IsTheNextBatchByCommitSequence_WithTheTypesThatHaveNoOriginAsync, OriginReattributionSqlTests.Window_WithAChangedFingerprint_RewalksFromTheStartAsync, OriginReattributionSqlTests.Reattribute_ARowAnotherServiceOwns_TakesTheOwnerAsOrigin_AndItsDigestMovesLanesAsync, OriginReattributionSqlTests.Reattribute_AFirstHopNamingAThirdService_IsLeftAndCountedAsync, OriginReattributionSqlTests.Reattribute_ATypeWithNoKnownOwner_IsCountedAsUnattributedAndLeftAsync, OriginReattributionSqlTests.Reattribute_ReArmsTheOwnersLedgerBucketsTheRowsLandIn_AndNoOthersAsync, OriginReattributionSqlTests.Reattribute_IntoASealedLocalEpoch_RefoldsIt_AndAdvancesTheOriginGenerationAsync, OriginReattributionSqlTests.Reattribute_FromAStaleCursor_MovesNothingAndReportsNotAdvancedAsync, OriginReattributionWorkerLoopTests.ExecuteAsync_WhenAPassThrows_KeepsRunningPassesAsync, OriginReattributionWorkerLoopTests.ExecuteAsync_WhenDisabled_ParksWithoutWalkingAsync}

Following ownership stops a store from vouching for other services' history, but the misfiled events are
still in its local digest lane, and consumers' deficits for them still point at the wrong service.
Re-attribution fixes the store's own bookkeeping: it gives each such event its real author as origin. It
changes no event content.

**Where and when.** `OriginReattributionWorker` runs on the instance holding the maintainer duty, under the
housekeeping idle gate like the rest of integrity work (see [the idle gate](#integrity-idle-gate)): it waits
while the service is busy and is forced through after `Whizbang:Housekeeping:MaxDeferral`. A pass runs every
`ReattributionIntervalSeconds`, at most `MaxReattributionBatchesPerPass` batches of `ReattributionBatchSize`
rows. It runs only when the service registered owned domains; with none, it does nothing.

**The walk.** Each batch is the next rows after a durable cursor in commit-sequence order, a bounded range
scan on the commit-sequence index, never a scan of the whole store. The batch's event types that carry no
origin and are not owned here go to the store with their owner from the domain claims. The cursor moves by
compare-and-swap, so a batch overtaken by another pass is discarded whole, and the walk resumes where it
left off after a restart. When the claims map or this service's owned domains change (the **ownership
fingerprint**), the walk starts again from the beginning, so history left unattributed reaches an owner
learned later.

**What each row gets.** For a row with no origin whose type another service owns:

| The row | What happens | Counted on |
| --- | --- | --- |
| The owner is known, and the stored first hop names the owner, names no service, or is absent | The row takes the owner as its origin (the origin's commit sequence stays empty; a later redelivery from the owner fills it, see [history received before origins were recorded](#pre-stamp-history)). Its digest leaves the local lane for the owner's lane, sealed local epochs over it are refolded (advancing the [origin generation](#origin-generation), so consumers re-verify instead of alarming), and the owner's repair-ledger buckets it lands in, per stream and the type lane, have their unhealable and exhausted marks cleared and their attempts and pending answer reset. | `origins_reattributed` |
| The owner is known, but the first hop names a third service | **Ownership is primary, the first hop only a cross-check:** the row is left as it was, and the batch logs a Warning with the count for an operator to inspect. | `reattribution_hop_disagreements` |
| No owner is known (or the domain is contested) | Left as it was, and out of the local lane logically because the lane follows ownership. Each such type is logged once. It moves when an owner announces the domain. | `origins_unattributed` |

Rows of types this service owns are never touched. An ephemeral or at-most-once row takes its owner as origin
without touching any digest, because it folds into none.

**Options.**

| Option | Default | Meaning |
| --- | --- | --- |
| `ReattributionEnabled` | `true` | Run re-attribution at all |
| `ReattributionIntervalSeconds` | `60` | Seconds between passes; at least 1 |
| `ReattributionBatchSize` | `5000` | Rows one batch scans; at least 1 |
| `MaxReattributionBatchesPerPass` | `20` | The most batches one pass runs; at least 1 |

All bound from `Whizbang:StreamIntegrity`; a bound below 1 fails at host start naming the key
{verified: StreamIntegrityOptionsValidatorTests.Validate_AReattributionBoundBelowOne_FailsNamingTheKeyAsync}.

## Observability

Everything the reconcile system does is visible on one meter: **`Whizbang.StreamIntegrity`**
(instrument names prefixed `whizbang.stream_integrity.`). The instruments follow three deliberate
patterns worth understanding before building a dashboard:

1. **Backlog is a gauge, not a counter.** A counter ("how many divergences have we ever noticed")
   only ever rises and says nothing about *now*. The backlog gauges read the ledger itself, and a
   heal **deletes** the ledger row — so the gauges fall on their own as repair works. Watch the
   gauge, alert on the counter's *rate* if you want arrival pressure.
2. **The collector rides the maintenance tick, on every instance.** Gauge values are read at the start of every
   maintenance tick (the same scope and cadence the reaper already uses) and swapped atomically into the meter's
   observation callback: no dedicated poller, no extra connections, no half-updated readings. The read runs ahead of
   the maintainer-duty check and the idle gate, so every instance reports the ledger even while the sweep itself is
   deferred or belongs to another instance. Before #2024 it rode the sweep, and an instance that was not the
   maintainer, or a busy service for up to `MaxDeferral` after a restart, reported 0 unhealed: the value of a fully
   healed service.
3. **Only natural measurements.** Every instrument measures work the system already does — a
   stopwatch around an existing handler, a counter at an existing branch, an age read back from a
   row a delete was already destroying. Nothing queries or stores anything *for the metric's sake*,
   so the meter can never become its own load problem.

### Integrity gauges {#integrity-gauges}

{verified: MaintenanceWorkerIntegrityGaugeTests.AnInstanceThatIsNotTheMaintainer_StillPublishesTheLedgerReadingAsync, MaintenanceWorkerIntegrityGaugeTests.ATickTheIdleGateDefers_StillPublishesTheLedgerReadingAsync, IntegrityRepairAnswerSqlTests.Summary_CountsBucketsAwaitingAnAnswer_AnsweredBuckets_AndTheIntegrityDeliveriesWaitingAsync, IntegrityRepairAnswerSqlTests.Summary_WithNoIntegrityDeliveries_ReportsNoneWaitingAsync, StreamIntegrityMetricsCoverageTests.AnswerAndDeliveryGauges_ReportLiveSnapshotValuesAsync}

Every gauge on the `Whizbang.StreamIntegrity` meter is read in one round trip at the start of every maintenance tick,
on every instance, ahead of the maintainer-duty check and the idle gate (see the collector, above). Every instance of a
service therefore reports the same ledger and the same delivery queue, so read these as one value per service (the
maximum across its instances), never a sum.

| Instrument | Meaning |
| --- | --- |
| `unhealed_buckets` | Divergent `(origin, tenant, type, stream)` buckets currently tracked by the ledger — **the reconciliation backlog**. Falls as buckets heal (the heal deletes the row). |
| `repair_exhausted_buckets` | Unhealed buckets that spent their repair budget (`MaxRepairAttemptsPerBucket`) and are no longer asked for until a local change or a grown deficit [resets them](#what-resets-the-repair-ladder). These need an operator, not patience: the one number worth an alert. Raising the budget does not lower it. |
| `oldest_unhealed_age_seconds` | Age of the longest-standing unhealed divergence. Distinguishes a transient blip from a stuck bucket. |
| `repair_answer_pending_buckets` | Buckets whose repair request is out and whose answer has not landed. They are not asked for again until the answer lands or `RepairAnswerTimeoutMinutes` passes ([repair waits for its answer](#repair-waits-for-its-answer)). A value that stays high for longer than the timeout means answers are not arriving: the origin is not serving requests (`ReportOnly`, or its own integrity queue is behind) or its bundles are not reaching this service. |
| `repair_answered_buckets` | Buckets a redelivery bundle answered that wait for the next comparison to decide healed or still divergent. Rises after a repair burst and falls at the next audit; a value that never falls means comparisons are not running for those buckets. |
| `deliveries_pending` | [Integrity deliveries](#integrity-deliveries-are-queued) recorded and waiting for the maintainer's drain: received checkpoints, manifest requests and chunks, redelivery requests and bundle reconciles. Near zero on a healthy service. |
| `oldest_delivery_age_seconds` | How long the oldest waiting integrity delivery has waited (0 when none). Under load the drain is deferred by the idle gate for up to `Whizbang:Housekeeping:MaxDeferral`, so an age above that, or one that keeps climbing, means the drain is not running: check which instance holds the maintainer duty. |
| `sealed_through` (tag `origin_service_id`) | The per-origin **verified watermark** — the exclusive end of the highest window that audited clean and complete. This is the top-level convergence needle: a lane is provably in sync exactly as far as its seal. Each origin is its own series; one aggregated number would hide a stuck lane. |

### Durations (histograms, seconds)

| Instrument | Measures | Why it matters |
| --- | --- | --- |
| `manifest_answer_duration` (tags `level`, `windowed`, `recompute`) | Origin side: receiving a manifest request → last answer chunk published. | Epoch-served answers should be **milliseconds**. A slow answer means the epochs are not serving and the fold fell back to scanning the store. |
| `manifest_compare_duration` (tag `level`) | Consumer side: receiving a manifest chunk → comparison finished (ledger batches and repair sends included). | **The pressure early-warning.** When p99 approaches the manifest arrival interval, chunks queue behind the compare gate — and a queued chunk holds its deserialized payload in memory. This is the observable form of the compare-slower-than-arrival failure that has OOM-killed fleets. |
| `redelivery_build_duration` | Origin side: one redelivery request's select-and-publish, end to end. | What each repair/backfill actually costs the origin. |
| `bucket_heal_seconds` | First sighting of a divergent bucket → its proven heal. | **Per-stream time-to-reconcile.** The age is read from the ledger row the heal's own `DELETE ... RETURNING` destroys — the clock was already there for the oldest-unhealed gauge. An empty reading means "not measured" (single-key fallback), never "instant". |

### Flow (counters)

| Instrument | Counts |
| --- | --- |
| `divergences_detected` (tags `origin`, `event_type`, `reason`) | Divergent buckets per comparison. `reason` carries the taxonomy: `deficit` (repairable), `identity_mismatch` / `local_extra` (alarm-only — see [the divergence taxonomy](#the-divergence-taxonomy)). |
| `repairs_requested` (tags `source`, `origin`) | Directed repair asks. `source=audit` is the per-stream path; `source=bulk` is the threshold-triggered whole-window state-only backfill. |
| `repairs_deferred` (tags `origin`, `reason`) | Deficit buckets a comparison deferred instead of adding to the paced repair drain's ledger: `per_audit_cap` (the comparison already added `MaxAutoRepairRequestsPerAudit`) or `backlog_cap` (the ledger holds `MaxRepairDrainBacklog` rows). Sustained growth means discovery outpaces the drain; raise `RepairDrainRatePerSecond` or accept the pace. See [repair caps](#repair-caps). |
| `compares_declined` (tag `origin`) | Manifest chunks declined at the non-queueing compare gate. Sustained growth = comparisons losing to arrivals; read alongside `manifest_compare_duration`. |
| `manifest_pages_followed` / `manifest_pages_capped` (tag `origin`) | Windowed stream pages walked via the resume cursor, and follow chains stopped at `MaxManifestPagesPerAudit`. Persistent capping means lanes are wider than the per-audit page budget — raise the cap or accept the pace. |
| `redelivery_events_shipped` | Events selected and shipped in redelivery bundles, as an origin. |
| `origins_adopted` | Stored events whose empty origin columns a redelivery filled: [history received before origins were recorded](#pre-stamp-history), now verifiable. Rises while that history is redelivered once, then stops. |
| `origins_refused` | Stored events with an empty origin that a redelivery did not adopt, because the event's first hop names another service than the bundle's origin: [events this service authored](#pre-stamp-history-first-hop) that the origin's store had filed as its own. Non-zero means an origin is redelivering events it did not author; the Warning logged once per bundle names it. |
| `ownership_conflicts` (tag `domain`) | Domains two services claim on their checkpoints, once per contesting pair and domain; neither claimant is used. Non-zero means two services' `OwnDomains` declarations overlap. See [ownership is exchanged on the checkpoint](#ownership-is-exchanged-on-the-checkpoint). |
| `redelivery_requests_ignored` (tag `reason`) | Redelivery requests an origin declined to answer: `own_request` (its own backfill broadcast came back to it). |
| `origins_reattributed` | Stored events received before origins were recorded that [re-attribution](#re-attribution) gave their owner as origin. Rises while the walk covers that history, then stops. |
| `origins_unattributed` | Stored events of a type this service does not own whose owner is not known. They move once an owner announces the domain. |
| `reattribution_hop_disagreements` | Stored events re-attribution left because their first hop names a service other than the owner of their type. |
| `deliveries_queued` (tag `type`) | Integrity deliveries recorded for the maintainer's drain. A copy already recorded is not counted again. See [integrity work runs on the maintainer](#integrity-work-runs-on-the-maintainer). |
| `deliveries_processed` (tag `type`) | Integrity deliveries the drain handled. Falling behind `deliveries_queued` for long means the drain is deferred by the idle gate or bounded by `MaxIntegrityDeliveriesPerPass`. |
| `deliveries_failed` (tag `type`) | Failed attempts at an integrity delivery, each retried after a backoff. |
| `deliveries_dropped` (tags `type`, `reason`) | Integrity deliveries dropped: `attempts_exhausted` (spent `MaxIntegrityDeliveryAttempts`) or `no_handler` (no handler for the type on this instance, such as a delivery recorded by another version). Each drop is also a Warning naming the type. |
| `repairs_unhealable` | Buckets a redelivery could not change (every event already stored under its origin, or a child [refused as truncated](#remembered-but-missing)), counted once each. Repair stops asking for them; see [repair that cannot change a bucket](#unhealable-buckets). |
| `manifests_requested`, `manifest_chunks_sent`, `drill_downs_requested`, `backfills_requested`, `redelivery_requests_received` | The exchange itself, hop by hop. |
| `checkpoints_published` / `checkpoints_received`, `gaps_detected`, `coverage_gaps_detected`, `rebuilds_requested` | The continuity-checkpoint and coverage halves of the system. |
| `digest_buckets_verified`, `digest_drift_healed` (tag `kind`) | The trust-but-verify sweep: buckets checked, and drift it healed (an unaccounted write path — investigate `kind`). |

### Reading a recovery

A deficient service converging looks like: `repairs_requested` active → `redelivery_events_shipped`
climbing at the origin → `unhealed_buckets` falling (heals deleting rows) with `bucket_heal_seconds`
recording each one → `sealed_through` stepping upward as whole windows certify → everything quiet
except the checkpoint heartbeat. After an upgrade from a schema older than 087, `origins_adopted` rises first while
pre-087 history is redelivered once. While repair works, `repair_answer_pending_buckets` rises with each paced batch and
turns into `repair_answered_buckets` as bundles land, and both fall at the next audit. The failure signatures:
`repair_exhausted_buckets` rising (buckets out of budget), `repair_answer_pending_buckets` held high past
`RepairAnswerTimeoutMinutes` (answers not arriving), `oldest_delivery_age_seconds` climbing past `MaxDeferral` (the
maintainer's integrity drain not running), `compares_declined` sustained (compare pressure), `manifest_pages_capped` persistent
(page budget too small for the lane), `deliveries_dropped` non-zero (integrity deliveries that kept failing; each
Warning names the type and error), `repairs_unhealable` non-zero (buckets repair cannot change; each was named
once in a Warning), or `sealed_through` frozen while `unhealed_buckets` is flat
and non-zero (a stuck lane).

## Future work

- **Persist the origin set?** The checkpoint origin tracker is deliberately in-memory (a restart
  re-baselines), so after a fleet-wide deploy the FIRST audit usually runs only its local half —
  the cross-service exchange starts on the next cycle, once checkpoints have re-announced the
  origins. Persisting the origin set (a small table) would let the first audit exchange
  immediately, trading a startup-freshness guarantee for it.

### Original review questions

1. Digest width: 64-bit XOR is cheapest; 128-bit additive is safer against accidental collision at
   large scale. Default 128?
2. Checkpoint carrier: dedicated signal type on the signal bus (doorbell + fetch) vs. a small
   normal event per (tenant, type) — leaning signal-bus doorbell with a fetchable checkpoint table.
3. ~~Should Phase B sequences live in envelope metadata or as a store column?~~ **Resolved by the
   emit-chain spike:** neither — Phase B introduces no new sequence. The existing
   `SourceCommitSequence` (wire) / `origin_commit_sequence` (store) carry per-event origin order,
   and checkpoints verify per-(tenant, type) COUNTS over commit-sequence windows (see the Phase B
   amendment above).
4. Cross-origin fan-in: a consumer aggregating N origins runs N independent comparisons — any value
   in a combined report beyond per-origin rows?
5. Does the digest table participate in debug mode (retain per-operation digest journal) or stay
   current-state-only?
