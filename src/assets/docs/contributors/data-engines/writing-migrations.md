---
title: Writing SQL migrations
order: 9
---

# Writing SQL migrations

The PostgreSQL migrations in `src/Whizbang.Data.Postgres/Migrations/` are the single source of truth for the
framework schema. Both drivers run the same embedded files on every startup: the Dapper driver through
`PostgresSchemaInitializer`, and the EF Core driver through the generated `EnsureWhizbangDatabaseInitializedAsync`.
Each file is tracked by its content hash, so an unchanged file is skipped and a changed file runs again (see
[Migration Tracking](../../v1.0.0/operations/infrastructure/migrations.md)). The full list of authoring rules is kept
next to the files, in `Migrations/README.md`. This page describes how a migration names the schema it works in,
because that is where the two drivers differ.

## How each driver substitutes the schema

A migration writes the service schema as the placeholder `__SCHEMA__` and qualifies every framework object with
it (`__SCHEMA__.wh_inbox`). The drivers replace the placeholder differently:

| Driver | `__SCHEMA__` becomes | Other rewriting |
|---|---|---|
| Dapper | the bare schema name, for example `api` | none |
| EF Core | the quoted identifier, for example `"api"` | qualifies a fixed list of legacy framework names that a migration wrote bare |

The EF Core driver's qualification (`MigrationSchemaQualifier`) exists for the oldest migrations, which
referenced some framework tables without the placeholder. It is a safety net, not the contract: a new migration
qualifies every name itself.

## The qualification rewrites code only

`MigrationSchemaQualifier` qualifies a framework name only where SQL names an object. It walks the migration
the way the PostgreSQL lexer does and leaves the following exactly as written:

- string literals, including escape strings (`E'...'`) and doubled quotes (`'it''s'`);
- quoted identifiers (`"wh_inbox"`);
- line comments (`-- ...`) and block comments, including nested ones (`/* ... /* ... */ ... */`).

The body of a dollar-quoted string (`$$ ... $$` or `$tag$ ... $tag$`) is treated as code, because a function or
`DO` body holds real table references that must be qualified. The literals and comments inside that body are
protected in turn. A positional parameter such as `$1` is not a dollar quote.

Before this rule, the EF Core driver also rewrote literals. A guard written `table_name = 'wh_inbox'` became
`table_name = '"api".wh_inbox'`, a value that no catalog row holds. Comparisons against stored values, such as
the dead-letter `source_table`, and advisory-lock keys derived from table names changed in the same way.

## A catalog lookup names its own schema

A guard that asks `information_schema` or a `pg_*` catalog whether a table, column or index already exists must
ask about the schema that its DDL alters. A function that finds tables at run time must do the same. The schema
is written as:

```sql
replace('__SCHEMA__', '"', '')
```

This expression produces the bare schema name under both drivers, so it compares equal to
`information_schema.table_schema`. A table can also be reached through `to_regclass('__SCHEMA__.wh_x')`.

Three forms are not permitted:

- **`current_schema()`.** It returns the first schema on the caller's `search_path`. On the EF Core driver's
  connection, and on any pooled runtime connection, that is `public`, whatever schema the service owns.
- **`'__SCHEMA__'` compared as text.** The EF Core driver substitutes the quoted form (`'"api"'`), which no
  catalog row equals.
- **A lookup by table name alone.** In a shared database it can answer for another service's table.

```sql{
title: "A guard that names its own schema"
description: "The catalog guard compares against the substituted schema, so it finds the column on a re-run under either driver; ADD COLUMN IF NOT EXISTS needs no guard."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["migrations", "schema", "guards", "ef-core"]
}
-- Correct: the guard asks about the schema the DDL alters.
IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = replace('__SCHEMA__', '"', '')
    AND table_name = 'wh_inbox'
    AND column_name = 'source_service_id') THEN
  ALTER TABLE __SCHEMA__.wh_inbox ADD COLUMN source_service_id UUID;
END IF;

-- Simpler where it applies: no catalog guard at all.
ALTER TABLE __SCHEMA__.wh_inbox ADD COLUMN IF NOT EXISTS source_service_id UUID;
```

Where `ADD COLUMN IF NOT EXISTS` or another idempotent statement can express the change, it is preferred to a
catalog guard.

### Why the rule matters

Each of the forbidden forms makes a guard read "not there yet" for a service whose EF Core context has a schema of
its own. On an empty database that answer is true, so every first run passes, and every test that migrates into
`public` passes as well. The failure appears when a migration runs again over a database that already holds what
its earlier text created. The ledger re-runs a file whose content hash changed, so this happens on upgrade
whenever a shipped file differs between the two releases. The guarded DDL then fails, for example with
`42701: column "source_service_id" of relation "wh_inbox" already exists`, or a repair silently does nothing. A
run-time function that asks `current_schema()` looks for its tables in `public`.

## Shipped migrations, new migrations and run-time functions

A migration that has shipped is not edited; a change goes in the next-numbered file. The rule above is therefore
applied in three ways:

- **Shipped migrations.** Several shipped guards compare `table_schema = current_schema()`. The EF Core runner
  makes them correct without editing them: it runs each migration, and the bootstrap regions, with `search_path`
  set to the migrated schema for that migration only (`MigrationSearchPath`, transaction-local and restored
  afterwards). Inside a migration, `current_schema()` is then the schema the migration alters. The Dapper driver
  needs no setting, because it takes its schema from `current_schema()`.
- **New migrations.** A file written after the last shipped one names its schema in every catalog lookup, as
  shown above, and does not rely on the runner's `search_path`.
- **Run-time functions.** A function runs later, on a pooled connection that the runner's setting never reaches.
  When the latest definition of a function asks the caller's schema, the function is redefined whole in a new
  migration that names its schema. Migration 213 did this for the seven functions that needed it.

## Instance and role tables, and functions in the bootstrap closure {#bootstrap-closure-rules}

Some migrations hold `-- @whizbang:bootstrap-begin` / `-- @whizbang:bootstrap-end` regions. The marked regions of
every migration, in order, are the
[bootstrap closure](../../v1.0.0/operations/infrastructure/migrations.md#what-the-closure-carries) that every instance of
the EF Core driver applies in Preflight, before the election and the main pass. Two authoring rules follow from it.

**A new column on an instance or role table goes in a bootstrap region.** Registration, the electors, the heartbeat
and the eviction fence use `wh_service_instances`, `wh_instance_evictions`, `wh_instance_capabilities`,
`wh_role_assignments` and `wh_role_candidates` in Preflight and Elect,
before the main pass, so a column only the main pass adds is missing there on every fresh database. That is how a
fresh database's instance row once recorded no startup stage until Converge; migration 277 moved every such column
into the closure. Inside the region the column is:

- **catalog-checked:** added only when `pg_attribute` says it is missing, because `ADD COLUMN IF NOT EXISTS` takes an
  ACCESS EXCLUSIVE lock even when the column exists, and running instances use these tables on every heartbeat;
- **described in the same block:** the closure is the only place that adds the column on a database it brought up,
  so a `COMMENT ON COLUMN` anywhere else may never run.

```sql{
title: "A column on an instance table, in a bootstrap region"
description: "The column is added only when the catalog says it is missing, so an existing database takes no table lock, and it is described in the block that adds it."
category: "Configuration"
difficulty: "ADVANCED"
tags: ["migrations", "bootstrap", "schema", "locking"]
}
-- @whizbang:bootstrap-begin
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = to_regclass('__SCHEMA__.wh_service_instances')
                   AND attname = 'example_column'
                   AND NOT attisdropped) THEN
    ALTER TABLE __SCHEMA__.wh_service_instances ADD COLUMN IF NOT EXISTS example_column TEXT;

    COMMENT ON COLUMN __SCHEMA__.wh_service_instances.example_column IS
      'What the column holds and who writes it.';
  END IF;
END $$;
-- @whizbang:bootstrap-end
```

**A migration that redefines a closure function carries the new definition into a region of its own.** The closure
is applied again whenever its hash changes, before the main pass. When the latest definition of a function lives
outside a region, the closure puts the older body back on every database it reaches, while the ledger skips the file
that held the newer one. Migration 198 marked its redefinition of 184's `wh_end_lapsed_bridge` for this reason. The
same holds in the other direction: a function the closure creates early is copied from its latest migration word for
word, as 277 copies 231's `wh_record_startup_stage`, so the closure makes it exist earlier and never makes it do
something else.

## Enforcement

- `MigrationSchemaQualificationTests` fails the build if a new migration calls `current_schema()` in code,
  compares `'__SCHEMA__'` as text, or looks up `information_schema` or `pg_indexes` without naming the schema, and
  if the latest definition of any function asks the caller's schema.
- `NamedSchemaMigrationReplayTests` applies every migration into a named schema with the default `search_path`,
  runs each migration again over the result (including the upgrade that re-runs a changed 046), and checks that
  the run-time functions work on the named schema's own tables.
- `MigrationSearchPathTests` and `MigrationSearchPathGenerationTests` check that the runner sets the migrated
  schema as `current_schema()` for each migration and restores the previous setting afterwards.
- `PreflightInstanceColumnsTests` fails if a column a migration adds to an instance or role table is not also added
  by the bootstrap closure (the list is derived from the shipped SQL), if the closure's stage recorder is not
  231's definition, or if any function the closure defines differs from its latest migration definition.
  {verified: PreflightInstanceColumnsTests.EveryColumnAMigrationAddsToAnInstanceOrRoleTable_IsAddedByTheBootstrapClosureAsync, PreflightInstanceColumnsTests.TheBootstrapsStageRecorder_IsMigration231sDefinitionAsync, PreflightInstanceColumnsTests.EveryFunctionTheBootstrapDefines_IsDefinedAsItsLastWordAsync}
- `SchemaBootstrapPhaseTests` checks that every column the closure adds carries its description, and that an empty
  database records its stage at registration after the bootstrap alone.
  {verified: SchemaBootstrapPhaseTests.TheColumnsTheBootstrapAdds_AreDescribedAsync, SchemaBootstrapPhaseTests.AnEmptyDatabaseRecordsItsStageAtRegistrationAfterTheBootstrapAsync}
- `MigrationAgainstRunningWorkersTests` re-applies the closure and every file that alters these tables while a worker
  holds them, and fails if any of it waits for the worker.
  {verified: MigrationAgainstRunningWorkersTests.ARerun_WhileAWorkerHoldsTheInstanceAndRoleTables_CompletesWithoutWaitingForItAsync}
- `MigrationSchemaQualifierTests` covers each case of the qualification: literals, escape strings, doubled quotes,
  quoted identifiers, comments, dollar quotes and positional parameters.
