---
title: 'WHIZ110: Message Missing [PinnedId]'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a concrete event, command or message type has no [PinnedId] attribute, so its stored
  identity depends on its namespace and class name.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - pinned-id
  - identity
  - messages
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

# WHIZ110: Message Missing [PinnedId]

**Severity**: Warning
**Category**: Identity / Pinned Id

## Description

A concrete message type (a class, record, struct or record struct that implements `IEvent`, `ICommand` or `IMessage`)
does not carry a `[PinnedId]` attribute.

`[PinnedId]` gives a type a stable identifier that does not depend on its namespace or class name. Events are stored
permanently under the name they had when they were written, so a type with a pinned id can be moved or renamed later
and still resolve the events written under its old name. Without one, the type's identity is its CLR name, and
restructuring namespaces breaks that link.

The analyzer skips abstract types and interfaces, so a base record or a marker interface such as
`IOrderEvent : IEvent` is never flagged; only the concrete types you actually send are. If a type is both a message
and a perspective, [WHIZ111](whiz111) is reported instead.

This is a warning rather than an error so an existing codebase can adopt pinned ids gradually.

## Diagnostic Message

```
Message type '{TypeName}' is missing [PinnedId]. Apply the code fix to add a stable pinned identity.
```

## Common Causes

1. **A new event or command was added** without a pinned id.
2. **An existing codebase is adopting pinned ids** and has not yet pinned every message type.
3. **A base type carries the attribute but the concrete type does not.** `[PinnedId]` is declared with
   `Inherited = false`, and the analyzer only looks at the concrete type's own attributes.

## How to Fix

Apply the code fix offered on the diagnostic: **Add [PinnedId("&lt;new-guid&gt;")]**. It generates a new GUID, adds
the attribute and adds `using Whizbang.Core.Attributes;` when the file lacks it. "Fix all in solution" is supported.

Apply the fix once and commit the result. The pinned id is the type's identity from then on: running the fix again
on the same type would generate a different GUID, and changing a committed pinned id is reported by
[WHIZ121](whiz121) when the project has a pinned-type ledger.

You can also add the attribute by hand with any GUID string that `Guid.TryParse` accepts (see [WHIZ112](whiz112)).

### Before (causes WHIZ110)

```csharp{title="Event without a pinned id" description="A concrete IEvent record with no [PinnedId] attribute reports WHIZ110." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "identity", "events", "WHIZ110"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_ConcreteEventWithoutPinnedId_ReportsWhiz100Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_ConcreteEventWithoutPinnedId_ReportsWhiz100Async"]}
using Whizbang.Core;

namespace TestApp;

public record OrderPlacedEvent : IEvent;  // WHIZ110
```

### After (no diagnostic)

```csharp{title="Event with a pinned id" description="The same event carrying a [PinnedId] GUID reports nothing." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["pinned-id", "identity", "events", "WHIZ110"] testFile="PinnedIdAnalyzerTests.cs" testMethod="Analyzer_ConcreteEventWithPinnedId_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedIdAnalyzerTests.cs" tests=["PinnedIdAnalyzerTests.Analyzer_ConcreteEventWithPinnedId_NoDiagnosticAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;

namespace TestApp;

[PinnedId("11111111-2222-3333-4444-555555555555")]
public record OrderPlacedEvent : IEvent;
```

## Suppressing

For a single type:

```csharp{title="Suppress WHIZ110 for one type" description="Disables WHIZ110 around one message declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ110"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ110
public record LegacyEvent : IEvent;
#pragma warning restore WHIZ110
```

For a whole project or folder, in `.editorconfig`:

```ini{title="Disable WHIZ110 in .editorconfig" description="Turns WHIZ110 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ110"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ110.severity = none
```

Suppressing is reasonable in a test project, where fixture messages are never stored, and temporarily while a large
codebase is pinned in stages. For production message types prefer pinning: suppression leaves the type's stored
identity tied to its namespace. To make missing pinned ids fail the build instead, raise the severity to `error`.

## Related

- [WHIZ111: Perspective Missing [PinnedId]](whiz111)
- [WHIZ112: Invalid [PinnedId] GUID](whiz112)
- [WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment](whiz120)
- [WHIZ121: Pinned-Type Ledger Entry Has No Living Type](whiz121)
- [Pinned Identity](../../fundamentals/identity/pinned-identity)
- [PinnedId Attribute](../../extending/attributes/pinned-id)
- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
