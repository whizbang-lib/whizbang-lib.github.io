---
title: 'WHIZ035: IHasStreamId Is Written Instead Of A Strong-ID Stream ID'
pageType: troubleshooting
verifiedAgainstCommit: '45ab3188'
verifiedDate: 2026-11-10
description: >-
  Warning reported when a message implements IHasStreamId and its [StreamId] is a strong id. The dispatcher writes
  generated and inherited stream ids through IHasStreamId, so the strong-id stream id is never written.
version: 1.0.0
category: Diagnostics
severity: Warning
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

# WHIZ035: IHasStreamId Is Written Instead Of A Strong-ID Stream ID

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

`IHasStreamId` is the explicit runtime contract for a message's stream id. When a message implements it, the dispatcher
writes a stream id it generates (`[GenerateStreamId]`) or one a cascaded message inherits from its source through
`IHasStreamId.StreamId`, and never through the generated setter of the `[StreamId]` property.

When that `[StreamId]` is a strong id, it is a different property from `IHasStreamId.StreamId`: the message is routed
by the strong id, while the dispatcher writes the `Guid`. The strong id stays empty, and its `InheritFrom` never
applies. WHIZ035 is reported once, on the `[StreamId]` when the type declares it, or on the type that adds
`IHasStreamId` over an inherited strong-id stream id
{verified: StreamIdInheritFromAnalyzerTests.IHasStreamIdWithAStrongIdStreamId_ReportsWhiz035Async, StreamIdInheritFromAnalyzerTests.IHasStreamIdOnADerivedTypeOverAStrongIdBase_ReportsWhiz035OnTheTypeAsync}.

## Diagnostic Message

```text
{TypeName} implements IHasStreamId and its [StreamId] '{PropertyName}' is a strong id; the dispatcher writes generated and inherited stream ids through IHasStreamId, so '{PropertyName}' is not written and its InheritFrom does not apply. Remove IHasStreamId, or make the [StreamId] a Guid.
```

## How to Fix

Remove `IHasStreamId`; the generated setter writes the strong id. Keep `IHasStreamId` only on a message whose
`[StreamId]` is the `Guid` it exposes.

### Before (reports WHIZ035)

```csharp{title="IHasStreamId beside a strong-id stream id" description="The dispatcher writes the Guid StreamId, while the message is routed by InvoiceId, so WHIZ035 is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ035", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.IHasStreamIdWithAStrongIdStreamId_ReportsWhiz035Async"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand, IHasStreamId {
  [StreamId] public InvoiceId InvoiceId { get; set; }   // WHIZ035
  public Guid StreamId { get; set; }
}
```

### After

```csharp{title="A strong-id stream id written by the generated setter" description="Without IHasStreamId the generated setter writes InvoiceId through its From." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ035", "StreamId", "WhizbangId"] tests=["StrongIdStreamInheritanceGeneratorTests.APlainGuidSource_IsWrittenAsync"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand {
  [StreamId] public InvoiceId InvoiceId { get; set; }
}
```

## Suppressing

Silence it with `#pragma warning disable WHIZ035` or `dotnet_diagnostic.WHIZ035.severity = none` only when the
message sets its strong id itself and never relies on the dispatcher to write it.

## Related

- [StreamId Attribute: inheriting a stream of another id type](../../extending/attributes/streamid#inheriting-a-stream-of-another-id-type)
- [WhizbangIds](../../fundamentals/identity/whizbang-ids)
