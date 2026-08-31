---
title: 'WHIZ500: Hand-Constructed Service Omits a Dependency'
pageType: troubleshooting
version: 1.0.0
description: >-
  A service built with new inside a DI factory omits an injectable parameter,
  which will be null at run time
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - dependency-injection
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/DiFactoryConstructionAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/DiFactoryConstructionAnalyzerTests.cs
---

# WHIZ500: Hand-Constructed Service Omits a Dependency

**Severity**: Warning
**Category**: Dependency Injection

## What it means

A registration built an object with `new` and did not pass one of its injectable parameters. The
container is not resolving this constructor; the registration is. Anything not listed is supplied by
the compiler as the parameter's default, which for an injected service is `null`.

```csharp
services.AddSingleton<IEventStore>(sp => new AuditingEventStoreDecorator(inner, channel, opts));
//                                       ^ WHIZ500: 'instanceProvider' will be null at run time
```

## Why it matters

Nothing else reports this. The code compiles, the container is satisfied, the service runs without
the dependency, and the missing behavior is indistinguishable from behavior nobody asked for.

Unit tests do not catch it either, and the reason is worth understanding: a test that constructs the
type supplies the argument itself, so it can never observe that the container does not. A feature
can pass every test and be absent in every deployed application.

## How to fix it

Pass the dependency from the provider:

```csharp
services.AddSingleton<IEventStore>(sp => new AuditingEventStoreDecorator(
    inner, channel, opts,
    sp.GetRequiredService<IServiceInstanceProvider>(),
    sp.GetRequiredService<IAuditDecisionHook>()));
```

Or pass `null` explicitly if absence is what you intend. That is allowed on purpose: the defect is
*omission*, which is invisible in review, while a deliberate `null` is a decision a reader can see
and question.

## When it does not apply

The rule only fires inside a factory lambda that takes an `IServiceProvider`, because that lambda is
standing in for the container. Ordinary code and tests construct these types all the time and supply
what they need, so they are not reported. Test and sample projects suppress it entirely.

## Related

- [WHIZ501](whiz501) - the declaration that makes this possible
- [Overriding Defaults](../dependency-injection/overriding-defaults)
