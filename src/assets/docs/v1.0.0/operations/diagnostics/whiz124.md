---
title: 'WHIZ124: Fan-out Targets does not name a key property'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when a perspective fan-out's Targets is not FanOut.By<TModel>(row => row.Key) naming one property of the model, so the build cannot read the key column.
tags:
  - diagnostics
  - perspectives
  - fan-out
  - multi-stream
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFanOutAnalyzer.cs
  - src/Whizbang.Generators/FanOutShape.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFanOutFor.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFanOutAnalyzerTests.cs
---

# WHIZ124: Fan-out Targets does not name a key property

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

A fan-out's key is read from `Targets` when the project builds, so the generator can register the column a foreign
event's rows are found by. `Targets` must return `FanOut.By<TModel>(row => row.Key)` directly: as an expression body,
a getter that only returns it, or an auto-property initializer. The selector must read one property straight off the
row.

Anything else cannot be read at build time, so the fan-out is never registered and WHIZ124 fails the build instead.

The generator leaves a fan-out that breaks this rule out of the registry, so without the error it would never run.
See [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream).

## Diagnostic Message

```text
Targets on '{Perspective}' does not name a key: write FanOut.By<{Model}>(row => row.Key), naming one property of {Model}, so the build can read the column the foreign event's rows are found by
```

## Common Causes

1. **Returning a key built elsewhere**, such as a static field (`Targets => _key;`) or a helper method.
2. **A selector that is not one property of the row**: a constant (`o => Guid.Empty`), a nested member (`o => o.Customer.Id`) or a computed value.
3. **A getter with more than a `return`**, or an auto-property with no initializer.

## How to Fix

### Before (causes WHIZ124)

```csharp{title="WHIZ124: before" description="A fan-out declaration that causes WHIZ124" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ124"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="Whiz124_TargetsThatDoNotNameAKeyProperty_IsAnErrorAsync" tests=["PerspectiveFanOutAnalyzerTests.Whiz124_TargetsThatDoNotNameAKeyProperty_IsAnErrorAsync"]}
public static FanOutKey<OrderSummary> Targets => _key; // WHIZ124
```

### After (no diagnostic)

```csharp{title="WHIZ124: after" description="The declaration fixed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ124"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
public static FanOutKey<OrderSummary> Targets => FanOut.By<OrderSummary>(o => o.CustomerId);
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128): the other fan-out rules
- [WHIZ106: Set-based apply must depend only on the row and the event](whiz106)
- [Physical fields](../../fundamentals/perspectives/physical-fields)
