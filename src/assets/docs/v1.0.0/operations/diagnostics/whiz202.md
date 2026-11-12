---
title: 'WHIZ202: A recursive type stores the perspective model as one opaque document'
pageType: troubleshooting
verifiedAgainstCommit: 4f0bb517
verifiedDate: 2026-11-08
description: >-
  Info diagnostic when a perspective model holds a recursive type (a tree node holding its children, or two types
  holding each other). On the Entity Framework driver such a model is stored as one opaque document, so every level
  round-trips but none of its fields can be indexed. There is nothing to change.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - model-validation
  - ef-core
  - recursion
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectiveModelArrayAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/MappedPathDiscovery.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/MappedPathDiscoveryRecursionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/RecursiveModelRoundTripTests.cs
lastMaintainedCommit: '4f0bb517'
---

# WHIZ202: A recursive type stores the perspective model as one opaque document

**Severity**: Info
**Category**: Model Validation (`Whizbang.ModelValidation`)

## Description

A **recursive type** is one that holds itself, at any depth: a tree node with `List<Node> Children`, `IList<Node>`,
`ImmutableList<Node>` or `Node[]`, or two types holding each other. Entity Framework maps a recursive complex type one
level deep: on the mapped path every level below the first self-reference was dropped on write and read back as null,
with no error at model build, save or query.

So the generator stores a perspective model that holds a recursive type as **one opaque document**, the form an
array of records already takes. The whole tree round-trips at any depth. The cost is the opaque form's: nothing inside
the model is a mapped property, so none of its fields can be indexed, and declared indexes on it are skipped
([WHIZ304](whiz304.md) and the index advisory [WHIZ302](whiz302.md) name the member as recursive, with that reason).

WHIZ202 reports the recursive property so the loss of indexing is explained rather than a surprise. It is Info, not a
warning: the model is stored correctly and there is nothing to change. See
[Collections in read models](../../fundamentals/perspectives/perspectives.md#recursive-models).

| Behavior | Why | Verified by |
|---|---|---|
| A collection of itself in any shape (`List<T>`, `IList<T>`, `ImmutableList<T>`) is reported as recursive. | The mapped path keeps only the first level of a recursive type in every collection shape, so the model is opaque whichever is declared. | {verified: PerspectiveModelArrayAnalyzerTests.ACollectionOfItself_IsReportedAsRecursiveAsync, MappedPathDiscoveryRecursionTests.ARecursiveModel_MustBeStoredOpaquelyAsync} |
| An array of itself, or an array of a type that is recursive further down, is reported as WHIZ202, without WHIZ200's advice to switch to `List<T>`. | That advice is what turned a whole opaque tree into a truncated mapped one: a `List<T>` of a recursive type would be opaque too. | {verified: PerspectiveModelArrayAnalyzerTests.AnArrayOfItself_IsReportedAsRecursive_WithoutTheListAdviceAsync, PerspectiveModelArrayAnalyzerTests.AnArrayOfARecursiveType_IsReportedAsRecursiveAsync} |
| Reported at the property that closes the cycle, by its full path, once however many perspectives project the model. | The property is what an author reads and what a suppression applies to. | {verified: MappedPathDiscoveryRecursionTests.RecursiveMembers_ListsEachPropertyThatClosesACycleAsync, MappedPathDiscoveryRecursionTests.RecursionBelowANestedObject_IsNamedByItsFullPathAsync, MappedPathDiscoveryRecursionTests.MutualRecursion_IsNamedWhereThePathReturnsAsync, PerspectiveModelArrayAnalyzerTests.ARecursiveModelTwoPerspectivesProject_IsReportedOnceAsync} |
| A type reached twice without recursion is not recursive, and stays mapped. | Two members of the same record type are ordinary members; storing them opaquely would cost indexing for nothing. | {verified: MappedPathDiscoveryRecursionTests.ATypeReachedTwice_IsNotRecursionAsync, MappedPathDiscoveryRecursionTests.MembersWithNothingRecursiveBelowThem_AreNotListedAsync} |
| Info severity. | A build that treats warnings as errors must not break for a model that is stored correctly (owner decision). | {verified: PerspectiveModelArrayAnalyzerTests.AnArrayOfItself_IsReportedAsRecursive_WithoutTheListAdviceAsync} |

## Diagnostic Message

```text
Property '{0}' of perspective model '{1}' holds '{2}', which is recursive (a type in it holds itself), so the model is stored as one opaque document and none of its fields can be indexed. Keep it opaque: the mapped path would store only the first level of a recursive type, in any collection shape, and drop the rest.
```

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{0}` | The property's path from the model | `Skeleton.Children` |
| `{1}` | The perspective model | `LedgerModel` |
| `{2}` | The recursive type as declared | `Node[]` |

## Example

```csharp{title="A tree on a perspective model (reports WHIZ202)" description="A node holding a collection of itself stores the model as one opaque document; every level round-trips." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "EF Core", "WHIZ202"] tests=["PerspectiveModelArrayAnalyzerTests.ACollectionOfItself_IsReportedAsRecursiveAsync", "RecursiveModelRoundTripTests.AListOfItself_ReadsBackEveryLevelAsync"]}
public sealed record Node {
  public string Label { get; init; } = "";
  public List<Node>? Children { get; init; }  // WHIZ202 (Info)
}

public class LedgerModel {
  [StreamId] public Guid Id { get; set; }
  public Node? Tree { get; set; }
}
```

## What to do

Nothing: the model is stored correctly. If you need a field of the tree indexed, project that field to a
non-recursive member of the model (a flattened list of labels, for example) as well.

A recursive type that can point **back up** the document (a node with both `Children` and `Parent`) cannot be saved at
all; that is [WHIZ201](whiz201.md), an error.

**Upgrading:** rows an earlier release wrote on the mapped path hold only the first level of each recursive member.
Rebuild those perspectives; the startup log names them. See
[Recursive models after an upgrade](../../fundamentals/perspectives/rebuild#recursive-models-after-upgrade).

## Turning it off

WHIZ202 is reported by the same analyzer as [WHIZ200](whiz200.md) and under the same switch:
`WhizbangOpaqueArrayWarning=false` turns both off for a project. To turn off only WHIZ202 for one property, suppress it
there with a pragma or a `SuppressMessage`, as for [WHIZ200](whiz200.md#suppressing). Like WHIZ200, it is reported
only in a project that references `Whizbang.Data.EFCore.Postgres`.
{verified: PerspectiveModelArrayAnalyzerTests.TheBuildProperty_TurnsTheRecursiveReportOffAsync}

## Related

- [WHIZ201](whiz201.md): a circular reference cannot be saved
- [WHIZ200](whiz200.md): an array of records stores the model opaquely
- [Collections in read models](../../fundamentals/perspectives/perspectives.md#model-collections)
- [Perspective rebuild](../../fundamentals/perspectives/rebuild#recursive-models-after-upgrade)
