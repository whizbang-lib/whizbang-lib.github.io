---
title: 'WHIZ005: Stream ID Must Be Guid'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic defined for a [StreamId] on a property that is not a Guid. In this release no generator reports
  it, and the stream ID generator accepts other property types.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - streamid
  - source-generator
  - reserved
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ005: Stream ID Must Be Guid

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

WHIZ005 is defined to reject a `[StreamId]` placed on a property whose type is not `Guid`, `Guid?`, or a type with a
`.Value` property returning `Guid` (such as a WhizbangId type). The descriptor exists in the generator package, but
**no generator or analyzer in this release reports it**. The only test that names it checks the descriptor's ID and
severity.

The stream ID generator does not enforce the restriction the message describes. When it builds an extractor it
chooses the extraction code by the property's type:

- `Guid` and `Guid?` get Guid extractors,
- `string` gets a string extractor,
- other value types (for example a value-object struct) are converted with `ToString()`,
- any other type falls back to a general extractor.

So a `[StreamId]` on a `string` property, for example, builds without WHIZ005.

## Diagnostic Message

```text
[StreamId] on {TypeName}.{PropertyName} must be of type Guid, Guid?, or a type with a .Value property returning Guid
```

## Common Causes

None in this release: no code path in the generators reports this ID.

## How to Fix

There is nothing to fix for WHIZ005 itself. A `Guid` (or a WhizbangId type) remains the most common stream ID type,
and some features are specific to it: for example, `[GenerateStreamId]` writes a minted id back only to a mutable
`Guid` property (see [GenerateStreamId](../../extending/attributes/generatestreamid)).

## Related

- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [WHIZ009: Missing StreamId Attribute](whiz009)
- [WHIZ010: StreamId Discovered](whiz010)
- [StreamId Attribute](../../extending/attributes/streamid)
- [WhizbangId Types](../../fundamentals/identity/whizbang-ids)
- [Stream ID](../../fundamentals/events/stream-id)
