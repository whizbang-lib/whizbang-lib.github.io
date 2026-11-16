---
title: Database Attribution
pageType: concept
version: 1.0.0
category: Observability
order: 9
description: >-
  Every database statement the framework runs in the background names the mechanism that ran it, as a leading SQL
  comment and as the mechanism tag on the whizbang.db statement, duration and row metrics, so database CPU and I/O can
  be attributed without guessing.
tags: 'observability, database, attribution, metrics, pg_stat_activity, pg_stat_statements, performance'
codeReferences:
  - src/Whizbang.Core/Observability/DbMechanism.cs
  - src/Whizbang.Core/Observability/DbMechanismScope.cs
  - src/Whizbang.Core/Observability/IDbMechanismOwner.cs
  - src/Whizbang.Core/Observability/DbStatementMetrics.cs
  - src/Whizbang.Core/Observability/WorkerDbMechanisms.cs
  - src/Whizbang.Core/Startup/GatedHostedService.cs
  - src/Whizbang.Data.Postgres/WhizbangCommand.cs
  - src/Whizbang.Data.Postgres/AttributedDbConnection.cs
  - src/Whizbang.Data.Postgres/CoordinatorConnectionScope.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Notifications/WorkerDbMechanisms.cs
  - src/Whizbang.Data.EFCore.Postgres/Observability/WhizbangCommandAttributionInterceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/WhizbangDbContextOptionsExtensions.cs
testReferences:
  - tests/Whizbang.Core.Tests/Observability/DbMechanismTests.cs
  - tests/Whizbang.Core.Tests/Observability/DbStatementMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/WorkerDbMechanismsTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/DbMechanismWorkerScopeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Observability/WhizbangCommandAttributionTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperCommandAttributionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupHostedServiceAuditTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgSharedNotifyConnectionCoverageTests.cs
---

# Database Attribution

A framework service runs many background mechanisms against its database: claiming work, flushing completions,
renewing leases, the maintenance cycle, integrity audits, the table-statistics probe. When the database is busy, the
first question is which of them is doing it. Every statement one of them runs answers that question itself.

## What a statement carries

- **A leading comment.** The text reaches the server as `/* whizbang:claim */ SELECT ...`. It shows in
  `pg_stat_activity.query` while the statement runs, in the server's slow-query log, and in any sampling tool that
  reads the active query, so a sample of busy sessions names the mechanism behind each one.
- **Three metrics, tagged `mechanism`** (meter `Whizbang.Database`):

| Instrument | Unit | Meaning |
| --- | --- | --- |
| `whizbang.db.statements` | count | statements the mechanism ran |
| `whizbang.db.duration` | ms | how long each held its connection |
| `whizbang.db.rows` | count | rows each returned or changed |

The `mechanism` tag is one of a closed set (`claim`, `completion_flush`, `lease`, `maintenance`, `integrity_audit`,
`table_statistics`, and the rest listed in `DbMechanism`). A framework statement that ran with no mechanism open is
counted as `untagged`, so a gap in attribution shows on a dashboard instead of disappearing. Statements an
application runs through the same context (lenses, endpoints) are not the framework's: they are left exactly as EF
Core built them and are not counted.

## How the mechanism gets there

Nobody has to remember to tag anything.

- **Workers name their mechanism once.** Each framework worker implements `IDbMechanismOwner`; the table of which
  worker is which lives in one file per package (`WorkerDbMechanisms.cs`). The host starts every worker inside its
  mechanism (`GatedHostedService`), and an `AsyncLocal` scope (`DbMechanismScope`) carries it through every `await` and
  into every task the worker's loop starts. A test fails when a framework worker the host starts names none.
- **Commands are made in one place each.** The framework's raw commands come from `CreateWhizbangCommand()` /
  `CreateCoordinatorCommand()`, which annotate the text as it is set and record the statement when the command is
  disposed (the one point every execution path passes). The commands EF Core runs for the framework pass through
  `WhizbangCommandAttributionInterceptor`, which `UseWhizbangFunctions()` registers once on every framework context.
  Dapper creates its own commands from the connection it is handed, so the Dapper coordinator hands it
  `CoordinatorConnectionScope.Attributed`, a connection whose every command is an attributed one; no driver does less.
- **A narrower scope wins.** Code inside a worker can open `DbMechanismScope.Begin(DbMechanism.X)` for a stretch of
  work that belongs to another mechanism; disposing it restores the worker's own.

## Why a comment, and not a session setting

| Choice | Why |
| --- | --- |
| A comment in the statement text | Costs no extra statement: a `set_config` or `SET application_name` before each statement would add a round trip to every one, and the point of the exercise is to find cost, not add it. |
| Not a session setting | A session setting does not survive a transaction-mode pooler, which hands the next transaction to another server session. A comment travels with the statement. |
| Not `application_name` | The liveness connection's `application_name` is how an instance is known to be alive: `wh_live_instances` and the claim joins `pg_stat_activity` on it. Changing it per mechanism would break liveness. |
| Safe for `pg_stat_statements` | `pg_stat_statements` computes a statement's query id from the parsed statement, which ignores comments, so attribution adds no statistics entries. |
| A closed set of names | The driver prepares statements by their text, so each name is one more prepared text per statement at most. A closed set keeps that, and the metric's series count, bounded. |

## The liveness connection is never attributed

The notification connection, which carries `LISTEN`, the keepalive and the alive lock, is the one framework
connection with no mechanism. It is the liveness connection, and its commands are created directly rather than
through the attributed factory, so even when it is started from inside a worker's flow its statements reach the
database exactly as written. `StartedInsideAMechanism_TheLivenessConnectionsStatementsCarryNoAttributionAsync` locks
that, and the hosted-service audit fails if the connection ever names a mechanism.

## Reading it

- **Which mechanism is busy now:** sample `pg_stat_activity` and group active sessions by the comment at the start of
  `query`.
- **Which mechanism costs the most over time:** `sum by (mechanism) (rate(whizbang_db_duration_sum[5m]))`.
- **Idle cost:** `rate(whizbang_db_statements[5m])` per mechanism with no work flowing. A mechanism whose rate does
  not fall when the system is idle is the one to look at.
- **Gaps:** any `untagged` rate is a framework path that runs outside a mechanism, and is a defect to fix.

## Limits

- Duration on the raw path runs from the command text being set to the command being disposed, so it includes the
  time the caller spends reading the result. That is the time the statement held its connection, which is what
  matters for pool pressure.
