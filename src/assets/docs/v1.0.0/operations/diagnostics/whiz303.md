---
title: 'WHIZ303: Declared Index Cannot Be Built For This Field''s Type'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective field declares [JsonIndexed] but its stored form cannot carry
  an index, because the cast out of the JSON document is not immutable.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 303
tags: 'diagnostics, perspectives, indexing, jsonb, analyzer, physical-fields'
codeReferences:
  - src/Whizbang.Generators/Analyzers/JsonIndexDeclarationAnalyzer.cs
  - src/Whizbang.Core/Perspectives/JsonIndexedAttribute.cs
  - src/Whizbang.Generators.Shared/Models/JsonIndexDiscovery.cs
  - src/Whizbang.Generators.Shared/Models/JsonIndexInfo.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexDeclarationAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/ContainmentTypeEligibilityProbeTests.cs
---

# WHIZ303: Declared Index Cannot Be Built For This Field's Type

```text{title="The message" description="Reported on the property that declares the index." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "indexing"]}
'OccurredAt' declares [JsonIndexed], but a System.DateTime held in the model's JSON cannot carry an
index: the cast out of the document is not immutable, so PostgreSQL will not index it. Promote it
with [PhysicalField(Indexed = true)] to get a real indexed column, or remove the declaration to
leave the field unindexed.
```

## Why

An index over a value stored in a JSON document is built from a cast out of that document, and an
index expression has to be **immutable**: PostgreSQL has to be certain the key it stored stays correct
for the life of the row. A stable expression may depend on a session setting, so an index over one
could silently go stale, and PostgreSQL refuses to create it rather than allow that.

The cast is immutable for text, the integer family, numerics, booleans and identifiers. It is stable
for a timestamp, a date and a time, which is why those are the types this reports.

{verified: ContainmentTypeEligibilityProbeTests.AnExtractionCanCarryABtreeIndexOnlyWhenItsCastIsImmutableAsync}

## Why it is reported rather than skipped

Both silent options are worse than a warning.

Emitting the index anyway moves the failure to startup, where the schema pass fails with a PostgreSQL
error that names no property and leaves you to work out which field caused it.

Skipping it quietly is worse still, because nothing ever surfaces it: you would be left believing the
field is indexed while every query on it reads the whole table. A declaration on a specific property
is a claim about that property, so being unable to honor it is worth saying out loud.

A blanket `[IndexAllFields]` on the model is deliberately **not** reported for the fields it cannot
cover. It is not a claim about any one field, so naming each skip would be noise.

{verified: JsonIndexDeclarationAnalyzerTests.ATypeThatCannotCarryAnIndex_IsReportedAsync, JsonIndexDeclarationAnalyzerTests.ABlanketDeclarationIsNotReportedAsync}

## How to fix

**If you filter or sort on the field, promote it to a column.** That is the option available today
for a date, and it gives you a real `timestamptz` with a btree index.

```csharp{title="Promoting a date that is range-filtered" description="A real column is the available answer for a date that has to be range-filtered or sorted." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "indexing"] tests=["JsonIndexDeclarationAnalyzerTests.ATypeThatCannotCarryAnIndex_IsReportedAsync"]}
public record OrderModel {
  [StreamId]
  public Guid OrderId { get; init; }

  // Was [JsonIndexed], which cannot be built for a date.
  [PhysicalField(Indexed = true)]
  public DateTime OccurredAt { get; init; }
}
```

**If you only compare it for equality, remove the declaration.** Equality on a date held in the
document is already answered from the GIN index as a containment test, so it needs nothing. See
[JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md#dates).

## Which types this reports

`DateTime`, `DateTimeOffset`, `DateOnly`, `TimeOnly` and `TimeSpan`. Everything else the framework
stores in a document can carry an index; see
[the type table](../../fundamentals/perspectives/physical-fields.md#json-indexed).

An enumeration is **not** reported, because it is stored as its underlying number and indexed as that
number's type. A nullable value is not reported either, for the same reason: it is stored and
extracted as its underlying type, and a null simply has no entry.

{verified: JsonIndexDeclarationAnalyzerTests.AnIndexableType_IsNotReportedAsync, JsonIndexDeclarationAnalyzerTests.AnEnumerationIsNotReportedAsync}

## Suppressing

There is no suppression attribute for this one, on purpose: the declaration itself is the thing to
remove. If you want the field unindexed, delete the attribute and the warning goes with it. If you
want it indexed, promote it. Neither outcome is served by silencing a message about an index that does
not exist.

## See Also

- [Physical Fields](../../fundamentals/perspectives/physical-fields.md#json-indexed)
- [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment.md)
- [WHIZ302: Filtered Perspective Field Has No Index](whiz302.md)
