---
title: 'WHIZ042: No User Services Found'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic defined for the case where the service registration generator finds no lens or perspective
  services. In this version no generator reports it.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - service-registration
  - dependency-injection
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ042: No User Services Found

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

WHIZ042 is declared for the situation where the service registration generator finds no lens or perspective class to
register. **In this version it is never reported.** When the generator finds no services it does not emit a
diagnostic; it still writes `ServiceRegistrations.g.cs`, and `AddLensServices()` and `AddPerspectiveServices()` are
generated with no registrations in them.

If you see a build message with this ID, it comes from a different version of the generators than the one this page
describes.

## Diagnostic Message

```text
No user-defined lens or perspective services were found for service registration
```

## Common Causes

The situation the descriptor describes arises when:

1. **The project has no lenses or perspectives** of its own.
2. **Every candidate class is abstract** (each is reported as [WHIZ041](whiz041)).
3. **Every candidate class is private or nested inside a private or protected type**, which the generator skips.
4. **The lens or perspective interface is not in the class's own base list**, or is an open generic such as
   `ILensQuery<TModel>`.

## How to Fix

Nothing is reported, so nothing needs fixing. If calling `AddLensServices()` or `AddPerspectiveServices()` does not
register a class you expected, check the points above, and look for [WHIZ040](whiz040) in the build output: each
registered class produces one.

## Suppressing

There is nothing to suppress in this version. If an older or newer generator reports it and you want it silenced,
use a global analyzer config file (the diagnostic has no source location, so `#pragma` cannot reach it):

```ini{
title: "Silence WHIZ042"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ042.severity = none
```

## Related

- [WHIZ040: User Service Discovered](whiz040)
- [WHIZ041: Abstract Class Skipped](whiz041)
- [Service Registration](../configuration/service-registration)
- [Lens Services](../configuration/lens-services)
- [Perspective Services](../configuration/perspective-services)
