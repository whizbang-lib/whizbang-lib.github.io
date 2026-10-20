---
title: 'WHIZ040: User Service Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported for each lens or perspective class the service registration generator found and added to
  the generated AddLensServices or AddPerspectiveServices method.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - service-registration
  - dependency-injection
  - lenses
  - perspectives
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ040: User Service Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The service registration generator writes `ServiceRegistrations.g.cs`, which contains `AddLensServices()`,
`AddPerspectiveServices()` and `AddAllWhizbangServices()` extension methods for `IServiceCollection`. For every
concrete class it puts into those methods, it reports WHIZ040 with the category (`Lens` or `Perspective`), the class
name and the interface it is registered against.

A class is picked up when it is non-abstract, accessible (not private or protected, and not nested in a private or
protected type), and one of the interfaces in its own base list is either:

- **your own interface** that extends `ILensQuery<T>` or a perspective interface (for example
  `IOrderLens : ILensQuery<Order>`), in which case the class is registered against that interface, or
- **a closed `ILensQuery<T>`, `IPerspectiveFor<...>` or `IPerspectiveWithActionsFor<...>` directly**, in which case
  it is registered against that interface. Open generics such as `ILensQuery<TModel>` are skipped.

The generated code registers each class against its interface with `AddTransient` and, unless
`IncludeSelfRegistration` is turned off in the options, also registers the class itself.

WHIZ040 is a confirmation. It has no source location.

## Diagnostic Message

```text
Registered {Category} '{ClassName}' as transient service implementing '{InterfaceName}'
```

## Common Causes

1. **A lens or perspective class was discovered** and added to the generated registration methods. This is the
   expected outcome.

## How to Fix

Nothing needs fixing. If a class you expected is not reported, check that it is not abstract (see
[WHIZ041](whiz041)), not private or nested in a private type, and that the qualifying interface appears in the class's
own base list.

### Example that produces WHIZ040

```csharp{
title: "A lens registered against its own interface"
description: "OrderLens implements IOrderLens : ILensQuery<Order>, so it is registered and WHIZ040 is reported"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Service Registration", "Lenses"]
testFile: "tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs"
testMethod: "Generator_ReportsInfoDiagnostic_WhenServiceDiscoveredAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs"
tests: ["ServiceRegistrationGeneratorTests.Generator_ReportsInfoDiagnostic_WhenServiceDiscoveredAsync"]
}
public record Order(Guid Id, string Status);
public interface IOrderLens : ILensQuery<Order> { }
public class OrderLens : IOrderLens {
  public IQueryable<PerspectiveRow<Order>> Query => throw new NotImplementedException();
  public Task<Order?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<Order?>(null);
}
```

The build reports `Registered Lens 'OrderLens' as transient service implementing 'global::TestApp.IOrderLens'`.

## Suppressing

WHIZ040 has no source location, so a `#pragma warning disable WHIZ040` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ040"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ040.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is safe; the registrations are
generated either way.

## Related

- [WHIZ041: Abstract Class Skipped](whiz041)
- [WHIZ042: No User Services Found (retired)](whiz042)
- [Service Registration](../configuration/service-registration)
- [Lens Services](../configuration/lens-services)
- [Perspective Services](../configuration/perspective-services)
- [Service Registration Options](../configuration/service-registration-options)
