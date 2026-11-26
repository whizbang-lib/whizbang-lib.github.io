---
title: 'WHIZ118: DeriveFrom on a Strong Id With No Pinned Id'
pageType: troubleshooting
verifiedAgainstCommit: 147ab39b
verifiedDate: 2026-11-26
description: >-
  Error diagnostic when code calls DeriveFrom on a [WhizbangId] type that has no pinned id, so the ids it derived
  would change with the type's name.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - pinned-id
  - whizbang-id
  - derive-from
  - identity
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/StrongIdDeriveFromAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Messaging/StrongIdDerivation.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StrongIdDeriveFromAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdDeriveFromTests.cs
lastMaintainedCommit: '147ab39b'
---

# WHIZ118: DeriveFrom on a Strong Id With No Pinned Id

**Severity**: Error
**Category**: Identity / Pinned Id

## Description

A call to `DeriveFrom(handling, purpose)` is made on a strong id (a `[WhizbangId]` type) that has no pinned id. A
[derived id](../../fundamentals/identity/whizbang-ids#derived-ids) is fixed by the id type's pinned id, never its name,
so that renaming or moving the type keeps every id it derives. An id type with no pinned id has nothing to derive from:
the call does not compile, and its generated `DeriveFrom` throws `NotSupportedException` if the diagnostic is
suppressed.

Only the call is reported. An unpinned strong id is fine wherever `DeriveFrom` is not called: `New()`, `From` and
`Parse` need no pin. Only the `PinnedId` constant the generator bakes counts as a pin; a hand-written member named
`PinnedId` does not.

## Diagnostic Message

```
'{IdType}' has no pinned id, so '{IdType}.DeriveFrom' cannot derive an id that survives a rename. Pin it with [PinnedId("<guid>")] on its declaration, or [WhizbangId(PinnedId = "<guid>")] where it is declared.
```

## How to Fix

Pin the id type once, with a GUID you never change (see
[Pinned identity: strong ids](../../fundamentals/identity/pinned-identity#strong-ids)):

- `[PinnedId("<guid>")]` on its struct, or
- `[WhizbangId(PinnedId = "<guid>")]` where it is declared, which is the only way for an id declared by a property or a
  parameter.

If the code runs outside a receptor body, or the id should be new on every attempt, call `New()` instead.

### Before (causes WHIZ118)

```csharp{
title: "DeriveFrom on an unpinned strong id"
description: "ProductId has no pinned id, so the DeriveFrom call reports WHIZ118 as an error."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["pinned-id", "whizbang-id", "derive-from", "WHIZ118"]
testFile: "tests/Whizbang.Generators.Tests/Analyzers/StrongIdDeriveFromAnalyzerTests.cs"
testMethod: "DeriveFromOnAnUnpinnedId_ReportsWhiz118Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/StrongIdDeriveFromAnalyzerTests.cs"
tests: ["StrongIdDeriveFromAnalyzerTests.DeriveFromOnAnUnpinnedId_ReportsWhiz118Async"]
}
using Whizbang.Core;
using Whizbang.Core.Messaging;
namespace App;
[WhizbangId]
public readonly partial struct ProductId;
public static class Use {
  public static ProductId Make() => ProductId.DeriveFrom(Handling.Current, "product");
}
```

### After (no diagnostic)

```csharp{title="DeriveFrom on a pinned strong id" description="The same call on an id pinned where it is declared reports nothing." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "whizbang-id", "derive-from", "WHIZ118"] tests=["StrongIdDeriveFromAnalyzerTests.DeriveFromOnAPinnedId_ReportsNothingAsync"]}
using Whizbang.Core;
using Whizbang.Core.Messaging;
namespace App;
public record CreateProduct([WhizbangId(PinnedId = "3f2c8a1e-5b7d-4c9e-a1f0-6d2b8e4c7a91")] ProductId Id);
public static class Use {
  public static ProductId Make() => ProductId.DeriveFrom(Handling.Current, "product");
}
```

{verified: StrongIdDeriveFromAnalyzerTests.DeriveFromOnAnUnpinnedId_ReportsWhiz118Async, StrongIdDeriveFromAnalyzerTests.DeriveFromOnAPinnedId_ReportsNothingAsync, StrongIdDeriveFromAnalyzerTests.AMemberNamedPinnedIdThatIsNotAConstant_DoesNotPinTheIdAsync, StrongIdDeriveFromAnalyzerTests.OtherCallsNamedDeriveFrom_ReportNothingAsync, WhizbangIdDeriveFromTests.DeriveFrom_AnUnpinnedId_ThrowsNamingHowToPinItAsync}

## Related

- [Derived ids](../../fundamentals/identity/whizbang-ids#derived-ids)
- [Pinned identity: strong ids](../../fundamentals/identity/pinned-identity#strong-ids)
- [WHIZ112: Invalid [PinnedId] GUID](whiz112)
- [WHIZ123: A Strong Id Is Pinned Two Ways](whiz123)
