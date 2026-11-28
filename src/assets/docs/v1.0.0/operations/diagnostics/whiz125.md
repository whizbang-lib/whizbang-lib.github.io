---
title: 'WHIZ125: Fan-out key is not a physical field'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when the key a perspective fan-out targets rows by is not a [PhysicalField], so the rows cannot be found by a column.
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

# WHIZ125: Fan-out key is not a physical field

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

A foreign event changes the rows whose key column holds its stream id, with one set-based `UPDATE` filtered on that
column, and a rebuild finds a row's foreign events by the same value. Both need the key to be a real column of the
perspective table, which [`[PhysicalField]`](../../fundamentals/perspectives/physical-fields) declares.

The generator leaves a fan-out that breaks this rule out of the registry, so without the error it would never run.
See [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream).

## Diagnostic Message

```text
The fan-out key {Model}.{Key} that '{Perspective}' targets rows by is not a [PhysicalField], so its rows cannot be found by a column. Mark it [PhysicalField].
```

## Common Causes

1. **The key lives only in the JSON document**: the property has `[Indexed]` but no `[PhysicalField]`.

## How to Fix

### Before (causes WHIZ125)

```csharp{title="WHIZ125: before" description="A fan-out declaration that causes WHIZ125" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ125"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync" tests=["PerspectiveFanOutAnalyzerTests.AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync"]}
[Indexed] public Guid CustomerId { get; init; } // WHIZ125
```

### After (no diagnostic)

```csharp{title="WHIZ125: after" description="The declaration fixed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ125"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
[PhysicalField] [Indexed] public Guid CustomerId { get; init; }
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128): the other fan-out rules
- [WHIZ106: Set-based apply must depend only on the row and the event](whiz106)
- [Physical fields](../../fundamentals/perspectives/physical-fields)
