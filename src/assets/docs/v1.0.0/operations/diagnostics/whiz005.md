---
title: 'WHIZ005: Stream ID Must Be Guid (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ005 (Stream ID Must Be Guid) was declared but never reported, and described a rule that does not exist:
  any property type may be a stream ID. It is removed from the generator package and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - streamid
  - source-generator
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ005: Stream ID Must Be Guid (retired)

**Status**: Retired. Never reported.
**Former severity**: Error

## Retired

WHIZ005 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ005 was declared as an error for a `[StreamId]` on a property whose type is not `Guid`, `Guid?`, or a type with a
`.Value` property returning `Guid`. No generator ever reported it.

The message it would have shown:

```text
[StreamId] on {TypeName}.{PropertyName} must be of type Guid, Guid?, or a type with a .Value property returning Guid
```

## Why There Is No Rule

The rule it described does not exist. **Any property type may be a stream ID.** The stream ID generator picks the
extraction code by the property's type: `Guid` and `Guid?` get Guid extractors, `string` gets a string extractor, and
other types are keyed by their string form (`ToString()`). A `[StreamId]` on a `string` or on a value-object struct
builds and works.

A `Guid` (or a WhizbangId type) is still the most common stream ID type, and some features are specific to it: for
example, `[GenerateStreamId]` writes a minted ID back only to a mutable `Guid` property (see
[GenerateStreamId](../../extending/attributes/generatestreamid)). A type with more than one `[StreamId]` is reported by
[WHIZ006](whiz006).

## If You Suppress It

A suppression of WHIZ005 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ005` /
`#pragma warning restore WHIZ005` lines, any `dotnet_diagnostic.WHIZ005.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ005 from any `<NoWarn>` list.

## Related

- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [WHIZ009: Missing StreamId Attribute](whiz009)
- [WHIZ010: StreamId Discovered](whiz010)
- [StreamId Attribute](../../extending/attributes/streamid)
- [WhizbangId Types](../../fundamentals/identity/whizbang-ids)
- [Stream ID](../../fundamentals/events/stream-id)
