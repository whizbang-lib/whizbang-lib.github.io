---
title: 'WHIZ016: Stream ID Override Has Nothing to Override'
pageType: troubleshooting
verifiedAgainstCommit: 2d72e086
verifiedDate: 2026-10-27
description: >-
  Warning reported on a [StreamId(Override = true)] when no base type declares a [StreamId]. The option says the
  type replaces an inherited stream ID on purpose, so it is reported when there is nothing to replace.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - inheritance
  - analyzer
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Generators/Utilities/StreamIdSelection.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdAttributeAnalyzerTests.cs
lastMaintainedCommit: '2d72e086'
---

# WHIZ016: Stream ID Override Has Nothing to Override

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

`[StreamId(Override = true)]` marks a derived type's stream ID as one that replaces the `[StreamId]` it inherits, on
purpose. It is what keeps [WHIZ006](whiz006) quiet when a base command or event declares a default stream ID and a
derived type declares its own.

WHIZ016 reports the option where no base type declares a `[StreamId]`, on a property or on a primary-constructor
parameter, so there is nothing to replace
{verified: StreamIdAttributeAnalyzerTests.AnOverrideWithNothingToOverride_ReportsWhiz016OnTheAttributeAsync, StreamIdAttributeAnalyzerTests.AnOverrideParameterWithNothingToOverride_ReportsWhiz016Async}.
The stream ID still works: the marked property is used, exactly as a plain `[StreamId]` would be. The warning is
there so the option cannot linger after the base stops declaring a stream ID, where it would hide the next real
WHIZ006 if a base declared one again.

A `[StreamId]` on a base record's constructor parameter counts as one to replace
{verified: StreamIdAttributeAnalyzerTests.AnOverrideOverABaseParameterStreamId_IsNotReportedAsync}.

## Diagnostic Message

```text
Type {TypeName} marks '{PropertyName}' as a [StreamId] override, but no base type declares a [StreamId] to override
```

## Common Causes

1. **The base type stopped declaring a stream ID**, and the derived types kept the option.
2. **The option was copied** from a derived type onto a type that has no stream ID base.
3. **The type was moved** to a different base type that has no `[StreamId]`.

## How to Fix

Remove `Override = true`. A plain `[StreamId]` is the same stream ID when nothing is inherited.

### Before (reports WHIZ016)

```csharp{title="An override with nothing to override" description="OrderPlaced has no base type with a [StreamId], so Override = true replaces nothing and WHIZ016 is reported on the attribute." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ016", "StreamId", "Inheritance"] tests=["StreamIdAttributeAnalyzerTests.AnOverrideWithNothingToOverride_ReportsWhiz016OnTheAttributeAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId(Override = true)] public System.Guid OrderId { get; init; }   // WHIZ016
}
```

### After

```csharp{title="A plain stream ID" description="Without an inherited [StreamId], a plain [StreamId] is the stream ID and nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ016", "StreamId", "Events"] tests=["StreamIdAttributeAnalyzerTests.ASingleStreamIdOfAnyType_IsNotReportedAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId] public System.Guid OrderId { get; init; }
}
```

## Suppressing

Prefer removing the option. If you must, the warning can be silenced with `#pragma warning disable WHIZ016` around
the type or `dotnet_diagnostic.WHIZ016.severity = none` in `.editorconfig`.

## Related

- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [StreamId Attribute](../../extending/attributes/streamid)
