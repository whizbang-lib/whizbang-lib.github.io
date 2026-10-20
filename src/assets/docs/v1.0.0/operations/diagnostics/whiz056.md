---
title: 'WHIZ056: Guid.CreateVersion7() Usage'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic for each call to Guid.CreateVersion7(), whose UUIDv7 has only millisecond precision. Use
  TrackedGuid.New() or a [WhizbangId] type for sub-millisecond ordering.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - guid
  - uuidv7
  - trackedguid
  - analyzer
  - identity
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/GuidUsageAnalyzer.cs
  - src/Whizbang.Generators/GuidInterceptorGenerator.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuid.cs
testReferences:
  - tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/GuidInterceptorGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ056: Guid.CreateVersion7() Usage

**Severity**: Warning
**Category**: Guid Usage

## Description

The `GuidUsageAnalyzer` reports WHIZ056 at every call to `Guid.CreateVersion7()`. That method does produce a
time-ordered UUIDv7, but its timestamp has only **millisecond** precision. Ids created within the same millisecond
are not guaranteed to sort in creation order.

`TrackedGuid.New()` creates a UUIDv7 with sub-millisecond precision and records where the value came from. A
`[WhizbangId]` type such as `OrderId` uses it internally. See
[WhizbangIds](../../fundamentals/identity/whizbang-ids#tracked-guid).

### When it fires, and when it does not

- It fires once per **invocation written as a member access** that binds to `System.Guid.CreateVersion7`, for
  example `Guid.CreateVersion7()`.
- It does not analyze generated code.
- A call with no receiver (for example after `using static System.Guid;`) and a method group that is not invoked are
  not reported.

## Diagnostic Message

```text{title="WHIZ056 message" description="The descriptor's message; it has no placeholders" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ056", "Guid", "Diagnostics"] unverified="message text read from the descriptor"}
Use TrackedGuid.New() for sub-millisecond precision instead of Guid.CreateVersion7()
```

## Common Causes

1. **Moving off `Guid.NewGuid()`** to the built-in UUIDv7 method, which is a step in the right direction but not the
   one Whizbang recommends.
2. **High-throughput id creation**, such as generating many event ids in a loop, where same-millisecond ties matter.

## How to Fix

Replace the call with `TrackedGuid.New()`, or with `New()` on a `[WhizbangId]` type.

### Before (causes WHIZ056)

```csharp{title="Before (causes WHIZ056)" description="A Guid.CreateVersion7() call that the analyzer reports" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ056", "Guid", "Analyzer"] testFile="GuidUsageAnalyzerTests.cs" testMethod="Analyzer_GuidCreateVersion7_ReportsWHIZ056WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs" tests=["GuidUsageAnalyzerTests.Analyzer_GuidCreateVersion7_ReportsWHIZ056WarningAsync"]}
using System;

namespace TestApp;

public class MyService {
  public Guid CreateV7Id() {
    return Guid.CreateVersion7();  // WHIZ056
  }
}
```

### After (no diagnostic)

```csharp{title="After (no WHIZ056)" description="TrackedGuid.New() creates a UUIDv7 with sub-millisecond precision" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ056", "TrackedGuid", "Identity"] testFile="GuidUsageAnalyzerTests.cs" testMethod="Analyzer_TrackedGuidNew_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/GuidUsageAnalyzerTests.cs" tests=["GuidUsageAnalyzerTests.Analyzer_TrackedGuidNew_NoErrorAsync"]}
using Whizbang.Core.ValueObjects;

namespace TestApp;

public class MyService {
  public TrackedGuid CreateV7Id() {
    return TrackedGuid.New();
  }
}
```

If you specifically need the value `Guid.CreateVersion7()` produces, `TrackedGuid.NewMicrosoftV7()` wraps that call
and records that the value has millisecond precision.

## Suppressing

Suppress WHIZ056 only where millisecond precision is enough and the id is not one Whizbang orders by, or in test code.

```csharp{title="Suppress WHIZ056 with a pragma" description="Pragma suppression around an intentional Guid.CreateVersion7()" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ056", "Suppression", "Pragma"] unverified="suppression syntax; the pragma test in GuidUsageAnalyzerTests covers WHIZ055"}
#pragma warning disable WHIZ056
var externalId = Guid.CreateVersion7();
#pragma warning restore WHIZ056
```

```ini{title="Suppress WHIZ056 in .editorconfig" description="Severity override for a folder or project" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ056", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ056.severity = none
```

**The pragma also affects Guid interception.** When `WhizbangGuidInterceptionEnabled` is on, the
`GuidInterceptorGenerator` skips any `Guid.NewGuid()` or `Guid.CreateVersion7()` call inside an active
`#pragma warning disable WHIZ056` (or `WHIZ055`) region, so the call is not wrapped as a `TrackedGuid`
{verified: GuidInterceptorGeneratorTests.Generator_PragmaDisableWhiz056_SuppressesInterceptionAsync}. `.editorconfig` and
`NoWarn` only change the warning; they do not stop interception.

## Related

- [WHIZ055: Guid.NewGuid() Usage](whiz055)
- [WHIZ057: Raw Guid Parameter (retired)](whiz057)
- [WHIZ058: GUID Call Intercepted](whiz058)
- [WhizbangIds and TrackedGuid](../../fundamentals/identity/whizbang-ids)
- [GuidUsageAnalyzer](../../fundamentals/identity/whizbang-ids#analyzer)
