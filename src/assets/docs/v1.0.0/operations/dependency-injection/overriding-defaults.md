---
title: Overriding Defaults
pageType: guide
version: 1.0.0
category: DI
order: 1
description: >-
  How Whizbang ships a working default for every injectable service and how to
  replace one with your own implementation
tags: 'di, dependency-injection, defaults, tryadd, overriding'
codeReferences:
  - src/Whizbang.Core/Observability/InstanceIdentityRegistration.cs
  - src/Whizbang.Core/SystemEvents/AuditDecisionHook.cs
  - src/Whizbang.Core/Lifecycle/NoOpDestructionHook.cs
testReferences:
  - tests/Whizbang.Core.Tests/DependencyInjection/InstanceProviderWiringTests.cs
---

# Overriding Defaults

Whizbang registers a working implementation for every service it injects, so an application starts
and behaves sensibly without configuring anything. Every one of those registrations uses `TryAdd`,
which means **your own registration wins simply by existing**.

## Replacing a default

Register your implementation before calling `AddWhizbang()`:

```csharp
services.AddSingleton<IAuditDecisionHook, MyAuditPolicy>();
services.AddWhizbang();          // TryAdd sees yours and stands aside
```

Registering afterwards also works for any service the framework registers with `TryAdd`, provided
you replace rather than append:

```csharp
services.AddWhizbang();
services.RemoveAll<IAuditDecisionHook>();
services.AddSingleton<IAuditDecisionHook, MyAuditPolicy>();
```

## Why the constructor parameters are required

Injected dependencies are **required constructor parameters**, not optional ones. That is
deliberate, and it is the opposite of what it may look like at first: an optional parameter does not
make a dependency easier to supply, it makes forgetting to supply it invisible.

```csharp
// A registration that builds the object by hand silently drops anything it does not pass.
services.AddSingleton<IEventStore>(sp => new AuditingEventStoreDecorator(inner, channel, opts));
//                                       ^ three of six arguments; the rest are null at run time
```

Nothing reports that. The code compiles, the container is satisfied, the service runs without the
dependency, and the missing behavior is indistinguishable from behavior nobody asked for. Making the
parameter required turns it into a compile error, and moving the default into the registration means
the container always has something to supply.

Optionality still exists; it just lives where it is visible. `TryAdd` says "use this unless the
application supplied its own", which is the thing an optional parameter was being used to express.

## When there is no default

A few dependencies ship no default at all, and the constructor requires them outright. These are
capabilities where **no behavior is correct in their absence**, so a no-op implementation would be
worse than the missing dependency: a schema-readiness gate that answers "ready" without checking
does not decline to intervene, it asserts an invariant nobody established.

For those, composition fails at startup naming the service. See
[Registration Validation](registration-validation).

## Related

- [Registration Validation](registration-validation) - what is checked, and when
- [Injectable Services](injectable-services) - the full list and each shipped default
- [Extending and Customising](extending) - worked examples, and adding a service of your own
- [WHIZ500](../diagnostics/whiz500) - the analyzer that catches a dropped dependency
