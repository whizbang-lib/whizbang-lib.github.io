---
title: Managed Schema Objects
pageType: concept
version: 1.0.0
category: Perspectives
description: Whizbang keeps a ledger of every database object it creates for perspectives, creates what a model declares, drops what it created and no longer declares, and never touches what it did not create or what is pinned.
tags: [perspectives, schema, indexes, ledger, operations, dba]
codeReferences:
  - src/Whizbang.Data.Postgres/Schema/ManagedSchemaPlanner.cs
  - src/Whizbang.Data.Postgres/Schema/ManagedSchemaReconciler.cs
  - src/Whizbang.Data.Postgres/Schema/ManagedSchemaSettings.cs
  - src/Whizbang.Data.Postgres/Schema/ManagedSchemaLedger.cs
  - src/Whizbang.Data.Postgres/Migrations/200_ManagedObjects.sql
  - src/Whizbang.Core/Perspectives/KeepSchemaObjectAttribute.cs
  - src/Whizbang.Data.EFCore.Postgres/ManagedSchemaReconcileStep.cs
testReferences:
  - tests/Whizbang.Core.Tests/Schema/ManagedSchemaPlannerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/ManagedSchemaReconcilerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/DocumentIndexInitializationTests.cs
---

# Managed Schema Objects

A perspective's model declares database objects: indexes (`[Indexed]`, `[PerspectiveIndex]`, `[PerspectiveQueries]`), the whole-document and scope indexes, and length constraints. Whizbang creates those objects at startup. It also **removes** them once the model stops declaring them, so an index you no longer need doesn't keep costing every write in every environment.

To do that safely, Whizbang keeps a **ledger** of what it manages, in each schema's `wh_managed_objects` table, and reconciles it against the model at every start.

## What happens at startup

The reconcile runs at every start, after schema initialization commits, on a connection of its own and under the schema lock. A restart where the schema didn't change runs it too, so an object removed by a release, or dropped by hand, is noticed either way. It never fails a start: a reconcile that can't finish logs a warning, leaves everything in place, and tries again next time.

### The first time an object is seen

The first start that sees an object records it in the ledger and changes nothing. Each object is classified:

- **Declared by the model now:** owner `whizbang`, status `active`.
- **Named the way Whizbang names its objects, but no longer declared:** owner `whizbang`, status `pending-retirement`. Whizbang's names are `idx_<table>_…` and `ix_wh_per_<table>_…` for indexes and `ck_wh_per_<table>_…` for constraints, where `<table>` is the table name without `wh_per_`. This covers the whole-document index earlier releases built on every perspective.
- **Anything else:** owner `foreign`. Recorded so you can see it, and **never dropped**.

So the first deploy of a release with the ledger drops nothing, and neither does the first start after someone adds an index by hand.

### Every later start

| The model… | The database… | Whizbang… |
|---|---|---|
| declares an object | has it | records it as `active` |
| declares an object | lacks it (new, or dropped by hand) | creates it in the schema pass |
| no longer declares a `whizbang` object | has it, already recorded | drops it (`DROP INDEX CONCURRENTLY` for an index), unless something below keeps it |
| — | has a `foreign` object | leaves it alone |
| — | has a **pinned** object | leaves it alone, always |

A restart with unchanged code changes nothing.

### Rolling deploys

During a rolling update the previous release keeps running, and keeps querying its indexes, until the new one is ready. Each instance records what it declares, and an object is dropped only once **no running instance still declares it**. If a running instance has recorded nothing, because it predates the ledger, **nothing** is dropped until it's gone.

A drop held back this way isn't left for the next deploy. A maintenance step re-runs the reconcile on one instance of the fleet every 15 minutes, so the drop happens once the previous release has stopped.

## Object kinds

| Kind | Recorded | Dropped when no longer declared |
|---|---|---|
| Indexes: btree, GIN, GiST, BRIN, hash; unique, partial and expression indexes | Yes | Yes |
| Constraints: check, unique, exclusion, foreign key | Yes | Yes |
| Triggers | Yes | Yes |
| Extended statistics (`CREATE STATISTICS`) | Yes | Yes |
| Physical-field move sync triggers (`wh_mv_…`) | Yes | **No**: the move drops them when it settles |
| Primary keys | No | **No** |
| Promoted columns (`[PhysicalField]`) | No | **No**: they hold data; retire one with `[RetiredField]` |
| Perspective tables | No | **No**: they hold data |
| Row-level security policies, extensions | No | **No** |

## Pinning: keeping an object no matter what

A **pin** tells Whizbang to leave an object alone: a pinned object is never dropped, whatever the mode or the model says. Each object has **two independent pins**, both stored on its ledger row, and either one keeps it.

| | Code pin | Database pin |
|---|---|---|
| Controlled by | C#: the model and the service's configuration | The database: a DBA, SQL or the CLI |
| Set with | `[KeepSchemaObject]` on the model, or `Whizbang:Schema:Reconcile:Pins` | `wh_pin_object(…)`, `whizbang schema pin`, or a `whizbang:pin` comment |
| Ledger columns | `code_pinned`, `code_pin_source` (`code`, `config`), `code_pin_reason` | `db_pinned`, `db_pin_source` (`sql`, `cli`, `db-comment`), `db_pin_reason`, `db_pinned_by`, `db_pinned_at` |
| Released by | Removing the declaration: the next start clears it in the database | `wh_unpin_object(…)` or `whizbang schema unpin` only |
| At startup | Written again from C# | Never changed |

### Setting a code pin

```csharp{title="Pin an index from the model" description="Keep an index Whizbang would otherwise retire" category="Configuration" difficulty="BEGINNER" tags=["perspectives", "schema", "pin"] }
[KeepSchemaObject("idx_job_legacy_code", Reason = "The reporting job reads it")]
public record JobModel {
  // ...
}
```

You can also set code pins from configuration, as globs over `table:object`:

```bash{title="Pin from configuration" description="Code pins as globs over table:object" category="Configuration" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
Whizbang__Schema__Reconcile__Pins__0=wh_per_job:idx_*_legacy
```

### Setting a database pin

```sql{title="Pin in the database" description="Set a database pin with SQL or a comment" category="Operations" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
SELECT wh_pin_object('wh_per_job', 'idx_job_legacy_code', 'the reporting job reads it');
-- or, recorded at the next start:
COMMENT ON INDEX idx_job_legacy_code IS 'whizbang:pin the reporting job reads it';
```

```bash{title="Pin from the CLI" description="Set a database pin from the command line" category="Operations" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
whizbang schema pin wh_per_job idx_job_legacy_code --reason "the reporting job reads it"
```

A pin recorded from a comment stays in the ledger even if the comment is removed later. To release it, unpin it and remove the comment, or the next start pins it again from the comment.

### Unpinning

```sql{title="Unpin in the database" description="Release the database pin with SQL" category="Operations" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
SELECT wh_unpin_object('wh_per_job', 'idx_job_legacy_code');
```

```bash{title="Unpin from the CLI" description="Release the database pin from the command line" category="Operations" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
whizbang schema unpin wh_per_job idx_job_legacy_code
```

An unpin releases the **database pin** only. When C# also pins the object, the result says so (`unpinned; still pinned by code: JobModel [KeepSchemaObject]`); remove that declaration to release the code pin. An object with neither pin, that is no longer declared, is dropped at the **next** start, so an unpin can be undone before it takes effect.

## Settings

| Key | Values | Default |
|---|---|---|
| `Whizbang:Schema:Reconcile:Mode` | `Apply` records and drops; `AddOnly` records and never drops; `ReportOnly` records and logs what it would drop; `Off` does nothing | `Apply` |
| `Whizbang:Schema:Reconcile:Drop:<Kind>` | `false` keeps every object of one kind: `Index`, `Constraint`, `Trigger`, `Statistics` | `true` |
| `Whizbang:Schema:Reconcile:DropAfterFleetConverged` | `false` drops without waiting for running instances that still declare an object | `true` |
| `Whizbang:Schema:Reconcile:Pins:<n>` | code pins as globs over `table:object`, for example `wh_per_job:idx_*_legacy` | none |

A value that isn't one of these fails the start and names the key, so a mistyped setting can't quietly let a drop through.

```bash{title="Reconcile settings" description="Switch dropping off or keep one kind" category="Configuration" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
Whizbang__Schema__Reconcile__Mode=ReportOnly
Whizbang__Schema__Reconcile__Drop__Index=false
```

## Reading the startup report

Each start logs one line for every object it drops, keeps or finds missing:

```
Schema reconcile (public.wh_per_job): dropped Index idx_job_data_gin (no longer declared)
Schema reconcile (public.wh_per_job): kept Index idx_job_legacy_code (pinned by sql: the reporting job reads it)
Schema reconcile (public.wh_per_job): kept Index idx_job_status_old (still declared by a running instance)
```

From the CLI:

- `whizbang schema status` lists the ledger: every object, its kind, owner, status and pins.
- `whizbang schema plan` lists what the next start drops: Whizbang's objects pending retirement that neither pin holds. A running instance that still declares one can still keep it.

```bash{title="Ledger from the CLI" description="List the ledger and what the next start drops" category="Operations" difficulty="BEGINNER" tags=["Perspectives", "Schema", "Operations"]}
whizbang schema status -c "Host=...;Database=...;Username=..." -s public
whizbang schema plan -c "Host=...;Database=...;Username=..."
```

## DBA runbook

**Keep this index.** Pin it in the database: `SELECT wh_pin_object('<table>', '<index>', '<why>');`. Startup never changes that pin.

**Let Whizbang drop this.** Release the database pin with `wh_unpin_object`. If the result says C# still pins it, or the model still declares it, remove that declaration (or its `[KeepSchemaObject]`) and deploy. Check with `whizbang schema plan`.

**What will this deploy change?** Start one instance of the new release with `Whizbang__Schema__Reconcile__Mode=ReportOnly`. It records the ledger and logs what it would drop. Then `whizbang schema plan` lists what the next start drops.

**I added an index by hand.** It is `foreign` and Whizbang never drops it. Nothing to do.
