---
title: 'WHIZ308: Whole-document match has no index by default'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective filter compiles to a whole-document match on a model that
  doesn't declare [PerspectiveQueries(MatchOnAnyField = ...)], so the index that answers it isn't
  built. Says how to opt in.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 308
tags: 'diagnostics, perspectives, indexing, analyzer, jsonb, upgrade'
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Generators/Analyzers/QueryExposureIndexAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveQueriesDiscovery.cs
  - src/Whizbang.Core/Perspectives/PerspectiveQueriesAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/DocumentMatchIndexAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/QueryExposureDocumentMatchTests.cs
---

# WHIZ308: Whole-document match has no index by default

**Severity**: Warning
**Category**: Perspective Validation

## Why this diagnostic exists

An equality or set filter on a field with no index of its own compiles to a whole-document match
(see [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md)), and only the
index over the whole document answers it.

**That index is off unless the model asks for it.** It's the largest index on a perspective table,
and every change to the document rewrites its entries, so the schema builds it only for a model that
declares `[PerspectiveQueries(MatchOnAnyField = true)]`. Earlier releases built it for every model.
A database those releases created keeps the index, but a new database doesn't get it, and there the
filter reads every row (see
[Upgrading to 1.0](../../fundamentals/perspectives/perspective-indexes.md#upgrading-to-1-0)).

This warning marks each filter that needs the index on a model that hasn't declared either way.
[WHIZ307](whiz307.md) reports the same filter on a model that declared `false`. They are separate
because the fix differs: nothing was decided here, so opting in is as good an answer as indexing the
field.

## Diagnostic message

```
This filter on '{Model}.{Field}' compiles to a whole-document match, and the index over the whole
document is not built for '{Model}', which does not declare [PerspectiveQueries(MatchOnAnyField = ...)],
so the database reads every row of the perspective. Declare [PerspectiveQueries(MatchOnAnyField = true)]
to build that index, mark the field [Indexed] for an index of its own, or record the decision with
[SuppressIndexAdvisory("reason")].
```

On a lens or resolver that lets the request compose filters (for example `[UseFiltering]`), the
message starts `An equality or 'in' filter a request composes on '{Model}' ({Fields})` and names every
field that still has no index of its own.

## What to do

```csharp{title="Settling WHIZ308" description="Opt in to the whole-document index, or index the filtered fields and opt out." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz308", "perspectives", "indexing"] tests=["DocumentMatchIndexAnalyzerTests.WholeDocumentMatch_OnAnUndeclaredModel_WarnsWithTheOptInAsync", "DocumentMatchIndexAnalyzerTests.WholeDocumentMatch_OnADeclaredModel_IsNotReportedAsync", "DocumentMatchIndexAnalyzerTests.AFilterOnADeclaredIndex_IsNotReportedAsync"]}
// Opt in: queries really do match on arbitrary fields.
[PerspectiveQueries(MatchOnAnyField = true)]
public class ShipmentModel { /* ... */ }

// Or index what is filtered, and say the large index isn't wanted.
[PerspectiveQueries(MatchOnAnyField = false)]
public class ShipmentModel {
  [Indexed]
  public string Carrier { get; init; } = "";
}
```

- **Opt in** when the model's filters can be on any field, such as filters a GraphQL or REST lens
  composes from the request.
- **Index the field** when the filters are on a few known fields. A field index is much smaller, and
  it answers ranges and ordering too.
- **Record a scan** with `[SuppressIndexAdvisory("reason")]` on a table that stays small.

Declaring either value of `MatchOnAnyField` ends this warning. `false` hands any remaining unindexed
match to [WHIZ307](whiz307.md).

## Related

- [Perspective Indexes](../../fundamentals/perspectives/perspective-indexes.md)
- [WHIZ307](whiz307.md): the same match on a model that opted out
- [WHIZ309](whiz309.md): a collective predicate on an unindexed field
