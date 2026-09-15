---
title: Migration Tracking
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Data.Postgres/Migrations/063_NormalizeClrTypeNamesV2.sql
  - src/Whizbang.Data.Postgres/Migrations/032_PerformMaintenance.sql
  - src/Whizbang.Data.Postgres/MigrationFunctionBodies.cs
  - src/Whizbang.Data.Postgres/MigrationConstants.cs
  - src/Whizbang.Data.Postgres/SchemaCommandBoundary.cs
  - src/Whizbang.Data.Postgres/Migrations/constants.txt
  - scripts/Lint-MigrationSql.ps1
  - src/Whizbang.Data.Postgres/Migrations/153_PerspectiveForms.sql
  - src/Whizbang.Data.Postgres/Migrations/154_PerspectiveFailureElementNames.sql
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/CanonicalTemporalRewrite.cs
  - src/Whizbang.Data.Postgres/FleetVersions.cs
  - src/Whizbang.Core/Perspectives/StoredFormUnreadable.cs
  - src/Whizbang.Core/Perspectives/StoredFormFailureRegistry.cs
  - src/Whizbang.Core/Health/StoredFormHealthSource.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Data.Dapper.Postgres.Tests/MigrationConstantsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/NormalizeClrTypeNamesMigrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/CanonicalTemporalFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/FleetVersionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CanonicalTemporalRewriteTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CanonicalTemporalRewriteIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/FreshTableFormTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveFailureCounterSqlTests.cs
  - tests/Whizbang.Generators.Tests/CanonicalTemporalRewriteWiringTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/StoredFormUnreadableTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StoredForm.cs
  - tests/Whizbang.Core.Tests/Health/StoredFormHealthSourceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerBranchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/MigrationFunctionBodiesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StaleFunctionDefinitionSweepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaCommandBoundaryTests.cs
lastMaintainedCommit: '01f07906'
---

# Migration Tracking

Whizbang uses **hash-based migration tracking** to manage database schema changes automatically. Every SQL migration and perspective schema is tracked by its SHA-256 content hash, enabling skip-on-unchanged behavior, change detection, and operational tooling.

## How It Works

On each application startup, Whizbang:

1. **Creates tracking tables** (`wh_schema_versions`, `wh_schema_migrations`) if they don't exist
2. **Records the library version** and application version in `wh_schema_versions`
3. **Hash-checks each migration**: computes SHA-256, compares to stored hash
4. **Skips unchanged migrations** (status 3) or **re-executes changed ones** (status 2)
5. **Tracks each perspective individually** with `perspective:<Name>` keys

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

## Migration Statuses

| Status | Name | Meaning |
|--------|------|---------|
| 1 | Applied | Migration executed for the first time |
| 2 | Updated | Migration SQL changed, re-executed |
| 3 | Skipped | Hash unchanged, execution skipped |
| 4 | MigratingInBackground | Destructive change detected, background rebuild queued |
| -1 | Failed | Migration threw an exception |

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

### It runs on the migrator, after the election, and warns about a mixed fleet

The rewrite needs the ledger and the function a bootstrap-marked migration creates, and it needs to
run once, so it runs after the [migrator election](#version-auditing) on the instance that won it, or
on an instance that could not be staged; never on one waiting for the migrator.

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

### When a row cannot be read

Every reader of a stored temporal refuses a value it cannot read with an exception that names the
type, the forms accepted and the token found, and the serializer adds the path. The perspective
worker classifies that failure by its type, wherever it sits in a chain of wrappers, and then:

- logs it **once per perspective and stream**, at Error, with the path and the refusal, under event
  id 65; the same stream failing again is logged at Debug until it reads again;
- counts it on `whizbang.perspective.read_failures`, tagged by perspective and by reason
  `stored_form_unreadable`;
- reports every leased row of the stream through the failure channel, so the database records the
  failure, schedules the retry with backoff, and dead-letters the row at the configured threshold.
  The stream is parked in the database, not retried every cycle;
- reports the stream on the managed health endpoint as the `perspective-stored-forms` component,
  Degraded with the count and the first detail, until the stream reads again.

The log line to look for:

```text
Perspective {PerspectiveName} cannot read its stored document for stream {StreamId} at {Path}: {Detail}
```

`{Detail}` reads, for example, `A stored DateTime must be a number (microseconds) or a rendering, but
the document holds True`. A row like that is one the rewrite left alone on purpose; look at the value
before deciding what to write over it.

{verified: StoredFormUnreadableTests.AWrappedRefusalIsClassifiedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_UnreadableStoredForm_IsAnnouncedCountedAndParkedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_UnreadableStoredForm_AgainIsQuietAndRecoveryReleasesAsync, PerspectiveFailureCounterSqlTests.RecordedFailure_InTheShapeTheRuntimeWrites_IsRecordedAsync, StoredFormHealthSourceTests.AnUnreadableStreamIsDegradedWithDetailAsync}

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
- **Operational tuning knobs** read by SQL functions — e.g. `perform_maintenance` reads `debug_mode`, `dedup_retention_days`, `stuck_inbox_retention_days`, `abandoned_stream_hours` (the idle grace before an owner-less `wh_active_streams` row is purged), and `ephemeral_rewind_grace_seconds`. Later migrations redefine `perform_maintenance` in place, so the authoritative knob list is whatever the latest redefinition reads.

Settings are seeded by migrations with `ON CONFLICT (setting_key) DO NOTHING` (so operator overrides survive re-runs). Keep C#-worker-coupled timing constants (retry backoff, work leases, liveness thresholds) *out* of this table — tuning them independently of the workers that assume them causes drift.

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

## Pre-v1.0 Note

During pre-v1.0 development, migrations are **mutable** -- edit SQL files in place rather than creating new migration files. The hash tracking system handles re-execution automatically when content changes.
