---
title: Logging Categories
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Observability
order: 4
description: >-
  Configure log levels for Whizbang's internal logging categories to control
  console output verbosity in development and production environments
tags: 'logging, log levels, categories, appsettings, observability, configuration, ILogger'
codeReferences:
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/InboxHandlerWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Workers/ServiceBusConsumerWorker.cs
  - src/Whizbang.Core/Workers/TransportBatchGuard.cs
  - src/Whizbang.Core/Messaging/OrderedStreamProcessor.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs
  - src/Whizbang.Core/Workers/InboxFlushFailureRecorder.cs
  - src/Whizbang.Core/Workers/OutboxFlushFailureRecorder.cs
  - src/Whizbang.Core/Workers/DeadLetterLoggingOptions.cs
  - src/Whizbang.Core/Observability/DeadLetterLog.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusDeadLetterDrainer.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMqDeadLetterDrainer.cs
  - src/Whizbang.Core/Tags/MessageTagProcessor.cs
  - src/Whizbang.Core/Observability/WhizbangStartupLog.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangHostExtensions.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerHeldLeaseTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerControlPlaneDropLogTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxHandlerWorkerTests.cs
  - tests/Whizbang.Core.Tests/Observability/DeadLetterLogTests.cs
  - tests/Whizbang.Core.Tests/Workers/DeadLetterLoggingOptionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/DeadLetterLoggingWiringTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerDeadLetterLogTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerUndeserializablePayloadTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxFlushFailureRecorderTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxFlushFailureCallbackTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerBranchCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxPublishWorkerDlqPromotionTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PrePublishGateForensicPreservationTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeadLetterFilterTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerUnstorableMessageTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerPoisonQuarantineTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowInboxFlushFailureTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowOutboxFlushFailureTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusDeadLetterDrainerTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMqDeadLetterDrainerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxDrainWorkerCoverageTests.AttemptLogLevel.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.AttemptLogLevel.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerCollectiveSinkTests.AttemptLogLevel.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StoredForm.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ServiceBusConsumerWorkerCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/OrderedStreamProcessorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRunnerAttemptFailureLogLevelTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportBatchGuardTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusTransportReceiveGuardTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusTransportPublishPathTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Component.Tests/BranchCoverage/RabbitMQTransportLoggingBranchTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Component.Tests/BranchCoverage/RabbitMQTransportBatchFlushBranchTests.cs
lastMaintainedCommit: '01f07906'
---

# Logging Categories

Whizbang uses .NET's standard `ILogger` infrastructure for all internal diagnostic logging. Each component writes to a named **logging category** that you can independently control via `appsettings.json`.

## Quick Start

Silence noisy Whizbang components in development by adding overrides to your `appsettings.Development.json`:

```json{title="Silence Noisy Categories" description="Suppress verbose startup, worker, and transport output" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Whizbang.Initialization": "None",
      "Whizbang.Core.Dispatcher": "None",
      "Whizbang.Core.Workers.PerspectiveWorker": "None",
      "Whizbang.Core.Workers.TransportConsumerWorker": "None",
      "Whizbang.Core.Workers.OutboxPublishWorker": "Warning",
      "Whizbang.Transports.RabbitMQ": "Warning"
    }
  }
}
```

To temporarily re-enable a category for debugging, set it to `"Debug"`:

```json{title="Debug a Specific Category" description="Enable debug output for a single component" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Debugging"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang.Initialization": "Debug"
    }
  }
}
```

## Available Categories {#categories}

### Database Initialization

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Initialization` | Top-level database initialization orchestration — schema creation, migrations, constraints, perspective registration, and maintenance. Emits a summary line at `Information` with elapsed time and migration count; all step-level detail is at `Debug`. | Information |
| `Whizbang.Startup` | Startup banner and one-time process identity output (`WhizbangStartupLog`). Suppress the banner via the `Whizbang:ShowBanner` configuration key instead of the log level if you only want the ASCII art gone. | Information |

### Dispatcher

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Dispatcher` | Dispatcher tag processing diagnostics — logs entry/exit of `_processTagsIfEnabledAsync` and tag processing mode decisions. | Debug |
| `Whizbang.Core.Dispatcher.Cascade` | Event cascade tracing — logs when dispatched events trigger cascaded handler invocations. | Debug |

### Workers

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Workers.PerspectiveWorker` | Perspective batch processing diagnostics — logs work item counts, stream/perspective grouping, and empty-batch warnings. | Debug |
| `Whizbang.Core.Workers.OutboxPublishWorker` | Outbox publish worker: startup/shutdown summary at `Information`; publish failures below the attempt cap and missing-transport conditions at `Warning`; a message it dead-letters as the [dead-letter record](#dead-lettered-messages). | Information |
| `Whizbang.Core.Workers.ClaimWorker` | Work-claim poller — startup/shutdown and NOTIFY-gate reconnects at `Information`; tick failures and heartbeat problems at `Warning`. | Information |
| `Whizbang.Core.Workers.TransportConsumerWorker` | Transport consumer startup and subscription management. Logs a one-line summary at `Information` on start; per-destination and per-subscription detail at `Debug`. | Information |
| `Whizbang.Core.Workers.InboxDrainWorker` | Inbox drain: turns claimed stream ids into queued inbox rows. Working-set budget hand-backs at `Information`; drain and hand-back failures at `Warning`. See [Inbox pipeline events](#inbox-pipeline-events). | Information |
| `Whizbang.Core.Workers.InboxDispatchWorker` | Inbox dispatch and its lease keeper: dispatch failures, lease renewal failures, lapsed held rows and control-plane drops at `Warning`; skipped duplicate copies at `Debug`; a message it dead-letters as the [dead-letter record](#dead-lettered-messages). | Information |
| `Whizbang.Core.Workers.InboxHandlerWorker` | Batched inbox commits: each failed commit (first five per flush, then a summary) at `Warning`. | Information |

### Transport

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Transports.RabbitMQ` | Parent category for all RabbitMQ transport logging. Set to `Warning` to silence startup chatter while retaining error visibility. | Information |
| `Whizbang.Transports.RabbitMQ.RabbitMQTransport` | RabbitMQ connection lifecycle and per-subscription creation detail. | Debug |
| `Whizbang.Transports.RabbitMQ.RabbitMQConnectionRetry` | RabbitMQ connection establishment and retry attempts. | Information |
| `Whizbang.Transports.RabbitMQ.RabbitMQInfrastructureProvisioner` | RabbitMQ exchange and queue provisioning for owned domains. | Debug |

### Messaging

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Messaging.ReceptorInvoker` | Receptor invocation — logs handler resolution and execution. | Debug |
| `Whizbang.Core.Messaging.ScopedWorkCoordinatorStrategy` | Scoped work coordinator — logs batch processing within DI scopes. | Information |
| `Whizbang.Core.Messaging.ImmediateWorkCoordinatorStrategy` | Immediate work coordinator — logs direct dispatch processing. | Information |
| `Whizbang.Core.Messaging.IntervalWorkCoordinatorStrategy` | Interval work coordinator — logs timer-based batch processing. | Information |

### Tags & Security

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Tags.MessageTagProcessor` | Message tag processing — logs tag evaluation and notification dispatch. Can be very verbose in systems with tagged notifications. | Information |
| `Whizbang.Core.Security.SecurityContextHelper` | Security context propagation — logs JWT extraction and tenant resolution. | Information |
| `Whizbang.Core.Dispatch.DispatcherSecurityBuilder` | Security builder — logs security policy resolution during dispatch. | Debug |

### Perspectives

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Perspectives.Sync.PerspectiveSyncAwaiter` | Synchronous perspective await — logs when dispatchers wait for perspective projections to complete before returning. | Information |

### Tracing

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Tracing.Tracer` | Structured trace output — controlled separately via `TracingOptions`. See [Tracing](tracing) for configuration. | Information |

## Receptor Firing Diagnostics {#receptor-firing-diagnostics}

The receptor invoker logs each firing under `Whizbang.Core.Messaging.ReceptorInvoker`. See
[Exactly-once firing](../../fundamentals/receptors/exactly-once-firing.md) for the guarantee the entries
describe.

| EventId | Name | Level | When |
|---|---|---|---|
| 16 | `ReceptorFiring` | Debug | Immediately before a receptor is dispatched. |
| 17 | `ReceptorFired` | Debug | After it returns, from a `finally`, so a failure is still reported. |
| 18 | `ReceptorAlreadyFiredSkip` | Warning | The double-fire guardrail caught a duplicate. A healthy system logs none. |

Warnings reach the default `Information` level, so `ReceptorAlreadyFiredSkip` is visible without any change. To
trace every firing while you investigate, lower just this category:

```json{title="Tracing receptor firings" description="Lower only the receptor invoker's category to Debug" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Receptors", "Diagnostics"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang.Core.Messaging.ReceptorInvoker": "Debug"
    }
  }
}
```

## Inbox Pipeline Events {#inbox-pipeline-events}

The inbox drain, dispatch and commit workers log the events below about the rows a process holds and
the commits it makes. See [Per-stream drain](../../fundamentals/work-coordinator/per-stream-drain#working-set-budget),
[Inbox dispatch](../../fundamentals/work-coordinator/inbox-dispatch#held-rows) and
[Handler commit](../../fundamentals/work-coordinator/handler-commit#commit-failures-logged) for what each
means.

| Category | EventId | Level | When |
|---|---|---|---|
| `InboxDrainWorker` | 62 | Information | The working set is full; fetched rows were handed back uncharged. |
| `InboxDrainWorker` | 63 | Warning | Handing back rows the working-set budget turned away failed. |
| `InboxDispatchWorker` | 11 | Warning | A control-plane message was dropped at the attempt bound; carries its last cause and last error. See [control-plane drops](../dead-letter-queue/internal-dlq#control-plane-drops). |
| `InboxDispatchWorker` | 78 | Warning | Renewing the leases of held rows failed. |
| `InboxDispatchWorker` | 79 | Warning | A held row used every lease renewal it is allowed in its state. |
| `InboxDispatchWorker` | 80 | Warning | Summary of lapses in one keeper pass beyond the first five. |
| `InboxDispatchWorker` | 81 | Warning | Handing back never-dispatched rows whose renewals ran out failed. |
| `InboxDispatchWorker` | 82 | Debug | A duplicate copy of a row, or a copy of a row no longer held, was skipped. |
| `InboxDispatchWorker` | 83 | Warning | A held row was not renewed because another instance claimed it after this instance's lease lapsed, or it completed; it stops being held and is not dispatched here. |
| `InboxDispatchWorker` | 84 | Warning | Summary of the rows in one keeper pass, beyond the first five, that the renewal did not cover. |
| `InboxHandlerWorker` | 26 | Warning | A row's commit failed; carries the message id, type and error. |
| `InboxHandlerWorker` | 27 | Warning | Summary of commit failures in one flush beyond the first five. |
| `InboxHandlerWorker` | 28 | Warning | A commit failure names no request in the flush. |

Categories are prefixed `Whizbang.Core.Workers.`. Every Warning above reaches the default `Information` level.
{verified: InboxDrainWorkerGapTests.HandingBackFails_IsLoggedWithWhatItCostsAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ManyLapsesInOneSweep_LogTheFirstIndividually_ThenASummaryAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ManyRowsItsRenewalDidNotCover_LogTheFirstIndividually_ThenASummaryAsync, InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithARecordedFailure_LogsTheErrorAndNamesItAsARecordedFailureAsync, InboxHandlerWorkerTests.ManyCommitFailuresInOneFlush_LogTheFirstIndividually_ThenOneSummaryOfTheRestAsync}

## Dead-Lettered Messages {#dead-lettered-messages}

A message is dead-lettered when it will not be processed unless it is recovered: its attempts ran out, it
cannot be read, or it could not be stored. Every path that dead-letters a message logs the same record for it,
once, so one query or one alert finds every dead letter in the service whichever component gave up on it.

{verified: DeadLetterLogTests.MessageDeadLettered_LogsTheDocumentedEventIdAndNameAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_MovedToTheDeadLetterStore_LogsOneErrorRecordWithTypeAndLastErrorAsync}

| Field | Value |
|---|---|
| EventId | `1901` |
| Event name | `MessageDeadLettered` |
| Level | `Error` by default; `Warning` when [`Whizbang:DeadLetterLogging:Level`](../configuration/configuration-reference#dead-letter-logging) says so |
| Category | The category of the path that dead-lettered the message (the table below) |
| `MessageId` | The dead-lettered message. For a perspective event, its event work id |
| `MessageType` | The message's type; `unknown` when the path cannot tell |
| `DeadLetterReason` | Why it was dead-lettered, usually a `MessageFailureReason` name such as `MaxAttemptsExceeded`; for a broker dead letter, the broker's reason, or `none given by the broker` |
| `LastError` | The last failure's recorded text; `none recorded` when there is none |
| Exception | The last failure's exception, when the path has it. A path that only has the stored error text logs no exception and puts the text in `LastError` |

```text{title="The dead-letter record" description="The line every dead-letter path logs once for a message it dead-letters, here for an inbox message whose attempts ran out" category="Observability" difficulty="INTERMEDIATE" tags=["dead-letter", "logging", "MessageDeadLettered", "EventId 1901"] tests=["InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_MovedToTheDeadLetterStore_LogsOneErrorRecordWithTypeAndLastErrorAsync", "DeadLetterLogTests.MessageDeadLettered_LogsTheDocumentedEventIdAndNameAsync"]}
fail: Whizbang.Core.Workers.InboxDispatchWorker[1901]
      Message <id> of type <type> was dead-lettered (MaxAttemptsExceeded) and will not be
      processed unless it is recovered. Last error: <the row's last recorded error>
```

### Every path that logs it {#dead-letter-record-paths}

| Path | Category (`Whizbang.Core.Workers.` unless named) | `DeadLetterReason` | Last failure carried | Verified |
|---|---|---|---|---|
| Inbox: attempts exhausted, moved to `wh_dead_letters` | `InboxDispatchWorker` | `MaxAttemptsExceeded` | The row's recorded error, or the exhausted attempts when none was recorded | {verified: InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_MovedToTheDeadLetterStore_LogsOneErrorRecordWithTypeAndLastErrorAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_NoRecordedError_RecordNamesTheExhaustedAttemptsAsync} |
| Inbox: attempts exhausted, finished for good without a move (no dead-letter store, or the move failed) | `InboxDispatchWorker` | `MaxAttemptsExceeded` | As above. The message is not in `wh_dead_letters`, so the record is its only trace | {verified: InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_NoDeadLetterStore_LogsTheRecordForTheTerminalCompletionAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_DeadLetterMoveThrows_LogsTheRecordForTheTerminalCompletionAsync} |
| Inbox: a payload the serializer refuses | `InboxDispatchWorker` | `SerializationError` | The serializer's exception | {verified: InboxDispatchWorkerUndeserializablePayloadTests.Dispatch_PayloadRefused_DeadLetterRecordCarriesTheRefusalAtErrorAsync} |
| Inbox: a composite over its own cap or the consumer's budget, or a failed fan-out | `InboxDispatchWorker` | `CompositeInnerEventLimitExceeded` or `CompositeExpansionFailure` | The refusal text | {verified: InboxDispatchWorkerBranchCoverageTests.CompositeOverOwnCap_MovedToTheDeadLetterStore_LogsTheDeadLetterRecordAtErrorAsync, InboxDispatchWorkerBranchCoverageTests.CompositeOverOwnCap_NoDeadLetterStore_LogsTheRecordForTheTerminalCompletionAsync, InboxDispatchWorkerBranchCoverageTests.CompositeOverConsumerBudget_NoDeadLetterStore_LogsTheRecordForTheTerminalCompletionAsync} |
| Outbox publish worker: attempts at the cap | `OutboxPublishWorker` | `MaxAttemptsExceeded` | The publish exception when one was thrown, else the publish result's error | {verified: OutboxPublishWorkerDlqPromotionTests.SingularPublish_AttemptsAtCap_LogsTheDeadLetterRecordAtErrorWithTypeAndErrorAsync, OutboxPublishWorkerDlqPromotionTests.SingularPublish_ThrowsAtCap_RecordCarriesTheExceptionAsync} |
| Outbox drain worker: the pre-publish gate | `OutboxDrainWorker` | `MaxAttemptsExceeded` | The row's recorded error | {verified: PrePublishGateForensicPreservationTests.PrePublishGate_Promotes_LogsTheDeadLetterRecordAtErrorAsync} |
| Perspective worker: apply failures above the bound | `PerspectiveWorker` | `MaxAttemptsExceeded` | The failure and lease counts, perspective, stream and event | {verified: PerspectiveWorkerDeadLetterFilterTests.FailuresAboveMax_MovedToDeadLetters_LogsTheDeadLetterRecordAtErrorAsync} |
| Transport consumer: a received message it cannot store ([custody](../dead-letter-queue/transport-recovery#custody-record)) | `TransportConsumerWorker` | The cause, such as `SerializationError` | The cause's exception and description, and the destination it came from | {verified: TransportConsumerWorkerUnstorableMessageTests.SerializationFails_LogsTheDeadLetterRecordAtErrorWithTypeAndCauseAsync} |
| Transport consumer: a redelivery loop it quarantines | `TransportConsumerWorker` | `PoisonRedeliveryLoop` | The poison verdict; the type comes from the batch, or `unknown` when the message is not in it | {verified: TransportConsumerWorkerPoisonQuarantineTests.Batch_RedeliveryLoopQuarantined_LogsTheDeadLetterRecordAtErrorWithTypeAsync, TransportConsumerWorkerPoisonQuarantineTests.Batch_RedeliveryLoopForAMessageNotInTheBatch_RecordHasNoTypeAsync} |
| Inbox and outbox batchers: a batch that could not be stored and was dead-lettered | `InboxFlushFailureRecorder`, `OutboxFlushFailureRecorder` | `InboxStoreFailed`, `OutboxStoreFailed` | The store failure's exception, or why it was abandoned at shutdown. One record per message in the batch | {verified: InboxFlushFailureRecorderTests.RecordAsync_CoordinatorDeadLetters_LogsOneDeadLetterRecordPerMessageAtErrorAsync, OutboxFlushFailureCallbackTests.RecordAsync_CoordinatorDeadLetters_LogsOneDeadLetterRecordPerMessageAtErrorAsync, InboxFlushFailureRecorderTests.RecordAsync_AbandonedWithoutAnError_RecordSaysWhyAsync} |
| Azure Service Bus and RabbitMQ dead-letter drains: a broker dead letter taken into custody | `Whizbang.Transports.AzureServiceBus.AzureServiceBusDeadLetterDrainer`, `Whizbang.Transports.RabbitMQ.RabbitMqDeadLetterDrainer` | The broker's reason | The broker's description and the queue it came from | {verified: AzureServiceBusDeadLetterDrainerTests.DrainDeadLetterQueueAsync_Imported_LogsTheDeadLetterRecordAtErrorAsync, RabbitMqDeadLetterDrainerTests.Drain_Imported_LogsTheDeadLetterRecordAtErrorAsync, RabbitMqDeadLetterDrainerTests.Drain_ImportedWithoutTypeOrReason_RecordSaysSoAsync} |

These are found by machine: every caller of the entry points that write `wh_dead_letters`
(`IDeadLetterStore.MoveAsync`, `IWorkCoordinator.ImportBrokerDeadLetterAsync` and the batchers'
`Store{Inbox,Outbox}DeadLettersAsync`), checked against the dead-letter metrics, which count an arrival on each
of the same paths.

**What gets no record.** A failure that will be retried is not a dead letter: every path logs it at Warning with
the attempt's exception (the inbox dispatch worker and the outbox publish worker as EventId 4 in both categories; the
rest are listed under [retried attempts](#retried-attempts)), and none logs the record until the attempts run out. A
few retries have no bound yet and are still logged at Error; they are the [known exceptions](#unbounded-retries).
A row another path already moved gets none, because that path logged it; a drain that finds a message already in
custody settles the broker copy and logs it at Information. A dropped [control-plane
message](../dead-letter-queue/internal-dlq#control-plane-drops) is never dead-lettered (it is re-issued on its own
cadence) and keeps its own Warning, EventId 11. A dead-letter move that fails logs its own failure and no record, and the
message is retried, except where the inbox finishes the row for good anyway (attempts exhausted, a refused
composite: above). Refusals the database makes inside the store
functions on a write nobody awaits (a mixed-kind, sealed or archived stream) dead-letter rows with no process-side
point to log from; a write that is awaited throws to its caller instead.
{verified: InboxDispatchWorkerDeadLetterLogTests.Dispatch_ThatThrowsBelowTheBound_LogsWarningAndNoRecordAsync, OutboxPublishWorkerDlqPromotionTests.SingularPublish_ThrowsBelowCap_LogsTheAttemptAtWarningAndNoRecordAsync, OutboxDrainWorkerCoverageTests.PublishOneAsync_PublishThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, PerspectiveWorkerDeepPathChannelTests.Worker_RunnerThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_RowAlreadyGone_LogsNoRecordAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_ControlPlaneDrop_LogsTheDropAtWarningAndNoRecordAsync, PerspectiveWorkerDeadLetterFilterTests.FailuresAboveMax_MoveThrows_LogsNoRecordAsync, InboxFlushFailureRecorderTests.RecordAsync_DeadLetterWriteFails_LogsNoDeadLetterRecordAsync}

### Why it is logged this way {#dead-letter-record-design}

- **Error by default.** A dead-lettered message's business effect will not happen unless someone recovers it,
  so it is logged where a service that alerts on Error hears about it. Before, it was a Warning with no type and
  no failure, indistinguishable from a retry, and the only way to get an Error was to catch, log and rethrow in
  every handler. {verified: DeadLetterLoggingOptionsTests.Default_IsErrorAsync, DeadLetterLoggingOptionsTests.Turnkey_NoSetting_ResolvesErrorAsync, DeadLetterLoggingOptionsTests.LevelFrom_NoOptions_IsErrorAsync}
- **One event for every path.** Each path logs under its own category, but with the same EventId and name, so
  an alert keys on `1901` or `MessageDeadLettered` once instead of on one line per component.
  {verified: DeadLetterLogTests.MessageDeadLettered_LogsTheDocumentedEventIdAndNameAsync}
- **One record per message.** The path that moved the message logs it; a path that finds it already moved logs
  nothing, and the batchers log one record per message plus an Information summary of the batch (below), so a
  dead letter never raises two alerts. {verified: InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_RowAlreadyGone_LogsNoRecordAsync, SlidingWindowInboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync, SlidingWindowOutboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync}
- **Per-attempt failures stay at Warning, on every path.** A retry may still succeed, so an attempt that fails is
  not an alert. Every path that will retry a failed attempt logs it at Warning with the attempt's exception attached
  (the [retried attempts](#retried-attempts) below), so a message that keeps failing produces Warnings and then one
  Error, the record, when it is dead-lettered. Error then means a message was dead-lettered or the host has a
  failure that retrying will not fix, and an alert on Error does not fire for a message whose retry succeeds.
  {verified: InboxDispatchWorkerDeadLetterLogTests.Dispatch_ThatThrowsBelowTheBound_LogsWarningAndNoRecordAsync, OutboxPublishWorkerDlqPromotionTests.SingularPublish_ThrowsBelowCap_LogsTheAttemptAtWarningAndNoRecordAsync, OutboxDrainWorkerCoverageTests.PublishOneAsync_PublishThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, PerspectiveWorkerDeepPathChannelTests.Worker_RunnerThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, AzureServiceBusTransportReceiveGuardTests.ProcessMessage_WhenThePolicyNamesAnUnrecognizedAction_LeavesTheMessageUnsettledAsync, RabbitMQTransportLoggingBranchTests.Receive_HandlerThrowsBelowMaxWithLogger_LogsTheAttemptAndRetryAtWarningAsync, TransportBatchGuardTests.AnOrdinaryFaultFailsTheBatchTooAsync}
- **The level is an option, Warning or Error.** A service whose alerting should not fire on dead letters sets
  [`Whizbang:DeadLetterLogging:Level`](../configuration/configuration-reference#dead-letter-logging) to `Warning`.
  Every path, including the ones the transports build for themselves, reads the same bound value.
  {verified: DeadLetterLoggingWiringTests.AddWhizbangWorkers_ConfiguredWarning_TheFlushRecordersLogTheRecordAtWarningAsync, DeadLetterLoggingWiringTests.AddTransportConsumer_ConfiguredWarning_TheConsumerLogsDeadLettersAtWarningAsync, AsbDeadLetterDrainerWiringTests.AddAzureServiceBusTransport_ConfiguredWarning_TheDrainerLogsDeadLettersAtWarningAsync, ServiceCollectionExtensionsTests.AddRabbitMQTransport_DeadLetterDrainer_ReadsTheBoundDeadLetterLevelAsync}

A category's own filter still applies to the record. A category set to `None`, or above the record's level, hides
that component's dead letters along with the rest of its output: the
[recommended development configuration](#recommended) silences `PerspectiveWorker` and `TransportConsumerWorker`,
which is fine on a laptop and wrong in production.

### Retried attempts {#retried-attempts}

Each line below reports one failed attempt of a message that is retried and dead-lettered only at its bound, where
the record is logged, or that is rethrown to a caller that does so. Each is logged at Warning with the attempt's
exception (where the line has one). The test beside each fails if its line returns to Error, and checks that nothing
in the run logged at Error.

| Line | Category | Why it is a retried attempt | Verified |
|---|---|---|---|
| EventId 7, `publish threw for <id>` (singular and bulk publish) | `Whizbang.Core.Workers.OutboxDrainWorker` | The row goes to the failure channel; its attempts are counted and the pre-publish gate dead-letters it at the bound | {verified: OutboxDrainWorkerCoverageTests.PublishOneAsync_PublishThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, OutboxDrainWorkerCoverageTests.PublishBulkAsync_BatchPublishThrows_LogsEachAttemptAtWarningWithItsExceptionAsync} |
| EventId 6, `failed to deserialize envelope for <id>` | `Whizbang.Core.Workers.OutboxDrainWorker` | The same: the row is failed, not dropped | {verified: OutboxDrainWorkerCoverageTests.PublishOneAsync_EnvelopeDoesNotDeserialize_LogsTheAttemptAtWarningWithItsExceptionAsync} |
| EventId 14, `Error processing perspective cursor` (standard path and the collective sink's apply) | `Whizbang.Core.Workers.PerspectiveWorker` | The failure is recorded against the leased rows, which are backed off and dead-lettered at the bound | {verified: PerspectiveWorkerDeepPathChannelTests.Worker_RunnerThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, PerspectiveWorkerCollectiveSinkTests.CollectiveSink_DispatchThrows_LogsTheAttemptAtWarningWithItsExceptionAsync} |
| `Drain mode: Error processing perspective` (no EventId) | `Whizbang.Core.Workers.PerspectiveWorker` | The same, on the drain path: the leased rows are parked and retried | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_OtherFailure_IsNotClassifiedAsStoredFormButParksItsRowsAsync} |
| `Error processing first event ... no progress to save` and `Failed to save partial progress` (no EventId) | The generated perspective runner | The runner rethrows to the perspective worker, which logs EventId 14 and retries; the runner's other partial-progress line was already a Warning | {verified: PerspectiveRunnerAttemptFailureLogLevelTests.RunFailsBeforeAnyEventApplies_LogsNoProgressToSaveAtWarningWithItsExceptionAsync, PerspectiveRunnerAttemptFailureLogLevelTests.PartialProgressCannotBeSaved_LogsTheSaveFailureAtWarningWithItsExceptionAsync} |
| `Error processing message` and `Error processing session message` (no EventId) | `Whizbang.Transports.AzureServiceBus.AzureServiceBusTransport` | Service Bus abandons the delivery for redelivery, or dead-letters it at `MaxDeliveryAttempts`; the record is logged when the [dead-letter drain](../dead-letter-queue/transport-recovery) takes it into custody | {verified: AzureServiceBusTransportReceiveGuardTests.ProcessMessage_WhenThePolicyNamesAnUnrecognizedAction_LeavesTheMessageUnsettledAsync, AzureServiceBusTransportReceiveGuardTests.ProcessSessionMessage_WhenThePolicyNamesAnUnrecognizedAction_LeavesTheMessageUnsettledAsync} |
| `Failed to publish message` and the `SendMessageAsync timed out` line (no EventId) | `Whizbang.Transports.AzureServiceBus.AzureServiceBusTransport` | Logged and rethrown to the outbox, which retries the publish and dead-letters it at the bound | {verified: AzureServiceBusTransportPublishPathTests.PublishAsync_SendFails_LogsTheAttemptAtWarningWithItsExceptionAndRethrowsAsync, AzureServiceBusTransportPublishPathTests.PublishAsync_SendNeverCompletes_ThrowsTimeoutExceptionAsync} |
| `Error processing message` and `Error processing batch ... NACKing for redelivery` (no EventId) | `Whizbang.Transports.RabbitMQ.RabbitMQTransport` | The message is requeued, or dead-lettered past the queue's delivery limit and recorded by the dead-letter drain | {verified: RabbitMQTransportLoggingBranchTests.Receive_HandlerThrowsBelowMaxWithLogger_LogsTheAttemptAndRetryAtWarningAsync, RabbitMQTransportBatchFlushBranchTests.Flush_HandlerThrowsGenericWithLogger_LogsAndNacksEachForRedeliveryAsync} |
| `Failed to publish message` (no EventId) | `Whizbang.Transports.RabbitMQ.RabbitMQTransport` | Logged and rethrown to the outbox | {verified: RabbitMQTransportLoggingBranchTests.PublishAsync_GenericFailureWithLogger_LogsThePublishAttemptAtWarningAsync} |
| EventIds 90 and 91, `Transport batch of <n> message(s) failed` | `Whizbang.Core.Workers.TransportConsumerWorker` | The batch is reported to the transport as [failed](../../messaging/transports/transport-consumer#failed-batches) and redelivered; the host stays up | {verified: TransportBatchGuardTests.AnOrdinaryFaultFailsTheBatchTooAsync, TransportBatchGuardTests.AStatementTimeoutFailsTheBatchAsATypedSignalNotACancellationAsync, TransportBatchGuardTests.ACanceledBATCHTokenIsStillContainedWhileTheHostIsAliveAsync} |
| EventId 16, `Error processing message`, and EventId 14, `Queued failure` | `Whizbang.Core.Workers.ServiceBusConsumerWorker` | Rethrown for redelivery, or queued as an inbox failure under the attempts bound | {verified: ServiceBusConsumerWorkerCoverageTests.HandleMessage_WhenProcessingThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, ServiceBusConsumerWorkerCoverageTests.HandleMessage_WhenAStreamFails_LogsTheQueuedFailureAtWarningAsync} |
| EventIds 6 and 10, `Failed to process message` and `Failed to process outbox message` | `Whizbang.Core.Messaging.OrderedStreamProcessor` | The failure handler records the attempt | {verified: OrderedStreamProcessorTests.ProcessInboxWorkAsync_WithLogger_OnFailure_LogsFailureAndStopAsync, OrderedStreamProcessorTests.ProcessOutboxWorkAsync_WithLogger_OnFailure_LogsFailureAsync} |

A failing post-apply receptor on the collective sink is not a retried attempt: the apply has committed and the
receptor is not run again. It logs the perspective worker's lifecycle failure line, EventId 22, at Error.
{verified: PerspectiveWorkerCollectiveSinkTests.CollectiveSink_PostApplyReceptorThrows_LogsTheLifecycleFailureAtErrorAsync}

### Lines the record replaced {#dead-letter-record-upgrade}

**Upgrade note.** The default level changes from Warning to Error, so an alert keyed on Error may start firing for
dead letters. To keep the old severity, set `Whizbang:DeadLetterLogging:Level` to `Warning`. A log query keyed on
the retired lines reads EventId 1901 instead:

| Before | Now |
|---|---|
| `InboxDispatchWorker` EventId 5, Warning (`dead-lettered message … attempts > max`) | The record |
| `OutboxPublishWorker` EventId 6, Warning (`dead-lettered … moved to wh_dead_letters`) | The record |
| `OutboxDrainWorker` EventId 10, Warning (`dead-lettered message … attempts > max`) | The record |
| `PerspectiveWorker` dead-letter Warning (`dead-lettered perspective event …`, no EventId) | The record; the failure counts and identities are in `LastError` |
| `TransportConsumerWorker` Error for a message it could not store (`could not be stored in the inbox and was dead-lettered with its body`) | The record, carrying the cause's exception. When custody fails too, the Critical line now names the cause's description |
| `InboxDispatchWorker` EventId 76 (undeserializable payload), Error | Warning; the record that follows carries the serializer's exception at the configured level |
| Batchers' `written to wh_dead_letters` batch summary, Error | Information; each message gets its own record from the recorder |
| Azure Service Bus and RabbitMQ drains' `imported message … into wh_dead_letters (duplicate=…)` Information | The record for an import; a duplicate keeps an Information line saying the broker copy was settled |

{verified: InboxDispatchWorkerUndeserializablePayloadTests.Dispatch_PayloadRefused_DeadLetterRecordCarriesTheRefusalAtErrorAsync, SlidingWindowInboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync, SlidingWindowOutboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync, TransportConsumerWorkerUnstorableMessageTests.SerializationFails_LogsTheDeadLetterRecordAtErrorWithTypeAndCauseAsync}

### Lines lowered to Warning {#retried-attempt-upgrade}

**Upgrade note.** The [retried attempts](#retried-attempts) were logged at Error before and are now logged at
Warning, so an alert keyed on any of them at Error stops firing. Alert on the record instead: EventId 1901,
`MessageDeadLettered`, logged once for each message that is dead-lettered, at the level
`Whizbang:DeadLetterLogging:Level` sets (Error by default). A query keyed on these lines by their text or EventId
still finds them, at Warning.

| Before | Now |
|---|---|
| `OutboxDrainWorker` EventIds 6 and 7, Error | Warning, with the attempt's exception |
| `PerspectiveWorker` EventId 14 and the drain-mode `Error processing perspective`, Error | Warning, with the attempt's exception |
| The generated perspective runner's `no progress to save` and `Failed to save partial progress`, Error | Warning, with the exception; the worker's EventId 14 follows |
| Azure Service Bus `Error processing message`, `Error processing session message`, `Failed to publish message` and the send timeout, Error | Warning, with the exception |
| RabbitMQ `Error processing message`, `Error processing batch` and `Failed to publish message`, Error | Warning, with the exception |
| `TransportConsumerWorker` EventIds 90 and 91 (the transport batch guard), Error | Warning, with the exception |
| `ServiceBusConsumerWorker` EventIds 14 and 16, Error | Warning |
| `OrderedStreamProcessor` EventIds 6 and 10, Error | Warning, with the exception |
| The collective sink's failing post-apply receptor, `PerspectiveWorker` EventId 14, Error | `PerspectiveWorker` EventId 22, the lifecycle receptor failure line, still Error |

The lines in [unbounded retries](#unbounded-retries) are unchanged and still logged at Error.

## Hierarchical Filtering {#hierarchy}

.NET logging categories are hierarchical. Setting a parent category affects all children:

```json{title="Silence All Whizbang Logging" description="Use hierarchical filtering to silence everything at once" category="Configuration" difficulty="INTERMEDIATE" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang": "Warning"
    }
  }
}
```

This sets **all** categories starting with `Whizbang` to `Warning`, including `Whizbang.Initialization`, `Whizbang.Core.Dispatcher`, `Whizbang.Transports.RabbitMQ`, etc. You can then selectively re-enable specific categories:

```json{title="Silence All, Enable One" description="Hierarchical filter with selective override" category="Configuration" difficulty="INTERMEDIATE" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang": "None",
      "Whizbang.Initialization": "Information"
    }
  }
}
```

## Log Levels Reference {#levels}

| Level | Use | What it means for a message |
|-------|-----|-----------------------------|
| `Trace` | Hot-path per-message breadcrumbs (e.g. `ImmediateWorkCoordinatorStrategy` dispatch steps), off unless explicitly enabled | |
| `Debug` | Step-level detail (individual migrations, SQL operations, batch grouping, per-subscription info) | |
| `Information` | Summaries and milestones (initialization complete, worker started, batch sizes) | A batch the batchers dead-lettered is summarized here; each of its messages has its own record |
| `Warning` | Recoverable issues (schema drift, failed maintenance, connection retries) | An attempt failed and will be retried; logged on [every path](#retried-attempts) with the attempt's exception. Also the dead-letter record, when `Whizbang:DeadLetterLogging:Level` is `Warning` |
| `Error` | Failures that abort an operation or that retrying will not fix (migration failure, a worker loop's lost batch, a lifecycle receptor that threw) | The message was [dead-lettered](#dead-lettered-messages) and will not be processed unless it is recovered (the default level of the record) |
| `Critical` | Failures that put the host or a message's custody at risk | A received message could be neither stored nor dead-lettered; its batch is failed so the broker delivers it again |
| `None` | Completely silent | |

{verified: InboxDispatchWorkerDeadLetterLogTests.Dispatch_ThatThrowsBelowTheBound_LogsWarningAndNoRecordAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_MovedToTheDeadLetterStore_LogsOneErrorRecordWithTypeAndLastErrorAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_ConfiguredWarning_LogsTheRecordAtWarningAsync, TransportConsumerWorkerUnstorableMessageTests.CustodyUnavailable_BatchFailsAfterStoringNeighborsAsync, OutboxDrainWorkerCoverageTests.PublishOneAsync_PublishThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, PerspectiveWorkerCollectiveSinkTests.CollectiveSink_PostApplyReceptorThrows_LogsTheLifecycleFailureAtErrorAsync}

### Unbounded retries still logged at Error {#unbounded-retries}

A few failures are retried with no bound, so the work is never dead-lettered and no record is ever logged. Their
Error line is their only signal, so they stay at Error until each has a bound
([#1983](https://github.com/whizbang-lib/whizbang/issues/1983)). These are the known exceptions to "Error means
dead-lettered":

| Line | Category | Why it stays at Error |
|---|---|---|
| EventId 58, `Perspective rewind failed` | `Whizbang.Core.Workers.PerspectiveWorker` | The stream retries on the next cycle with no failure recorded |
| EventId 65, `cannot read its stored document` | `Whizbang.Core.Workers.PerspectiveWorker` | Logged once per stream; the document needs a rewrite before it can be read |
| `Drain mode: DeserializeStreamEvents threw` (no EventId) | `Whizbang.Core.Workers.PerspectiveWorker` | The pass is skipped and the same events are fetched again, without a failure being counted |
| EventId 5, `failed to deserialize envelope` | `Whizbang.Core.Workers.InboxDrainWorker` | The row is skipped and fetched again, never failed |
| EventId 73, composite `commit failed` | `Whizbang.Core.Workers.InboxDispatchWorker` | The composite is offered again without counting an attempt |
| EventId 3, `BatchFlusher dropped a batch` | `Whizbang.Core.Workers.BatchFlusher` | The batch is dropped after its flush retries; the rows behind it are claimed again when their leases expire |

The batchers also log a batch they could not dead-letter either (`could not be written to wh_dead_letters either`)
at Error, not Critical: those messages are lost unless their source sends them again.

To alert on dead letters alone, key on EventId 1901 or the name `MessageDeadLettered` rather than on the level.

## Recommended Development Configuration {#recommended}

A good starting point for local development that keeps the console readable:

```json{title="Recommended Development Overrides" description="Balanced configuration for local development" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Configuration", "Development"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning",
      "Npgsql": "Warning",
      "Whizbang.Initialization": "None",
      "Whizbang.Core.Dispatcher": "None",
      "Whizbang.Core.Workers.PerspectiveWorker": "None",
      "Whizbang.Core.Workers.TransportConsumerWorker": "None",
      "Whizbang.Core.Workers.OutboxPublishWorker": "Warning",
      "Whizbang.Core.Tags.MessageTagProcessor": "None",
      "Whizbang.Transports.RabbitMQ": "Warning"
    }
  }
}
```
