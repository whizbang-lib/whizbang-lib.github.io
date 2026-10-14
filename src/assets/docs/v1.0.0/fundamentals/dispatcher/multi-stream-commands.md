---
title: Multi-Stream Commands
pageType: concept
version: 1.0.0
category: "Core Concepts"
order: 6
description: >-
  A command that names a set of streams and is worked one stream at a time, each stream on the instance that owns it.
  Any instance can take the command in; every instance works only its own streams, under the same ownership rule
  that decides who processes each stream's live work, and each stream's outcome is recorded until the run completes.
tags: 'multi-stream-commands, stream-ownership, partition-assignment, bulk-operations, repair, rebuild, commands'
codeReferences:
  - src/Whizbang.Core/MultiStream/IMultiStreamCommand.cs
  - src/Whizbang.Core/MultiStream/IMultiStreamCommandHandler.cs
  - src/Whizbang.Core/MultiStream/MultiStreamCommandIntake.cs
  - src/Whizbang.Core/MultiStream/MultiStreamCommandWorker.cs
  - src/Whizbang.Core/MultiStream/MultiStreamCommandOptions.cs
  - src/Whizbang.Core/MultiStream/IMultiStreamCommandStore.cs
  - src/Whizbang.Core/MultiStream/MultiStreamScope.cs
  - src/Whizbang.Core/MultiStream/MultiStreamCommandServiceCollectionExtensions.cs
  - src/Whizbang.Core/Events/System/MultiStreamCommandCompleted.cs
  - src/Whizbang.Data.Postgres/MultiStream/PgMultiStreamCommandStore.cs
  - src/Whizbang.Data.Postgres/MultiStream/MultiStreamCommandRegistration.cs
  - src/Whizbang.Data.Postgres/Migrations/208_MultiStreamCommands.sql
  - src/Whizbang.Core/Commands/System/RebuildPerspectiveStreamsCommand.cs
  - src/Whizbang.Core/Perspectives/RebuildPerspectiveStreamsHandler.cs
  - src/Whizbang.Data.EFCore.Postgres/RebuildPerspectiveCommandReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/RebuildBackgroundQueue.cs
  - src/Whizbang.Core/Workers/NullPartitionAssignmentSource.cs
testReferences:
  - tests/Whizbang.Core.Tests/MultiStream/MultiStreamCommandIntakeTests.cs
  - tests/Whizbang.Core.Tests/MultiStream/MultiStreamCommandRegistrationTests.cs
  - tests/Whizbang.Core.Tests/MultiStream/MultiStreamCommandWorkerTests.cs
  - tests/Whizbang.Core.Tests/MultiStream/MultiStreamScopeTests.cs
  - tests/Whizbang.Core.Component.Tests/MultiStream/MultiStreamCommandWorkerLoopTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStream/MultiStreamCommandStoreSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStream/MultiStreamCommandPostgresRegistrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStream/MultiStreamCommandEndToEndTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStream/RebuildCommandRoutingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStream/RebuildBackgroundWorkerTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/MultiStream/DapperMultiStreamCommandTests.cs
  - tests/Whizbang.Core.Tests/MultiStream/RebuildPerspectiveStreamsHandlerTests.cs
lastMaintainedCommit: '78370069'
---

# Multi-Stream Commands

Some operations name many streams at once: repair these records, re-index those orders, re-emit state for a set of
aggregates. Sent as an ordinary command, such an operation runs on whichever instance receives it, and that instance
then works streams other instances own, concurrently with their live work. The last writer wins.

A **multi-stream command** keeps every stream's work on the stream's owner:

1. Any instance of the service takes the command in and records a **run**: the command, its security scope, and one
   work item per stream.
2. Every instance claims only the run's streams **it owns**, by the rule that already decides which instance processes
   each stream's live work, and calls the command's handler **once per stream**.
3. Each stream's outcome is recorded. The run **completes** when every stream has one, and
   `MultiStreamCommandCompleted` is published.

Applications use the same mechanism as the framework, for their own bulk operations.

## Defining one {#definition}

A command opts in by implementing `IMultiStreamCommand`: a run id the caller chooses, and the streams to work.

```csharp{title="A multi-stream command and its handler" description="Define a command over many streams and the handler that works one stream" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Multi-Stream Commands"] tests=["MultiStreamCommandRegistrationTests.InvokeAsync_ReadsThePayloadBackAndCallsTheHandlerForThatStreamAsync", "MultiStreamCommandEndToEndTests.ACommandOverManyStreams_IsWorkedOncePerStreamEachOnItsOwnerAsync"]}
public sealed record ReindexOrders(Guid RunId, IReadOnlyList<Guid> StreamIds, string Reason) : IMultiStreamCommand;

public sealed class ReindexOrdersHandler(IOrderIndex index) : IMultiStreamCommandHandler<ReindexOrders> {
  public async ValueTask HandleStreamAsync(ReindexOrders command, Guid streamId, CancellationToken cancellationToken) {
    await index.ReindexAsync(streamId, cancellationToken);
  }
}
```

## Handlers {#handlers}

The handler works **one stream** per call. It is resolved from a fresh scope for each stream, on the instance that owns
that stream.

> **Make the handler idempotent.** A stream can be worked more than once: the instance working it can stop before its
> outcome is recorded, and during a rebalance two instances can briefly disagree about who owns it. Doing a stream's
> work twice must leave the same result as doing it once.

## Registration {#registration}

Register the handler. One command has exactly one handler; registering a different one for the same command throws.

```csharp{title="Registering a multi-stream command handler" description="AddMultiStreamCommandHandler binds the command, its handler and its intake" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Multi-Stream Commands", "Registration"] tests=["MultiStreamCommandRegistrationTests.AddMultiStreamCommandHandler_RegistersOneBindingNamedForTheCommandTypeAsync", "MultiStreamCommandRegistrationTests.AddMultiStreamCommandHandler_ASecondHandlerForTheSameCommand_IsRefusedAsync"]}
services.AddMultiStreamCommandHandler<ReindexOrders, ReindexOrdersHandler>();
```

The registration is generic over the command type at compile time, so nothing is discovered by reflection and it is
AOT-safe. It registers the command's **intake**, a receptor at the stages a receptor without `[FireAt]` runs at, so the
command is recorded whether it is dispatched within the service or arrives from the transport.

Both Postgres drivers supply the store and the worker:

- **EF Core** (`AddWhizbangPostgresNotifications`, which the turnkey registration calls). New runs are announced on
  the shared notification connection, and claims rank by the published partition assignment.
- **Dapper** (`AddWhizbangPostgres`). With no notification connection, the worker finds new runs by polling every
  `PollInterval`. With no elected assigner, the live instances rank themselves, as Dapper's work claim does.

Without a store, the intake refuses the command rather than accept one nothing would run.

## Sending one {#sending}

Send it like any command. Give it a new run id; the run is recorded and read by it.

```csharp{title="Sending a multi-stream command" description="Send once; every instance works its own streams" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Multi-Stream Commands"] tests=["MultiStreamCommandIntakeTests.HandleAsync_RecordsOneRunCarryingTheCommandAndItsStreamsAsync"]}
var runId = TrackedGuid.New();
await dispatcher.SendAsync(new ReindexOrders(runId, orderIds, "index format changed"));
```

## Intake {#intake}

The intake validates the command and records the run. It runs no stream itself.

| Input | Result |
|---|---|
| No run id | Refused (`ArgumentException`) |
| An empty stream list, or none | Refused. An empty list is never read as "every stream". |
| An empty stream id in the list | Refused |
| A stream named twice | Worked once |
| The same run id again (a redelivery, or the command recorded both before the outbox and after the inbox) | Recorded once; the repeat is logged and accepted |
| No store registered | Refused (`InvalidOperationException`) |

### Storage {#storage}

The run and its streams are kept by the storage driver's `IMultiStreamCommandStore` (Postgres: migration 208). The
command is stored as written, as text, so a polymorphic type discriminator keeps its place.

## Security scope {#security-scope}

A stream is worked later, on another instance, so the intake records the **security scope the command was sent with**
(tenant, user, roles, permissions, principals, claims) and the worker restores it around each handler call. A command
sent with no scope is worked with none, never under whatever scope the worker's thread happens to carry.

## Ownership {#ownership}

An instance claims a run's stream when it owns the stream, by the rule the work claim uses:

1. **The stream's lease is this instance's.** The instance processing the stream's live work holds a lease on it; that
   instance works it here too.
2. **Otherwise, unless a live sibling holds the stream's lease, its partition decides.** A stream hashes to one of
   10,000 partitions, and the [published partition assignment](../work-coordinator/partition-assignment.md) gives each
   partition to one live instance. Without a current assignment, the live instances rank themselves by id, exactly as
   the work claim's fallback does.

An expired lease, or a lease held by an instance with no heartbeat, is not ownership: the partition decides. The
partition hash stays in the database, so the rule has one implementation.

A claimed stream is **leased** to the claiming instance (`Lease`, 5 minutes by default). An instance that stops
mid-stream lets the lease lapse, and the stream is offered again, to its owner at that time, as the next attempt.

The claim reads the work tables' stream leases and never writes them, so it adds nothing to the work claim's lock
order. An unowned stream's live work goes to its partition owner, the same instance this rule picks.

## Outcomes {#outcomes}

| Handler | Recorded |
|---|---|
| Returns | Succeeded. Final. |
| Throws, attempts below `MaxAttempts` | Released for another attempt |
| Throws, at `MaxAttempts` | Failed, with the exception's type and message. Final. |
| Its own cancellation (a timeout inside the handler) | A failed attempt, retried like any failure |
| The host stops | Nothing: streams already finished in the pass are recorded; the unfinished one is offered again |
| No handler for the command on this instance (a rolling update) | Released without counting an attempt, logged, and offered again after `NoHandlerRetryDelay` |

An outcome counts only from the instance holding the stream, so a worker whose claim lapsed cannot record over the
instance that took it over.

The run **completes exactly once**, when its last stream reports, even when its last two streams finish at the same
moment on two instances. The instance that completes it publishes `MultiStreamCommandCompleted` (run id, command type,
stream count, succeeded, failed) in **the run's own stream**, never in one of the streams the run worked, and raises
`MultiStreamCommandWorker.OnRunCompleted`. Publishing is best effort: a run whose streams were worked is not undone
because its announcement failed.

Read a run's progress at any time with `IMultiStreamCommandStore.ReadRunAsync(runId)`: stream count, succeeded,
failed, pending, and when it completed.

## The worker {#worker}

`MultiStreamCommandWorker` runs on every instance. A pass claims up to `BatchSize` of this instance's pending streams,
works them, and records their outcomes. A pass runs:

- when a new run is recorded (the store announces it on the `wh_multi_stream_work` channel, which every instance
  listens to on its shared notification connection);
- immediately after a pass that claimed a full batch;
- at least every `PollInterval`.

It waits for the schema before its first pass, and a failed pass is logged and followed by the next. It does not run
when disabled, when no store is registered, or when the service registered no multi-stream handlers.

## Retention {#retention}

Completed runs are deleted after `CompletedRunRetention` (7 days), checked every `PurgeInterval`. A run with a pending
stream is never deleted, however old.

## Configuration {#configuration}

Bound from `Whizbang:MultiStreamCommands`. A value that does not parse keeps its default; a zero or negative count or
interval stops the worker at start.

```json{title="Multi-stream command settings" description="Every setting with its default" category="Configuration" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Multi-Stream Commands", "Configuration"] tests=["MultiStreamCommandPostgresRegistrationTests.Options_BindFromTheirSectionAsync", "MultiStreamCommandWorkerTests.Options_Validate_RefusesANonPositiveSettingAsync"]}
{
  "Whizbang": {
    "MultiStreamCommands": {
      "Enabled": true,
      "BatchSize": 50,
      "Lease": "00:05:00",
      "MaxAttempts": 3,
      "NoHandlerRetryDelay": "00:01:00",
      "PollInterval": "00:00:30",
      "CompletedRunRetention": "7.00:00:00",
      "PurgeInterval": "01:00:00"
    }
  }
}
```

The partition count is the work claim's (`ClaimWorkerOptions.PartitionCount`), so a stream's partition here is the
one its live work is claimed by.

## Rebuilds use it {#rebuilds}

A `RebuildPerspectiveCommand` is a multi-stream command under the hood.

- **Named streams, or an in-place rebuild.** The instance that receives the command records one run per perspective,
  and each stream is rebuilt by its owner, serialized with that stream's live work.
  - An in-place rebuild's streams are those carrying the perspective's events.
  - A rebuild with a request id makes the same run however often the command is delivered.
  - An empty stream list records nothing.
- **A whole-perspective blue-green rebuild** builds and swaps one table, so it stays one job. It is queued to a
  background worker on the receiving instance, off the message handler's time budget. It swaps nothing until it
  completes, so an interrupted or failed one leaves the live table as it was.

## Related

- [Partition assignment](../work-coordinator/partition-assignment.md): who owns which partition
- [Work coordination](../../messaging/work-coordination.md): stream leases and the work claim
- [Namespace-based routing](routing.md#system-commands): how commands reach a service
