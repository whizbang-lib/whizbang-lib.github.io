---
title: Capabilities
pageType: reference
verifiedAgainstCommit: ddb69a39
verifiedDate: 2026-10-19
version: 1.0.0
category: Infrastructure
order: 10
description: >-
  One pattern for every external dependency Whizbang can use: capabilities
  identified by provider and name, probed per scope at startup, given one
  generic state, reported in one verdict format and one gauge, and extended by
  any package through a capability provider
tags: >-
  capabilities, external dependencies, providers, postgres extensions,
  startup, verdict, metrics, configuration, extensibility
codeReferences:
  - src/Whizbang.Core/Capabilities/CapabilityModel.cs
  - src/Whizbang.Core/Capabilities/CapabilityRegistry.cs
  - src/Whizbang.Core/Capabilities/CapabilityReport.cs
  - src/Whizbang.Core/Capabilities/CapabilityMetrics.cs
  - src/Whizbang.Core/Capabilities/CapabilitiesStartupStep.cs
  - src/Whizbang.Core/Capabilities/CapabilityServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityDescriptorTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityRegistryTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityReportTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityMetricsTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilitiesStartupStepTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityServiceCollectionExtensionsTests.cs
---

# Capabilities

Whizbang depends on things outside its own process that may or may not be there: a Postgres extension,
a broker plugin, a feature of a managed service. Each of these is a **capability**, and every capability
follows the same pattern, whichever package provides it. You read the same states, the same startup
verdict and the same gauge for a Postgres extension as for anything a third-party package adds.

This release **detects and reports**. Provisioning (creating and upgrading what the library may manage),
requirements declared on features, and stopping startup when an explicitly configured feature cannot have
what it needs arrive in later releases; the types are shaped for them.

## The pattern {#pattern}

```mermaid{caption="Providers describe and probe; the registry aggregates, reports and gauges, the same for every provider." tests=["CapabilityRegistryTests.RefreshAsync_AggregatesEveryProviderAndScope_WhateverTheProviderAsync","CapabilitiesStartupStepTests.ProbeOn_ProbesOnceAndReportsAsync","CapabilityMetricsTests.Gauge_ReportsOneSeriesPerCapabilityAndScope_WithEveryTagAsync"]}
flowchart LR
  P1[Postgres provider<br/>scope: database] --> R[Capability registry]
  P2[Any other provider<br/>scope: its own] --> R
  R --> V[Startup verdict<br/>Information and Debug]
  R --> G[whizbang.capability.state<br/>gauge]
  R --> Q[ICapabilityRegistry.GetState<br/>for code]
```

- **Identity.** A capability is `provider/name`, for example `postgres/pg_squeeze`.
- **Descriptor.** What it is for, the features that use it, whether the library may provision it, what the
  server needs, and the operator's fix for each problem state. Providers contribute descriptors; nothing is
  hard-coded in the core.
- **Probe.** A provider probes one scope at a time (a database, a broker virtual host) and returns one
  generic state per capability, with its own finer detail and the version where it knows one.
- **Registry.** `ICapabilityRegistry` holds the latest answer for every provider and scope. A provider that
  cannot probe a scope (unreachable, refused, timed out) reads **Unknown** there, with a warning naming the
  provider, the scope and the reason. Nothing a provider does can stop startup.

## States {#states}
{verified: CapabilityDescriptorTests.IsUsable_OnlyForReadyAndProvisionableAsync, CapabilityDescriptorTests.Remedy_UsesTheProvidersFixForTheStateAsync, CapabilityDescriptorTests.Remedy_FallsBackToAGenericFixWhenTheProviderGaveNoneAsync}

| State | Meaning | Usable |
|---|---|---|
| `Ready` | Installed or enabled, and usable. | yes |
| `Provisionable` | Absent, and the library may provision it. | yes |
| `NotPermitted` | The platform blocks it, for example an extension a managed server does not allowlist. | no |
| `NeedsServerChange` | Needs operator action at the server: a preload, a restart, a plugin to enable. | no |
| `NoPrivilege` | The identity the library uses cannot provision it. | no |
| `Missing` | Not available on this server at all. | no |
| `Unknown` | Could not be determined: the probe failed, is turned off, or has not run yet. | no |

Each provider keeps its own finer state as the status's detail (for Postgres, `NotAllowlisted` behind
`NotPermitted`), and its descriptor gives the fix for each problem state.

## Verdict {#verdict}
{verified: CapabilityReportTests.FormatUsable_ListsExactlyTheUsableCapabilitiesWithTheirPurposeAsync, CapabilityReportTests.FormatUnusable_ListsEachWithStateDetailPurposeAndFixAsync, CapabilityReportTests.Log_WritesOneBlockPairPerProviderAndScopeAsync}

After the schema is ready, the `Capabilities` step of the [startup pipeline](../startup/startup-pipeline.md)
probes every provider. It runs on every instance and never blocks readiness. For each provider and scope it
writes one Information block listing exactly the usable capabilities with their purpose:

```text
Capabilities of postgres on 'orders-db': 2 usable of 8
  postgres/vector (Ready, 0.8.0; Installed): vector fields and their similarity indexes
  postgres/pg_trgm (Provisionable; Available): substring (trigram) indexes
```

and one Debug block for the rest, each with the fix:

```text
Capabilities of postgres on 'orders-db' that are not usable
  postgres/pg_squeeze (NotPermitted; NotAllowlisted): online table rewrite without a long exclusive lock. Fix: add PG_SQUEEZE to ...
```

A line reads `provider/name (State[, version][; detail][: reason]): purpose`, and an unusable one adds the
fix. The format is the same for every provider. Later releases add, per capability, the features that
require it and the setting that turned each one on.

Code reads the same answer through `ICapabilityRegistry`:

```csharp{title="Ask whether a capability is usable in a scope" description="ICapabilityRegistry answers one state per capability and scope, for every provider; Unknown before the probe or where it could not run." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["capabilities", "startup", "registry", "postgres"] tests=["CapabilityRegistryTests.RefreshAsync_AggregatesEveryProviderAndScope_WhateverTheProviderAsync", "CapabilityRegistryTests.GetState_ComparesProviderAndNameWithoutRegardToCaseAsync"]}
public sealed class SearchFeature(ICapabilityRegistry capabilities) {
  public bool CanUseSubstringIndexes(string database) =>
    capabilities.GetState(new CapabilityId("postgres", "pg_trgm"), database)
      is CapabilityState.Ready or CapabilityState.Provisionable;
}
```

## Metrics {#metrics}

`whizbang.capability.state` on the `Whizbang.Capabilities` meter: one series per capability and scope,
value 1, tagged `provider`, `capability`, `scope` and `state`. See the
[metrics reference](../observability/metrics.md#capabilities).

## Configuration {#configuration}
{verified: CapabilityServiceCollectionExtensionsTests.ProbeOnStartup_DefaultsToTrue_WithoutConfigurationAsync, CapabilityServiceCollectionExtensionsTests.ProbeOnStartup_BindsFromConfigurationAsync, CapabilitiesStartupStepTests.ProbeTurnedOff_IsSkippedWithoutProbingAsync}

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:Capabilities:ProbeOnStartup` | `Whizbang__Capabilities__ProbeOnStartup` | `true` | `false` skips the startup probe; every capability then reads `Unknown`. |

A key present in configuration overrides a value set in code; an absent key leaves it.

```json{title="Turn the capability probe off" description="Skips the startup probe; every capability then reads Unknown." category="Configuration" difficulty="BEGINNER" tags=["capabilities", "configuration", "startup"] tests=["CapabilityServiceCollectionExtensionsTests.ProbeOnStartup_BindsFromConfigurationAsync"]}
{
  "Whizbang": {
    "Capabilities": {
      "ProbeOnStartup": false
    }
  }
}
```

## Providers {#providers}

| Provider | Scope | Page |
|---|---|---|
| `postgres` | the database, under its driver's name | [Postgres extensions](postgres-extensions.md) |

## Adding a capability provider {#adding-a-capability-provider}
{verified: CapabilityRegistryTests.RefreshAsync_AggregatesEveryProviderAndScope_WhateverTheProviderAsync, CapabilityRegistryTests.AProviderThatCannotProbe_ReadsUnknownAndWarns_WithoutAffectingOthersAsync, CapabilityServiceCollectionExtensionsTests.Registers_OneRegistryOverEveryProvider_AndOneStep_HoweverOftenCalledAsync}

A package that depends on something outside the process (its own or a third party's) adds a provider and
gets the verdict, the gauge and the configuration with no further work.

1. **Describe** each capability once with a `CapabilityDescriptor`: its `CapabilityId` (your provider's
   name and the capability's), its purpose, the features that use it, whether the library may provision
   it, its prerequisites as short phrases, and the fix for each problem state you can name. A state
   without a fix gets a generic one.
2. **Implement `ICapabilityProvider`**: `Name`, `Descriptors`, `Scopes` (whatever your scope is: a
   database, a virtual host, a namespace) and `ProbeAsync(scope, cancellationToken)`, returning one
   `CapabilityStatus` per descriptor with the generic state, the version if you know it, and your own
   finer state as the detail. Probe with as few round trips as you can; it runs on every instance at
   every start.
3. **Let failures throw.** A probe that cannot reach its scope may throw; the registry reads it as
   Unknown with the exception's message and a warning. Only the host's cancellation propagates.
4. **Register** the provider as an `ICapabilityProvider` singleton and call `AddWhizbangCapabilities()`,
   which is safe to call from every package that registers a provider.

```csharp{title="A capability provider for a broker plugin" description="Describes one capability, probes one scope per virtual host, and registers through the capability registry." framework="NET10" category="Configuration" difficulty="ADVANCED" tags=["capabilities", "providers", "extensibility", "dependency-injection"] tests=["CapabilityRegistryTests.RefreshAsync_AggregatesEveryProviderAndScope_WhateverTheProviderAsync", "CapabilityServiceCollectionExtensionsTests.Registers_OneRegistryOverEveryProvider_AndOneStep_HoweverOftenCalledAsync"]}
public sealed class BrokerPluginProvider(IBrokerAdmin admin) : ICapabilityProvider {
  private static readonly CapabilityDescriptor _delayed = new(
    new CapabilityId("broker", "delayed_exchange"),
    Purpose: "delayed message delivery",
    Features: ["Scheduled sends"],
    Provisionable: false,
    Prerequisites: ["the delayed-exchange plugin enabled on the broker"],
    Remedies: new Dictionary<CapabilityState, string> {
      [CapabilityState.NeedsServerChange] = "enable the delayed-exchange plugin on the broker",
    });

  public string Name => "broker";
  public IReadOnlyList<CapabilityDescriptor> Descriptors { get; } = [_delayed];
  public IReadOnlyList<string> Scopes => admin.VirtualHosts;

  public async Task<IReadOnlyList<CapabilityStatus>> ProbeAsync(string scope, CancellationToken cancellationToken) {
    var enabled = await admin.IsPluginEnabledAsync("delayed_exchange", scope, cancellationToken);
    var state = enabled ? CapabilityState.Ready : CapabilityState.NeedsServerChange;
    return [new CapabilityStatus(_delayed, scope, state, Version: null, Detail: null, Reason: null)];
  }
}

services.AddSingleton<ICapabilityProvider, BrokerPluginProvider>();
services.AddWhizbangCapabilities();
```

## See also

- [Postgres extensions](postgres-extensions.md), the first provider
- [Startup pipeline](../startup/startup-pipeline.md)
- [Metrics reference: Whizbang.Capabilities](../observability/metrics.md#capabilities)
- [Configuration reference](../configuration/configuration-reference.md#capabilities-options)
