---
title: Perspective Indexes
pageType: concept
description: >-
  Which indexes a perspective table gets, how to say whether your queries match on any field or
  on metadata, why an index is never dropped on upgrade, and how duplicate indexes are avoided and
  cleaned up.
version: 1.0.0
category: Perspectives
order: 34
tags: 'perspectives, indexing, postgres, jsonb, gin, schema, operations, performance'
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveQueriesAttribute.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveQueriesDiscovery.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveIndexSql.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.Postgres/Migrations/173_EnsureIndex.sql
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDocumentIndexGenerationTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveIndexSqlTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/DocumentMatchIndexAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/EnsureIndexFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/DocumentIndexInitializationTests.cs
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
| `idx_<table>_data_gin` | the `data` document | **Only when your queries match on any field** (below) |
| `idx_<table>_metadata_gin` | the `metadata` document | **Only when your queries match on metadata** (below) |

`<table>` is the table name without its `wh_per_` prefix. Every field index you declare comes on top.

## Say what your queries do: `[PerspectiveQueries]`

A perspective stores its model as a JSON document. An equality filter on a field that has no index of
its own, `Where(r => r.Data.Status == status)`, is compiled into a **whole-document match**: "rows whose
document contains `Status: status`". Only an index over the whole document answers that.

That index covers every field of every row. On a busy table it is usually the largest index there,
and every change to the document rewrites its entries. If none of your queries match that way, it
costs you on every write and gives nothing back.

So the model says which lookups its queries make, in terms of what they do rather than which index
gets built:

```csharp{title="Declaring what a perspective's queries do" description="MatchOnAnyField keeps or removes the whole-document index; MatchOnMetadata adds the metadata index." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "attributes"] tests=["PerspectiveDocumentIndexGenerationTests.MatchOnAnyFieldFalse_OmitsTheDocumentIndexAsync", "PerspectiveDocumentIndexGenerationTests.MatchOnMetadataTrue_BuildsTheMetadataIndexAsync"]}
// Every filter uses a declared field index, so the whole-document index is not built.
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
| `MatchOnAnyField` | whole-document index built | not built | **built** (transitional default, see below) |
| `MatchOnMetadata` | metadata index built | not built | not built |

The attribute goes on the model, like `[PerspectiveStorage]` and `[PerspectiveIndex]`, and a model
inherits it from its base. The nearest declaration wins as a whole.

### Choosing

- **Your filters are on a handful of known fields.** Declare `[Indexed]` on each of them and
  `MatchOnAnyField = false`. A field index is much smaller than the whole-document one and answers
  ranges and ordering as well as equality. An equality filter on an `[Indexed]` field uses that
  index, not the whole-document one.
- **Your filters can be on any field**, such as a filter composed from a request. Declare
  `MatchOnAnyField = true`.
- **You filter on metadata** (`r.Metadata.EventType == ...`). Declare `MatchOnMetadata = true`.
  Nothing in the framework matches on metadata. It reads a row's metadata by key, one row at a
  time, so leave this off unless your own queries need it.

### The transitional default, and why it exists

Leaving `MatchOnAnyField` out still builds the whole-document index. Every perspective had it before
the attribute existed, and a query that depends on it can live in any assembly that references the
model, including ones this build never sees. A default that silently removed it would turn some
production lookups into full table scans on the next deployment.

The build tells you where you stand:

- [WHIZ308](../../operations/diagnostics/whiz308.md) (Info) marks each filter that relies on the
  index while the model declares nothing. That is the list to check before writing `false`.
- [WHIZ307](../../operations/diagnostics/whiz307.md) (Warning) fires on a filter that compiles to a
  whole-document match the declaration leaves without an index: `MatchOnAnyField = false` with a
  filter on an unindexed field, or any metadata match without `MatchOnMetadata = true`.

The analyzer sees only the queries in the projects it builds. Before you declare
`MatchOnAnyField = false` on a model other services query, check those services too, and check the
index's scan count in production (below).

## Upgrading: nothing is dropped for you

The schema pass only ever **creates** indexes. When a release stops declaring an index, such as the
metadata index now that it is off by default, or the whole-document index after you declare
`MatchOnAnyField = false`, the index already in your database **stays**. New databases don't get
it. Existing ones keep it until an operator removes it.

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

Then drop it without blocking writes. `CONCURRENTLY` can't run inside a transaction, so run each
statement on its own:

```sql{title="Dropping a document index a release no longer declares" description="Run per index, outside a transaction, after confirming it has no scans." category="Perspectives" difficulty="INTERMEDIATE" tags=["postgres", "indexing", "operations"]}
DROP INDEX CONCURRENTLY IF EXISTS "inventory".idx_order_summary_metadata_gin;
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

Trigram indexes (`IndexKinds.Substring` and `Search`) are the exception. They are created inside the
optional-extension block that lets a server without `pg_trgm` skip them, so they keep plain
`CREATE INDEX IF NOT EXISTS`.

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

## Related

- [Physical Fields](physical-fields.md): `[Indexed]`, `[PhysicalField]` and `[PerspectiveIndex]`
- [JSONB Containment Queries](jsonb-containment.md): what compiles to a whole-document match
- [WHIZ302](../../operations/diagnostics/whiz302.md): filters no index can answer
- [WHIZ307](../../operations/diagnostics/whiz307.md) and [WHIZ308](../../operations/diagnostics/whiz308.md)
