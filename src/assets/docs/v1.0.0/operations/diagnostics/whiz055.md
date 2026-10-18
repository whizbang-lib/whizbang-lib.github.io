---
title: 'WHIZ055: Guid.NewGuid() Usage'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic for each call to Guid.NewGuid(), which creates a random UUIDv4 that is not time-ordered.
  Use TrackedGuid.New() or a [WhizbangId] type to get a time-ordered UUIDv7 instead.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - guid
  - trackedguid
  - whizbang-id
  - analyzer
  - identity
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/GuidUsageAnalyzer.cs
  - src/Whizbang.Generators/GuidInterceptorGenerator.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuid.cs
testReferences:
  - tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/GuidUsageAnalyzerCoverageTests.cs
  - tests/Whizbang.Generators.Tests/GuidInterceptorGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ055: Guid.NewGuid() Usage

**Severity**: Warning
**Category**: Guid Usage

## Description

The `GuidUsageAnalyzer` reports WHIZ055 at every call to `Guid.NewGuid()`. That method creates a UUIDv4, which is
random: ids created one after another do not sort in creation order, and they carry no timestamp. Whizbang stores
events, messages and read models keyed by ids, and time-ordered ids keep those keys in insertion order.

`TrackedGuid.New()` creates a UUIDv7 with sub-millisecond precision and records where the value came from. A
`[WhizbangId]` type such as `OrderId` uses `TrackedGuid.New()` internally and adds a strong type on top. See
[WhizbangIds](../../fundamentals/identity/whizbang-ids) for both.

### When it fires, and when it does not

- It fires once per **invocation written as a member access** that binds to `System.Guid.NewGuid`, for example
  `Guid.NewGuid()` or `System.Guid.NewGuid()`. Three calls produce three warnings.
- It does not fire for other `Guid` members such as `Guid.Parse(...)` or `Guid.Empty`.
- It does not analyze generated code.
- It only looks at invocations written as `Something.NewGuid()`. A call with no receiver (for example `NewGuid()`
  after `using static System.Guid;`) and a method group that is not invoked (`Func<Guid> f = Guid.NewGuid;`) are not
  reported.

## Diagnostic Message

```text{title="WHIZ055 message" description="The descriptor's message; it has no placeholders" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ055", "Guid", "Diagnostics"] unverified="message text read from the descriptor"}
Use TrackedGuid.New() or a [WhizbangId] type instead of Guid.NewGuid(). UUIDv4 is not time-ordered.
```

## Common Causes

1. **Habit**: `Guid.NewGuid()` is the default way to make an id in .NET.
2. **Ids for streams, events or commands** created directly instead of through a strongly typed id.
3. **Code copied from samples or older projects** that predate `TrackedGuid`.

## How to Fix

Replace the call with `TrackedGuid.New()`, or with `New()` on a `[WhizbangId]` type.

### Before (causes WHIZ055)

```csharp{title="Before (causes WHIZ055)" description="A Guid.NewGuid() call that the analyzer reports" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ055", "Guid", "Analyzer"] testFile="GuidUsageAnalyzerTests.cs" testMethod="Analyzer_GuidNewGuid_ReportsWHIZ055ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs" tests=["GuidUsageAnalyzerTests.Analyzer_GuidNewGuid_ReportsWHIZ055ErrorAsync"]}
using System;

namespace TestApp;

public class MyService {
  public Guid CreateId() {
    return Guid.NewGuid();  // WHIZ055
  }
}
```

### After (no diagnostic)

```csharp{title="After (no WHIZ055)" description="TrackedGuid.New() creates a time-ordered UUIDv7" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ055", "TrackedGuid", "Identity"] testFile="GuidUsageAnalyzerTests.cs" testMethod="Analyzer_TrackedGuidNew_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs" tests=["GuidUsageAnalyzerTests.Analyzer_TrackedGuidNew_NoErrorAsync"]}
using Whizbang.Core.ValueObjects;

namespace TestApp;

public class MyService {
  public TrackedGuid CreateId() {
    return TrackedGuid.New();
  }
}
```

If you need a random UUIDv4 on purpose, `TrackedGuid.NewRandom()` creates one and records that it is a version 4
value, so later code can tell it is not time-ordered.

## Suppressing

Suppress WHIZ055 only where a random, non-ordered id is genuinely what you want, such as an internal correlation or
tracking value that is never used as a stored key. Whizbang itself does this in a few places. Test projects are
another common case.

```csharp{title="Suppress WHIZ055 with a pragma" description="Pragma suppression around an intentional Guid.NewGuid()" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ055", "Suppression", "Pragma"] testFile="GuidUsageAnalyzerTests.cs" testMethod="Analyzer_WithPragmaSuppress_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs" tests=["GuidUsageAnalyzerTests.Analyzer_WithPragmaSuppress_NoErrorAsync"]}
public class MyService {
#pragma warning disable WHIZ055
  public Guid CreateId() {
    return Guid.NewGuid();
  }
#pragma warning restore WHIZ055
}
```

```ini{title="Suppress WHIZ055 in .editorconfig" description="Severity override for a folder or project" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ055", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ055.severity = none
```

**The pragma also affects Guid interception.** When `WhizbangGuidInterceptionEnabled` is on, the
`GuidInterceptorGenerator` skips any `Guid.NewGuid()` or `Guid.CreateVersion7()` call that sits inside an active
`#pragma warning disable WHIZ055` (or `WHIZ056`) region, so that call is not wrapped as a `TrackedGuid`. `.editorconfig`
and `NoWarn` only change the warning; they do not stop interception. To skip interception explicitly, use
`[SuppressGuidInterception]` (see [WHIZ059](whiz059)). {verified: GuidInterceptorGeneratorTests.Generator_PragmaDisableWhiz055_SuppressesInterceptionAsync}

## Related

- [WHIZ056: Guid.CreateVersion7() Usage](whiz056)
- [WHIZ057: Raw Guid Parameter](whiz057)
- [WHIZ058: GUID Call Intercepted](whiz058)
- [WHIZ059: GUID Interception Suppressed](whiz059)
- [WhizbangIds and TrackedGuid](../../fundamentals/identity/whizbang-ids)
- [GuidUsageAnalyzer](../../fundamentals/identity/whizbang-ids#analyzer)
