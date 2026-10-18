---
title: 'WHIZ072: Polymorphic Base Type Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported for each base class or interface the message JSON context generator will serialize
  polymorphically, with the number of derived types registered for it.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - json
  - serialization
  - polymorphism
  - inheritance
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ072: Polymorphic Base Type Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

When a message, or a property of a message, is typed as a base class or interface, the JSON serializer has to know
every concrete type that can appear there. The message JSON context generator works this out from inheritance and
registers the derived types for polymorphic serialization automatically. For each base type it registers, it reports
WHIZ072 with the base type's name and the number of derived types.

How base types are found:

- For each discovered message type, the generator walks its base class chain (stopping at `System` types) and its
  interfaces. Interfaces from `System` are ignored; of the framework's own interfaces only `ICommand` and `IEvent`
  count, and your own interfaces count too. So a project with events usually sees one WHIZ072 for `IEvent`.
- A base type is **not** registered when it already carries `[JsonPolymorphic]` (your attributes are used instead),
  when it is not public, or when it is an abstract class (interfaces are allowed).
- Only concrete, public derived types are counted. A base type left with none is not registered.
- Polymorphic types found on message properties are merged in as well.

This was numbered WHIZ071 before; WHIZ071 now belongs to the [missing Pgvector package](whiz071) error.

The diagnostic has no source location.

## Diagnostic Message

```text
Discovered polymorphic base type '{BaseTypeName}' with {DerivedTypeCount} derived type(s) for automatic JSON serialization
```

## Common Causes

1. **A message type has subclasses**, or messages implement one of your interfaces.
2. **Messages implement `ICommand` or `IEvent`**, which are registered as polymorphic bases.

## How to Fix

Nothing needs fixing. Check the count when a derived type fails to deserialize: a derived type that is abstract or not
public is not counted, and a base type that is abstract, not public or already marked `[JsonPolymorphic]` is not
reported at all.

### Example that produces WHIZ072

```csharp{
title: "A message with derived types"
description: "DiagnosticTestEvent has two derived classes, so WHIZ072 reports it as a polymorphic base"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "JSON", "Polymorphism"]
testFile: "tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs"
testMethod: "Generator_WithPolymorphicBase_ReportsWHIZ072DiagnosticAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs"
tests: ["MessageJsonContextGeneratorTests.Generator_WithPolymorphicBase_ReportsWHIZ072DiagnosticAsync"]
}
using Whizbang.Core;
using System.Collections.Generic;

namespace TestApp;

public class DiagnosticTestEvent : IEvent {
  public string Id { get; init; } = "";
}

public class DerivedEvent1 : DiagnosticTestEvent { }
public class DerivedEvent2 : DiagnosticTestEvent { }

public record TestCommand : ICommand {
  public List<DiagnosticTestEvent> Events { get; init; } = new();
}
```

The build reports a WHIZ072 message naming `DiagnosticTestEvent`.

## Suppressing

WHIZ072 has no source location, so a `#pragma warning disable WHIZ072` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ072"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ072.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is safe; the derived types are
registered either way.

## Related

- [WHIZ099: MessageJsonContextGenerator Running](whiz099)
- [Polymorphic Serialization](../../extending/source-generators/polymorphic-serialization)
- [Polymorphic Types](../../fundamentals/perspectives/polymorphic-types)
- [JSON Contexts](../../extending/source-generators/json-contexts)
