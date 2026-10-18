---
title: 'WHIZ008: Perspective Model Size Warning'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective's model has enough public properties that its stored JSON document is
  estimated at 1,500 bytes or more, close to the PostgreSQL JSONB compression threshold.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - jsonb
  - postgresql
  - performance
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveSchemaGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ008: Perspective Model Size Warning

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

Each perspective row stores its model as a JSONB document. PostgreSQL handles large JSONB values differently: around
2 KB a value is compressed, and around 7 KB it is moved out of the row (externalized). Both make reads and writes of
that row more expensive. WHIZ008 warns you while the model is still being designed that it is heading toward the first
of those thresholds.

The estimate is a static heuristic in the `PerspectiveSchemaGenerator`, not a measurement:

- it counts the model's **public instance properties**, including inherited ones (static and non-public properties
  are not counted),
- it estimates `20 + 40 × propertyCount` bytes, regardless of property types or actual values,
- it warns when the estimate is **1,500 bytes or more**, which is a model with **37 or more** counted properties.

The model is the first type argument of the perspective interface (`TModel` in `IPerspectiveFor<TModel, TEvent>`).
The warning is reported once per non-abstract perspective class, with no source location, and names the perspective
class (not the model). Two perspectives that share a large model each get a warning.

## Diagnostic Message

```text
Perspective '{PerspectiveName}' model estimated at ~{EstimatedBytes} bytes. Consider splitting if approaching 2KB (compression) or 7KB (externalization) thresholds.
```

## Common Causes

1. **A read model has grown wide**, collecting many fields for different screens or queries.
2. **A model inherits many properties** from a base class; inherited public properties are counted.
3. **The estimate overstates the real size**: 37 short properties (flags, small numbers) may serialize well under
   1,500 bytes. The heuristic does not look at types or values.

## How to Fix

- **Split the model** into several perspectives that each serve a narrower read, so each document stays small.
- **Move rarely read data** out of the model into its own perspective.
- **If the real documents are small**, the warning is a false positive for your data; suppress it for that build (see
  below) after checking actual row sizes.

### Before (causes WHIZ008)

```csharp{title="A model wide enough to trigger WHIZ008" description="A model with an Id plus 40 string properties is estimated above the 1,500 byte threshold." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ008", "Perspectives", "JSONB"] tests=["PerspectiveSchemaGeneratorTests.Generator_WithLargePerspective_GeneratesSizeWarningAsync"] testFile="PerspectiveSchemaGeneratorTests.cs" testMethod="Generator_WithLargePerspective_GeneratesSizeWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveSchemaGeneratorTests.cs"}
using System;
using Whizbang.Core;
using Whizbang.Core.Perspectives;

namespace MyApp.Perspectives;

public record LargeOrderModel {
  public Guid Id { get; set; }
  public string Property1 { get; set; } = string.Empty;
  public string Property2 { get; set; } = string.Empty;
  // ... Property3 through Property39 ...
  public string Property40 { get; set; } = string.Empty;
}

// WHIZ008: 41 properties, estimated at ~1660 bytes
public class LargeOrderPerspective : IPerspectiveFor<LargeOrderModel, OrderCreated> {
  public LargeOrderModel Apply(LargeOrderModel currentData, OrderCreated @event) {
    return currentData;
  }
}

public record OrderCreated : IEvent;
```

### After (no WHIZ008)

```csharp{title="A narrower model below the threshold" description="Fewer than 37 counted properties keeps the estimate under 1,500 bytes." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ008", "Perspectives", "JSONB"] unverified="no test asserts the absence of WHIZ008; the threshold arithmetic is in PerspectiveSchemaGenerator and the boundary is verified by PerspectiveSchemaGeneratorTests.PerspectiveSchemaGenerator_PerspectiveAtExactThreshold_GeneratesWarningAsync"}
public record OrderSummaryModel {
  public Guid Id { get; set; }
  public string Name { get; set; } = string.Empty;
  // ... a model with at most 36 public instance properties in total
}

public class OrderSummaryPerspective : IPerspectiveFor<OrderSummaryModel, OrderCreated> {
  public OrderSummaryModel Apply(OrderSummaryModel currentData, OrderCreated @event) {
    return currentData;
  }
}
```

## Suppressing

WHIZ008 has no source location, so `#pragma warning disable WHIZ008` cannot reach it. Set its severity in a global
analyzer config file:

```ini{title="Silence WHIZ008 project-wide" description="Global analyzer config entry that hides the perspective size warning." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ008", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ008.severity = none
```

Suppressing is reasonable when you have checked real document sizes and they stay well below 2 KB. It is not a
substitute for splitting a model whose rows really are large: the cost of compressed or externalized JSONB is paid on
every read and write. Note that the setting is project-wide; there is no per-perspective opt-out.

## Related

- [WHIZ007: Perspective Discovered](whiz007)
- [Perspectives Storage](../../data/perspectives-storage)
- [Perspectives Guide](../../fundamentals/perspectives/perspectives)
