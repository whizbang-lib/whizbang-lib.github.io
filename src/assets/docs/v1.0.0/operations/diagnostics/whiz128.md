---
title: 'WHIZ128: Fan-out key is assigned by a set-based apply'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when a fan-out's Apply or a [CollectiveApplyFor] handler assigns a property a fan-out targets rows by.
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

# WHIZ128: Fan-out key is assigned by a set-based apply

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

A rebuild finds the foreign events that target a row from the key values the row takes while its **own** events are
folded. If a set-based apply (a fan-out's `Apply` or a `[CollectiveApplyFor]` handler of the same model) assigned the
key, rows would move between foreign streams without the rebuild seeing it, and live and rebuilt rows would differ.

WHIZ128 is reported at the `SetProperty` selector that assigns the key, anywhere in the project.

The generator leaves a fan-out that breaks this rule out of the registry, so without the error it would never run.
See [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream).

## Diagnostic Message

```text
'{Method}' assigns {Model}.{Key}, the key '{Perspective}' targets rows by. A fan-out key changes only through the row's own events; remove the setter, or change the key in the Apply of the row's own event.
```

## Common Causes

1. **A fan-out that also re-points its rows**, such as a `CustomerMerged` that sets `CustomerId` to the surviving customer.
2. **A collective handler on the same model** that rewrites the key column.

## How to Fix

### Before (causes WHIZ128)

```csharp{title="WHIZ128: before" description="A fan-out declaration that causes WHIZ128" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ128"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="Whiz128_ASetThatAssignsTheKey_IsAnErrorAsync" tests=["PerspectiveFanOutAnalyzerTests.Whiz128_ASetThatAssignsTheKey_IsAnErrorAsync"]}
s => s.SetProperty(o => o.CustomerId, e.SurvivorId) // WHIZ128
```

### After (no diagnostic)

```csharp{title="WHIZ128: after" description="The declaration fixed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ128"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
// In the Apply of the order's own event, e.g. OrderReassigned:
return current with { CustomerId = e.CustomerId };
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128): the other fan-out rules
- [WHIZ106: Set-based apply must depend only on the row and the event](whiz106)
- [Physical fields](../../fundamentals/perspectives/physical-fields)
