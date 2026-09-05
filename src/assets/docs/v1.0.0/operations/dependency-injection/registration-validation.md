---
title: Registration Validation
pageType: guide
version: 1.0.0
category: DI
order: 2
description: >-
  Whizbang checks at startup that every registered service can have its
  constructor satisfied, and fails naming what is missing
tags: 'di, dependency-injection, validation, startup, diagnostics'
codeReferences:
  - src/Whizbang.Core/DependencyInjection/RegistrationValidation.cs
  - src/Whizbang.Core/DependencyInjection/RegistrationValidationStartup.cs
  - src/Whizbang.Generators/ServiceRequirementsGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/DependencyInjection/RegistrationValidationTests.cs
  - tests/Whizbang.Core.Tests/DependencyInjection/RegistrationValidationStartupTests.cs
---

# Registration Validation

A dependency that is declared but never registered produces no error on its own. The container
hands back null, the service runs in a degraded mode nobody chose, and the missing behavior looks
exactly like behavior that was never requested. Whizbang turns that into a startup failure.

## What you see when it fires

```
WhizbangRegistrationException: Whizbang registration validation failed: 2 dependencies are
declared but not registered.
  - ISchemaReadyGate (required by PerspectiveWorker)
  - IWorkChannelWriter (required by ClaimWorker)
Register each service, or call the Add* extension that supplies its default.
```

Both halves matter. Naming only the missing service leaves you grepping for who wanted it; naming
only the dependent tells you where to look but not what to add.

## When it runs, and why not earlier

Validation runs at **startup**, not at the end of `AddWhizbang()`.

Storage and transport drivers register their services *after* `AddWhizbang` returns, on the builder
chain:

```csharp{title="Why validation runs at startup, not at the end of AddWhizbang" description="Storage and transport drivers register their services on the builder chain after AddWhizbang returns, so an earlier check would report every driver-supplied service as missing." category="Configuration" difficulty="INTERMEDIATE" tags=["dependency-injection", "validation", "startup", "drivers"] tests=["RegistrationValidationStartupTests.StartupPassesWhenADriverRegisteredTheDependencyLaterAsync"]}
services.AddWhizbang()          // core services registered here
        .UseYourStorageProvider();   // IWorkCoordinatorStrategy and friends arrive here
```

Checking at the end of `AddWhizbang` would report every driver-supplied service as missing. A guard
that fails on correct compositions gets switched off, and takes the real failures with it.

## What it costs

Nothing measurable, and nothing observable. It compares `Type` handles against the registered
service descriptors: no service is resolved, nothing is constructed, and no factory side effect
runs. It is a scan over a list, performed before the first service is built.

The list of what each type requires is produced at compile time by a source generator, so this needs
no reflection at run time.

## Turning it off

```csharp{title="Turning registration validation off" description="Disables the startup check for a composition that deliberately registers a subset, such as a test fixture exercising one worker." category="Configuration" difficulty="BEGINNER" tags=["dependency-injection", "validation", "testing", "options"] tests=["RegistrationValidationStartupTests.DisabledValidationDoesNotThrowAsync"]}
services.AddWhizbang(options => options.ValidateRegistrations = false);
```

Use this for a composition that deliberately registers a subset, such as a test fixture exercising
one worker in isolation. Leave it on for anything that runs as an application.

## What it does not catch

A dependency that is registered but wrong, and a registration that is present but never used.
Validation answers one question only: can every registered type's constructor be satisfied by
something in this collection.

## Related

- [Overriding Defaults](overriding-defaults) - how the shipped defaults are supplied
- [Injectable Services](injectable-services) - the services that participate
- [Extending and Customizing](extending) - partial compositions, and adding a service of your own
