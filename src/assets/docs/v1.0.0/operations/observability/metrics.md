---
title: Metrics Reference
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Observability
order: 6
description: >-
  Complete reference for all built-in OpenTelemetry metrics emitted by Whizbang -
  counters, histograms, and gauges across dispatcher, lifecycle, transport,
  perspective, work coordinator, and lifecycle coordinator subsystems
tags: 'metrics, opentelemetry, counters, histograms, monitoring, Prometheus, Grafana'
codeReferences:
  - src/Whizbang.Core/Observability/WhizbangMetrics.cs
  - src/Whizbang.Core/Observability/DispatcherMetrics.cs
  - src/Whizbang.Core/Observability/LifecycleMetrics.cs
  - src/Whizbang.Core/Observability/LifecycleCoordinatorMetrics.cs
  - src/Whizbang.Core/Observability/TransportMetrics.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
  - src/Whizbang.Core/Observability/WorkCoordinatorMetrics.cs
  - src/Whizbang.Core/Observability/InboxMetrics.cs
  - src/Whizbang.Core/Observability/DeadLetterMetrics.cs
  - src/Whizbang.Core/Observability/EventCategoryMetrics.cs
  - src/Whizbang.Core/Observability/PinnedPoolMetrics.cs
  - src/Whizbang.Core/Observability/TableStatisticsMetrics.cs
  - src/Whizbang.Core/Observability/TypeRegistryMetrics.cs
  - src/Whizbang.Core/Workers/TransportDeadLetterDrainWorker.cs
  - src/Whizbang.Core/Routing/MessageDiscardPolicy.cs
  - src/Whizbang.Data.Postgres/Notifications/NotifyMetrics.cs
  - src/Whizbang.Sagas/Observability/SagaMetrics.cs
testReferences:
  - tests/Whizbang.Core.Tests/Observability/DispatcherMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/LifecycleMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/LifecycleCoordinatorMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/TransportMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveRewindMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/WorkCoordinatorMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/InboxMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/DeadLetterMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/EventCategoryMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/TableStatisticsMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/TypeRegistryMetricsTests.cs
  - tests/Whizbang.Sagas.Tests/SagaMetricsTests.cs
lastMaintainedCommit: '01f07906'
---

# Metrics Reference

Whizbang emits structured OpenTelemetry metrics from every major subsystem. Each subsystem owns a dedicated `Meter` so you can selectively subscribe to the instruments you care about. All metrics are near-zero cost when no exporter is attached - the .NET `System.Diagnostics.Metrics` API short-circuits recording when there are no listeners.

The six core meters cover the main request lifecycle:

| Meter | Class | Scope |
|-------|-------|-------|
| `Whizbang.Dispatcher` | `DispatcherMetrics` | Send, Publish, LocalInvoke, cascade, serialization |
| `Whizbang.Lifecycle` | `LifecycleMetrics` | Stage execution, receptor invocation, tag hooks |
| `Whizbang.LifecycleCoordinator` | `LifecycleCoordinatorMetrics` | Coordinator state, WhenAll tracking, stage firing |
| `Whizbang.Transport` | `TransportMetrics` | Inbox receive, outbox publish, event store, subscriptions, body offloads |
| `Whizbang.Perspectives` | `PerspectiveMetrics` | Perspective worker batches, checkpoints, event loading, rewinds |
| `Whizbang.WorkCoordinator` | `WorkCoordinatorMetrics` (+ `InboxMetrics`) | process_work_batch SQL, flush, publisher worker, maintenance, gate holds, inbox dispatch |

Additional subsystem meters:

| Meter | Class | Scope |
|-------|-------|-------|
| `Whizbang.DeadLetters` | `DeadLetterMetrics` | Internal DLQ adds, recoveries, holds, generation replay |
| `Whizbang.TransportDeadLetterDrain` | `TransportDeadLetterDrainWorker` | Broker-side DLQ drain counts |
| `Whizbang.EventCategories` | `EventCategoryMetrics` | Category-routed event dispatch and fanout |
| `Whizbang.Workers.PinnedPool` | `PinnedPoolMetrics` | Pinned connection pool borrows, timeouts, recycles |
| `Whizbang.TableStatistics` | `TableStatisticsMetrics` | Estimated queue depth and table size gauges |
| `Whizbang.TypeRegistry` | `TypeRegistryMetrics` | Message type registry renames and drift |
| `Whizbang.Core.Routing.MessageDiscard` | `MessageDiscardPolicy` | Unsubscribed-message discards at the receive boundary |
| `Whizbang.Postgres.Notifications` | `NotifyMetrics` | LISTEN/NOTIFY signal delivery and connection state |
| `Whizbang.Sagas` | `SagaMetrics` | Saga initiation, completion, item and hook outcomes |

## Configuration {#configuration}

All metrics classes are automatically registered as singletons by `AddWhizbang()`. The shared `WhizbangMetrics` class holds the `IMeterFactory` reference that each subsystem uses to create its meter.

```csharp{title="Metrics Registration" description="Metrics are auto-registered by AddWhizbang - no extra setup needed" category="Configuration" difficulty="BEGINNER" tags=["Metrics", "Configuration", "DI"] unverified="metrics config/query — not exercised by a test"}
// Metrics are registered automatically - no opt-in required
services.AddWhizbang(options => {
  // ... your configuration
});

// To export metrics, configure OpenTelemetry SDK
builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics => {
      // Subscribe to all Whizbang meters
      metrics.AddMeter("Whizbang.Dispatcher");
      metrics.AddMeter("Whizbang.Lifecycle");
      metrics.AddMeter("Whizbang.LifecycleCoordinator");
      metrics.AddMeter("Whizbang.Transport");
      metrics.AddMeter("Whizbang.Perspectives");
      metrics.AddMeter("Whizbang.WorkCoordinator");

      // Optional subsystem meters (subscribe to the ones you use)
      metrics.AddMeter("Whizbang.DeadLetters");
      metrics.AddMeter("Whizbang.TransportDeadLetterDrain");
      metrics.AddMeter("Whizbang.EventCategories");
      metrics.AddMeter("Whizbang.Workers.PinnedPool");
      metrics.AddMeter("Whizbang.TableStatistics");
      metrics.AddMeter("Whizbang.TypeRegistry");
      metrics.AddMeter("Whizbang.Core.Routing.MessageDiscard");
      metrics.AddMeter("Whizbang.Postgres.Notifications");
      metrics.AddMeter("Whizbang.Sagas");

      // Export to Prometheus, OTLP, or Aspire
      metrics.AddPrometheusExporter();
      // or: metrics.AddOtlpExporter();
    });
```

### WhizbangMetrics

The `WhizbangMetrics` class is the shared parent that owns the `IMeterFactory` reference. All subsystem metrics classes inject it to create their meters. When `IMeterFactory` is available (e.g., via OpenTelemetry SDK registration), meters are created through the factory. Otherwise, a standalone `Meter` is created as a fallback.

```csharp{title="WhizbangMetrics" description="Shared parent that provides IMeterFactory to all subsystem metrics" category="Reference" difficulty="BEGINNER" tags=["Metrics", "Architecture", "DI"] unverified="metrics config/query — not exercised by a test"}
// Registered automatically as singleton
public sealed class WhizbangMetrics(IMeterFactory? meterFactory = null) {
  public IMeterFactory? MeterFactory { get; } = meterFactory;
}
```

## Whizbang.Dispatcher {#dispatcher}

Meter name: `Whizbang.Dispatcher`

Instruments covering the full dispatch path - from `SendAsync` entry through receptor invocation, cascade extraction, serialization, and perspective synchronization.

### Timing Histograms

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.dispatcher.send.duration` | ms | SendAsync: envelope creation, receptor, cascade, lifecycle |
| `whizbang.dispatcher.publish.duration` | ms | PublishAsync: local handlers, outbox queue, flush |
| `whizbang.dispatcher.local_invoke.duration` | ms | LocalInvokeAsync: receptor invocation only |
| `whizbang.dispatcher.local_invoke_and_sync.duration` | ms | LocalInvokeAndSyncAsync: invoke + perspective wait |
| `whizbang.dispatcher.cascade.duration` | ms | CascadeMessageAsync: extraction, routing, outbox/local |
| `whizbang.dispatcher.send_many.duration` | ms | SendManyAsync: batch dispatch total |

### Sub-Operation Histograms

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.dispatcher.receptor.duration` | ms | Time in receptor delegate invocation |
| `whizbang.dispatcher.cascade_extraction.duration` | ms | MessageExtractor.ExtractMessagesWithRouting |
| `whizbang.dispatcher.perspective_sync.duration` | ms | _awaitPerspectiveSyncIfNeededAsync wait time |
| `whizbang.dispatcher.perspective_wait.duration` | ms | _waitForPerspectivesIfNeededAsync (post-dispatch) |
| `whizbang.dispatcher.serialization.duration` | ms | _serializeToNewOutboxMessage JSON serialization |
| `whizbang.dispatcher.tag_processing.duration` | ms | _processTagsIfEnabledAsync execution |

### Throughput Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.dispatcher.messages_dispatched` | Counter\<long\> | Total messages dispatched |
| `whizbang.dispatcher.events_cascaded` | Counter\<long\> | Events cascaded from receptor results |
| `whizbang.dispatcher.messages_serialized` | Counter\<long\> | Messages serialized for outbox |
| `whizbang.dispatcher.duplicates_detected` | Counter\<long\> | Inbox dedup rejections |
| `whizbang.dispatcher.perspective_sync_timeouts` | Counter\<long\> | Perspective sync wait timeouts |
| `whizbang.dispatcher.errors` | Counter\<long\> | Dispatch-level errors |
| `whizbang.dispatcher.publish_once.claims_won` | Counter\<long\> | PublishOnceAsync calls that won the claim and emitted the event |
| `whizbang.dispatcher.publish_once.claims_lost` | Counter\<long\> | PublishOnceAsync calls that lost the claim and intentionally no-opped |

### Batch Histograms

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.dispatcher.cascade.event_count` | Histogram\<int\> | Events extracted per cascade |
| `whizbang.dispatcher.send_many.batch_size` | Histogram\<int\> | Messages per SendMany call |

## Whizbang.Lifecycle {#lifecycle}

Meter name: `Whizbang.Lifecycle`

Instruments for all 20 lifecycle stages, individual receptor invocations, and the tag hook pipeline.

### Stage Timing

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.lifecycle.stage.duration` | ms | Time executing all receptors for a stage |
| `whizbang.lifecycle.receptor.duration` | ms | Individual receptor invocation time |

### Stage Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle.stage.invocations` | Counter\<long\> | Total invocations per lifecycle stage |
| `whizbang.lifecycle.receptor.invocations` | Counter\<long\> | Individual receptor invocations |
| `whizbang.lifecycle.receptor.errors` | Counter\<long\> | Receptor failures per stage |

### Tag Hook Timing

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.lifecycle.tag_hook.duration` | ms | Per-hook execution time |
| `whizbang.lifecycle.tag_processing.duration` | ms | Total tag processing time (all hooks) |

### Tag Hook Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle.tag_hook.invocations` | Counter\<long\> | Hook invocations |
| `whizbang.lifecycle.tag_hook.errors` | Counter\<long\> | Hook failures |

## Whizbang.LifecycleCoordinator {#lifecycle-coordinator}

Meter name: `Whizbang.LifecycleCoordinator`

Instruments for the coordinator that tracks active events through the lifecycle, manages perspective WhenAll gates, and fires PostAllPerspectives/PostLifecycle stages.

### Active Tracking Gauges

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle_coordinator.active_tracked_events` | UpDownCounter\<int\> | Events currently in lifecycle tracking |
| `whizbang.lifecycle_coordinator.pending_perspective_states` | UpDownCounter\<int\> | Events awaiting perspective WhenAll completion |
| `whizbang.lifecycle_coordinator.pending_when_all_states` | UpDownCounter\<int\> | Events awaiting segment WhenAll completion |

### Completion Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle_coordinator.perspective_completions_signaled` | Counter\<long\> | Individual perspective complete signals received |
| `whizbang.lifecycle_coordinator.all_perspectives_completed` | Counter\<long\> | Events where all perspectives finished |
| `whizbang.lifecycle_coordinator.expectations_not_registered` | Counter\<long\> | Events with no perspective expectations (key mismatch detector) |

### Stage Firing Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle_coordinator.post_all_perspectives_fired` | Counter\<long\> | PostAllPerspectives stage executions |
| `whizbang.lifecycle_coordinator.post_lifecycle_fired` | Counter\<long\> | PostLifecycle stage executions |
| `whizbang.lifecycle_coordinator.post_lifecycle_errors` | Counter\<long\> | PostLifecycle stage failures |
| `whizbang.lifecycle_coordinator.stage_transitions` | Counter\<long\> | Stage transitions (tag: stage) |

### Cleanup Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.lifecycle_coordinator.stale_tracking_cleaned` | Counter\<long\> | Stale tracking entries cleaned by inactivity threshold |
| `whizbang.lifecycle_coordinator.stale_tracking_preserved_partial_perspectives` | Counter\<long\> | Stale entries preserved because some perspectives had already completed |

## Whizbang.Transport {#transport}

Meter name: `Whizbang.Transport`

Instruments covering the inbox receive pipeline, outbox publish pipeline, transport subscriptions, and event store operations.

### Inbox Timing

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.transport.inbox.receive.duration` | ms | Full _handleMessageAsync: receive, process, complete |
| `whizbang.transport.inbox.dedup.duration` | ms | First FlushAsync (INSERT ... ON CONFLICT) |
| `whizbang.transport.inbox.processing.duration` | ms | OrderedStreamProcessor.ProcessInboxWorkAsync |
| `whizbang.transport.inbox.completion.duration` | ms | Second FlushAsync (report completions) |
| `whizbang.transport.inbox.security_context.duration` | ms | SecurityContextHelper.EstablishFullContextAsync |
| `whizbang.transport.inbox.concurrency_wait.duration` | ms | Time waiting for a concurrency semaphore slot |
| `whizbang.transport.inbox.batch.wait.duration` | ms | Time the first message in a batch waited before flush |

### Inbox Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.transport.inbox.messages_received` | Counter\<long\> | Messages received from transport |
| `whizbang.transport.inbox.messages_processed` | Counter\<long\> | Successfully processed |
| `whizbang.transport.inbox.messages_deduplicated` | Counter\<long\> | Rejected as duplicates |
| `whizbang.transport.inbox.messages_failed` | Counter\<long\> | Processing failures |
| `whizbang.transport.inbox.subscription_retries` | Counter\<long\> | Transport subscription retry attempts |
| `whizbang.transport.inbox.batch.flushes` | Counter\<long\> | Total inbox batch flushes |
| `whizbang.transport.inbox.batch.size` | Histogram\<double\> | Messages per inbox batch flush |
| `whizbang.transport.inbox.concurrent_messages` | UpDownCounter\<int\> | Current concurrent message handlers |

### Outbox Timing

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.transport.outbox.publish.duration` | ms | _publishStrategy.PublishAsync to transport |
| `whizbang.transport.outbox.readiness_wait.duration` | ms | Time waiting for transport readiness |

### Outbox Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.transport.outbox.messages_published` | Counter\<long\> | Messages published to transport |
| `whizbang.transport.outbox.messages_failed` | Counter\<long\> | Publish failures by reason |
| `whizbang.transport.outbox.publish_retries` | Counter\<long\> | Retry attempts |
| `whizbang.transport.outbox.publish_throttled` | Counter\<long\> | Broker-side throttle events observed during publish; tagged by `transport` |

### Subscription Gauges

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.transport.active_subscriptions` | UpDownCounter\<int\> | Currently active transport subscriptions |

### Event Store

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.event_store.append.duration` | ms | AppendAsync latency |
| `whizbang.event_store.query.duration` | ms | GetEventsBetweenPolymorphicAsync latency |
| `whizbang.event_store.events_stored` | Counter\<long\> | Events appended |
| `whizbang.event_store.events_queried` | Counter\<long\> | Event queries executed |

### Body Offload (Claim-Check)

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.transport.body_offload.count` | Counter\<long\> | Messages whose body was offloaded (claim-check tripped); tagged by `message.type` + `message.namespace` |
| `whizbang.transport.body_offload.bytes` | Histogram\<long\> (By) | Original serialized size that triggered an offload |
| `whizbang.transport.body_claim.rehydrated.count` | Counter\<long\> | Claim envelopes rehydrated on receive; tagged by `message.type` + `message.namespace` |
| `whizbang.transport.body_claim.rehydrated.bytes` | Histogram\<long\> (By) | Rehydrated body size downloaded from the body store |

## Whizbang.Perspectives {#perspectives}

Meter name: `Whizbang.Perspectives`

Instruments for the perspective worker pipeline - batch processing, claim, event loading, runner execution, and checkpointing.

### Timing Histograms

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.perspective.batch.duration` | ms | Full _processWorkBatchAsync cycle |
| `whizbang.perspective.claim.duration` | ms | ProcessWorkBatchAsync to claim perspective work |
| `whizbang.perspective.event_load.duration` | ms | GetEventsBetweenPolymorphicAsync query |
| `whizbang.perspective.runner.duration` | ms | IPerspectiveRunner execution per stream |
| `whizbang.perspective.checkpoint.duration` | ms | GetPerspectiveCursorAsync |

### Throughput Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.perspective.events_processed` | Counter\<long\> | Events applied to perspectives |
| `whizbang.perspective.batches_processed` | Counter\<long\> | Batches completed |
| `whizbang.perspective.streams_updated` | Counter\<long\> | Unique streams updated |
| `whizbang.perspective.errors` | Counter\<long\> | Processing errors |
| `whizbang.perspective.empty_batches` | Counter\<long\> | Polling cycles with no work |

### Backlog & Rewind

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.perspective.pending_events` | ObservableGauge | Pending perspective events awaiting processing |
| `whizbang.perspective.rewinds` | Counter\<long\> | Rewind operations triggered |
| `whizbang.perspective.rewind.duration` | ms | Rewind replay duration |
| `whizbang.perspective.rewind.events_replayed` | Histogram\<int\> | Events replayed per rewind |
| `whizbang.perspective.rewind.events_behind` | Histogram\<int\> | Events behind cursor when rewind triggered |

### Batch Composition Histograms

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.perspective.batch.work_items` | Histogram\<int\> | Work items claimed per batch |
| `whizbang.perspective.batch.event_count` | Histogram\<int\> | Events loaded per batch |
| `whizbang.perspective.batch.stream_groups` | Histogram\<int\> | Distinct streams per batch |

## Whizbang.WorkCoordinator {#work-coordinator}

Meter name: `Whizbang.WorkCoordinator`

Instruments for the core work coordination pipeline - the `process_work_batch` SQL call, flush orchestration, publisher worker, and maintenance tasks.

### Timing Histograms

| Metric Name | Unit | Description |
|-------------|------|-------------|
| `whizbang.work_coordinator.process_batch.duration` | ms | Time executing process_work_batch SQL |
| `whizbang.work_coordinator.flush.duration` | ms | Total FlushAsync time including lifecycle |

### Batch Composition (Input)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.work_coordinator.batch.outbox_messages` | Histogram\<int\> | Outbox messages sent to process_work_batch |
| `whizbang.work_coordinator.batch.inbox_messages` | Histogram\<int\> | Inbox messages sent |
| `whizbang.work_coordinator.batch.completions` | Histogram\<int\> | Completions sent |
| `whizbang.work_coordinator.batch.failures` | Histogram\<int\> | Failures sent |

### Work Returned (Output)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.work_coordinator.returned.outbox_work` | Histogram\<int\> | Outbox work items returned |
| `whizbang.work_coordinator.returned.inbox_work` | Histogram\<int\> | Inbox work items returned |
| `whizbang.work_coordinator.returned.perspective_work` | Histogram\<int\> | Perspective work items returned |

### Counters

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.work_coordinator.process_batch.calls` | Counter\<long\> | Total process_work_batch calls |
| `whizbang.work_coordinator.process_batch.errors` | Counter\<long\> | SQL errors |
| `whizbang.work_coordinator.flush.calls` | Counter\<long\> | Total FlushAsync calls |
| `whizbang.work_coordinator.flush.empty_calls` | Counter\<long\> | Flushes with no queued work |

### Publisher Worker

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.publisher.lease_renewals` | Counter\<long\> | Lease renewals due to transport not ready |
| `whizbang.publisher.buffered_messages` | Counter\<long\> | Total messages buffered for publish |

### Maintenance

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.maintenance.task.duration` | ms | Duration per maintenance task |
| `whizbang.maintenance.task.rows_affected` | Histogram\<long\> | Rows cleaned per task |

### Gate & Inbox Dispatch

Both instruments live on the `Whizbang.WorkCoordinator` meter (`InboxMetrics` deliberately reuses it):

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.gate.hold_duration_ms` | ms | WorkCoordinatorGate slot-held duration; tagged with caller |
| `whizbang.inbox.dispatch.duration_ms` | ms | Per-message inbox dispatch wall time, tagged with short message type |

## Whizbang.DeadLetters {#dead-letters}

Meter name: `Whizbang.DeadLetters` (`DeadLetterMetrics`)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.dead_letters.added` | Counter\<long\> | Rows moved into `wh_dead_letters`; tagged by `source_table` + `reason` |
| `whizbang.dead_letters.recovered` | Counter\<long\> | Successful recovery re-emits; tagged by `source_table` |
| `whizbang.dead_letters.held` | Counter\<long\> | Transitions to HoldForReview; tagged by `policy_name` + `reason` |
| `whizbang.dead_letters.permanently_failed` | Counter\<long\> | Transitions to PermanentlyFailed; tagged by `policy_name` + `reason` |
| `whizbang.dead_letters.recovery_attempts` | Counter\<long\> | Recovery attempts dispatched (any outcome); tagged by `reason` |
| `whizbang.dead_letters.generation_replay_scheduled` | Counter\<long\> | Rows scheduled by the generation-replay sweep; tagged by `generation` |

## Whizbang.TransportDeadLetterDrain {#transport-dlq}

Meter name: `Whizbang.TransportDeadLetterDrain` (created by `TransportDeadLetterDrainWorker`)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.transport_dlq.drained` | Counter\<long\> | Messages re-submitted from a broker's dead-letter queue; tagged by `transport` |

## Whizbang.EventCategories {#event-categories}

Meter name: `Whizbang.EventCategories` (`EventCategoryMetrics`)

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.event_category.dispatch.duration` | ms | Dispatch / expansion duration at the category seam (collective dispatcher or composite expander) |
| `whizbang.event_category.fanout` | Histogram\<int\> | Fan-out factor — affected rows for collective, inner-event count for composite |
| `whizbang.event_category.dispatched` | Counter\<long\> | Dispatches per category |
| `whizbang.event_category.errors` | Counter\<long\> | Dispatch failures per category |

## Whizbang.Workers.PinnedPool {#pinned-pool}

Meter name: `Whizbang.Workers.PinnedPool` (`PinnedPoolMetrics`)

| Metric Name | Unit / Type | Description |
|-------------|-------------|-------------|
| `whizbang.workers.pinned_pool.borrow.duration` | ms | Time from borrow request to connection handed back by the pinned pool |
| `whizbang.workers.pinned_pool.borrow.timeouts` | Counter\<long\> | Borrow attempts that timed out waiting for an available connection |
| `whizbang.workers.pinned_pool.connection_recycles` | Counter\<long\> | Pinned-connection recycles (Npgsql ConnectionLifetime) |

## Whizbang.TableStatistics {#table-statistics}

Meter name: `Whizbang.TableStatistics` (`TableStatisticsMetrics`)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.queue.estimated_depth` | ObservableGauge | Unprocessed message count for inbox/outbox queues |
| `whizbang.table.estimated_bytes` | ObservableGauge | Estimated disk size per table from the database catalog |

## Whizbang.TypeRegistry {#type-registry}

Meter name: `Whizbang.TypeRegistry` (`TypeRegistryMetrics`)

| Metric Name | Type | Description |
|-------------|------|-------------|
| `whizbang.type_registry.renamed` | Counter\<long\> | Registry rows reconciled old→new for an acknowledged rename; tagged by `service` |
| `whizbang.type_registry.drift_detected` | Counter\<long\> | Un-acknowledged registry drift left untouched; tagged by `service` |

## Other Meters {#other-meters}

| Meter | Metric Name | Type | Description |
|-------|-------------|------|-------------|
| `Whizbang.Core.Routing.MessageDiscard` | `whizbang.message.skipped` | Counter\<long\> | Messages intentionally skipped at a discard gate (receive \| inbox \| outbox) |
| `Whizbang.Postgres.Notifications` | `whizbang.postgres.notifications.signals_received` | Counter\<long\> | NOTIFY signals delivered to subscribers; tagged by category (outbox/inbox/perspective/unknown) |
| `Whizbang.Postgres.Notifications` | `whizbang.postgres.notifications.connection_state` | UpDownCounter\<int\> | +1 when LISTEN/NOTIFY is healthy, -1 on disconnect; sum = number of connected pods |
| `Whizbang.Postgres.Notifications` | `whizbang.postgres.notifications.signaling_mode` | Counter\<long\> | Mode-decision events (startup + runtime transitions); tagged by mode and reason |
| `Whizbang.Sagas` | `whizbang.sagas.initiated` | Counter\<long\> | Sagas initiated |
| `Whizbang.Sagas` | `whizbang.sagas.completed` | Counter\<long\> | Sagas reaching a terminal completed state |
| `Whizbang.Sagas` | `whizbang.sagas.failed` | Counter\<long\> | Sagas that fail-fasted |
| `Whizbang.Sagas` | `whizbang.sagas.duration` | Histogram\<double\> (s) | End-to-end saga duration |
| `Whizbang.Sagas` | `whizbang.sagas.items_completed` | Histogram\<int\> | Items completed per saga |
| `Whizbang.Sagas` | `whizbang.sagas.items_failed` | Histogram\<int\> | Items failed per saga |
| `Whizbang.Sagas` | `whizbang.sagas.items_reset` | Counter\<long\> | Saga items reset via SagaResetEvent |
| `Whizbang.Sagas` | `whizbang.sagas.hooks_completed` | Counter\<long\> | Saga hooks that succeeded |
| `Whizbang.Sagas` | `whizbang.sagas.hooks_failed` | Counter\<long\> | Saga hooks that failed |

## Grafana and Prometheus Integration {#grafana-prometheus}

Whizbang metrics are standard OpenTelemetry instruments, making them compatible with any OTel-aware backend. The most common production setup is Prometheus scraping with Grafana dashboards.

### Prometheus Exporter

```csharp{title="Prometheus Setup" description="Configure Prometheus exporter for Whizbang metrics" category="Configuration" difficulty="INTERMEDIATE" tags=["Metrics", "Prometheus", "Configuration"] unverified="metrics config/query — not exercised by a test"}
builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics => {
      metrics.AddMeter("Whizbang.Dispatcher");
      metrics.AddMeter("Whizbang.Lifecycle");
      metrics.AddMeter("Whizbang.LifecycleCoordinator");
      metrics.AddMeter("Whizbang.Transport");
      metrics.AddMeter("Whizbang.Perspectives");
      metrics.AddMeter("Whizbang.WorkCoordinator");
      metrics.AddPrometheusExporter();
    });

// Expose /metrics endpoint
app.MapPrometheusScrapingEndpoint();
```

### Useful Grafana Queries

```promql{title="Grafana PromQL Examples" description="Common Prometheus queries for Whizbang dashboards" category="Operations" difficulty="INTERMEDIATE" tags=["Metrics", "Grafana", "Prometheus", "PromQL"]}
# Dispatch throughput (messages/sec)
rate(whizbang_dispatcher_messages_dispatched_total[5m])

# p99 send latency
histogram_quantile(0.99, rate(whizbang_dispatcher_send_duration_bucket[5m]))

# Inbox processing error rate
rate(whizbang_transport_inbox_messages_failed_total[5m])
  / rate(whizbang_transport_inbox_messages_received_total[5m])

# Active events in lifecycle coordinator (gauge)
whizbang_lifecycle_coordinator_active_tracked_events

# Perspective lag (empty batches indicate worker is caught up)
rate(whizbang_perspective_empty_batches_total[5m])

# process_work_batch SQL p95 latency
histogram_quantile(0.95, rate(whizbang_work_coordinator_process_batch_duration_bucket[5m]))
```

### Aspire Dashboard

For .NET Aspire projects, metrics appear automatically in the Aspire dashboard:

```csharp{title="Aspire Metrics Integration" description="Configure Whizbang meters for Aspire dashboard" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Observability", "C#", "Aspire", "Metrics"] unverified="metrics config/query — not exercised by a test"}
// In ServiceDefaults project
builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics => {
      metrics.AddMeter("Whizbang.Dispatcher");
      metrics.AddMeter("Whizbang.Lifecycle");
      metrics.AddMeter("Whizbang.LifecycleCoordinator");
      metrics.AddMeter("Whizbang.Transport");
      metrics.AddMeter("Whizbang.Perspectives");
      metrics.AddMeter("Whizbang.WorkCoordinator");
    });
```

## Instrument Types {#instrument-types}

Whizbang uses four OpenTelemetry instrument types:

| Instrument | Purpose | Example |
|------------|---------|---------|
| `Counter<T>` | Monotonically increasing totals | `messages_dispatched`, `errors` |
| `Histogram<T>` | Value distributions (latency, batch sizes) | `send.duration`, `batch.event_count` |
| `UpDownCounter<T>` | Gauges that can increase or decrease | `active_tracked_events`, `active_subscriptions` |
| `ObservableGauge` | Pull-based point-in-time values | `pending_events`, `queue.estimated_depth` |

**Histograms** are ideal for latency percentiles (p50, p95, p99) and batch size distributions. **Counters** track cumulative totals - use `rate()` in Prometheus to derive per-second throughput. **UpDownCounters** represent current state and are useful for alerting on resource saturation.

## See Also

- [Tracing](./tracing) - Handler-level distributed tracing with OpenTelemetry spans
- [OpenTelemetry Integration](./opentelemetry-integration) - Tag-based telemetry and metric hooks
- [Diagnostics](./diagnostics) - System diagnostics and health monitoring
- [Logging Categories](./logging-categories) - Configure log output verbosity
