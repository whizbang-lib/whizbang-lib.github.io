---
title: 'WHIZ006: Multiple Stream ID Attributes'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic defined for a message type with more than one [StreamId] property. In this release no generator
  reports it; perspective events with this problem get the WHIZ031 error instead.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - source-generator
  - reserved
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ006: Multiple Stream ID Attributes

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

WHIZ006 is defined to warn that a message type marks more than one property with `[StreamId]`, and that only the first
is used. The descriptor exists in the generator package, but **no generator or analyzer in this release reports it**.
The only test that names it checks the descriptor's ID and severity.

The behavior the message describes is real, it is just not reported. When the stream ID generator builds an
extractor for an event or command, it takes the **first** `[StreamId]` property it finds and ignores the rest,
without a diagnostic. The other properties are not stream IDs, whatever their attribute says.

One case **is** reported, as an error: an event used by a perspective with more than one `[StreamId]` property fails
the build with [WHIZ031](whiz031).

## Diagnostic Message

```text
Type {TypeName} has multiple [StreamId] attributes. Only the first property '{PropertyName}' will be used.
```

## Common Causes

None in this release: no code path in the generators reports this ID. The situation it describes (two `[StreamId]`
properties on one message) still deserves fixing, because the second attribute is silently ignored.

## How to Fix

Keep `[StreamId]` on the one property that identifies the stream, and remove it from the others:

```csharp{title="One stream ID per message" description="Keep [StreamId] on the property that identifies the stream; related ids are plain properties." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ006", "StreamId", "Events"] unverified="WHIZ006 is never reported; the fix pattern matches the WHIZ031 guidance, verified by PerspectiveDiscoveryGeneratorTests"}
public record OrderShipped : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }     // the stream this event belongs to

  public Guid CustomerId { get; init; }  // related id, not a stream ID
}
```

## Suppressing

Because WHIZ006 is never reported, there is nothing to suppress. The ID can still be configured like any diagnostic,
with `#pragma warning disable WHIZ006` around a type or `dotnet_diagnostic.WHIZ006.severity = none` in
`.editorconfig`. Prefer fixing the type: an ignored `[StreamId]` misleads readers.

## Related

- [WHIZ031: Multiple StreamId Attributes](whiz031)
- [WHIZ005: Stream ID Must Be Guid](whiz005)
- [WHIZ010: StreamId Discovered](whiz010)
- [StreamId Attribute](../../extending/attributes/streamid)
