---
title: JSONB Containment Queries
pageType: concept
description: >-
  How a perspective equality filter is compiled into a jsonb containment test so the GIN index on
  the data column can answer it, what the rewrite deliberately leaves alone, and how to turn it off.
version: 1.0.0
category: Perspectives
order: 33
tags: 'perspectives, jsonb, gin, indexing, query-translation, performance, configuration'
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainment.cs
  - src/Whizbang.Data.Postgres/Migrations/152_JsonbContainmentSet.sql
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentSwitch.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/ProviderCapabilities.cs
  - src/Whizbang.Data.EFCore.Postgres/Configuration/PerspectiveQueryTranslationOptions.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldQueryInterceptor.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentSqlMatrixTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentAuthoringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentJoinTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentNamingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentTypeSetTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/JsonbContainmentSetFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentSwitchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/GinContainmentIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/ProviderCapabilitiesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PerspectiveSqlShapeTests.cs
---

# JSONB Containment Queries

A perspective stores its read model as a JSON document in the `data` column, and every perspective
table is created with a GIN index on that column. Until now nothing could use it.

The reason is narrow. A GIN index with the default operator class answers containment and existence,
`@>` and friends, and nothing else. A property comparison written in LINQ used to compile to a text
extraction, which is outside what the index can serve, so the database read every row:

```sql{title="What a property comparison used to compile to" description="A text extraction with a cast, which no GIN index can answer." category="Perspectives" difficulty="INTERMEDIATE" tags=["jsonb", "query-translation", "indexing"]}
WHERE CAST(data ->> 'TenantId' AS uuid) = @p    -- Seq Scan
```

The lens now compiles the same filter into the one shape the index matches:

```sql{title="What it compiles to now" description="Containment with the bare column on the left, which the GIN index answers as a bitmap index scan." category="Perspectives" difficulty="INTERMEDIATE" tags=["jsonb", "gin", "query-translation", "indexing"]}
WHERE data @> jsonb_build_object('TenantId', @p)  -- Bitmap Index Scan
```

Nothing about the query you write changes. There is no migration, no new column, no schema change
and nothing to do on the write path. The indexes were already there and already being maintained.
{verified: GinContainmentIntegrationTests.ContainmentUsesTheGinIndex_WhileExtractionScansAsync}

## What you write

Exactly what you wrote before.

```csharp{title="An ordinary repository lookup" description="No containment-specific API; the rewrite happens during query compilation." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "lens", "jsonb", "query"] tests=["JsonbContainmentSqlMatrixTests.CompiledSql_SendsTheFilterWhereExpectedAsync"]}
public class DocumentRepository(ILensQuery<DocumentModel> lens) {
  public Task<PerspectiveRow<DocumentModel>?> FindAsync(Guid tenantId, string title) =>
    lens.DefaultScope.Query
        .FirstOrDefaultAsync(row => row.Data.TenantId == tenantId &&
                                    row.Data.Title == title);
}
```

Both predicates compile to containment, and PostgreSQL answers them from a single bitmap index scan.

## What is rewritten, and what is not

Containment is not equality. Where the two would answer differently, the equality form is kept, so a
query's results never change. Only its plan does.

| Shape | Compiles to | Why |
|-------|-------------|-----|
| `row.Data.Field == value` on a string, Guid, bool, short, int, long or decimal | Containment | The serialized text and PostgreSQL's generated text agree |
| The same with the operands the other way round | Containment | Operand order is irrelevant |
| A nested member, at any depth | Containment, nested | `jsonb_build_object` nests to match |
| A nullable member compared with a value | Containment | A non-null comparison cannot lose anything |
| A member compared with `null` | Extraction | An extraction reads a missing key as NULL; containment does not match an absent key |
| Anything under `!` | Extraction | In a filter both forms exclude a missing key, but `NOT NULL` still excludes while `NOT false` includes |
| `!=`, `>`, `>=`, `<`, `<=` | Extraction | Containment cannot express an inequality |
| String `row.Data.Field.Contains("ab")`, `StartsWith`, `EndsWith`, `Length` | Extraction | A substring test is not a membership test |
| Ordering by a JSON member | Extraction | An ordering needs the value, not a membership test |
| A double, float, DateTime, DateTimeOffset or enum | Extraction | The two text forms are not guaranteed to agree |
| `Equals` in any spelling, ordinal | Containment | The same comparison as `==`, and see below |
| `values.Contains(row.Data.Field)` on a top-level member | Containment over a set | See set membership below |
| A predicate written after `Select(r => r.Data)` | Containment | The row is projected away but the document is the same |
| A filter on either side of a join | Containment | The join key itself is never rewritten |
| A comparison in a `Select` or an `OrderBy` | Extraction | Not a filter; see below |
| `Equals` with a case-insensitive or culture-aware comparison | Extraction | Containment is ordinal and must not claim otherwise |
| A promoted `[PhysicalField]` property | Its own column | The physical-field pass claims it first |

{verified: JsonbContainmentSqlMatrixTests.CompiledSql_SendsTheFilterWhereExpectedAsync, GinContainmentIntegrationTests.MissingKey_IsWhereContainmentAndExtractionDisagreeAsync}

The negation rule is the subtle one and it is worth stating plainly. For a row written before a
property existed, the key is absent. An extraction of an absent key is SQL NULL, so the comparison
is NULL and a filter excludes the row. Containment of that same absent key is false, and a filter
excludes the row too, which is why the rewrite is safe in a positive position. Under `NOT` they
diverge: `NOT NULL` is NULL and still excludes, while `NOT false` is true and includes. So a negated
comparison keeps the extraction form.

An unexpected expression tree falls back to the comparison the query originally expressed. The worst
case is a lost index, never a wrong answer.


## Only in a filter

The rewrite applies to the lambda of an operator that decides which rows survive: `Where`, `Any`,
`All`, `Count`, `LongCount`, `TakeWhile`, `SkipWhile`, and the `First`, `Single` and `Last` families,
including their asynchronous forms.

It deliberately does not apply inside a projection or an ordering key. Inside a filter the two forms
agree, because an absent key reads as null from an extraction and as false from a containment test and
either way the row is excluded. A projection returns the comparison's own value, so the caller sees
the difference; an ordering can see it too, since nulls sort apart from false.

{verified: JsonbContainmentAuthoringTests.ProjectedComparison_IsNotRewrittenAsync, JsonbContainmentAuthoringTests.TerminalOperators_CarryTheRewriteAsync}

## The projected dialect

Most repositories are not written against the row. They project first and filter the model:

```csharp{title="Projecting the row away before filtering" description="The predicate reads a member of the model with no Data in its chain, and still reaches the index." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "lens", "jsonb", "query"] tests=["JsonbContainmentAuthoringTests.ProjectedModelPredicates_ReachTheIndexAsync"]}
return await lens.Query
  .Select(r => r.Data)
  .Where(job => job.JobCode == jobCode)
  .ToListAsync(ct);
```

There is no `Data` left in the member chain, but the query still runs against the same table and the
member still compiles to a path into the same document, so it is rewritten too. It is recognized by
asking the model whether a perspective is stored for that model type, which is a much tighter test
than judging by the type's shape, and an anonymous projection is correctly not treated as a document.

{verified: JsonbContainmentAuthoringTests.ProjectedModelPredicates_ReachTheIndexAsync, JsonbContainmentAuthoringTests.ProjectedAnonymousShape_IsNotTreatedAsAPerspectiveAsync}

## Equals, and why it is more than a convenience

Every spelling of `Equals` is the comparison `==` is, so all of them are rewritten: the instance
form, static `string.Equals`, static `object.Equals`, with the member on either side.

The overload taking a `StringComparison` is worth a paragraph of its own, because it is the one place
this framework does something Entity Framework cannot.

Entity Framework refuses to translate `string.Equals(value, StringComparison)` at all, and the refusal
is principled rather than cautious: it would have to compile to `=` on text, whose meaning follows the
collation in force. Under a case-insensitive collation that comparison is case-insensitive, which is
not what the caller asked for, and there is no correct translation available.

Containment compares values inside the document rather than as collated text, so it is exact whatever
the collation says. That is ordinal, which is exactly what the overload requested.

```text{title="The same value, the same candidate, differing only in case" description="An extraction follows the collation; containment does not." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "jsonb", "collation", "ordinal"]}
-- with a non-deterministic, case-insensitive collation in play
WHERE (data ->> 't') COLLATE case_insensitive = 'abc'   -- matches {"t":"ABC"}
WHERE data @> '{"t":"abc"}'                             -- does not
```

{verified: GinContainmentIntegrationTests.ContainmentIsOrdinal_WhereAnExtractionFollowsTheCollationAsync}

Only `Ordinal` is rewritten. A case-insensitive or culture-aware comparison asks for something
containment does not do, so it keeps the extraction form.

:::new{type="breaking"}
**This one spelling depends on the rewrite.** Because Entity Framework cannot translate it at all,
turning the rewrite off does not make such a query slower, it makes it throw. If you disable
containment, rewrite those call sites to `==` first. Every other spelling degrades to an extraction
and keeps working.
:::

## Set membership

"This field is any of these values" reaches the index too:

```csharp{title="Filtering by a set of values" description="Compiles to a containment test against one document per candidate, answered by a single bitmap index scan." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "lens", "jsonb", "set-membership"] tests=["JsonbContainmentAuthoringTests.SetMembership_ReachesTheIndexAsync"]}
return await lens.Query
  .Where(r => tenantIds.Contains(r.Data.TenantId))
  .ToListAsync(ct);
```

```sql{title="What it compiles to" description="One containment document per candidate value, built in SQL from a single array parameter." category="Perspectives" difficulty="ADVANCED" tags=["postgres", "jsonb", "gin", "set-membership"]}
WHERE data @> ANY (jsonb_containment_set('TenantId', @p))
```

Containment compares a document with a document, so the right-hand side has to be one document per
candidate while the candidates arrive as a single array parameter. `jsonb_containment_set`, added by
migration 152, turns one into the other. It is declared `IMMUTABLE` and written in SQL so the planner
inlines it, which is what keeps the index in play: an opaque call would be correct and would plan as a
sequential scan.

{verified: GinContainmentIntegrationTests.SetMembership_ReachesTheIndexThroughAnImmutableHelperAsync, GinContainmentIntegrationTests.SetMembership_ThroughTheLens_ReturnsTheRightRowsAsync, JsonbContainmentSetFunctionTests.IsImmutableSoThePlannerCanInlineItAsync}

Three limits, each for a concrete reason:

| Limit | Why |
|-------|-----|
| Arrays and lists only | The candidates arrive already parameterized, so the collection cannot be converted; these are the shapes Npgsql maps to a PostgreSQL array. A set keeps the `IN` form. |
| Top-level members only | The helper builds single-key documents; a nested path needs one nested document per candidate, which needs the subquery the helper exists to avoid. |
| Not under a negation | The same three-valued reason equality has. |

{verified: JsonbContainmentAuthoringTests.SetMembership_LeavesTheUnsafeShapesAloneAsync}

An empty candidate set matches no rows, which is what asking for "any of nothing" should mean. That
falls out of the SQL rather than needing a special case: aggregating zero values yields null, and
containment against null excludes the row.

{verified: JsonbContainmentSetFunctionTests.AnEmptySetMatchesNothingAsync}

## Joins

A join rewrites the lambda parameter into a transparent identifier, so a predicate afterwards reads
`pair.Left.Data.Field`. Filters on either side of inner, left, cross and grouped joins are rewritten,
in both method and query syntax. The join condition itself never is: it compares two rows, and
containment tests a document against a literal document.

{verified: JsonbContainmentJoinTests.InnerJoin_FilterOnBothSides_ReachesTheIndexTwiceAsync, JsonbContainmentJoinTests.JoinKeys_AreNeverRewrittenAsync, JsonbContainmentJoinTests.LeftJoin_FilterReachesTheIndexAsync}

## The key is the document's key

A containment test names its key literally, so a rewrite that used the C# property name where the
serializer wrote something else would compile, run, use the index, and match nothing.

It cannot, because the key comes from the provider's own path into the document, the same path the
extraction form reads. The two always name the same place, whatever the mapping decided it is called.

{verified: JsonbContainmentNamingTests.RenamedProperty_UsesTheStoredKeyAsync, JsonbContainmentNamingTests.NestedPath_ExtractionAndContainmentNameTheSamePlaceAsync}

## Turning it off

The rewrite is on by default, because the alternative is a sequential scan on every filtered
perspective. It still changes the SQL your queries produce, so it can be switched off without
waiting for a release.

```csharp{title="Disable the containment rewrite" description="Binds operator configuration and applies it at startup; correctness is unaffected, only the plan changes." framework="NET10" category="Configuration" difficulty="BEGINNER" tags=["configuration", "perspectives", "jsonb", "kill-switch"] tests=["JsonbContainmentSwitchTests.ApplyRuntimeConfiguration_TurnsItOffAsync", "JsonbContainmentSwitchTests.Off_CompilesToExtractionAsync"]}
var options = configuration
  .GetSection("Whizbang:PerspectiveQueryTranslation")
  .Get<PerspectiveQueryTranslationOptions>() ?? new PerspectiveQueryTranslationOptions();

JsonbContainmentSwitch.ApplyRuntimeConfiguration(options);
```

```json{title="The configuration section" description="Absent configuration binds to the default, which is on." category="Configuration" difficulty="BEGINNER" tags=["configuration", "appsettings", "perspectives"]}
{
  "Whizbang": {
    "PerspectiveQueryTranslation": {
      "UseJsonbContainment": false
    }
  }
}
```

| Setting | Default | Effect |
|---------|---------|--------|
| `UseJsonbContainment` | `true` | When false, every perspective filter compiles to the extraction form the framework used before |

{verified: JsonbContainmentSwitchTests.Default_IsOnAsync, JsonbContainmentSwitchTests.Options_DefaultToOnAsync, JsonbContainmentSwitchTests.On_CompilesToContainmentAsync}

Apply it at startup. Entity Framework caches a compiled query by its expression, so a query already
compiled keeps the form it was compiled with until its cache entry is evicted; flipping the switch
at startup makes the shape certain from the first query onward.

The rewrite also stands down on its own when a model has not registered the translations, so a
consumer that has not opted in is never surprised.
{verified: JsonbContainmentSqlMatrixTests.WithoutRegistration_TheRewriteStandsDownAsync}

## Provider versions

The rewrite reaches into the provider's expression tree and emits an operator through a type in the
Npgsql provider's internal namespace. That is the right trade today, because there is no public seam
for emitting an arbitrary operator and the alternative is a full scan. It is also the kind of thing
that breaks quietly on an upgrade.

So the versions it was verified against are recorded, the loaded versions are readable at run time,
and a test fails if they disagree.

```csharp{title="Ask what the loaded provider can do" description="Reports the loaded versions, the verified ranges, and whether the framework still has to do the rewrite itself." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "versions", "provider", "query-translation"] tests=["ProviderCapabilitiesTests.Describe_NamesBothLoadedVersionsAsync", "ProviderCapabilitiesTests.Combination_IsReportedAsVerifiedAsync"]}
logger.LogInformation("Perspective query translation: {Capabilities}",
  ProviderCapabilities.Describe());

// EF Core 10.0.2 (verified [10.0.0, 11.0.0)), Npgsql 10.0.0 (verified [10.0.0, 11.0.0)),
// containment rewrite required, combination verified
```

`ProviderCapabilities.NativeContainmentTranslationAvailable` is the pivot point. If a future provider
compiles a JSON member comparison into containment on its own, that becomes a version check,
`ContainmentRewriteRequired` turns false, and the framework's rewrite stands down with no change at
any call site.
{verified: ProviderCapabilitiesTests.RewriteIsStillRequired_BecauseNoProviderDoesItAsync, ProviderCapabilitiesTests.EfCoreVersion_IsInsideTheVerifiedRangeAsync}

## When you still want a physical column

Containment covers equality. It cannot serve anything else, so `[PhysicalField(Indexed = true)]`
remains the answer for:

- ranges and inequalities
- ordering
- pattern matching such as `Contains` or `StartsWith`
- dates, times and enumerations
- a covering column, where the value is read often enough to be worth not touching the document

See [Physical Fields](physical-fields.md).

## How it is verified

- **802 compiled-SQL cases** cross every scalar type with both operand orders, constants and captured
  parameters, nullable members with and without a value, every comparison operator, nested and
  twice-nested members, negation, composition, promoted columns, the row's own columns, query syntax,
  and the query shapes a repository wraps them in. Each asserts where the filter landed.
- **Authoring cases** cover the spellings a developer actually writes rather than the one the matrix
  writes: a predicate inline in a terminal operator, a value from a field, a method, a ternary or a
  coalesce, `Equals` in every form, set membership over an array or a list, and the shapes that must
  not be touched.
- **Container-backed tests** on a table of two hundred thousand rows assert that the containment form
  plans as a bitmap index scan while the extraction form plans as a sequential scan, and that each
  rewritten shape returns exactly the rows its unrewritten form returns. Asserting on generated SQL
  cannot tell a valid statement from an invalid one, which is why these execute.

{verified: JsonbContainmentSqlMatrixTests.Matrix_CoversEveryAxisAsync, GinContainmentIntegrationTests.ContainmentFilter_ReturnsTheSameRowsAsEqualityAsync, GinContainmentIntegrationTests.ContainmentFilter_MatchesAGuidValueAsync}

## See Also

- [Physical Fields](physical-fields.md) - Promoting a property to a real indexed column
- [WHIZ302: Filtered Perspective Field Has No Index](../../operations/diagnostics/whiz302.md) - The build-time advisory
- [Lenses](../lenses/lenses.md) - The query surface this applies to

---

*Version 1.0.0 - Foundation Release*
