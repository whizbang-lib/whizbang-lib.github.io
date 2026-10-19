---
title: 'WHIZ006: Multiple Stream ID Attributes'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Warning reported on each extra [StreamId] attribute when a type marks more than one property or primary-constructor
  parameter with [StreamId]. Only the first is used; the others are ignored.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - source-generator
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdAttributeAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ006: Multiple Stream ID Attributes

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

A message has one stream ID. When the stream ID generator builds an extractor for a type, it uses the **first**
`[StreamId]` it finds and ignores any others. WHIZ006 warns about each `[StreamId]` that is ignored, so a second
attribute can no longer pass the build while doing nothing.

The analyzer looks at the `[StreamId]` attributes the type declares itself, on properties and on primary-constructor
parameters. The first one in declaration order is the one used; the warning is reported on every later attribute, at
the attribute itself, and names the property that is used.

A record parameter written `[property: StreamId]` puts the attribute on the generated property. The parameter and its
property have the same name, so they count once and do not trigger the warning.

The property type does not matter: any type may be a stream ID (`Guid`, `string`, or a strongly typed ID). The
retired [WHIZ005](whiz005) once described a "must be a Guid" rule that never existed.

An event used by a perspective with more than one `[StreamId]` is also an error, [WHIZ031](whiz031), so it fails the
build on top of this warning.

## Diagnostic Message

```text
Type {TypeName} has multiple [StreamId] attributes. Only the first property '{PropertyName}' will be used.
```

## Common Causes

1. **A related ID was marked as well**, for example a customer ID on an order event, because it "is also an ID".
2. **A property was copied** from another message with its attribute.
3. **The stream ID was changed** to another property and the old attribute was left behind.

## How to Fix

Keep `[StreamId]` on the one property that identifies the stream, and remove it from the others.

### Before (reports WHIZ006 on the second attribute)

```csharp{title="Two [StreamId] properties" description="The second [StreamId] is ignored, so WHIZ006 is reported on it, naming OrderId as the property used." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ006", "StreamId", "Events"] tests=["StreamIdAttributeAnalyzerTests.TwoStreamIds_ReportWhiz006OnTheSecondNamingTheOneUsedAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId] public System.Guid OrderId { get; init; }
  [StreamId] public System.Guid CustomerId { get; init; }   // WHIZ006: ignored
}
```

### After

```csharp{title="One stream ID per message" description="Keep [StreamId] on the property that identifies the stream; related IDs are plain properties. A single [StreamId] of any type is not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ006", "StreamId", "Events"] tests=["StreamIdAttributeAnalyzerTests.ASingleStreamIdOfAnyType_IsNotReportedAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId] public System.Guid OrderId { get; init; }      // the stream this event belongs to
  public System.Guid CustomerId { get; init; }              // related ID, not a stream ID
}
```

## Suppressing

Prefer fixing the type: an ignored `[StreamId]` misleads readers and never takes effect. If you must, the warning
can be silenced with `#pragma warning disable WHIZ006` around the type or `dotnet_diagnostic.WHIZ006.severity = none`
in `.editorconfig`.

## Related

- [WHIZ031: Multiple StreamId Attributes](whiz031)
- [WHIZ005: Stream ID Must Be Guid (retired)](whiz005)
- [WHIZ010: StreamId Discovered](whiz010)
- [StreamId Attribute](../../extending/attributes/streamid)
