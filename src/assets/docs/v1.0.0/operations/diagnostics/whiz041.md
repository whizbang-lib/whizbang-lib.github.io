---
title: 'WHIZ041: Abstract Class Skipped'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported when the service registration generator finds an abstract lens or perspective class and
  leaves it out of the generated registrations, because an abstract class cannot be instantiated.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - service-registration
  - dependency-injection
  - abstract-class
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ041: Abstract Class Skipped

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The service registration generator applies the same discovery rules as for [WHIZ040](whiz040): an accessible class
whose own base list includes your interface extending `ILensQuery<T>` or a perspective interface, or a closed
`ILensQuery<T>`, `IPerspectiveFor<...>` or `IPerspectiveWithActionsFor<...>` directly. When such a class is
**abstract**, the dependency injection container could never create it, so the generator leaves it out of
`AddLensServices()` and `AddPerspectiveServices()` and reports WHIZ041 instead.

This is the expected outcome for a shared abstract base class. It is worth a look only when the class was meant to be
concrete.

The diagnostic has no source location.

## Diagnostic Message

```text
Abstract class '{ClassName}' implementing '{InterfaceName}' skipped for service registration
```

## Common Causes

1. **An abstract base class** implements the lens or perspective interface so that concrete classes can share code.
2. **A class was marked `abstract` by mistake**, so it is never registered.

## How to Fix

- **Intended base class**: nothing to fix. Make sure a concrete class provides the implementation that should be
  resolved from the container.
- **Unintended**: remove the `abstract` modifier and implement the abstract members. The class is then registered and
  reported as [WHIZ040](whiz040).

### Example that produces WHIZ041

```csharp{
title: "An abstract lens"
description: "AbstractOrderLens is abstract, so it is skipped and WHIZ041 is reported"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Service Registration", "Lenses"]
testFile: "tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs"
testMethod: "Generator_ReportsInfoDiagnostic_WhenAbstractClassSkippedAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs"
tests: ["ServiceRegistrationGeneratorTests.Generator_ReportsInfoDiagnostic_WhenAbstractClassSkippedAsync"]
}
public record Order(Guid Id, string Status);
public interface IOrderLens : ILensQuery<Order> { }

public abstract class AbstractOrderLens : IOrderLens {
  public abstract IQueryable<PerspectiveRow<Order>> Query { get; }
  public abstract Task<Order?> GetByIdAsync(Guid id, CancellationToken ct = default);
}
```

## Suppressing

WHIZ041 has no source location, so a `#pragma warning disable WHIZ041` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ041"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ041.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is appropriate when your project
uses abstract base classes on purpose. It does not change what is registered.

## Related

- [WHIZ040: User Service Discovered](whiz040)
- [WHIZ042: No User Services Found](whiz042)
- [Service Registration](../configuration/service-registration)
- [Lens Services](../configuration/lens-services)
- [Perspective Services](../configuration/perspective-services)
