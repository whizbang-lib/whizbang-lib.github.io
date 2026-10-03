---
title: Purging Streams
pageType: guide
version: 1.0.0
category: Infrastructure
order: 9
description: >-
  Remove durable streams that should never have existed from one service's
  store: events, perspective rows and bookkeeping, in audited batches, with a
  dry run first, and keep them purged
tags: >-
  operations, purge, streams, cleanup, orphaned streams, audit, dry run, cli,
  IStreamPurger
codeReferences:
  - src/Whizbang.Core/Messaging/IStreamPurger.cs
  - src/Whizbang.Data.Postgres/PostgresStreamPurger.cs
  - src/Whizbang.Data.Postgres/Migrations/180_StreamPurge.sql
  - tools/Whizbang.CLI/Program.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Operations/StreamPurgeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamPurgeTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamPurgeRequestTests.cs
---

# Purging Streams

Whizbang destroys data on its own schedule: ephemeral events once consumed, rows past their TTL, history closed at a period boundary. None of those removes a **durable stream that should never have existed**, for example:

- events received for an entity the origin service does not have;
- the leftovers of a dead-letter batch replayed the wrong way, which created streams with fresh ids and no tenant.

Cleaning those up by hand means SQL across the event store, every perspective's rows, perspective work and cursors, snapshots and deduplication entries, and it is easy to leave them inconsistent. The stream purge does it in one supported step, for an explicit list of stream ids, from one service's store.

## What a purge removes

Everything keyed by the listed streams, in one transaction per batch:

| Area | Tables |
|---|---|
| Events | `wh_event_store`, `wh_event_body`, `wh_event_archive`, `wh_event_destruction_hold`, `wh_lifecycle_completions` |
| Perspectives | every registered perspective table's row for the stream, `wh_perspective_events`, `wh_perspective_cursors`, `wh_perspective_snapshots`, `wh_perspective_applied`, `wh_perspective_row_hold`, `wh_row_eviction_journal`, `wh_apply_fold_watermarks` |
| Messaging | `wh_outbox`, `wh_inbox`, `wh_inbox_state`, `wh_message_deduplication` (the stream's events and inbox messages), `wh_receptor_processing`, `wh_active_streams` |
| Integrity | `wh_stream_digests`, `wh_integrity_ledger`; the sealed epochs the events covered are refolded and the origin generation is bumped once, as a stream close does |

Dead letters are left alone: maintenance settles a dead letter whose stream no longer exists.

Then, so the purge holds:

- **Every purged stream is marked purged for every perspective** (`wh_stream_purge_markers`, perspective `*`). A later event on it is skipped by every perspective instead of recreating a row; see [Purge stays purged](../../fundamentals/perspectives/perspectives-with-actions.md#purge-stays-purged). Only an Apply that returns `Resurrect` brings a row back.
- **Each committed batch is audited** in `wh_stream_purge_audit`: the purge id, the batch, who asked, why, when, the stream ids, and the rows removed per table.

Deleting a stream's deduplication entries means a message of that stream delivered again is processed again. Stop whatever produces messages for the streams before you purge them.

## Run it from the CLI

Always look first. A dry run reports the rows per table that would go and changes nothing:

```bash{title="Dry run" description="Count what a purge would remove, change nothing" category="Operations" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Purge", "CLI"] tests=["StreamPurgeTests.DryRun_CountsWhatWouldGo_AndChangesNothingAsync"]}
whizbang streams purge \
  --connection "Host=...;Database=...;Username=..." \
  --schema public \
  --streams-file orphaned-streams.txt \
  --reason "created by a replay that minted fresh ids" \
  --dry-run
```

Then purge:

```bash{title="Purge" description="Remove the streams, audited, one transaction per batch" category="Operations" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Purge", "CLI"] tests=["StreamPurgeTests.Purge_RemovesEveryRowOfTheStreams_AndLeavesOthersAsync"]}
whizbang streams purge \
  --connection "Host=...;Database=...;Username=..." \
  --schema public \
  --streams-file orphaned-streams.txt \
  --reason "created by a replay that minted fresh ids" \
  --requested-by "ops-oncall"
```

| Option | Meaning |
|---|---|
| `--connection`, `-c` | The service's database |
| `--schema`, `-s` | The service's schema (default `public`) |
| `--stream <id>` | A stream to purge; repeat it for several |
| `--streams-file`, `-f` | A file of stream ids, one per line; `#` starts a comment |
| `--reason`, `-r` | Why, recorded in the audit (required) |
| `--requested-by`, `-u` | Who, recorded in the audit (default: the OS user) |
| `--dry-run` | Count, change nothing |
| `--batch-size`, `-b` | Streams per transaction (default 100) |
| `--purge-id`, `-p` | Resume an earlier purge: batches it committed are skipped |

The empty stream id is refused: it stands for "no stream", and purging it would reach every streamless row.

## Run it from a service

Both Postgres drivers register `IStreamPurger`. Inject it wherever an operator action lives, such as an admin endpoint:

```csharp{title="IStreamPurger" description="Purge streams from inside a service" category="Operations" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Purge", "IStreamPurger"] tests=["StreamPurgeTests.Purge_RemovesEveryRowOfTheStreams_AndLeavesOthersAsync", "StreamPurgeRequestTests.Report_TotalsTheBatchesThatRan_AndFormatsThemAsync"]}
public sealed class PurgeEndpoint(IStreamPurger purger) {
  public async Task<string> PurgeAsync(IReadOnlyList<Guid> streamIds, string operatorName, string reason, bool dryRun) {
    var report = await purger.PurgeAsync(new StreamPurgeRequest {
      StreamIds = streamIds,
      RequestedBy = operatorName,
      Reason = reason,
      DryRun = dryRun,
    });
    return report.Format();   // rows per table, and any batch another instance already claimed
  }
}
```

## Only one instance runs a batch

Each batch takes the existing `PublishOnceAsync` claim (`wh_unique_emission_claims`) keyed by the purge id and the batch index, inside the batch's own transaction:

- a second instance running the same request finds the claim and skips the batch (the report shows it as not run);
- a crash rolls the claim back with the batch, so nothing is half done and nothing is left claimed;
- running the request again with the same `PurgeId` (`--purge-id`) skips the batches it committed and runs the rest.

```csharp{title="Resuming a purge" description="The same purge id skips what already committed" category="Operations" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Purge"] tests=["StreamPurgeTests.Batches_AreClaimedOnce_AndARerunSkipsWhatCommittedAsync"]}
var request = new StreamPurgeRequest {
  StreamIds = streamIds, RequestedBy = "ops-oncall", Reason = "orphaned", BatchSize = 100,
};
var first = await purger.PurgeAsync(request);    // stopped partway: some batches committed
var resumed = await purger.PurgeAsync(request);  // the same PurgeId: committed batches are skipped
```

A dry run takes no claim.

## Afterwards

- A late event for a purged stream is skipped by every perspective and counted in `whizbang.perspective.purged_events_skipped`.
- The audit answers who removed what: `SELECT * FROM wh_stream_purge_audit WHERE purge_id = '...'`.
- A perspective that reads the stream's events keeps working: the events are gone from the store, so a rebuild never meets them, and the purge marker keeps a rebuild from recreating a row out of anything that arrives later.

## Related

- [Perspectives with Actions: purge stays purged](../../fundamentals/perspectives/perspectives-with-actions.md#purge-stays-purged)
- [Migrations](migrations.md): migration 180 adds the purge function, the markers and the audit
- [Dead-letter recovery](../dead-letter-queue/recovery.md): the usual source of a replay worth cleaning up after
