---
title: Perspective Rewind
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  How Whizbang detects and repairs out-of-order (late-arriving) events in
  perspective processing — the RewindRequired flag, snapshot-or-full replay, the
  bounded catch-up loop, startup scan, and rewind observability.
order: 13
tags: >-
  perspectives, rewind, late-arriving-events, out-of-order, replay, snapshots,
  startup-scan, observability, operational
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveRewindOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/022_StorePerspectiveEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/005_CreateCompletePerspectiveCheckpointFunction.sql
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRewindOptionsTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveSnapshotAndRewindTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRewindCompletionGapTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveRewindMetricsTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerRewindTests.cs
  - tests/Whizbang.Core.Tests/Events/System/StreamRewindEventTests.cs
---

# Perspective Rewind

Rewind is the mechanism that keeps a perspective correct in the face of **out-of-order events**. Perspective events are ordered by their UUID7 `event_id` (UUID7 encodes a timestamp in its most-significant bits). When a **newly-stored** event has an `event_id` that is *older* than the position the perspective's cursor has already advanced past, the perspective would otherwise miss that event forever. Rewind detects this, replays the stream's events — restoring from a [snapshot](snapshots.md) when one is available — and re-applies them in correct chronological order so the read model converges on the right state.

Rewind builds on two neighbouring subsystems:

- [Snapshots](snapshots.md) — the periodic model-state captures a rewind restores from, so replay does not always start at event zero.
- [Stream Locking](stream-locking.md) — the per-stream lock a rewind holds so live event application cannot interleave with the replay.

## How Rewind Works

A rewind has two halves: **detection** (a SQL flag set when the late event lands) and **execution** (the C# worker + generated runner that replay the stream).

### Detection

Detection lives in the `store_perspective_events` SQL function, which inserts newly-arriving perspective-event work items. For each event that was *newly* stored (not a duplicate), it compares the event's id against the perspective cursor's `last_event_id`:

```sql{title="Out-of-order detection" description="store_perspective_events flags RewindRequired when a newly-stored event is older than the cursor, keeping the earliest late event" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Detection"]}
-- Out-of-order detection: if event_id is older than the cursor's last_event_id,
-- the perspective missed this event and needs a rewind from snapshot.
IF EXISTS (
  SELECT 1 FROM wh_perspective_cursors pc
  WHERE pc.stream_id = v_event.v_stream_id
    AND pc.perspective_name = v_event.v_perspective_name
    AND pc.last_event_id IS NOT NULL
    AND v_event.v_event_id < pc.last_event_id
) THEN
  UPDATE wh_perspective_cursors
  SET status = status | 32,               -- RewindRequired flag (1 << 5)
      rewind_trigger_event_id = v_event.v_event_id
  WHERE stream_id = v_event.v_stream_id
    AND perspective_name = v_event.v_perspective_name
    AND (rewind_trigger_event_id IS NULL OR v_event.v_event_id < rewind_trigger_event_id);
END IF;
```

Two guarantees fall out of this:

- The **RewindRequired flag** is bit `32` (`1 << 5`) OR-ed onto the cursor `status`.
- `rewind_trigger_event_id` always holds the **earliest** late event seen — the `WHERE` clause only overwrites it with a *smaller* id — so the replay reaches back far enough to cover every late arrival.

There is a second, belt-and-suspenders detection path in `complete_perspective_cursor_work` (the function that records a runner's completion). After marking the events a runner actually processed, it looks for any still-unprocessed perspective event with an id *below* the cursor — an event that slipped in during processing and was never applied — and flags RewindRequired for it too. That same completion function **clears** `rewind_trigger_event_id`, `rewind_flagged_at`, and `rewind_first_flagged_at` on a successful run, resetting the cursor so a repaired stream does not rewind in a loop.

### Execution

The `PerspectiveWorker` picks up a stream whose cursor carries the RewindRequired flag and runs `_executeRewindPathAsync`:

1. **Acquire a stream lock** (`reason = "rewind"`) via `IPerspectiveStreamLocker`. If the lock is held by another instance, the worker logs and **defers** — the stream retries on a later cycle (it does not fail).
2. **Start a keepalive task** that renews the lock while the replay runs.
3. Call `runner.RewindAndRunAsync(streamId, perspectiveName, triggeringEventId, ct)`.
4. The generated runner looks for the **latest snapshot before the trigger** (see [Snapshot selection](#snapshot-selection)). If found, it restores that model and replays forward from the snapshot; if not, it replays from event zero (a full replay).
5. The replay is **in-memory** — events are applied without intermediate DB writes, so Lenses keep seeing the pre-replay model. It is not a single pass: a bounded **catch-up loop** re-reads the event store after each apply pass so events that land *during* the replay window are not lost (see [Catch-up loop](#catch-up-loop)).
6. A **single atomic write** of the model + cursor happens once the loop drains, and then the **keepalive stops and the lock is released** (always, in a `finally`).

```csharp{title="Rewind execution path" description="PerspectiveWorker acquires the rewind lock, runs the generated runner, and releases the lock in a finally" framework="NET10" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Execution"]}
var lockAcquired = await _streamLocker.TryAcquireLockAsync(
    streamId, perspectiveName, _instanceProvider.InstanceId, "rewind", ct);
if (!lockAcquired) {
    // Another instance holds the lock — defer, retry next cycle
    return (Deferred, LockSkipped: true);
}
try {
    using var keepaliveCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    var keepaliveTask = _startLockKeepaliveAsync(streamId, perspectiveName, keepaliveCts.Token);

    // Restore-from-snapshot-or-full-replay happens inside the runner
    var result = await runner.RewindAndRunAsync(streamId, perspectiveName, rewindTriggerEventId, ct);

    await keepaliveCts.CancelAsync();
} finally {
    await _streamLocker.ReleaseLockAsync(streamId, perspectiveName, _instanceProvider.InstanceId, ct);
}
```

### Snapshot selection

Inside `RewindAndRunAsync`, the runner asks the [snapshot store](snapshots.md) for the nearest safe restore point before the late event, then replays from there:

- When the trigger's `commit_sequence` is known, it prefers `GetLatestSnapshotBeforeCommitSequenceAsync` (fully deterministic against the live-apply path).
- Otherwise it falls back to `GetLatestSnapshotBeforeAsync(streamId, perspectiveName, triggeringEventId)`.
- If no qualifying snapshot exists (or the snapshot's serialization version is stale), it performs a **full replay** from event zero.

The runner logs the decision it actually made at **Warning** (`Restoring … from snapshot at …` versus `… performing full replay …`). This is the authoritative record of the snapshot-vs-full outcome — the worker-emitted `replay_source`/`has_snapshot` observability signals report something subtly different (see [Snapshot-usage caveat](#snapshot-usage-caveat)).

Snapshots are created automatically during normal processing every `SnapshotEveryNEvents` events (default 100) and — during a rewind replay — at additional historical points every `RewindSnapshotIntervalEvents` events (default 10), so future rewinds for "very late" events still find something to roll back to. See [Perspective Snapshots](snapshots.md) for the store interface, `PerspectiveSnapshotOptions`, and tuning.

### Catch-up loop

The in-memory replay is **not a single pass**. `RunFromModelAsync` wraps the apply loop in a bounded catch-up loop: after applying a batch it re-reads the event store from the last event it applied, and if new events arrived during the apply window it applies those too. The loop exits when a read returns zero new events (the store is quiescent with respect to what the rewind has applied), and is bounded by `MAX_REWIND_CATCH_UP_ITERATIONS` (100) as a safety valve against a pathological append rate.

```csharp{title="Rewind catch-up loop" description="The runner re-reads the event store after each apply pass so events appended during the replay window are picked up, not dropped" framework="NET10" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Rewind", "Catch-up"]}
const int MAX_REWIND_CATCH_UP_ITERATIONS = 100;
var anchorEventId = replayFromEventId;   // snapshot event id, or null = from event zero
var iterations = 0;

while (true) {
    if (++iterations > MAX_REWIND_CATCH_UP_ITERATIONS) break; // sustained appends outrun apply

    // Read only the delta appended since the last event we applied.
    var events = await ReadPolymorphicAsync(streamId, anchorEventId, eventTypes, ct);
    if (events.Count == 0) break;         // quiescent — caught up to HEAD-at-commit

    foreach (var envelope in events.OrderByMessageId())
        (updatedModel, _) = ApplyEvent(perspective, updatedModel, envelope.Payload);

    // Advance the anchor so the next read returns only newer events.
    anchorEventId = lastSuccessfulEventId ?? events[^1].MessageId.Value;
}

// Single atomic write of model + cursor happens AFTER the loop drains.
```

This is the v0.688 fix for a slot-3 defect: the original implementation read the event list **once** and applied that fixed set, so events appended between `PerspectiveRewindStarted` and `PerspectiveRewindCompleted` were silently dropped (a bulk import completed the projection at 347/350 items even though all 350 events were durable). With the catch-up loop, the completed cursor reflects **HEAD-at-commit** rather than HEAD-when-the-replay-began. The behaviour is pinned by `PerspectiveRewindCompletionGapTests` (`FixedRewind_EventsAppendedDuringWindow_AreAppliedTooAsync` and `FixedRewind_NoLateAppends_StillTerminatesAsync`).

## Configuration

Rewind detection and execution are governed by `PerspectiveRewindOptions`:

```csharp{title="PerspectiveRewindOptions" description="Configuration record for rewind enablement, startup repair mode, concurrency, and the debounce knobs" framework="NET10" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Rewind", "Configuration"] tests=["PerspectiveRewindOptionsTests.Defaults_AllFieldsHaveExpectedValuesAsync", "PerspectiveRewindOptionsTests.RewindStartupMode_HasExpectedValuesAsync"]}
public class PerspectiveRewindOptions {
  // Master switch for rewind detection and execution.
  // When disabled, out-of-order events are detected but not replayed. Default: true.
  public bool Enabled { get; set; } = true;

  // Scan for and repair streams needing rewind on service startup. Default: true.
  public bool StartupScanEnabled { get; set; } = true;

  // Whether startup rewinds block polling or run in the background. Default: Blocking.
  public RewindStartupMode StartupRewindMode { get; set; } = RewindStartupMode.Blocking;

  // Maximum concurrent rewind operations. Default: 3.
  public int MaxConcurrentRewinds { get; set; } = 3;

  // Debounce window before executing a rewind. Default: 5 seconds.
  public TimeSpan DebounceWindow { get; set; } = TimeSpan.FromSeconds(5);

  // Hard cap on debounce duration. Default: 30 seconds.
  public TimeSpan MaxDebounceWindow { get; set; } = TimeSpan.FromSeconds(30);
}

public enum RewindStartupMode { Blocking = 0, Background = 1 }
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Enabled` | bool | `true` | Master switch for rewind detection and execution |
| `StartupScanEnabled` | bool | `true` | Scan for streams needing rewind on service startup |
| `StartupRewindMode` | `RewindStartupMode` | `Blocking` | `Blocking`: rewinds clear before serving reads. `Background`: rewinds run via normal polling |
| `MaxConcurrentRewinds` | int | `3` | Intended limit on parallel rewind operations |
| `DebounceWindow` | TimeSpan | `5s` | Intended window before a rewind executes (see [Debounce](#debounce)) |
| `MaxDebounceWindow` | TimeSpan | `30s` | Intended hard cap on the debounce window |

:::updated
At commit `1b31f58d`, `MaxConcurrentRewinds`, `DebounceWindow`, and `MaxDebounceWindow` are defined and unit-tested for their defaults, but no consuming code path reads them — only `StartupScanEnabled` and `StartupRewindMode` are honoured by `PerspectiveWorker`. Treat the debounce/concurrency knobs as present-but-not-yet-wired.
:::

The neighbouring `PerspectiveSnapshotOptions` (`Enabled=true`, `SnapshotEveryNEvents=100`, `MaxSnapshotsPerStream=5`, `RewindSnapshotIntervalEvents=10`) and `PerspectiveStreamLockOptions` (`LockTimeout=30s`, `KeepAliveInterval=10s`) govern the snapshot store a rewind restores from and the lock it holds during replay. See [Perspective Snapshots](snapshots.md) and [Perspective Stream Locking](stream-locking.md).

## Startup Scan

On startup the worker runs `_scanAndRepairRewindsOnStartupAsync`, which queries `wh_perspective_cursors` for rows carrying the RewindRequired flag (`(status & 32) = 32`). This catches rewinds that were flagged but never executed — for example if the service crashed before processing them.

- **Blocking mode** (default): after logging the scan summary, the worker re-queries `GetCursorsRequiringRewindAsync` on each polling interval (up to a bounded number of iterations) until no RewindRequired cursors remain, then reports completion. Repairs finish before reads are served.
- **Background mode**: the worker logs the summary and lets the normal channel-consumer loop pick the rewinds up. Faster startup, but projections may be briefly stale.

If the scan itself throws, the worker logs a warning and continues — the flagged rewinds are still processed during normal polling.

## Observability

### Log entries

Rewind logs are split across **two logger categories** so their levels can be tuned independently.

**`Whizbang.Core.Workers.PerspectiveWorker`** — runtime rewind operations:

| Level | EventId | When |
|-------|---------|------|
| Warning | 52 | `Perspective rewind required for {PerspectiveName} stream {StreamId} — cursor at {CursorEventId}, late event {TriggerEventId} ({EventsBehind} events behind)` |
| Warning | 53 | `Perspective rewind completed for {PerspectiveName} stream {StreamId} — replayed {EventsReplayed} events in {DurationMs}ms (from {ReplaySource})` |
| Error | 58 | `Perspective rewind failed for {PerspectiveName} stream {StreamId} — trigger event {TriggerEventId}. Stream will retry on next cycle.` |
| Warning | 43 | `Failed to acquire stream lock for rewind on {PerspectiveName} stream {StreamId}, deferring` |

> The EventId 53 `{ReplaySource}` token resolves to `"snapshot store available"` or `"no snapshot store"` — it reflects whether a snapshot store is configured, **not** whether this rewind actually restored from a snapshot (see [Snapshot-usage caveat](#snapshot-usage-caveat)). The *actual* snapshot-vs-full decision is on the runner's own Warning lines described under [Snapshot selection](#snapshot-selection).

**`Whizbang.Core.Workers.PerspectiveStartupScan`** — startup scan (configure independently):

| Level | EventId | When |
|-------|---------|------|
| Information | 54 | `Startup rewind scan started: {StreamCount} streams require rewind across {PerspectiveCount} perspectives` |
| Information | 55 | `Startup rewind scan completed: {StreamCount} streams, {PerspectiveCount} perspectives rewound in {DurationMs}ms` |
| Information | 57 | `Startup rewind scan: no streams require rewind` |
| Warning | 56 | `Error during startup rewind scan — rewinds will be processed during normal polling` |

```json{title="Log levels to see all rewind + startup-scan messages" description="Enable both rewind logger categories so runtime rewinds and the startup scan are visible" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Rewind", "Logging"]}
"Whizbang.Core.Workers.PerspectiveWorker": "Warning",
"Whizbang.Core.Workers.PerspectiveStartupScan": "Information"
```

### OTel metrics

Meter: **`Whizbang.Perspectives`** (defined in `PerspectiveMetrics`).

| Instrument | Type | Tags | Description |
|-----------|------|------|-------------|
| `whizbang.perspective.rewinds` | Counter | `perspective_name`, `has_snapshot` | Rewind operations triggered |
| `whizbang.perspective.rewind.duration` | Histogram (ms) | `perspective_name` | Replay duration |
| `whizbang.perspective.rewind.events_replayed` | Histogram | `perspective_name` | Events replayed per rewind |
| `whizbang.perspective.rewind.events_behind` | Histogram | `perspective_name` | Events behind the cursor when the rewind triggered |

The `has_snapshot` tag on the `rewinds` counter reflects snapshot-**store** availability, not actual usage (see [Snapshot-usage caveat](#snapshot-usage-caveat)). A failed rewind also increments the shared `whizbang.perspective.errors` counter.

### OTel span tags

Activity name: **`Perspective RewindAndRunAsync`** (emitted when perspective spans are enabled).

| Tag | Description |
|-----|-------------|
| `whizbang.perspective.name` | Perspective name |
| `whizbang.stream.id` | Stream being rewound |
| `whizbang.perspective.rewind_trigger_event_id` | Late event that triggered the rewind |
| `whizbang.perspective.rewind.events_behind` | Count at trigger time |
| `whizbang.perspective.rewind.events_replayed` | Count after completion |
| `whizbang.perspective.rewind.has_snapshot` | Whether a snapshot **store** was available |
| `whizbang.perspective.rewind.replay_source` | `"snapshot"` or `"full"` — derived from store availability, not actual replay path |

On failure, the span is set to `Error` status and tagged `whizbang.perspective.rewind.error` with the exception message.

#### Snapshot-usage caveat

The worker computes `hasSnapshot = _snapshotStore is not null` and feeds that single value into the `has_snapshot` metric tag, the span's `rewind.has_snapshot` / `rewind.replay_source` tags, and the EventId 53 log's replay-source token. That is **store availability**, not the decision the runner actually made: `replay_source` will read `"snapshot"` even when the runner performed a **full replay** because no qualifying snapshot existed for that stream, or the snapshot's serialization version was stale. When an operator needs the real answer:

- The runner's own **Warning** logs are authoritative — `Restoring {PerspectiveName} stream {StreamId} from snapshot at {SnapshotEventId} …` versus `… performing full replay …`.
- The `PerspectiveRewindStarted` system event's `HasSnapshot` property carries the runner's *actual* decision (it is set true only when a snapshot was loaded and applied), unlike the worker's store-availability tags.

### System events

The generated runner publishes a pair of system events around each perspective replay:

| Event | Properties | When |
|-------|-----------|------|
| `PerspectiveRewindStarted` | `StreamId`, `PerspectiveName`, `TriggeringEventId`, `ReplayFromSnapshotEventId`, `HasSnapshot`, `StartedAt` | Before replay begins |
| `PerspectiveRewindCompleted` | `StreamId`, `PerspectiveName`, `TriggeringEventId`, `FinalEventId`, `EventsReplayed`, `StartedAt`, `CompletedAt` | After replay finishes |

Both are marked `[AuditEvent(Exclude = true)]` — they run in a background context with no ambient user security, so they are excluded from the audit pipeline. Publish failures are swallowed at `Debug` level and never abort the rewind.

:::updated
Two stream-level bracketing events — `StreamRewindStarted` and `StreamRewindCompleted` (carrying `PerspectiveNames[]` and `TotalEventsReplayed`) — are defined in `SystemEvents.cs` and have serialization + type tests, but at commit `1b31f58d` no publishing call site exists. They are reserved/not-yet-emitted rather than live observability signals.
:::

## Error Handling

Rewind failures are **isolated per stream** — one stream's rewind throwing does not crash the perspective worker. In `_executeRewindPathAsync`, the call to `runner.RewindAndRunAsync` is wrapped in a `catch` for any non-cancellation exception, which:

- Logs at **Error** (EventId 58) with perspective name, stream id, and trigger event id.
- Increments `whizbang.perspective.errors`.
- Sets `Error` status on the OTel span.
- Returns a failure completion (`Status = None`) — the cursor's RewindRequired flag stays set, so the stream is retried on the next polling cycle.

## Security Context

Rewind system events fire as the **System user** across all tenants, published from the generated runner via the dispatcher's fluent security API:

```csharp{title="Rewind system-event dispatch" description="The generated runner publishes rewind events as the System principal with an explicit cross-tenant scope" framework="NET10" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Security"]}
await dispatcher.AsSystem().ForAllTenants()
    .PublishAsync(new PerspectiveRewindStarted(
        streamId, perspectiveName, triggeringEventId,
        replayFromEventId, hasSnapshot, startedAt));
```

`AsSystem()` establishes a system principal; `ForAllTenants()` sets an explicit cross-tenant scope, which is required here because the background rewind path has no ambient tenant context to inherit.

## Debounce

`PerspectiveRewindOptions` exposes a `DebounceWindow` (default 5s) and a `MaxDebounceWindow` hard cap (default 30s), and the cursor table carries a sliding `rewind_flagged_at` timestamp alongside a fixed `rewind_first_flagged_at` (preserved via `COALESCE` from the first detection). The intent is to coalesce a burst of late events on a hot stream into a **single** rewind rather than one per batch.

:::updated
At commit `1b31f58d` the debounce *columns and options exist* — `rewind_flagged_at` / `rewind_first_flagged_at` are **written** by the straggler-detection path in `complete_perspective_cursor_work` (not by the primary `store_perspective_events` detection) and **cleared** on successful completion — but no code path **reads** them as a hold-back gate, and nothing consumes `DebounceWindow` / `MaxDebounceWindow`. The coalescing behaviour described above is not wired in the current source — the scaffolding is present but the gate is inactive. Do not rely on a specific debounce window.
:::

## Related

- [Perspective Snapshots](snapshots.md) — the snapshot store a rewind restores from, and how snapshots are created and pruned.
- [Perspective Stream Locking](stream-locking.md) — the per-stream lock (`reason = "rewind"`) held during replay.
- [Perspective Rebuild](rebuild.md) — full read-model reconstruction (blue-green / in-place / selected streams), a distinct operation from late-event rewind.
