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
  - src/Whizbang.Core/Capabilities/RequiresCapabilityAttribute.cs
  - src/Whizbang.Core/Capabilities/CapabilityRequirement.cs
  - src/Whizbang.Core/Configuration/ConfigurationManifest.cs
  - src/Whizbang.Core/Configuration/ConfigurationManifestRegistry.cs
  - src/Whizbang.Generators/ConfigurationManifestGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityDescriptorTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityRegistryTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityReportTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityMetricsTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilitiesStartupStepTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/RequiresCapabilityAttributeTests.cs
  - tests/Whizbang.Core.Tests/Configuration/ConfigurationManifestRegistryTests.cs
  - tests/Whizbang.Generators.Tests/ConfigurationManifestGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/ConfigurationManifestGeneratorCoverageTests.cs
---

# Capabilities

Whizbang depends on things outside its own process that may or may not be there: a Postgres extension,
a broker plugin, a feature of a managed service. Each of these is a **capability**, and every capability
follows the same pattern, whichever package provides it. You read the same states, the same startup
verdict and the same gauge for a Postgres extension as for anything a third-party package adds.

This release **detects and reports**, and lets a feature [declare the capability it
requires](#declaring-a-requirement) on the setting that turns it on. Naming those features in the verdict,
provisioning (creating and upgrading what the library may manage), and stopping startup when an explicitly
configured feature cannot have what it needs arrive in later releases; the types are shaped for them.

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

## Declaring a requirement {#declaring-a-requirement}
{verified: ConfigurationManifestGeneratorTests.AttributedProperty_IsRequiredUnderItsKeyAsync, ConfigurationManifestGeneratorTests.AttributedEnumMember_IsRequiredWhenTheKeySelectsItAsync, ConfigurationManifestRegistryTests.AttributedSetting_InThisAssembly_IsRegisteredAtLoadAsync}

A feature that needs a capability says so on the setting that turns it on. Put the attribute on the options
property, or on the enum member that selects the feature:

| Attribute | Declares |
|---|---|
| `[RequiresCapability("provider", "name")]` | any provider's capability, for example `("broker", "delayed_exchange")` |
| `[RequiresPostgresExtension("name")]` | a Postgres extension; shorthand for `[RequiresCapability("postgres", "name")]` |

- **On a property**, the feature needs the capability whenever the setting is set.
- **On an enum member**, it needs the capability when the setting is set to that member. Every property of
  that enum type, in every options type the package binds, carries the requirement.
- **`Feature`** names the feature as the verdict will show it. Without it, the requirement is named after the
  property or member that declares it.

```csharp{title="Declare what a package's settings require" description="An enum member that needs a Postgres extension and a property that needs a broker plugin, bound from a literal section so the generator records both." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["capabilities", "requirements", "configuration", "source-generators", "postgres"] tests=["ConfigurationManifestGeneratorTests.AttributedEnumMember_IsRequiredWhenTheKeySelectsItAsync", "ConfigurationManifestGeneratorTests.AttributedProperty_IsRequiredUnderItsKeyAsync", "ConfigurationManifestGeneratorTests.SecondAssembly_ReadsTheFirstAssemblysAttributesAndRegistersItsOwnManifestAsync"]}
public enum RewriteMode {
  Off,
  [RequiresPostgresExtension("pg_squeeze", Feature = "Online table rewrite")]
  Squeeze,
}

public sealed class ArchiveOptions {
  public RewriteMode Rewrite { get; set; }

  [RequiresCapability("broker", "delayed_exchange", Feature = "Delayed archiving")]
  public bool DelayArchiving { get; set; }
}

public static class ArchiveRegistration {
  public static IServiceCollection AddArchive(this IServiceCollection services, IConfiguration configuration) =>
    services.Configure<ArchiveOptions>(configuration.GetSection("Archive"));
}
```

This records two requirements: `postgres/pg_squeeze` for "Online table rewrite" when `Archive:Rewrite` is
`Squeeze`, and `broker/delayed_exchange` for "Delayed archiving" when `Archive:DelayArchiving` is set.

### How requirements are collected {#how-requirements-are-collected}
{verified: ConfigurationManifestGeneratorTests.NestedSection_KeysAndRequirementsCarryTheFullPathAsync, ConfigurationManifestGeneratorTests.DictionaryAndList_EntriesAreAWildcardSegmentAsync, ConfigurationManifestGeneratorTests.PrivateOptionsType_IsSkippedAsync, ConfigurationManifestGeneratorCoverageTests.BindingsWithoutAKnownPathOrBoundType_ProduceNoManifestAsync}

```mermaid{caption="The generator reads each literal binding at compile time; the assembly registers what it found when it loads." tests=["ConfigurationManifestGeneratorTests.SecondAssembly_ReadsTheFirstAssemblysAttributesAndRegistersItsOwnManifestAsync","ConfigurationManifestRegistryTests.WhizbangCore_RegistersItsOwnManifestAtLoadAsync","ConfigurationManifestRegistryTests.AttributedSetting_InThisAssembly_IsRegisteredAtLoadAsync"]}
flowchart LR
  B[A literal GetSection<br/>bound to ArchiveOptions] --> G[Configuration manifest<br/>generator, at build]
  A[RequiresCapability on a<br/>property or enum member] --> G
  G --> M[One manifest per assembly:<br/>sections, keys, requirements]
  M -->|module load| R[ConfigurationManifestRegistry]
  R --> V[Capability verdict]
```

Nothing reads the attributes at run time, so there is no reflection: the configuration manifest generator in
the `Whizbang.Generators` package reads them at build time, in every project that references it, and writes
one manifest per assembly. The assembly registers its manifest into `ConfigurationManifestRegistry` when it
loads. A third-party package declares its requirements exactly as Whizbang does.

The generator records a binding when the section is reached by `GetSection` calls whose keys are all
compile-time constants (`GetSection("Archive")`, `GetSection("Whizbang").GetSection("Archive")`, or a
`const string`), and the section is bound by one of:

| Call | Binds |
|---|---|
| `section.Bind(options)` or `ConfigurationBinder.Bind(section, options)` | the instance's type |
| `section.Get<TOptions>()` | `TOptions` |
| `services.Configure<TOptions>(section)` | `TOptions` |
| `services.AddOptions<TOptions>().Bind(section)` | `TOptions` |

From the bound type it records every key the binder reads under the section, in declaration order:

- a nested options object is a nested section (`Archive:Retention:Age`);
- `[ConfigurationKeyName("...")]` renames the key;
- a dictionary entry or list item is a `*` segment (`Archive:Databases:*:Vectors`), as in the
  [configuration key manifest](../configuration/configuration-reference.md#unknown-keys);
- a value the binder converts from one string (`TimeSpan`, `Guid`, `Uri`, an enum, and similar) is one key;
- static, indexer, read-only scalar and non-public properties are not bound and are not recorded.

It skips a binding whose path it cannot know for certain, and so can never record a wrong key: a key that is
not a constant, a section reached from a section passed in from elsewhere, `Bind(section, "key", options)`,
and a call that binds no named type. It also skips an options type that generated code cannot name, such as
a private nested class. Bind such a type from a section with a literal key in the same assembly, or make it
internal, to have its requirements recorded.

### Reading the requirements {#reading-the-requirements}
{verified: ConfigurationManifestRegistryTests.Requirements_AreEveryBindingsRequirementsOnceAcrossManifestsAsync, ConfigurationManifestRegistryTests.Manifests_AreOrderedByAssemblyNameAsync, RequiresCapabilityAttributeTests.Requirement_ReadsAsItsCapabilityKeyAndValueAsync}

`ConfigurationManifestRegistry.Requirements` lists every loaded assembly's requirements once each, in a
stable order. Each `CapabilityRequirement` carries the capability, the feature, the full key and, for an enum
member, the value that turns the feature on (`null` for a property). The capability verdict reads it; code can
too:

```csharp{title="List the features that need a capability" description="Reads every loaded assembly's declared requirements from the registry the generated manifests fill at load." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["capabilities", "requirements", "configuration", "registry"] tests=["ConfigurationManifestRegistryTests.Requirements_AreEveryBindingsRequirementsOnceAcrossManifestsAsync", "RequiresCapabilityAttributeTests.Requirement_ReadsAsItsCapabilityKeyAndValueAsync"]}
foreach (var requirement in ConfigurationManifestRegistry.Requirements
    .Where(r => r.Capability == new CapabilityId("postgres", "pg_squeeze"))) {
  // postgres/pg_squeeze: Online table rewrite (Archive:Rewrite = Squeeze)
  Console.WriteLine(requirement);
}
```

`ConfigurationManifestRegistry.Manifests` holds the rest of each manifest: per assembly, every section it
binds, the options type, and the keys under it.

## See also

- [Postgres extensions](postgres-extensions.md), the first provider
- [Startup pipeline](../startup/startup-pipeline.md)
- [Metrics reference: Whizbang.Capabilities](../observability/metrics.md#capabilities)
- [Configuration reference](../configuration/configuration-reference.md#capabilities-options)
