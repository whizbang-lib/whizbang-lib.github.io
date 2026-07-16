---
title: 'WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment'
pageType: troubleshooting
description: >-
  Error diagnostic when a [PinnedId] type's CLR name changed but the change was not acknowledged in the
  committed pinned-type ledger — an un-acknowledged rename that would break deserialization of stored events.
version: 1.0.0
category: Diagnostics
severity: Error
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
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedTypeRenameAnalyzerTests.cs
lastMaintainedCommit: '35b3f2a5'
---

# WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment

**Severity**: Error
**Category**: Identity / Type Rename

## Description

A type carrying `[PinnedId]` has a CLR name that is **neither** the name recorded in the committed
[pinned-type ledger](../../fundamentals/identity/pinned-type-ledger) for its pinned id **nor** one of that entry's
`formerNames`. In other words, the type was **renamed**, and the rename has not been acknowledged.

This matters because messages are stored in the append-only event log under the **name of the day**. If the running
code no longer knows the old name, every event stored under it becomes unreadable. WHIZ120 fails the build so the
rename is recorded — as a former-name alias — before it can silently break stored-event deserialization.

The analyzer is **inert** when no ledger is present, so this diagnostic only fires once a project has adopted the
ledger.

## Diagnostic Message

```
Pinned type '{SimpleName}' (id {PinnedId}) has CLR name '{CurrentName}' but the pinned-type ledger records
'{LedgerName}'. This is a rename: in .whizbang/pinned-type-ledger.json, add '{LedgerName}' to this entry's
formerNames and set its clrTypeName to '{CurrentName}' so old stored events still resolve to this type.
```

## Common Causes

1. **Renaming an event, command, or perspective type** without updating the ledger.
2. **Moving a type to a different namespace** (the CLR name includes the namespace).
3. **Nesting or un-nesting a type** (nested types use `+` in the CLR name).

## How to Fix

In `.whizbang/pinned-type-ledger.json`, find the entry for the reported pinned id and:

1. Add the ledger's currently-recorded name to that entry's `formerNames`.
2. Set the entry's `clrTypeName` to the new (current) name.

```json{
title: "Acknowledge a pinned-type rename in the ledger"
description: "Add the former CLR name to formerNames and update clrTypeName in pinned-type-ledger.json so old stored events still resolve and WHIZ120 clears."
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz120", "pinned-id", "type-rename", "ledger", "former-names", "json"]
}
{
  "pinnedId": "11111111-2222-3333-4444-555555555555",
  "clrTypeName": "MyApp.Contracts.OrderPlacedEvent",
  "kind": "event",
  "formerNames": ["MyApp.Contracts.OrderCreatedEvent"]
}
```

Rebuild. WHIZ120 clears, and `MessageJsonContextGenerator` now emits an alias so events stored under the former name
still deserialize to the current type. Commit the ledger change alongside the rename — the diff is the acknowledgment.

The [VSCode extension](https://github.com/whizbang-lib) can apply this edit inline.

## When It Is Intentional

If you are genuinely retiring a pinned id (not renaming), remove the type and prune its ledger entry — see
[WHIZ121](whiz121). Renaming is not the same as replacing: to *replace* a type, create a new type with a **new**
`[PinnedId]`.

## Related

- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
- [WHIZ121: Ledger Entry Has No Living Type](whiz121)
- [Type Formatting](../../fundamentals/identity/type-formatting)
