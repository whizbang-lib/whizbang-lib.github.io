---
title: 'WHIZ034: InheritFrom Lists The Stream ID's Own Type'
pageType: troubleshooting
verifiedAgainstCommit: '45ab3188'
verifiedDate: 2026-11-10
description: >-
  Warning reported on a [StreamId(InheritFrom = ...)] that lists the stream id's own type, which is always accepted.
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

# WHIZ034: InheritFrom Lists The Stream ID's Own Type

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

A strong-id stream id always inherits the stream of a source whose stream id has the same type; that is the case the
type check exists to allow. Listing the stream id's own type in `InheritFrom` changes nothing, and WHIZ034 says so
{verified: StreamIdInheritFromAnalyzerTests.ListingTheStreamIdsOwnType_ReportsWhiz034Async}.

## Diagnostic Message

```text
InheritFrom on {TypeName}.{PropertyName} lists '{IdType}', the stream id's own type, which is always accepted. Remove it from the list.
```

## How to Fix

Remove the entry, and `InheritFrom` with it when nothing else is listed.

### Before (reports WHIZ034)

```csharp{title="The stream id's own type listed" description="InvoiceId is always accepted by an InvoiceId stream id, so WHIZ034 is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ034", "StreamId", "WhizbangId"] tests=["StreamIdInheritFromAnalyzerTests.ListingTheStreamIdsOwnType_ReportsWhiz034Async"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand {
  [StreamId(InheritFrom = [typeof(InvoiceId)])]   // WHIZ034
  public InvoiceId InvoiceId { get; set; }
}
```

### After

```csharp{title="A plain strong-id stream id" description="The same stream id with no InheritFrom: a source of the same id type, or a Guid source, is still inherited." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ034", "StreamId", "WhizbangId"] tests=["StrongIdStreamInheritanceGeneratorTests.ASourceOfTheSameStrongId_IsWrittenAsync"]}
using Whizbang.Core;

[WhizbangId] public readonly partial struct OrderId;
[WhizbangId] public readonly partial struct InvoiceId;

public class CreateInvoice : ICommand {
  [StreamId]
  public InvoiceId InvoiceId { get; set; }
}
```

## Suppressing

Prefer removing the entry. The warning can be silenced with `#pragma warning disable WHIZ034` or
`dotnet_diagnostic.WHIZ034.severity = none` in `.editorconfig`.

## Related

- [StreamId Attribute: inheriting a stream of another id type](../../extending/attributes/streamid#inheriting-a-stream-of-another-id-type)
- [WhizbangIds](../../fundamentals/identity/whizbang-ids)
- [WHIZ018: Stream ID Inherits From A Type That Is Not A Strong ID](whiz018)
