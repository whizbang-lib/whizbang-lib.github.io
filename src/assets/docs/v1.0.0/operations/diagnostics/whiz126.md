---
title: 'WHIZ126: Fan-out key is not indexed'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when the key a perspective fan-out targets rows by has no [Indexed], so every foreign event would scan the table.
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

# WHIZ126: Fan-out key is not indexed

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

Every foreign event a fan-out receives filters the perspective table on the key column, and a rebuild reads by it
too. Without an index each one reads the whole table, so the key must carry `[Indexed]`. The schema pass creates the
index from it.

The generator leaves a fan-out that breaks this rule out of the registry, so without the error it would never run.
See [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream).

## Diagnostic Message

```text
The fan-out key {Model}.{Key} that '{Perspective}' targets rows by has no [Indexed], so every foreign event would scan the table for its rows. Mark it [Indexed].
```

## Common Causes

1. **A physical field without an index**: `[PhysicalField]` promotes a column but does not index it.

## How to Fix

### Before (causes WHIZ126)

```csharp{title="WHIZ126: before" description="A fan-out declaration that causes WHIZ126" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ126"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync" tests=["PerspectiveFanOutAnalyzerTests.AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync"]}
[PhysicalField] public Guid CustomerId { get; init; } // WHIZ126
```

### After (no diagnostic)

```csharp{title="WHIZ126: after" description="The declaration fixed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ126"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
[PhysicalField] [Indexed] public Guid CustomerId { get; init; }
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128): the other fan-out rules
- [WHIZ106: Set-based apply must depend only on the row and the event](whiz106)
- [Physical fields](../../fundamentals/perspectives/physical-fields)
