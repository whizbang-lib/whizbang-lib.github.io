---
title: 'WHIZ201: A perspective model holds a circular reference and cannot be saved'
pageType: troubleshooting
verifiedAgainstCommit: 4f0bb517
verifiedDate: 2026-11-08
description: >-
  Error diagnostic when a perspective model's recursive types let an element reach its own container: a collection
  plus a single reference back up the document (Node.Children with Node.Parent, Order.Lines with Line.Order). Such a
  document has no end and cannot be written.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - model-validation
  - recursion
  - circular-reference
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectiveModelCircularReferenceAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/CircularReferenceDiscovery.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveModelCircularReferenceAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/RecursiveModelRoundTripTests.cs
lastMaintainedCommit: '4f0bb517'
---

# WHIZ201: A perspective model holds a circular reference and cannot be saved

**Severity**: Error
**Category**: Model Validation (`Whizbang.ModelValidation`)

## Description

A perspective document is written whole, on both drivers. A **tree** (a type holding a collection of itself), two
types holding collections of each other, and a **linked list** (a single reference to the next of its kind) are
writable, because every instance has one container. A recursion that stores a collection **and** a single-valued
reference back up the document lets an element reach its own container, so writing the document has no end:

- `Node.Children` with `Node.Parent`;
- `Order.Lines` with `Line.Order`;
- deeper: `Order.Lines`, `Line.Detail`, `Detail.Order`.

WHIZ201 reports that back-reference as a build error, at the member to change. It does not depend on the driver: both
write the document whole.

| Behavior | Why | Verified by |
|---|---|---|
| A parent back-pointer, a mutual back-reference, a reference back to the model and a deep back-reference are errors at the back-reference. | A model whose instances can reach an ancestor cannot be saved; finding out at the first write in production is worse than at build (owner decision). | {verified: PerspectiveModelCircularReferenceAnalyzerTests.AParentBackPointer_IsAnErrorAtTheBackReferenceAsync, PerspectiveModelCircularReferenceAnalyzerTests.AMutualBackReference_IsAnErrorAsync, PerspectiveModelCircularReferenceAnalyzerTests.ABackReferenceToTheModel_IsAnErrorAsync, PerspectiveModelCircularReferenceAnalyzerTests.ADeepBackReference_IsAnErrorAsync} |
| A tree, a tree of arrays, mutual collections and a linked list are not reported. | Each instance has one container, so the document ends. | {verified: PerspectiveModelCircularReferenceAnalyzerTests.ATree_IsNotReportedAsync, PerspectiveModelCircularReferenceAnalyzerTests.ATreeOfArrays_IsNotReportedAsync, PerspectiveModelCircularReferenceAnalyzerTests.MutualCollections_AreNotReportedAsync, PerspectiveModelCircularReferenceAnalyzerTests.ALinkedListNext_IsNotReportedAsync} |
| A back-reference the document leaves out (`[JsonIgnore]`) is not judged; a collection and a reference to the same non-recursive type are ordinary members. | Only what is written can make the write endless. | {verified: PerspectiveModelCircularReferenceAnalyzerTests.ABackReferenceTheDocumentLeavesOut_IsNotReportedAsync, PerspectiveModelCircularReferenceAnalyzerTests.ACollectionAndAReferenceToTheSameNonRecursiveType_AreNotReportedAsync} |
| Reported once per property however many perspectives project the model; at the perspective when the model is another assembly's. | One error per thing to fix, at a location in this compilation. | {verified: PerspectiveModelCircularReferenceAnalyzerTests.AModelTwoPerspectivesProject_IsReportedOnceAsync, PerspectiveModelCircularReferenceAnalyzerTests.AModelFromAReferencedAssembly_IsReportedAtThePerspectiveAsync, PerspectiveModelCircularReferenceAnalyzerTests.AnInterfaceExtendingAPerspectiveInterface_IsNotAPerspectiveAsync} |
| An object cycle the analyzer cannot see fails the write with the serializer's cycle detection and stores nothing. | A cycle made of instances, not types (`Next` with `Prev`, a node placed among its own descendants), is invisible at build; the write fails loudly rather than storing a truncated document in silence. | {verified: RecursiveModelRoundTripTests.AnObjectCycleTheAnalyzerCannotSee_FailsTheWriteLoudlyAsync} |

## Diagnostic Message

```text
Property '{0}' of perspective model '{1}' refers back to '{2}', which holds it through the collection '{3}', so an instance can reach its own container and the document cannot be saved. Leave the reference out of the stored model ([JsonIgnore]) and restore it after reading, or store the container's identifier instead.
```

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{0}` | The back-reference's path from the model | `Tree.Parent` |
| `{1}` | The perspective model | `LedgerModel` |
| `{2}` | The type it refers back to | `Node` |
| `{3}` | The collection that holds it | `Tree.Children` |

## How to Fix

Choose one:

- **Leave the reference out of the stored model** with `[JsonIgnore]`, and restore it after reading (walk the tree once
  and set each child's parent).
- **Store the container's identifier** instead of the container itself (`Guid ParentId`).

### Before (causes WHIZ201)

```csharp{title="A parent back-pointer (causes WHIZ201)" description="A node that holds its children and a reference to its parent can reach its own container, so the document cannot be saved." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "WHIZ201"] tests=["PerspectiveModelCircularReferenceAnalyzerTests.AParentBackPointer_IsAnErrorAtTheBackReferenceAsync"]}
public sealed class Node {
  public List<Node>? Children { get; set; }
  public Node? Parent { get; set; }  // WHIZ201
}
```

### After (no diagnostic)

```csharp{title="The back-reference left out of the document" description="[JsonIgnore] keeps the parent out of the stored document; restore it after reading." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "WHIZ201"] tests=["PerspectiveModelCircularReferenceAnalyzerTests.ABackReferenceTheDocumentLeavesOut_IsNotReportedAsync"]}
public sealed class Node {
  public List<Node>? Children { get; set; }
  [JsonIgnore] public Node? Parent { get; set; }
}
```

## Related

- [WHIZ202](whiz202.md): a recursive type stores the model opaquely (Info)
- [Collections in read models](../../fundamentals/perspectives/perspectives.md#recursive-models)
