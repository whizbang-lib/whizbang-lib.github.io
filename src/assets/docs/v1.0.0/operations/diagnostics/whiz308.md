---
title: 'WHIZ308: Whole-document match relies on the default index'
pageType: troubleshooting
description: >-
  Info diagnostic marking a perspective filter answered by the whole-document index that a model
  keeps only because it has not declared [PerspectiveQueries(MatchOnAnyField = ...)].
version: 1.0.0
category: Diagnostics
severity: Info
order: 308
tags: 'diagnostics, perspectives, indexing, analyzer, jsonb, upgrade'
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveQueriesDiscovery.cs
  - src/Whizbang.Core/Perspectives/PerspectiveQueriesAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/DocumentMatchIndexAnalyzerTests.cs
---

# WHIZ308: Whole-document match relies on the default index

**Severity**: Info
**Category**: Perspective Validation

## Why this diagnostic exists

A model that doesn't declare `MatchOnAnyField` still gets the index over its whole document. Every
perspective had that index before the declaration existed, and removing it by default could turn a
production lookup into a full table scan (see
[the transitional default](../../fundamentals/perspectives/perspective-indexes.md#the-transitional-default-and-why-it-exists)).

This note marks each filter that depends on that default. It is informational and never fails a
build. It lists what would lose its index if the model declared `MatchOnAnyField = false`.

## Diagnostic message

```
This filter on '{Model}.{Field}' compiles to a whole-document match, answered by the index over the
whole document that '{Model}' has only because it does not declare
[PerspectiveQueries(MatchOnAnyField = ...)]. Declare MatchOnAnyField = true to keep that index as a
decision, or mark the field [Indexed] so the filter no longer needs it.
```

## What to do

```csharp{title="Settling WHIZ308" description="Either keep the whole-document index on purpose, or index the filtered fields and opt out." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz308", "perspectives", "indexing"] tests=["DocumentMatchIndexAnalyzerTests.WholeDocumentMatch_OnADeclaredModel_IsNotNotedAsync", "DocumentMatchIndexAnalyzerTests.AFilterOnADeclaredIndex_IsNotNotedAsync"]}
// Keep it: queries really do match on arbitrary fields.
[PerspectiveQueries(MatchOnAnyField = true)]
public class ShipmentModel { /* ... */ }

// Or index what is filtered and drop the large index from new databases.
[PerspectiveQueries(MatchOnAnyField = false)]
public class ShipmentModel {
  [Indexed]
  public string Carrier { get; init; } = "";
}
```

Declaring either value ends the note. `false` hands any remaining unindexed match to
[WHIZ307](whiz307.md). Opting out never drops the index from an existing database. That is an
[operator step](../../fundamentals/perspectives/perspective-indexes.md#dropping-an-index-that-is-no-longer-declared).

## Related

- [Perspective Indexes](../../fundamentals/perspectives/perspective-indexes.md)
- [WHIZ307](whiz307.md)
