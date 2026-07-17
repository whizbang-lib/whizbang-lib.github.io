---
title: 'WHIZ121: Pinned-Type Ledger Entry Has No Living Type'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Warning diagnostic when the committed pinned-type ledger records a pinned id that no [PinnedId] type in the
  compilation carries — a removed type or a changed pinned id, whose aliases would register against nothing.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - pinned-id
  - type-rename
  - ledger
  - identity
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PinnedTypeRenameAnalyzer.cs
  - src/Whizbang.Generators/Ledger/PinnedTypeLedger.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedTypeRenameAnalyzerTests.cs
lastMaintainedCommit: '35b3f2a5'
---

# WHIZ121: Pinned-Type Ledger Entry Has No Living Type

**Severity**: Warning
**Category**: Identity / Type Rename

## Description

The committed [pinned-type ledger](../../fundamentals/identity/pinned-type-ledger) records an entry whose `pinnedId`
matches **no** `[PinnedId]` type in the current compilation. The ledger should track exactly the pinned types in the
assembly; an entry with no living type indicates a **removed type** or a **changed pinned id**. Any former-name
aliases on that entry would register against nothing.

Unlike [WHIZ120](whiz120), this is a **warning**, not an error — a stale entry is harmless to correctness (it just
carries dead history), but it is noise that should be reconciled.

## Diagnostic Message

```
The pinned-type ledger records id {PinnedId} ('{ClrTypeName}') but no [PinnedId] type with that id exists in this
compilation. The type was removed or its PinnedId changed; prune or reconcile the ledger entry.
```

## Common Causes

1. **A type was deleted** but its ledger entry was left behind.
2. **A `[PinnedId]` value was changed** (which you should almost never do — the pinned id is the identity).
3. **A type moved to a different assembly**, so it is no longer part of this compilation's ledger.

## How to Fix

- **Removed type** — delete the stale entry from `.whizbang/pinned-type-ledger.json` (but only once you are sure no
  stored events still need its aliases; if they do, keep the entry so old events keep resolving).
- **Changed pinned id** — restore the original `[PinnedId]`. Changing a pinned id breaks identity; treat it as a bug,
  not a rename.
- **Moved to another assembly** — move the ledger entry to that assembly's ledger.

## Related

- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
- [WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment](whiz120)
