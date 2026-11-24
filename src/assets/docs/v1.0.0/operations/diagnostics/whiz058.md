---
title: 'WHIZ058: GUID Call Intercepted'
pageType: troubleshooting
verifiedAgainstCommit: '7b794a96'
verifiedDate: 2026-11-23
description: >-
  Informational diagnostic indicating a Guid.NewGuid() or Guid.CreateVersion7() call has been intercepted and
  replaced with TrackedGuid.New(), a time-ordered UUIDv7. Interception is on by default.
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - guid
  - interception
  - source-generator
  - trackedguid
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/GuidInterceptorGenerator.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuid.cs
testReferences:
  - tests/Whizbang.Generators.Tests/GuidInterceptorGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/ThirdPartyGuidInterceptionTests.cs
  - tests/Whizbang.Generators.Tests/GuidInterceptorRuntimeTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ058: GUID Call Intercepted

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

This informational diagnostic is reported for each `Guid.NewGuid()` or `Guid.CreateVersion7()` call the
`GuidInterceptorGenerator` intercepts. The interceptor replaces the call with `TrackedGuid.New()`, the framework's
UUIDv7 generator, so the call returns a time-ordered id with counter precision
{verified: GuidInterceptorGeneratorTests.Generator_InterceptedCall_ReportsWHIZ058DiagnosticAsync, GuidInterceptorGeneratorTests.Generator_NewGuid_IsReplacedWithTrackedGuidNewAsync, GuidInterceptorRuntimeTests.InterceptedNewGuid_WithTheDefaultConfiguration_ReturnsVersion7Async}.

Interception is **on by default**: a project that does not set `WhizbangGuidInterceptionEnabled` gets it. With it
turned off, no interceptor is generated and WHIZ058 is not reported
{verified: GuidInterceptorGeneratorTests.Generator_NoOptionSet_InterceptsByDefaultAsync, GuidInterceptorGeneratorTests.Generator_InterceptionSetToFalse_GeneratesAndReportsNothingAsync}.

Calls inside `Whizbang.*` namespaces are never intercepted (the library controls its own GUID creation), so no WHIZ058
is reported for them {verified: GuidInterceptorGeneratorTests.Generator_CallerInWhizbangNamespace_NotInterceptedAsync}.

## Diagnostic Message

```text{title="WHIZ058 message" description="{0} is the intercepted method, {1} and {2} the file and line" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ058", "Guid", "Diagnostics"] unverified="message text read from the descriptor"}
Intercepted System.Guid.NewGuid() at /src/MyApp/OrderService.cs:15 - replaced with TrackedGuid.New(), a time-ordered UUIDv7
```

## What Gets Intercepted

| Method | Replaced with |
|--------|---------------|
| `Guid.NewGuid()` | `TrackedGuid.New()` (UUIDv7) |
| `Guid.CreateVersion7()` | `TrackedGuid.New()` (UUIDv7 with counter precision) |

The intercepted method still returns a `Guid`. Third-party generators (Marten's `CombGuidIdGeneration`, UUIDNext,
Medo.Uuid7) are no longer intercepted: they already return time-ordered ids, and an interceptor cannot attach metadata
to the `Guid` they return
{verified: ThirdPartyGuidInterceptionTests.Generator_ThirdPartyCall_IsNotInterceptedAsync, ThirdPartyGuidInterceptionTests.Generator_MixedWithSystemGuid_InterceptsOnlySystemGuidAsync}.

## Turning Interception Off

**Turning interception off is strongly advised against.** Every `Guid.NewGuid()` in the project then returns a random
UUIDv4 again, and any of them that becomes an event or message id is refused at runtime by the
[time-ordering checks](../../fundamentals/identity/whizbang-ids#time-ordering-checks). Keep one deliberate v4 with
`[SuppressGuidInterception]` instead (below).

Only the value `false` turns it off; an unset, blank or unrecognized value leaves it on
{verified: GuidInterceptorGeneratorTests.IsInterceptionEnabled_OnlyFalseTurnsItOffAsync}:

```xml{title="Turning interception off (strongly advised against)" description="Only false turns Guid interception off" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Interception", "MSBuild"] tests=["GuidInterceptorGeneratorTests.Generator_InterceptionSetToFalse_GeneratesAndReportsNothingAsync", "GuidInterceptorRuntimeTests.InterceptionTurnedOff_ReturnsVersion4Async"]}
<PropertyGroup>
  <!-- Strongly advised against: Guid.NewGuid() returns a random v4 again -->
  <WhizbangGuidInterceptionEnabled>false</WhizbangGuidInterceptionEnabled>
</PropertyGroup>
```

The generated interceptors live in the `Whizbang.Generators.Generated` namespace. The generator package's props adds it
to `InterceptorsNamespaces`, so a NuGet consumer sets nothing; a project that references the generator as a project
adds `<InterceptorsNamespaces>$(InterceptorsNamespaces);Whizbang.Generators.Generated</InterceptorsNamespaces>`.

## Keeping One Call Unintercepted

Where a random v4 is genuinely wanted, keep the original call for that code only. Such an id must not become an event
or message id.

### Method-Level Suppression

```csharp{title="Method-Level Suppression" description="Method-Level Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Method-Level", "Suppression"] tests=["GuidInterceptorGeneratorTests.Generator_SuppressOnMethod_NoInterceptionAsync", "GuidInterceptorRuntimeTests.SuppressedNewGuid_ReturnsVersion4Async"]}
using Whizbang.Core;

[SuppressGuidInterception]
public Guid CreateRawGuid() {
  return Guid.NewGuid();  // Not intercepted: a random v4, WHIZ059 instead of WHIZ058
}
```

### Class-Level Suppression

```csharp{title="Class-Level Suppression" description="Class-Level Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Class-Level", "Suppression"] tests=["GuidInterceptorGeneratorTests.Generator_SuppressOnClass_NoInterceptionAsync"]}
[SuppressGuidInterception]
public class TestFixtures {
  // All GUID calls in this class are not intercepted
}
```

### Pragma Suppression

Wrapping a call in `#pragma warning disable WHIZ055` (or `WHIZ056`) disables interception for that call: no
interceptor is generated and neither WHIZ058 nor WHIZ059 is reported.

```csharp{title="Pragma Suppression" description="Pragma Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Pragma", "Suppression"] tests=["GuidInterceptorGeneratorTests.Generator_PragmaDisableWhiz055_SuppressesInterceptionAsync"]}
#pragma warning disable WHIZ055
var id = Guid.NewGuid();  // Not intercepted, no WHIZ058
#pragma warning restore WHIZ055
```

Note: `#pragma warning disable WHIZ058` does **not** stop interception; the generator keys pragma suppression off the
analyzer IDs WHIZ055 and WHIZ056, not WHIZ058.

### Hiding the Message Only

`NoWarn` hides the WHIZ058 informational message from build output. It does **not** stop interception:

```xml{title="Project-Level Suppression" description="Project-Level Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Project-Level", "Suppression"] unverified="suppression/config; NoWarn hides build output, not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ058</NoWarn>
</PropertyGroup>
```

## Why This Matters

Event and message ids must be UUIDv7: version assignment, apply order, replay and lifecycle partitioning read the time
in them, and the framework refuses any other version where they enter. Interception makes the most common way of
creating an id in .NET produce the right kind of id, so code that writes `Guid.NewGuid()` is not refused at runtime.

## Related Diagnostics

- **[WHIZ059](whiz059)** - Interception suppressed (when `[SuppressGuidInterception]` is used)
- **[WHIZ055](whiz055)** - Warning for `Guid.NewGuid()` usage (analyzer, separate from interception)
- **[WHIZ056](whiz056)** - Warning for `Guid.CreateVersion7()` usage (analyzer)
- **[WHIZ037](whiz037)** - Warning when a constructed or parsed Guid, which interception cannot reach, flows into an id

## See Also

- [WhizbangIds](../../fundamentals/identity/whizbang-ids) - TrackedGuid and strongly-typed IDs
- [Guid Interception](../../fundamentals/identity/whizbang-ids#guid-interception) - Full interception documentation
- [Time-ordering checks](../../fundamentals/identity/whizbang-ids#time-ordering-checks)
