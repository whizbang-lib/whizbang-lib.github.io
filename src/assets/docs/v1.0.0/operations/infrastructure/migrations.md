---
title: Migration Tracking
pageType: concept
verifiedAgainstCommit: e7ae79b00
verifiedDate: 2026-10-23
version: 1.0.0
category: Infrastructure
order: 5
description: >-
  Hash-based migration tracking with per-perspective change detection,
  blue-green table swaps, preview/rollback, version auditing, and
  settings-gated data migrations
tags: >-
  migrations, schema, hash-tracking, blue-green, rollback, preview,
  database, ddl, perspective-tracking, data-migration, wh-settings
codeReferences:
  - src/Whizbang.Data.Dapper.Postgres/PostgresSchemaInitializer.cs
  - src/Whizbang.Core/Data/IMigrationProvider.cs
  - src/Whizbang.Data.Postgres/Migrations/000_MigrationTracking.sql
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - src/Whizbang.Data.Postgres/MigrationSchemaQualifier.cs
  - src/Whizbang.Data.Postgres/MigrationSearchPath.cs
  - src/Whizbang.Data.Postgres/Migrations/213_FunctionsNameTheirOwnSchema.sql
  - src/Whizbang.Data.Postgres/Migrations/063_NormalizeClrTypeNamesV2.sql
  - src/Whizbang.Data.Postgres/Migrations/032_PerformMaintenance.sql
  - src/Whizbang.Data.Postgres/MigrationFunctionBodies.cs
  - src/Whizbang.Data.Postgres/MigrationConstants.cs
  - src/Whizbang.Data.Postgres/SchemaCommandBoundary.cs
  - src/Whizbang.Data.Postgres/Migrations/constants.txt
  - scripts/Lint-MigrationSql.ps1
  - src/Whizbang.Data.Postgres/MigrationSqlNormalizer.cs
  - src/Whizbang.Data.Postgres/MigrationHashUpgrade.cs
  - src/Whizbang.Data.Postgres/SchemaBootstrapPhase.cs
  - src/Whizbang.Data.EFCore.Postgres/SchemaStepRunner.cs
  - src/Whizbang.Data.Postgres/SchemaPassLedger.cs
  - src/Whizbang.Data.EFCore.Postgres/SchemaInitializationLog.cs
  - src/Whizbang.Data.Postgres/Migrations/153_PerspectiveForms.sql
  - src/Whizbang.Data.Postgres/Migrations/154_PerspectiveFailureElementNames.sql
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/CanonicalTemporalRewrite.cs
  - src/Whizbang.Data.Postgres/CanonicalTemporalRewritePhase.cs
  - src/Whizbang.Data.Postgres/FleetVersions.cs
  - src/Whizbang.Core/Perspectives/StoredFormUnreadable.cs
  - src/Whizbang.Core/Perspectives/StoredFormFailureRegistry.cs
  - src/Whizbang.Core/Health/StoredFormHealthSource.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/MappedDocumentReadFailure.cs
  - src/Whizbang.Data.Postgres/Migrations/226_PartitionManager.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/MigrationStepTransactionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaStepRunnerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaPassLedgerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupMigrationStepsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/MigrationConstantsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/NormalizeClrTypeNamesMigrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/CanonicalTemporalFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/FleetVersionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/CanonicalTemporalRewritePhaseTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CanonicalTemporalRewriteTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CanonicalTemporalRewriteIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/FreshTableFormTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveFailureCounterSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/MappedDocumentReadFailureTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoredFormScalarMismatchWorkerTests.cs
  - tests/Whizbang.Generators.Tests/CanonicalTemporalRewriteWiringTests.cs
  - tests/Whizbang.Generators.Tests/MigrationUtf8LiteralGenerationTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/StoredFormUnreadableTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StoredForm.cs
  - tests/Whizbang.Core.Tests/Health/StoredFormHealthSourceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerBranchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/MigrationFunctionBodiesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StaleFunctionDefinitionSweepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaCommandBoundaryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/NamedSchemaMigrationReplayTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/MigrationSchemaQualificationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/MigrationSchemaQualifierTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/MigrationSearchPathTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/LogPartitionConversionTests.cs
lastMaintainedCommit: '01f07906'
---

# Migration Tracking

Whizbang uses **hash-based migration tracking** to manage database schema changes automatically. Every SQL migration and perspective schema is tracked by its SHA-256 content hash, enabling skip-on-unchanged behavior, change detection, and operational tooling.

## How It Works

On each application startup, Whizbang:

1. **Creates tracking tables** (`wh_schema_versions`, `wh_schema_migrations`) if they don't exist
2. **Records the library version** and application version in `wh_schema_versions`
3. **Hash-checks each migration**: computes SHA-256 of its normalized SQL and compares it to the stored hash ([what counts as a change](#what-counts-as-a-change))
4. **Skips unchanged migrations** (status 3) or **re-executes changed ones** (status 2)
5. **Tracks each perspective individually** with `perspective:<Name>` keys
6. **Applies each step in a transaction of its own** on the EF Core driver, so a failure costs only that step and the retry resumes there ([one transaction per step](#one-transaction-per-step))

```
wh_schema_versions
  id | library_version  | application_version     | applied_at
  1  | 0.9.4-local.65   | MyApp.OrderService/1.0.0 | 2026-03-16 ...

wh_schema_migrations
  file_name                    | content_hash     | status | status_description
  006_CreateNormalizeEvent...  | a1b2c3d4...      | 3      | Skipped (hash unchanged)
  029_ProcessWorkBatch         | e5f6a7b8...      | 1      | First apply
  perspective:OrderModel       | c9d0e1f2...      | 1      | First apply
```

### How the migrations ship in your assembly {#how-migrations-ship}

On the EF Core driver, the generator embeds the SQL of every migration into each assembly that declares a `[WhizbangDbContext]`, so the migrations travel with your application and need no files at run time. The text is stored as UTF-8 data, not as C# string literals, and is decoded once on first use.

This matters because a .NET assembly can hold at most about 16 MB of string literals in total; past that the build fails with `CS8103` ("Combined length of user strings used by the program exceeds allowed limit"). The migrations alone are several megabytes and grow with every release, so storing them as literals would eventually push a large application over that limit with no warning. As UTF-8 data they do not count toward it. Several DbContexts in one assembly share a single copy.

The decoded text is exactly what earlier versions embedded, so every recorded content hash still matches and an upgrade re-applies nothing because of this change.

### What counts as a change {#what-counts-as-a-change}

A migration's hash covers what PostgreSQL executes, not how the file is laid out. Before hashing, both
drivers and the bootstrap closure normalize the SQL:

- Comments are removed: `--` to the end of the line, and `/* */` blocks, nested the way PostgreSQL
  nests them. A block comment between two tokens reads as one space.
- Whitespace at the start and end of each line, blank lines, and the line-ending convention (CRLF,
  CR or LF) are removed or made uniform.
- A run of spaces and tabs between tokens counts as one space.
- String literals, `E'...'` strings, quoted identifiers and dollar-quoted bodies such as a function's
  `$$ ... $$` are hashed exactly as written. A comment inside a function body is part of the function
  PostgreSQL stores, so editing it is still a change.

So a comment, a license header, or a whitespace edit to a shipped migration changes nothing: every
database skips it, and the review checks do not flag it as an edited migration. An edit to any
executable SQL still changes the hash, is applied again (status 2), and is flagged.
{verified: MigrationSqlNormalizerTests.ContentHash_OfACommentOnlyEdit_IsUnchangedAsync, MigrationSqlNormalizerTests.ContentHash_OfAnExecutableEdit_ChangesAsync, MigrationSqlNormalizerTests.Literals_KeepCommentMarkersAndWhitespaceVerbatimAsync, NormalizedMigrationHashTests.Initialize_ACommentOnlyEditIsSkipped_AnExecutableEditIsAppliedAsync}

#### Upgrading a database whose hashes predate normalization {#normalized-hash-upgrade}

Earlier releases hashed the raw file text. The first start on this release rewrites those hashes
before it decides what to run, under the same lock the migrations run under:

- A row whose hash is the raw-text hash of its file as shipped is rewritten to the normalized hash,
  so nothing is applied again.
- A row that matches neither form belongs to a file that really changed, and it is applied as before.
- The normalized bootstrap closure hash is recorded beside the old one, so an instance of the earlier
  release still running alongside does not apply the bootstrap again.

The rewrite is idempotent: later starts find nothing to rewrite, and two instances starting together
rewrite each row once. No action is needed when upgrading.
{verified: NormalizedMigrationHashTests.Upgrade_TheShippedMigrations_AppliesNothingAgainAsync, NormalizedMigrationHashTests.Upgrade_FromLegacyHashes_RewritesUnchangedFilesAndAppliesChangedOnesAsync, NormalizedMigrationHashUpgradeTests.Upgrade_FromLegacyHashes_RewritesThemAndAppliesNothingAsync, NormalizedMigrationHashUpgradeTests.Upgrade_TwoInstancesStartingTogether_RewriteOnceAsync, SchemaBootstrapPhaseTests.AClosureRecordedUnderItsLegacyHashIsCurrentAndRecordedAgainAsync}

## Migration Statuses

| Status | Name | Meaning |
|--------|------|---------|
| 1 | Applied | Migration executed for the first time |
| 2 | Updated | Migration SQL changed, re-executed |
| 3 | Skipped | Hash unchanged, execution skipped |
| 4 | MigratingInBackground | Destructive change detected, background rebuild queued |
| 0 | Pending | A [step row](#step-ledger-rows) the current pass still owes |
| -1 | Failed | The step threw; it is still owed and runs again on the next attempt ([failure record](#failure-record)) |

## Per-Perspective Tracking

Each perspective schema (CREATE TABLE + indexes) is tracked individually. When a developer adds a `[PhysicalField]` or changes a model, the source generator produces updated DDL. On next startup:

- **Hash matches**: Skip (no DDL executed)
- **Additive change** (new column/index): Column-copy blue-green swap
- **Destructive change** (type change, column removal): Background event replay queued

This means unchanged perspectives have **zero startup cost** after first deployment.

### Statements that need a commit between them {#statements-that-need-a-commit-between-them}

Most of a perspective's schema belongs in one transaction, so a failure part way through leaves
nothing half applied. One dependency cannot be expressed that way, and getting it wrong produces a
schema that can never finish migrating rather than a startup that fails once.

A stored format change rewrites a key and then indexes the result. PostgreSQL builds an index over an
expression by evaluating that expression on every heap tuple that is not yet dead, and a row version
superseded by an **uncommitted** update is still live, because other transactions can still see it.
So an index built in the transaction that rewrote its key is built over the values as they were
before the rewrite, and the cast in the index expression meets the old rendering:

```text{title="What the initializer reports when the two share a transaction" description="The rewrite ran, the index was built over the superseded row versions, and the whole attempt rolled back." tests=["SchemaCommandBoundaryTests.OneTransactionCannotBuildAnIndexOverAValueItJustRewroteAsync"]}
22P02: invalid input syntax for type bigint: "2026-04-21T22:38:17.357886+00:00"
```

Ordering the statements is necessary and not sufficient. The rollback undoes the rewrite along with
the index, so the next attempt starts from the state that failed and fails identically: a retry loop
around it never makes progress, and the service reports only that it is still migrating.

So the generator emits a **commit boundary** after a rewrite, and the initializer applies each piece
on its own connection, committing before the next begins. A rewrite that has succeeded then survives
a later failure in the same pass, which is what lets a retry get further than the attempt before it.

```sql{title="A perspective whose date is indexed" description="The marker is an ordinary comment, so the script stays valid SQL for a client that does not know about it." tests=["SchemaCommandBoundaryTests.ApplyingAcrossTheBoundaryRewritesAndThenIndexesAsync"]}
UPDATE "public".wh_per_report
SET data = data || jsonb_build_object('OccurredAt', /* conversion */ 0)
WHERE jsonb_typeof(data -> 'OccurredAt') = 'string';

-- @whizbang:commit-boundary

CREATE INDEX IF NOT EXISTS idx_report_occurredat_json
  ON "public".wh_per_report (((data ->> 'OccurredAt')::bigint));
```

Schema SQL carrying no boundary is applied exactly as before, inside the initializer's transaction.
Instances stay mutually excluded either way, because the boundary is only ever crossed while the
caller holds the initialization lock.

{verified: SchemaCommandBoundaryTests.WithoutTheBoundaryTheSameScriptStillFailsAsync, SchemaCommandBoundaryTests.ApplyingTwiceIsANoOpTheSecondTimeAsync}

Both halves are proven against a real database, including that removing the marker brings the failure
back, so the boundary cannot quietly become a comment that means nothing.

## One transaction per step {#one-transaction-per-step}
{verified: MigrationStepTransactionTests.AFailureInOneFile_KeepsTheFilesBeforeIt_AndTheRetryAppliesOnlyFromItOnAsync, StartupMigrationStepsTests.AFailedStep_KeepsWhatCommitted_RecordsItsError_AndTheRetryResumesThereAsync}

The EF Core driver applies its schema pass as a sequence of **steps**, and each step is a transaction of its own
that commits together with its ledger row:

- the core tables (`core-infrastructure`);
- each migration file, with that file's `wh_schema_migrations` row;
- each perspective table, with its `perspective:<table>` row;
- the constraints, the associations, and the registries (the perspective registry and the message type registry).

A failure costs only the step that failed. Every step before it stays committed, the failed step's transaction rolls
back on its own, and the next attempt (a retry by the same instance or a start of another one) resumes at that step
instead of starting from the beginning. A deadlock (`40P01`) in one file on a fresh database no longer throws away the
files that applied before it, and a retry no longer takes every lock again and holds them all until a final commit.

Earlier versions ran the whole pass in one transaction, so a failure anywhere rolled back everything, ledger rows
included, and every retry logged `re-running because the database's definition of ... (missing)` for files that had
in fact already run once. The Dapper driver has always run each migration file in a transaction of its own.

### How the steps stay serialized {#step-serialization}
{verified: SchemaStepRunnerTests.TheLockIsHeldWhileTheStepRuns_AndReleasedWhenItCommitsAsync, SchemaStepRunnerTests.AStepThatIsCurrentUnderTheLock_RunsNothingAsync, SchemaStepRunnerTests.WhenAnotherInstanceFinishesTheSchema_ThePassStopsAsync, SchemaStepRunnerTests.WhenTheHolderLetsGoWithWorkOutstanding_TheStepIsTakenAsync, MigrationStepTransactionTests.ASecondInstance_FinishesAPassPartWayThrough_AndNothingIsAppliedTwiceAsync, MigrationStepTransactionTests.TwoInstancesOnAnEmptyDatabase_ConvergeAsync}

Instances still apply DDL one at a time, without any lock that outlives a transaction:

1. **Each step takes the schema lock at its start.** The lock is the same transaction-scoped advisory lock as before
   (`pg_try_advisory_xact_lock` on the schema key), taken as the first statement of the step's transaction and
   released by its commit or rollback. Nothing is held between steps and nothing session-scoped exists, so nothing can
   leak through a transaction-pooling front end.
2. **Each step re-checks its own ledger row under the lock** and does nothing when the row says it is already current.
   That is what makes it safe for two instances to take turns through one pass: whatever the other instance committed
   is seen and skipped.
3. **The plan is written down before any step runs.** A first step re-checks the hashes under the lock, exactly as
   the single transaction did, and when anything is owed it records what the pass owes (see the next section). An
   instance that took over part way through reads that record rather than a plan of its own made before it held the
   lock.
4. **An instance that loses a step's lock waits per step**, the same way an instance that lost the old single lock
   did. It rolls back (giving its pooled connection up), tells the
   [observers](../../data/turnkey-initialization#watching-initialization) the lock is contended, and watches:
   - the schema becomes current: the other instance finished the whole pass, so this one stops and applies nothing;
   - the lock is free while work is still owed: the holder failed, died, or is simply between two of its steps, so
     this one backs off (100 ms doubling to a 20 second cap, with jitter) and contends for the step again.

Each step is applied once, whichever instance applies it.

### What the ledger records for a pass {#step-ledger-rows}
{verified: SchemaPassLedgerTests.AFreshLedger_MarksAndRunsWhatThePassNeedsAsync, SchemaPassLedgerTests.APassOfThisBuildPartWayThrough_IsContinued_AndNothingIsMarkedAgainAsync, SchemaPassLedgerTests.AnotherBuildsUnfinishedPass_StartsAfresh_AndKeepsWhatItOwedAsync, SchemaPassLedgerTests.ThePendingHashIsNoFilesHashAsync, MigrationStepTransactionTests.AnInstanceContinuingAPass_KeepsTheFilesTheFirstAppliedRecordedAsAppliedAsync}

A migration file and a perspective table have always had a ledger row whose hash says whether they are current. The
other steps now get one too, so a retry can tell what already committed:

```text{title="Step rows in wh_schema_migrations" description="One row per step with no row of its own, keyed by the DbContext and the step, owned by 'step', carrying the build's fingerprint as its hash." tests=["SchemaPassLedgerTests.AStepKeyNamesTheContextAndTheStepAsync", "SchemaPassLedgerTests.PendingAndFailedAreOutstanding_AppliedIsNotAsync"]}
file_name                                    | owner | content_hash     | status | status_description
step:OrderDbContext:core-infrastructure      | step  | 3f9a1c...        | 1      | Applied
step:OrderDbContext:constraints              | step  | 3f9a1c...        | 1      | Applied
step:OrderDbContext:associations             | step  | 3f9a1c...        | 0      | Pending
step:OrderDbContext:registries               | step  | 3f9a1c...        | 0      | Pending
```

- **Key**: `step:<context>:<step>`, where `<context>` is the DbContext and `<step>` is `core-infrastructure`,
  `constraints`, `associations` or `registries` (or `perspective-tables` for a context with no perspectives).
  The owner is `step`.
- **Status**: `0` while the step is owed, `1` once it committed (written in the step's own transaction), `-1` after it
  failed (still owed).
- **Hash**: the build's fingerprint, a hash over everything the build applies. While any step row carrying this
  build's fingerprint is outstanding, a pass of this build is part way through, and the next instance to take the lock
  continues it from its rows instead of marking them again. A pass another build left unfinished starts afresh and
  keeps every step that pass still owed.
- **Skipped files**: a migration file or perspective table whose hash is unchanged is recorded as `3`
  (`Skipped (hash unchanged)`) only when a pass begins. An instance that continues a pass part way through, or a
  retry after a failed step, records no skips: the files it will not run are the ones the earlier part of the pass
  applied, and their `1` (`First apply`) or `2` rows stay as they were.

**Files that must run again with an unchanged hash.** The [redefinition closure](#how-it-works) and the two sweeps
([duplicate overloads](#stale-duplicate-overloads-are-swept-automatically) and
[stale function definitions](#stale-function-definitions-are-re-applied-automatically)) re-run files whose own hash
is current. When the pass begins, each such file's `content_hash` is set to `pending-rerun`, a value that is never a
real SHA-256, so the file reads as changed until it has run. Without that, a failure after an earlier definition had
committed would leave the later one with a current hash, and nothing would ever re-run it. When the file applies, its
description reads `Re-applied (<reason>)` and its real hash is restored.

### The failure record {#failure-record}
{verified: SchemaStepRunnerTests.AFailedStep_RollsBack_AndItsFailureRecordSurvivesAsync, SchemaStepRunnerTests.ARecordThatCannotBeWritten_IsLogged_AndTheStepsOwnFailurePropagatesAsync, SchemaStepRunnerTests.ACanceledStep_RecordsNoFailureAsync, PostgresSchemaInitializerBranchTests.InitializeSchemaAsync_AMigrationThatFailed_RunsAgainOnTheNextStartAsync}

A failed step's row is written **after** its transaction rolls back, on the same connection with no transaction
open, so the record is not lost with the work:

| Column | Value |
|---|---|
| `status` | `-1` |
| `status_description` | `Failed: <SQLSTATE> <message>`, for example `Failed: 40P01 deadlock detected` (a failure that is not the server's is named by its exception type) |
| `content_hash` | **never** the file's real hash: a row inserted for a file that never applied gets `pending-rerun`, and an existing row keeps the hash it had |

Keeping the real hash out is what guarantees a failure cannot make a step look current: the next start compares
hashes, finds the file changed, and runs it. A canceled start is not a failed step and records nothing. If the record
itself cannot be written (the connection is gone, say), that is logged as a warning and the step's own error is the
one raised.

**Fixed in the Dapper driver alongside this change.** The Dapper `PostgresSchemaInitializer` wrote the file's own hash
into its `-1` record, so a file that failed for a reason outside its text (a deadlock, a lock timeout, a dropped
connection) read as current and was **skipped on every later start**. It now follows the same rule and the failed file
runs again on the next start. Its description stays `Failed: <message>`.

### Statements that handle their own errors run under a savepoint {#step-savepoints}
{verified: MigrationStepTransactionTests.AFailureInOneFile_KeepsTheFilesBeforeIt_AndTheRetryAppliesOnlyFromItOnAsync}

Some statements in the pass are expected to fail now and then and are handled rather than raised: the compatibility
renames, the constraints, the two registry reconciles, a perspective table or function that already exists (`42P07`,
`42723`), and creating the tracking table. In PostgreSQL any failed statement aborts the transaction it runs in, so a
handled failure would leave the step's transaction aborted and its commit would silently roll the whole step back.
Each of these now runs under a savepoint, so a handled failure is undone on its own and the step commits as intended.

### Reading the step lines {#step-log-lines}
{verified: StartupMigrationStepsTests.AFreshDatabase_LogsEveryStepStartedAndSucceeded_ThenTheSummaryAsync, StartupMigrationStepsTests.ARestartOnACurrentDatabase_RunsNoStep_AndNoDdlAsync, SchemaStepRunnerTests.APass_LogsEveryStepAgainstItsTotal_AndOneSummaryAsync, SchemaStepRunnerTests.AFailureAtStepN_IsLoggedWithItsSqlState_AndThePassStopsThereAsync, SchemaStepRunnerTests.ARetryableFailure_SaysItWillRetry_AndWhenAsync}

Every step of a pass logs one fixed form, counted against the whole pass:

| Line | Level | Meaning |
|---|---|---|
| `Migration X of Y - Started : <name>` | Information | The step holds the lock and is running |
| `Migration X of Y - Succeeded : <name> (<duration>)` | Information | It applied and committed; the duration is seconds to the millisecond, as in `1.234s` |
| `Migration X of Y - Skipped : <name> (already current)` | Information | Nothing to do: either the plan did not owe it (no `Started` line before it) or its row read current under the lock (after a `Started` line) |
| `Migration X of Y - Failed : <name> : <SQLSTATE> <error>` | Error | It failed and rolled back; when the initializer will retry, the line ends `; retrying in <delay> at <time>` |
| `Migration complete: Y of Y succeeded (N applied, M skipped) in <duration>` | Information | The pass finished |
| `Migration stopped at X of Y: <name> : <error>` | Error | The pass stopped at that step; nothing after it ran in this attempt |

**What Y counts.** Y is every step of the pass, including the ones it skips: each migration file the build carries,
each perspective table (or one `perspective-tables` step for a context with none), plus four for the core tables, the
constraints, the associations and the registries. A context with 218 migration files and 3 perspectives counts
`Y = 218 + 3 + 4 = 225`. The first step, which re-checks the hashes and records the plan, is not counted and logs no
line. The order is the core tables, the migration files in order, the perspective tables, then the constraints, the
associations and the registries.

A restart against a database that is already current takes the fast path: it runs no step, logs no step line, and
issues no DDL at all.

Here is a pass that failed at a migration file and the retry that finished it:

```text{title="A failed step and the retry that resumes at it" description="The first attempt stops at step 110 with a deadlock; every step before it stays committed. The retry skips them and starts again at step 110." tests=["StartupMigrationStepsTests.AFailedStep_KeepsWhatCommitted_RecordsItsError_AndTheRetryResumesThereAsync"]}
info:  Migration 1 of 225 - Started : core-infrastructure
info:  Migration 1 of 225 - Succeeded : core-infrastructure (0.412s)
info:  Migration 2 of 225 - Started : 000_MigrationTracking.sql
info:  Migration 2 of 225 - Succeeded : 000_MigrationTracking.sql (0.031s)
...
info:  Migration 110 of 225 - Started : 110_StandbyHandshake.sql
fail:  Migration 110 of 225 - Failed : 110_StandbyHandshake.sql : 40P01 deadlock detected; retrying in 4.000s at 2026-10-22T14:03:07.5120000+00:00
fail:  Migration stopped at 110 of 225: 110_StandbyHandshake.sql : 40P01 deadlock detected

info:  Migration 1 of 225 - Skipped : core-infrastructure (already current)
info:  Migration 2 of 225 - Skipped : 000_MigrationTracking.sql (already current)
...
info:  Migration 110 of 225 - Started : 110_StandbyHandshake.sql
info:  Migration 110 of 225 - Succeeded : 110_StandbyHandshake.sql (0.087s)
...
info:  Migration 225 of 225 - Started : registries
info:  Migration 225 of 225 - Succeeded : registries (0.054s)
info:  Migration complete: 225 of 225 succeeded (116 applied, 109 skipped) in 9.871s
```

How to read it:

- **Where did it stop, and why?** The `Failed` line and the `Migration stopped at` line name the step, its position,
  the SQLSTATE and the server's message. `wh_schema_migrations` carries the same text on that row
  (`status = -1`, `Failed: 40P01 deadlock detected`).
- **What survived?** Every step before X committed. The retry skips them (`Skipped ... (already current)` with no
  `Started` line) and its first `Started` line is the step that failed.
- **Is it retrying?** A failed line ending `retrying in ... at ...` says when the initializer's next attempt begins.
  A failure without that suffix is not one the initializer treats as transient, so it ends the attempt; in the
  default background mode the next attempt starts after `InitRetryDelay`.
- **Is anything stuck?** A pass that logs the same `Failed` step on every retry is failing on that file itself, not on
  anything before it; the error text says what to fix.

### What is not covered yet {#step-transactions-not-covered}

- **A single file can still deadlock on its own.** Per-step commits stop a deadlock from discarding the steps before
  it, and the retry resumes at the file; they do not change the order in which that file takes its locks relative to
  the rest of a starting instance. A file that alters a table other sessions are using at startup can still meet a
  `40P01` and need a retry.
- **Startup stage ordering is tracked separately.** Ordering the startup stages so the schema pass does not contend
  with the instance's own startup work, together with a numbered line per startup stage, is planned as its own change.

## Strategy Detection

When a perspective's hash changes and the table already exists, Whizbang auto-detects the migration strategy:

| Strategy | Trigger | Action |
|----------|---------|--------|
| **DirectDDL** | New table or identical structure | Execute DDL directly |
| **ColumnCopy** | Additive changes only (new columns) | Blue-green swap with data copy |
| **EventReplay** | Destructive changes (type change, column removed) | Queue background rebuild |

## Preview (Dry Run)

Preview what would happen without executing:

```csharp{title="Preview (Dry Run)" description="Preview what would happen without executing:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Preview", "Dry"] tests=["PostgresSchemaInitializerTests.PreviewAsync_FreshDatabase_ShowsAllAsApplyAsync", "PostgresSchemaInitializerTests.PreviewAsync_AfterInitialize_ShowsAllAsSkipAsync", "PostgresSchemaInitializerTests.PreviewAsync_WithChangedPerspective_ShowsUpdateWithColumnDiffAsync"]}
var initializer = new PostgresSchemaInitializer(connectionString, perspectiveEntries);
var plan = await initializer.PreviewAsync();

foreach (var step in plan.Steps) {
  Console.WriteLine($"{step.Name}: {step.Action}");
  if (step.AddedColumns != null)
    Console.WriteLine($"  + columns: {string.Join(", ", step.AddedColumns)}");
  if (step.RemovedColumns != null)
    Console.WriteLine($"  - columns: {string.Join(", ", step.RemovedColumns)}");
}
```

## Rollback

Restore a blue-green backup table:

```csharp{title="Rollback" description="Restore a blue-green backup table:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Rollback"] tests=["PostgresSchemaInitializerTests.RollbackAsync_WithBackupTable_RestoresItAsync", "PostgresSchemaInitializerTests.RollbackAsync_WithNoBackup_ReturnsFalseAsync"]}
var success = await initializer.RollbackAsync("perspective:OrderPerspective");
// Swaps: active -> discarded, backup -> active
```

## Backup Cleanup

Remove old backup tables:

```csharp{title="Backup Cleanup" description="Remove old backup tables:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Backup", "Cleanup"] tests=["PostgresSchemaInitializerTests.CleanupBackupsAsync_WithOldBackup_DropsItAsync", "PostgresSchemaInitializerTests.CleanupBackupsAsync_WithRecentBackup_KeepsItAsync"]}
var dropped = await initializer.CleanupBackupsAsync(olderThanDays: 30);
// Drops tables matching *_bak_* with dates older than threshold
```

## Version Auditing

Both the Whizbang library version and the consuming application version are recorded:

- **library_version**: The Whizbang NuGet package version (e.g., `0.9.4`)
- **application_version**: The consuming app's assembly name and version (e.g., `MyApp.OrderService/1.0.0`)

This lets you query which app version last applied migrations to a database.

### An older instance never overwrites a newer one

The recorded library version is not only for auditing — the applier reads it before running anything.

The decision to run a migration comes from comparing hashes, and hash inequality is **symmetric**: it says the content *differs*, never which side is newer. Because pre-v1 migration files are edited in place rather than superseded, that leaves a gap during a rolling deployment. An instance from the previous version that restarts after a newer one has migrated computes a different hash for its own older copy, and would re-apply it through `CREATE OR REPLACE` — returning objects to an earlier definition beneath the instances still running against them, with no error raised anywhere.

The [redefinition closure](#how-it-works) does not cover this. It re-runs every *later* file defining the same objects, and an older instance does not have those files.

So before applying, the runner compares its own library version against the version recorded on the ledger row, using **Semantic Versioning precedence**:

| Recorded against the row | Result |
|---|---|
| An older version | Applied normally — the ordinary upgrade path |
| The same version | Applied — this is how a drifted hash is repaired and how the redefinition closure re-runs |
| A **newer** version | **Skipped**, with a warning naming both versions |
| Nothing, or an unreadable version | Applied — a row predating version tracking must not leave a schema permanently unmigratable |

If the *running build's own* version is unreadable it applies nothing at all: a build that cannot state what it is has no business writing DDL.

Precedence follows the specification, including the parts that are easy to get wrong and that matter most before 1.0, when every release carries a pre-release label:

- a pre-release ranks **below** the release it precedes, so `1.0.0` outranks `1.0.0-rc.1`;
- numeric pre-release identifiers compare **numerically**, so `alpha.10` outranks `alpha.2` — comparing them as text inverts the answer;
- build metadata (`+sha.abc`) takes no part in precedence at all.

An instance that skips on this rule is not broken and needs no intervention: it is correctly declining to undo work done by a newer deployment.

### Stale duplicate overloads are swept automatically

Before `drop_all_overloads` resolved its own schema (it filtered by `current_schema()`, which pooled EF connections reduce to `public`), a signature change in a **multi-schema** deployment silently left the old overload beside the new one. Databases migrated through those prerelease versions can carry duplicates that make unqualified calls ambiguous and the next return-type change fail with `42P13`.

The initializer now detects this: when a framework-defined function name has more than one overload in the schema, the migrations defining that name are forced back into the run — their `drop_all_overloads` clears every overload and each file recreates its single canonical definition, with the redefinition closure re-running any later file defining the same object. One extra catalog query on a hash-clean boot; a clean database never re-runs anything. Consumer-defined functions with intentional overloads never trigger it — the check is intersected with the framework's own migration objects.

Log line to look for on an affected database's first boot after upgrading: `re-running to sweep stale duplicate overload(s)`.

### Stale function definitions are re-applied automatically
{verified: StaleFunctionDefinitionSweepTests.Initialize_WhenAFunctionIsOnAnEarlierDefinition_ReappliesItsLastWordAsync, StaleFunctionDefinitionSweepTests.Initialize_WhenAFrameworkFunctionIsMissing_RecreatesItAsync, StaleFunctionDefinitionSweepTests.Initialize_OnADatabaseThatMatchesItsFiles_DoesNotTriggerTheSweepAsync}

The content hashes describe the **files**; nothing above describes the **database**. A replay that predates the [redefinition closure](#how-it-works) could re-run an earlier file that defines a function *after* the later file that gives it its final definition. The database is then left holding the earlier body while every hash reads "unchanged" on every startup, because the last-word file itself never changed and so never re-runs. The symptom is a function a generation old that no restart repairs: for example, the registry reconciler that should honor a type's recorded former names keeps reporting drift for exactly the renamed types, forever.

The EF Core schema initializer now compares the database against the files on every startup. `MigrationFunctionBodies` extracts each dollar-quoted `CREATE [OR REPLACE] FUNCTION` body from the migration set, resolves the **last word** for every function name (the last file in order that defines it, and the body that file gives it), and queries `pg_proc.prosrc` for those names in one catalog query. Bodies are compared whitespace-normalized, because the embedded runner re-indents the file text. For every framework function whose deployed body differs from its last-word body, or that is missing from the schema, the last-word file is put back into the run; the redefinition closure then re-runs any later file defining the same objects, exactly as for a changed hash. {verified: MigrationFunctionBodiesTests.Extract_TwoRenderingsOfTheSameBody_NormalizeEqualAsync, MigrationFunctionBodiesTests.LastWord_LaterFileWins_EarlierFileKeepsItsOtherFunctionsAsync, MigrationFunctionBodiesTests.FilesToRerun_DeployedBodyIsAnEarlierDefinition_RerunsTheLastWordFileAsync, MigrationFunctionBodiesTests.FilesToRerun_FunctionMissingFromTheDatabase_RerunsItsLastWordFileAsync, MigrationFunctionBodiesTests.FilesToRerun_TwoStaleFunctionsInOneFile_ListsTheFileOnceAsync}

Five boundaries keep the sweep self-limiting:

- **A function a later migration drops is retired, not missing.** Definitions and retirements (`DROP FUNCTION`, `drop_all_overloads`) are applied in statement order, so a drop that precedes a recreation in the same file is superseded by that recreation, and a drop with no later definition removes the function from the comparison. Without this, a retired function would read as missing on every startup and its old file would replay forever. {verified: MigrationFunctionBodiesTests.LastWord_FunctionDroppedByALaterFile_IsRetiredAsync, MigrationFunctionBodiesTests.LastWord_DropAllOverloadsThenRecreateInTheSameFile_KeepsTheRecreationAsync, MigrationFunctionBodiesTests.LastWord_DropAllOverloadsWithoutARecreation_RetiresTheFunctionAsync}
- **The comparison sees the text the server received.** The generator embeds each migration with doubled braces because the runner executes it as a format string, which un-doubles them on the way to the server. The sweep renders the embedded text the same way before extracting bodies, so `'{}'::jsonb` in the database matches `'{}'::jsonb` in the file rather than the embedded `'{{}}'::jsonb`. {verified: StaleFunctionDefinitionSweepTests.Initialize_OnADatabaseThatMatchesItsFiles_DoesNotTriggerTheSweepAsync}

- **A database that matches its files re-runs nothing.** It pays one catalog query per startup, and the fast path (all hashes match, no duplicate overloads) consults the same probe silently before exiting, so a hash-clean database on a stale definition is still healed. {verified: MigrationFunctionBodiesTests.FilesToRerun_DeployedBodyMatchesLastWord_NothingRerunsAsync}
- **Duplicate overloads are left to the overload sweep above.** A name with more than one `pg_proc` row is skipped here; the overload sweep's `drop_all_overloads` and recreate owns that case. {verified: MigrationFunctionBodiesTests.FilesToRerun_DuplicateOverloads_AreLeftToTheOverloadSweepAsync}
- **Only bodies the database will hold verbatim are compared.** A `CREATE FUNCTION` that sits inside dynamic SQL (a `format(...)` template with `%I` placeholders) or that has no dollar-quoted body is skipped, so a placeholder can never be mistaken for a stale definition. Over-skipping only narrows the check. {verified: MigrationFunctionBodiesTests.Extract_DynamicSqlTemplate_IsSkippedAsync, MigrationFunctionBodiesTests.Extract_FunctionWithoutADollarQuotedBody_IsSkippedAsync, MigrationFunctionBodiesTests.Extract_TaggedDollarQuote_UsesTheMatchingCloserAsync}

Log line to look for, one per re-run file: `re-running because the database's definition of <functions> does not match this file, its last word`. The Dapper-based `PostgresSchemaInitializer` does not yet run this sweep; only the EF Core initializer (generated from `DbContextSchemaExtensionTemplate`) does.

### The bootstrap closure is applied once per definition, never per start

Before the election, every instance applies the bootstrap closure: the core tables and the regions
marked `-- @whizbang:bootstrap-begin` / `-- @whizbang:bootstrap-end`, which create what an election
needs. Every statement in it is idempotent DDL, and idempotent is not free: `CREATE INDEX IF NOT
EXISTS` on an existing index still takes a share lock on the table before it discovers there is
nothing to do. An instance an autoscaler started under load ran that DDL against tables the running
instances were writing, and deadlocked against the maintenance sweep and the work-available poll
sources within two seconds of starting.

The closure is now recorded. When it applies, the transaction that applied it also writes a hash of
the [normalized](#what-counts-as-a-change) scripts it ran to `wh_bootstrap_closure`, a table the closure itself creates. An instance
starting later hashes the closure it carries, finds the hash recorded, and applies nothing: no
statement, no lock, no wait. A closure that changed (a new release with a different bootstrap
region) has a different hash, so it runs in full once and records itself. The migration ledger is
untouched by any of this; the bootstrap still claims nothing about migrations.
{verified: SchemaBootstrapPhaseTests.ACurrentClosureIsNotAppliedAgainAsync, SchemaBootstrapPhaseTests.AChangedClosureIsAppliedAsync, SchemaBootstrapPhaseTests.TheBootstrapRecordsNothingInTheLedgerAsync}

### Database roles {#database-roles}
{verified: SchemaInitConnectionTests.FromConfiguration_ReadsTheInitSuffixOfTheContextsNameAsync, IndexStatisticsMaintenanceStepTests.WithAnInitConnection_AnalyzesThroughItAsync, ManagedSchemaReconcileStepTests.UnderADataOnlyApplicationRole_TheInitConnectionDoesTheSchemaWorkAsync, TableRewriteUnderDataOnlyRoleTests.UnderADataOnlyApplicationRole_TheInitConnectionDoesTheRewriteAsync, DataOnlyRoleE2ETests.UnderADataOnlyRole_WithTheOwnerAsInit_TheServiceStartsAndMaintainsItselfAsync}

The application can run with a role that reads and writes data and cannot change schema. Give the schema rights to a second role and put it behind the `-init` connection string (`ConnectionStrings:db-init`, or `<name>-init` for a named database). Everything that changes schema uses it:

- startup migrations and the perspective schema pass;
- the managed-object reconcile the maintenance worker runs between starts;
- the shadow-table swap of a [blue-green rebuild](../../fundamentals/perspectives/rebuild#blue-green);
- the `ANALYZE` of perspective tables whose new expression indexes have no statistics, which needs the table owner's rights;
- the opt-in table rewrite (`immediate` rewrite policy, off by default), whose `VACUUM FULL` also needs the table owner's rights.

Without an `-init` string, all of it runs on the application's connection, which then needs the same rights. Postgres does not refuse a `VACUUM FULL` from a role that does not own the table: it skips the table with a warning. The rewrite step measures the table again afterwards, so a skipped rewrite is reported as ineffective and stays queued for the next start.

```sql{
title: "Two roles: one owns the schema, one uses it"
description: "The init role creates and owns every object; the application role gets data rights on them, including objects created later."
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["postgres", "security", "roles", "migrations"]
}
-- The role behind ConnectionStrings:db-init: owns the schema and everything in it.
CREATE ROLE orders_owner LOGIN PASSWORD '...';
CREATE SCHEMA orders AUTHORIZATION orders_owner;

-- The role behind ConnectionStrings:db: data only.
CREATE ROLE orders_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA orders TO orders_app;

-- Objects the owner creates from now on, at every start and in every rebuild.
ALTER DEFAULT PRIVILEGES FOR ROLE orders_owner IN SCHEMA orders
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orders_app;
ALTER DEFAULT PRIVILEGES FOR ROLE orders_owner IN SCHEMA orders
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO orders_app;
ALTER DEFAULT PRIVILEGES FOR ROLE orders_owner IN SCHEMA orders
  GRANT EXECUTE ON FUNCTIONS TO orders_app;
```

Run the default-privilege statements before the first start, so every object the owner creates carries the grants. A database that already has objects also needs the same three `GRANT ... ON ALL ... IN SCHEMA orders` statements once.

### Which instance migrates {#which-instance-migrates}

The migrator is a duty, held by [role assignment](../startup/capabilities-and-duties#role-assignment-the-default) by default. Its vote is part of the bootstrap closure (migration `184_RoleAssignmentResilience.sql` is a bootstrap region), so the assignment table and its functions exist before the first migration runs. Every instance joins the registry, then votes; the winner migrates and releases the duty when it returns, however it returns.

An instance that lost the vote waits for the result instead of queuing behind the schema lock. It watches the migrator itself: its assignment row and, for a migrator on a release that still held the duty by session lock, that lock (`MigratorWatch`). The migrator renews its assignment between phases and marks the backend running its DDL, so one long migration statement does not lose the duty; its lease is 30 seconds by default (`RoleAssignmentOptions.RoleLeases`). If the migrator dies, its assignment lapses and a waiter goes on to do the schema work itself, still under the schema lock, which keeps DDL to one instance at a time whatever the duty says.
{verified: MigratorWatchTests.AMigratorHoldingTheRole_IsMigrating_UntilItReleasesItAsync, MigratorWatchTests.AMigratorOnAnOlderRelease_HoldingTheDutysSessionLock_IsMigratingAsync, SchemaMigratorDeferralGenerationTests.AWaiterWatchesTheMigratorAsync, SchemaMigratorDeferralGenerationTests.TheMigratorRenewsItsRole_AndMarksTheBackendRunningTheMigrationAsync}

### Table rewrites run post-ready, under the maintainer duty

A migration cannot `VACUUM FULL` (both are forbidden inside its transaction), so a migration that leaves a table owing a rewrite — a `DROP COLUMN`, whose bytes Postgres keeps in every pre-existing row — **records** the request via `wh_request_table_rewrite`. The runtime bloat detector records through the same function when churn bloats a table past threshold.

The recorded rewrites are performed by the startup pipeline's **`Rewrite` step**: post-ready (`Blocking = false` — deliberately unbounded work never gates readiness), fleet-exclusive under the `maintainer` duty (one instance rewrites; non-holders skip, because nobody blocks on a `VACUUM FULL`). Execution stays behind `MaintenanceWorkerOptions.AllowTableRewrite` — the framework cannot know how large a consumer's table is, and taking an ACCESS EXCLUSIVE lock unattended must be opted into. A request is cleared only after the bloat ratio is confirmed to have dropped; an ineffective rewrite stays queued for the next boot.

The runtime maintenance cycle **no longer executes rewrites** — an ACCESS EXCLUSIVE lock mid-traffic was always the wrong window. It detects, reports the bloat gauge, and records.

## The stored-form rewrite

A perspective document stores every date, time and duration as one number in one unit,
microseconds ([dates, times and durations](../../fundamentals/perspectives/jsonb-containment.md#dates-times-and-durations)).
A database written by an earlier release holds older forms: renderings, and in the first canonical
release a day count for a date and a tick count for a duration. Those rows are converted at startup,
once, by a rewrite that is part of the migration path rather than of the schema files.

The same phase runs the migrations an application declares for its own stored documents when a
model changes shape (a property's type or name, a removal, a default): see
[Stored-form migrations](../../fundamentals/perspectives/stored-form-migrations.md). They run first,
journaled in `wh_stored_form_migrations`, under the same lock and fence. A migration that converts a
table brings forward the retries of the streams parked on it, and an index that still casts a
retyped key to its old type is dropped before the conversion and built again, concurrently, once the
phase has committed.

### What it converts

The rewrite is derived at runtime from the two things that read a document: the model Entity
Framework built, for a mapped document, and the serializer's metadata, for a document stored as a
single serialized value. Every placement either reader reaches is a path the rewrite converts, so a
member inherited from a base class, a nested object, an element of a collection and the framework's
own metadata are all reached because the readers reach them. Nothing is generated per property, so
there is no discovery to fall behind the readers.

{verified: CanonicalTemporalRewriteTests.AMappedDocumentYieldsEveryPlacementTheModelMapsAsync, CanonicalTemporalRewriteTests.AnOpaqueDocumentYieldsEveryPlacementTheSerializerReadsAsync, CanonicalTemporalRewriteWiringTests.TheRewriteIsDerivedFromTheModelAtRuntimeAsync, CanonicalTemporalRewriteWiringTests.NothingIsGeneratedPerPropertyAsync}

One SQL function, `wh_canonicalize_temporal`, rewrites one path of one document: a rendering becomes
the canonical number, a number in the mixed-unit form converts its unit, and anything else is left
exactly as it was, because a value the reader cannot parse is a thing to look at rather than a thing
to write over. It is idempotent over its own output.

{verified: CanonicalTemporalFunctionTests.ARenderingAtTheTopLevelBecomesTheNumberAsync, CanonicalTemporalFunctionTests.ANestedPathReachesTheValueAsync, CanonicalTemporalFunctionTests.ACollectionPathConvertsEveryElementAsync, CanonicalTemporalFunctionTests.ANumberInTheMixedUnitFormConvertsItsUnitAsync, CanonicalTemporalFunctionTests.ANumberInTheMicrosecondFormIsNeverTouchedAsync, CanonicalTemporalFunctionTests.WhatIsNotThereIsLeftAloneAsync, CanonicalTemporalFunctionTests.TheFunctionIsIdempotentOverItsOwnOutputAsync}

### The ledger says which unit a table is in

A day count and a microsecond count are both integers, and nothing in a document says which unit a
number is in. So a ledger says: `wh_perspective_forms` records, per table, the form it is in. A table
absent from the ledger is in the mixed-unit form (1); the rewrite converts it and records the
microsecond form (2) in the same transaction, so a failed pass leaves the ledger untouched and the
next startup tries again. Once a pass at form 2 finds nothing left to convert, the table is
**settled**, and every later startup skips it without a scan. A table this release creates is
recorded at form 2 and settled at creation, because it holds nothing older.

| Ledger says | The rewrite does |
|---|---|
| No row | Converts renderings and mixed-unit numbers, records form 2 |
| Form 2, not settled | Converts any rendering left, settles when a pass touches nothing |
| Settled | Nothing; the table is not scanned |

The conversion is one way. An older release cannot read a microsecond form, and nothing converts
back.

{verified: CanonicalTemporalRewriteIntegrationTests.OnePassConvertsEveryStoredFormAsync, CanonicalTemporalRewriteIntegrationTests.ASecondPassSettlesAndAThirdSkipsAsync, CanonicalTemporalRewriteIntegrationTests.AFailedPassLeavesTheLedgerUntouchedAsync, CanonicalTemporalRewriteIntegrationTests.AMissingTableIsSkippedAsync, FreshTableFormTests.ATableTheInitializerCreatedIsSettledAtTheMicrosecondFormAsync, FreshTableFormTests.RunningTheInitializerAgainLeavesTheRowAloneAsync}

### It runs once, after the election, and waits for the schema lock

The rewrite needs the ledger and the function a bootstrap-marked migration creates, and it needs to
run once, so it runs after the [migrator election](#version-auditing) on whichever instance goes on
to do the schema work: the instance that won the election, an instance that could not be staged, or
a waiter whose wait ended with the migrator gone. A migrator killed mid-rewrite leaves the remaining
tables in the old form and every replacement instance is a waiter, so the takeover path rewrites
before it contends for the DDL lock, through the same body the migrator runs.

The statements run under the schema-init key, the one the bootstrap and DDL phases take, in one
transaction of the phase's own with a savepoint per table: a transaction pooler cannot separate the
lock from the statements, nothing stays held if the instance dies, and one table's failure neither
undoes an earlier table nor stops a later one. An instance that cannot take the key **waits** for it,
polling with backoff for up to the schema command timeout. It never skips, because the holder is not
necessarily rewriting: a sibling's bootstrap or DDL transaction holds the same key and converts
nothing, and a sibling staged as a waiter never rewrites. Running out of the budget is a warning
naming the key; the tables stay in their current form, which every reader tolerates, and the next
start tries again.

That wait covers a race, not a queue. An instance that finds the key already held when it is about
to rewrite does not sit inside the rewrite behind a migration that may run for minutes; it watches
the key the way a waiter watches the migrator duty, through the same deferral, and rewrites when the
wait ends. A schema someone else brought up to date under it makes the rewrite a settled no-op and
the fast path an exit. A key released over a schema still behind makes this the instance that does
the work: it rewrites, then contends for the DDL lock as it always did.

Each table's block raises a notice on every exit and the phase relays it, so the startup log says
what a pass did:

```text
Stored-format rewrite is waiting for schema lock {LockId}, held by another instance
Stored-format rewrite: wh_per_thing: converted, 7 row update(s)
Stored-format rewrite: wh_per_other: settled, skipped
Stored-format rewrite: wh_per_gone: table absent, nothing to convert
Stored-format rewrite applied 3 of 3 table statement(s) under schema lock {LockId} in 1840 ms
```

The count is one per row and path, so a row with three converted keys counts three times. A table
that failed is a warning naming it, with the exception.

{verified: CanonicalTemporalRewritePhaseTests.AnInstanceWaitsForTheLockAndAppliesOnceItIsReleasedAsync, CanonicalTemporalRewritePhaseTests.AnInstanceGivesUpWhenTheLockStaysHeldAsync, CanonicalTemporalRewritePhaseTests.AFailureAfterASuccessKeepsTheSuccessAsync, CanonicalTemporalRewritePhaseTests.ANoticeRaisedByARewriteIsReportedAsync, CanonicalTemporalRewriteTests.TheStatementReportsEveryOutcomeAsANoticeAsync, CanonicalTemporalRewriteWiringTests.AWaiterThatTakesOverRunsTheRewriteBeforeTheDdlAsync, CanonicalTemporalRewriteWiringTests.AnInstanceThatWouldRewriteBehindAHeldSchemaLockWaitsOnTheLockFirstAsync, SchemaInitializationConcurrencyTests.Deferral_WhenTheMigratorCommits_AppliesNothingItselfAsync, SchemaInitializationConcurrencyTests.Deferral_WhenTheMigratorReleasesWithWorkOutstanding_TakesTheWorkOverAsync}

A release that changes a stored unit is not safe under a mixed fleet: an older instance still writing
would write forms this release has just converted away. The migrator cannot refuse to run under a
rolling update without deadlocking the rollout, so before it rewrites it names, at Warning, every
other release alive in the instance registry:

```text
Other releases are alive in the fleet for schema {Schema} while the stored-form rewrite runs: {Releases}
```

Deploy a unit-changing release without a mixed fleet: scale the older release to zero first, or
accept that rows it writes after the rewrite are read as renderings, counted on
`whizbang.perspective.temporal_form_fallbacks`, until the next startup converts them.

{verified: CanonicalTemporalRewriteWiringTests.TheRewriteRunsAfterTheElectionOnTheMigratorAsync, CanonicalTemporalRewriteWiringTests.TheMigratorWarnsAboutOtherReleasesBeforeRewritingAsync, FleetVersionsTests.AnOlderReleaseStillAliveIsReportedAsync, FleetVersionsTests.TheSameReleaseIsNotReportedAsync, FleetVersionsTests.AStaleInstanceIsNotReportedAsync}

### Objects you own over a temporal key

Anything you create over a perspective document's temporal key reads the canonical number: a
trigger, a view, a generated column, an expression index, a mirror table's backfill. A cast of the
key's text to `timestamptz` was written for the rendering and fails on the number, in two places: the
rewrite's update of that table, reported as a failed table with the rest of the pass unaffected and
the table left unconverted, and then every later write the framework makes into that table once it
stores the number. The framework cannot know such an object exists, so the rewrite's warning naming
the table is the signal to look for one.

During a transition the object reads either form:

```sql{
title: "Read a temporal key in either stored form"
description: "A trigger, view, generated column or expression index over a perspective document's temporal key reads the canonical microsecond number, and during a transition the rendering an older release wrote."
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["stored-forms", "jsonb", "trigger", "timestamptz", "microseconds"]
}
CASE jsonb_typeof(NEW.data -> 'PublishedAt')
  WHEN 'number' THEN TIMESTAMPTZ 'epoch' + ((NEW.data ->> 'PublishedAt')::bigint * INTERVAL '1 microsecond')
  WHEN 'string' THEN NULLIF(NEW.data ->> 'PublishedAt', '')::timestamptz
  ELSE NULL
END
```

Interval arithmetic rather than `to_timestamp(n / 1e6)`, which goes through a double and can lose
the last microsecond. A date key is the same number at midnight UTC; a duration is
`n * INTERVAL '1 microsecond'` with no epoch.

### When a row cannot be read

Every reader of a stored temporal refuses a value it cannot read with an exception that names the
type, the forms accepted and the token found, and the serializer adds the path. The same holds for a
document EF Core maps: when its materializer cannot read a stored value (a number where the property
is a string, for example), the store classifies the failure as stored-form unreadable and reports it
with the path of the value (`$.Status`), with the original error inside. The perspective worker
classifies that failure by its type, wherever it sits in a chain of wrappers, and then:

- logs it **once per perspective and stream**, at Error, with the path and the refusal, under event
  id 65; the same stream failing again is logged at Debug until it reads again;
- counts it on `whizbang.perspective.read_failures`, tagged by perspective and by reason
  `stored_form_unreadable`;
- reports every leased row of the stream through the failure channel, so the database records the
  failure, schedules the retry with backoff, and dead-letters the row at the configured threshold.
  One failed lease is one recorded failure, however many drains report it, so the threshold counts
  attempts. The stream is parked in the database, not retried every cycle;
- reports the stream on the managed health endpoint as the `perspective-stored-forms` component,
  Degraded with the count and the first detail, until the stream reads again.

The log line to look for:

```text
Perspective {PerspectiveName} cannot read its stored document for stream {StreamId} at {Path}: {Detail}
```

`{Detail}` reads, for example, `A stored DateTime must be a number (microseconds) or a rendering, but
the document holds True`. A row like that is one the rewrite left alone on purpose; look at the value
before deciding what to write over it.

{verified: StoredFormUnreadableTests.AWrappedRefusalIsClassifiedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_UnreadableStoredForm_IsAnnouncedCountedAndParkedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_UnreadableStoredForm_AgainIsQuietAndRecoveryReleasesAsync, PerspectiveFailureCounterSqlTests.RecordedFailure_InTheShapeTheRuntimeWrites_IsRecordedAsync, StoredFormHealthSourceTests.AnUnreadableStreamIsDegradedWithDetailAsync, MappedDocumentReadFailureTests.AValueOfTheWrongType_IsExplainedWithItsPathAsync, StoredFormScalarMismatchWorkerTests.NumberForAStringProperty_IsClassifiedParkedAndDegraded_OthersFlow_AndACorrectedRowRecoversAsync, PerspectiveFailureCounterSqlTests.RecordedFailure_ReportedTwiceForOneLease_CountsOnce_AndTheNextLeaseCountsAgainAsync}

## Data Migrations vs. Schema Migrations

Hash tracking answers **"did the DDL / object *shape* change?"** — the SHA-256 is over the migration's SQL text, which for schema migrations mirrors the object it defines. That is exactly the wrong question for a **pure data migration** that rewrites *rows* without changing any table's shape: the hash can't tell whether the data still needs the fix, and re-scanning a large table on every startup is wasteful.

For those, gate the work on a **version marker row in `wh_settings`** instead of the migration hash:

```sql{title="Settings-gated data migration" description="Gate a one-time data rewrite on a wh_settings version, not the migration hash" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Data-Migration", "Settings"]}
DO $migrate$
DECLARE v_version INTEGER;
BEGIN
  SELECT setting_value::INTEGER INTO v_version
  FROM __SCHEMA__.wh_settings WHERE setting_key = 'my_data_format_version';
  IF COALESCE(v_version, 1) >= 2 THEN
    RETURN;                       -- O(1) check; already migrated, no table scan
  END IF;

  -- ... one-time UPDATE(s) to normalize existing rows ...

  INSERT INTO __SCHEMA__.wh_settings (setting_key, setting_value, value_type, description)
  VALUES ('my_data_format_version', '2', 'integer', 'Encoding version of <column>.')
  ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
END
$migrate$;
```

The canonical example is `063_NormalizeClrTypeNamesV2.sql`, which normalizes stored CLR type names (both message and perspective types) to their `+`-nested form and records `clr_type_name_format_version = 3`. Because the migration file still ships and runs through the normal chain, the marker — not the file hash — is the source of truth for *data* state; bumping the marker (e.g. `2 → 3` when the normalization was extended to cover perspective types) makes the pass re-run once on already-migrated databases, and re-running after the current version is a cheap no-op.

### The `wh_settings` table

`wh_settings` (a `setting_key` / `setting_value` / `value_type` / `description` key-value table) is the home for two kinds of SQL-side entries:

- **Data-format version markers** — e.g. `clr_type_name_format_version` (above).
- **Operational tuning knobs** read by SQL functions — e.g. `perform_maintenance` reads `debug_mode`, `dedup_retention_days`, `stuck_inbox_retention_days`, `abandoned_stream_hours` (the idle grace before an owner-less `wh_active_streams` row is purged), `ephemeral_rewind_grace_seconds`, and `collective_ordering_head_retention_days` (how long an idle collective ordering key keeps its predecessor head, default 7). Later migrations redefine `perform_maintenance` in place, so the authoritative knob list is whatever the latest redefinition reads.

Settings are seeded by migrations with `ON CONFLICT (setting_key) DO NOTHING` (so operator overrides survive re-runs). Keep C#-worker-coupled timing constants (retry backoff, work leases, liveness thresholds) *out* of this table — tuning them independently of the workers that assume them causes drift.

### Conversion markers {#conversion-markers}

{verified: LogPartitionConversionTests.TheMarker_StopsTheConversionRunningAgainAsync, LogPartitionConversionTests.Conversion_InterruptedPartway_LeavesTheTableAsItWas_AndTheNextCycleCompletesItAsync, LogPartitionConversionTests.AnAlreadyPartitionedTable_IsMarkedWithoutChangeAsync}

Converting a table to time partitions is a data migration too, but it does not run from a migration file: it runs
from the maintenance cycle, and only once the partition manager is enabled
([partitioned ledgers](partitioned-ledgers#converting-an-existing-table)). It is gated the same way, on a marker in
`wh_settings`:

| Marker | Value | Written by |
|---|---|---|
| `wh_log_partition_version` | `1` once `wh_log` is partitioned by `logged_at` | `wh_partition_convert` (migration 226) |

The rules are the ones above: the marker, not the table's shape, decides whether the conversion runs, so a marker
present means it never runs again. The conversion is one transaction and writes the marker in it, so an interrupted
conversion leaves neither a half-converted table nor a marker, and the next cycle starts again. A table found already
partitioned without a marker gets the marker and is left as it is. Deleting the marker on a converted table is
harmless for the same reason. The general name is `<table>_partition_version`, for the tables that follow.

## Normalizing type names {#normalizing-type-names}

A stored CLR type name has one canonical form: `Namespace.Type, Assembly`, with every
`, Version=…, Culture=…, PublicKeyToken=…` decoration removed at any depth. Whizbang computes it in C# with
`EventTypeMatchingHelper.NormalizeTypeName` and in SQL with `wh_normalize_clr_type_name`. The two agree byte for
byte, and a parity test holds them to it over plain, nested (`Ns.Outer+Inner`) and generic
(`` Ns.Box`1[[Ns.Inner, Inner.Asm, Version=…]] ``) names. For a type with no type arguments the form is also what
`TypeNameFormatter.Format` writes.

| Function | Returns |
|---|---|
| `wh_normalize_clr_type_name(text)` | The canonical form of a stored name. |
| `wh_normalize_assembly_name(text)` | The name's own assembly, the one outside any type arguments. |
| `normalize_event_type(text)`, `normalize_assembly_name(text)` | Aliases of the two above, kept for existing callers. |

These are contractual surface: call them from your own migrations rather than writing a second definition of the
form. The stability contract is the `wh_settings` row `clr_type_name_format_version` (currently 3). If the canonical
form ever changes, that number changes with it, so a migration of yours can guard on it the way `063` does.

```sql{title="Normalizing a type name your own documents store" description="A consumer migration rewrites a field holding a type name to the canonical form" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Data-Migration", "Type-Names"] tests=["ClrTypeNameNormalizerParityTests.SqlNormalizer_AgreesWithTheCSharpHelperAsync", "ClrTypeNameNormalizerParityTests.SqlNormalizer_OfAVersionedName_IsTheFormattedKeyAsync"]}
UPDATE my_schema.wh_per_order_workflow
SET data = jsonb_set(data, '{HandlerType}',
                     to_jsonb(my_schema.wh_normalize_clr_type_name(data ->> 'HandlerType')))
WHERE data ->> 'HandlerType' LIKE '%Version=%';
```

The first SQL definition cut a name at its first `, Version=`. For a generic name that is inside the type arguments,
and it left an unbalanced fragment. The canonical function strips the decoration carefully instead.

### Finding qualified type names in your own data {#finding-qualified-type-names}

Whizbang normalizes the columns it owns. Your type names live inside your own documents, under field names Whizbang
has never seen, so finding them is the hard part. `wh_find_qualified_type_names()` reads every text and JSON column in
the service's schema and reports, per column, the rows holding a versioned assembly-qualified name, how many distinct
spellings there are, how many logical types those spellings name, and a sample:

```sql{title="Finding the columns that hold versioned type names" description="More spellings than logical types is the defect" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Type-Names"] tests=["ClrTypeNameNormalizerParityTests.FindQualifiedTypeNames_ReportsSpellingsPerLogicalTypeAsync"]}
SELECT table_name, column_name, rows, distinct_spellings, logical_types, sample
FROM my_schema.wh_find_qualified_type_names()
WHERE distinct_spellings > logical_types;
```

More spellings than logical types is the defect: the same type written under two versions, so two keys for one
thing. It reads every candidate column, so run it deliberately, not on a schedule.

**Perspective snapshots are normalized for you.** `wh_perspective_snapshots` is a Whizbang table holding documents
shaped like yours, and it is the one place you are least likely to look. Without this, a consumer that normalizes its
own perspectives gets the decorated form back the next time a projection restores from a snapshot. Migration 191
strips complete version decorations from the names inside snapshots once, in bounded slices. It is gated by the
`wh_settings` row `perspective_snapshot_type_name_version`. Only a full `Version`, `Culture`, `PublicKeyToken`
decoration is removed, so prose that mentions a version is left alone. Your own tables are your data and are not
rewritten.

{verified: ClrTypeNameNormalizerParityTests.SqlAssemblyName_IsTheTypesOwnAssemblyAsync, ClrTypeNameNormalizerParityTests.SnapshotSweep_NormalizesQualifiedNamesInsideSnapshotsAsync, ClrTypeNameNormalizerParityTests.SnapshotSweep_AfterItRan_ReportsNothingToDoAsync}

## Bounded data migrations {#batched-regions}

A migration file is sent to the database as **one command**, and that command carries one timeout. A
statement that rewrites every row of a table therefore cannot finish once the table is large enough,
and writing a loop inside the SQL does not help — a `DO` block is still one command, so the whole
loop shares the single budget. The failure is not a clean error either: the statement is cut off, the
migration's transaction rolls back, the retry starts from the beginning, and the ledger never moves.
A service in that state never finishes starting.

How large a consumer's event store or inbox gets is not knowable when a migration is written, so the
bound has to be on **rows per statement** rather than on elapsed time.

### Marking a region

Wrap the statement in a batch region. The runner sends what is inside it repeatedly — each send its
own command, with its own budget — until it reports that it handled no rows.

```sql{title="Marking a batched region" description="The runner sends what is inside the markers repeatedly, each send its own command, until it reports no rows left" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Data-Migration"] tests=["MigrationBatchRegionsTests.AMarkedRegionBecomesABatchSegmentAsync", "MigrationBatchConvergenceTests.TheBackfillMovesOneBoundedSliceAtATimeAndThenStopsAsync"]}
-- @whizbang:batch-begin size=5000
SELECT __SCHEMA__.wh_backfill_something(@whizbang_batch_size);
-- @whizbang:batch-end
```

`size=` is optional and defaults to 10,000. `@whizbang_batch_size` is replaced with that number
before the statement is sent; it is not a bound parameter, because a migration is a script rather
than a prepared statement.

Markers sit next to the statement they bound, for the same reason the bootstrap markers do: a list
kept in code goes stale the first time a migration changes, while a marker is edited by whoever edits
the statement. Segments keep file order and are never grouped, so a backfill marked below the
function it calls still runs after that function is created.

### What the region has to be

**A statement that returns the number of rows it handled**, normally `SELECT` of a function. Two
reasons, both load-bearing:

- A backfill usually needs a **guard** — on a ledger replay the column it rewrites may no longer
  exist — and a guard needs a function body, which bare DML cannot carry. A guarded function returns
  `0` and the runner stops after one call.
- A function can run **several statements that see each other's effects**. A single statement's CTEs
  cannot: every arm reads the same snapshot, so an `UPDATE` arm cannot see rows an `INSERT` arm just
  wrote. A backfill that inserts a row then nulls the original only if the copy exists has to be two
  statements, or it nulls nothing and never terminates.

### What makes it terminate

**The statement must exclude the rows it has already handled.** This is the whole contract, and it is
a property of the SQL rather than of the marking:

```sql{title="Predicates that terminate, and one that does not" description="A batched region stops when its statement excludes the rows it already handled; ON CONFLICT DO NOTHING reports zero for rows already copied and stops early" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Data-Migration"] tests=["MigrationBatchConvergenceTests.TheBackfillMovesOneBoundedSliceAtATimeAndThenStopsAsync", "MigrationBatchConvergenceTests.TheBackfillReportsNothingWhenThereIsNothingToDoAsync"]}
-- terminates: the rows it fills stop matching
WHERE normalized_message_type IS NULL

-- terminates: the rows it rewrites stop differing
WHERE aggregate_type IS DISTINCT FROM split_part(event_type, ',', 1)

-- does NOT terminate: ON CONFLICT DO NOTHING reports zero for rows already copied,
-- so a slice of already-seeded rows reads as "nothing left" and stops early
INSERT INTO target SELECT ... FROM source ON CONFLICT DO NOTHING
```

For that last shape, exclude the copied rows explicitly with `NOT EXISTS` rather than relying on the
conflict clause.

A region that never reports zero is stopped after 10,000 passes with an error naming the migration,
so a non-converging statement fails by name rather than leaving a service that never starts.

### Bounding without a key

`LIMIT` inside a subquery is the usual bound. `UPDATE` has no `LIMIT` in PostgreSQL, so it goes in
the row selection:

```sql{title="Bounding an UPDATE without a LIMIT clause" description="PostgreSQL has no UPDATE ... LIMIT, so the bound goes in the row selection" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Data-Migration"] tests=["MigrationBatchConvergenceTests.TheBackfillMovesOneBoundedSliceAtATimeAndThenStopsAsync"]}
UPDATE __SCHEMA__.wh_inbox
   SET source_commit_sequence = 0
 WHERE message_id IN (
   SELECT message_id FROM __SCHEMA__.wh_inbox
    WHERE source_commit_sequence IS NULL
    LIMIT p_limit
 );
```

Where the table has no key declared in SQL — some are created from code — `ctid` bounds a slice just
as well.

### Ordering around a backfill

Segments run in file order, so a step that depends on a backfill having finished goes in plain SQL
*after* the region. Adding a column, filling it, and then enforcing `NOT NULL` is three segments in
that order; the constraint is only reached once the fill has reported nothing left.

## Constants {#constants}

{verified: MigrationConstantsTests.TheConstantsFile_DefinesEveryTokenTheMigrationsWriteAsync, MigrationConstantsTests.TheMigrationsTheProviderHandsOut_CarryNoTokens_AndTheValuesAreInPlaceAsync, MigrationConstantsTests.UnknownTokens_NamesATypo_AndIgnoresTheSchemaPlaceholdersAsync, MigrationConstantsTests.Parse_RejectsTheShapesThatWouldMisfireAsync}

A migration modifies a function by redefining it whole (the previous definition plus the delta), so the
literals a function needs travel with every copy: the empty stream id, the envelope's JSON field names, the
work-category names, the instance application-name prefix. Repeating a literal in a dozen copies is where a
mistyped one hides. Those literals are defined once, in `src/Whizbang.Data.Postgres/Migrations/constants.txt`,
and a migration writes the token where it would otherwise spell the value:

```sql{
title: "A shared literal written as its token"
description: "The store function reads the envelope field and compares the stream id through tokens; the values come from constants.txt at apply time."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["migrations", "constants", "tokens", "lint"]
}
-- constants.txt
__EMPTY_UUID__ = '00000000-0000-0000-0000-000000000000'
__ENVELOPE_FIELD_MESSAGE_ID__ = 'MessageId'

-- a migration
(elem->>__ENVELOPE_FIELD_MESSAGE_ID__)::UUID AS msg_id,
... WHERE i.stream_id = __EMPTY_UUID__::uuid
```

The value is substituted at apply time on the same path as `__SCHEMA__`: the runtime migration provider, the
embedded-migration path a generated DbContext executes, and the drift comparison that decides whether a
deployed function body still matches its migration. Values are SQL fragments, quotes included; the SQL adds a
cast where one is needed. Tokens are UPPER_SNAKE names between double underscores, a token may not be a
substring of another, and `__SCHEMA__` is the schema placeholder, not a constant.

Two checks hold the rule. `scripts/Lint-MigrationSql.ps1` fails a migration numbered 148 or later that
writes one of the values raw, or writes a token the file does not define. `MigrationConstantsTests` fails the
build if any migration, whatever its number, writes a token nothing defines, and proves the provider hands
out migrations with every token replaced.

## Named schemas on the EF Core driver {#named-schemas}

An EF Core context can keep the framework tables in a schema of its own, for example `api`. The migrations write
that schema as the placeholder `__SCHEMA__`. The Dapper driver substitutes the bare name (`api`); the EF Core driver
substitutes the quoted identifier (`"api"`) and also qualifies a fixed list of framework table names that the
oldest migrations wrote without the placeholder.

Three mechanisms keep migrations correct on such a context:

- **Literals and comments are not qualified.** The EF Core driver qualifies a framework name only where SQL names
  an object. A string literal, an escape string, a quoted identifier and a comment are left exactly as written.
  The body of a dollar-quoted string is code, so its table references are qualified, while the literals and
  comments inside it are not.
- **Each migration runs in its own schema.** The EF Core runner sets `search_path` to the context's schema for
  each migration, and for the bootstrap regions, and restores it afterwards. A shipped guard that compares
  `table_schema = current_schema()` therefore asks about the schema it alters. The Dapper driver takes its schema
  from `current_schema()`, so it needs no setting.
- **A catalog lookup names its own schema.** A new migration, and every run-time function, writes the schema as
  `replace('__SCHEMA__', '"', '')`. It never uses `current_schema()`, which returns the caller's `search_path`
  (`public` on a pooled connection), and never compares `'__SCHEMA__'` as text, which on the EF Core driver is the
  quoted form.

```sql{
title: "A guard that names its own schema"
description: "The catalog guard compares against the substituted schema, so it finds the existing column when the migration runs again in a named schema."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["migrations", "schema", "guards", "ef-core"]
}
IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = replace('__SCHEMA__', '"', '')
    AND table_name = 'wh_inbox'
    AND column_name = 'source_service_id') THEN
  ALTER TABLE __SCHEMA__.wh_inbox ADD COLUMN source_service_id UUID;
END IF;
```

### Upgrading an existing database

Before these rules, the EF Core driver also qualified names inside literals, so a guard written
`table_name = 'wh_inbox'` compared against `'"api".wh_inbox'`, and several guards compared against
`current_schema()`. On a context with a named schema and the default `search_path`, those guards could not see what
an earlier run had created. A first run on an empty database succeeded, but an upgrade that ran a changed migration
again failed at startup:

```text
Failed to execute migration 046_CommitSequenceSchema.sql
42701: column "source_service_id" of relation "wh_inbox" already exists
```

Other guarded repairs silently did nothing, and maintenance functions that found perspective tables through
`current_schema()` looked for them in `public`.

From the release that contains the fix, no shipped migration is changed. The EF Core runner sets `search_path`
for each migration, so a re-run of 046 finds the columns it added. Migration 213 redefines the seven run-time
functions that found their tables through `current_schema()`: the row reaps, `perform_maintenance`, the
retention preview, the reap-target collection and the table-rewrite scan. On a context with a named schema, every
migration whose text contains a framework name inside a literal or a comment has a new hash, because the
qualification no longer rewrites it. Each of these runs once more on the first startup after the upgrade (status 2,
Updated), and each is safe to run again over the existing schema. No manual step is required, and a second startup
skips them all. A Dapper host, and an EF Core host whose schema is `public`, run only migration 213.

The fix does not depend on the application's connection settings: the migrations run under the runner's own
`search_path`, and the run-time functions name their schema, so both work whatever `search_path` the calling
connection has. The rules for authors are in [Writing SQL migrations](../../../contributors/data-engines/writing-migrations.md).

## Pre-v1.0 Note

During pre-v1.0 development, migrations are **mutable** -- edit SQL files in place rather than creating new migration files. The hash tracking system handles re-execution automatically when content changes.
