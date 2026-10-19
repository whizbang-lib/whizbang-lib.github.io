---
title: 'WHIZ009: Missing StreamId Attribute'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a public event type has no property or constructor parameter marked with [StreamId], so
  no stream ID extractor can be generated for it.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - events
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ009: Missing StreamId Attribute

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

Every event belongs to a stream, and the framework finds that stream by reading the property marked `[StreamId]`.
The `StreamIdGenerator` builds a zero-reflection extractor for each event that has one. WHIZ009 warns that an event
has **none**, so no extractor is generated and resolving that event's stream ID fails at runtime.

The warning is reported on the type declaration (so it shows as a squiggle in the editor) when all of these hold:

- the type is `public` (non-public types are skipped by the generator altogether),
- it implements `IEvent`,
- no property in the type or its base classes has `[StreamId]`,
- no constructor parameter has `[StreamId]`.

Only events are checked. A command without `[StreamId]` does not produce WHIZ009. Abstract event types are not
exempt: a public abstract base event without `[StreamId]` is reported too.

If the event is also used by a perspective, the missing `[StreamId]` is additionally a build error,
[WHIZ030](whiz030).

## Diagnostic Message

```text
Event '{EventName}' has no property or parameter marked with [StreamId]. Stream ID resolution will fail at runtime.
```

`{EventName}` is the event type's name.

## Common Causes

1. **The attribute was forgotten** on the event's identifying property.
2. **The stream ID lives on a property with a different role name** (for example `OrderId`) and was never marked.
3. **A base event type** declares the identifying property without `[StreamId]`, and neither the base nor the
   derived type marks it.

## How to Fix

Mark the property that identifies the event's stream with `[StreamId]`. On a positional record, the attribute can go
on the constructor parameter.

### Before (causes WHIZ009)

```csharp{title="An event without [StreamId]" description="A public IEvent with no [StreamId] property or parameter is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ009", "StreamId", "Events"] tests=["StreamIdGeneratorTests.Generator_WithNoStreamIds_OnEvent_ReportsWarningAsync"] testFile="StreamIdGeneratorTests.cs" testMethod="Generator_WithNoStreamIds_OnEvent_ReportsWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs"}
using System;
using Whizbang.Core;

namespace TestNamespace;

public record CreateOrder : IEvent {
  public Guid OrderId { get; init; }
  // No [StreamId] attribute
}
```

### After (no WHIZ009)

```csharp{title="[StreamId] on a record parameter" description="A [StreamId] on the positional parameter satisfies the check and generates an extractor." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ009", "StreamId", "Events"] tests=["StreamIdGeneratorCoverageTests.Generator_EventRecordWithStreamIdOnParameter_GeneratesExtractorAsync"] testFile="StreamIdGeneratorCoverageTests.cs" testMethod="Generator_EventRecordWithStreamIdOnParameter_GeneratesExtractorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs"}
using System;
using Whizbang.Core;

namespace TestNamespace;

public record ParamOrderPlaced([StreamId] Guid OrderId, string ProductName) : IEvent;
```

A `[StreamId]` property works the same way:

```csharp{title="[StreamId] on a property" description="Marking the identifying property clears WHIZ009 and reports WHIZ010 instead." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ009", "StreamId", "Events"] tests=["StreamIdGeneratorTests.Generator_ReportsInfoDiagnostic_WhenPropertyDiscoveredAsync"] testFile="StreamIdGeneratorTests.cs" testMethod="Generator_ReportsInfoDiagnostic_WhenPropertyDiscoveredAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs"}
public record CreateOrder : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
}
```

One trap: on a class (not a record), a constructor parameter marked `[StreamId]` with **no property of the same
name** (compared case-insensitively) silences WHIZ009 but generates no extractor either, because there is no property to read at runtime. Put
`[StreamId]` on a property in that case.

## Suppressing

WHIZ009 has a source location, so it can be suppressed around a single type:

```csharp{title="Suppress WHIZ009 for one type" description="Pragma suppression around an event type that intentionally has no stream ID." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ009", "Suppression", "Pragma"] unverified="suppression/config, not exercised by a test"}
#pragma warning disable WHIZ009
public record HeartbeatEvent : IEvent;
#pragma warning restore WHIZ009
```

Or for a whole project in `.editorconfig`:

```ini{title="Silence WHIZ009 in .editorconfig" description="Severity setting that turns off the missing stream ID warning." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ009", "Suppression", "editorconfig"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ009.severity = none
```

Suppress it only for an event whose stream ID is never resolved, and know that the message's warning still holds:
anything that does try to resolve that event's stream ID will fail. A project-wide suppression hides newly added
events that genuinely need `[StreamId]`, so prefer the per-type pragma.

## Related

- [WHIZ010: StreamId Discovered](whiz010)
- [WHIZ030: Perspective Event Missing StreamId](whiz030)
- [WHIZ004: Command Stream ID Discovered](whiz004)
- [StreamId Attribute](../../extending/attributes/streamid)
- [Stream ID](../../fundamentals/events/stream-id)
