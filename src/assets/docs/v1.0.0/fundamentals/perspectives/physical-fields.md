---
title: Physical Fields
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
codeReferences:
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
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldInfo.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldExpressionVisitor.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldQueryInterceptor.cs
  - >-
    src/Whizbang.Data.EFCore.Postgres/QueryTranslation/WhizbangDbContextOptionsBuilderExtensions.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexStorageAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PerspectiveIndexSetupTests.cs
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
than once where that reads better than a combination. `Substring` requires `pg_trgm`, which the schema
pass creates if it is missing.

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
| `Indexed` | `bool` | `false` | Create a B-tree index on this column |
| `Unique` | `bool` | `false` | Apply UNIQUE constraint |
| `ColumnName` | `string?` | `null` | Custom column name (defaults to snake_case) |
| `MaxLength` | `int` | `-1` | VARCHAR length for strings (-1 = TEXT) |

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
2. **Use Extracted mode** when you need both indexed queries and full JSONB flexibility
3. **Use Split mode** for large fields (vectors, blobs) to avoid duplication
4. **String lengths**: Set `MaxLength` for strings that need constraints
5. **Unique constraints**: Use `Unique = true` for natural keys like SKU or email

## See Also

- [JSONB Containment Queries](jsonb-containment.md) - How an equality filter reaches the GIN index
- [Vector Fields](vector-fields.md) - Vector similarity search with pgvector
- [Perspective Registry](registry.md) - Table tracking and renaming
- [Polymorphic Discriminator](polymorphic-discriminator.md) - Efficient polymorphic queries
