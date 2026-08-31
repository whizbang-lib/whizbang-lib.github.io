---
title: 'WHIZ501: Optional Injected Dependency'
pageType: troubleshooting
version: 1.0.0
description: >-
  A constructor declares an optional interface-typed parameter, which will be
  null wherever it is not passed
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - dependency-injection
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/OptionalInjectedParameterAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/OptionalInjectedParameterAnalyzerTests.cs
---

# WHIZ501: Optional Injected Dependency

**Severity**: Info
**Category**: Dependency Injection

## What it means

A constructor declares an injectable dependency as optional:

```csharp
public MyWorker(IStore store, ISchemaReadyGate? gate = null) { }
//                            ^ WHIZ501
```

This is the declaration that makes silent omission possible. [WHIZ500](whiz500) catches the omission
at a call site; this points at the shape that allows it, while you are editing the constructor.

## Why it matters

An optional parameter does not make a dependency easier to supply. It makes *forgetting* to supply
it invisible, and it is usually chosen for a reason that does not survive contact with production:
so existing construction sites, most often test fixtures, keep compiling unchanged.

## How to fix it

Make the parameter required, and move the default into the registration:

```csharp
public MyWorker(IStore store, ISchemaReadyGate gate) { }

services.TryAddSingleton<ISchemaReadyGate, SchemaReadyGate>();
```

Optionality still exists; it lives in the registration where it is explicit, and the container
guarantees something is always present. `TryAdd` means an application's own registration still wins.

If no inert default is correct for your service, leave it required and register nothing. Composition
then fails at startup naming the service, which is the right outcome for a capability whose absence
has no correct behavior. See [Registration Validation](../dependency-injection/registration-validation).

## Why it is only informational

The existing surface is large. A rule that turns an established codebase red on first build gets
suppressed globally, after which it catches nothing at all. Growth is held by a separate ratchet
test; this diagnostic exists to put the reason in front of whoever is editing the constructor.

## Related

- [WHIZ500](whiz500) - the omission this shape allows
- [Injectable Services](../dependency-injection/injectable-services)
