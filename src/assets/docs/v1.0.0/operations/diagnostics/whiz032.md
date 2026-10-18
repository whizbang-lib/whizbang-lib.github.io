---
title: 'WHIZ032: Perspective Name Collision'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when two or more perspective classes resolve to the same name, which would produce duplicate
  entries in the generated perspective runner registry.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - perspective-runner
  - registry
  - naming
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveRunnerRegistryGenerator.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ032: Perspective Name Collision

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

The perspective runner registry looks up each perspective's runner by the perspective's name, and the runner class is
named after it too. That name is the class name without its namespace. For a nested class it is the containing
type's name plus the class name (`OrderStatus.Projection`).

When two perspective classes in the same project resolve to the same name, for example two classes called
`DuplicatePerspective` in different namespaces, the registry would contain duplicate switch cases. The generator
reports WHIZ032 for each colliding name, lists the fully qualified classes involved, and then generates **no registry
at all**, so none of the project's perspectives can be looked up until the collision is resolved.

The check considers non-abstract classes implementing `IPerspectiveBase<TModel, ...>` (which `IPerspectiveFor` and
`IPerspectiveWithActionsFor` extend) or `IGlobalPerspectiveFor<TModel, TPartitionKey, ...>` whose model declares a
`[StreamId]` property. The diagnostic has no source location; the message names the classes.

## Diagnostic Message

```text
Multiple perspectives found with name '{PerspectiveName}': {FullyQualifiedClassNames}. Use unique class names.
```

## Common Causes

1. **Same class name in two namespaces.** Namespaces do not separate perspectives; only the class name counts.
2. **Copying a perspective** into another folder or feature area and keeping its name.
3. **Nested perspectives with the same nested name inside containing types that also share a name** (only the
   immediate containing type is part of the name).

## How to Fix

Rename one of the colliding classes so every perspective in the project has a distinct name. Moving a class to a
different namespace is not enough.

Nesting is another way to keep a short class name: `OrderStatus.Projection` and `ActiveJobStatus.Projection` resolve
to different names and do not collide.

### Before (causes WHIZ032)

```csharp{
title: "Two perspectives with the same class name"
description: "DuplicatePerspective exists in two namespaces, so the registry generator reports WHIZ032"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives", "Naming"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs"
testMethod: "Generator_WithDuplicateNames_EmitsCollisionErrorAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs"
tests: ["PerspectiveRunnerRegistryGeneratorTests.Generator_WithDuplicateNames_EmitsCollisionErrorAsync"]
}
namespace TestNamespace {
  public record Event1 : IEvent {
    [StreamId]
    public string Id { get; init; } = "";
  }

  public record Event2 : IEvent {
    [StreamId]
    public string Id { get; init; } = "";
  }

  public record Model1 {
    [StreamId]
    public string Id { get; init; } = "";
  }

  public record Model2 {
    [StreamId]
    public string Id { get; init; } = "";
  }

  // Two top-level classes with same name - should cause collision
  public class DuplicatePerspective : IPerspectiveFor<Model1, Event1> {
    public Model1 Apply(Model1 currentData, Event1 @event) {
      return currentData;
    }
  }
}

namespace OtherNamespace {
  // Same name in different namespace - should cause collision
  public class DuplicatePerspective : IPerspectiveFor<TestNamespace.Model2, TestNamespace.Event2> {
    public TestNamespace.Model2 Apply(TestNamespace.Model2 currentData, TestNamespace.Event2 @event) {
      return currentData;
    }
  }
}
```

### After (no collision)

```csharp{
title: "Nested perspectives with distinct names"
description: "OrderStatus.Projection and ActiveJobStatus.Projection resolve to different names, so no WHIZ032"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives", "Naming"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs"
testMethod: "Generator_WithMultipleNestedPerspectives_SameParentClassName_UsesDistinctNamesAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerRegistryGeneratorTests.cs"
tests: ["PerspectiveRunnerRegistryGeneratorTests.Generator_WithMultipleNestedPerspectives_SameParentClassName_UsesDistinctNamesAsync"]
}
  public class OrderStatus {
    public class Projection : IPerspectiveFor<Model1, Event1> {
      public Model1 Apply(Model1 currentData, Event1 @event) {
        return currentData;
      }
    }
  }

  public class ActiveJobStatus {
    public class Projection : IPerspectiveFor<Model2, Event2> {
      public Model2 Apply(Model2 currentData, Event2 @event) {
        return currentData;
      }
    }
  }
```

Renaming one of the two `DuplicatePerspective` classes in the first sample (for example to
`OtherDuplicatePerspective`) resolves it the same way.

## Related

- [WHIZ028: Perspective Runner Registry Generated](whiz028)
- [WHIZ027: Perspective Runner Generated](whiz027)
- [Perspective Worker](../workers/perspective-worker)
- [Perspective Discovery](../../extending/source-generators/perspective-discovery)
