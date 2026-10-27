---
title: Storage Maintenance
pageType: guide
version: 1.0.0
category: Infrastructure
order: 10
description: >-
  How Whizbang keeps its own tables from bloating: autovacuum and fillfactor settings on the framework tables, and how
  a table that has already grown is rewritten, as the table rewrite strategy and AllowTableRewrite decide, including
  the online rewrite through pg_squeeze that the maintenance cycle drives within a per-cycle byte budget
tags: >-
  operations, storage, autovacuum, fillfactor, hot, vacuum, bloat, toast, postgres, maintenance, table rewrite,
  pg_squeeze, pg_repack
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/088_ChurnTableAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/222_FrameworkTableAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/223_PerspectiveCursorFillFactor.sql
  - src/Whizbang.Data.Postgres/Migrations/234_PerspectiveAppliedAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/235_RetireTableRewritePolicySetting.sql
  - src/Whizbang.Core/Workers/TableRewriteStrategy.cs
  - src/Whizbang.Core/Startup/TableRewriteStartupStep.cs
  - src/Whizbang.Core/Workers/PgRepackTableRewriter.cs
  - src/Whizbang.Core/Workers/PgRepackClient.cs
  - src/Whizbang.Core/Workers/PgRepackOptions.cs
  - src/Whizbang.Core/Processes/ExternalProcessRunner.cs
  - src/Whizbang.Core/Messaging/TableRewriteTarget.cs
  - src/Whizbang.Data.Postgres/LibpqEnvironment.cs
  - src/Whizbang.Core/Workers/OnlineTableRewriteStep.cs
  - src/Whizbang.Core/Workers/PgSqueezeTableRewriter.cs
  - src/Whizbang.Data.Postgres/PgSqueezePrerequisites.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/FrameworkTableAutovacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerspectiveCursorFillFactorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerspectiveAppliedAutovacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/TableRewritePolicyRetiredTests.cs
  - tests/Whizbang.Core.Tests/Workers/TableRewriteStrategyTests.cs
  - tests/Whizbang.Core.Tests/Startup/TableRewriteStartupStepTests.cs
  - tests/Whizbang.Core.Tests/Workers/PgRepackTests.cs
  - tests/Whizbang.Core.Tests/Processes/ExternalProcessRequestTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/LibpqEnvironmentTests.cs
  - tests/Whizbang.Core.Integration.Tests/Processes/ExternalProcessRunnerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ExternalTableRewriteTests.cs
  - tests/Whizbang.Core.Tests/Workers/OnlineTableRewriteStepTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PgSqueezePrerequisitesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OnlineTableRewriteSqlTests.cs
---

# Storage Maintenance

PostgreSQL never rewrites a row in place: an update or a delete leaves the old version behind as a dead tuple until a
vacuum reclaims it. Whizbang's own tables churn constantly, so their vacuum settings decide whether they stay a stable
size or grow to cover every burst.

## Autovacuum on the framework tables {#autovacuum}

{verified: FrameworkTableAutovacuumTests.UpdateAndDeleteTables_VacuumAfterAFixedCountAsync, FrameworkTableAutovacuumTests.TheEventStore_VacuumsAfterAFixedNumberOfInsertsAsync, FrameworkTableAutovacuumTests.TheEventBodyToastTable_VacuumsAfterAFixedCountAsync, PerspectiveAppliedAutovacuumTests.TheLedger_VacuumsAfterAFixedNumberOfDeadRowsAsync, PerspectiveAppliedAutovacuumTests.TheLedger_VacuumsAfterAFixedNumberOfInsertsAsync}

By default PostgreSQL vacuums a table once a fraction of it is dead: 20% (5% on some managed servers). That fraction
grows with the table, so a table of ten million rows waits for hundreds of thousands of dead ones. Whizbang's
migrations set per-table storage parameters instead, so the server settings need no change:

| Tables | Setting | Why |
|---|---|---|
| `wh_inbox`, `wh_outbox`, `wh_perspective_events`, `wh_active_streams` | vacuum and analyze at 2% (migration 088) | queues whose rows are deleted as work completes; a small working set |
| `wh_perspective_cursors`, `wh_lifecycle_completions`, `wh_stream_digests`, `wh_message_deduplication` | vacuum after 10,000 dead rows, whatever the size (migration 222) | updated or deleted continuously, and they grow with the data |
| `wh_event_store` | vacuum after 10,000 inserts (migration 222) | append-heavy: vacuum keeps its visibility map current, so index-only scans do not fall back to the table |
| `wh_event_body`'s TOAST table | vacuum after 10,000 dead chunks (migration 222) | large bodies live in TOAST, and the ephemeral reaper leaves their dead chunks there |
| `wh_perspective_applied` | vacuum after 10,000 dead rows and after 10,000 inserts (migration 234) | the [applied-event ledger](../../fundamentals/perspectives/perspective-sync#applied-ledger) is a sliding window: every completed apply inserts a row and the rows an hour old are pruned, so it inserts and deletes at the same rate |

The settings are applied by migration on every database, with either driver, and re-applying them changes nothing.
To see them on a table:

```sql{title="Read a table's autovacuum settings" category="Operations" difficulty="BEGINNER"}
SELECT c.relname, c.reloptions, t.reloptions AS toast_reloptions
FROM pg_class c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
WHERE c.relname IN ('wh_event_store', 'wh_event_body', 'wh_perspective_cursors', 'wh_perspective_applied');
```

## Free space for updates {#fillfactor}

{verified: PerspectiveCursorFillFactorTests.TheCursorTable_KeepsTenPercentOfEachPageFreeAsync, PerspectiveCursorFillFactorTests.ATableHoldingRows_IsQueuedForARewriteAsync, PerspectiveCursorFillFactorTests.ApplyingTheMigrationAgain_ChangesNothing_AndQueuesNothingAsync}

An update whose new row version fits on the same page, and that changes no indexed column, is a heap-only (HOT)
update: it writes no index entries, and the old version is pruned inside the page without vacuum. A page packed full
leaves no room, so the new version lands on another page and every index gains an entry. `wh_perspective_cursors` is
rewritten on every batch a perspective applies, so migration 223 sets its `fillfactor` to 90, keeping 10% of each page
free for those updates.

A new fillfactor applies only to pages written from then on. When the migration changes it on a table that already
holds rows, it also queues the table in the `pending_table_rewrites` setting (through `wh_request_table_rewrite`), and
the table is rewritten after startup when the [table rewrite strategy](#table-rewrite-strategy) allows it (see
[Table rewrites run post-ready](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)). A perspective table that declares
`[PerspectiveTableStorage(FillFactor = …)]` is queued the same way when its schema pass changes the value (see
[Physical Fields: free space for updates](../../fundamentals/perspectives/physical-fields#perspective-fillfactor)).
The worker re-measures every queued table and rewrites only one whose size has crossed the bloat threshold, so a
queued request on a compact table is left until it is worth a rewrite.

```sql{title="Read the fillfactor and the queued rewrites" category="Operations" difficulty="BEGINNER"}
SELECT relname, reloptions FROM pg_class WHERE relname = 'wh_perspective_cursors';
SELECT setting_value FROM wh_settings WHERE setting_key = 'pending_table_rewrites';
```

## A table that has already grown {#already-grown}

Autovacuum makes dead space reusable, but it never returns pages to the operating system. A table that bloated before
these settings, or during an import, keeps its size until it is rewritten. A rewrite takes an exclusive lock for its
whole duration with `VACUUM FULL`, so plan it for a quiet window or use an online tool such as `pg_repack` or
`pg_squeeze` (see [Postgres extensions](./postgres-extensions)). The maintenance cycle records each table that needs
a rewrite; the [table rewrite strategy](#table-rewrite-strategy) decides what happens to it.

## Table rewrite strategy {#table-rewrite-strategy}
{verified: TableRewriteStrategyTests.Resolve_EachCellOfTheMatrixAsync, TableRewriteStrategyTests.TheSetting_DefaultsToAuto_AndBindsFromConfigurationAsync, TableRewriteStartupStepTests.PgSqueeze_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync}

`Whizbang:Workers:Maintenance:TableRewriteStrategy` (default `Auto`) chooses how the post-ready `Rewrite` step
reclaims the space of the tables the maintenance cycle recorded, together with `AllowTableRewrite` (default `false`),
the operator's permission for a blocking rewrite at boot:

| Strategy | pg_squeeze usable | `AllowTableRewrite = true` | `AllowTableRewrite = false` |
|---|---|---|---|
| `Auto` | yes | `VACUUM FULL` at boot; the report says pg_squeeze is usable and how to opt in | detect and report only, with the same hint |
| `Auto` | no | `VACUUM FULL` at boot | detect and report only |
| `PgSqueeze` | yes | [online rewrite](#online-rewrite) from the maintenance cycle | [online rewrite](#online-rewrite) from the maintenance cycle |
| `PgSqueeze` | no | start fails with the capability verdict (it warns when the probe cannot tell) | start fails with the capability verdict (it warns when the probe cannot tell) |
| `PgRepack` | either | online rewrite through pg_repack, [in process or by an external job](#pg-repack) | online rewrite through pg_repack, [in process or by an external job](#pg-repack) |
| `VacuumFull` | either | `VACUUM FULL` at boot | detect and report only |
| `None` | either | nothing is rewritten | nothing is rewritten |

```mermaid{caption="How the Rewrite step resolves the table rewrite strategy against AllowTableRewrite; Auto never starts an online rewrite." tests=["TableRewriteStrategyTests.Resolve_EachCellOfTheMatrixAsync","PgRepackTests.Resolve_PgRepack_IsTheExplicitChoice_WhateverElseHoldsAsync","TableRewriteStrategyTests.ExplicitPgSqueeze_OnAServerThatDoesNotAllowlistIt_FailsStartWithTheFixAsync","TableRewriteStartupStepTests.PgSqueeze_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync"]}
flowchart TD
  S{TableRewriteStrategy} -->|None| N[Nothing rewritten]
  S -->|PgRepack| P[Online rewrite<br/>through pg_repack]
  S -->|PgSqueeze| Q{pg_squeeze usable?}
  Q -->|no| F[Capability verdict<br/>stops start]
  Q -->|yes| O[Online rewrite from the<br/>maintenance cycle]
  S -->|Auto or VacuumFull| A{AllowTableRewrite?}
  A -->|true| V[VACUUM FULL at boot]
  A -->|false| R[Detect and report only]
```

- **`Auto` never starts an online rewrite.** Rewriting a table online is opted into with `PgSqueeze`. Where
  pg_squeeze is usable, `Auto` says so in the step's report and names the setting that opts in. With
  `AllowTableRewrite = true`, `Auto` keeps the behavior earlier releases had: `VACUUM FULL` at boot.
- **`PgSqueeze` requires the extension.** It is the first setting in the library that
  [declares a capability requirement](./capabilities#declaring-a-requirement): set explicitly on a server where
  pg_squeeze is not usable, the [capability verdict](./capabilities#validation) stops the host with the fix, for
  example the allowlist and `shared_preload_libraries` change it needs. Where the extension is available, it is
  [provisioned](./capabilities#provisioning) first. It never falls back to `VACUUM FULL`, and `AllowTableRewrite` does
  not gate it: choosing it is the opt-in.
- **`PgSqueeze` is not run at boot.** The `Rewrite` step reports
  `PgSqueeze: online rewrite through pg_squeeze; the maintenance cycle performs it, largest bloat first, up to Whizbang:Workers:Maintenance:OnlineRewriteMaxBytesPerCycle bytes per cycle`
  and leaves the queue to the [online rewrite](#online-rewrite), so the rewrite is never unbounded.
- **`None`** rewrites nothing; the maintenance cycle still records the tables that need it and reports the bloat.

```json{title="Opt in to online table rewrites" description="Selects pg_squeeze for table rewrites; start fails with the fix when the server does not allow the extension." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_squeeze", "maintenance", "configuration"] tests=["TableRewriteStrategyTests.TheSetting_DefaultsToAuto_AndBindsFromConfigurationAsync", "TableRewriteStrategyTests.ExplicitPgSqueeze_OnAServerThatDoesNotAllowlistIt_FailsStartWithTheFixAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgSqueeze"
      }
    }
  }
}
```

On a server that does not allowlist pg_squeeze, start then stops with:

```text
capability postgres/pg_squeeze on 'orders': NotPermitted; NotAllowlisted. Fix: add PG_SQUEEZE to the server's extension allowlist (azure.extensions on Azure Database for PostgreSQL) and pg_squeeze to shared_preload_libraries, then restart the server. Required by: Online table rewrite (Whizbang:Workers:Maintenance:TableRewriteStrategy = PgSqueeze, explicit)
```

## pg_repack {#pg-repack}
{verified: PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync, PgRepackTests.InProcess_WithNoClient_DegradesAnImplicitRequirement_AndTheRewriterHoldsBackAsync, PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync, PgRepackTests.InProcess_Rewrite_PassesTheConnectionThroughTheEnvironmentOnlyAsync}

`TableRewriteStrategy = PgRepack` rewrites requested tables online with [pg_repack](https://reorg.github.io/pg_repack/),
which holds an ACCESS EXCLUSIVE lock only briefly at the start and the end of each table. It needs two things: the
`pg_repack` extension on the server (the capability `postgres/pg_repack`, provisioned like any other
[capability](./capabilities#provisioning)), and its client program, which does the work from outside the server. Prefer
it over pg_squeeze where the server cannot preload pg_squeeze or use logical decoding; prefer pg_squeeze where nothing
outside the server may run.

`Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode` decides who runs the client:

| Mode | Who runs the client | The client program | Whizbang starts a process |
|---|---|---|---|
| `InProcess` (default) | the instance holding the maintainer duty, in the post-ready `Rewrite` step, once per requested table | a probed prerequisite, `program/pg_repack`, found on `PATH` or at `ClientPath` | yes: `pg_repack --version` at startup, and one run per table |
| `External` | a job you run (a container or a scheduled task) against the tables `wh_tables_needing_rewrite()` lists | not needed on the Whizbang host | never |

```mermaid{caption="Who runs pg_repack in each mode; in External mode Whizbang starts no process." tests=["PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync","PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync","PgRepackTests.InProcess_WithNoClient_DegradesAnImplicitRequirement_AndTheRewriterHoldsBackAsync"]}
flowchart TD
  M{PgRepack Mode} -->|External| E[Rewrite step skips<br/>tables stay queued<br/>your job runs pg_repack]
  M -->|InProcess| P{pg_repack --version<br/>at startup}
  P -->|answers| R[Ready: the Rewrite step runs<br/>pg_repack per requested table]
  P -->|missing, Mode set explicitly| F[Capability verdict<br/>stops start]
  P -->|missing, Mode left at default| D[Warning; tables stay queued]
```

- **In process, the client is a prerequisite.** At startup Whizbang runs `pg_repack --version`. When the client is
  missing and `Mode` was set to `InProcess` explicitly, the [capability verdict](./capabilities#validation) stops the
  host with the fix; when `Mode` was left at its default, the verdict warns, the `Rewrite` step skips, and the tables
  stay queued. Install the client at the same version as the extension: pg_repack refuses to run against a different
  one.
- **External mode never starts a process,** not even to read the client's version. The `Rewrite` step reports
  `pg_repack runs as an external job (...Mode = External): Whizbang does not start it, and requested tables stay
  queued for that job` and the maintenance cycle keeps recording which tables need it.
- **Credentials never appear on the command line.** Process arguments are visible to every user on the host (`ps`,
  `/proc/<pid>/cmdline`), so the client is started with only its options and the table
  (`--no-superuser-check --no-kill-backend --table=<schema>.<table>`). The connection reaches it as the libpq
  environment variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and, when set, the TLS and password
  file variables, which only the client's own user and an administrator can read, and which are never written to
  disk. The connection is the [schema-initialization connection](./migrations#database-roles) when one is configured,
  because pg_repack must run as the table's owner; without one, a table the application role does not own is reported
  and not attempted. A context configured with a data source has no password to hand over: libpq then reads the host's
  password file (`PGPASSFILE`, `~/.pgpass`) or service file.
- **`--no-superuser-check`** lets the table's owner repack it, which managed servers require, and
  **`--no-kill-backend`** makes pg_repack give up on a table it cannot lock in time rather than end the application's
  own sessions. A run that fails is logged with its exit code and error, and the table stays queued for the next boot.
- **The request is cleared only after the re-measure improves,** as for every strategy: after the client exits,
  Whizbang analyzes the table and measures it again.

```json{title="Rewrite tables online with pg_repack, run in process" description="Selects pg_repack and requires its client on the host; start fails with the fix when it is missing." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_repack", "maintenance", "configuration"] tests=["PgRepackTests.Options_BindFromConfigurationThroughAddWhizbangWorkersAsync", "PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgRepack",
        "TableRewrite": {
          "PgRepack": {
            "Mode": "InProcess",
            "ClientPath": "/usr/lib/postgresql/16/bin/pg_repack"
          }
        }
      }
    }
  }
}
```

On a host without the client, start then stops with:

```text
capability program/pg_repack on '/usr/lib/postgresql/16/bin/pg_repack': Missing: An error occurred trying to start process '/usr/lib/postgresql/16/bin/pg_repack' with working directory '/app'. No such file or directory. Fix: install the pg_repack client program, the same version as the pg_repack extension, on this host's PATH or set Whizbang:Workers:Maintenance:TableRewrite:PgRepack:ClientPath to it; or set Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode = External and run it as a job. Required by: Online table rewrite, in process (pg_repack client) (Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode = InProcess, explicit)
```

In `External` mode, a job lists the queue and runs the client the same way, with the connection in its environment:

```bash{title="An external pg_repack job" description="Runs pg_repack against each table Whizbang has queued, with the connection in the environment." category="Operations" difficulty="ADVANCED" tags=["pg_repack", "table-rewrite", "external-job", "maintenance"] tests=["PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync"]}
export PGHOST=db.internal PGDATABASE=orders PGUSER=orders_owner PGPASSFILE=/run/secrets/pgpass
for table in $(psql -Atc "SELECT table_name FROM wh_tables_needing_rewrite()"); do
  pg_repack --no-superuser-check --no-kill-backend --table="public.$table"
done
```

The next boot's `Rewrite` step re-measures, and a request whose table is lean again is no longer offered.

## Online rewrite through pg_squeeze {#online-rewrite}
{verified: OnlineTableRewriteStepTests.Rewrites_TheLargestBloatRatioFirstAsync, OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync, OnlineTableRewriteStepTests.NotImproved_LeavesTheRequestQueuedAsync, OnlineTableRewriteStepTests.PgSqueezeNotReadyOnEveryDatabase_RewritesNothing_AndSaysWhereAsync}

With `TableRewriteStrategy = PgSqueeze`, the maintenance cycle rewrites queued tables online through
`squeeze.squeeze_table`, which copies the table while it stays readable and writable and holds an exclusive lock only
for the final swap. It runs as a [maintenance step](../../fundamentals/workers/maintenance-steps) named
`online-table-rewrite`, so it runs where the rest of the cycle runs: on the holder of the maintainer duty, and only when
the housekeeping gate admits the cycle (the service is idle, or the cycle was deferred too long).

Each cycle:

1. **Checks that pg_squeeze is Ready** on every database the [capability registry](./capabilities) probed. Anything
   else (including `Provisionable`, an extension that provisioning is turned off for) rewrites nothing and logs why;
   the queue is kept.
2. **Takes the queued tables** (`pending_table_rewrites`, which the cycle's bloat detection fills) that still measure
   over the bloat threshold, **largest bloat ratio first**, ties in name order.
3. **Spends a byte budget.** A table is rewritten only when its heap fits what is left of
   `OnlineRewriteMaxBytesPerCycle`; one that does not fit is deferred to a later cycle, and the next smaller table that
   fits is taken. A table larger than the whole budget is never rewritten, and the log names the setting to raise.
4. **Checks the [prerequisites](#online-rewrite-prerequisites) for each table**, then calls pg_squeeze, runs `ANALYZE`
   and re-measures.
5. **Clears the request only when the rewrite improved the table**: the re-measured ratio is lower than the ratio that
   queued it. A rewrite that did not help, a table whose prerequisites were not met, and a call that failed all stay
   queued for the next cycle, each with a warning naming the table.

```mermaid{caption="One maintenance cycle of the online rewrite: pg_squeeze must be Ready, tables go largest bloat first within the byte budget, and a request is cleared only when the rewrite improved the table." tests=["OnlineTableRewriteStepTests.PgSqueezeNotReadyOnEveryDatabase_RewritesNothing_AndSaysWhereAsync","OnlineTableRewriteStepTests.Rewrites_TheLargestBloatRatioFirstAsync","OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync","OnlineTableRewriteStepTests.NotImproved_LeavesTheRequestQueuedAsync","OnlineTableRewriteStepTests.Improved_ClearsTheRequestAsync"]}
flowchart TD
  R{pg_squeeze Ready<br/>on every database?} -->|no| K[Log why; queue kept]
  R -->|yes| Q[Queued tables,<br/>largest bloat ratio first]
  Q --> B{Fits the bytes left<br/>of the budget?}
  B -->|no| D[Deferred to a later cycle]
  B -->|yes| P{Prerequisites met?}
  P -->|no| L[Warn with the reason;<br/>stays queued]
  P -->|yes| S[squeeze.squeeze_table,<br/>ANALYZE, re-measure]
  S --> I{Ratio lower than<br/>when it was queued?}
  I -->|yes| C[Request cleared]
  I -->|no| L
```

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:Workers:Maintenance:TableRewriteStrategy` | `Whizbang__Workers__Maintenance__TableRewriteStrategy` | `Auto` | `PgSqueeze` turns the online rewrite on. |
| `Whizbang:Workers:Maintenance:OnlineRewriteMaxBytesPerCycle` | `Whizbang__Workers__Maintenance__OnlineRewriteMaxBytesPerCycle` | `1073741824` (1 GiB) | The most heap bytes one cycle rewrites. pg_squeeze writes a full copy of each table, plus the WAL for it, so this bounds the extra disk and WAL one cycle can cause. `0` rewrites nothing. |

```json{title="Online rewrite with a 4 GiB budget per cycle" description="Selects pg_squeeze for table rewrites and lets each maintenance cycle rewrite up to 4 GiB of queued tables." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_squeeze", "maintenance", "configuration"] tests=["OnlineTableRewriteStepTests.TheBudget_DefaultsToOneGibibyte_AndBindsFromConfigurationAsync", "OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgSqueeze",
        "OnlineRewriteMaxBytesPerCycle": 4294967296
      }
    }
  }
}
```

A cycle ends with one line, for example
`Online rewrite: 1 of 2 queued table(s) rewritten this cycle; 1 left queued`.

### Prerequisites checked before each call {#online-rewrite-prerequisites}
{verified: PgSqueezePrerequisitesTests.EveryPrerequisiteMet_IsNothingUnmetAsync, PgSqueezePrerequisitesTests.TheFirstUnmetPrerequisite_IsTheOneReportedAsync, OnlineTableRewriteSqlTests.ThePrerequisiteQuery_ReadsTheServersFactsAsync, OnlineTableRewriteSqlTests.Squeeze_OnAServerWithoutPgSqueeze_IsReportedAndNotAttemptedAsync}

pg_squeeze does its work in a background worker, and a failure there surfaces as a bare error. So before each call one
catalog query reads what the call depends on, and the first unmet prerequisite is logged as
`Table <name> was not rewritten: <reason>` instead of calling pg_squeeze. The checks run, in order, on the connection
the rewrite uses (the [schema-initialization connection](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)
when one is configured, otherwise the application's):

| Prerequisite | Read from | Fix |
|---|---|---|
| The table exists | `to_regclass` | none; the next cycle no longer offers it |
| pg_squeeze is installed in this database | `squeeze.squeeze_table` in `pg_proc` | let [provisioning](./capabilities#provisioning) create it, or `CREATE EXTENSION pg_squeeze` |
| The role may call it | `USAGE` on schema `squeeze`, `EXECUTE` on the function | grant both |
| `wal_level = logical` (below Postgres 19) | `wal_level`, `server_version_num` | set `wal_level = logical`, then restart the server |
| A free replication slot | `pg_replication_slots` against `max_replication_slots` | raise `max_replication_slots` (a restart), or drop an unused slot |
| A primary key or replica identity index | `pg_index` | every framework table has a primary key; this guards a table that lost it |
| The role may create a replication slot | `rolsuper` or `rolreplication` | `ALTER ROLE <role> WITH REPLICATION` |
| The role owns the table | `pg_has_role(..., 'MEMBER')` on the owner | configure the schema-initialization connection, whose role owns the tables |

### Privileges on a managed server {#online-rewrite-privileges}

What the role that runs the rewrite needs, read from pg_squeeze's source (version 1.9) rather than its README, which
does not say:

- **The REPLICATION attribute, or superuser.** `squeeze.squeeze_table` starts a background worker that connects as
  the calling role and creates a logical replication slot for the rewrite. From Postgres 15 that slot creation checks
  the caller's right to create slots, which only superuser and roles with `REPLICATION` have. The extension's own
  scheduler functions (`squeeze.start_worker`, `squeeze.stop_worker`) need superuser, but the library does not use
  them: it calls `squeeze_table` directly, which needs no superuser.
- **`EXECUTE` on the function.** The extension script does not revoke it from `PUBLIC`, so any role that may use the
  `squeeze` schema can call it by default.
- **Ownership is not checked by pg_squeeze**, which switches to the table owner for the index functions it runs. The
  library checks ownership itself: the `ANALYZE` that follows needs it, and a rewrite should run as the role that owns
  the table, as `VACUUM FULL` does.
- **Server parameters** (operator, at the server, each needing a restart): pg_squeeze in `shared_preload_libraries`,
  `wal_level = logical` below Postgres 19, and `max_replication_slots` with room for one more slot per rewrite in
  flight. On a managed server the extension must also be named in the extension allowlist.

On a managed server, the administrator role the platform gives you can usually grant `REPLICATION` to the
schema-initialization role, and logical replication is switched on through the platform's server parameters rather
than SQL. This was worked out from the extension's source and the platform's general rules, not yet confirmed on every
managed service: check the role with `SELECT rolreplication FROM pg_roles WHERE rolname = current_user` before
choosing `PgSqueeze`. Where the role cannot be given `REPLICATION`, the prerequisite check says so for each table and
the queue is kept; `VacuumFull` in a maintenance window remains the alternative.

## Related

- [Table rewrites run post-ready](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)
- [Capabilities](./capabilities)

- [Maintenance steps: ledger retention](../../fundamentals/workers/maintenance-steps#ledger-retention)
- [Database limits](./database-limits)
