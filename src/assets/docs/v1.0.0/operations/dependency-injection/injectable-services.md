---
title: Injectable Services
pageType: reference
version: 1.0.0
category: DI
order: 3
description: >-
  Every service Whizbang injects, the default it ships, and whether replacing it
  is a common thing to do
tags: 'di, dependency-injection, services, defaults, reference'
codeReferences:
  - src/Whizbang.Core/Observability/InstanceIdentityRegistration.cs
  - src/Whizbang.Core/Observability/UnknownServiceInstanceProvider.cs
  - src/Whizbang.Core/SystemEvents/AuditDecisionHook.cs
  - src/Whizbang.Core/Lifecycle/NoOpDestructionHook.cs
  - src/Whizbang.Core/Messaging/NoChaosInjector.cs
testReferences:
  - tests/Whizbang.Core.Tests/DependencyInjection/InstanceProviderWiringTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ChaosInjectorDefaultTests.cs
---

# Injectable Services

Every service listed here is a **required constructor parameter** with a **shipped default**, so an
application works without configuring anything and any of them can be replaced. See
[Overriding Defaults](overriding-defaults) for how replacement works.

## Services with a shipped default

| Service | Default | Replace it when |
|---|---|---|
| `IServiceInstanceProvider` | `ServiceInstanceProvider` (identity from configuration) | you want telemetry and audit records to carry a specific service name or instance id |
| `IAuditDecisionHook` | `NoOpinionAuditDecisionHook` (defers to the attribute) | you need per-occurrence audit decisions, or custom activity names |
| `IDestructionHook` | `NoOpDestructionHook` (proceed, observe nothing) | you need to preserve, archive or cascade before a stream is destroyed |
| `IChaosInjector` | `NoChaosInjector` (reports not-injecting) | you are running fault-injection tests |

## Expressing "there is genuinely nothing here"

Two of these have a second implementation for the case where the capability is legitimately absent,
which is **not** the same as the dependency being missing:

- `UnknownServiceInstanceProvider` - for a host with no telemetry identity. Records stamp an
  explicitly unknown writer, and gates that cannot attribute a message fail open rather than
  discard it.
- `NoChaosInjector` - reports `IsInjecting = false`, so nothing takes the chaos path.

Neither is registered as a default where doing so would be misleading. `UnknownServiceInstanceProvider`
in particular is not registered at all: a real composition quietly running anonymous is the outcome
this design exists to prevent, so it is available only to callers constructing these types directly.

## Services with no default

Some dependencies ship no default because **no behavior is correct in their absence**. A permissive
stub would not decline to intervene; it would assert something untrue. A schema-readiness gate that
answers "ready" without checking is worse than a missing gate, because a missing gate skips a wait
while a lying gate lets work proceed on a premise nobody established.

For these, composition fails at startup naming the service. See
[Registration Validation](registration-validation).

## A note on `ILogger`

Logger parameters remain optional, and every injected logger field falls back to `NullLogger`, so a
service never fails for want of logging. That fallback is a real risk in one direction: a
registration factory that forgets to pass a logger produces a service that writes nothing, silently.
[WHIZ500](../diagnostics/whiz500) catches exactly that at build time.

## Related

- [Overriding Defaults](overriding-defaults)
- [Extending and Customizing](extending)
- [Registration Validation](registration-validation)
- [AddAllWhizbangServices](../configuration/all-services)
