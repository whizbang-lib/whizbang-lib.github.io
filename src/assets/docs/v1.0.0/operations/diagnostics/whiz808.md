---
title: 'WHIZ808: Split Class Model Cannot Be Copied'
pageType: troubleshooting
description: >-
  Error when a Split class model has an init-only promoted field and cannot be
  copied, which the runner needs to strip and load that field
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - physical-field
  - split-mode
  - perspectives
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Generators.Shared/Models/ModelCopy.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerSplitInitOnlyTests.cs
---

# WHIZ808: Split Class Model Cannot Be Copied

**Severity**: Error
**Category**: Physical Field Discovery

## Description

A [Split](../../fundamentals/perspectives/physical-fields.md#split-mode) model keeps its promoted fields
only in their columns. The runner clears them from the model before it writes the document, and copies
the columns back into a model it loads. A record does both with a `with` expression, and a settable
property of a class is assigned in place. A class can set an `init`-only property only while an instance
is created, so for a Split class with an `init`-only promoted field the runner makes a copy: a new
instance from the class's parameterless constructor, with every public property that has a setter
carried over.

This error says the class cannot be copied that way, so the field could be neither cleared nor loaded.

## Diagnostic Message

```
The Split model App.TicketModel has an init-only promoted field, which the runner strips and loads through a copy, and App.TicketModel cannot be copied: Tags is a get-only property that stores a value, which a copy cannot carry. Make the model a record, make the promoted field settable, or make the class copyable.
```

The reason is one of:

| Reason | Why the copy would lose something |
|---|---|
| it has no public or internal parameterless constructor | The copy is created with `new TModel { ... }`. |
| it is abstract | An abstract class cannot be created. |
| the setter of `X` is not public or internal | A `private set` (or `protected set`) value cannot be carried into the copy. |
| `X` is a get-only property that stores a value | An auto-property with only a getter, such as `List<string> Tags { get; } = new();`, cannot be set on the copy. |

A get-only property with no stored value (`public string Display => ...`) is computed, so the copy does
not need it.

## How to Fix

{verified: PerspectiveRunnerSplitInitOnlyTests.AnUncopyableSplitClass_IsWHIZ808Async, PerspectiveRunnerSplitInitOnlyTests.ASplitClassWithAnInitOnlyPromotedField_IsStrippedIntoACopyAsync}

Any one of these:

- **Make the model a record.** A record is stripped and loaded with `with` expressions.
- **Make the promoted field settable** (`{ get; set; }`). The class is then cleared in place.
- **Make the class copyable**: give it a public or internal parameterless constructor, and give every
  property that holds state a public or internal `set` or `init`.

```csharp{title="A copyable Split class" description="An init-only promoted field on a class the runner can copy: a parameterless constructor, and every stored property settable or init." framework="NET10" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Split", "PhysicalField"] tests=["PerspectiveRunnerSplitInitOnlyTests.ASplitClassWithAnInitOnlyPromotedField_IsStrippedIntoACopyAsync"]}
[PerspectiveStorage(FieldStorageMode.Split)]
public class TicketModel {
  [StreamId]
  public Guid Id { get; set; }

  [PhysicalField]
  public string Status { get; init; } = "";

  // Was: public List<string> Tags { get; } = new();
  public List<string> Tags { get; init; } = new();

  // Computed: not carried, and not a problem.
  public string Display => Status;
}
```

## Related Diagnostics

- [WHIZ807](whiz807.md) - Physical fields discovered
- WHIZ805 - Split mode with no physical fields
