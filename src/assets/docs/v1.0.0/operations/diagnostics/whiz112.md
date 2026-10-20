---
title: 'WHIZ112: Invalid [PinnedId] GUID'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when the value passed to [PinnedId] on a message or perspective is not a parseable GUID string.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - pinned-id
  - identity
  - guid
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PinnedIdAnalyzer.cs
  - src/Whizbang.Core/Attributes/PinnedIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ112: Invalid [PinnedId] GUID

**Severity**: Error
**Category**: Identity / Pinned Id

## Description

A concrete message or perspective carries `[PinnedId("...")]`, but the string is not a GUID. The analyzer checks the
value with `Guid.TryParse`; anything that fails to parse is an error, reported on the attribute.

The attribute itself accepts any non-empty string, so the compiler alone would not catch this. The pinned id is the
type's permanent identity across services and environments, and it is required to be a GUID so that it is unique.

The check runs only on types the pinned-id analyzer covers: non-abstract classes and structs that implement `IEvent`,
`ICommand`, `IMessage`, `IPerspectiveFor<...>` or `IPerspectiveWithActionsFor<...>`.

## Diagnostic Message

```
[PinnedId] value '{PinnedIdValue}' on '{TypeName}' is not a valid GUID. Use a value parseable by Guid.Parse (e.g., '00000000-0000-0000-0000-000000000000').
```

## Common Causes

1. **A readable name was used instead of a GUID**, for example `[PinnedId("order-placed")]`.
2. **A GUID was mistyped or truncated** while copying it.
3. **Extra characters** were pasted around the value.

## How to Fix

Replace the value with a GUID. The quickest way is to delete the attribute and apply the code fix offered by
[WHIZ110](whiz110) or [WHIZ111](whiz111), which generates a new one. Choose the GUID once and keep it: it becomes the
type's permanent identity.

### Before (causes WHIZ112)

```csharp{title="Pinned id that is not a GUID" description="A [PinnedId] value that Guid.TryParse rejects reports WHIZ112 as an error." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "guid", "identity", "WHIZ112"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_PinnedIdValueNotAGuid_ReportsWhiz112Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_PinnedIdValueNotAGuid_ReportsWhiz112Async"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;

namespace TestApp;

[PinnedId("definitely-not-a-guid")]  // WHIZ112
public record OrderPlacedEvent : IEvent;
```

### After (no diagnostic)

```csharp{title="Pinned id that is a GUID" description="A parseable GUID value reports nothing." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "guid", "identity", "WHIZ112"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_PinnedIdValidGuid_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_PinnedIdValidGuid_NoDiagnosticAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;

namespace TestApp;

[PinnedId("11111111-2222-3333-4444-555555555555")]
public record OrderPlacedEvent : IEvent;
```

## Related

- [WHIZ110: Message Missing [PinnedId]](whiz110)
- [WHIZ111: Perspective Missing [PinnedId]](whiz111)
- [Pinned Identity](../../fundamentals/identity/pinned-identity)
- [PinnedId Attribute](../../extending/attributes/pinned-id)
