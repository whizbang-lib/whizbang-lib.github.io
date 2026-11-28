---
title: 'WHIZ127: Fan-out key cannot hold a stream id'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when the key a perspective fan-out targets rows by is not a Guid or a strongly typed id over one.
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

# WHIZ127: Fan-out key cannot hold a stream id

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

A fan-out targets the rows whose key equals the foreign event's **stream id**. A key of any other type never equals
one, and the fan-out would change no row. The key is a `Guid`, or a strongly typed id (`[WhizbangId]`) over one.
Either may be nullable: a row whose key is null is targeted by no event.

The generator leaves a fan-out that breaks this rule out of the registry, so without the error it would never run.
See [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream).

## Diagnostic Message

```text
The fan-out key {Model}.{Key} that '{Perspective}' targets rows by is '{Type}', which cannot hold a stream id. A key is a Guid or a strongly typed id over one, nullable or not.
```

## Common Causes

1. **Keying by a natural key**, such as a customer code string, instead of the customer's stream id.

## How to Fix

### Before (causes WHIZ127)

```csharp{title="WHIZ127: before" description="A fan-out declaration that causes WHIZ127" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ127"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync" tests=["PerspectiveFanOutAnalyzerTests.AKeyThatBreaksOneRule_IsReportedForThatRuleAloneAsync"]}
[PhysicalField] [Indexed] public string CustomerCode { get; init; } = ""; // WHIZ127 as the key
```

### After (no diagnostic)

```csharp{title="WHIZ127: after" description="The declaration fixed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ127"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
[PhysicalField] [Indexed] public CustomerId CustomerId { get; init; } // a [WhizbangId] over Guid
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [WHIZ124](whiz124) to [WHIZ128](whiz128): the other fan-out rules
- [WHIZ106: Set-based apply must depend only on the row and the event](whiz106)
- [Physical fields](../../fundamentals/perspectives/physical-fields)
