---
title: 'WHIZ010: StreamId Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that an event type carries a [StreamId] and the generator produced a stream ID extractor for
  it. No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - streamid
  - events
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ010: StreamId Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The `StreamIdGenerator` found a `[StreamId]` on an event and generated a zero-reflection extractor for it, so the
framework can read the event's stream ID at runtime without reflection. WHIZ010 is reported once per such event, with
no source location. It is the event counterpart of [WHIZ004](whiz004), and the opposite of
[WHIZ009](whiz009), which reports an event with no `[StreamId]`.

A type is reported when all of these hold:

- it is `public`,
- it implements `IEvent`,
- it has a property marked `[StreamId]`, or a constructor parameter marked `[StreamId]` whose name matches one of its
  properties.

Inherited `[StreamId]` properties count, so a derived event is reported as well as its base: a base event and one
derived event produce two WHIZ010 lines. Composite events (`ICompositeEvent` types that are neither events nor
commands) also get extractors but are not reported with WHIZ010.

The message uses the event's simple name and the name of the stream ID property.

## Diagnostic Message

```text
Found [StreamId] on {EventName}.{PropertyName}
```

## Common Causes

1. **An event declares its stream ID** with `[StreamId]`, which is the intended setup.

## How to Fix

Nothing to fix. If you expected WHIZ010 for an event and it is missing, check that the event is `public` and
implements `IEvent`; if the build reports [WHIZ009](whiz009) for it instead, it has no usable `[StreamId]`.

## Example

```csharp{title="An event that produces WHIZ010" description="A public IEvent with a [StreamId] property is reported as discovered." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ010", "StreamId", "Events"] tests=["StreamIdGeneratorTests.Generator_ReportsInfoDiagnostic_WhenPropertyDiscoveredAsync"] testFile="StreamIdGeneratorTests.cs" testMethod="Generator_ReportsInfoDiagnostic_WhenPropertyDiscoveredAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs"}
using System;
using Whizbang.Core;

namespace TestNamespace;

// Reported as: Found [StreamId] on CreateOrder.OrderId
public record CreateOrder : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
}
```

## Suppressing

WHIZ010 has no source location, so `#pragma warning disable WHIZ010` cannot reach it. Set its severity in a global
analyzer config file:

```ini{title="Silence WHIZ010 project-wide" description="Global analyzer config entry that hides the event stream ID notice." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ010", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ010.severity = none
```

Silencing it is safe; the extractors are generated either way. In a project with many events it is mostly noise.

## Related

- [WHIZ009: Missing StreamId Attribute](whiz009)
- [WHIZ004: Command Stream ID Discovered](whiz004)
- [WHIZ030: Perspective Event Missing StreamId](whiz030)
- [StreamId Attribute](../../extending/attributes/streamid)
- [Stream ID](../../fundamentals/events/stream-id)
