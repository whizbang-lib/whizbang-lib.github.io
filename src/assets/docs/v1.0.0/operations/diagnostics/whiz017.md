---
title: 'WHIZ017: Stream ID Generation Opt-Out Cannot Hold Across Assemblies'
pageType: troubleshooting
verifiedAgainstCommit: 14833ba5
verifiedDate: 2026-10-30
description: >-
  Warning reported on a type's own [StreamId] when the type declares no [GenerateStreamId] and a base type in another
  assembly declares [GenerateStreamId]. The type means to opt out of the base's generation, but across assemblies the
  base's policy still applies.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - generatestreamid
  - inheritance
  - analyzer
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Core/GenerateStreamIdAttribute.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdCrossAssemblyGenerationAnalyzerTests.cs
lastMaintainedCommit: '14833ba5'
---

# WHIZ017: Stream ID Generation Opt-Out Cannot Hold Across Assemblies

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

A type that declares its own `[StreamId]`, plain or `Override = true`, and no `[GenerateStreamId]` does not inherit
its base's `[GenerateStreamId]`: its stream ID is not auto-generated. Within one assembly the generator emits that
opt-out, so it holds (see [StreamId Attribute](../../extending/attributes/streamid#derived-first-dispatch)).

Each assembly gets its own generated stream ID lookup, though. When the base type is compiled in **another
assembly** and declares `[GenerateStreamId]`, the base assembly's lookup answers "generate" for the derived instance
first, so the base's policy still applies and the derived type's stream ID is generated after all.

WHIZ017 reports that case on the derived type's own `[StreamId]`, naming the base type and its assembly
{verified: StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderAGeneratingBaseInAnotherAssembly_ReportsWhiz017Async, StreamIdCrossAssemblyGenerationAnalyzerTests.AnOverrideStreamId_UnderAGeneratingBaseInAnotherAssembly_ReportsWhiz017Async}.
It applies whether the base declares `[GenerateStreamId]` on the type or on its stream ID property
{verified: StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderABaseWhoseStreamIdPropertyGeneratesInAnotherAssembly_ReportsWhiz017Async},
and at any level of the inheritance chain. It is a warning, enabled by default
{verified: StreamIdCrossAssemblyGenerationAnalyzerTests.TheAnalyzer_DeclaresWhiz017AsAWarningAsync}.

It is **not** reported for:

- a base in the same assembly, where the opt-out holds
  {verified: StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderAGeneratingBaseInTheSameAssembly_IsNotReportedAsync};
- a derived type that declares `[GenerateStreamId]` itself, which has no opt-out to lose
  {verified: StreamIdCrossAssemblyGenerationAnalyzerTests.ADerivedTypeThatDeclaresGenerateStreamId_IsNotReportedAsync};
- a derived type with no `[StreamId]` of its own, which inherits the base's generation by design
  {verified: StreamIdCrossAssemblyGenerationAnalyzerTests.ADerivedTypeWithNoStreamIdOfItsOwn_IsNotReportedAsync};
- a base in another assembly that does not declare `[GenerateStreamId]`
  {verified: StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderABaseInAnotherAssemblyThatDoesNotGenerate_IsNotReportedAsync}.

The analyzer reads only attributes and assembly boundaries. Exact cross-assembly resolution, which would let the
opt-out hold wherever the base is compiled, is planned in
[whizbang-lib/whizbang#1905](https://github.com/whizbang-lib/whizbang/issues/1905); until then the warning says
where the result differs from what the attributes declare.

## Diagnostic Message

```text
Type {TypeName} declares its own [StreamId] '{PropertyName}' and no [GenerateStreamId], but base type {BaseTypeName} declares [GenerateStreamId]; the base's [GenerateStreamId] will still apply because the base is in another assembly ({BaseAssemblyName}). Declare [GenerateStreamId] on {TypeName}, or move {BaseTypeName} into the same assembly.
```

## Common Causes

1. **A shared contracts assembly** declares a base event with `[GenerateStreamId]`, and a service derives from it
   with a stream ID of its own.
2. **The base type was moved** out of the service assembly into a shared one, and the derived types kept relying on
   the same-assembly opt-out.
3. **`[GenerateStreamId]` was added to a base** in another assembly after derived types already declared their own
   `[StreamId]`.

## How to Fix

Say what the derived type wants, in a way that holds across the boundary:

- **The derived type should auto-generate its stream ID**: declare `[GenerateStreamId]` on it. Its own policy is
  then used, and it matches what the base assembly does anyway.
- **The derived type must not auto-generate**: move the base type into the derived type's assembly, so the
  generator emits the opt-out where it is read. Alternatively remove `[GenerateStreamId]` from the base and declare
  it on the derived types that should generate.

### Before (reports WHIZ017)

```csharp{title="An opt-out under a generating base in another assembly" description="OrderEventBase is compiled in the Contracts assembly and declares [GenerateStreamId]. LineAdded, in the service assembly, declares its own [StreamId] and no [GenerateStreamId], so it means to opt out, but the Contracts lookup still generates its stream ID and WHIZ017 is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ017", "StreamId", "GenerateStreamId", "Inheritance"] tests=["StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderAGeneratingBaseInAnotherAssembly_ReportsWhiz017Async"]}
// Contracts assembly
using Whizbang.Core;
namespace Contracts;

[GenerateStreamId]
public abstract record OrderEventBase : IEvent {
  [StreamId] public System.Guid OrderId { get; set; }
}

// Service assembly (references Contracts)
using Whizbang.Core;
namespace App;

public record LineAdded : Contracts.OrderEventBase {
  [StreamId] public System.Guid LineId { get; set; }   // WHIZ017
}
```

### After: the derived type generates

```csharp{title="The derived type declares its own generation" description="LineAdded declares [GenerateStreamId], so its policy is its own and holds in any assembly; nothing is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ017", "StreamId", "GenerateStreamId"] tests=["StreamIdCrossAssemblyGenerationAnalyzerTests.ADerivedTypeThatDeclaresGenerateStreamId_IsNotReportedAsync"]}
using Whizbang.Core;
namespace App;

[GenerateStreamId]
public record LineAdded : Contracts.OrderEventBase {
  [StreamId(Override = true)] public System.Guid LineId { get; set; }
}
```

### After: the base moves into the same assembly

```csharp{title="Base and derived type in one assembly" description="With OrderEventBase compiled in the same assembly as LineAdded, the generator emits LineAdded's opt-out, so its stream ID is not generated and nothing is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ017", "StreamId", "Inheritance"] tests=["StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderAGeneratingBaseInTheSameAssembly_IsNotReportedAsync"]}
using Whizbang.Core;
namespace App;

[GenerateStreamId]
public abstract record OrderEventBase : IEvent {
  [StreamId] public System.Guid OrderId { get; set; }
}

public record LineAdded : OrderEventBase {
  [StreamId(Override = true)] public System.Guid LineId { get; set; }
}
```

## Suppressing

Prefer one of the fixes: a suppressed WHIZ017 leaves a stream ID generated that the attributes say is not. If the
generated ID is acceptable and you cannot change either type, the warning can be silenced with
`#pragma warning disable WHIZ017` around the property or `dotnet_diagnostic.WHIZ017.severity = none` in
`.editorconfig`.

## Related

- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [WHIZ016: Stream ID Override Has Nothing to Override](whiz016)
- [StreamId Attribute](../../extending/attributes/streamid)
- [GenerateStreamId Attribute](../../extending/attributes/generatestreamid)
