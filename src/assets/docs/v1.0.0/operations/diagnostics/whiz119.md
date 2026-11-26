---
title: "WHIZ119: A Strong Id's Pinned Id Is Gone From the Compilation"
pageType: troubleshooting
verifiedAgainstCommit: 147ab39b
verifiedDate: 2026-11-26
description: >-
  Error diagnostic when the pinned-type ledger records a strong id whose pinned id no [WhizbangId] in the compilation
  carries: usually a changed pin, which changes every id the type derives.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - pinned-id
  - whizbang-id
  - ledger
  - identity
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PinnedTypeRenameAnalyzer.cs
  - src/Whizbang.Generators/Ledger/PinnedTypeLedger.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PinnedStrongIdTests.cs
lastMaintainedCommit: '147ab39b'
---

# WHIZ119: A Strong Id's Pinned Id Is Gone From the Compilation

**Severity**: Error
**Category**: Identity / Type Rename

## Description

The committed [pinned-type ledger](../../fundamentals/identity/pinned-type-ledger#strong-ids-in-the-ledger) records a
strong id (an entry of kind `strong-id`) whose `pinnedId` no `[WhizbangId]` in the current compilation carries.

A strong id's pinned id is the input every id it [derives from a handling](../../fundamentals/identity/whizbang-ids#derived-ids)
is fixed by. When the pin disappears, it was usually **changed**, and a changed pin makes a retry that crosses the
deploy derive a different id from the one the first attempt stored. So this is an error, where the same finding for a
message or perspective entry is [WHIZ121](whiz121), a warning: a stale message entry only carries dead history, while a
changed strong id pin changes ids.

| Ledger entry kind | Pin gone from the compilation |
|---|---|
| `event`, `command`, `perspective` | [WHIZ121](whiz121), Warning |
| `strong-id` | WHIZ119, Error |

A strong id renamed with its pin kept is a rename, reported as [WHIZ120](whiz120) like any pinned type.

## Diagnostic Message

```
The pinned-type ledger records strong id {PinnedId} ('{ClrTypeName}') but no [WhizbangId] in this compilation carries that pinned id. Changing a strong id's pinned id changes every id it derives; restore it, or, if the id type was removed on purpose, remove its entry from .whizbang/pinned-type-ledger.json.
```

## Common Causes

1. **The pin was changed** in `[PinnedId("...")]` or `[WhizbangId(PinnedId = "...")]`.
2. **The pin was removed**, so the id is no longer pinned.
3. **The id type was deleted**, or moved to another assembly, and its ledger entry left behind.

## How to Fix

- **Changed or removed pin**: restore the pin the ledger records. Treat a pin change as a bug, not a refactoring.
- **Removed id type**: delete its entry from `.whizbang/pinned-type-ledger.json`.
- **Moved to another assembly**: move the entry to that assembly's ledger
  ([a type that moves to another assembly](../../fundamentals/identity/pinned-type-ledger#a-type-that-moves-to-another-assembly)).

{verified: PinnedStrongIdTests.RenameAnalyzer_AStrongIdWhosePinChanged_ReportsWhiz119AsAnErrorAsync, PinnedStrongIdTests.RenameAnalyzer_ALivingStrongId_ReportsNothingAsync}

## Related

- [Pinned-Type Ledger: strong ids](../../fundamentals/identity/pinned-type-ledger#strong-ids-in-the-ledger)
- [WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment](whiz120)
- [WHIZ121: Pinned-Type Ledger Entry Has No Living Type](whiz121)
- [WHIZ118: DeriveFrom on a Strong Id With No Pinned Id](whiz118)
