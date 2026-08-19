---
title: The Startup Status Surface
pageType: guide
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 4
description: >-
  "What is it doing right now?" over the host's own API — the opt-in status
  endpoint, its instance and fleet sections, honest degradation, and the
  information-disclosure boundary
tags: >-
  startup, status, diagnostics, endpoint, fleet, observability, minimal-api,
  fastendpoints, hotchocolate, security
codeReferences:
  - src/Whizbang.Hosting.AspNet/StartupStatusEndpoints.cs
  - src/Whizbang.Hosting.AspNet/WhizbangAvailabilityExemptions.cs
  - src/Whizbang.Core/Startup/StartupStatusReport.cs
  - src/Whizbang.Core/Startup/StartupFleetStatus.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/WhizbangStartupStatusEndpointBase.cs
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateStartupStatusExtensions.cs
testReferences:
  - tests/Whizbang.Hosting.AspNet.Tests/StartupStatusEndpointsTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/WhizbangStartupStatusEndpointBaseTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/StartupStatusQueryTests.cs
---

# The Startup Status Surface

The question people ask during a slow boot is *"what is it doing right now?"* — and the [startup pipeline](startup-pipeline) answers it directly, over the host's own API surface. The surface is **opt-in**: publishing internal state is the host's decision, not a package reference's. Each surface is one explicit call.

```csharp{title="Mounting the status endpoint" description="Minimal API — one call, host auth applies" category="Configuration" difficulty="BEGINNER" tags=["Startup","Status"] tests=["StartupStatusEndpointsTests.Started_ProjectsTheOrderedStepsWithLiveStatusAsync","StartupStatusEndpointsTests.SelfExemption_TheAvailabilityGateNever503sTheStatusRouteAsync"]}
// Default route /whizbang/startup — namespaced so one edge rule against /whizbang/*
// covers it and anything mounted beside it later. Overridable.
app.MapWhizbangStartupStatus();

// It returns IEndpointConventionBuilder, so host security chains as on any endpoint:
app.MapWhizbangStartupStatus("/ops/boot").RequireAuthorization("operators");
```

- **FastEndpoints** — declare an endpoint inheriting `WhizbangStartupStatusEndpointBase`; declaring it *is* the opt-in, and `Roles()` / `Permissions()` / `AccessControl()` apply as on any endpoint.
- **HotChocolate** — `AddWhizbangStartupStatus()` contributes the `whizbangStartup` query field; `[Authorize]` and the existing GraphQL security integration apply to it exactly as elsewhere.

All three serve the same `StartupStatusReport`, built by one shared reporter — the surfaces cannot drift apart in what they disclose. The minimal-API surface is primary: a GraphQL schema whose build touches lens types may not be buildable during `Migrate` at all, and a diagnostic reachable only through the subsystem under diagnosis is not a diagnostic.

## Two sections, two questions

The report has two sections because the endpoint gets reached two different ways:

- **`instance`** — the process that answered this request: current step, the ordered step list with status, duration and outcome, and whether its pipeline is complete and ready. Read from memory, so it is exact and current.
- **`fleet`** — every live instance, from the database: version, lifecycle phase, [capabilities held](capabilities-and-duties), whether it is evicted, and seconds since it was last heard from.

Behind a load balancer, the fleet section is what makes checking a rolling deployment one request instead of curling repeatedly and hoping to reach each pod; the instance section is what identifies *which* instance answered — and the responder appears in both, its id being the key that finds its row among the rest.

The sections are deliberately not symmetrical. **Fidelity differs**: step-level detail lives in each instance's memory, so the fleet section carries only the coarser persisted facts — absence of detail means *not visible from here*, never *no progress*. **Freshness differs**: the instance section is live; every fleet row is only as current as that instance's last heartbeat, so each carries its own age.

## Honest degradation

The endpoint must not share a failure domain with what it reports on, and it must not flatter:

- **Self-exempting.** Mapping the route registers it with the availability gate's exempt set alongside `/alive`, `/health` and `/version` — the gate never 503s the diagnostic that explains the 503s. Not a step the caller can forget.
- **Not-started is a stated condition.** Before the pipeline has begun, the report says so — an empty step list and a pipeline that has not started never serialize identically.
- **Fleet-unavailable is a stated condition.** Before the database is reachable — or on a host with no fleet source — the fleet section reports *unavailable* with the reason, never an empty list. "No other instances" and "cannot see the other instances" mean opposite things during an incident.
- **Auth in front of it must not depend on Whizbang having started.** Whizbang's own permission model is safe (claims-based, no database round-trip); a consumer policy that resolves roles from the database would block on the very migration the endpoint reports on — a failure that looks like a hang.

## The information-disclosure boundary

The split that matters is not *less detail versus more* but **content the framework authors versus content it does not control**. The default projection is entirely the former — step names, states, durations, every value a framework constant. The `reason` strings are the latter: they originate in exception messages, which routinely carry schema names, table names, constraint names and raw driver text. They are therefore a separate opt-in (`includeReasons`), not a verbosity dial:

```csharp{title="Reasons are an opt-in, not a dial" description="A host that secured the endpoint may turn them on" category="Configuration" difficulty="INTERMEDIATE" tags=["Startup","Status","Security"] tests=["StartupStatusEndpointsTests.Reasons_AreExcludedByDefault_TheyCarryContentTheFrameworkDoesNotControlAsync","StartupStatusEndpointsTests.Reasons_AppearWhenTheHostOptsInAsync"]}
app.MapWhizbangStartupStatus(includeReasons: true)
   .RequireAuthorization("operators");   // opt in only where the audience is trusted
```

Fleet failure text rides the same opt-in.

One route is ruled out on purpose: **`/.well-known/` is the wrong home** for an access-controlled diagnostic. That prefix is routinely allowlisted past authentication at CDNs and ingress controllers for ACME challenges, it is a registry rather than a free namespace, and it is the first place scanners enumerate. The default lives under `/whizbang/` instead.

## Related

- [The Startup Pipeline](startup-pipeline) — the state the surface projects
- [Capabilities and Duties](capabilities-and-duties) — the holdings the fleet section reads
- [Rolling Upgrades](rolling-upgrades) — watching a mixed-version rollout land
- [Database Readiness](../workers/database-readiness#the-startup-status-surface) — the readiness machinery around it
