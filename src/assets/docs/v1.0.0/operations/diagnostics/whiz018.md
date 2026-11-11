---
title: 'WHIZ018: Stream ID Inherits From A Type That Is Not A Strong ID'
pageType: troubleshooting
verifiedAgainstCommit: '45ab3188'
verifiedDate: 2026-11-10
description: >-
  Error reported on a [StreamId(InheritFrom = ...)] that lists a type that is not a strong id. A source's stream-id
  type is only ever a strong id, so the entry could never match.
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

# WHIZ018: Stream ID Inherits From A Type That Is Not A Strong ID

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

`[StreamId(InheritFrom = ...)]` names the strong-id types, beyond the stream id's own, whose stream a cascaded message
may inherit from the message that caused it. The dispatcher compares the source message's stream-id type with the
list, and a source reports a type only when its stream id is a strong id (a `[WhizbangId]` type, or one that
implements `IWhizbangId`). A source whose stream id is a plain `Guid` is always accepted, without being listed.

So a listed `Guid`, `string` or other type that is not a strong id can never match, and WHIZ018 is reported on the
`[StreamId]` for each such entry
{verified: StreamIdInheritFromAnalyzerTests.AListedTypeThatIsNotAStrongId_ReportsWhiz018Async}.

## Diagnostic Message

```text
InheritFrom on {TypeName}.{PropertyName} lists '{ListedType}', which is not a strong id ([WhizbangId] or IWhizbangId); a source's stream-id type is only ever a strong id, so this entry never matches. List only strong-id types.
```

## How to Fix

Remove the entry. A source whose stream id is a `Guid` is already accepted; a source whose stream id is a strong id is
listed by that strong id's type.

### Before (reports WHIZ018)

```csharp{title="A listed type that is not a strong id" description="Guid is not a strong id, so the entry never matches and WHIZ018 is reported on the attribute." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ018", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.AListedTypeThatIsNotAStrongId_ReportsWhiz018Async"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand {
  [StreamId(InheritFrom = [typeof(OrderId), typeof(Guid)])]   // WHIZ018
  public InvoiceId InvoiceId { get; set; }
}
```

### After

```csharp{title="Only strong ids listed" description="Only the strong id is listed; a Guid source is accepted without being listed." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ018", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.ListedStrongIds_AreNotReportedAsync"]}
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
- [WHIZ019: InheritFrom On A Stream ID That Is Not A Strong ID](whiz019)
- [WHIZ034: InheritFrom Lists The Stream ID's Own Type](whiz034)
