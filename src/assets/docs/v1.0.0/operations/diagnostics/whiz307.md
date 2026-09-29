---
title: 'WHIZ307: Whole-document match has no index'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective filter compiles to a whole-document match that the model's
  [PerspectiveQueries] declaration leaves without an index.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 307
tags: 'diagnostics, perspectives, indexing, analyzer, jsonb'
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFilterIndexAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PerspectiveQueriesDiscovery.cs
  - src/Whizbang.Core/Perspectives/PerspectiveQueriesAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/DocumentMatchIndexAnalyzerTests.cs
---

# WHIZ307: Whole-document match has no index

**Severity**: Warning
**Category**: Perspective Validation

## Why this diagnostic exists

An equality filter on a perspective field that has no index of its own is compiled into a
whole-document match (see [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md)).
Only an index over the whole document answers it, and
[`[PerspectiveQueries]`](../../fundamentals/perspectives/perspective-indexes.md) on the model decides
whether the schema builds that index.

When the declaration leaves the match without an index, the query still returns the right rows. It
just reads every row to find them, which is invisible on a development table and expensive on a
production one. This warning surfaces that at build time.

## Diagnostic message

```
This filter on '{Model}.{Field}' compiles to a whole-document match that no index answers, because
'{Model}' declares [PerspectiveQueries(MatchOnAnyField = false)], so the database reads every row of
the perspective. Mark the field [Indexed] for an index of its own, declare MatchOnAnyField = true,
or record the decision with [SuppressIndexAdvisory("reason")].
```

For a match on the row's metadata, the field reads `Metadata.{Field}` and the reason is that the
model does not declare `MatchOnMetadata = true`.

## When it fires

```csharp{title="Filters WHIZ307 reports" description="An unindexed field on a model that opted out, and a metadata match without the metadata opt-in." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz307", "perspectives", "indexing"] tests=["DocumentMatchIndexAnalyzerTests.WholeDocumentMatch_OnAModelThatOptedOut_WarnsAsync", "DocumentMatchIndexAnalyzerTests.MetadataMatch_WithoutTheOptIn_WarnsAsync"]}
[PerspectiveQueries(MatchOnAnyField = false)]
public class ShipmentModel {
  public string Carrier { get; init; } = "";   // no index of its own
}

rows.Where(r => r.Data.Carrier == "acme");            // WHIZ307: nothing answers this
rows.Where(r => r.Metadata.EventType == "Shipped");   // WHIZ307: metadata index is off
```

It does **not** fire when:

- the field has an index of its own (`[Indexed]`, or `[PhysicalField]` with `[Indexed]` or
  `Unique`), because the filter uses that index;
- the model declares the lookup (`MatchOnAnyField = true`, or `MatchOnMetadata = true` for
  metadata);
- the filter isn't a whole-document match at all: ranges, ordering, `!=`, comparisons with `null`,
  and pattern matching. [WHIZ302](whiz302.md) covers those;
- the member is only projected (`Select`) rather than filtered on;
- the field, the model or the assembly carries `[SuppressIndexAdvisory("reason")]` with a reason.

## How to fix it

Pick the one that matches what the query needs:

1. **Index the field.** `[Indexed]` builds a small index over just that field, and it answers ranges
   and ordering too. This is usually the right answer after opting out.
2. **Declare the lookup.** `MatchOnAnyField = true` or `MatchOnMetadata = true` builds the
   whole-document index back.
3. **Record the scan as a decision.** On a table that stays small, a scan is fine:
   `[SuppressIndexAdvisory("at most a few hundred rows per tenant")]`. A blank reason doesn't
   suppress.

## Related

- [Perspective Indexes](../../fundamentals/perspectives/perspective-indexes.md)
- [WHIZ308](whiz308.md): a match that relies on the transitional default
- [WHIZ302](whiz302.md): filters no index can answer
