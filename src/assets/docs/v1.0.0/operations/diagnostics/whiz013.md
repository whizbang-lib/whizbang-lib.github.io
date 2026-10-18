---
title: 'WHIZ013: GenerateStreamId requires a settable StreamId'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error when [GenerateStreamId] is applied to a message whose Guid [StreamId] property has no ordinary setter, so the
  id minted at dispatch could never be written back and would stay empty.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - stream-id
  - generate-stream-id
  - source-generator
  - messages
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ013: GenerateStreamId requires a settable StreamId

**Severity**: Error
**Category**: Stream ID

## Description

`[GenerateStreamId]` asks the framework to mint a new stream id when the message is dispatched. The minted value is
written back into the message through a generated `SetStreamId` writer, and that writer can only assign a mutable
`Guid` property (`get; set;`).

When the `[StreamId]` property is `init`-only or get-only, the writer has nowhere to put the value. Without this error
the attribute would be a silent no-op: the id would stay empty and dispatch would fail later, at the outbox. WHIZ013
turns that runtime failure into a build error.

The `StreamIdGenerator` reports it when all of these are true:

- the type is an event or a command that carries a `[StreamId]` property;
- `[GenerateStreamId]` applies to it (on the property or parameter, or on the type itself);
- the stream id property's type is `Guid`;
- the property has no ordinary setter (it is `init`-only or has no setter at all).

A mutable `get; set;` property never triggers it. Positional record parameters produce `init`-only properties, so they
are reported as well.

## Diagnostic Message

```
Type '{TypeName}' has [GenerateStreamId] on the init-only property '{PropertyName}'. The framework mints the id at dispatch and writes it back through a generated setter, which cannot target an init-only property, so the id would silently stay empty and dispatch would fail at the outbox. Change '{PropertyName}' to a mutable 'get; set;' property.
```

The compiler output uses a dash where this page shows a comma after "init-only property". A get-only property is
reported with the same "init-only" wording.

## Common Causes

1. **A record-style `init` accessor** on the stream id property, which is the default habit for immutable messages.
2. **A get-only property** (`{ get; }`) carrying both `[StreamId]` and `[GenerateStreamId]`.
3. **A positional record parameter** such as `record OrderOpened([StreamId][GenerateStreamId] Guid OrderId)`, whose
   generated property is `init`-only.

## How to Fix

Change the `[StreamId]` property to `get; set;`. If you do not want the framework to mint the id, remove
`[GenerateStreamId]` and assign the stream id yourself before dispatch.

### Before (causes WHIZ013)

```csharp{title="GenerateStreamId on an init-only stream id" description="The minted id cannot be written to an init-only property, so the generator reports WHIZ013 as an error." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "stream-id", "generate-stream-id", "error"] testFile="StreamIdGeneratorTests.cs" testMethod="Generator_GenerateStreamIdOnInitOnlyProperty_ReportsWHIZ013ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs" tests=["StreamIdGeneratorTests.Generator_GenerateStreamIdOnInitOnlyProperty_ReportsWHIZ013ErrorAsync"]}
using System;
using Whizbang.Core;

namespace TestNamespace;

public record ArchiveAll : IEvent {
  [StreamId]
  [GenerateStreamId]
  public Guid StreamId { get; init; }  // WHIZ013: init-only
}
```

### After (compiles successfully)

```csharp{title="GenerateStreamId on a mutable stream id" description="A get; set; stream id is the shape the generated writer can target, so no diagnostic is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "stream-id", "generate-stream-id"] testFile="StreamIdGeneratorTests.cs" testMethod="Generator_GenerateStreamIdOnMutableProperty_DoesNotReportWHIZ013Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs" tests=["StreamIdGeneratorTests.Generator_GenerateStreamIdOnMutableProperty_DoesNotReportWHIZ013Async"]}
using System;
using Whizbang.Core;

namespace TestNamespace;

public record ArchiveAll : IEvent {
  [StreamId]
  [GenerateStreamId]
  public Guid StreamId { get; set; }
}
```

The same rule applies to commands
{verified: StreamIdGeneratorCoverageTests.Generator_CommandGenerateStreamIdOnInitOnlyProperty_ReportsWHIZ013Async}
and to get-only properties
{verified: StreamIdGeneratorBranchTests.GetOnlyStreamIdWithGenerate_IsWhiz013Async}.

## Related

- [GenerateStreamId Attribute](../../extending/attributes/generatestreamid)
- [StreamId Attribute](../../extending/attributes/streamid)
- [Stream ID: Automatic Generation](../../fundamentals/events/stream-id#auto-generation)
- [Empty Stream ID Policy](../configuration/empty-stream-id-policy)
- [Aggregate IDs (source generator)](../../extending/source-generators/aggregate-ids)
