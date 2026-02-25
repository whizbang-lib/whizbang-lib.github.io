---
title: 'WHIZ058: GUID Call Intercepted'
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
---

# WHIZ058: GUID Call Intercepted

**Severity**: Info
**Category**: Source Generation

## Description

This informational diagnostic is reported when the `GuidInterceptorGenerator` intercepts a GUID creation call and wraps it with `TrackedGuid`. This enables metadata tracking for the generated GUID.

This diagnostic is only reported when GUID interception is enabled via the MSBuild property `WhizbangGuidInterceptionEnabled=true`.

## Diagnostic Message

```
GUID call 'System.Guid.NewGuid()' at file.cs:15 intercepted and wrapped with TrackedGuid
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

```xml
<PropertyGroup>
  <WhizbangGuidInterceptionEnabled>true</WhizbangGuidInterceptionEnabled>
</PropertyGroup>
```

## Suppressing This Diagnostic

If you want to suppress interception for specific code:

### Method-Level Suppression

```csharp
using Whizbang.Core;

[SuppressGuidInterception]
public Guid CreateRawGuid() {
  return Guid.NewGuid();  // Not intercepted, no WHIZ058
}
```

### Class-Level Suppression

```csharp
[SuppressGuidInterception]
public class TestFixtures {
  // All GUID calls in this class are not intercepted
}
```

### Pragma Suppression

```csharp
#pragma warning disable WHIZ058
var id = Guid.NewGuid();
#pragma warning restore WHIZ058
```

### Project-Level Suppression

```xml
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
- **[WHIZ055](whiz055.md)** - Warning for `Guid.NewGuid()` usage (analyzer, separate from interception)
- **[WHIZ056](whiz056.md)** - Warning for `Guid.CreateVersion7()` usage (analyzer)

## See Also

- [WhizbangIds](../core-concepts/whizbang-ids.md) - TrackedGuid and strongly-typed IDs
- [TrackedGuid Interception](../core-concepts/whizbang-ids.md#trackedguid-interception-opt-in) - Full interception documentation
