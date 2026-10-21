---
title: Storage Maintenance
pageType: guide
version: 1.0.0
category: Infrastructure
order: 10
description: >-
  How Whizbang keeps its own tables from bloating: autovacuum settings on the framework tables, and what an operator
  still has to do for a table that has already grown
tags: >-
  operations, storage, autovacuum, vacuum, bloat, toast, postgres, maintenance
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/088_ChurnTableAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/222_FrameworkTableAutovacuum.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/FrameworkTableAutovacuumTests.cs
---

# Storage Maintenance

PostgreSQL never rewrites a row in place: an update or a delete leaves the old version behind as a dead tuple until a
vacuum reclaims it. Whizbang's own tables churn constantly, so their vacuum settings decide whether they stay a stable
size or grow to cover every burst.

## Autovacuum on the framework tables {#autovacuum}

{verified: FrameworkTableAutovacuumTests.UpdateAndDeleteTables_VacuumAfterAFixedCountAsync, FrameworkTableAutovacuumTests.TheEventStore_VacuumsAfterAFixedNumberOfInsertsAsync, FrameworkTableAutovacuumTests.TheEventBodyToastTable_VacuumsAfterAFixedCountAsync}

By default PostgreSQL vacuums a table once a fraction of it is dead: 20% (5% on some managed servers). That fraction
grows with the table, so a table of ten million rows waits for hundreds of thousands of dead ones. Whizbang's
migrations set per-table storage parameters instead, so the server settings need no change:

| Tables | Setting | Why |
|---|---|---|
| `wh_inbox`, `wh_outbox`, `wh_perspective_events`, `wh_active_streams` | vacuum and analyze at 2% (migration 088) | queues whose rows are deleted as work completes; a small working set |
| `wh_perspective_cursors`, `wh_lifecycle_completions`, `wh_stream_digests`, `wh_message_deduplication` | vacuum after 10,000 dead rows, whatever the size (migration 222) | updated or deleted continuously, and they grow with the data |
| `wh_event_store` | vacuum after 10,000 inserts (migration 222) | append-heavy: vacuum keeps its visibility map current, so index-only scans do not fall back to the table |
| `wh_event_body`'s TOAST table | vacuum after 10,000 dead chunks (migration 222) | large bodies live in TOAST, and the ephemeral reaper leaves their dead chunks there |

The settings are applied by migration on every database, with either driver, and re-applying them changes nothing.
To see them on a table:

```sql{title="Read a table's autovacuum settings" category="Operations" difficulty="BEGINNER"}
SELECT c.relname, c.reloptions, t.reloptions AS toast_reloptions
FROM pg_class c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
WHERE c.relname IN ('wh_event_store', 'wh_event_body', 'wh_perspective_cursors');
```

## A table that has already grown {#already-grown}

Autovacuum makes dead space reusable, but it never returns pages to the operating system. A table that bloated before
these settings, or during an import, keeps its size until it is rewritten. A rewrite takes an exclusive lock for its
whole duration with `VACUUM FULL`, so plan it for a quiet window or use an online tool such as `pg_repack` or
`pg_squeeze` (see [Postgres extensions](./postgres-extensions)).

## Related

- [Maintenance steps: ledger retention](../../fundamentals/workers/maintenance-steps#ledger-retention)
- [Database limits](./database-limits)
