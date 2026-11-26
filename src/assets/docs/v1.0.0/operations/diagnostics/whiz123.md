---
title: 'WHIZ123: A Strong Id Is Pinned Two Ways'
pageType: troubleshooting
verifiedAgainstCommit: 147ab39b
verifiedDate: 2026-11-26
description: >-
  Error diagnostic when the declarations of one strong id pin it with different pinned ids, through [PinnedId] on the
  struct or [WhizbangId(PinnedId)] on a struct, a property or a parameter.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - pinned-id
  - whizbang-id
  - identity
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdDeclaration.cs
  - src/Whizbang.Generators/Analyzers/PinnedIdAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdDeriveFromTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerStrongIdTests.cs
lastMaintainedCommit: '147ab39b'
---

# WHIZ123: A Strong Id Is Pinned Two Ways

**Severity**: Error
**Category**: Identity / Pinned Id

## Description

One strong id can be declared in several places: as a struct, and by any number of properties and parameters that
carry `[WhizbangId]`. It can be pinned on any of them, with `[PinnedId("...")]` on the struct or
`[WhizbangId(PinnedId = "...")]` on any declaration. One id has **one** pinned id, because every id it
[derives](../../fundamentals/identity/whizbang-ids#derived-ids) depends on it. When two declarations give different
pins, the build fails with WHIZ123.

Pins are compared in their normalized form, so the same GUID spelled in another case is the same pin. One declaration
that pins and others that do not is fine: the pin applies to the id.

## Diagnostic Message

```
Pinned id '{PinnedId}' for '{IdType}' disagrees with '{OtherPinnedId}', which another declaration of the same id pins. Pin the id once, or the same way everywhere it is declared.
```

## How to Fix

Choose the pin the id already derives from, which is the one the
[pinned-type ledger](../../fundamentals/identity/pinned-type-ledger#strong-ids-in-the-ledger) records, and remove or
correct the other. Pinning in one place is simplest: on the struct when there is one.

### Before (causes WHIZ123)

```csharp{title="One strong id pinned two ways" description="A property and a parameter declare ProductId with different pins, which reports WHIZ123." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "whizbang-id", "WHIZ123"] tests=["WhizbangIdDeriveFromTests.RoutesThatPinDifferently_ReportWhiz123AndKeepTheLowestPinAsync", "PinnedIdAnalyzerStrongIdTests.AStructPinnedTwoWays_ReportsWhiz123Async"]}
using Whizbang.Core;
namespace MyApp.Domain;
public class CreateProduct {
  [WhizbangId(PinnedId = "7b1d9e2f-0c3a-4e5b-8f6d-1a2b3c4d5e6f")]  // WHIZ123
  public ProductId Id { get; set; }
}
public record UpdateProduct([WhizbangId(PinnedId = "3f2c8a1e-5b7d-4c9e-a1f0-6d2b8e4c7a91")] ProductId Id);
```

### After (no diagnostic)

```csharp{title="One strong id pinned once" description="The id is pinned on one declaration; the others declare it without a pin." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "whizbang-id", "WHIZ123"] tests=["WhizbangIdDeriveFromTests.OneRoutePins_ThePinAppliesWithoutWhiz123Async"]}
using Whizbang.Core;
namespace MyApp.Domain;
public class CreateProduct {
  [WhizbangId]
  public ProductId Id { get; set; }
}
public record UpdateProduct([WhizbangId(PinnedId = "3f2c8a1e-5b7d-4c9e-a1f0-6d2b8e4c7a91")] ProductId Id);
```

{verified: WhizbangIdDeriveFromTests.RoutesThatPinDifferently_ReportWhiz123AndKeepTheLowestPinAsync, WhizbangIdDeriveFromTests.OneRoutePins_ThePinAppliesWithoutWhiz123Async, PinnedIdAnalyzerStrongIdTests.AStructPinnedTwoWays_ReportsWhiz123Async, PinnedIdAnalyzerStrongIdTests.AStructPinnedTwoWaysWithANonGuid_ReportsBothAsync}

## Related

- [Pinned identity: strong ids](../../fundamentals/identity/pinned-identity#strong-ids)
- [WHIZ112: Invalid [PinnedId] GUID](whiz112)
- [WHIZ118: DeriveFrom on a Strong Id With No Pinned Id](whiz118)
