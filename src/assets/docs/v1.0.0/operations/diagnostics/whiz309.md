---
title: 'WHIZ309: Collective predicate filters an unindexed field'
pageType: troubleshooting
description: >-
  Warning diagnostic when a collective handler's Where filters a perspective field that has no
  index of its own, so every collective apply reads every row of the table. Turned off per project
  with an MSBuild property, or per perspective with [SuppressIndexAdvisory].
version: 1.0.0
category: Diagnostics
severity: Warning
order: 309
tags: 'diagnostics, perspectives, indexing, analyzer, collective-events, code-fix'
codeReferences:
  - src/Whizbang.Generators/Analyzers/CollectivePredicateIndexAnalyzer.cs
  - src/Whizbang.Generators.CodeFixes/IndexedCodeFixProvider.cs
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.props
  - src/Whizbang.Data.Postgres/Collective/CollectivePredicateSqlCompiler.cs
  - src/Whizbang.Core/Perspectives/SuppressIndexAdvisoryAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/CollectivePredicateIndexAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/CodeFixes/IndexedCodeFixProviderTests.cs
---

# WHIZ309: Collective predicate filters an unindexed field

**Severity**: Warning
**Category**: Perspective Validation
**Code fix**: Add `[Indexed]`

## Why this diagnostic exists

A [collective event](../../fundamentals/messaging/collective-events.md) is applied as one `UPDATE`
per perspective table, and the handler's `Where` becomes that statement's `WHERE`. Each field the
predicate names is read as an extraction from the stored document, `data ->> 'OverlayId' = @p`, or
as the promoted column for a `[PhysicalField]`. Only an index over that extraction or column
answers it.

The whole-document index doesn't. It answers containment (`@>`), not extraction, so declaring
`[PerspectiveQueries(MatchOnAnyField = true)]` doesn't help here. An earlier release created an index
for each such field during the apply itself. Nothing creates indexes at apply time any more, so on a
new database a predicate field without `[Indexed]` is scanned on every apply. On a large table that
is a long `UPDATE` holding the per-scope lock while it reads every row.

## Diagnostic message

```
This collective predicate filters '{Model}.{Field}', which has no index of its own, so every apply
reads every row of the perspective. Mark it [Indexed], or record the decision with
[SuppressIndexAdvisory("reason")] on the field, the model or the perspective.
```

## When it fires

Any reference to `<row>.Data.<Field>` inside a `[CollectiveApplyFor]` handler, including inside a
sibling cohort reached through `ICollectiveQuery.Of<TOther>()`, where the field has no index the
comparison can use:

```csharp{title="Collective predicates WHIZ309 reports" description="Equality, ordering and set filters on fields with no index of their own." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz309", "collective-events", "indexing"] tests=["CollectivePredicateIndexAnalyzerTests.AnEqualityOnAnUnindexedField_WarnsAsync", "CollectivePredicateIndexAnalyzerTests.EveryPredicateShapeOnAnUnindexedField_WarnsAsync"]}
public record OverlayModel {
  [StreamId]
  public Guid Id { get; init; }

  public Guid OverlayId { get; init; }   // no index of its own
  public int Ordinal { get; init; }      // no index of its own
  public bool Removed { get; init; }
}

public sealed class OverlayPerspective {
  [CollectiveApplyFor]
  public ICollectiveSpec<OverlayModel> Remove(OverlayRemoved e) =>
    new CollectiveSpec<OverlayModel>(
      Setters: s => s.SetProperty(o => o.Removed, true),
      Where: r => r.Data.OverlayId == e.OverlayId);   // WHIZ309
}
```

Ranges (`r.Data.Ordinal < 5`) and set filters (`ids.Contains(r.Data.OverlayId)`) are reported the
same way, because they read the same extraction.

It does **not** fire when:

- the field has an ordered index over its plain value: `[Indexed]`, `[IndexAllFields]` on the model,
  `[PhysicalField]` with `[Indexed]` or `Unique`, or `[StreamId]`. A case-insensitive or
  substring-only `[Indexed]` is over a different expression, so it doesn't count;
- the predicate reads the row's own columns (`r.Id`) or its scope (`r.Scope.TenantId`). Every table
  has the tenant index;
- the predicate is a lens filter rather than a collective one. [WHIZ302](whiz302.md),
  [WHIZ307](whiz307.md) and [WHIZ308](whiz308.md) cover those;
- the warning is turned off or suppressed (below).

## How to fix it

**Index the field.** This is almost always the answer, and the code fix does it: it adds
`[Indexed]` where the field is declared, which is usually a different file from the predicate. On a
positional record it writes `[property: Indexed]`.

```csharp{title="Settling WHIZ309 with an index" description="The field the collective predicate filters gets an ordered index of its own." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz309", "collective-events", "indexing"] tests=["IndexedCodeFixProviderTests.OnAPropertyDeclaration_AddsIndexedInTheModelsFileAsync", "IndexedCodeFixProviderTests.OnAPositionalParameter_AddsIndexedTargetingThePropertyAsync"]}
public record OverlayModel {
  [StreamId]
  public Guid Id { get; init; }

  [Indexed]
  public Guid OverlayId { get; init; }
}
```

On a database where an earlier release already created `idx_wh_per_<table>_data_<field>` at apply
time, the declaration doesn't build a second index. The schema pass finds the existing one by its
definition and leaves it in place (see
[Perspective Indexes](../../fundamentals/perspectives/perspective-indexes.md#indexes-an-earlier-release-created-at-apply-time)).

## Turning it off

**For one perspective, model or field.** Record the decision with `[SuppressIndexAdvisory]`. The
reason is required, and a blank one doesn't suppress:

```csharp{title="Suppressing WHIZ309 for one perspective" description="A reasoned opt-out on the perspective class silences only its collective predicates." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz309", "collective-events", "suppression"] tests=["CollectivePredicateIndexAnalyzerTests.AReasonedSuppression_EndsTheWarningAsync", "CollectivePredicateIndexAnalyzerTests.ABlankReasonOnThePerspective_DoesNotSuppressAsync"]}
[SuppressIndexAdvisory("a few hundred rows per tenant; a scan is cheaper than the index")]
public sealed class OverlayPerspective {
  // ...
}
```

On the perspective class it covers only that perspective's collective predicates. On the field, the
model or the assembly it is the same attribute that stands down [WHIZ302](whiz302.md) and the runtime
index advisory, so it covers lens filters too.

**For a whole project.** Set the MSBuild property:

```xml{title="Turning WHIZ309 off for a project" description="The Whizbang package makes this property visible to the analyzer." category="Diagnostics" difficulty="BEGINNER" tags=["whiz309", "msbuild", "configuration"] tests=["CollectivePredicateIndexAnalyzerTests.TheBuildProperty_TurnsTheWarningOffAsync"]}
<PropertyGroup>
  <WhizbangCollectiveIndexWarning>false</WhizbangCollectiveIndexWarning>
</PropertyGroup>
```

Only `false` (in any case) turns it off. The package declares the property compiler-visible, so
nothing else is needed. The standard knobs work too: `<NoWarn>WHIZ309</NoWarn>`, or
`dotnet_diagnostic.WHIZ309.severity` in an `.editorconfig`.

## Related

- [Collective Events](../../fundamentals/messaging/collective-events.md)
- [Perspective Indexes](../../fundamentals/perspectives/perspective-indexes.md)
- [Physical Fields](../../fundamentals/perspectives/physical-fields.md): `[Indexed]` and `[PhysicalField]`
- [WHIZ302](whiz302.md): lens filters no index can answer
