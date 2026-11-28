---
title: 'WHIZ129: Fan-out names a type the generated registry cannot reach'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when a perspective fan-out is declared on, or names, a private or protected type, which the fan-out
  registry generated beside it cannot name.
tags:
  - diagnostics
  - perspectives
  - fan-out
  - multi-stream
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFanOutAnalyzer.cs
  - src/Whizbang.Generators/FanOutShape.cs
  - src/Whizbang.Generators/PerspectiveFanOutDiscoveryGenerator.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFanOutAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveFanOutDiscoveryGeneratorTests.cs
---

# WHIZ129: Fan-out names a type the generated registry cannot reach

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

Each fan-out is registered by code the generator writes into the declaring assembly. That code names the perspective,
its model and the foreign event, and casts to each. A type that is private or protected, or nested in one, cannot be
named there. The generator leaves such a fan-out out of the registry, so it would never apply, and WHIZ129 reports it at
the perspective instead of letting the build fail on CS0122 in generated code.

Internal and public types are reachable, nested or not.

## Diagnostic Message

```text
The fan-out declared by '{Perspective}' names {Type}, which is private or protected, so the fan-out registry generated beside it cannot name it. Make {Type} internal or public.
```

## Common Causes

1. **A perspective nested privately in a test or a feature class.**
2. **A foreign event or a model declared as a private nested record.**

## How to Fix

### Before (causes WHIZ129)

```csharp{title="WHIZ129: before" description="A fan-out on a private nested perspective" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ129"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="Whiz129_AFanOutTheGeneratedRegistryCannotReach_IsAnErrorAsync" tests=["PerspectiveFanOutAnalyzerTests.Whiz129_AFanOutTheGeneratedRegistryCannotReach_IsAnErrorAsync"]}
public class Orders {
  private sealed class Projection : IPerspectiveFanOutFor<OrderSummary, CustomerRenamed> { /* ... */ } // WHIZ129
}
```

### After (no diagnostic)

```csharp{title="WHIZ129: after" description="The perspective made internal" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ129"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="Whiz129_AnInternalNestedFanOut_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.Whiz129_AnInternalNestedFanOut_ReportsNothingAsync"]}
public class Orders {
  internal sealed class Projection : IPerspectiveFanOutFor<OrderSummary, CustomerRenamed> { /* ... */ }
}
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128), and [WHIZ143](whiz143): the other fan-out rules
