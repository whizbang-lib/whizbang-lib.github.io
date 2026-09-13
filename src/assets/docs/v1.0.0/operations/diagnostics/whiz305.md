---
title: 'WHIZ305: Declared Index Capability Does Not Apply To This Field''s Type'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective field asks for substring matching or case folding, both of
  which only apply to text, on a field of some other type.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 305
tags: 'diagnostics, perspectives, indexing, jsonb, analyzer, case-insensitive'
codeReferences:
  - src/Whizbang.Generators/Analyzers/JsonIndexDeclarationAnalyzer.cs
  - src/Whizbang.Core/Perspectives/IndexedAttribute.cs
  - src/Whizbang.Generators.Shared/Models/JsonIndexDiscovery.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexDeclarationAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/JsonIndexGenerationTests.cs
---

# WHIZ305: Declared Index Capability Does Not Apply To This Field's Type

```text{title="The message" description="Reported on the property that declares the capability." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "indexing"]}
'Count' asks for substring matching, which only applies to text, and Count is a int. That part
of the declaration is dropped, so the index is not the one asked for. Use [Indexed] on its own
for equality, ranges, ordering and null tests, which is what this type can be indexed for.
```

## Why

Two of the things a declaration can ask for are properties of text and mean nothing for anything
else.

`IndexKinds.Substring` asks for an index built for pattern matching rather than for ordering. There
is no pattern to match in a number, a boolean, an identifier or a date.

`caseInsensitive: true` changes the expression the index is built over, wrapping it in the database's
downward fold. There is no case to fold in any of those either, and folding an extraction before
casting it to a number would index a different value than any query produces.

Both are dropped for such a field, which is the right thing to build. Saying so is the point of this
diagnostic: the declaration reads as a claim either way, and the fix is a one-word edit.

{verified: JsonIndexDeclarationAnalyzerTests.ACapabilityThatOnlyAppliesToText_IsReportedAsync}

## Why it is reported rather than dropped in silence

Because a field asking *only* for a capability it cannot have used to get no index at all. The
author asked for something and the answer was nothing, with the attribute still sitting on the
property reading like a claim that it was indexed. Every query on the field scanned.

That is the same failure `[Indexed]` exists to remove, reached from the other direction, and nothing
surfaced it.

The capability the field *can* carry is still built. A declaration of
`[Indexed(IndexKinds.Substring)]` on a number still gets an ordered index, because dropping the
whole declaration over one wrong word would turn a mistake into no index at all.

{verified: JsonIndexGenerationTests.CaseFoldingIsDroppedForAFieldThatIsNotTextAsync, JsonIndexDeclarationAnalyzerTests.ACapabilityThatApplies_IsNotReportedAsync}

## How to fix

Drop the part that does not apply. What remains is the index the field can carry:

```csharp{title="Asking only for what the type can answer" description="Substring matching and case folding apply to text; every other stored scalar is indexed for equality, ranges, ordering and null tests." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "indexing", "diagnostics"] tests=["JsonIndexDeclarationAnalyzerTests.ACapabilityThatApplies_IsNotReportedAsync"]}
public record ReportModel {
  [StreamId]
  public Guid ReportId { get; init; }

  // Was [Indexed(IndexKinds.Substring)]: there is no substring in a number.
  [Indexed]
  public int Count { get; init; }

  // Was [Indexed(caseInsensitive: true)]: there is no case in a date.
  [Indexed]
  public DateTime OccurredAt { get; init; }

  // Text, so both apply, and both are built.
  [Indexed(IndexKinds.Ordered | IndexKinds.Substring)]
  [Indexed(caseInsensitive: true)]
  public string Label { get; init; } = string.Empty;
}
```

If the field really is searched by substring, the value is text and the property should be typed that
way. A number formatted into a string to be searched is a modeling decision, not an indexing one.

## Not the same as WHIZ303

They report different problems and have different fixes, so only one of them speaks about any given
field.

[WHIZ303](whiz303.md) means **no index of any kind** can be built over the field: the fix is to
promote it to a column or remove the declaration. WHIZ305 means an index **can** be built and the
capability named is the wrong one: the fix is to change the capability. A field that can carry no
index is reported only by WHIZ303, because offering a capability to change as well would suggest an
edit that leaves the field still unindexable.

{verified: JsonIndexDeclarationAnalyzerTests.AFieldThatCanCarryNoIndexIsNotAlsoToldAboutTheCapabilityAsync}

## Suppressing

There is no suppression attribute, for the same reason as WHIZ303: the declaration is the thing to
edit. Silencing a message about a capability that was never built leaves the wrong word in place for
the next reader.

## See Also

- [Physical Fields](../../fundamentals/perspectives/physical-fields.md#json-indexed)
- [Comparisons that ignore case](../../fundamentals/perspectives/physical-fields.md#case-insensitive)
- [WHIZ302: Filtered Perspective Field Has No Index](whiz302.md)
- [WHIZ303: Declared Index Cannot Be Built For This Field's Type](whiz303.md)
- [WHIZ304: Declared Index Cannot Be Reached For This Model's Storage](whiz304.md)
