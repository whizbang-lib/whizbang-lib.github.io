---
title: 'WHIZ804: Table Storage Value Out Of Range'
pageType: troubleshooting
verifiedAgainstCommit: f3ceab2b
verifiedDate: 2026-10-21
description: >-
  Error reported on [PerspectiveTableStorage] when a value is outside the range PostgreSQL accepts: a FillFactor
  outside 10 to 100, a ToastTupleTarget outside 128 to 8160, or an autovacuum scale factor above 100.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - storage
  - fillfactor
  - autovacuum
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveTableStorageAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/TableStorageRange.cs
  - src/Whizbang.Generators.Shared/Models/ColumnStorageSql.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableStorageAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveTableStorageAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/SharedHelpersBranchTests.cs
lastMaintainedCommit: 'f3ceab2b'
---

# WHIZ804: Table Storage Value Out Of Range

**Severity**: Error
**Category**: Perspective storage

## Description

`[PerspectiveTableStorage]` sets a perspective table's storage parameters, and the schema pass applies them with
`ALTER TABLE … SET (…)` at startup. PostgreSQL refuses a value outside each parameter's range, and that refusal would
fail the schema pass on the server. An analyzer checks the attribute's values where they are declared and reports
WHIZ804 for each one PostgreSQL would refuse. The schema generators leave such a value out, so even with the
diagnostic suppressed the pass keeps the server's setting rather than failing.

| Property | Storage parameter | Accepted range |
|----------|-------------------|----------------|
| `FillFactor` | `fillfactor` | 10 to 100 |
| `ToastTupleTarget` | `toast_tuple_target` | 128 to 8160 |
| `AutovacuumVacuumScaleFactor` | `autovacuum_vacuum_scale_factor` | 0 to 100 |
| `AutovacuumInsertScaleFactor` | `autovacuum_vacuum_insert_scale_factor` | 0 to 100 |
| `ToastAutovacuumVacuumScaleFactor` | `toast.autovacuum_vacuum_scale_factor` | 0 to 100 |

A negative value (each property's default) declares nothing and keeps the server's setting, so it is never reported;
for `ToastTupleTarget`, 0 also declares nothing. The autovacuum thresholds accept any count from 0, so they cannot be
out of range.

## Diagnostic Message

```text
[PerspectiveTableStorage] on '{ModelName}' sets {Property} = {Value}, which PostgreSQL does not accept: the range is {Minimum} to {Maximum}. Use a value in the range, or a negative value to keep the server's setting.
```

## Common Causes

1. **A scale factor written as a percentage.** A scale factor is a fraction of the table (0.05 means 5%), so 150 is
   refused, while `FillFactor` is a percentage (90 means 90%).
2. **A fillfactor below 10.** PostgreSQL keeps at least 10% of each page in use; a value under 10 is refused.
3. **A `ToastTupleTarget` under 128 bytes**, intended as "move everything out of line".

## How to Fix

Use a value in the range, or remove the property (or set it negative) to keep the server's setting.

### Before (reports WHIZ804)

```csharp{title="Storage values PostgreSQL refuses" description="A fillfactor under 10 and a scale factor over 100 are each reported as WHIZ804 at the attribute." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz804", "fillfactor", "counter-example"] tests=["PerspectiveTableStorageAnalyzerTests.AValueOutOfRange_ReportsWhiz804Async"]}
using Whizbang.Core.Perspectives;

[PerspectiveTableStorage(FillFactor = 9, AutovacuumVacuumScaleFactor = 150)]   // WHIZ804 twice
public record ActiveSessionModel {
  [StreamId]
  public Guid Id { get; init; }
}
```

### After

```csharp{title="Storage values in range" description="A fillfactor of 90 percent and a scale factor of 0 with a fixed threshold; nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz804", "fillfactor", "autovacuum"] tests=["PerspectiveTableStorageAnalyzerTests.ValuesInRange_AreNotReportedAsync"]}
using Whizbang.Core.Perspectives;

[PerspectiveTableStorage(FillFactor = 90, AutovacuumVacuumScaleFactor = 0, AutovacuumVacuumThreshold = 10000)]
public record ActiveSessionModel {
  [StreamId]
  public Guid Id { get; init; }
}
```

{verified: PerspectiveTableStorageAnalyzerTests.AValueOutOfRange_ReportsWhiz804Async, PerspectiveTableStorageAnalyzerTests.EachValueOutOfRange_IsReportedOnItsOwnAsync, PerspectiveTableStorageAnalyzerTests.NegativeValues_DeclareNothing_AndAreNotReportedAsync, SharedHelpersBranchTests.TableStorage_AValueOutOfRange_DeclaresNothingAsync}

## Suppressing

Suppressing WHIZ804 is not useful: the value is left out of the schema pass either way, so the table keeps the
server's setting. Fix the value instead.

## Related

- [Physical Fields: free space for updates](../../fundamentals/perspectives/physical-fields#perspective-fillfactor)
- [Physical Fields: when autovacuum runs](../../fundamentals/perspectives/physical-fields#perspective-autovacuum)
- [Storage Maintenance](../infrastructure/storage-maintenance#fillfactor)
