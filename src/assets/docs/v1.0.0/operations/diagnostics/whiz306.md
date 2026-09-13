---
title: 'WHIZ306: Fields reachable by request-time sorting have no index'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective model is exposed to sorting or filtering
  composed from the request while its fields carry no index and no recorded
  decision.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 306
tags: 'diagnostics, perspectives, indexing, graphql, sorting, analyzer'
codeReferences:
  - src/Whizbang.Generators/Analyzers/QueryExposureIndexAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/SortableExposureDiscovery.cs
  - src/Whizbang.Core/Perspectives/ComposesQueryFromRequestAttribute.cs
  - src/Whizbang.Core/Perspectives/QueryExposureRegistry.cs
  - src/Whizbang.Core/Observability/QueryExposureAdvisory.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/QueryExposureIndexAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/QueryExposureDetectionTests.cs
  - tests/Whizbang.Core.Tests/Observability/QueryExposureAdvisoryTests.cs
---

# WHIZ306: Fields reachable by request-time sorting have no index

**Severity**: Warning
**Category**: Perspective Validation

## Why this diagnostic exists

[WHIZ302](./whiz302.md) reads source. It finds a filter because somebody wrote `Where(...)` where an
analyzer could see it.

A surface that composes sorting or filtering from the request writes no predicate anywhere. The field
name arrives as a string and the `ORDER BY` is built when the request is served, so there is nothing
in source to read. WHIZ302 is therefore silent on exactly the models that are queried the most, and
its silence there is not evidence that anything is fine.

What *is* visible is the exposure. An attribute that puts a sorting middleware on a query is a
statement that any field of the model may end up in an `ORDER BY`, and that statement can be checked.

An unindexed sort on a large perspective is the most expensive query shape there is, and the one
least likely to be noticed, because it returns correct rows.

## Diagnostic message

```
'{Model}' is exposed with sorting or filtering composed from the request, so any of its fields can
reach an ORDER BY or WHERE that this build never sees. {N} of its fields carry no index and no
recorded decision ({Fields}), and a sort on any one of those reads every row of the perspective.
```

## What counts as an exposure

Three ways an attribute qualifies, because no single one is enough.

### 1. The marker, for anything that can reference the framework

`[ComposesQueryFromRequest]` goes on **your own attribute**, not on a query. It says once that every
method carrying that attribute lets a request shape the query.

```csharp{title="Marking an extension's own attribute" description="A domain language that turns a request string into a LINQ expression declares the widest exposure there is." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["whiz306", "extensibility", "marker-attribute", "expressions"] tests=["QueryExposureDetectionTests.AnExpressionSurfaceDeclaresTheWidestExposureAsync"]}
// An extension that turns a request string into a LINQ expression over any queryable.
[ComposesQueryFromRequest(QueryExposure.Expression)]
[AttributeUsage(AttributeTargets.Method)]
public sealed class UseExpressionAttribute : Attribute { }
```

This is the case that makes a marker worth having over a hardcoded list. An extension that builds
arbitrary predicates is the widest exposure possible and would be invisible to any list the framework
could ship, while being exactly the thing worth reporting.

### 2. The framework's own lens attributes

`[RestLens]` and `[GraphQLLens]` already carry the marker, so a lens declared with either is covered
with nothing extra to write.

### 3. Named attributes the framework integrates with but does not own

HotChocolate's `[UseSorting]` and `[UseFiltering]` are recognized by name. For a third party's
attribute that neither the marker nor the built-in list reaches, name it in an analyzer option:

```xml{title="Naming a third-party query-composing attribute" description="The last resort of the three, for an attribute neither the framework nor its author can mark." category="Configuration" difficulty="INTERMEDIATE" tags=["whiz306", "analyzer-config", "msbuild"] unverified="build configuration rather than library behavior"}
<PropertyGroup>
  <WhizbangQueryComposingAttributes>Vendor.QueryableAttribute,Vendor.SortableAttribute</WhizbangQueryComposingAttributes>
</PropertyGroup>
<ItemGroup>
  <CompilerVisibleProperty Include="WhizbangQueryComposingAttributes" />
</ItemGroup>
```

Naming is last of the three because it is the only one that can go stale without saying so. Marking
the attribute is better whenever it is possible, because the claim then travels with the package
rather than with each consumer's configuration.

> **One difference worth knowing.** A named attribute raises this build warning but does not reach the
> runtime registry, so the [runtime advisory](#the-runtime-half) will not report models exposed only
> that way. A marked attribute gets both.

## Narrowing what an attribute declares

An `EnableSorting` or `EnableFiltering` property set to `false` removes that capability from what the
marker declared, because a surface that turns sorting off is not offering ordering however its
attribute is marked.

```csharp{title="A surface that turns sorting off" description="No WHIZ306: the surface offers filtering only, which containment can answer." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz306", "enable-sorting", "narrowing"] tests=["QueryExposureIndexAnalyzerTests.ASurfaceWithSortingOffIsNotReportedAsync"]}
[RestLens(Route = "jobs", EnableSorting = false)]
public interface IJobLens : ILensQuery<JobModel>;
```

## Why filtering alone is not reported

Only ordering raises this diagnostic. The document's containment index can answer a filter; it can
answer neither a sort nor a comparison over an extraction, both of which read every row unless an
index exists over the extracted expression. An arbitrary expression counts as ordering, because it can
produce any shape a query can take.

## How to fix

There are three honest answers, and the right one depends on the surface. The diagnostic names the
count and the fields and deliberately leaves the choice, because the set of fields a client can
really sort by is usually small and the analyzer cannot tell which they are. The author can.

### Index what the surface actually offers

The usual answer. Declare the fields the screen really sorts and filters by.

```csharp{title="Index the fields the surface offers" description="Declaring the sortable fields is what lets a request-time ORDER BY be served without reading the whole table." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz306", "indexed-attribute", "sorting"] tests=["QueryExposureIndexAnalyzerTests.AnIndexedModelIsNotReportedAsync"]}
public record ProductDto {
  [StreamId]
  public Guid ProductId { get; init; }

  // The GraphQL surface offers sorting by name. The sort is composed after this assembly is built,
  // so nothing in source shows the ORDER BY: this declaration is what says it can be served.
  [Indexed]
  public string Name { get; init; } = string.Empty;

  // A range predicate is exactly what the document's containment index cannot answer.
  [Indexed]
  public decimal Price { get; init; }

  [SuppressIndexAdvisory("long free text; a catalog sorts by name and price, not by description, "
    + "and a btree over a paragraph costs more than the scan it saves")]
  public string? Description { get; init; }
}
```

### Index every field

For a model that genuinely is queried every way, `[IndexAllFields]` on the model says so once. Be
deliberate: this is a real cost per write, and a fifty-field model indexed wholesale to silence a
warning is worse than the warning.

### Record the decision

When a scan is genuinely acceptable, say why. The reason is required, and a blank one does not
suppress.

```csharp{title="Recording a decision" description="A reason is required, and the same attribute stands down both the build warning and the runtime advisory." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz306", "suppress-index-advisory", "recorded-decision"] tests=["QueryExposureAdvisoryTests.AnAccountedForModelIsNotReportedAsync"]}
[SuppressIndexAdvisory("admin screen over tens of rows; a scan is cheaper than the index")]
public record TenantSettingsModel {
  [StreamId]
  public Guid TenantId { get; init; }

  public string DisplayName { get; init; } = string.Empty;
}
```

## Where it is reported

On the **surface**, not the model. The surface is the decision that created the exposure, it is in
the compilation being built, and it is where an author can act; the model may live in a referenced
assembly with no source to squiggle.

Once per **exposure**, not once per field. Two surfaces over the same model are two separate
decisions someone can change, so both are reported.

## The runtime half

The build cannot finish this argument, because it has no idea how big the table is. A model exposed
to request-time sorting with two hundred rows behind it is fine, and warning about that is how a rule
gets suppressed wholesale. The same exposure over several gigabytes is a different matter.

So the exposure is carried into the running process. A generator emits one registration per exposed
model into a module initializer, per assembly and with no reflection, so it survives trimming and
native compilation. Per assembly because a generator sees only its own compilation: the exposure is
declared where the surface is, usually the host, while the model is declared in a library that knows
nothing about it.

`QueryExposureAdvisory` then joins that against the table sizes the statistics cycle already fetches
and logs once per model per process, above a deliberately high size threshold.

```csharp{title="What the runtime advisory logs" description="Size rather than row count, because that is what the catalog gives without a scan." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz306", "runtime-advisory", "table-statistics"] tests=["QueryExposureAdvisoryTests.ALargeOrderablePerspectiveIsReportedAsync"]}
warn: Whizbang.Core.Observability.QueryExposureAdvisory
      Perspective 'DraftJobModel' (bff.draft_job) is 4312 MB and a request can shape its query
      (Ordering, Filtering), so any field it names can reach an ORDER BY or WHERE that no index
      serves, reading the whole table. 51 of its fields carry no index and no recorded decision
      (...). Reported once per process.
```

`[SuppressIndexAdvisory]` stands this down as well as the build warning. Which fields were
unaccounted for cannot be recomputed at runtime without reading the model's attributes, so it rides
along with the registration: a model that indexed what it exposes, asked for every field, recorded a
decision, or is stored opaquely registers no unaccounted fields, and an advisory with nothing to
report says nothing.

## Related

- [WHIZ302: Filtered Perspective Field Has No Index](./whiz302.md) reports a filter written in
  source whose field carries no index.
- [WHIZ304](./whiz304.md) reports a declared index on a model with nothing to build it over.
- [JSONB containment](../../fundamentals/perspectives/jsonb-containment.md) covers the index kinds and
  what each one answers.
