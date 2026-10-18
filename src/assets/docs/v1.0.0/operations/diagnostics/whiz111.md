---
title: 'WHIZ111: Perspective Missing [PinnedId]'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a concrete perspective has no [PinnedId] attribute, so its registration depends on its
  namespace and class name.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - pinned-id
  - identity
  - perspectives
  - analyzer
  - code-fix
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PinnedIdAnalyzer.cs
  - src/Whizbang.Generators.CodeFixes/PinnedIdCodeFixProvider.cs
  - src/Whizbang.Core/Attributes/PinnedIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ111: Perspective Missing [PinnedId]

**Severity**: Warning
**Category**: Identity / Pinned Id

## Description

A concrete perspective (a non-abstract class or struct implementing `IPerspectiveFor<...>` or
`IPerspectiveWithActionsFor<...>`) does not carry a `[PinnedId]` attribute.

A pinned id gives the perspective a stable identity that survives namespace restructuring, the same way it does for
message types ([WHIZ110](whiz110)). Without one, the perspective's registration is keyed by its CLR name, and moving
or renaming the class changes that key.

Abstract perspective bases are skipped. A type that is both a perspective and a message reports WHIZ111, not WHIZ110.
This is a warning so pinned ids can be adopted gradually.

## Diagnostic Message

```
Perspective type '{TypeName}' is missing [PinnedId]. Apply the code fix to add a stable pinned identity.
```

## Common Causes

1. **A new perspective was added** without a pinned id.
2. **A perspective implements `IPerspectiveWithActionsFor<...>`**; it is checked exactly like `IPerspectiveFor<...>`.
3. **The attribute is on a base class only.** `[PinnedId]` is not inherited, so each concrete perspective needs its own.

## How to Fix

Apply the code fix **Add [PinnedId("&lt;new-guid&gt;")]**, or add the attribute by hand with a GUID string. Apply it once
and commit: the code fix generates a new GUID each time it runs, and the committed value is the perspective's identity
from then on.

### Before (causes WHIZ111)

```csharp{title="Perspective without a pinned id" description="A concrete IPerspectiveFor implementation with no [PinnedId] reports WHIZ111." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "identity", "perspectives", "WHIZ111"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_PerspectiveWithoutPinnedId_ReportsWhiz101Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_PerspectiveWithoutPinnedId_ReportsWhiz101Async"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

namespace TestApp;

public record OrderView;
public record OrderPlacedEvent : IEvent;

public class OrderPerspective : IPerspectiveFor<OrderView, OrderPlacedEvent> {  // WHIZ111
  public OrderView Apply(OrderView? current, OrderPlacedEvent @event) => current ?? new();
}
```

### After (no diagnostic)

```csharp{title="Perspective with a pinned id" description="The perspective and its event both carry [PinnedId], so neither WHIZ110 nor WHIZ111 is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "identity", "perspectives", "WHIZ111"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_PerspectiveWithPinnedId_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_PerspectiveWithPinnedId_NoDiagnosticAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

namespace TestApp;

public record OrderView;

[PinnedId("33333333-4444-5555-6666-777777777777")]
public record OrderPlacedEvent : IEvent;

[PinnedId("88888888-9999-aaaa-bbbb-cccccccccccc")]
public class OrderPerspective : IPerspectiveFor<OrderView, OrderPlacedEvent> {
  public OrderView Apply(OrderView? current, OrderPlacedEvent @event) => current ?? new();
}
```

## Suppressing

```csharp{title="Suppress WHIZ111 for one perspective" description="Disables WHIZ111 around one perspective declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ111"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ111
public class ScratchPerspective : IPerspectiveFor<OrderView, OrderPlacedEvent> {
  public OrderView Apply(OrderView? current, OrderPlacedEvent @event) => current ?? new();
}
#pragma warning restore WHIZ111
```

```ini{title="Disable WHIZ111 in .editorconfig" description="Turns WHIZ111 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ111"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ111.severity = none
```

Suppressing fits test projects and staged adoption. For perspectives that run in production, pin them instead.

## Related

- [WHIZ110: Message Missing [PinnedId]](whiz110)
- [WHIZ112: Invalid [PinnedId] GUID](whiz112)
- [WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment](whiz120)
- [Pinned Identity](../../fundamentals/identity/pinned-identity)
- [PinnedId Attribute](../../extending/attributes/pinned-id)
- [Perspectives](../../fundamentals/perspectives/perspectives)
