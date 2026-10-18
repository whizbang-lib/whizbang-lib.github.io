---
title: 'WHIZ014: Receptor May Not Be Constructible by Dependency Injection'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when a receptor that will be registered in dependency injection takes a constructor parameter the container
  is unlikely to supply (a delegate or a bare primitive), which would abort the whole service provider under validation.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - receptors
  - dependency-injection
  - source-generator
  - receptor-safety
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
  - src/Whizbang.Core/SuppressReceptorRegistrationAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ReceptorInjectabilityDiagnosticTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorRegistrationSuppressionTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ014: Receptor May Not Be Constructible by Dependency Injection

**Severity**: Warning
**Category**: Receptor Safety

## Description

Receptor discovery registers every `IReceptor` implementation in dependency injection. If a receptor's constructor
takes something the container cannot supply, the registration it leaves behind cannot be constructed. When the service
provider is built with validation enabled, that single bad registration aborts the construction of the **entire**
provider, so every service in the assembly fails to start, and the runtime error names the receptor without explaining
why it was registered.

WHIZ014 warns about this at build time. It is a deliberate heuristic: a source generator cannot know what your
application registers, so it only flags the shapes that are essentially never registered in a container and that
signal a receptor meant to be built by hand:

- a **delegate** parameter (for example `Action<T>` or `Func<int>`);
- a **bare primitive** parameter: `string`, `bool`, `int`, `long`, `double` or `decimal`.

How the check works, as read from the generator:

- It examines the **widest accessible constructor** (the one with the most parameters, ignoring private and static
  constructors), because that is the one the container chooses. A receptor whose only constructor is private is not
  checked.
- Parameters with a **default value** are skipped, because the container can omit them.
- Any other parameter type (an interface, a class, a settings object) is left alone, even if your application never
  registers it.
- It reports only the **first** matching parameter.
- Receptors marked `[SuppressReceptorRegistration]` are skipped, because they are not registered.

## Diagnostic Message

```
Receptor '{ReceptorName}' takes constructor parameter '{ParameterName}' of type '{ParameterType}', which dependency injection is unlikely to supply. If it is constructed by hand, mark it [SuppressReceptorRegistration]; otherwise register that dependency. An un-constructible receptor aborts the ENTIRE service provider under container validation, not just itself.
```

## Common Causes

1. **A receptor built by hand** (for example in a test or a helper) that closes over a callback, without declaring it.
2. **A configuration value passed as a primitive**, such as a connection name `string`, instead of an injected options
   or settings type.
3. **An overload added for convenience**: the check looks at the widest constructor, so adding a parameterless
   constructor next to a `string` one does not clear the warning.

## How to Fix

Pick the fix that matches your intent:

- **The receptor is constructed by hand**: mark it `[SuppressReceptorRegistration]`. That skips its DI registration
  while leaving it discovered and routed, and it silences the warning.
- **The receptor should be resolved from the container**: replace the delegate or primitive with a service the
  container can supply, or give the parameter a default value.

### Before (causes WHIZ014)

```csharp{title="Hand-built receptor that is still registered" description="The receptor takes an Action<T> the container cannot supply and is not marked, so WHIZ014 is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "receptors", "dependency-injection", "warning"] testFile="ReceptorRegistrationSuppressionTests.cs" testMethod="UndeclaredHandBuiltReceptor_IsWarnedAboutAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ReceptorRegistrationSuppressionTests.cs" tests=["ReceptorRegistrationSuppressionTests.UndeclaredHandBuiltReceptor_IsWarnedAboutAsync"]}
using System;
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;

namespace MyApp.Receptors;

public record OrderPlaced : IEvent;

public sealed class UndeclaredReceptor : IReceptor<OrderPlaced> {
  private readonly Action<OrderPlaced> _onReceived;

  // WHIZ014: 'onReceived' is a delegate the container will not supply
  public UndeclaredReceptor(Action<OrderPlaced> onReceived) {
    _onReceived = onReceived;
  }

  public ValueTask HandleAsync(OrderPlaced message, CancellationToken cancellationToken = default) {
    _onReceived(message);
    return default;
  }
}
```

### After (no warning)

```csharp{title="Hand-built receptor declared with SuppressReceptorRegistration" description="The attribute declares manual construction, so the receptor is not registered and WHIZ014 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "receptors", "dependency-injection", "suppress-registration"] testFile="ReceptorRegistrationSuppressionTests.cs" testMethod="DeclaredHandBuiltReceptor_IsNotWarnedAboutAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ReceptorRegistrationSuppressionTests.cs" tests=["ReceptorRegistrationSuppressionTests.DeclaredHandBuiltReceptor_IsNotWarnedAboutAsync", "ReceptorRegistrationSuppressionTests.SuppressedReceptor_IsNotRegisteredInDependencyInjectionAsync"]}
using System;
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;

namespace MyApp.Receptors;

public record OrderPlaced : IEvent;

// Constructed by hand so it can close over state the container knows nothing about.
[SuppressReceptorRegistration]
public sealed class HandBuiltReceptor : IReceptor<OrderPlaced> {
  private readonly Action<OrderPlaced> _onReceived;

  public HandBuiltReceptor(Action<OrderPlaced> onReceived) {
    _onReceived = onReceived;
  }

  public ValueTask HandleAsync(OrderPlaced message, CancellationToken cancellationToken = default) {
    _onReceived(message);
    return default;
  }
}
```

What stays quiet is tested as carefully as what fires: a defaulted primitive
{verified: ReceptorInjectabilityDiagnosticTests.PrimitiveWithADefaultValue_IsQuietAsync}, an injected service
{verified: ReceptorInjectabilityDiagnosticTests.InjectedServiceDependency_IsQuietAsync}, and a private-only constructor
{verified: ReceptorInjectabilityDiagnosticTests.OnlyAPrivateConstructor_IsQuietAsync}. The widest constructor is the one
checked {verified: ReceptorInjectabilityDiagnosticTests.TheWidestConstructorIsTheOneCheckedAsync}.

## Suppressing

The supported way to silence WHIZ014 is `[SuppressReceptorRegistration]`, because for a hand-built receptor it is also
the fix.

WHIZ014 is reported with no source location, so a `#pragma warning disable WHIZ014` region around the receptor cannot
reach it, and a file-scoped `.editorconfig` section (`[*.cs]`) does not apply to it either. To turn it off for a whole
project, use a global analyzer config file:

```ini{title="Silence WHIZ014 project-wide" description="A global analyzer config that turns off the WHIZ014 receptor-injectability warning." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ014.severity = none
```

Turning it off project-wide is rarely appropriate: it hides the next receptor that would take the service provider
down at startup. Suppress it only when you have confirmed that the flagged dependency really is registered (for
example a `string` or delegate your composition root registers explicitly).

## Related

- [Receptors: Manual Construction](../../fundamentals/receptors/receptors#manual-construction)
- [Receptor Discovery](../../extending/source-generators/receptor-discovery)
- [Testing Receptors](../testing/testing-receptors)
