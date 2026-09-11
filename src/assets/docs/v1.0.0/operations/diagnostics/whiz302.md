---
title: 'WHIZ302: Filtered Perspective Field Has No Index'
pageType: troubleshooting
description: >-
  Warning diagnostic when a lens query filters, orders, or counts on a perspective
  field that lives only in the model's JSON and therefore cannot use an index.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 302
tags: 'diagnostics, perspectives, physical-fields, indexing, performance, analyzer'
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentRewriter.cs
  - src/Whizbang.Core/Perspectives/SuppressIndexAdvisoryAttribute.cs
  - src/Whizbang.Core/Perspectives/PhysicalFieldAttribute.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFilterIndexAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentSqlMatrixTests.cs
---

# WHIZ302: Filtered Perspective Field Has No Index

**Severity**: Warning
**Category**: Perspective Validation

## Description

A perspective stores its read model as a single JSON document. Only a property promoted to a real
column by `[PhysicalField]` can carry an index. A predicate over any other property is answered by
extracting that property from the JSON of every candidate row.

The result is correct. The cost is linear in table size, which makes it invisible in development,
where the table holds tens of rows, and dominant in production, where it holds millions. WHIZ302
moves that discovery to the moment the query is written, when promoting the field is a one-line
change rather than a migration under load.

:::updated
**Equality is handled for you, and this diagnostic no longer reports it.** A plain equality filter on a
JSON-only scalar compiles to a jsonb containment test that the GIN index on the data column answers,
so it is a lookup already and needs no physical column. The analyzer stays quiet for it, in either
operand order and including the ordinal `Equals` spellings, and for set membership over a top-level
member. See [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md).

What it still reports is what containment cannot express: ranges and inequalities, ordering, pattern
matching, comparisons against null, anything under a negation, and members typed as a date, a time, an
enumeration or binary floating point.
:::

## What is no longer reported

The eligible type set mirrors the rewrite's: string, Guid, bool, short, int, long and decimal, the
types whose serialized text and PostgreSQL's generated text agree. The duplication between analyzer
and driver is forced, because an analyzer is referenced as an analyzer rather than as a library and
neither side can see the other's list, so each pins its own and names the other. Drift shows up as an
advisory that fires on a filter already indexed, or stays silent on one that scans, never as a wrong
answer.

{verified: PerspectiveFilterIndexAnalyzerTests.EqualityContainmentCanServe_IsNotReportedAsync, PerspectiveFilterIndexAnalyzerTests.ShapesContainmentCannotServe_AreStillReportedAsync, JsonbContainmentTypeSetTests.EligibleTypes_AreExactlyTheOnesWhoseTextFormsAgreeAsync}

A compound predicate reports only the half containment cannot serve, so the warning points at the
field that actually needs a column rather than at the whole query.

{verified: PerspectiveFilterIndexAnalyzerTests.CompoundPredicate_ReportsOnlyTheUnservedHalfAsync}

## Diagnostic Message

```text{title="WHIZ302 message text" description="The text the analyzer emits, with the model and property substituted." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "perspectives", "indexing", "message"]}
This query filters '{Model}.{Property}', which is stored only in the model's JSON, so the database
reads every row of the perspective. Mark it [PhysicalField(Indexed = true)], or record the decision
with [SuppressIndexAdvisory("reason")].
```

## What the analyzer looks at

Detection keys on `PerspectiveRow<TModel>.Data` rather than on any particular query API, so the
scoped lens surface and the older direct one are both covered, in method syntax and in query
syntax, and so are the asynchronous operators that take the same predicates as their synchronous
twins.

| Shape | Reported | Why |
|-------|----------|-----|
| `Where`, `Any`, `All`, `Count`, `LongCount` | Yes | The predicate decides which rows the database reads |
| `First`, `FirstOrDefault`, `Single`, `SingleOrDefault`, `Last`, `LastOrDefault` | Yes | Same, with an early exit that a scan cannot take advantage of |
| `SkipWhile`, `TakeWhile`, `Min`, `Max`, `MinBy`, `MaxBy` | Yes | Same |
| `OrderBy`, `OrderByDescending`, `ThenBy`, `ThenByDescending` | Yes | An ordering wants an index for the same reason a filter does |
| The `…Async` form of any of the above | Yes | Entity Framework's asynchronous operators take the same predicates |
| Query syntax `where` and `orderby` | Yes | The same filter wearing different clothes |
| `Select` and other projections | No | Reads a field out of rows already chosen, so it costs nothing extra |
| `row.Id`, `row.Metadata`, `row.Scope` | No | The row's own columns are not model JSON |

{verified: PerspectiveFilterIndexAnalyzerTests.OrderBy_OnJsonOnlyField_ReportsAsync, PerspectiveFilterIndexAnalyzerTests.AsyncOperator_OnJsonOnlyField_ReportsAsync, PerspectiveFilterIndexAnalyzerTests.QuerySyntaxWhere_OnJsonOnlyField_ReportsAsync, PerspectiveFilterIndexAnalyzerTests.Projection_OfJsonOnlyField_NoDiagnosticAsync, PerspectiveFilterIndexAnalyzerTests.Filter_OnRowKey_NoDiagnosticAsync}

## What counts as already indexed

A property is taken as index-backed when the generators would give it one, mirroring
`PerspectiveSchemaGenerator`:

| Declaration | Index | Verified |
|-------------|-------|----------|
| `[StreamId]` | Becomes the row key, so the primary key serves it | {verified: PerspectiveFilterIndexAnalyzerTests.Filter_OnStreamIdField_NoDiagnosticAsync} |
| `[PhysicalField(Indexed = true)]` | Asks for one outright | {verified: PerspectiveFilterIndexAnalyzerTests.Filter_OnIndexedPhysicalField_NoDiagnosticAsync} |
| `[PhysicalField(Unique = true)]` | The unique constraint carries one | {verified: PerspectiveFilterIndexAnalyzerTests.Filter_OnUniquePhysicalField_NoDiagnosticAsync} |
| `[VectorField(n)]` | Indexed unless the declaration sets `Indexed = false` | {verified: PerspectiveFilterIndexAnalyzerTests.Filter_OnVectorField_NoDiagnosticAsync, PerspectiveFilterIndexAnalyzerTests.Filter_OnUnindexedVectorField_ReportsAsync} |

`[PhysicalField]` with neither flag still reports. The scan is narrower, over a typed column instead
of the JSON document, but it is still a scan.

## Example

### Reported

```csharp{title="A filter on a JSON-only property" description="EntityId and TenantId live only in the model's JSON, so the lookup reads every row of the perspective." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "indexing", "lens-query"] unverified="counter-example — the pattern WHIZ302 flags; detection verified by PerspectiveFilterIndexAnalyzerTests.Filter_OnTwoJsonOnlyFields_ReportsEachAsync"}
public record DocumentModel {
  [StreamId]
  public Guid DocumentId { get; init; }

  public Guid TenantId { get; init; }   // WHIZ302 when filtered
  public Guid EntityId { get; init; }   // WHIZ302 when filtered
}

public class DocumentRepository(ILensQuery<DocumentModel> lens) {
  public Task<PerspectiveRow<DocumentModel>?> FindAsync(Guid tenantId, Guid entityId) =>
    lens.DefaultScope.Query
        .FirstOrDefaultAsync(row => row.Data.TenantId == tenantId &&
                                    row.Data.EntityId == entityId);
}
```

### Fixed by promoting the fields

```csharp{title="Promote the filtered fields to indexed columns" description="PhysicalField moves the property out of the JSON document into a real column the database can index." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "indexing", "lens-query"] tests=["PerspectiveFilterIndexAnalyzerTests.Filter_OnIndexedPhysicalField_NoDiagnosticAsync"]}
public record DocumentModel {
  [StreamId]
  public Guid DocumentId { get; init; }

  [PhysicalField(Indexed = true)]
  public Guid TenantId { get; init; }

  [PhysicalField(Indexed = true)]
  public Guid EntityId { get; init; }
}
```

Promoting a field is not free. Every write maintains the column and its index, the table grows, and
vacuum has more to do. That is why there is no code fix that applies the attribute for you: the
author accepts the trade, the analyzer only names it.

## When an index is the wrong answer

WHIZ302 says a query cannot use an index. It does not say an index is always the fix. Several
shapes are better served by something else, and reaching for an index in these cases buys write
cost and returns nothing.

**The predicate is not selective.** If a filter matches a large fraction of the table, roughly more
than five to ten percent, the planner will choose a sequential scan regardless, because random
access per row stops beating sequential reads. An index on a boolean status column that is `true`
for most rows is pure overhead. A partial index over the rare value is the better tool when one
value is genuinely rare.

**The table is small.** Below a few hundred pages a sequential scan is a handful of buffer reads.
Perspectives that hold one row per tenant, a feature-flag table, a lookup of enumeration values:
these are scans forever and that is correct. This is the case
[`[SuppressIndexAdvisory]`](#opting-out) exists for.

**Many columns are filtered in varying combinations.** This is the case where one index per
combination would explode, and it is also the case people most often get wrong. PostgreSQL does not
need a composite index per combination, because it can combine several single-column indexes with a
**bitmap index scan**: it builds a bitmap of matching heap pages from each index and ANDs or ORs
them before touching the table. So `N` filtered columns want at most `N` single-column indexes, not
`2^N` composite ones. Composite indexes still win when one specific combination dominates, because
a single index scan beats building and intersecting two bitmaps, and because the leading column can
also serve an ordering.

**The columns are filtered together and are correlated.** This is the failure mode that looks like
a missing index and is not. The planner assumes columns are independent and multiplies their
selectivities, so a predicate on a tenant and an entity type that move together is estimated at a
tiny fraction of its real row count. The planner then picks a nested loop or an index it should not
have picked. The fix is **extended statistics**, which teach the planner about the correlation:

```sql{title="Extended statistics for correlated filter columns" description="Teaches the planner that these columns move together, correcting the row estimates that drive plan choice." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "statistics", "query-planning", "perspectives"]}
CREATE STATISTICS wh_per_document_tenant_entity (dependencies, ndistinct, mcv)
  ON tenant_id, entity_type FROM wh_per_document;

ANALYZE wh_per_document;
```

### The GIN index on `data`, and what changed

Every perspective table is created with a GIN index on its `data`, `metadata` and `scope` columns, and
for a long time nothing could use them. A GIN index with the default operator class answers
containment and existence, `@>` and friends, and nothing else; a property comparison compiled to a
`->>` text extraction, which falls outside that.

That is no longer the whole story. The lens now compiles an equality filter into the containment form,
so the index does answer it:

```text{title="Extraction versus containment on the same column" description="Only the containment form, with the bare column on the left, is matched to the index." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "jsonb", "gin", "query-planning"]}
WHERE data ->> 'EntityType' = 'x'                      -> Seq Scan             cost 19602
WHERE data @> jsonb_build_object('EntityType', 'x')    -> Bitmap Index Scan    cost 43
```

See [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md) for what is
rewritten and what is not.

**So WHIZ302 is about the shapes containment cannot serve.** A plain equality filter on a JSON-only
scalar is already indexed and needs no attention. What still forces a scan, and still wants a physical
column, is everything else: ranges and inequalities, ordering, pattern matching, dates and times and
enumerations, and any comparison under a negation.

Two things remain true regardless. The index cannot be reached by the left operand being anything but
the bare column, so a containment test over an extraction plans as a scan. And the function form is
not matched to the index either:

```text{title="Neither an extraction nor the function form reaches the index" description="PostgreSQL matches a GIN index on the operator, and only when the indexed expression is the left operand." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "jsonb", "gin", "query-planning"]}
WHERE (data -> 'EntityType') @> '"x"'                  -> Seq Scan   cost 19602
WHERE jsonb_contains(data, '{"EntityType":"x"}')       -> Seq Scan   cost 19390
```

### There is no way to pin a table in memory

PostgreSQL has no "keep this table in RAM" switch, and it is worth being precise about what the
nearby knobs actually do, because the intuition that a hot table should simply be cached is right
and the mechanism people reach for usually is not.

| Lever | What it actually does |
|-------|----------------------|
| `shared_buffers` | The server's own buffer pool. A hot table stays resident because of usage counts and clock-sweep eviction, not because anything pinned it. You size the pool; you do not pin a relation into it. |
| `effective_cache_size` | A planner hint only. It allocates nothing. It tells the planner how much of a relation it may assume is already cached, which makes index scans look cheaper and changes plan choice. |
| `pg_prewarm` | A contrib extension that loads a relation into the buffer pool or the OS cache on demand, and with `autoprewarm` restores buffer contents after a restart. A warm-up tool, not a pin: those buffers are still evictable. |
| `UNLOGGED` tables | Removes write-ahead logging for the table, which cuts write cost substantially. Defensible for a perspective, which is derived from the event stream and therefore rebuildable, at the price of being truncated on crash recovery. Not a cache. |
| `random_page_cost` | On solid-state storage the default of `4` badly overstates seek cost. Lowering it toward `1.1` to `2` is often what makes the planner willing to use an index at all. |

The reason this matters for WHIZ302 specifically: when a perspective table already fits in the
buffer pool, a full scan of it does no disk I/O at all, and yet the query can still be slow. The
cost that remains is CPU, spent parsing the JSON document of every row to reach one property.
Caching cannot remove that cost, and neither can a faster disk. Promoting the property to a column
does, because the value is then read directly instead of extracted.

## Opting out

When a scan is the right answer, say so where the model is defined:

```csharp{title="Record the decision with SuppressIndexAdvisory" description="The reason is required; the attribute goes on a property, a model, or an assembly." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "indexing", "suppression", "attributes"] tests=["PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnProperty_NoDiagnosticAsync", "PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnModel_NoDiagnosticAsync"]}
// One field.
public record TenantSettingsModel {
  [StreamId]
  public Guid TenantId { get; init; }

  [SuppressIndexAdvisory("one row per tenant; a scan of this table is cheaper than the index")]
  public string Region { get; init; } = string.Empty;
}

// The whole model.
[SuppressIndexAdvisory("bounded at a few hundred rows by the retention cap")]
public record FeatureFlagModel {
  public string Name { get; init; } = string.Empty;
}
```

An assembly-level form exists for the blunt case, and should carry a reason that says why the whole
assembly is exempt. {verified: PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnAssembly_NoDiagnosticAsync}

Three properties of the opt-out are worth stating plainly.

**The reason is required, and a blank one does not suppress.** An empty or whitespace-only reason is
treated as though the attribute were absent, and the advisory still fires. The attribute's whole
value is the stated rationale; a placeholder would turn it back into a pragma.
{verified: PerspectiveFilterIndexAnalyzerTests.Filter_WithBlankSuppressionReason_StillReportsAsync}

**It is scoped.** A suppression on one property says nothing about the next one.
{verified: PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnAnotherProperty_StillReportsAsync}

**It also stands down the runtime advisory.** The maintenance cycle raises the same finding once it
can see a table's real size and read counts, and it reads this attribute off the registered model.
A `#pragma warning disable WHIZ302` silences the compiler only, so a team that used one would keep
hearing about the same field from the maintenance cycle every interval, forever. One decision, both
channels, which is why the opt-out is an attribute on the model rather than a directive at a call
site.

### Fleet-wide policy

The attribute answers one field at a time. A team that wants to change the severity everywhere,
which is the sensible first move when upgrading an existing codebase with many such queries, should
use the standard knobs instead. Work the severity back up as fields are promoted.

```ini{title="Lower WHIZ302 to a suggestion while migrating" description="The standard Roslyn severity knob, for teams whose existing code has many unindexed filters." category="Configuration" difficulty="BEGINNER" tags=["editorconfig", "analyzer", "severity", "migration"]}
[*.cs]
dotnet_diagnostic.WHIZ302.severity = suggestion
```

```xml{title="Keep WHIZ302 a warning under TreatWarningsAsErrors" description="Exempts this one diagnostic from the warnings-as-errors policy without lowering its severity." category="Configuration" difficulty="BEGINNER" tags=["msbuild", "analyzer", "warnings-as-errors", "migration"]}
<PropertyGroup>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <WarningsNotAsErrors>WHIZ302</WarningsNotAsErrors>
</PropertyGroup>
```

## Analyzer Details

| Property | Value |
|----------|-------|
| **Diagnostic ID** | WHIZ302 |
| **Category** | Whizbang.PerspectiveValidation |
| **Default Severity** | Warning |
| **Enabled by Default** | Yes |
| **Analyzer** | `PerspectiveFilterIndexAnalyzer` |
| **ID Range** | WHIZ300-399 (perspective validation) |

The analyzer registers on `SimpleMemberAccessExpression` nodes and resolves the receiver as
`PerspectiveRow<TModel>.Data` before doing any further work, so the vast majority of member accesses
in a compilation are rejected on a single symbol lookup. A queryable that is not a perspective is
never examined.
{verified: PerspectiveFilterIndexAnalyzerTests.Filter_OnNonPerspectiveQueryable_NoDiagnosticAsync}

## Limitation

The analyzer reads attributes. A perspective whose columns are configured through the
`DbContext` rather than declared with `[PhysicalField]` will look unindexed to it, because the
fluent configuration is invisible to a compile-time symbol walk. Those models need the opt-out with
a reason that says so, and the runtime advisory, which reads the live schema, is the check that
covers them.

## See Also

- [Physical Fields](../../fundamentals/perspectives/physical-fields.md) - How a property becomes a real column
- [WHIZ300: Inconsistent Perspective Model Types](whiz300.md) - The other perspective-validation diagnostic
- [Lenses](../../fundamentals/lenses/lenses.md) - The query surface this analyzer watches

---

*Version 1.0.0 - Foundation Release*
