---
title: 'WHIZ058: GUID Call Intercepted'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Informational diagnostic indicating a GUID creation call has been intercepted
  and wrapped with TrackedGuid
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
lastMaintainedCommit: '01f07906'
---

# WHIZ058: GUID Call Intercepted

**Severity**: Info
**Category**: Source Generation

## Description

This informational diagnostic is reported when the `GuidInterceptorGenerator` identifies a GUID creation call eligible for interception and wraps it with `TrackedGuid`. This enables metadata tracking for the generated GUID.

The diagnostic itself is reported whenever the generator finds an interceptable call — even if `WhizbangGuidInterceptionEnabled` is not set. However, the actual interceptor code (the `TrackedGuid` wrapping) is only generated when the MSBuild property `WhizbangGuidInterceptionEnabled=true` is set.

Calls inside `Whizbang.*` namespaces are never intercepted (the library controls its own GUID creation), so no WHIZ058 is reported for them.

## Diagnostic Message

```
Intercepted System.Guid.NewGuid() at /src/MyApp/OrderService.cs:15 - wrapped with TrackedGuid for metadata tracking
```

## What Gets Intercepted

The following GUID creation methods are intercepted:

| Method | Metadata |
|--------|----------|
| `Guid.NewGuid()` | `Version4 \| SourceMicrosoft` |
| `Guid.CreateVersion7()` | `Version7 \| SourceMicrosoft` |
| `CombGuidIdGeneration.NewGuid()` | `Version7 \| SourceMarten` |
| `UUIDNext.Uuid.NewSequential()` | `Version7 \| SourceUuidNext` |
| `UUIDNext.Uuid.NewDatabaseFriendly()` | `Version7 \| SourceUuidNext` |
| `Medo.Uuid7.NewUuid7()` | `Version7 \| SourceMedo` |

## Enabling Interception

Add to your project file:

```xml{title="Enabling Interception" description="Add to your project file:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Enabling", "Interception"] unverified="config — MSBuild property, not exercised by a test"}
<PropertyGroup>
  <WhizbangGuidInterceptionEnabled>true</WhizbangGuidInterceptionEnabled>
</PropertyGroup>
```

## Suppressing This Diagnostic

If you want to suppress interception for specific code:

### Method-Level Suppression

```csharp{title="Method-Level Suppression" description="Method-Level Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Method-Level", "Suppression"] tests=["GuidInterceptorGeneratorTests.Generator_SuppressOnMethod_NoInterceptionAsync"]}
using Whizbang.Core;

[SuppressGuidInterception]
public Guid CreateRawGuid() {
  return Guid.NewGuid();  // Not intercepted, no WHIZ058
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

Wrapping a call in `#pragma warning disable WHIZ055` (or `WHIZ056`) disables interception entirely for that call — no interceptor is generated and neither WHIZ058 nor WHIZ059 is reported:

```csharp{title="Pragma Suppression" description="Pragma Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Pragma", "Suppression"] tests=["GuidInterceptorGeneratorTests.Generator_PragmaDisableWhiz055_SuppressesInterceptionAsync"]}
#pragma warning disable WHIZ055
var id = Guid.NewGuid();  // Not intercepted, no WHIZ058
#pragma warning restore WHIZ055
```

Note: `#pragma warning disable WHIZ058` does **not** stop interception — the generator keys pragma suppression off the analyzer IDs WHIZ055/WHIZ056, not WHIZ058.

### Project-Level Suppression

Hides the WHIZ058 informational message from build output. This does **not** stop interception — use `[SuppressGuidInterception]` or the WHIZ055/WHIZ056 pragma for that:

```xml{title="Project-Level Suppression" description="Project-Level Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Project-Level", "Suppression"] unverified="suppression/config — NoWarn hides build output, not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ058</NoWarn>
</PropertyGroup>
```

## Why This Matters

TrackedGuid interception provides:
- **Version tracking** - Know if a GUID is v4 (random) or v7 (time-ordered)
- **Source tracking** - Know which library generated the GUID
- **Runtime validation** - Validate that time-ordered GUIDs are used where required
- **Debugging** - Trace GUID origins in complex systems

## Related Diagnostics

- **[WHIZ059](whiz059.md)** - Interception suppressed (when `[SuppressGuidInterception]` is used)
- **WHIZ055** - Warning for `Guid.NewGuid()` usage (analyzer, separate from interception)
- **WHIZ056** - Warning for `Guid.CreateVersion7()` usage (analyzer)

## See Also

- [WhizbangIds](../../fundamentals/identity/whizbang-ids.md) - TrackedGuid and strongly-typed IDs
- [TrackedGuid Interception](../../fundamentals/identity/whizbang-ids.md#trackedguid-interception-opt-in) - Full interception documentation
