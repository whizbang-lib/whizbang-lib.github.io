---
title: 'WHIZ304: Declared Index Cannot Be Reached For This Model''s Storage'
pageType: troubleshooting
description: >-
  Warning diagnostic when a perspective model declares a JSON index but holds a polymorphic member,
  so its document is stored as one serialized value and no query against it reaches the index.
version: 1.0.0
category: Diagnostics
severity: Warning
order: 304
tags: 'diagnostics, perspectives, indexing, jsonb, polymorphic, analyzer'
codeReferences:
  - src/Whizbang.Generators/Analyzers/JsonIndexDeclarationAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PolymorphicModelDiscovery.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Core/Perspectives/JsonIndexedAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/JsonIndexStorageAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/JsonIndexGenerationTests.cs
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorCoverageTests.cs
---

# WHIZ304: Declared Index Cannot Be Reached For This Model's Storage

```text{title="The message" description="Reported once on the model, naming the member that forces the storage." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "indexing"]}
'OrderModel' declares an index over its JSON, but the model holds a polymorphic member
(Payment is TestApp.PaymentMethod), so its document is stored as one serialized value rather than as
mapped properties. A filter on a field inside it never compiles to the extraction the index is built
over, so the index would be maintained on every write and scanned by nothing. Promote the fields you
filter on with [PhysicalField(Indexed = true)] to get real indexed columns, or remove the declaration.
```

## Why

A perspective model is normally mapped **property by property** into its `data` column. A filter then
compiles to an extraction, `(data ->> 'Rank')::integer`, and an index built over exactly that
expression answers it.

A model that holds an abstract member, or one marked `[JsonPolymorphic]`, cannot be mapped that way.
Property-by-property mapping reconstructs the *declared* type on the way back, which would lose the
derived type the field was actually given. So the whole document is stored as **one serialized value**
instead, where the serializer writes a type discriminator alongside the data.

Nothing inside that value is a mapped property. There is no extraction for an index to be built over,
nothing for the containment rewrite to recognize, and nowhere to attach a value conversion. An index
declared over such a document would be rebuilt on every write and scanned by nothing.

{verified: JsonIndexStorageAnalyzerTests.AnIndexOnAnOpaquelyStoredModelIsReportedAsync}

## Why it is reported rather than skipped

The index **is** skipped. The generator does not emit it, because emitting it would be the same waste
`[JsonIndexed]` exists to remove: cost on every write, no read it can serve.

Skipping alone would be the worse half of the trade. Nothing would surface it, and you would be left
believing the fields are indexed while every query on them reads the whole table. That is the more
expensive mistake precisely because it is quiet, so the skip is paired with this warning.

{verified: JsonIndexGenerationTests.AnOpaquelyStoredModelGetsNoIndexOverItsDocumentAsync}

Unlike [WHIZ303](whiz303.md), a blanket `[IndexAllFields]` **is** reported here. The two differ for a
reason: there, the blanket claims nothing about the single field it cannot cover and the rest of the
model is still indexed, so naming each skip would be noise. Here no field on the model can be indexed
at all, so the blanket is a claim that fails completely rather than one that mostly holds.

{verified: JsonIndexStorageAnalyzerTests.ABlanketDeclarationOnAnOpaquelyStoredModelIsReportedAsync}

## A model that declares no index is not reported

Storing a hierarchy as one serialized value is a modeling decision, not a defect. Only an index
declared over it is a claim that cannot be met, so a polymorphic model that asks for nothing is left
alone.

{verified: JsonIndexStorageAnalyzerTests.AnOpaquelyStoredModelThatDeclaresNoIndexIsNotReportedAsync}

## How to fix

**Promote the fields you actually filter on.** A promoted field is a real column with a real index,
and it stays reachable no matter how the rest of the document is stored. This is the answer for a
polymorphic model, not a workaround for one.

```csharp{title="Promoting the filtered fields of a polymorphic model" description="A real column is reachable whatever the rest of the document does, which is what makes it the answer for a model stored as one serialized value." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "physical-fields", "indexing", "polymorphic"] tests=["JsonIndexStorageAnalyzerTests.AnIndexOnAnOpaquelyStoredModelIsReportedAsync"]}
public record OrderModel {
  [StreamId]
  public Guid OrderId { get; init; }

  // This is what forces the whole document into a single serialized value.
  public PaymentMethod? Payment { get; init; }

  // Was [JsonIndexed], which nothing could reach. A column can be.
  [PhysicalField(Indexed = true)]
  public string Reference { get; init; } = string.Empty;
}
```

**Or reshape the model so it is not polymorphic.** If the hierarchy is not doing real work, replacing
the abstract member with a concrete type returns the whole model to property-by-property mapping, and
every `[JsonIndexed]` on it starts working.

## What does *not* trigger this

An ordinary `record` does not. Records are classified on the properties their author declared, exactly
as classes are.

```csharp{title="An ordinary record is indexed normally" description="A record of simple properties is mapped property by property like any other model, so its declared indexes are reachable." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "indexing", "records"] tests=["JsonIndexGenerationTests.AnOrdinaryRecordStillGetsItsIndexAsync"]}
public record OrderModel {
  [StreamId]
  public Guid OrderId { get; init; }

  [JsonIndexed]
  public int Rank { get; init; }
}
```

{verified: JsonIndexStorageAnalyzerTests.AnOrdinaryRecordIsNotReportedAsync, EFCorePerspectiveConfigurationGeneratorCoverageTests.AModelOfSimplePropertiesUsesStandardConfigAsync}

This is worth stating because it was once false. A record carries a compiler-generated
`EqualityContract` property of type `System.Type`, and `System.Type` is an abstract class, so a
detector that read it as a declared property answered "polymorphic" on the first member of every
record. Detection now considers only **public** properties, which is the rule both the mapped path and
the serializer already follow: a protected member reaches neither, so it cannot decide how the
document is stored.

## Suppressing

There is no suppression attribute, for the same reason as WHIZ303: the declaration itself is the thing
to remove. Silencing a message about an index that is not created leaves you with neither the index
nor the warning.

## See Also

- [WHIZ303: Declared Index Cannot Be Built For This Field's Type](whiz303.md)
- [WHIZ302: Filtered Perspective Field Has No Index](whiz302.md)
- [Physical Fields](../../fundamentals/perspectives/physical-fields.md#json-indexed)
- [Perspective Query Pipeline](../../../contributors/perspective-query-pipeline.md)
