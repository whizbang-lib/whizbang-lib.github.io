---
title: 'WHIZ017: Stream ID Generation Opt-Out Cannot Hold Across Assemblies (retired)'
pageType: troubleshooting
verifiedAgainstCommit: '0a29f1a5'
verifiedDate: 2026-11-20
description: >-
  Retired. WHIZ017 warned that a derived type's opt-out from its base's [GenerateStreamId] did not hold when the base
  was compiled in another assembly. Stream ids now resolve by a message's exact type across assemblies, so the opt-out
  holds and the warning is no longer reported. The ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - generatestreamid
  - inheritance
  - analyzer
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Core/Registry/StreamIdTypeRegistry.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdCrossAssemblyGenerationAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdTypeTableGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '0a29f1a5'
---

# WHIZ017: Stream ID Generation Opt-Out Cannot Hold Across Assemblies (retired)

**Status**: Retired in [whizbang-lib/whizbang#1905](https://github.com/whizbang-lib/whizbang/issues/1905). No longer
reported.
**Former severity**: Warning

## Retired

WHIZ017 is **retired**. The case it warned about can no longer happen, so the analyzer no longer reports it and its
descriptor has been removed from the generator package
{verified: StreamIdCrossAssemblyGenerationAnalyzerTests.OwnStreamId_UnderAGeneratingBaseInAnotherAssembly_IsNoLongerReportedAsync, StreamIdCrossAssemblyGenerationAnalyzerTests.Whiz017_IsRetiredAndNeverReusedAsync}.
The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for it can never match a
different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

A type that declares its own `[StreamId]`, plain or `Override = true`, and no `[GenerateStreamId]` does not inherit its
base's `[GenerateStreamId]`: its stream ID is not auto-generated. Before #1905 that opt-out held only within one
assembly. Each assembly registered its own stream ID extractor, and when the base type was compiled in another assembly
and declared `[GenerateStreamId]`, the base assembly's extractor answered "generate" for the derived instance first, so
the base's policy still applied. WHIZ017 was reported on the derived type's own `[StreamId]` in that case, with this
message:

```text
Type {TypeName} declares its own [StreamId] '{PropertyName}' and no [GenerateStreamId], but base type {BaseTypeName} declares [GenerateStreamId]; the base's [GenerateStreamId] will still apply because the base is in another assembly ({BaseAssemblyName}). Declare [GenerateStreamId] on {TypeName}, or move {BaseTypeName} into the same assembly.
```

## Why It Was Retired

Each assembly's generator now registers one entry per message type it compiles, holding that exact type's stream ID
and `[GenerateStreamId]` policy, and a message resolves by its exact runtime type before any base type's entry (see
[How a message type finds its stream ID](../../extending/attributes/streamid#how-a-message-type-finds-its-stream-id)).
The derived type's own assembly records the opt-out in its entry, so the opt-out holds wherever the base is compiled
{verified: StreamIdTypeTableGeneratorTests.ADerivedTypeInAnotherAssemblyWithItsOwnStreamId_UsesItsOwnPropertyAndPolicyAsync, StreamIdTypeTableGeneratorTests.AChainSpanningThreeAssemblies_ResolvesTheNearestLevelAsync}.
The workarounds the warning suggested (declaring `[GenerateStreamId]` on the derived type, or moving the base into the
same assembly) are no longer needed; a derived type that declares `[GenerateStreamId]` itself still generates, as it
always did.

## If You Suppress It

A suppression of WHIZ017 now has no effect. Delete it: remove any `#pragma warning disable WHIZ017` /
`#pragma warning restore WHIZ017` lines, any `dotnet_diagnostic.WHIZ017.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ017 from any `<NoWarn>` list. Check what the suppressed code relied on: a derived type in
another assembly with its own `[StreamId]` and no `[GenerateStreamId]` is no longer auto-generated. Declare
`[GenerateStreamId]` on it if it should be.

## Related

- [StreamId Attribute: how a message type finds its stream ID](../../extending/attributes/streamid#how-a-message-type-finds-its-stream-id)
- [GenerateStreamId Attribute](../../extending/attributes/generatestreamid)
- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [WHIZ016: Stream ID Override Has Nothing to Override](whiz016)
