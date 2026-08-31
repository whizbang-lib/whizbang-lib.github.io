---
title: Extending and Customising
pageType: guide
version: 1.0.0
category: DI
order: 4
description: >-
  Worked examples for replacing a shipped service, and the pattern to follow when
  adding an injectable service of your own
tags: 'di, dependency-injection, extending, customising, hooks'
codeReferences:
  - src/Whizbang.Core/SystemEvents/AuditDecisionHook.cs
  - src/Whizbang.Core/Lifecycle/NoOpDestructionHook.cs
  - src/Whizbang.Core/Observability/InstanceIdentityRegistration.cs
testReferences:
  - tests/Whizbang.Core.Tests/SystemEvents/AuditDecisionHookTests.cs
  - tests/Whizbang.Core.Tests/DependencyInjection/RegistrationValidationTests.cs
---

# Extending and Customising

## Replacing a shipped service

Every injectable service is registered with `TryAdd`, so registering your own before `AddWhizbang()`
is all it takes. A worked example, deciding per occurrence whether an event is audited:

```csharp
public sealed class MyAuditPolicy : IAuditDecisionHook {
  public AuditDecision Decide(object payload, Type eventType) => payload switch {
    // The same event carries both a user's edit and a bulk import, told apart by a payload
    // property. Excluding the type would lose the edits; including it floods the trail.
    RecordFieldEdited e when e.FromImport => AuditDecision.Skip,

    // A bulk operation should read as one line, not one record per affected entity.
    BulkImportCompleted b => AuditDecision.Record(
        name: "Bulk record import",
        description: $"Imported {b.RecordCount} records"),

    // Everything else: no opinion, so the [AuditEvent] attribute decides as before.
    _ => AuditDecision.NoOpinion,
  };
}

services.AddSingleton<IAuditDecisionHook, MyAuditPolicy>();
services.AddWhizbang();
```

`NoOpinion` is the important part of that switch. A hook that returned a `bool` would force you to
re-implement the attribute rules for every event you did not care about; returning no opinion leaves
them exactly as they were.

## Adding an injectable service of your own

Follow the same shape the framework holds itself to. Take the dependency as a **required**
constructor parameter, and register a default in your `Add*` extension:

```csharp
public sealed class ReportBuilder {
  private readonly IReportSink _sink;

  // Required. A construction site that forgets it will not compile.
  public ReportBuilder(IReportSink sink) => _sink = sink;
}

public static IServiceCollection AddReporting(this IServiceCollection services) {
  // Turnkey: works without configuration. TryAdd means an application's own sink still wins.
  services.TryAddSingleton<IReportSink, FileReportSink>();
  services.TryAddSingleton<ReportBuilder>();
  return services;
}
```

An optional parameter looks friendlier and is not. It does not make the dependency easier to supply;
it makes *forgetting* to supply it invisible, and a unit test cannot catch that because the test
supplies the argument itself.

## Deciding whether your default should exist at all

Ask one question: **is there a behavior that is correct when this capability is absent?**

If yes, ship an inert default and register it with `TryAdd`. Declining to intervene is a real
answer: a destruction hook that proceeds and observes nothing behaves exactly as no hook did.

If no, ship nothing and leave the parameter required. A schema-readiness gate that answered "ready"
without checking would not decline to intervene, it would assert the invariant the type exists to
establish — worse than the absence it replaced. Composition then fails at startup naming the
service, which is the correct outcome.

## When absence is itself a state

Sometimes "there is genuinely nothing here" is meaningful and needs to be expressible without being
confusable with "somebody forgot". Express it as a value, not as a missing registration:

```csharp
// A host with no telemetry identity says so explicitly.
new MyWorker(UnknownServiceInstanceProvider.Instance);

// A host with no schema step to wait on says so explicitly.
services.AddSingleton<ISchemaReadyGate>(SchemaReadyGate.AlreadyReady());
```

Both types exist for exactly this, and neither is registered as a default: a real composition
quietly running anonymous, or quietly skipping a readiness wait, is the outcome the design prevents.

## What the toolchain will tell you

| Diagnostic | When | What to do |
|---|---|---|
| [WHIZ500](../diagnostics/whiz500) | a service built with `new` inside a DI factory omits an injectable parameter | pass it from the provider, or pass `null` explicitly so the omission is a visible decision |
| [WHIZ501](../diagnostics/whiz501) | a constructor declares an optional injected parameter | make it required and move the default into the registration |
| `WhizbangRegistrationException` at startup | something declares a dependency nothing registers | register it, or call the `Add*` extension that supplies its default |

`WHIZ500` is deliberately syntactic: it does not know what a logger is, so it covers your own
services too without any attribute or registration on your part.

## Testing a composition that is deliberately partial

A fixture exercising one worker in isolation will not satisfy every requirement. Turn validation off
rather than registering services the test does not use:

```csharp
services.AddWhizbang(options => options.ValidateRegistrations = false);
```

If your fixture composes a worker that waits on schema readiness, give it an already-open gate.
Registering a real gate that nothing ever opens does not fail the test — it hangs it.

## Related

- [Overriding Defaults](overriding-defaults)
- [Injectable Services](injectable-services)
- [Registration Validation](registration-validation)
