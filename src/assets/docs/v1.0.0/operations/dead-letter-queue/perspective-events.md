---
title: Perspective-event Dead-lettering
pageType: concept
version: 1.0.0
category: Dead-Letter Queue
order: 5
description: >-
  How wh_perspective_events rows that exceed MaxPerspectiveEventAttempts get
  moved to wh_dead_letters before deserialization + apply runs.
tags: >-
  dead-letter-queue, PerspectiveWorker, MaxPerspectiveEventAttempts,
  FilterDeadLetteredAsync, perspective-events
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql
  - src/Whizbang.Core/Messaging/IDeadLetterStore.cs
---

# Perspective-event Dead-lettering

The perspective-event DLQ check runs at the drainer's
**pre-deserialization** boundary — earlier than inbox or outbox checks.
That's deliberate: typed-envelope deserialization + apply is the most
expensive part of the perspective pipeline, and there's no point paying
that cost for a row we already know is doomed.

## Flow

```
get_stream_events SQL fn
  → returns rows with (event_work_id, event_id, attempts, ...)

PerspectiveWorker.FilterDeadLetteredAsync(rawEvents)
  for each row:
    if attempts > MaxPerspectiveEventAttempts:
      IDeadLetterStore.MoveAsync(
        sourceTable = "wh_perspective_events",
        sourceId = event_work_id,
        failureReason = MaxAttemptsExceeded)
      // SQL fn atomically deletes the wh_perspective_events row
      // and inserts into wh_dead_letters
      continue (drop from apply set)
    else:
      survivors.Add(row)

DeserializeStreamEvents(survivors)
  → typed envelopes
  → apply runs
```

## How attempts are counted

`wh_perspective_events.attempts` is bumped by SQL — never by C#:

- `get_stream_events` (mig 038) bumps `attempts` when claiming an unowned
  or expired-lease row.
- `claim_and_fetch_pending_perspective_events` (mig 042) same.
- `claim_orphaned_perspective_events` (mig 027) bumps when re-claiming
  rows from a dead instance.

One-based semantic: `attempts=N` means the row has been claimed `N`
times. So `MaxPerspectiveEventAttempts=10` permits 10 attempts and
dead-letters on the 11th claim. The check uses strict `>` not `>=`.

## What `MoveAsync` does

The SQL function `move_to_dead_letters()` (mig 050) runs both halves of
the move in a single transaction:

```sql{
title: "Atomic move of a perspective-event row to the DLQ"
description: "The move_to_dead_letters CTE deletes the wh_perspective_events row and inserts the snapshot into wh_dead_letters in one transaction for a consistent, idempotent move."
category: "Dead Letter Queue"
difficulty: "ADVANCED"
tags: ["dead-letter", "perspective-events", "move_to_dead_letters", "atomic-move", "postgres"]
}
WITH src AS (
  DELETE FROM wh_perspective_events
  WHERE event_work_id = $sourceId
  RETURNING stream_id, event_id, perspective_name, attempts, ...
)
INSERT INTO wh_dead_letters
  (dead_letter_id, source_table, source_id, stream_id, ...)
SELECT $deadLetterId, 'wh_perspective_events', $sourceId, src.stream_id, ...
FROM src;
```

Atomic — partial-failure crashes leave the system consistent. Idempotent
— if the row is already gone (another worker beat us to it), `MoveAsync`
returns `NULL` and the caller treats it as a no-op.

## What if `MoveAsync` throws?

The row stays in the apply set. The next claim cycle re-bumps `attempts`
and the check runs again. Same fallback as inbox / outbox — the retry
budget is exhausted, but we'd rather visibly keep failing than silently
swallow rows when the DLQ surface itself is broken.

## Interaction with the cooldown cache

The cooldown cache (`RecentlyProcessedEventCache`) and the DLQ check
operate independently:

1. Cooldown filter runs BEFORE the DLQ check (cheaper — pure in-memory
   lookup).
2. If a row is in the cooldown cache, it's dropped from the apply set
   entirely and the DLQ check never sees it.
3. If a row survives cooldown, the DLQ check runs.

A row that's been dead-lettered won't reappear in `get_stream_events`
results (the SQL function deleted it), so the cooldown cache never sees
a stale entry pointing at a DLQ'd row.

## Disabling

```json{
title: "Disable perspective-event dead-lettering"
description: "Sets MaxPerspectiveEventAttempts to null so wh_perspective_events rows retry indefinitely instead of moving to the DLQ — only safe with an external janitor or idempotent perspectives."
category: "Dead Letter Queue"
difficulty: "BEGINNER"
tags: ["dead-letter", "perspective-events", "MaxPerspectiveEventAttempts", "configuration"]
}
{
  "Whizbang": {
    "PerspectiveWorker": { "MaxPerspectiveEventAttempts": null }
  }
}
```

Restores v0.501 behavior: rows accumulate in `wh_perspective_events`
indefinitely. Use only if you have an external janitor that purges old
rows, or if your perspectives are idempotent enough that infinite retry
is acceptable.

## See also

- [Internal DLQ table](./internal-dlq)
- [Recovery worker + policy matrix](./recovery)
