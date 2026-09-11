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
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentSwitch.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/ProviderCapabilities.cs
  - src/Whizbang.Data.EFCore.Postgres/Configuration/PerspectiveQueryTranslationOptions.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldQueryInterceptor.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentSqlMatrixTests.cs
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
| `Contains`, `StartsWith`, `EndsWith`, `Length` | Extraction | Not expressible as containment |
| Ordering by a JSON member | Extraction | An ordering needs the value, not a membership test |
| A double, float, DateTime, DateTimeOffset or enum | Extraction | The two text forms are not guaranteed to agree |
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
- **Container-backed tests** on a table of two hundred thousand rows assert that the containment form
  plans as a bitmap index scan while the extraction form plans as a sequential scan, and that the
  containment filter returns exactly the rows the equality filter returns.

{verified: JsonbContainmentSqlMatrixTests.Matrix_CoversEveryAxisAsync, GinContainmentIntegrationTests.ContainmentFilter_ReturnsTheSameRowsAsEqualityAsync, GinContainmentIntegrationTests.ContainmentFilter_MatchesAGuidValueAsync}

## See Also

- [Physical Fields](physical-fields.md) - Promoting a property to a real indexed column
- [WHIZ302: Filtered Perspective Field Has No Index](../../operations/diagnostics/whiz302.md) - The build-time advisory
- [Lenses](../lenses/lenses.md) - The query surface this applies to

---

*Version 1.0.0 - Foundation Release*
