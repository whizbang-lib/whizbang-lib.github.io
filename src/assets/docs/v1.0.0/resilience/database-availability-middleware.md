---
title: Availability Gate & Turnkey Hosting
pageType: guide
version: 1.0.0
category: Resilience
order: 1
description: Non-blocking startup migration by default, with the availability gate and health checks auto-wired into AddWhizbang
tags: 'availability, middleware, non-blocking, migration, startup, turnkey, aspnet'
codeReferences:
  - src/Whizbang.Core/Workers/SchemaInitializationOptions.cs
  - src/Whizbang.Hosting.AspNet/DatabaseAvailabilityMiddleware.cs
  - src/Whizbang.Hosting.AspNet/WhizbangAvailabilityStartupFilter.cs
  - src/Whizbang.Hosting.AspNet/ServiceCollectionExtensions.cs
---

# Availability Gate & Turnkey Hosting

A large one-time schema migration can run longer than a Kubernetes startup-probe budget. If startup
*blocks* on it, the port never binds, the probe gets connection-refused, and the pod is killed
mid-migration. Whizbang's default is the opposite, out of the box:

- **Non-blocking schema init is the default.** `SchemaInitializationOptions.NonBlockingSchemaInit`
  defaults to `true`: the host binds and answers liveness immediately while migrations run in the
  background behind the schema-ready gate. Opt out with `false` if code after `host.Run()` must assume
  a fully-migrated schema the instant the host starts.
- **The availability gate serves reads and 503s writes** while the schema isn't ready, then becomes a
  pass-through — so a migrating host still serves read traffic (the read-model tables aren't touched by
  an event-store migration) while the write path waits.
- **Everything is auto-wired.** No `app.Use…` calls; opt out anywhere.

## Turnkey — how it wires itself

`AddWhizbang()` automatically folds in `AddWhizbangAspNet()` **when the ASP.NET hosting assembly is
loaded** (a `[ModuleInitializer]` self-registers the integration — AOT-safe, and Core never references
the ASP.NET assembly). `AddWhizbangAspNet()` then injects, via `IStartupFilter` (front of the
pipeline, ahead of your endpoints):

- the **availability gate** (default `MutationsOnly`: reads pass, writes 503 while not ready; probes
  `/alive`, `/health`, `/version` always exempt), and
- the **managed liveness/readiness health checks**.

Because it goes in through a startup filter (order-independent, front of pipeline) and the health
checks compose into a set, there's **no ordering concern** with HotChocolate, FastEndpoints, or your
own middleware.

## Configuring / opting out

```csharp{title="Configure or opt out" description="Change the gate mode or place AddWhizbangAspNet yourself" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","AspNet"] tests=["WhizbangAvailabilityStartupFilterTests.Disabled_NotGatedAsync","WhizbangHostingIntegrationTests.AddWhizbang_InvokesHostingIntegration_ByDefault_SkipsWhenOptedOutAsync"]}
// Change the gate mode, exempt paths, or turn the gate off:
services.Configure<WhizbangAvailabilityOptions>(o => {
  o.Mode = AvailabilityGateMode.AllNonExempt; // 503 every non-exempt request instead of just writes
  // o.Enabled = false;                        // no gate at all
});

// Opt out of the auto-encompass and place AddWhizbangAspNet yourself (e.g. for strict ordering):
services.AddWhizbang(o => o.AutoRegisterAspNetHosting = false);
services.AddWhizbangAspNet(); // call it exactly where you want
```

When non-blocking init is on, set a generous `SchemaInitializationOptions.MigrationTimeout` to bound a
genuinely wedged (deadlocked/lock-waiting) migration — it stays `null` (no ceiling) by default.

See [Managed-Resource Health](managed-resource-health) for what "ready during migration" means and
[Run-Control](managed-resource-run-control) for what's paused while it runs.
