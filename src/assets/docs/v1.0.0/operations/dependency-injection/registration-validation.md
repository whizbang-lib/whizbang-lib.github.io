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
  - src/Whizbang.Core/DependencyInjection/ServiceRequirement.cs
  - src/Whizbang.Generators/ServiceRequirementsGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/DependencyInjection/RegistrationValidationTests.cs
  - tests/Whizbang.Core.Component.Tests/DependencyInjection/RegistrationValidationStartupTests.cs
  - tests/Whizbang.Core.Tests/DependencyInjection/RealCompositionValidationTests.cs
  - tests/Whizbang.Generators.Tests/ServiceRequirementsGeneratorTests.cs
---

# Registration Validation

A dependency that is declared but never registered produces no error on its own. The container
hands back null, the service runs in a degraded mode nobody chose, and the missing behavior looks
exactly like behavior that was never requested. Whizbang turns that into a startup failure.

## What you see when it fires

```
WhizbangRegistrationException: Whizbang registration validation failed: 2 dependencies are
declared but not registered.
  - IPerspectiveSnapshotStore (required by PerspectiveWorker)
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

## Which requirements are checked

The generated list of requirements covers every registration call in the compiled source, including
calls that a given composition never makes. Validation therefore checks a requirement only when its
implementation type is registered in the service collection being validated. A composition that
calls `AddWhizbang()` and a storage driver but not `AddTransportConsumer()` does not register
`TransportConsumerWorker`, so the `ITransport` that worker requires is not checked.

:::updated
A composition that calls `AddTransportConsumer()` without a transport no longer fails with
`ITransport (required by TransportConsumerWorker)`: a host with no message broker is a supported
composition, and the worker is built only when a transport is registered
{verified: RealCompositionValidationTests.ATransportConsumerWithoutATransport_IsNotAGapAsync}.
See [A host with no message broker](../../messaging/transports/transport-consumer#no-transport).
With a transport registered, every service the worker needs is checked again; see
[conditional factory registrations](#conditional-factory-registrations).
:::

An implementation type counts as registered when a service descriptor, keyed or not, names it as its
service type, as its implementation type, or through the type of its instance.

A factory registration, such as `AddSingleton<IWorker, Worker>(sp => new Worker(...))` or
`AddHostedService<Worker>(sp => ...)`, produces a descriptor that carries only its service type and
does not name the type the factory builds. The source generator records the service types under
which an implementation is registered through a factory in `ServiceRequirement.FactoryServiceTypes`;
for `AddHostedService<T>` that service type is `IHostedService`. A factory descriptor whose service
type appears in that list counts as registering the implementation, so a type registered only
through a factory is still checked. A factory registration whose service type is the requirement's
own type needs no entry, because the requirement is already named after that service type.

## Conditional factory registrations {#conditional-factory-registrations}

A factory that builds its service only when another service is registered, else a stand-in, is
checked for what its building branch needs only when that other service is registered. The source
generator reads the factory's own code, so nothing is declared for this
{verified: ServiceRequirementsGeneratorTests.AFactoryThatBuildsOnlyWhenAServiceIsRegistered_RequiresItsBuildingBranch_OnlyUnderThatConditionAsync}:

```csharp{title="A factory built only when a transport is registered" description="The worker's dependencies are required only when ITransport is registered; with no transport the stand-in is used and nothing is required." category="Configuration" difficulty="INTERMEDIATE" tags=["dependency-injection", "validation", "factory"] tests=["ServiceRequirementsGeneratorTests.AFactoryThatBuildsOnlyWhenAServiceIsRegistered_RequiresItsBuildingBranch_OnlyUnderThatConditionAsync", "RegistrationValidationTests.ARequirementUnderARegisteredCondition_IsCheckedAsync"]}
services.TryAdd(ServiceDescriptor.Singleton<Worker>(sp =>
  sp.GetService<ITransport>() is not { } transport
    ? null!
    : new Worker(transport, sp.GetRequiredService<IClock>())));
```

The generator records the requirement with `ServiceRequirement.Condition = typeof(ITransport)`, and
validation applies it only when a descriptor provides `ITransport`
{verified: RegistrationValidationTests.ARequirementUnderAConditionNothingRegisters_IsNotCheckedAsync}.
The transport consumer's worker is registered exactly this way, so a host without a broker starts and
a host with one is checked for every service the worker needs
{verified: RealCompositionValidationTests.ATransportConsumerWithATransport_IsCheckedForWhatItsWorkerNeedsAsync}.

The condition is read from `sp.GetService<X>()` tested with `is { }`, `is X x`, `is null`,
`== null`, `!= null`, or `not` of any of these. Anything else is read as no condition.

| Choice | Why | |
|---|---|---|
| Only the branch taken when `X` is registered is conditional. The other branch, and any condition the generator cannot read, stay checked unconditionally. | Erring towards checking: a condition the generator cannot prove says nothing about when the type is built. | {verified: ServiceRequirementsGeneratorTests.TheStandInBranch_IsRequiredUnconditionally_AndTheBuildingBranchUnderItsConditionAsync, ServiceRequirementsGeneratorTests.AConditionThatDoesNotSayWhetherAServiceIsRegistered_LeavesTheRequirementUnconditionalAsync} |
| `AddSingleton<T>(factory)` and the other registration methods apply the same condition to `T`'s constructor when the building branch is `new T(...)`. | Before #1907 such a registration was read as if `T` were always built, so every constructor dependency was required. | {verified: ServiceRequirementsGeneratorTests.ARegistrationMethodFactoryThatBuildsOnlyUnderACondition_RequiresTheConstructorUnderItTooAsync} |
| `ServiceDescriptor.Singleton`, `Scoped` and `Transient` factories are read only with one type argument. | With two, the descriptor's service type is one many registrations share (an `IHostedService`, a step interface), so the requirement would apply wherever any of them is registered. | {verified: ServiceRequirementsGeneratorTests.AServiceDescriptorFactoryNamingASharedServiceType_OrAnotherType_IsNotReadAsync} |
| Two registrations of the same type, under the same condition, contribute every dependency either names. | Before #1907 only the first registration's dependencies were checked. | {verified: ServiceRequirementsGeneratorTests.TwoRegistrationsOfTheSameTypeRequiringDifferentServices_ContributeTheirUnionAsync} |

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
Validation answers one question only: can the constructor of every type registered in this collection
be satisfied by something in this collection.

## Related

- [Overriding Defaults](overriding-defaults) - how the shipped defaults are supplied
- [Injectable Services](injectable-services) - the services that participate
- [Extending and Customizing](extending) - partial compositions, and adding a service of your own
