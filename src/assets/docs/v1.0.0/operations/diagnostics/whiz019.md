---
title: 'WHIZ019: InheritFrom On A Stream ID That Is Not A Strong ID'
pageType: troubleshooting
verifiedAgainstCommit: '45ab3188'
verifiedDate: 2026-11-10
description: >-
  Error reported on a [StreamId(InheritFrom = ...)] whose stream id is not a strong id. Only a strong-id stream id
  refuses a source of another id type, so the option has no effect.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - streamid
  - whizbang-id
  - strongly-typed-ids
  - analyzer
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdInheritFromAnalyzer.cs
  - src/Whizbang.Generators/Utilities/StrongIdStreamIds.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdInheritFromAnalyzerTests.cs
lastMaintainedCommit: '45ab3188'
---

# WHIZ019: InheritFrom On A Stream ID That Is Not A Strong ID

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

A strong-id stream id refuses to inherit the stream of a source message with another strong-id type, unless
`InheritFrom` lists that type. A stream id that is not a strong id (a `Guid`, a `string`) carries no id type to
protect, so it inherits any source's stream as it always has, and `InheritFrom` on it does nothing. WHIZ019 is reported
on the attribute when the list names anything
{verified: StreamIdInheritFromAnalyzerTests.InheritFromOnAStreamIdThatIsNotAStrongId_ReportsWhiz019Async, StreamIdInheritFromAnalyzerTests.AnEmptyInheritFromOnAGuidStreamId_IsNotReportedAsync}.

## Diagnostic Message

```text
{TypeName}.{PropertyName} sets InheritFrom, but its type '{PropertyType}' is not a strong id; a stream id that is not a strong id inherits any source's stream, so InheritFrom has no effect. Remove InheritFrom, or make {PropertyName} a [WhizbangId] type.
```

## How to Fix

Remove `InheritFrom`, or make the stream id a strong id when the type check is what you want.

### Before (reports WHIZ019)

```csharp{title="InheritFrom on a Guid stream id" description="A Guid stream id inherits any source's stream, so InheritFrom has no effect and WHIZ019 is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ019", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.InheritFromOnAStreamIdThatIsNotAStrongId_ReportsWhiz019Async"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class InvoiceNoted : IEvent {
  [StreamId(InheritFrom = [typeof(OrderId)])]   // WHIZ019
  public Guid InvoiceId { get; set; }
}
```

### After

```csharp{title="A strong-id stream id with InheritFrom" description="The stream id is a strong id, so InheritFrom names the other id type it accepts." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ019", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.ListedStrongIds_AreNotReportedAsync"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand {
  [StreamId(InheritFrom = [typeof(OrderId)])]
  public InvoiceId InvoiceId { get; set; }
}
```

## Related

- [StreamId Attribute: inheriting a stream of another id type](../../extending/attributes/streamid#inheriting-a-stream-of-another-id-type)
- [WhizbangIds](../../fundamentals/identity/whizbang-ids)
- [WHIZ018: Stream ID Inherits From A Type That Is Not A Strong ID](whiz018)
