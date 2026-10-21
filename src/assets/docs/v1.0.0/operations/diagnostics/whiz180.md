---
title: 'WHIZ180: Audit Settings Not Registered'
pageType: troubleshooting
verifiedAgainstCommit: 75ea7ca4
verifiedDate: 2026-10-21
description: >-
  Warning when a type carries [AuditEvent] but generated code cannot name it, so its audit settings are not
  registered and audit decisions treat it as unattributed.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - audit
  - aot
  - source-generators
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/AuditEventRegistryGenerator.cs
  - src/Whizbang.Core/SystemEvents/AuditEventRegistry.cs
testReferences:
  - tests/Whizbang.Generators.Tests/AuditEventRegistryGeneratorTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditEventRegistryTests.cs
lastMaintainedCommit: '75ea7ca4'
---

# WHIZ180: Audit Settings Not Registered

**Severity**: Warning
**Category**: Whizbang source generation

## Description

{verified: AuditEventRegistryGeneratorTests.Generator_AnUnreachableType_IsReportedNotRegisteredAsync}

Audit decisions read each type's `[AuditEvent]` (its `Exclude`, `Reason` and `Level`) from `AuditEventRegistry`, which a
generator fills when the assembly loads, because Whizbang reads no attribute by reflection. The generator registers
every type that carries the attribute directly or through a base class, but it can only name a type that is public or
internal, along with every type that contains it. A private or protected nested type cannot be named from the
generated registration, so its settings would be lost: an excluded event would be audited, and an opted-in one would
not.

## Example

```csharp{title="A private event type the generator cannot register" category="Diagnostics" difficulty="BEGINNER"}
public static class Orders {
  [AuditEvent(Exclude = true)]
  private sealed record PresencePinged([property: StreamId] Guid OrderId) : IEvent;   // WHIZ180
}
```

## How to fix

Pick one:

- **Make the type internal or public.** The generator then registers it with the rest.
- **Register it yourself** before it is audited, for example from a module initializer in the same class:
  `AuditEventRegistry.Register(typeof(PresencePinged), new AuditEventAttribute { Exclude = true });`

## Related

- [System events: audit decisions](../../fundamentals/events/system-events#audit-decisions)
- [Audit logging](../../fundamentals/security/audit-logging)
