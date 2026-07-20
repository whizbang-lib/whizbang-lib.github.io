---
title: 'WHIZ059: GUID Interception Suppressed'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Informational diagnostic indicating a GUID creation call was not intercepted
  due to suppression
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - guid
  - interception
  - source-generator
  - suppression
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/GuidInterceptorGenerator.cs
  - src/Whizbang.Core/SuppressGuidInterceptionAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/GuidInterceptorGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ059: GUID Interception Suppressed

**Severity**: Info
**Category**: Source Generation

## Description

This informational diagnostic is reported when a GUID creation call could be intercepted but was suppressed via the `[SuppressGuidInterception]` attribute. This indicates intentional opt-out from TrackedGuid wrapping.

The diagnostic is reported whenever the generator runs — even if the MSBuild property `WhizbangGuidInterceptionEnabled` is not set (the property only gates whether interceptor code is generated for the non-suppressed calls).

Suppression via `#pragma warning disable WHIZ055`/`WHIZ056` around a call disables interception silently — those calls produce **no** WHIZ059 (only attribute-based suppression is reported).

## Diagnostic Message

```
Interception suppressed for System.Guid.NewGuid at /src/MyApp/TestData.cs:15 via SuppressGuidInterceptionAttribute on method
```

The last part identifies the suppression scope: `on method`, `on local function`, `on type`, or `on assembly`.

## Why Suppress Interception

Common reasons to suppress GUID interception:

### 1. Test Fixtures

```csharp{title="Test Fixtures" description="Test Fixtures" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Test", "Fixtures"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
using Whizbang.Core;

[SuppressGuidInterception]
public static class TestData {
  // Tests may need raw GUIDs for fixture data
  public static readonly Guid KnownOrderId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");

  public static Guid CreateTestGuid() {
    return Guid.NewGuid();  // WHIZ059 reported here
  }
}
```

### 2. Integration with External Systems

```csharp{title="Integration with External Systems" description="Integration with External Systems" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Integration", "External"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
public class ExternalApiClient {
  [SuppressGuidInterception]
  public Guid CreateExternalRequestId() {
    // External system expects raw GUID format
    return Guid.NewGuid();  // WHIZ059 reported here
  }
}
```

### 3. Performance-Critical Paths

```csharp{title="Performance-Critical Paths" description="Performance-Critical Paths" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Performance-Critical", "Paths"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
public class HighThroughputProcessor {
  [SuppressGuidInterception]
  public Guid CreateTransientId() {
    // Avoid TrackedGuid overhead for transient IDs
    return Guid.NewGuid();  // WHIZ059 reported here
  }
}
```

### 4. Legacy Code Migration

```csharp{title="Legacy Code Migration" description="Legacy Code Migration" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Legacy", "Code"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
[SuppressGuidInterception]
public class LegacyService {
  // Gradual migration - suppress for now
  public Guid CreateId() => Guid.NewGuid();
}
```

## Suppression Scopes

The `[SuppressGuidInterception]` attribute can be applied at different scopes:

### Method Scope

```csharp{title="Method Scope" description="Method Scope" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Method", "Scope"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
public class MyService {
  [SuppressGuidInterception]
  public Guid CreateRawGuid() {
    return Guid.NewGuid();  // Suppressed
  }

  public Guid CreateTrackedGuid() {
    return Guid.NewGuid();  // Intercepted
  }
}
```

### Class Scope

```csharp{title="Class Scope" description="Class Scope" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Class", "Scope"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressedCall_ReportsWHIZ059DiagnosticAsync"}
[SuppressGuidInterception]
public class TestFixtures {
  public Guid Id1 => Guid.NewGuid();  // Suppressed
  public Guid Id2 => Guid.NewGuid();  // Suppressed
}
```

### Local Function Scope

```csharp{title="Local Function Scope" description="Local Function Scope" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Local", "Function"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_SuppressOnLocalFunction_NoInterceptionAsync"}
public Guid CreateId() {
  [SuppressGuidInterception]
  static Guid CreateRaw() => Guid.NewGuid();  // Suppressed

  return CreateRaw();
}
```

### Assembly Scope

```csharp{title="Assembly Scope" description="Assembly Scope" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Assembly", "Scope"] unverified="counter-example — the pattern WHIZ059 flags; detection verified by GuidInterceptorGeneratorTests.Generator_AssemblyLevelSuppress_NoInterceptionAsync"}
// In AssemblyInfo.cs or any file
[assembly: SuppressGuidInterception]
// All GUID calls in this assembly are suppressed
```

## Suppressing This Diagnostic

If you don't want to see WHIZ059 diagnostics:

### Project-Level

```xml{title="Project-Level" description="Project-Level" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Project-Level"] unverified="suppression/config — NoWarn hides build output, not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ059</NoWarn>
</PropertyGroup>
```

### Code-Level

```csharp{title="Code-Level" description="Code-Level" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Code-Level"] unverified="suppression/config — pragma WHIZ059 hides build output, not exercised by a test"}
#pragma warning disable WHIZ059
[SuppressGuidInterception]
public Guid CreateId() => Guid.NewGuid();
#pragma warning restore WHIZ059
```

## Related Diagnostics

- **[WHIZ058](whiz058.md)** - GUID call intercepted (the inverse - when interception happens)
- **WHIZ055** - Warning for `Guid.NewGuid()` usage
- **WHIZ056** - Warning for `Guid.CreateVersion7()` usage

## See Also

- [WhizbangIds](../../fundamentals/identity/whizbang-ids.md) - TrackedGuid and strongly-typed IDs
- [TrackedGuid Interception](../../fundamentals/identity/whizbang-ids.md#trackedguid-interception-opt-in) - Full interception documentation
- SuppressGuidInterceptionAttribute - Attribute documentation
