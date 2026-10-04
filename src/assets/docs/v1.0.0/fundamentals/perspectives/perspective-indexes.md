---
title: Perspective Indexes
pageType: concept
description: >-
  Which indexes a perspective table gets, how to opt in to matching on any field or on metadata
  (both off by default in 1.0), why an index is never dropped on upgrade, and how duplicate indexes
  are avoided and cleaned up.
version: 1.0.0
category: Perspectives
order: 34
tags: 'perspectives, indexing, postgres, jsonb, gin, schema, operations, performance'
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveQueriesAttribute.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveQueriesDiscovery.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveIndexSql.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Generators/Analyzers/CollectivePredicateIndexAnalyzer.cs
  - src/Whizbang.Data.Postgres/Migrations/174_EnsureIndex.sql
  - src/Whizbang.Data.Postgres/Migrations/178_IndexStatistics.sql
  - src/Whizbang.Data.Postgres/IndexStatistics.cs
  - src/Whizbang.Data.EFCore.Postgres/IndexStatisticsMaintenanceStep.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Generators/Analyzers/QueryExposureIndexAnalyzer.cs
  - src/Whizbang.Generators.Shared/Utilities/PostgresIdentifiers.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentRewriter.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDocumentIndexGenerationTests.cs
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveSchemaGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/CollectivePredicateIndexAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveIndexSqlTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/DocumentMatchIndexAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/EnsureIndexFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/DocumentIndexInitializationTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/QueryExposureDocumentMatchTests.cs
  - tests/Whizbang.Generators.Tests/PostgresIdentifiersTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonIndexStandDownTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/IndexStatisticsInitializationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/IndexStatisticsMaintenanceStepTests.cs
---

# Perspective Indexes

A perspective table is created by the schema pass at service startup, and so are its indexes. This
page covers the indexes every table gets, the two that depend on what your queries do, what happens
to an index when a release stops declaring it, and how the schema pass avoids building an index the
table already has under another name.

For indexes on individual fields, see [Physical Fields](physical-fields.md) (`[Indexed]`,
`[PhysicalField]`, `[PerspectiveIndex]`). For how an equality filter becomes a whole-document match,
see [JSONB Containment Queries](jsonb-containment.md).

## What every table gets

| Index | Over | Why |
|---|---|---|
| `idx_<table>_created_at` | `created_at` | Time-ordered reads |
| `idx_<table>_updated_at` | `updated_at` | The retention sweep's `updated_at < now() - interval` |
| `idx_<table>_scope_gin` | the `scope` document | Scope matching |
| `idx_<table>_scope_tenant` | `scope ->> 't'` | The tenant filter every tenant-scoped read and every collective apply adds |
| `idx_<table>_data_gin` | the `data` document | **Only when you declare that your queries match on any field** (below) |
| `idx_<table>_metadata_gin` | the `metadata` document | **Only when you declare that your queries match on metadata** (below) |

`<table>` is the table name without its `wh_per_` prefix. Every field index you declare comes on top.

## Say what your queries do: `[PerspectiveQueries]`

A perspective stores its model as a JSON document. An equality filter on a field that has no index of
its own, `Where(r => r.Data.Status == status)`, is compiled into a **whole-document match**: "rows whose
document contains `Status: status`". So is a set filter, `statuses.Contains(r.Data.Status)`, which is
also what a GraphQL `in` filter becomes. Only an index over the whole document answers that.

That index covers every field of every row. On a busy table it is usually the largest index there,
and every change to the document rewrites its entries. If none of your queries match that way, it
costs you on every write and gives nothing back.

So the model says which lookups its queries make, in terms of what they do rather than which index
gets built:

```csharp{title="Declaring what a perspective's queries do" description="MatchOnAnyField keeps or removes the whole-document index; MatchOnMetadata adds the metadata index." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "attributes"] tests=["PerspectiveDocumentIndexGenerationTests.MatchOnAnyFieldFalse_OmitsTheDocumentIndexAsync", "PerspectiveDocumentIndexGenerationTests.MatchOnMetadataTrue_BuildsTheMetadataIndexAsync"]}
// Every filter uses a declared field index, and the model says the whole-document index isn't wanted.
[PerspectiveQueries(MatchOnAnyField = false)]
public record OrderSummary {
  [Indexed]
  public string Status { get; init; } = "";

  [Indexed]
  public Guid CustomerId { get; init; }
}

// Filters on arbitrary fields, and one query filters on the event that last wrote the row.
[PerspectiveQueries(MatchOnAnyField = true, MatchOnMetadata = true)]
public record AuditTrail {
  public string Actor { get; init; } = "";
  public string Action { get; init; } = "";
}
```

| Property | `true` | `false` | Not written |
|---|---|---|---|
| `MatchOnAnyField` | whole-document index built | not built | **not built** (see [Upgrading to 1.0](#upgrading-to-1-0)) |
| `MatchOnMetadata` | metadata index built | not built | not built |

The attribute goes on the model, like `[PerspectiveStorage]` and `[PerspectiveIndex]`, and a model
inherits it from its base. The nearest declaration wins as a whole.

### Choosing

- **Your filters are on a handful of known fields.** Declare `[Indexed]` on each of them and
  `MatchOnAnyField = false`. A field index is much smaller than the whole-document one and answers
  ranges and ordering as well as equality. An equality or set (`in`) filter on an `[Indexed]` field
  uses that index, not the whole-document one.
- **Your filters can be on any field**, such as filtering a GraphQL or REST lens composes from the
  request. Declare `MatchOnAnyField = true`, or index every field a request can name.
- **You filter on metadata** (`r.Metadata.EventType == ...`). Declare `MatchOnMetadata = true`.
  Nothing in the framework matches on metadata. It reads a row's metadata by key, one row at a
  time, so leave this off unless your own queries need it.

### What the build tells you

- [WHIZ308](../../operations/diagnostics/whiz308.md) (Warning) fires on each filter that compiles to a
  whole-document match on a model that declares nothing, so the index isn't built. It names the
  opt-in. That is the list to check after upgrading.
- [WHIZ307](../../operations/diagnostics/whiz307.md) (Warning) fires on a filter that compiles to a
  whole-document match the declaration leaves without an index: `MatchOnAnyField = false` with an
  equality or set filter on an unindexed field, or any metadata match without
  `MatchOnMetadata = true`.
- Both also fire on a lens or resolver that lets the **request** compose filters (for example
  `[UseFiltering]`, or a lens marked `[ComposesQueryFromRequest]`) over a model with fields that still
  have no index, because no source shows those filters.
- [WHIZ309](../../operations/diagnostics/whiz309.md) (Warning) fires on a collective predicate that
  filters a field with no index of its own. The whole-document index doesn't answer collective
  predicates at all, so the fix there is always `[Indexed]`.

The analyzer sees only the queries in the projects it builds. A model other services query needs
those services checked too, and the index's scan count in production (below).

### Every driver follows the same declaration

| Driver | Whole-document index | Metadata index |
|---|---|---|
| EF Core, schema pass | `idx_<table>_data_gin`, only for `MatchOnAnyField = true` | `idx_<table>_metadata_gin`, only for `MatchOnMetadata = true` |
| EF Core, polymorphic model | `HasIndex(e => e.Data).HasMethod("gin")` in the model, only for `MatchOnAnyField = true` | not declared in the model |
| Dapper schema generator | none (Dapper doesn't compile equality to a whole-document match) | `ix_<table>_metadata_gin`, only for `MatchOnMetadata = true` |

{verified: PerspectiveDocumentIndexGenerationTests.Undeclared_BuildsNoDocumentIndexInEitherScriptAsync, EFCorePerspectiveConfigurationGeneratorCoverageTests.Generator_PolymorphicModelWithoutTheOptIn_DeclaresNoDocumentIndexAsync, PerspectiveSchemaGeneratorTests.Generator_WithoutTheMetadataOptIn_BuildsNoMetadataIndexAsync}

## Upgrading to 1.0: the whole-document index is opt-in {#upgrading-to-1-0}

Releases before 1.0 built `idx_<table>_data_gin` for every model that didn't declare
`MatchOnAnyField = false`. From 1.0, a model that declares nothing doesn't get it:

- **A new database** doesn't get the index for an undeclared model. Equality and set filters on its
  unindexed fields read every row there.
- **An existing database keeps the index.** Nothing drops it, so queries that use it keep using it.
  The schema pass simply stops creating it.

Before deploying 1.0 to a new environment:

1. **Build, and read WHIZ308.** Each warning is a filter that needed the index. For each model it
   names, declare `[PerspectiveQueries(MatchOnAnyField = true)]` to keep the index, or mark the
   filtered fields `[Indexed]`. The Dapper and EF Core drivers follow the same declaration.
2. **Read WHIZ309.** Each warning is a collective predicate whose field has no index. Declare
   `[Indexed]` on it (the code fix does this). An index an earlier release created at apply time
   isn't created on a new database either (see
   [below](#indexes-an-earlier-release-created-at-apply-time)).
3. **Check the services you don't build.** A model other services query can be filtered in code the
   analyzer never sees. Check the index's scan count where the model's queries run.

On an existing database, the index stays until you decide. If a model now declares
`MatchOnAnyField = false`, or declares nothing and you have confirmed that nothing reads the index,
drop it as an operator step (below). If you keep it on purpose, declare `MatchOnAnyField = true` so a
new environment gets it too.

## Upgrading: nothing is dropped for you

The schema pass only ever **creates** indexes. When a release stops declaring an index, such as the
metadata index or the whole-document index now that both are off by default, or the whole-document
index after you declare `MatchOnAnyField = false`, the index already in your database **stays**. New
databases don't get it. Existing ones keep it until an operator removes it.

That is deliberate. Keeping an unused index costs write time. Removing one a production query relies
on turns that query into a full table scan. Only the first is safe to do by default.

### Dropping an index that is no longer declared

Check that nothing reads it first. `idx_scan` counts every use since statistics were last reset, so
read it over a period that covers your real traffic, and on every server that answers reads:

```sql{title="How much each perspective index is used" description="Scan counts and sizes for the document indexes of every perspective table." category="Perspectives" difficulty="INTERMEDIATE" tags=["postgres", "indexing", "operations", "monitoring"]}
SELECT s.relname              AS table_name,
       s.indexrelname         AS index_name,
       s.idx_scan             AS scans,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
WHERE s.relname LIKE 'wh\_per\_%'
  AND (s.indexrelname LIKE '%\_data\_gin' OR s.indexrelname LIKE '%\_metadata\_gin')
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

A `data_gin` or `metadata_gin` index with no scans over a full traffic cycle, on a model that doesn't
declare the matching lookup, is one 1.0 no longer builds. Drop it without blocking writes.
`CONCURRENTLY` can't run inside a transaction, so run each statement on its own:

```sql{title="Dropping a document index a release no longer declares" description="Run per index, outside a transaction, after confirming it has no scans." category="Perspectives" difficulty="INTERMEDIATE" tags=["postgres", "indexing", "operations"]}
DROP INDEX CONCURRENTLY IF EXISTS "inventory".idx_order_summary_metadata_gin;
DROP INDEX CONCURRENTLY IF EXISTS "inventory".idx_order_summary_data_gin;
```

If you later change your mind, the next schema change for that perspective creates the index again
from its declaration.

## One index per definition

`CREATE INDEX IF NOT EXISTS` compares **names** only. An index an earlier path created under a
different name, with exactly the same definition, used to be joined by a twin with the schema's
name, and every write then maintained both. The case that prompted this was
`idx_<table>_scope_tenant` created beside `idx_wh_per_<table>_scope_t`, both
`btree ((scope ->> 't'))`, and similar pairs over declared fields (`idx_<table>_status_json` beside
`idx_wh_per_<table>_data_status`). The `idx_wh_per_…` names come from an apply-time index step an
earlier release briefly shipped and then removed. The indexes it created stayed behind.

The schema pass is now the only thing that creates perspective indexes, and it creates each one
through `wh_ensure_index`, which compares definitions first:

1. An index with the declared name already exists: nothing to do.
2. Otherwise the declared index is built on an empty temporary copy of the table and read back with
   `pg_get_indexdef`, which is PostgreSQL's canonical form. Spacing, casts and parentheses don't
   matter; uniqueness, the access method, operator classes and a partial predicate do.
3. If a valid index on the table has the same canonical definition, the declared one is **not
   created**. The function returns `equivalent:<name>` and raises a `WARNING` naming both, which
   appears in the PostgreSQL server log.
4. Otherwise the index is created.

It never drops or renames anything. A role that may not create temporary tables skips the comparison
and creates the index as before, so the comparison can never fail a schema pass.

The one index the schema pass does drop is a document index it built for a field that has since been
promoted to a physical column. It drops only an index under the name it gave it, and only when that
index is over the field's extraction, then builds the same kind of index on the column. See
[Promoting a field that is already indexed](./physical-fields#promoting-an-existing-field).

Trigram indexes (`IndexKinds.Substring` and `Search`) are the exception. They are created inside the
optional-extension block that lets a server without `pg_trgm` skip them, so they keep plain
`CREATE INDEX IF NOT EXISTS`.

### Indexes an earlier release created at apply time

Nothing creates a perspective index at runtime any more. The `idx_wh_per_<table>_scope_t` and
`idx_wh_per_<table>_data_<field>` indexes an earlier release created during collective applies stay
in databases that have them, and they keep working. **They are not created on a new database.** If a
query or a collective predicate depends on one of the `data_<field>` indexes, for example a
predicate `OverlayId == x`, declare `[Indexed]` on that field in the same release you deploy to a
new environment. [WHIZ309](../../operations/diagnostics/whiz309.md) points at each collective
predicate that needs one, and its code fix adds the attribute. On a database that already has the old
index, the declaration doesn't build a second one: `wh_ensure_index` finds the old index by its
definition and leaves it in place. The tenant index needs nothing, because every table declares
`idx_<table>_scope_tenant`.

### Long names

PostgreSQL truncates an identifier longer than 63 bytes instead of rejecting it. Two derived index
names that differed only past that point used to land on one name, and the second index was never
created. Examples were the case-sensitive and case-insensitive indexes of a long property, or the
`created_at` and `updated_at` indexes of a long table. A derived name that wouldn't fit now keeps
its first 54 characters and ends in `_` plus an 8-character digest of the full name. It is stable and
unique. Names that already fit are unchanged. For a name that changed, `wh_ensure_index` finds the
existing index under its truncated name and doesn't build it again. The one that had never been
created is created.

### Finding and cleaning up duplicates you already have

The comparison prevents new duplicates but leaves existing ones alone. This lists every group of two
or more indexes with the same definition on one table:

```sql{title="Duplicate indexes on perspective tables" description="Groups indexes by table and canonical definition, ignoring the index name." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "indexing", "operations", "duplicates"]}
SELECT t.relname AS table_name,
       array_agg(ic.relname ORDER BY ic.relname) AS same_definition,
       pg_size_pretty(sum(pg_relation_size(ic.oid))) AS combined_size
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_class t  ON t.oid  = i.indrelid
WHERE t.relname LIKE 'wh\_per\_%'
  AND i.indisvalid
GROUP BY t.relname,
         i.indisunique,
         substr(pg_get_indexdef(i.indexrelid), strpos(pg_get_indexdef(i.indexrelid), ' USING '))
HAVING count(*) > 1
ORDER BY t.relname;
```

For each group, keep the index with the schema's name (`idx_<table>_…`) and drop the other one:

```sql{title="Dropping the older duplicate" description="Keeps the schema-named index; run outside a transaction." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "indexing", "operations", "duplicates"]}
DROP INDEX CONCURRENTLY IF EXISTS "inventory".idx_wh_per_order_summary_scope_t;
```

If only the older name exists, because the schema pass found it and skipped its own, rename it
instead. A rename is instant and doesn't touch the index data:

```sql{title="Adopting an equivalent index under the schema's name" description="A metadata-only rename; the schema pass then finds the index by name on every later start." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "indexing", "operations", "duplicates"]}
ALTER INDEX "inventory".idx_wh_per_order_summary_scope_t RENAME TO idx_order_summary_scope_tenant;
```

Once renamed, later starts find the index by name without running the comparison at all.

## Statistics for a new index {#statistics-for-a-new-index}

{verified: IndexStatisticsInitializationTests.AnIndexThePassCreates_HasStatisticsAndIsChosenForASelectivePredicateAsync, IndexStatisticsInitializationTests.ASecondStart_AnalyzesNothingAsync, IndexStatisticsMaintenanceStepTests.AnExpressionIndexWithoutStatistics_IsAnalyzedAsync, IndexStatisticsMaintenanceStepTests.ASecondRunInTheSameWindow_AnalyzesNothingAsync, IndexStatisticsMaintenanceStepTests.ARun_AnalyzesNoMoreThanItsLimitAsync, CanonicalTemporalRewritePhaseTests.ARewrittenTableIsAnalyzedAsync}

PostgreSQL has no statistics for an index expression, such as `(data ->> 'LineageId')::uuid`, until
the table is analyzed. Autovacuum analyzes a table only after about a tenth of its rows change. Until
then the planner estimates a predicate on the expression with a fixed default. For `IS NOT NULL`, the
default says nearly every row matches. So a selective query over a new index can be planned as a scan
of the whole table and take seconds instead of milliseconds.

Three things keep a new index's statistics current:

- **The schema pass.** When the pass creates an index, it records the table. Once its transaction
  commits, it runs `ANALYZE` on each recorded table, once. An index that already exists, or that the
  pass skipped because an equivalent exists, records nothing. A later start that creates no index
  analyzes nothing.
- **The stored-format rewrite.** A table the rewrite changed is analyzed after the rewrite commits,
  because a mass update leaves the statistics describing the rows as they were.
- **The maintenance cycle.** The `index-statistics` maintenance step analyzes perspective tables that
  have rows but whose expression indexes still have no statistics. That covers an index built outside
  the schema pass, and a start that stopped before it could analyze. Each run analyzes at most five
  tables. Only one instance runs it per hour: the one that wins the hour's claim, the same claim that
  `PublishOnceAsync` uses.

`ANALYZE` reads a sample of the table and blocks neither reads nor writes. To check whether an index's
expression has statistics, look for the index's own name in `pg_stats`:

```sql{title="Does an index expression have statistics?" description="An expression index's statistics are listed under the index's name." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "indexing", "operations", "statistics"]}
SELECT tablename, attname, null_frac
FROM pg_stats
WHERE schemaname = 'inventory' AND tablename = 'idx_order_summary_lineage_id';
```

No rows means the planner has no statistics for the expression yet. Running `ANALYZE` on the table
fixes that at once.

## Related

- [Physical Fields](physical-fields.md): `[Indexed]`, `[PhysicalField]` and `[PerspectiveIndex]`
- [JSONB Containment Queries](jsonb-containment.md): what compiles to a whole-document match
- [WHIZ302](../../operations/diagnostics/whiz302.md): filters no index can answer
- [WHIZ307](../../operations/diagnostics/whiz307.md) and [WHIZ308](../../operations/diagnostics/whiz308.md): whole-document matches without an index
- [WHIZ309](../../operations/diagnostics/whiz309.md): collective predicates on unindexed fields
