---
title: The Perspective Query Pipeline
pageType: guide
audience: [contributor]
status: current
order: 5
description: Where a perspective filter is rewritten so an index can answer it, why Entity Framework and Dapper need different answers, and which decision belongs at which stage
tags: perspectives, query-translation, jsonb, indexing, efcore, dapper, internals
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainment.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonbContainmentSwitch.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/Containment/ContainmentPostprocessorSpike.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldExpressionVisitor.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalFieldQueryInterceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/JsonIndexRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/ProviderCapabilities.cs
  - src/Whizbang.Data.Postgres/Migrations/152_JsonbContainmentSet.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/ContainmentPostprocessorSpikeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentSqlMatrixTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonbContainmentAuthoringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/GinContainmentIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/JsonIndexStandDownTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/JsonbContainmentSetFunctionTests.cs
---

# The Perspective Query Pipeline

This page is for people changing the query translation, not for people using it. If you want to know
what you can write in a lens filter and what happens to it, read
[JSONB Containment Queries](../v1.0.0/fundamentals/perspectives/jsonb-containment.md) instead.

## The problem, in one paragraph

A perspective stores its model as a JSON document in the `data` column, and every perspective table
carries a GIN index on that column. A GIN index with the default operator class answers containment
and existence and nothing else, so a property comparison written in LINQ, which compiles to a text
extraction with a cast, cannot use it. Rewriting the same filter as
`data @> jsonb_build_object('Key', value)` puts the bare column on the left of the containment
operator, which is what the index matches. Everything below exists to do that rewrite without ever
changing which rows come back.

## The fork that decides whether any of this applies

Before any of it, a model takes one of two storage paths, and the pipeline below only exists on one
of them.

**Mapped.** The model is mapped property by property into the `data` column. A filter compiles to an
extraction, `(data ->> 'TenantId')::uuid`, which is what the rewrite reshapes, what an expression
index is built over, and what a value conversion attaches to. Everything on this page is about this
path.

**Opaque.** The model holds an abstract member, or one marked `[JsonPolymorphic]`. Property-by-property
mapping reconstructs the declared type on the way back and would lose the derived one, so the whole
document is stored as a single serialized value that carries a type discriminator. Nothing inside it
is a mapped property: no extraction to reshape, nothing for the rewrite to recognize, and nowhere to
attach a conversion. Declared indexes are skipped and
[WHIZ304](../v1.0.0/operations/diagnostics/whiz304.md) reports why. Fields that must be filtered are
promoted to real columns.

`PolymorphicModelDiscovery.IsPolymorphic` answers this, in the shared generator project rather than in
either caller, because the generator that emits the configuration and the analyzer that reports an
unreachable index have to agree. Two copies of this question would disagree silently, and in the
direction that is hardest to notice: an index emitted for a model that was told it would get none.

The rule is that **only public properties count**, which is what both the mapped path and the
serializer already do. This was once not true, and the consequence was large: a `record` carries a
compiler-generated protected `EqualityContract` of type `System.Type`, `System.Type` is an abstract
class, so every record answered "opaque" on its first member and sat outside indexing, containment
and conversion alike, while an identical `class` did not.

## Why Entity Framework and Dapper get different answers

The two drivers are not two implementations of one idea. They are different problems.

**Entity Framework owns the SQL, so the framework has to rewrite something.** A developer writes
`row.Data.TenantId == tenantId` and never sees SQL. If the compiled form is to be containment,
something in the translation pipeline must make it so. That is the whole of the machinery on this
page.

**Dapper does not own the SQL, so there is nothing to rewrite.** A developer writes the statement.
The framework's job is therefore not translation but *supply*: give them something they could not
easily write themselves, and document the shape that reaches the index. That is why the Dapper side
of this feature is a single SQL function shipped in a migration rather than a pipeline.

| | Entity Framework | Dapper |
|---|---|---|
| Who writes the SQL | the framework | the developer |
| What the framework provides | a rewrite, invisibly | a function, and the documented shape |
| Where the logic lives | the query pipeline | migration 152 |
| How it is verified | compiled SQL per shape, then executed | the function's output, volatility, and row agreement |
| What can go silently wrong | a filter that means something different | a hand-written statement that misses the index |

{verified: JsonbContainmentSetFunctionTests.IsImmutableSoThePlannerCanInlineItAsync, JsonbContainmentSetFunctionTests.MembershipAgreesWithEqualityAsync}

The Dapper side is small on purpose. `jsonb_containment_set` exists because a set-membership filter
has to compare a document with one document per candidate value, and turning a single array parameter
into an array of documents inline needs a scalar subquery that a translator cannot build and a person
should not have to. It is declared `IMMUTABLE` and written in SQL so the planner inlines it, which is
asserted directly: an opaque call would be correct and would plan as a sequential scan, defeating the
point.

## The Entity Framework pipeline, in order

Four passes run over a perspective query, and the order is load-bearing.

```mermaid{caption="The four passes a perspective query goes through, and what each one is uniquely able to decide." tests=["JsonbContainmentSqlMatrixTests.CompiledSql_SendsTheFilterWhereExpectedAsync", "ContainmentPostprocessorSpikeTests.TypeMappingsAreAssignedBeforeTheReshapeRunsAsync"]}
flowchart TD
  A[LINQ query as written] --> B[Physical field pass<br/>promoted properties become real columns]
  B --> C[Compatibility pass<br/>normalizes shapes EF would refuse]
  C --> D[Containment rewrite<br/>equality becomes a marker call]
  D --> E[EF translation<br/>markers become SQL, mappings assigned]
  E --> F[Reshape pass<br/>optional: equality becomes containment here instead]
  F --> G[Compiled SQL]
```

### 1. The physical field pass

Runs first, and that is what keeps promoted fields out of everything downstream. By the time the
containment rewrite sees the tree, a `[PhysicalField]` property is already an `EF.Property` call over
a real column and no longer looks like a JSON member at all. No later stage needs a rule about
promoted fields, because none of them can see one.

### 2. The compatibility pass

Handles the one thing only this stage can: a shape Entity Framework refuses to translate.
`Equals(value, StringComparison.Ordinal)` is the whole of that list. Entity Framework throws on it, so
after translation there is nothing left to inspect.

Its job is narrow on purpose: turn the untranslatable shape into a translatable one and stop. It does
not build containment and does not know containment exists. Everything downstream then sees an
ordinary equality, so the capability costs no special case anywhere else.

### 3. The containment rewrite

Replaces `member == value` with a marker call whose registered translation builds the containment
test. This is the shipping mechanism today.

It stands down in five situations, and each one is a place where containment and equality would
answer differently rather than merely a case that was not worth doing:

- **A comparison against null.** An extraction of an absent key is SQL NULL; containment of an
  explicit JSON null does not match an absent key. A row written before the property existed would
  answer differently.
- **Anything under a negation.** In a positive filter both forms exclude an absent key, which is why
  the rewrite is safe there. Under `NOT` they diverge: `NOT NULL` still excludes, `NOT false`
  includes.
- **Outside a predicate.** A projection or an ordering surfaces the comparison's own value, where the
  null-versus-false difference becomes observable. Inside a filter it cannot be.
- **A value converter that changes the stored form.** The document would be built in the unconverted
  form and match nothing, which is a wrong answer rather than a slow one.
- **A field with its own btree index.** Rewriting would send the planner to the document index and
  leave that one unused, which is the problem this work exists to fix rather than to cause.

{verified: JsonbContainmentSqlMatrixTests.CompiledSql_SendsTheFilterWhereExpectedAsync, JsonIndexStandDownTests.ABtreeIndexedField_IsNotCompiledToContainmentAsync, GinContainmentIntegrationTests.MissingKey_IsWhereContainmentAndExtractionDisagreeAsync}

### 4. The reshape pass

An alternative to stage 3 that works on the translated SQL rather than on the LINQ tree, turning
`CAST(data ->> 'K' AS t) = value` into containment directly. Currently a spike behind its own
registration, not a shipping path.

Two things make that position better, and both were measured rather than assumed. By then Entity
Framework has applied any value converter **to both sides of the comparison**, so a value object
holding an identifier arrives as the identifier and a number stored as text arrives as that text.
Reshaping either builds a document in exactly the stored form, with nothing to convert by hand. And
every node carries a type mapping, which is what the equivalent attempt on the LINQ tree could not
arrange: a converted value reached the SQL tree unmapped and Entity Framework refused the query.

What it does **not** fix is a date. Entity Framework renders a date parameter as a timestamp, so a
reshaped date comparison builds PostgreSQL's ISO form with an explicit offset rather than the
trailing `Z` the serializer writes. Stored-form agreement is a separate problem from type dispatch.

{verified: ContainmentPostprocessorSpikeTests.APredicateCanBeReplacedAfterTranslationAsync, ContainmentPostprocessorSpikeTests.TypeMappingsAreAssignedBeforeTheReshapeRunsAsync}

## Things that cost a debugging cycle

Collected because none of them are guessable and each was found the hard way.

**A `ShapedQueryExpression` refuses to be visited generically** and says so in the exception. Its
shaper is client-side code rather than SQL, so descend into `QueryExpression` by hand.

**The pipeline folds a tautology after the reshape runs.** A marker built as a comparison of a
constant with itself disappeared from the compiled SQL while every other observation still held, so
the gate reported success for a marker that had not survived. Use something no optimizer will reason
about.

**Asserting on generated SQL cannot tell a valid statement from an invalid one.** A statement
containing `jsonb_containment_set` and `@> ANY` is exactly what a broken one contains too; the missing
parentheses that made it a syntax error were invisible to 800 text assertions and obvious on the first
execution. Anything claiming a shape works has to run.

**An index over the wrong expression is simply a different index.** The planner ignores it while every
query still returns correct rows, so the failure mode is a silent sequential scan rather than an
error. This is why the declared-index expressions are asserted against a real query and a real plan
per type, and why they mirror Entity Framework's casts rather than being tidied.

**`PgUnknownBinaryExpression` needs a non-null type mapping** or the operator surfaces as "could not
be translated", and it renders its operands bare, so `ANY`'s parentheses have to be supplied
separately.

**`JsonScalarExpression` is the key to all of it.** Its `Json` property holds the column and its
`Path` holds the key names, so containment and extraction always name the same place. Two earlier
attempts were abandoned as impossible before that was noticed.

## Where the switch is

`JsonbContainmentSwitch` turns the rewrite off, defaulting to on, and `ProviderCapabilities` pins the
Entity Framework and Npgsql versions this was validated against, so a provider that starts doing this
itself fails a test rather than silently producing two rewrites.

## See Also

- [JSONB Containment Queries](../v1.0.0/fundamentals/perspectives/jsonb-containment.md) — the
  user-facing behavior
- [Physical Fields](../v1.0.0/fundamentals/perspectives/physical-fields.md#json-indexed) — the three
  tiers of field storage
- [WHIZ302](../v1.0.0/operations/diagnostics/whiz302.md) and
  [WHIZ303](../v1.0.0/operations/diagnostics/whiz303.md)
