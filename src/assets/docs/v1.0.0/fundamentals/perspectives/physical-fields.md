---
title: Physical Fields
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/169_Fold.sql
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/SearchContainsRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/FoldedContainsTranslator.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/WhizbangSearchDbFunctions.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalColumnSql.cs
  - src/Whizbang.Generators.Shared/Models/ColumnStorageSql.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalJsonbContainmentRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbDocument.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/PerspectiveDocumentSerialization.cs
  - src/Whizbang.Core/Perspectives/ColumnStorage.cs
  - src/Whizbang.Core/Perspectives/ColumnCompression.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableStorageAttribute.cs
  - src/Whizbang.Data.Postgres/Migrations/179_PhysicalFieldPromotion.sql
  - src/Whizbang.Data.Postgres/PhysicalColumnFill.cs
  - src/Whizbang.Data.EFCore.Postgres/PhysicalColumnFillMaintenanceStep.cs
  - src/Whizbang.Core/Perspectives/PhysicalFieldAttribute.cs
  - src/Whizbang.Core/Perspectives/IndexedAttribute.cs
  - src/Whizbang.Generators.Shared/Models/JsonIndexInfo.cs
  - src/Whizbang.Generators.Shared/Models/JsonIndexDiscovery.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonIndexRegistry.cs
  - src/Whizbang.Generators/Analyzers/JsonIndexDeclarationAnalyzer.cs
  - src/Whizbang.Core/Perspectives/SuppressIndexAdvisoryAttribute.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Core/Perspectives/PerspectiveStorageAttribute.cs
  - src/Whizbang.Core/Perspectives/FieldStorageMode.cs
  - src/Whizbang.Core/Perspectives/PerspectivePhysicalFieldRegistry.cs
  - src/Whizbang.Core/Perspectives/PerspectivePhysicalValues.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldScalar.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldInfo.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldExpressionVisitor.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldQueryInterceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/SplitModeChangeTrackerHydrator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - >-
  - src/Whizbang.Data.Postgres/OptionalExtensionBlocks.cs
    src/Whizbang.Data.EFCore.Postgres/QueryTranslation/WhizbangDbContextOptionsBuilderExtensions.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalJsonbContainmentSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalJsonbContainmentRewriterTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalJsonbColumnBindingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalJsonbContainmentIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/GraphQLJsonbContainmentIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/JsonbColumnStorageIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/PhysicalJsonbColumnGenerationTests.cs
  - tests/Whizbang.Generators.Tests/ColumnStorageSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/DapperJsonbColumnTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/SearchQueryIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/SearchQueryShapeTests.cs
  - tests/Whizbang.Generators.Tests/SearchIndexGenerationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/FoldFunctionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PhysicalColumnBackfillIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/PhysicalColumnSqlTests.cs
  - tests/Whizbang.Generators.Tests/PhysicalPromotionIndexGenerationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PhysicalFieldPromotionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PhysicalColumnFillMaintenanceStepTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexStorageAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PerspectiveIndexSetupTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/OptionalExtensionBlocksTests.cs
  - tests/Whizbang.Generators.Tests/JsonIndexSqlScriptTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PhysicalFieldAttributeTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IndexedAttributeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonIndexUsageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonIndexStandDownTests.cs
  - tests/Whizbang.Generators.Tests/JsonIndexGenerationTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexDeclarationAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFilterIndexAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveStorageAttributeTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/FieldStorageModeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PhysicalFieldIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PhysicalFieldUpsertStrategyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalFieldRegistryTests.cs
  - tests/Whizbang.Generators.Tests/Models/PhysicalFieldInfoTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectivePhysicalColumnIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/EnumPhysicalFieldGenerationTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectivePhysicalValuesTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectivePhysicalColumnIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/PhysicalFieldHydratorInitOnlyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/InitOnlyPhysicalFieldHydrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/SplitHydratorHookedWriteTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/SplitClassSnapshotRewindTests.cs
lastMaintainedCommit: '01f07906'
---

# Physical Fields

Physical fields allow you to store specific properties as dedicated database columns alongside or instead of JSONB storage. This enables native database indexing, type constraints, and optimized query performance for frequently accessed or filtered data.

## Overview

A perspective stores its model in a single JSONB column by default. There are three tiers of storage
for a field, and the middle one is the newest and the cheapest thing most fields need.

| | Undeclared | `[Indexed]` | `[PhysicalField]` + `[Indexed]` |
|---|---|---|---|
| Where the value lives | the document | the document | its own column |
| Equality | indexed, through containment | indexed, by btree | indexed |
| Range, ordering, `IS NULL` | **scans** | **indexed** | indexed |
| Substring matching | scans | indexed with `Substring` | scans unless trigram-indexed |
| Unique constraints, foreign keys | no | no | yes |
| Costs | nothing | an index | an index, a column, a hydration path |
| Dates, times and durations | equality only | **indexed** | indexed |

:::updated
**One attribute asks for an index.** `[Indexed]` says what you mean, and it means the same thing
wherever the field lives: this field is filtered, make it fast. Which index serves that follows from
whether the field was promoted, and the framework already knows that.

On a field held in the document it builds a btree over the extraction a query produces. On a field
promoted by `[PhysicalField]` it indexes the column. On a `[VectorField]` it builds the vector index
that field configures. Combine it with either promotion when you need a real column **and** an index
on it.

That is why `[PhysicalField]` has no `Indexed` flag and `[VectorField]` has none either. A promoted
column is what you need for a constraint, a foreign key or uniqueness, and those stay where they
belong; asking for an index is a separate question with one answer.

**The date family is indexable now.** Not because the index rules changed but because the stored form
did: a date is stored as a number, which casts through an immutable expression where the old text
rendering did not. See [JSONB Containment Queries](jsonb-containment.md) for the stored forms.
:::

{verified: JsonIndexUsageTests.TheGeneratedIndexExpression_IsTheOneAQueryUsesAsync, JsonIndexStandDownTests.ABtreeIndexedField_IsNotCompiledToContainmentAsync, PerspectiveIndexSetupTests.ADeclaredIndexBuildsWithTheCastItAskedForAsync, PhysicalFieldAttributeTests.PromotionCarriesNoIndexFlagAsync}

The reason the middle tier exists is that the GIN index every perspective table already carries answers
containment and nothing else. That covers equality, which is why an equality filter on a JSON-only
field is already a lookup. It cannot cover a range or an ordering for any type, whatever the field is
stored as, because an inverted index returns a set and has no ordered answer space and no ordered
scan. Those need a btree, and a btree over the extraction is one without a schema change.

## Declaring an index on a JSON-only field {#json-indexed}

```csharp{title="The three tiers side by side" description="An undeclared field, one with an index over its stored value, and one promoted to a real column." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "jsonb", "physical-fields"] tests=["JsonIndexGenerationTests.ABtreeIndexIsCreatedOverTheExtractionAsync"]}
public record OrderModel {
  [StreamId]
  public Guid OrderId { get; init; }

  // A real column: needed here for the unique constraint.
  [PhysicalField(Unique = true)]
  public string OrderNumber { get; init; } = string.Empty;

  // Filtered by range and sorted on. An index over the stored value answers both.
  [Indexed]
  public int Rank { get; init; }

  // Filtered by range and searched by substring.
  [Indexed(IndexKinds.Ordered | IndexKinds.Substring)]
  public string Title { get; init; } = string.Empty;

  // Never filtered. Pays for nothing.
  public string Notes { get; init; } = string.Empty;
}
```

The kinds combine because a field can be queried both ways, and the attribute may also be written more
than once where that reads better than a combination. `Substring` requires `pg_trgm`. The schema pass
creates the extension once per table, inside a block it can skip as a whole: where the server refuses
the extension (a managed server that does not allow-list it, a role without the privilege, a build
without it), the pass logs one warning naming the extension and the trigram indexes it skipped, and
completes. Substring queries then scan, as they do wherever the index is absent, until an operator
provides the extension; a declaration is never the reason a service fails to start.

{verified: PerspectiveIndexSetupTests.ATrigramDeclarationBuildsAGinIndexAsync, PerspectiveIndexSetupTests.BothKindsBuildBothIndexesAsync}

### Comparisons that ignore case {#case-insensitive}

:::new
An index is only used for the expression it was built over, and a comparison that folds case is a
comparison over the *folded* value. An index over the stored value is not a candidate for it, however
it is built. So case-insensitive search needs its own declaration:

```csharp{title="A field searched with and without regard to case" description="Case folding changes the indexed expression, so a field compared both ways declares the attribute twice and carries one index for each." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "case-insensitive", "search"] tests=["JsonIndexGenerationTests.AFieldComparedBothWaysGetsAnIndexForEachAsync", "PerspectiveIndexSetupTests.ACaseInsensitiveDeclarationBuildsOverTheFoldedValueAsync"]}
public record CustomerModel {
  [StreamId]
  public Guid CustomerId { get; init; }

  // Searched by name, case-insensitively, and also sorted on as entered.
  [Indexed]
  [Indexed(caseInsensitive: true)]
  public string LastName { get; init; } = string.Empty;

  // Only ever compared case-insensitively, so only that index is worth paying for.
  [Indexed(caseInsensitive: true)]
  public string Email { get; init; } = string.Empty;
}
```

The two are different indexes and neither answers the other's query, which is why a field compared
both ways declares both. It is a separate declaration rather than a default for the same reason: the
folded index costs a write on every apply and can serve nothing that respects case.

**Write the comparison as `ToLower()`, with no argument.** That is the one form that reaches the
database, as its own `lower()`, and it is what the index is built over:

```csharp{title="The query shape the folded index answers" description="The parameterless ToLower is the only form the query translation maps; the invariant and culture overloads have no translation at all." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "case-insensitive", "linq"] tests=["JsonIndexUsageTests.AFoldedComparison_IsAnsweredByTheFoldedIndexOnlyAsync"]}
// Answered from the folded index.
var found = await rows
  .Where(r => r.Data.Email.ToLower() == term.ToLower())
  .ToListAsync(ct);

// No translation at all: these fail rather than running slowly.
//   r.Data.Email.ToLowerInvariant() == …
//   r.Data.Email.ToLower(CultureInfo.InvariantCulture) == …
//   string.Equals(r.Data.Email, term, StringComparison.OrdinalIgnoreCase)

// Translates, to the upward fold, which no declaration indexes. WHIZ302 reports it.
//   r.Data.Email.ToUpper() == …
```

The fold happens in the database under the column's collation, so there is no CLR culture in play and
none can be expressed. Analyzers that ask for a culture or a `StringComparison` here (CA1304, CA1311,
CA1862, RCS1155) are answering a question about in-process string handling, and the overloads they
recommend are exactly the ones with no translation. Suppress them on the query.

Asking for case folding on a field that is not text is reported by
[WHIZ305](../../operations/diagnostics/whiz305.md) rather than dropped in silence.
:::

{verified: JsonIndexUsageTests.AFoldedComparison_IsAnsweredByTheFoldedIndexOnlyAsync, JsonIndexGenerationTests.AFieldComparedBothWaysGetsAnIndexForEachAsync, PerspectiveIndexSetupTests.AFieldComparedBothWaysGetsBothIndexesAsync}

### Combining with a promotion

```csharp{title="A promoted column, and a vector, asking for their indexes" description="The same attribute asks on either side of the promotion; the promotion attribute describes the column." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "physical-fields", "vector"] tests=["JsonIndexGenerationTests.APromotedFieldIsIndexedByTheSameAttributeAsync"]}
public record DocumentModel {
  [StreamId]
  public Guid DocumentId { get; init; }

  // A real column, and indexed. Two attributes, two separate decisions.
  [PhysicalField]
  [Indexed]
  public Guid TenantId { get; init; }

  // A real column, not indexed: nothing filters it, so it pays for nothing.
  [PhysicalField]
  public string Title { get; init; } = string.Empty;

  // A vector column with an index, built the way [VectorField] configures it.
  [VectorField(1536, IndexType = VectorIndexType.HNSW)]
  [Indexed]
  public float[] Embedding { get; init; } = [];
}
```

A vector is **not** indexed unless it asks. That changed with the universal attribute, and it follows
the same opt-in principle as everything else here: an index is write amplification, so it is created
because someone asked. A filtered vector with no index is reported by
[WHIZ302](../../operations/diagnostics/whiz302.md) rather than left to be discovered in production.

{verified: JsonIndexGenerationTests.APromotedFieldWithoutTheAttributeIsNotIndexedAsync, PerspectiveIndexSetupTests.APromotedColumnTakesAnOrdinaryIndexAsync}

### Opting one field out of a blanket declaration

`[IndexAllFields]` covers every eligible field on the model. A single field declines with
`IndexKinds.None`, which is the only way to say "all of them but this one":

```csharp{title="Indexing every field except one" description="A per-field declaration overrides the model's, so asking for no kind is how a field declines an index it would otherwise be given." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "jsonb"] tests=["JsonIndexGenerationTests.AFieldCanOptOutOfABlanketDeclarationAsync"]}
[IndexAllFields]
public record ReportModel {
  [StreamId]
  public Guid ReportId { get; init; }

  public int Counted { get; init; }
  public string Label { get; init; } = string.Empty;

  // Never filtered, and large. Declining keeps the blanket useful on the rest.
  [Indexed(IndexKinds.None)]
  public string Payload { get; init; } = string.Empty;
}
```

Declining is not declaring, so it is not reported as a claim the framework cannot honor.

{verified: JsonIndexGenerationTests.AFieldCanOptOutOfABlanketDeclarationAsync, JsonIndexDeclarationAnalyzerTests.OptingOutIsNotReportedAsync, JsonIndexStorageAnalyzerTests.AModelDeclaringOnlyAnOptOutIsNotReportedAsync}

For a read model that really is queried every way, say it once on the model instead:

```csharp{title="Indexing every eligible field" description="A perspective-level declaration, for a read model queried every way." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "jsonb"] tests=["JsonIndexGenerationTests.IndexAllFieldsCoversTheEligibleFieldsOnlyAsync"]}
[IndexAllFields]
public record ReportRow {
  [StreamId]
  public Guid ReportId { get; init; }

  public int Count { get; init; }
  public string Label { get; init; } = string.Empty;
}
```

A per-property declaration still wins where a field wants different kinds, so an exception stays local
to the property it applies to. Be deliberate about this one: every index is write amplification on
each apply and disk that has to stay warm, so a model with many fields that are never filtered is
better served by naming the few that are. WHIZ302 names them for you, from what your queries actually
do.

### An equality filter on an indexed field stops using containment

This is worth knowing because it looks like a regression in the generated SQL and is the opposite.

```sql{title="What changes when a field is declared" description="An indexed field keeps the extraction form so its own index is the one used." category="Perspectives" difficulty="ADVANCED" tags=["jsonb", "indexing", "query-translation"]}
-- Undeclared: containment, answered from the GIN index over the whole document
WHERE data @> jsonb_build_object('Rank', 7)

-- [Indexed]: the extraction, answered from the field's own btree
WHERE (data ->> 'Rank')::integer = 7
```

If the equality were still rewritten, the planner would answer it from the document index and the
index you just paid for would sit unused, which is the exact problem this whole area exists to fix. It
is also the faster of the two: a single-column btree equality probe reads one index and goes to the
heap, while containment reads the document index and then rechecks every candidate row, because the
default operator class stores keys and values as separate tokens and cannot confirm on its own that a
pair belongs together.

A `Substring`-only declaration does **not** change equality, because a trigram index cannot answer one.

{verified: JsonIndexStandDownTests.ABtreeIndexedField_IsNotCompiledToContainmentAsync, JsonIndexStandDownTests.ATrigramOnlyField_StillReachesContainmentForEqualityAsync}

### Which types can carry one

An index has to be built from an immutable expression, so its keys cannot go stale. Every type the
framework stores as a scalar reaches one.

| Type | Index expression |
|------|------------------|
| `string` | `(data ->> 'X')` |
| `short`, `byte` | `((data ->> 'X')::smallint)` |
| `int`, an enum over one | `((data ->> 'X')::integer)` |
| `long`, an enum over an unsigned number | `((data ->> 'X')::bigint)` |
| `decimal` | `((data ->> 'X')::numeric)` |
| `float` | `((data ->> 'X')::real)` |
| `double` | `((data ->> 'X')::double precision)` |
| `bool` | `((data ->> 'X')::boolean)` |
| `Guid` | `((data ->> 'X')::uuid)` |
| `DateTime`, `DateTimeOffset` | `((data ->> 'X')::bigint)` over microseconds since the epoch |
| `DateOnly` | `((data ->> 'X')::integer)` over days since the epoch |
| `TimeOnly` | `((data ->> 'X')::bigint)` over microseconds since midnight |
| `TimeSpan` | `((data ->> 'X')::bigint)` over the tick count |

{verified: JsonIndexUsageTests.TheGeneratedIndexExpression_IsTheOneAQueryUsesAsync, ContainmentTypeEligibilityProbeTests.AnExtractionCanCarryABtreeIndexOnlyWhenItsCastIsImmutableAsync}

The date family is on that list because its **stored form** is a number, not because anything about
the index rules moved. Stored as a rendering it could not be indexed at all: the cast from text to a
timestamp is `STABLE`, and PostgreSQL refuses a stable index expression because a key computed from a
session setting could go stale. A number casts through `bigint`, which is immutable, so the same
extraction became indexable. You write an ordinary `DateTime` property and see none of this; the
stored document is what changed. See
[JSONB Containment Queries](jsonb-containment.md) for the stored forms and what they cost.

Declaring an index on a property with **no single scalar to extract** (a nested object, a collection,
a `char`) is reported at build time as **WHIZ303** rather than skipped, because a declaration on a
specific field is a claim about that field and silence would leave you believing it is indexed.

A declaration on a model whose document is stored as one serialized value is reported as
[**WHIZ304**](../../operations/diagnostics/whiz304.md), and the index is not created: a filter on a
field inside such a document never compiles to an extraction, so the index could never be reached.

Each cast mirrors what the query produces, which matters more than it looks: an index over a different
expression than the query generates is simply a different index, and the planner ignores it while every
query still returns correct rows. So the failure mode is a silent sequential scan, and that is why
these are asserted per type against a real query and a real plan rather than by reading the SQL.

A time-ordered identifier is worth a note. Its text form is fixed-width lowercase hexadecimal, so its
text order, its `uuid` byte order and its creation order all agree, which makes cursor paging over a
document-held identifier answerable from an index.

{verified: ContainmentTypeEligibilityProbeTests.ATimeOrderedIdentifier_SortsTheSameAsTextAndAsBytesAsync}

## PhysicalFieldInfo {#PhysicalFieldInfo}

`PhysicalFieldInfo` is the generator model that captures metadata about physical fields discovered during source generation. It includes property name, column name, type information, indexing options, and vector-specific settings.

```csharp{title="PhysicalFieldInfo" description="PhysicalFieldInfo is the generator model that captures metadata about physical fields discovered during source" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "PhysicalFieldInfo"] tests=["PhysicalFieldInfoTests.PhysicalFieldInfo_Constructor_SetsAllPropertiesAsync", "PhysicalFieldInfoTests.PhysicalFieldInfo_VectorField_SetsVectorPropertiesAsync"]}
public sealed record PhysicalFieldInfo(
    string PropertyName,      // Name of the property on the model
    string ColumnName,        // Database column name (snake_case)
    string TypeName,          // Fully qualified type name
    bool IsIndexed,           // Whether to create a database index
    bool IsUnique,            // Whether to apply UNIQUE constraint
    int? MaxLength,           // VARCHAR length for strings
    bool IsVector,            // Whether this is a vector field
    int? VectorDimensions,    // Dimension count for vectors
    GeneratorVectorDistanceMetric? VectorDistanceMetric,
    GeneratorVectorIndexType? VectorIndexType,
    int? VectorIndexLists     // IVFFlat list count
);
```

## PhysicalFieldRegistry {#PhysicalFieldRegistry}

`PhysicalFieldRegistry` is a runtime registry that maps model properties to their physical column names. Source generators populate this at startup, enabling the query translator to redirect `r.Data.PropertyName` queries to physical columns.

```csharp{title="PhysicalFieldRegistry" description="PhysicalFieldRegistry is a runtime registry that maps model properties to their physical column names." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PhysicalFieldRegistry"] tests=["PhysicalFieldRegistryTests.Register_WithValidParameters_AddsMapping"]}
// Register a physical field (done by generated code)
PhysicalFieldRegistry.Register<ProductModel>("Price", "price");

// Query uses unified syntax - automatically routes to physical column
var expensive = await lens.Query
    .Where(r => r.Data.Price >= 100.00m)  // Translated to: WHERE price >= 100
    .ToListAsync();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `Register<TModel>(propertyName, columnName)` | Registers a physical field mapping |
| `TryGetMapping(modelType, propertyName, out mapping)` | Gets the column mapping if registered |
| `IsPhysicalField(modelType, propertyName)` | Checks if a property is a physical field |
| `GetMappingsForModel(modelType)` | Gets all mappings for a model type |

## PhysicalFieldQueryInterceptor {#PhysicalFieldQueryInterceptor}

`PhysicalFieldQueryInterceptor` is an EF Core query interceptor that integrates physical field translation into the query pipeline. It transforms LINQ expressions that access `r.Data.PropertyName` to use the underlying physical column.

```csharp{title="PhysicalFieldQueryInterceptor" description="PhysicalFieldQueryInterceptor is an EF Core query interceptor that integrates physical field translation into the query" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PhysicalFieldQueryInterceptor"] unverified="EF Core query interceptor shown as a class outline, not an isolated API call; the interceptor is exercised only by PhysicalFieldIntegrationTests, which is map-absent"}
public class PhysicalFieldQueryInterceptor : IQueryExpressionInterceptor {
    public Expression QueryCompilationStarting(
        Expression queryExpression,
        QueryExpressionEventData eventData) {
        // Transforms r.Data.PropertyName to EF.Property(r, "column")
        return _visitor.Visit(queryExpression);
    }
}
```

## PhysicalFieldExpressionVisitor {#PhysicalFieldExpressionVisitor}

`PhysicalFieldExpressionVisitor` is the expression tree visitor that rewrites property access expressions for physical fields. It intercepts `r.Data.PropertyName` patterns and converts them to shadow property access.

**Before transformation:**
```csharp{title="PhysicalFieldExpressionVisitor" description="Before transformation:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PhysicalFieldExpressionVisitor"] unverified="illustrative pre-rewrite LINQ fragment, not an isolated API call; the visitor is covered only by PhysicalFieldIntegrationTests, which is map-absent"}
.Where(r => r.Data.Price >= 50.00m)
```

**After transformation:**
```csharp{title="PhysicalFieldExpressionVisitor (2)" description="After transformation:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PhysicalFieldExpressionVisitor"] unverified="illustrative post-rewrite LINQ fragment, not an isolated API call; the visitor is covered only by PhysicalFieldIntegrationTests, which is map-absent"}
.Where(r => EF.Property<decimal>(r, "price") >= 50.00m)
```

## UseWhizbangPhysicalFields {#UseWhizbangPhysicalFields}

The `UseWhizbangPhysicalFields()` extension method enables physical field query translation on your DbContext. Call it when configuring your DbContext options.

```csharp{title="UseWhizbangPhysicalFields" description="The UseWhizbangPhysicalFields() extension method enables physical field query translation on your DbContext." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "UseWhizbangPhysicalFields"] unverified="configuration — DbContext options wiring that registers the query interceptor; no unit test covers this call"}
var optionsBuilder = new DbContextOptionsBuilder<MyDbContext>();
optionsBuilder
    .UseNpgsql(connectionString)
    .UseWhizbangPhysicalFields();
```

This registers the `PhysicalFieldQueryInterceptor` which automatically translates queries on physical fields.

## PerspectiveStorageAttribute {#PerspectiveStorageAttribute}

The `[PerspectiveStorage]` attribute is applied to the **model class** (not the perspective class) to configure how physical fields are stored relative to JSONB. If omitted, the model defaults to `FieldStorageMode.JsonOnly` for backwards compatibility.

```csharp{title="PerspectiveStorageAttribute" description="Configures how physical fields are stored relative to JSONB" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PerspectiveStorageAttribute"] tests=["PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_Constructor_SetsModeAsync", "PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_AttributeUsage_AllowsClassAndStructAsync", "PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_AttributeUsage_DoesNotAllowMultiple_NotInheritedAsync", "PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_IsSealedAsync"]}
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct,
    AllowMultiple = false, Inherited = false)]
public sealed class PerspectiveStorageAttribute(FieldStorageMode mode) : Attribute {
    public FieldStorageMode Mode { get; }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `Mode` | `FieldStorageMode` | The storage mode for physical fields in this model |

## FieldStorageMode {#FieldStorageMode}

`FieldStorageMode` defines how physical fields are stored relative to JSONB in a perspective. Configure it using the `[PerspectiveStorage]` attribute on your model class.

| Mode | Description | Use Case |
|------|-------------|----------|
| `JsonOnly` | No physical columns; all data in JSONB only | Default, backwards compatible |
| `Extracted` | JSONB contains full model; physical columns are indexed copies | Fast queries with full JSONB flexibility |
| `Split` | Physical columns contain marked fields; JSONB contains remainder only | Storage efficiency, no duplication |

### JsonOnly (Default)

```csharp{title="JsonOnly (Default)" description="JsonOnly (Default)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "JsonOnly", "Default"] tests=["FieldStorageModeTests.FieldStorageMode_JsonOnly_IsDefaultAsync"]}
// No attribute needed - this is the default
public record ProductDto {
    public decimal Price { get; init; }      // Stored in JSONB only
    public string Description { get; init; } // Stored in JSONB only
}
```

### Extracted Mode

Physical columns are indexed copies; JSONB still contains the full model. Ideal when you need fast indexed queries but also want full model access via JSONB.

```csharp{title="Extracted Mode" description="Physical columns are indexed copies; JSONB still contains the full model." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Extracted", "Mode"] tests=["PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_Constructor_SetsModeAsync", "PhysicalFieldAttributeTests.PhysicalFieldAttribute_Properties_CanBeSetAsync"]}
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record ProductDto {
    [PhysicalField] [Indexed]
    public decimal Price { get; init; }      // In JSONB AND physical column

    public string Description { get; init; } // JSONB only
}
```

### Split Mode

Physical columns hold marked fields; JSONB holds only remaining fields. Avoids data duplication but requires reading both sources to reconstruct the model.

```csharp{title="Split Mode" description="Physical columns hold marked fields; JSONB holds only remaining fields." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Split", "Mode"] tests=["PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_Constructor_SetsModeAsync"]}
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
    [VectorField(1536)]
    public float[]? Embedding { get; init; }  // Physical column only

    public string Name { get; init; }          // JSONB only
}
```

### Reading promoted fields back {#reading-promoted-fields-back}

{verified: PerspectiveRunnerSplitInitOnlyTests.ASplitClassWithAnInitOnlyPromotedField_IsStrippedIntoACopyAsync, PerspectiveRunnerSplitInitOnlyTests.ASplitClassWithAnInitOnlyPromotedField_IsLoadedThroughACopyAsync, PerspectiveRunnerSplitInitOnlyTests.AnUncopyableSplitClass_IsWHIZ808Async, PhysicalFieldHydratorInitOnlyTests.SplitClass_WithAnInitOnlyPromotedField_IsHydratedThroughACopyAsync, InitOnlyPhysicalFieldHydrationTests.SplitClass_TheRunnerWritesAStrippedCopy_SnapshotsTheModelItApplied_AndAQueryCopiesTheColumnsBackAsync, PerspectiveRunnerSplitSnapshotTests.Runner_DecidesWhetherASnapshotIsDueBeforeTheWrite_AndSnapshotsOnThatDecisionAsync, SplitClassSnapshotRewindTests.ASplitClassModel_IsSnapshottedOnlyOnARunThatReachesTheCadence_WithItsPromotedFieldsAsync, PhysicalFieldHydratorInitOnlyTests.Record_ChangeTrackerHydrator_CopiesTheColumnsWithAWithExpressionAsync, PhysicalFieldHydratorInitOnlyTests.Class_Hydrators_AssignTheSettablePropertiesAndSkipTheRestAsync, InitOnlyPhysicalFieldHydrationTests.SplitRecord_AQueryOnAHookedContext_CopiesTheInitOnlyColumnsIntoTheModelAsync, InitOnlyPhysicalFieldHydrationTests.ExtractedClass_AQueryOnAHookedContext_CopiesTheSettableColumnAndKeepsTheInitOnlyOneFromTheDocumentAsync, SplitHydratorHookedWriteTests.Add_OnAHookedContext_SavesTheSplitRowAsync, SplitHydratorHookedWriteTests.Update_OnAHookedContext_SavesTheChangeAsync, SplitClassSnapshotRewindTests.Rewind_FromASnapshotOfASplitClassModel_KeepsThePromotedColumnsAsync}

When a lens query materializes a row, the generated EF Core code copies each promoted column into the
model, so a Split field arrives with its value even though the document does not hold it. The copy
works with the model shapes this page shows:

- **A record** is copied with a `with` expression, so `init`-only properties work as well as settable
  ones, in every storage mode.
- **A class** is assigned in place. A class cannot set an `init`-only property on an instance it already
  has, so the copy leaves that property as the document holds it. In `Extracted` mode the document holds
  it too, so nothing is lost.
- **A `Split` class with an `init`-only promoted field** is copied: a new instance from its
  parameterless constructor, with every public property that has a public or internal setter carried
  over and the columns put in. The runner strips such a class the same way, into a copy, before the
  write. A class that cannot be copied this way (no public or internal parameterless constructor, a
  get-only property that stores a value, a private setter, or an abstract class) is reported as
  [WHIZ808](../../operations/diagnostics/whiz808.md); make it a record, or make the promoted field
  settable.
- **A computed property** (no setter) is never copied into.

Only rows a query materializes are hydrated. An entity your code adds or attaches for an update on the
same `DbContext` is left tracked, and `SaveChanges` writes it as usual.

Snapshots hold the promoted fields as well. Before it writes a Split row, the runner clears the promoted
fields so the document leaves them out. For a record, and for a class with an `init`-only promoted field,
it clears them on a copy, and the snapshot after the write is the model it applied. Any other class is
cleared in place, so on a run whose snapshot is due the runner serializes the class's snapshot before the
write. Whether it is due is decided before the write, so a run that takes no snapshot serializes nothing
extra. A rewind from either snapshot keeps the columns' values.

## Defining Physical Fields

Use the `[PhysicalField]` attribute to mark properties for physical column storage:

```csharp{title="Defining Physical Fields" description="Use the [PhysicalField] attribute to mark properties for physical column storage:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Defining", "Physical"] tests=["PhysicalFieldAttributeTests.PhysicalFieldAttribute_Properties_CanBeSetAsync", "PerspectiveStorageAttributeTests.PerspectiveStorageAttribute_Constructor_SetsModeAsync"]}
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record ProductDto {
    [StreamId]
    public Guid ProductId { get; init; }

    [PhysicalField] [Indexed]
    public Guid CategoryId { get; init; }

    [PhysicalField(MaxLength = 100)] [Indexed]
    public string Sku { get; init; }

    [PhysicalField(Unique = true)]
    public string ExternalId { get; init; }

    // Non-physical property stays in JSONB only
    public string Description { get; init; }
}
```

### Attribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Unique` | `bool` | `false` | Apply UNIQUE constraint |
| `ColumnName` | `string?` | `null` | Custom column name (defaults to snake_case) |
| `MaxLength` | `int` | `-1` | Length limit for a string, as a check constraint (-1 = none) |
| `ColumnType` | `string?` | `null` | The column's PostgreSQL type, overriding the derived one |
| `Storage` | `ColumnStorage` | `Default` | `SET STORAGE` for the column; see [Keeping a filter column inline](#jsonb-storage) |
| `Compression` | `ColumnCompression` | `Default` | `SET COMPRESSION` for the column |
| `MaxBytes` | `int` | `-1` | Largest value the column accepts, by `pg_column_size` (-1 = none) |

An index is asked for with `[Indexed]`, never with an argument here.

A `DateTime` column is `timestamptz` in the table and in the Entity Framework model alike. The model
used to describe it as `timestamp`, which made Npgsql refuse a UTC value on the change-tracker write.
{verified: PhysicalJsonbColumnGenerationTests.EFCoreModel_DateTime_IsTheSameColumnTypeAsTheTableAsync, PhysicalJsonbContainmentIntegrationTests.ExtractedModel_RoundTripsThroughEitherWritePathAsync}

## Objects, lists and dictionaries: jsonb columns {#jsonb-columns}

A promoted property that holds an object, a record, a user struct, a list, an array or a dictionary
is a `jsonb` column. Nothing has to be declared:

```csharp{title="A second, small, indexed jsonb column for filtering" description="The read model keeps normalized filter values in a promoted jsonb column with a GIN index of its own." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "jsonb", "gin"] tests=["PhysicalJsonbColumnGenerationTests.SchemaGenerator_NonScalarField_IsAJsonbColumnAsync", "PhysicalJsonbContainmentIntegrationTests.ExtractedModel_RoundTripsThroughEitherWritePathAsync"]}
public sealed record Label(string Key, string Value);

[PerspectiveStorage(FieldStorageMode.Extracted)]
public class OrderGridModel {
  [StreamId]
  public Guid Id { get; set; }

  public string Title { get; set; } = "";

  // Normalized filter values: facet -> the values a row matches.
  [PhysicalField] [Indexed(IndexKinds.Containment)]
  public Dictionary<string, string[]> GridFilter { get; set; } = [];

  [PhysicalField] [Indexed(IndexKinds.Containment)]
  public List<Label> Labels { get; set; } = [];
}
```

Before this, such a field with no `ColumnType` became a `TEXT` column holding the type's name, with no
diagnostic, and a dictionary was refused outright by a model whose document is mapped as JSON
(WHIZ810). Now:

- **Both schema generators create the column as `jsonb`**, and the runner registers it as one. A
  declared `ColumnType` still wins, so `[PhysicalField(ColumnType = "text")]` keeps a text column.
  Scalars, enumerations, `Guid`, the date and time types, `TimeSpan`, `byte[]`, `float[]` and
  `double[]` keep the column types they had.
- **It is written and read under the persistence profile**, the options the document is written
  with. The Entity Framework model binds the shadow property with
  `PerspectiveDocumentSerialization.ColumnConverterFor<T>()`, the atomic upsert binds the value as jsonb
  text through that same converter, and Dapper serializes it with the store's options. A list of
  strings is no longer sent as a native `text[]` and a `Dictionary<string, string>` is no longer sent as
  an `hstore`.
- **It is kept out of the mapped document.** The generated configuration ignores the property inside
  `ComplexProperty(e => e.Data).ToJson()`, so a dictionary is allowed and WHIZ810 no longer fires for
  it. The column is where the value is read from: the hydrators copy it into the model, and the store
  reads it back from the column for the model the next event is applied to, on an Extracted model as
  well as a Split one, with either driver. On an Extracted model the document keeps its copy of the
  value on both write paths: the atomic upsert serializes it with the model, and a write that falls
  back to the change tracker restores it from the column in the same transaction, so both leave the
  same row. A null value is absent from the document, as the persistence profile omits a null member.
- **A column added to an existing Extracted table is backfilled** from the document's member,
  `data -> 'GridFilter'`, which holds the same JSON.

{verified: PhysicalJsonbContainmentIntegrationTests.BothWritePaths_LeaveIdenticalRowsAsync, PhysicalJsonbColumnGenerationTests.EFCoreModel_JsonbField_IsReadAndWrittenUnderThePersistenceProfileAsync, PhysicalJsonbColumnGenerationTests.EFCoreModel_JsonbField_IsLeftOutOfTheMappedDocumentAsync, PhysicalJsonbColumnGenerationTests.Runner_ExtractedModel_ReadsItsJsonbColumnsBackAsync, PhysicalJsonbContainmentIntegrationTests.SplitModel_RoundTripsThroughEitherWritePathAsync, DapperJsonbColumnTests.ExtractedModel_JsonbColumns_SurviveAnEventThatLeavesThemAloneAsync, DapperJsonbColumnTests.SplitModel_JsonbColumns_SurviveAnEventThatLeavesThemAloneAsync, PhysicalColumnSqlTests.Extraction_AJsonbColumn_IsCopiedFromTheMemberAsItIsAsync}

### Columns created as text before this {#jsonb-text-columns}

A table an earlier release created holds a `TEXT` column for such a field, and that column holds the
field's type name rather than its value, so there is nothing in it to convert. On the first start of
this release the schema pass, with no step of yours:

1. renames it to `<column>_text_legacy` (it is never dropped automatically),
2. adds the `jsonb` column under the original name, with its indexes,
3. on an Extracted model, fills it from the document's copy (`data -> 'GridFilter'`) and arms the
   [physical-column fill](#rows-written-during-a-rolling-deploy) for rows an older instance writes
   during the rollout.

On a Split model the document holds no copy, so the column starts empty and the pass logs a warning
naming it: rebuild the perspective to fill it. Every later start finds a `jsonb` column and does
nothing. Once you are satisfied, drop the legacy column yourself:

```sql{title="Dropping the retired text column" description="The schema pass never drops data; this is the operator's step once the jsonb column is filled." category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "jsonb", "migrations"]}
ALTER TABLE wh_per_order_grid DROP COLUMN grid_filter_text_legacy;
```

{verified: JsonbColumnStorageIntegrationTests.AnEarlierTextColumn_IsKeptAsLegacy_AndTheJsonbColumnFilledFromTheDocumentAsync, JsonbColumnStorageIntegrationTests.AnEarlierTextColumnOnASplitModel_IsKeptAsLegacy_AndLeftForARebuildAsync, PhysicalColumnSqlTests.ATextColumnForAJsonbField_IsRetiredBeforeTheColumnIsArmedAndAddedAsync}

This applies to the Entity Framework schema pass, which adds columns to existing tables. The Dapper
schema creates tables and does not alter existing ones.

A promoted array is fine on a perspective model when its column is `jsonb`: WHIZ200, which asks for
`List<T>` instead of an array, stays silent there because the column is read and written as one
value rather than grown in place by the change tracker.
{verified: PerspectiveModelArrayAnalyzerTests.Analyzer_ArrayPromotedToJsonb_IsSilent_OtherwiseFlaggedAsync}

### Filtering on a jsonb column {#jsonb-filters}

A filter on a jsonb column compiles to a containment test, `column @> document`, with the document
built in SQL from the query's own values. Containment is the one shape a GIN index on the column
answers.

```csharp{title="Filters that compile to containment" description="Each filter on the promoted jsonb columns becomes column @> document and is answered from the column's GIN index." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "jsonb", "gin", "query-translation"] tests=["PhysicalJsonbContainmentSqlTests.DictionaryKeyContains_Param_CompilesToContainmentOfAKeyedArrayAsync", "PhysicalJsonbContainmentIntegrationTests.SupportedShapes_ReturnTheRowsTheInMemoryFilterReturnsAsync", "PhysicalJsonbContainmentIntegrationTests.Explain_ContainmentFilters_UseTheColumnsGinIndexesAsync"]}
var rows = await lens.DefaultScope.Query
    .Where(r => r.Data.GridFilter["region"].Contains(region))
    .Where(r => r.Data.Labels.Any(l => l.Key == "team" && l.Value == team))
    .ToListAsync();
```

```sql{title="What it compiles to" description="Two containment tests, each answered by its column's GIN index." category="Perspectives" difficulty="INTERMEDIATE" tags=["jsonb", "gin", "query-translation"]}
WHERE w.grid_filter @> jsonb_build_object('region', jsonb_build_array(to_jsonb(@region)))
  AND w.labels @> jsonb_build_array(jsonb_build_object('Key', to_jsonb('team'::text))
                                     || jsonb_build_object('Value', to_jsonb(@team)))
```

These are the shapes that are compiled, exactly. `col` is the promoted property, written as
`r.Data.Property` on the row:

| LINQ, inside a filter | Column type | Compiles to |
|-----------------------|-------------|-------------|
| `col[key].Contains(v)` | dictionary of collections | `col @> {key: [v]}` |
| `col[key].Any(e => e == v)` | dictionary of collections | `col @> {key: [v]}` |
| `col[key] == v` | dictionary of scalars | `col @> {key: v}` |
| `col.Contains(v)`, `Enumerable.Contains(col, v)` | list or array of scalars | `col @> [v]` |
| `col.Any(e => e == v)` | list or array of scalars | `col @> [v]` |
| `col.Any(e => e.A == v && e.B.C == w)` | list or array of objects | `col @> [{A: v, B: {C: w}}]`, one element matching every condition |
| `col.A.B == v` | object | `col @> {A: {B: v}}` |
| `!` around any of the above | any | `NOT (col @> …)` |

- **Inside a filter** means the predicate of `Where`, `Any`, `All`, `Count`, `First`, `Single`,
  `Last` and their `OrDefault` and asynchronous forms. In a `Select` or an `OrderBy` the shape is left
  alone, and Entity Framework evaluates it on the client if it is the final projection.
- **Values** may be constants or captured variables of type `string`, `Guid`, `bool`, `byte`,
  `short`, `int`, `long` or `decimal`, nullable or not. Dates and times, enumerations, `double` and
  `float` are not compiled, because their stored text and `to_jsonb`'s are not guaranteed to agree. A
  key must be a `string`.
- **Member names are the stored names**, taken from the serializer's metadata, so a
  `[JsonPropertyName]` is honored. A dictionary key is used as written.
- **Equality is `==`.** `Equals(...)` in its various spellings is not compiled here.
- **Two conditions under one top-level member** inside `Any` (`e.A.X == v && e.A.Y == w`) are not
  compiled: the element is built by merging one object per condition, and the merge is shallow.
  Write them as two `Any` calls if separate elements may satisfy them, or keep the member flat.
- **A literal `null`** in an equality is not compiled. A captured variable that turns out null is
  compiled, and matches only a stored JSON `null`. The persistence profile omits null members, so on
  an object it matches nothing; inside a list (`col.Contains(null)`) it matches a stored null element,
  which is what the in-memory filter does.
- **A missing dictionary key** does not match, where `dictionary[key]` in memory would throw.
- **A row whose column is SQL NULL** matches neither a filter nor its negation.
- **Anything else** (ranges, `ContainsKey`, `Count()`, ordering, a value read from the row) is left
  exactly as written, which Entity Framework cannot translate over a jsonb column.

{verified: PhysicalJsonbContainmentSqlTests.DictionaryKeyEquals_ScalarValue_CompilesToContainmentOfTheKeyAsync, PhysicalJsonbContainmentSqlTests.ScalarListContains_CompilesToContainmentOfAnArrayAsync, PhysicalJsonbContainmentSqlTests.ObjectListAny_ConjunctionOfMembers_CompilesToOneElementAsync, PhysicalJsonbContainmentSqlTests.ObjectMemberEquals_Nested_CompilesToNestedContainmentAsync, PhysicalJsonbContainmentSqlTests.Negated_IsTheNegatedContainmentTestAsync, PhysicalJsonbContainmentRewriterTests.UnsupportedShapes_AreLeftAsWrittenAsync, PhysicalJsonbContainmentRewriterTests.TheShapeAGraphQLListFilterBuilds_IsClaimedAsync}

This compilation is not affected by the [containment switch](jsonb-containment.md#turning-it-off).
That switch chooses between two ways of compiling a filter on the document, which already has a working
translation; a filter on a jsonb column has no other translation to fall back to.
{verified: PhysicalJsonbContainmentSqlTests.OffSwitch_DoesNotStopIt_BecauseNothingElseTranslatesTheShapeAsync}

A GraphQL filter reaches the same compilation, because it is applied to the lens query as an
expression tree, and is answered from the same GIN index. A list filter such as `labels: { some: { key: { eq: "team" } } }` arrives as
`Labels.Any(l => l.Key == "team")` and compiles to containment. A dictionary has no GraphQL filter
type, so dictionary shapes are written in LINQ.
{verified: GraphQLJsonbContainmentIntegrationTests.AListFilterOnAJsonbColumn_RunsAsContainmentOnItsGinIndexAsync, GraphQLJsonbContainmentIntegrationTests.AScalarListFilter_RunsAsContainmentTooAsync}

### Indexing it

`[Indexed(IndexKinds.Containment)]` builds the index the compiled filter needs, on both drivers:

```sql{title="The containment index" description="GIN with jsonb_path_ops over the promoted jsonb column." category="Perspectives" difficulty="INTERMEDIATE" tags=["jsonb", "gin", "indexing"]}
CREATE INDEX IF NOT EXISTS idx_order_grid_grid_filter_gin
  ON wh_per_order_grid USING gin (grid_filter jsonb_path_ops);
```

`jsonb_path_ops` answers `@>` and nothing else, which is everything a compiled filter asks, and is
smaller and faster to maintain than the default operator class. The kind applies only to a promoted
jsonb column; elsewhere it builds nothing. The same index can be spelled out with
`[PerspectiveIndex(nameof(GridFilter), Method = PerspectiveIndexMethod.Gin, OperatorClass = "jsonb_path_ops")]`,
which the Entity Framework schema builds.
{verified: PhysicalJsonbContainmentIntegrationTests.ContainmentDeclaration_BuildsAGinJsonbPathOpsIndexAsync, PhysicalJsonbContainmentIntegrationTests.Explain_ContainmentFilters_UseTheColumnsGinIndexesAsync}

## Keeping a filter column inline {#jsonb-storage}

PostgreSQL keeps a row in its page until the row grows past about 2 KB (`toast_tuple_target`). Past
that it compresses the row's largest values and then moves them out of line into the table's TOAST
table. A small filter column stays cheap only while it stays in the row: once it is moved out, every
row a filter reads costs a second lookup, and a GIN index still says which rows match but the recheck
reads the value. A large document in the same row is what usually pushes the row over the threshold.

The schema pass can set three things, and each is applied only where the table differs, so a restart
issues no `ALTER TABLE` and takes no lock:

```csharp{title="Storage options for a filter column and its document" description="Keep the filter column in the row, compress the document with lz4, and declare a size budget." framework="NET10" category="Perspectives" difficulty="ADVANCED" tags=["perspectives", "physical-fields", "jsonb", "toast", "storage"] tests=["ColumnStorageSqlTests.ServiceRegistration_EmitsTheTableAndColumnOptionsAsync", "JsonbColumnStorageIntegrationTests.DeclaredOptions_AreAppliedToTheTableAsync"]}
[PerspectiveStorage(FieldStorageMode.Extracted)]
[PerspectiveTableStorage(DataCompression = ColumnCompression.Lz4, ToastTupleTarget = 512)]
public class OrderGridModel {
  [PhysicalField(Storage = ColumnStorage.Main, MaxBytes = 1024)]
  [Indexed(IndexKinds.Containment)]
  public Dictionary<string, string[]> GridFilter { get; set; } = [];
}
```

| Option | Applied as | What it does |
|--------|------------|--------------|
| `Storage = ColumnStorage.Main` | `ALTER COLUMN … SET STORAGE MAIN` | Keeps the column in the row, compressed if it must be, out of line only as a last resort |
| `Compression = ColumnCompression.Lz4` | `ALTER COLUMN … SET COMPRESSION lz4` | Compresses the column's values with LZ4 |
| `DataCompression = ColumnCompression.Lz4` | the same, on `data` | LZ4 for the document: faster to compress and to read than pglz, at a similar ratio |
| `ToastTupleTarget = n` | `ALTER TABLE … SET (toast_tuple_target = n)` | The row size, 128 to 8160 bytes, past which values are compressed and moved out |
| `MaxBytes = n` | `CHECK (pg_column_size(col) <= n) NOT VALID` | Refuses a value larger than the budget |

The trade-off, in short: `MAIN` on the filter column and LZ4 on the document keep the filter in the
row while the document is compressed and moved out first. A lower `ToastTupleTarget` moves a large
document out sooner, keeping the rows a scan walks small; a higher one keeps more rows entirely inline
at the cost of fewer rows per page. `MaxBytes` makes the budget visible: a write whose value has
outgrown it fails with a check violation naming `ck_<table>_<column>_size`, rather than silently
pushing the row out of line. Changing the declared budget replaces the constraint on the next start.

None of these rewrite rows already stored. Storage and compression apply to values written from then
on, and the size constraint is added `NOT VALID`, so existing rows are not scanned. `VACUUM FULL` or a
rewrite of the rows applies the new layout to them. LZ4 needs a server built with it; on one that is
not, the pass logs a warning and leaves the column as it was. Both options need PostgreSQL 14 or later.

{verified: JsonbColumnStorageIntegrationTests.DeclaredOptions_AreAppliedToTheTableAsync, JsonbColumnStorageIntegrationTests.TheStatements_RunAgain_AlterNothingAsync, JsonbColumnStorageIntegrationTests.AChangedBudget_ReplacesTheConstraintAsync, JsonbColumnStorageIntegrationTests.AValueOverItsBudget_IsRefusedOnWriteAsync, ColumnStorageSqlTests.SchemaGenerator_EmitsTheSameOptionsAsync}

## Search {#search}

{verified: SearchQueryIntegrationTests.Search_IgnoresCaseAsync, SearchQueryIntegrationTests.Search_AStraightQuoteTerm_FindsACurlyQuoteTitle_AndDashesAlikeAsync, SearchQueryIntegrationTests.Search_AWildcardInTheTerm_MatchesLiterallyAsync, SearchQueryIntegrationTests.Search_IsAnsweredByTheFoldIndexAsync, SearchQueryShapeTests.Contains_OnASearchField_FoldsTheValueAndTheTermAsync, SearchQueryShapeTests.Contains_OnAPromotedSearchField_FoldsTheColumnAsync, SearchIndexGenerationTests.ASearchField_GetsATrigramIndexOverItsFoldedValueAsync}

A search box needs more than `Contains`: it should ignore case, and a person typing a straight quote
or a hyphen should still find a title stored with a curly quote or an en dash. Declare the field for
search and write the query as an ordinary `Contains`:

```csharp{title="A field declared for search" description="Declares two fields for folded substring search and queries them with plain Contains" category="Perspectives" difficulty="BEGINNER" tags=["Perspectives", "Search", "Indexes", "Trigram"] tests=["SearchQueryIntegrationTests.Search_AStraightQuoteTerm_FindsACurlyQuoteTitle_AndDashesAlikeAsync"]}
public record JobModel {
  [StreamId] public Guid Id { get; init; }

  [Indexed(IndexKinds.Search)]
  public string JobName { get; init; } = "";

  [Indexed(IndexKinds.Search)]
  public string? JobCode { get; init; }
}

// "o'brien - ops" finds "Chief O’Brien – Operations".
var jobs = await lens.Query
  .Where(r => r.Data.JobName.Contains(term) || r.Data.JobCode!.Contains(term))
  .ToListAsync();
```

What happens underneath:

- **One fold, both sides.** The framework's `wh_fold` lowercases and maps curly quotes, primes, dashes
  and no-break spaces to plain ASCII. The field is indexed as `wh_fold(value)`, and the `Contains` is
  translated to `wh_fold(value) LIKE wh_fold_pattern(term)`, so the stored value and the term are folded
  by the same function and cannot drift apart. LIKE wildcards in the term match literally.
- **A trigram index answers it.** The index is a GIN trigram index over the folded value, which serves a
  match anywhere in the string. It needs the `pg_trgm` extension; where the server refuses it the index is
  skipped with a warning and the search scans, still folded and still correct.
- **Nothing extra is stored.** The index is built over the document (or over the column, for a promoted
  field), so declaring search on a model that already has rows needs no data migration: building the index
  covers them. The index is built by the startup schema pass on the release that declares it, and a
  plain `CREATE INDEX` holds writes to the table while it builds: seconds for tens of thousands of rows, so
  on a very large table ship the declaration in a quiet window.
- **Both registration paths.** The rewrite is installed whether the context is registered with
  `AddWhizbang().WithEFCore<TContext>()` or with the generated `Add{Context}` extension, including for a
  model whose only special fields are search fields.
- **Only where declared.** Folding changes what `Contains` means, so it applies to fields declared for
  search and nowhere else. To search another field folded, call it explicitly:
  `EF.Functions.FoldedContains(r.Data.Notes, term)`. That call scans, because nothing indexes that field.
- **Text only.** Declaring search on anything else is reported (WHIZ305) and builds nothing.

## Adding a physical field to an existing model {#adding-a-physical-field}

{verified: PhysicalColumnBackfillIntegrationTests.Backfill_RestoresExactlyWhatTheWriterStored_ForEveryTypeAsync, PhysicalColumnBackfillIntegrationTests.Backfill_LeavesAColumnThatAlreadyHasAValueAloneAsync, PhysicalColumnBackfillIntegrationTests.AddColumn_OnATableThatPredatesIt_AddsTheColumn_AndIsIdempotentAsync, PhysicalColumnSqlTests.ExistingTable_GetsTheColumn_ThenTheBackfill_ThenTheIndexAsync, PhysicalColumnSqlTests.SplitStorage_FillsTheColumnFromTheDocumentThePreviousReleaseWroteAsync, PhysicalColumnSqlTests.AColumnTypeTheAuthorChose_ForAString_IsBackfilledThroughACastAsync, PhysicalFieldMoveGenerationTests.AnArray_IsBuiltElementByElementInDocumentOrderAsync, PhysicalFieldMoveGenerationTests.AJsonbColumn_TakesTheDocumentValueAsItIsAsync, PhysicalFieldMoveGenerationTests.AnEnumeration_IsReadAsTheNumberItsColumnAndDocumentBothHoldAsync, PerspectiveSchemaBackfillTests.Extracted_EachPhysicalColumn_IsBackfilledFromTheDocumentAsync, PostgresSchemaInitializerCoverageTests.InitializeSchemaAsync_ColumnCopyAddingPhysicalColumns_BackfillsExistingRowsAsync, DapperPerspectiveStorePhysicalFieldTests.Upsert_Insert_WritesEveryPhysicalColumnAsync, SplitPromotionTests.ASplitPromotion_FillsTheColumnFromTheDocumentAsync, DapperPhysicalFieldMoveTests.AColumnCopyPromotion_ArmsAndFillsEachColumnAsync}

Promoting a field of a model that already has rows is safe. The schema pass, on the instance elected
to migrate, does three things in order:

1. **Adds the column** (`ADD COLUMN IF NOT EXISTS`) to the existing table.
2. **Fills it from the document** for every row written before it existed: rows that have the value in
   the document and not in the column. A column the writer has since filled is never overwritten, and
   running it again finds nothing to do.
3. **Builds the column's indexes and length constraints,** which need the column to exist.

This matters because the query translator reads a promoted property from its column. Without the fill,
every filter and sort on the field would read an empty column for the older rows, and return nothing
for them without an error.

The fill reproduces exactly what the writer stores, type by type:

- **Scalars:** text, identifiers, integers, booleans, decimals and floating point.
- **Dates and times,** which are microsecond counts in the document, so they are rebuilt by exact
  arithmetic from the epoch rather than parsed.
- **Enumerations,** whose column and document both hold the underlying number.
- **A `jsonb` (or `json`) column you chose** with `ColumnType = "jsonb"`, which takes the document's value
  as it is. A JSON null becomes a null column.
- **A native array you chose** (`ColumnType = "uuid[]"`, `"text[]"`, `"integer[]"`, ...) over a collection of
  the scalars above, built element by element in document order.
- **Another column type you chose** for a scalar that is not a date or time (`citext`, `numeric(12,2)`, a
  domain), cast to that type, which is how the server parses the value the writer sends.
- **Split storage.** The previous release kept the field in the document, so the documents it wrote still
  hold the value, and the column is filled from them.

Only a vector, a date or time under a column type you chose, and a type the framework does not know have
no document copy the column can be filled from. On a table that already has rows, that column is reported
for a rebuild; see [When the document has no copy](#when-the-document-has-no-copy).

Both drivers do this. With the Dapper driver, each promoted column is recorded and added before the
table's column-copy migration runs, against the table the previous release left, and the fill runs after
the swap against the new table. The Dapper store writes every physical column on insert and update, as the
EF Core store does.

The fill runs inside the startup schema pass, as one `UPDATE` per field. On a very large table, schedule
the release that promotes the field for a quiet period, or promote it on an empty table first.

### Promoting a field that is already indexed {#promoting-an-existing-field}

{verified: PhysicalFieldPromotionTests.APromotedField_LosesItsDocumentIndexesAndGainsColumnIndexesAsync, PhysicalFieldPromotionTests.AnIndexTheSchemaDidNotBuild_IsKeptAsync, PhysicalFieldPromotionTests.ASecondPass_ChangesNothingAsync, PhysicalFieldPromotionTests.ANewTable_HasTheSameColumnIndexesAndArmsNothingAsync, PhysicalPromotionIndexGenerationTests.TheDrops_ComeBeforeTheColumnIndexesThatMayShareTheirNamesAsync}

A field that was already `[Indexed]` in the document has indexes over its extraction: an ordered index
over `data ->> 'Name'`, and trigram indexes for substring and search. Once the field is promoted, its
queries read the column, so those indexes are never used again, though every write still maintains them.
The schema pass that promotes the field moves them:

1. **It drops the document indexes it built for the field.** It finds each one by the name the schema gave
   it, and drops it only when its definition extracts that field from the document.
2. **It builds an index of the same kind over the column.** An ordered index becomes a btree on the
   column, a case-folded one a btree on `lower(column)`, a substring index a trigram index on the column,
   and a search index a trigram index on `wh_fold(column)`. These are the indexes a table created with the
   field already promoted gets, so an old database and a new one end up the same.

```csharp{title="Promoting an indexed field" description="The same [Indexed] declarations describe the column's indexes once [PhysicalField] is added." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "indexing", "physical-fields"] tests=["PhysicalFieldPromotionTests.APromotedField_LosesItsDocumentIndexesAndGainsColumnIndexesAsync"]}
public record ItemModel {
  [StreamId]
  public Guid Id { get; init; }

  // Before: [Indexed] and [Indexed(IndexKinds.Search)] on a document field.
  // After: the same declarations, now describing indexes on the name column.
  [PhysicalField]
  [Indexed]
  [Indexed(IndexKinds.Search)]
  public string? Name { get; init; }
}
```

An index the schema did not build is never dropped, even one over the same extraction. If you created
one yourself, under a name of your own, it stays until you drop it. A column index can share its name
with the document index it replaces (field `Name`, column `name`), which is why the document index is
dropped first.

Dropping an index takes a brief exclusive lock on the table, the same lock that adding the column already
takes in that pass.

### Rows written during a rolling deploy {#rows-written-during-a-rolling-deploy}

{verified: DapperPhysicalFieldMoveTests.ARowThePreviousReleaseWrote_IsFilledByTheDapperStepAsync, DapperPhysicalFieldMoveTests.TheStep_RunsOnlyOnTheInstanceThatTakesTheClaimAsync, PhysicalColumnFillMaintenanceStepTests.ARowWrittenWithOnlyTheDocumentValue_IsFilledAndFoundByAColumnFilterAsync, PhysicalColumnFillMaintenanceStepTests.ASecondRun_ChangesNothingAsync, PhysicalColumnFillMaintenanceStepTests.AColumnStaysArmedUntilTheSettleWindowHasPassedAsync, PhysicalColumnFillMaintenanceStepTests.ABatchFillsNoMoreThanItsSizeAsync, PhysicalColumnFillMaintenanceStepTests.ASecondRunInTheSameWindow_FillsNothingAsync}

The fill in the schema pass covers the rows that exist when the first instance of the new release starts.
During a rolling deploy, instances still on the previous release keep writing, and they do not know the
column. A row they write has the value in the document and null in the column. Queries on the field read
the column, so a filter misses that row and a sort puts it in the wrong place until the row's next event.

The **physical-column fill** maintenance step closes that gap. The pass that adds a column records it as
watched, and the step then fills rows that have the value in the document and none in the column:

- **Bounded.** Each run fills at most 1,000 rows per column per batch and at most 20 batches.
- **Idempotent.** A column is only set where it is null, so a value a writer stored is never replaced,
  and a run with nothing to fill changes nothing.
- **Once per fleet.** Only the instance that wins the ten-minute claim window runs it. With nothing
  watched, the step doesn't claim at all.
- **Until it has settled.** A column stays watched for a day after the pass that added it, which is longer
  than a rollout takes. It is released once a run finds nothing left after that.

Both drivers register the step, so it runs wherever the maintenance worker does: the EF Core Postgres
driver, and the Dapper driver, which claims the window through the registered claim store or, without one,
directly in the same claims table. A value the document holds that the column's type cannot take is
reported as a warning, and the column stays watched.

A Split promotion is different: the new release reads the field from the column, so a row the previous
release writes has to have its column right at once, not ten minutes later. Its writes are synced; see
[Writes from both releases during the deploy](#rolling-deploy-moves) under Storage moves.

Queries could instead read `COALESCE(column, document value)` for a promoted field, which is correct but
is a different expression from the column. A filter on it cannot use the column's index, and that index
is the reason to promote the field. Filling the column keeps every query on the indexed column.

## Storage moves {#storage-moves}

{verified: SplitPromotionTests.AWriteFromEitherRelease_KeepsTheColumnAndTheDocumentInAgreementAsync, SplitPromotionTests.ARowThePreviousReleaseWrote_IsReadWithItsValuesThroughTheStoreAsync, SplitPromotionTests.TheSyncTriggers_AreDroppedWhenTheMoveSettlesAsync, PhysicalFieldDemotionTests.ADemotedField_IsCopiedIntoTheDocumentForEveryRowAsync, PhysicalFieldDemotionTests.AWriteFromEitherRelease_KeepsTheColumnAndTheDocumentInAgreementAsync, PhysicalFieldDemotionTests.ASettledDemotion_DropsItsTriggersAndIsNeverCopiedAgainAsync, PhysicalColumnFormsTests.EachSupportedType_RoundTripsThroughTheDocumentAsync, DapperPhysicalFieldMoveTests.ASplitPromotion_FillsAndSyncsOnTheSwappedInTableAsync, DapperPhysicalFieldMoveTests.ADemotedColumn_IsCopiedIntoTheDocumentAndSyncedAsync}

A field's storage can move between the document and a column in either direction, on either driver,
without losing a value. The move happens on the first start of the release that changes the declaration,
and every move is idempotent: a later start finds nothing to do.

| Change | Safe to ship? | What happens to the data |
|---|---|---|
| Add `[PhysicalField]` to a field of an **Extracted** model | Yes | The column is added and filled from every document. Rows the previous release writes during the deploy are filled by the maintenance step. The document keeps its copy. |
| Add `[PhysicalField]` to a field of a **Split** model | Yes | The column is added and filled from every document. Until the deploy settles, every write keeps the column and the document in agreement, so both releases read the right value. Afterwards the document copy is no longer kept. |
| Promote to a `jsonb` column (`ColumnType = "jsonb"`) | Yes | The column takes the document's value as it is. Same rules as above for Extracted and Split. |
| Promote to a native array or another column type you chose | Yes, for the types listed above | Filled element by element, or through a cast. Otherwise reported for a rebuild. |
| Promote a vector, or a date or time under a type you chose | Only with a rebuild | The column is added but cannot be filled. The start reports the table for a rebuild. |
| Remove `[PhysicalField]` from a field (demotion) | Yes | Every value in the column is copied into the document. Until the deploy settles, every write keeps them in agreement. The column is **left in place**; drop it yourself once the deploy has settled. |
| Demote a field out of a `jsonb` column | Yes | The column's value becomes the document's value as it is. |
| Demote a field whose column has a custom name (`ColumnName = "..."`) | No | The column is found only under the field's default name. Rename the column to the default name first, or rebuild. |
| Demote a column whose type the document cannot hold (a vector, `point`, `interval`) | Only with a rebuild | Nothing is copied. The start reports the table for a rebuild. |
| Change a model from Split to Extracted, or back | Not by this | Use a rebuild. |

### Writes from both releases during the deploy {#rolling-deploy-moves}

During a rolling deploy the two releases read a moving field from different places: after a Split
promotion the new release reads the column and the previous one the document, and after a demotion it is
the other way round. A background fill alone could not keep them right, because a row one release wrote
could be read and written back by the other before the fill reached it.

So for these moves the start that makes the move also adds two row triggers to the table:

- **A write that sets the column** (the release that knows the column) copies it into the document.
- **A write that leaves the column out** (the release that does not) has the column follow the document.

Neither release can then read a value the other wrote in the place it does not look. A document value the
column cannot take leaves the column as it was rather than failing the write. Once the move has been
watched for a day, the maintenance step drops the triggers. An Extracted promotion needs none: both
releases read the document, and the step fills the rows the previous release writes.

## Demoting a field {#demoting-a-field}

{verified: PhysicalFieldDemotionTests.ADemotedField_IsCopiedIntoTheDocumentForEveryRowAsync, PhysicalFieldDemotionTests.ASecondPass_CopiesNothingAsync, PhysicalFieldDemotionTests.ASettledDemotion_DropsItsTriggersAndIsNeverCopiedAgainAsync, PhysicalFieldDemotionTests.PromotingADemotedFieldAgain_RefreshesTheColumnFromTheDocumentAsync, PhysicalFieldMoveGenerationTests.Demote_NeverOffersAFrameworkColumnOrOneAPromotedFieldOwnsAsync, DapperPhysicalFieldMoveTests.ADemotedColumn_IsCopiedIntoTheDocumentAndSyncedAsync}

Removing `[PhysicalField]` from a field keeps its values. The model no longer says the field was promoted,
so on each start that changes the perspective's schema, every field the model keeps only in the document is
checked for a column under the name its promotion would have used (`Score` → `score`). When the table has
one:

1. **The copy.** Every row whose column holds a value its document does not gets the value copied into
   the document, in the form the document stores it (microseconds for dates and times, the number for an
   enumeration, a JSON array for an array column, the value itself for a `jsonb` column).
2. **The rollout.** The triggers described above keep the two in agreement until the move settles.
3. **The record.** The move is recorded in `wh_physical_column_fills`. Once it has settled it is kept, so
   a later start never copies the column, which by then is stale, over the document.

A column every perspective table has, or one a field still promoted owns, is never a candidate.

**The column is never dropped.** Once the move has settled (the maintenance step logs
`... has been copied into the document and has settled; the column is no longer kept in step and can be dropped`),
drop it in a maintenance window:

```sql{title="Dropping a demoted column" description="Run once the demotion has settled; nothing reads the column any more." category="Operations" difficulty="BEGINNER" tags=["perspectives", "physical-fields", "operations"]}
-- Confirm the move has settled.
SELECT table_name, column_name, settled_at
FROM wh_physical_column_fills
WHERE direction = 'to_document';

-- Then drop the column.
ALTER TABLE wh_per_ticket DROP COLUMN score;
```

Promoting the field again later refreshes the column from the document for every row before arming it,
so a column that sat stale while the field was demoted is never read.

## When the document has no copy {#when-the-document-has-no-copy}

{verified: PhysicalFieldMoveNoticeTests.AColumnTheDocumentCannotFill_IsReportedForARebuildAsync, PhysicalFieldMoveNoticeTests.AColumnTheDocumentCannotFill_OnAnEmptyOrMissingTable_IsNotReportedAsync, PhysicalFieldMoveNoticeTests.ADemotedColumnTheDocumentCannotHold_IsReportedForARebuildAsync}

Some moves cannot be made from the stored data: a promoted vector, a promoted date or time under a column
type you chose, or a demoted column of a type the document cannot hold. The values exist only in the
perspective's events. On a table that has rows, the start records the column, and the maintenance step's
first run logs it once, at Warning:

```text
public.wh_per_ticket.embedding cannot be moved for field Embedding: the document holds no copy the column can be filled from, or the column holds a type the document cannot. Rebuild the perspectives stored in public.wh_per_ticket by dispatching RebuildPerspectiveCommand with their names
```

Dispatch [`RebuildPerspectiveCommand`](./rebuild) for the perspectives stored in that table. A table with no
rows has nothing to restore, and reports nothing.

## Enumeration columns {#enum-columns}

{verified: EnumPhysicalFieldGenerationTests.SchemaGenerator_EnumColumn_IsTheUnderlyingIntegerTypeAsync, EnumPhysicalFieldGenerationTests.EFCoreModel_EnumShadowProperty_IsAnIntegerColumnWithANumberConversionAsync, EnumPhysicalFieldGenerationTests.ServiceRegistration_EnumColumn_IsAddedAsAnInteger_AndATextColumnIsFlaggedNotAlteredAsync, DapperCollectivePhysicalColumnIntegrationTests.Store_EnumPhysicalField_IsWrittenAsItsNumberAsync, PerspectivePhysicalValuesTests.ToColumnScalar_NarrowAndUnsignedEnums_WidenToASignedColumnTypeAsync}

An enumeration marked `[PhysicalField]` is stored as its **underlying number**, in a column typed
from that number. The per-event write (EF Core and Dapper), a collective and replay all bind the same
scalar, so a `Where` on the column compares numbers and an index on it orders by them.

| Underlying type | Column |
|---|---|
| `byte`, `sbyte`, `short` | `smallint` |
| `ushort`, `int` (the default) | `integer` |
| `uint`, `long` | `bigint` |
| `ulong` | `numeric` |

Postgres has no unsigned or single-byte integer, so those widen to the next signed type that holds
every value. A declared `ColumnType` still wins: an enum declared `ColumnType = "text"` keeps the
text form EF Core's own conversion gives it, and a collective refuses to set it.

### Columns created as text before this {#enum-text-columns}

{verified: EnumColumnRewriteTests.ATextColumnOfNames_IsConvertedToNumbers_KeepingEveryRowAsync, EnumColumnRewriteTests.RunningItAgain_IsANoOpAsync, EnumColumnRewriteTests.AValueThatIsNeitherANameNorANumber_StopsStartup_NamingTheColumnAsync, EnumColumnRewriteTests.AMissingColumn_IsANoOpAsync, EnumColumnRewriteTests.AFlagsColumn_CombinedNames_BecomeTheBitwiseOrOfTheirValuesAsync, EnumColumnRewriteTests.AFlagsColumn_AComponentThatIsNotAMember_StopsStartup_NamingTheValueAsync, EnumColumnRewriteTests.AFlagsColumn_RunningItAgain_ChangesNothingAsync, EnumPhysicalFieldGenerationTests.ServiceRegistration_EnumColumn_IsAddedAsAnInteger_AndATextColumnIsRewrittenByTheRewritePhaseAsync}

Earlier releases typed an enum column as `text` and stored the enum's **name** in it. Such a column is
converted automatically at startup, with no operator step. The generator writes one rewrite per enum
column from the enum's own members, and the stored-format rewrite phase applies it. That phase is
the one that converts temporal document keys: it runs once per schema, under the schema lock, before
the indexes are built, and it waits out older snapshots before indexing.

- **Idempotent.** It acts only while the column is still `text` (or `varchar`). A column that is
  already numeric, or that the schema pass has not created yet, is left alone, so later starts do
  nothing.
- **Names become numbers, and numbers are kept.** Each member name maps to its underlying value.
  Names match exactly, as both drivers wrote them. A value that is already a number is kept as it
  is (for example an undefined value's `ToString()`, or a row a newer instance wrote), and a null
  stays null. The column is then retyped in place with `ALTER TABLE … ALTER COLUMN … TYPE`.
- **`[Flags]` combinations become their bitwise OR.** For an enum marked `[Flags]`, a value holding
  combined names in the form .NET writes them (`"Read, Write"`) is converted to the bitwise OR of
  the named members' values (`3`). Single names and numbers convert as above. Only enums marked
  `[Flags]` get this decoding; the generator knows from the enum's declaration.
- **Anything else stops startup.** A value that is neither a member name nor a number (a renamed or
  removed member, different casing, or for a `[Flags]` enum a combination with a component that is
  not a member) cannot be read, so the phase fails the schema pass with an error naming the table,
  the column and up to ten of the offending values. Nothing is changed. Correct or clear those
  values, then restart.

**The conversion locks the table.** Retyping the column rewrites the whole table under an
`ACCESS EXCLUSIVE` lock, so nothing can read or write that table until the conversion finishes. It
happens once, on the first start of this release, and only for a table whose enum column is still
text. On a large table that start takes correspondingly longer, and reads and writes against the
table wait for it. This is the accepted cost of an automatic conversion: if that pause is not
acceptable, convert the column yourself beforehand in a maintenance window, and the rewrite then
finds a numeric column and does nothing.

A property whose type changed to or from an enum, or between other scalars, is converted the same
way when you declare it with `[StoredForm(Previously = ...)]`, in the document and in its column:
see [Stored-form migrations](stored-form-migrations.md#physical-columns).

### Enums inside the document {#enum-documents}

{verified: DocumentEnumFormTests.PersistenceProfile_Enum_IsWrittenAsItsNumberAsync, DocumentEnumFormTests.PersistenceProfile_RegistersNoStringEnumConverterAsync}

Inside `data`, an enumeration was already stored as its underlying number, on every path. The
persistence serialization profile registers no string-enum converter. The generated JSON contexts
build an enum's metadata from the built-in numeric converter, and ignore any converter registered on
the options. EF Core's own `ToJson()` mapping stores enums as numbers by default too, and the collective
`Where` compiler has always compared a document enum as its number. No document rewrite is needed.
The wire format for messages is separate and still uses enum names.

## Collective updates {#collective-updates}

A [collective event](../messaging/collective-events.md#physical-columns) can set a physical field.
The setter writes the column as a typed parameter in the collective's single `UPDATE`, and writes
the document path as well unless the model is `Split`. A collective that sets only `Split` fields
leaves `data` out of the statement entirely, so a bulk change to a hot column costs a column write
rather than a new copy of every document. A collective's `Where` on a physical field filters on the
column. Enumerations bind their number, a `[VectorField]` can be set (not compared), and a keyed
array in a `jsonb` column is upserted in the column.

## Query Syntax

Physical fields support unified query syntax - write queries against `r.Data.PropertyName` and Whizbang automatically routes to physical columns:

```csharp{title="Query Syntax" description="Physical fields support unified query syntax - write queries against `r." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Query", "Syntax"] unverified="consumer LINQ query illustration; physical-column routing is verified only by PhysicalFieldIntegrationTests, which is map-absent"}
// This query uses the indexed physical column automatically
var results = await lens.Query
    .Where(r => r.Data.CategoryId == categoryId)
    .Where(r => r.Data.Price >= 100.00m)
    .OrderBy(r => r.Data.Sku)
    .ToListAsync();
```

The generated SQL uses the physical columns:

```sql{title="Query Syntax (2)" description="The generated SQL uses the physical columns:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Query", "Syntax"]}
SELECT * FROM wh_per_product
WHERE category_id = @p0
  AND price >= 100.00
ORDER BY sku;
```

## Index Advisories {#index-advisories}

Nothing about a JSON-only filter looks wrong. The results are correct, the tests pass, and the cost
only appears once the table grows. Whizbang handles the common case for you and tells you about the
rest at the point of writing.

**Equality is handled automatically.** A filter such as `row.Data.TenantId == tenantId` compiles to a
jsonb containment test that the GIN index on the data column answers, so it is a lookup rather than a
scan even though the property has no physical column. See
[JSONB Containment Queries](jsonb-containment.md) for exactly what is rewritten, what is deliberately
left alone, and how to switch it off.

What containment cannot serve still wants a physical column: ranges and inequalities, ordering,
pattern matching, dates and times, enumerations, and comparisons under a negation. That is what the
analyzer below is for.

The [WHIZ302](../../operations/diagnostics/whiz302.md) analyzer warns when a lens query filters,
orders, or counts on a property that has no physical column. It keys on `PerspectiveRow<TModel>.Data`,
so both the scoped lens surface and the older direct one are covered, in method and in query syntax.
It stays quiet on projections, which read a field out of rows already chosen, and on properties the
generators would index anyway: `[StreamId]`, `[PhysicalField] [Indexed]`,
`[PhysicalField(Unique = true)]`, and `[VectorField]`.

A scan is sometimes the right answer. A perspective that holds one row per tenant, a lookup of
enumeration values, a filter that runs once a day: promoting those fields buys write cost and
returns nothing. Record the decision where the model is defined.

```csharp{title="Declare that a field is deliberately unindexed" description="SuppressIndexAdvisory silences both the WHIZ302 build warning and the runtime index advisory; the reason is required." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "physical-fields", "indexing", "suppression"] tests=["PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnProperty_NoDiagnosticAsync", "PerspectiveFilterIndexAnalyzerTests.Filter_WithSuppressionOnModel_NoDiagnosticAsync"]}
[SuppressIndexAdvisory("bounded at a few hundred rows by the retention cap")]
public record FeatureFlagModel {
  [StreamId]
  public Guid FlagId { get; init; }

  public string Name { get; init; } = string.Empty;
}
```

The attribute goes on a property, a model, or an assembly. The reason is required, and a blank one
does not suppress: the attribute's value is the stated rationale, so a placeholder would defeat it.
The same attribute stands down the runtime index advisory raised by the maintenance cycle, which a
`#pragma` would not, since a pragma silences only the compiler.
{verified: PerspectiveFilterIndexAnalyzerTests.Filter_WithBlankSuppressionReason_StillReportsAsync}

Teams upgrading an existing codebase with many such queries should lower the severity once in
`.editorconfig` and work it back up as fields are promoted, rather than adding suppressions in bulk.
The [WHIZ302 page](../../operations/diagnostics/whiz302.md) covers that migration, and covers the
cases where an index is the wrong fix: unselective predicates, small tables, many columns filtered
in varying combinations (which want single-column indexes and a bitmap scan, not composites), and
correlated columns (which want extended statistics, not an index at all).

## Best Practices

1. **Index selectively**: Only create indexes on frequently queried fields
1. **Filter on a small jsonb column, not the document**: keep normalized filter values in a promoted
   jsonb column with `[Indexed(IndexKinds.Containment)]`, and keep it inline with `Storage = ColumnStorage.Main`
2. **Use Extracted mode** when you need both indexed queries and full JSONB flexibility
3. **Use Split mode** for large fields (vectors, blobs) to avoid duplication
4. **String lengths**: Set `MaxLength` for strings that need constraints
5. **Unique constraints**: Use `Unique = true` for natural keys like SKU or email

## See Also

- [JSONB Containment Queries](jsonb-containment.md) - How an equality filter reaches the GIN index
- [Vector Fields](vector-fields.md) - Vector similarity search with pgvector
- [Perspective Registry](registry.md) - Table tracking and renaming
- [Polymorphic Discriminator](polymorphic-discriminator.md) - Efficient polymorphic queries
