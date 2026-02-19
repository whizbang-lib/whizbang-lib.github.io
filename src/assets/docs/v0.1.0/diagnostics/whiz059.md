---
title: "WHIZ059: GUID Interception Suppressed"
description: "Informational diagnostic indicating a GUID creation call was not intercepted due to suppression"
category: "Diagnostics"
severity: "Info"
tags: ["diagnostics", "guid", "interception", "source-generator", "suppression"]
---

# WHIZ059: GUID Interception Suppressed

**Severity**: Info
**Category**: Source Generation

## Description

This informational diagnostic is reported when a GUID creation call could be intercepted but was suppressed via the `[SuppressGuidInterception]` attribute. This indicates intentional opt-out from TrackedGuid wrapping.

This diagnostic is only reported when GUID interception is enabled via the MSBuild property `WhizbangGuidInterceptionEnabled=true`.

## Diagnostic Message

```
GUID call 'System.Guid.NewGuid()' at file.cs:15 suppressed by SuppressGuidInterceptionAttribute on method
```

## Why Suppress Interception

Common reasons to suppress GUID interception:

### 1. Test Fixtures

```csharp
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

```csharp
public class ExternalApiClient {
  [SuppressGuidInterception]
  public Guid CreateExternalRequestId() {
    // External system expects raw GUID format
    return Guid.NewGuid();  // WHIZ059 reported here
  }
}
```

### 3. Performance-Critical Paths

```csharp
public class HighThroughputProcessor {
  [SuppressGuidInterception]
  public Guid CreateTransientId() {
    // Avoid TrackedGuid overhead for transient IDs
    return Guid.NewGuid();  // WHIZ059 reported here
  }
}
```

### 4. Legacy Code Migration

```csharp
[SuppressGuidInterception]
public class LegacyService {
  // Gradual migration - suppress for now
  public Guid CreateId() => Guid.NewGuid();
}
```

## Suppression Scopes

The `[SuppressGuidInterception]` attribute can be applied at different scopes:

### Method Scope

```csharp
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

```csharp
[SuppressGuidInterception]
public class TestFixtures {
  public Guid Id1 => Guid.NewGuid();  // Suppressed
  public Guid Id2 => Guid.NewGuid();  // Suppressed
}
```

### Assembly Scope

```csharp
// In AssemblyInfo.cs or any file
[assembly: SuppressGuidInterception]
// All GUID calls in this assembly are suppressed
```

## Suppressing This Diagnostic

If you don't want to see WHIZ059 diagnostics:

### Project-Level

```xml
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ059</NoWarn>
</PropertyGroup>
```

### Code-Level

```csharp
#pragma warning disable WHIZ059
[SuppressGuidInterception]
public Guid CreateId() => Guid.NewGuid();
#pragma warning restore WHIZ059
```

## Related Diagnostics

- **[WHIZ058](whiz058.md)** - GUID call intercepted (the inverse - when interception happens)
- **[WHIZ055](whiz055.md)** - Warning for `Guid.NewGuid()` usage
- **[WHIZ056](whiz056.md)** - Warning for `Guid.CreateVersion7()` usage

## See Also

- [WhizbangIds](../core-concepts/whizbang-ids.md) - TrackedGuid and strongly-typed IDs
- [TrackedGuid Interception](../core-concepts/whizbang-ids.md#trackedguid-interception-opt-in) - Full interception documentation
- [SuppressGuidInterceptionAttribute](../attributes/suppressguidinterception.md) - Attribute documentation
