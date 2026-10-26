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
  - src/Whizbang.Core/Capabilities/ICapabilityRequirementSource.cs
  - src/Whizbang.Core/Capabilities/CapabilityActivation.cs
  - src/Whizbang.Core/Capabilities/CapabilityVerdict.cs
  - src/Whizbang.Core/Capabilities/CapabilityVerdictEnforcer.cs
  - src/Whizbang.Core/Capabilities/CapabilityHealthCheck.cs
  - src/Whizbang.Core/Capabilities/CapabilityProvisioning.cs
  - src/Whizbang.Core/Capabilities/CapabilityAutoProvision.cs
  - src/Whizbang.Core/Capabilities/CapabilityVersion.cs
  - src/Whizbang.Data.Postgres/PostgresCapabilityProvisioner.cs
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
  - tests/Whizbang.Core.Tests/Capabilities/ConfigurationManifestRequirementSourceTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityActivationResolverTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityVerdictTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityHealthCheckTests.cs
  - tests/Whizbang.Core.Component.Tests/Capabilities/CapabilityVerdictEnforcerTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityProvisioningTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityAutoProvisionTests.cs
  - tests/Whizbang.Core.Tests/Capabilities/CapabilityVersionTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresCapabilityProvisioningIntegrationTests.cs
---

# Capabilities

Whizbang depends on things outside its own process that may or may not be there: a Postgres extension,
a broker plugin, a feature of a managed service. Each of these is a **capability**, and every capability
follows the same pattern, whichever package provides it. You read the same states, the same startup
verdict and the same gauge for a Postgres extension as for anything a third-party package adds.

A feature [declares the capability it requires](#declaring-a-requirement) on the setting that turns it on.
At startup every capability is probed, and every requirement in force is [judged](#validation): a feature the
operator explicitly configured whose capability is not ready stops the host, and a feature a default turned on
degrades with a warning. Before the verdict, the library [provisions](#provisioning) what a requirement in force
needs and it may manage: it creates a capability that is absent and upgrades one with a newer version available,
unless the operator switched that off.

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
{verified: CapabilityVerdictTests.Explicit_Ready_ProceedsAsync, CapabilityVerdictTests.Explicit_KnownAndNotReady_FailsStartWithTheFixAsync, CapabilitiesStartupStepTests.ExplicitRequirement_OnACapabilityNotReady_IsAnErrorLine_AndTheVerdictIsPublishedAsync, CapabilityReportTests.Log_WritesOneBlockPairPerProviderAndScopeAsync}

After the schema is ready, the `Capabilities` step of the [startup pipeline](../startup/startup-pipeline.md)
probes every provider, decides which [requirements are in force](#activation), [provisions](#provisioning) what
they need, and judges them. It runs on every instance and never blocks readiness.

Each **required** capability gets one line per scope, naming every feature that requires it, the setting that
turned the feature on, and whether the operator set it (`explicit`) or a default did (`default`). It is written
at Information when the capability is Ready, Warning when it warns or degrades, and Error when it fails start:

```text
capability postgres/pg_squeeze on 'orders': Ready, created 1.7.0. Required by: Online table rewrite (Whizbang:Workers:Maintenance:TableRewriteStrategy = PgSqueeze, explicit)
capability postgres/pg_trgm on 'orders': Ready, already present 1.6. Required by: Substring indexes on perspective fields (OrderSearch, default)
capability postgres/pg_partman on 'orders': NotPermitted; NotAllowlisted. Fix: add PG_PARTMAN to azure.extensions. Required by: Partition management (Whizbang:Workers:Maintenance:Partitioning:Strategy = Auto, default)
```

A Ready capability says what [provisioning](#provisioning) did before its version: `created`, `already present`
or `upgraded`. A capability no registered provider describes reads `Unknown` with no scope, for example
`capability broker/delayed_exchange: Unknown: no registered provider describes it. ...`.

For capabilities nothing requires, it writes per provider and scope one Information block listing exactly the
usable ones with their purpose:

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

A block line reads `provider/name (State[, version][; detail][: reason]): purpose`, and an unusable one adds
the fix. The format is the same for every provider.

Code reads the same answer through `ICapabilityRegistry`:

```csharp{title="Ask whether a capability is usable in a scope" description="ICapabilityRegistry answers one state per capability and scope, for every provider; Unknown before the probe or where it could not run." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["capabilities", "startup", "registry", "postgres"] tests=["CapabilityRegistryTests.RefreshAsync_AggregatesEveryProviderAndScope_WhateverTheProviderAsync", "CapabilityRegistryTests.GetState_ComparesProviderAndNameWithoutRegardToCaseAsync"]}
public sealed class SearchFeature(ICapabilityRegistry capabilities) {
  public bool CanUseSubstringIndexes(string database) =>
    capabilities.GetState(new CapabilityId("postgres", "pg_trgm"), database)
      is CapabilityState.Ready or CapabilityState.Provisionable;
}
```

## Validation {#validation}
{verified: CapabilityVerdictTests.Explicit_Ready_ProceedsAsync, CapabilityVerdictTests.Explicit_KnownAndNotReady_FailsStartWithTheFixAsync, CapabilityVerdictTests.Explicit_Unknown_WarnsAsync, CapabilityVerdictTests.Implicit_Ready_UsesItAsync, CapabilityVerdictTests.Implicit_NotReady_DegradesAsync, CapabilityVerdictEnforcerTests.AFailingVerdict_StopsTheHostWithExitCodeOne_NamingTheLineAsync}

A capability satisfies a requirement only when it is `Ready`. `Provisionable` is not enough on its own, but the
step [provisions](#provisioning) a required capability before it judges it, so one the library may create reads
`Ready` here unless provisioning is switched off or the server refuses it.

| Requirement | Capability | Outcome |
|---|---|---|
| explicit | `Ready` | proceed |
| explicit | known, not `Ready` | **the host stops**, with the verdict line |
| explicit | `Unknown` | warn; the feature fails loudly when it runs if the capability is missing |
| implicit | `Ready` | the feature uses it |
| implicit | not `Ready` | the feature degrades, with a warning |

When the verdict has a failing line, a hosted service logs every failing line at Critical, sets the process
exit code to 1 and stops the application, so an orchestrator sees a failed start rather than an orderly
shutdown. It waits for the verdict in the background, so it never holds the host's own start: the probe runs
after the schema is migrated. Fix the capability, or remove the setting that turns the feature on.

With `Whizbang:Capabilities:ProbeOnStartup` set to `false`, the verdict is still judged with every capability
`Unknown`, so an explicit requirement warns rather than passing unseen.

## Provisioning {#provisioning}
{verified: CapabilityProvisioningTests.AnExplicitRequirementOnAProvisionableCapability_IsCreated_AndPassesTheVerdictAsync, CapabilityProvisioningTests.AnUpgrade_IsRecordedWithTheNewVersionAsync, CapabilityProvisioningTests.ProvisioningOff_AnOperatorCreatedCapabilityIsStillDetected_AndReadsAlreadyPresentAsync, CapabilityProvisioningTests.ACapabilityNothingRequires_IsNeverProvisionedAsync}

Between the probe and the verdict, one runner looks at every capability a requirement in force names, in each
scope it applies to:

| Probed state | Runner | Recorded as |
|---|---|---|
| `Provisionable` | creates it through the provider | `created` |
| `Ready`, a newer version available | upgrades it through the provider | `upgraded` |
| `Ready`, nothing newer | nothing | `already present` |
| anything else | nothing; the verdict reports the state and its fix | (none) |

```mermaid{caption="Provisioning runs between the probe and the verdict, so a capability the library creates is judged Ready." tests=["CapabilityProvisioningTests.AnExplicitRequirementOnAProvisionableCapability_IsCreated_AndPassesTheVerdictAsync","CapabilityProvisioningTests.PerCapabilityFalse_OverridesGlobalTrue_AndTheVerdictNamesTheSettingAsync","CapabilityProvisioningTests.NoPrivilege_OnAnImplicitRequirement_IsReportedNeverThrown_AndNothingIsAttemptedAsync"]}
flowchart LR
  P[Probe every scope] --> R{Required by a<br/>requirement in force?}
  R -->|no| D[Detected only]
  R -->|yes| S{AutoProvision on,<br/>provider may provision?}
  S -->|no| K[Kept as probed,<br/>with the reason]
  S -->|yes| A[Create or upgrade<br/>through the provider]
  A --> V[Verdict]
  K --> V
  D --> V
```

- **Only what is required.** A capability nothing requires is only detected, however usable.
- **Detection never depends on the switch.** With provisioning off, a capability an operator created reads
  `Ready, already present` and satisfies its requirements as before.
- **Nothing is thrown.** A capability the server refuses (`NoPrivilege`, `NotPermitted`) is reported by its
  verdict line: an implicit requirement degrades with a warning, an explicit one stops the host as any other
  unmet explicit requirement does. A provider that fails unexpectedly is logged with the exception, and the
  capability keeps the state the probe read, with the failure as its reason.
- **A held-back upgrade keeps working.** An upgrade that is switched off, refused or fails leaves the
  capability `Ready, already present` at its installed version, with the available version and the reason.
- **Nothing on a guess.** With `ProbeOnStartup` off every capability is `Unknown`, and nothing is provisioned.
- **Versions** are compared segment by segment, numerically where both segments are numbers (`1.10` is newer
  than `1.9`).

### Switching provisioning off {#switching-provisioning-off}
{verified: CapabilityAutoProvisionTests.Capability_OverridesProviderAndGlobalAsync, CapabilityAutoProvisionTests.Provider_OverridesGlobalAsync, CapabilityAutoProvisionTests.AValueThatIsNotABoolean_DefersToTheNextLevelAsync, CapabilityProvisioningTests.PerProviderFalse_OverridesGlobalTrue_AndPerCapabilityTrue_OverridesThatAsync}

`AutoProvision` has three levels. The most specific level that is set wins, and a value that is not `true` or
`false` counts as not set:

| Level | Key | Default |
|---|---|---|
| per capability | `Whizbang:Capabilities:<provider>:<name>:AutoProvision` | inherits |
| per provider | `Whizbang:Capabilities:<provider>:AutoProvision` | inherits |
| global | `Whizbang:Capabilities:AutoProvision` | `true` |

A capability the switch holds back names the deciding key in its verdict line:

```text
capability postgres/pg_squeeze on 'orders': Provisionable, 1.7.0; Available: provisioning is turned off (Whizbang:Capabilities:postgres:pg_squeeze:AutoProvision = false). Fix: ...
```

```json{title="Provision everything but one extension" description="Leaves provisioning on globally and for Postgres, and turns it off for pg_squeeze only; an operator-created pg_squeeze is still detected and used." category="Configuration" difficulty="BEGINNER" tags=["capabilities", "provisioning", "configuration", "postgres"] tests=["CapabilityProvisioningTests.PerCapabilityFalse_OverridesGlobalTrue_AndTheVerdictNamesTheSettingAsync", "CapabilityProvisioningTests.ProvisioningOff_AnOperatorCreatedCapabilityIsStillDetected_AndReadsAlreadyPresentAsync"]}
{
  "Whizbang": {
    "Capabilities": {
      "AutoProvision": true,
      "postgres": {
        "pg_squeeze": {
          "AutoProvision": false
        }
      }
    }
  }
}
```

### Postgres {#provisioning-postgres}
{verified: PostgresCapabilityProvisioningIntegrationTests.Create_AnAvailableExtension_IsCreated_AndReadsCreatedAtItsVersionAsync, PostgresCapabilityProvisioningIntegrationTests.Upgrade_AnOlderInstalledVersion_IsRecordedAsUpgradedAsync, PostgresCapabilityProvisioningIntegrationTests.Create_WaitsForTheSchemaLock_ThenCreatesAsync, PostgresCapabilityProvisioningIntegrationTests.Upgrade_RefusedToARoleThatDoesNotOwnIt_StaysReadyAndPresent_WithTheRefusalAsync, PostgresCapabilityProvisioningIntegrationTests.Create_RefusedByTheServer_ReturnsTheStateTheRefusalReveals_WithoutThrowingAsync}

The Postgres provider creates with `CREATE EXTENSION IF NOT EXISTS` and upgrades with `ALTER EXTENSION ... UPDATE`,
each in one transaction on its own connection that first takes the schema lock (the advisory lock schema
initialization takes, for the schema the extension is created in) with `pg_advisory_xact_lock`. A migration pass,
or another instance provisioning the same schema, runs before or after it and never alongside, and the lock ends
with the transaction, so it cannot be left behind by a pooler. While another session holds the lock it logs
`Provisioning postgres/<name> on '<database>' waits for the schema lock of '<schema>', which another session holds`
at Information, and waits without a client timeout.

Under the lock it reads the extension again: one another session created or upgraded meanwhile is recorded as
`already present`. The upgrade target is the server's default version (`pg_available_extensions.default_version`).
An extension that only a privileged role can create still needs that role once; see the fixes on
[Postgres extensions](postgres-extensions.md).

### A provider's provisioner {#adding-a-provisioner}
{verified: CapabilityServiceCollectionExtensionsTests.TheStep_RunsEveryRegisteredProvisionerAsync, CapabilityProvisioningTests.AProviderWithNoProvisioner_IsReportedAsSuchAsync, CapabilityProvisioningTests.ACapabilityTheLibraryNeverProvisions_IsLeftForTheOperatorAsync}

A provider that can create or upgrade its capabilities registers an `ICapabilityProvisioner` next to its
`ICapabilityProvider`, with the same `Provider` name. The runner decides when (a requirement in force, the switch
on, a descriptor with `Provisionable: true`); the provisioner decides how, and answers with the status after the
action, its `Provisioning` set to what it did. Return a refusal as the state it reveals, with the platform's words
as the reason; throw only for the unexpected. A provider without a provisioner is only detected, and its
capabilities name that as the reason they were not provisioned.

```csharp{title="A provisioner for a broker plugin" description="Enables the plugin when the runner asks it to create the capability, and answers with the state read back afterwards." framework="NET10" category="Configuration" difficulty="ADVANCED" tags=["capabilities", "provisioning", "providers", "extensibility"] tests=["CapabilityServiceCollectionExtensionsTests.TheStep_RunsEveryRegisteredProvisionerAsync", "CapabilityProvisioningTests.AnExplicitRequirementOnAProvisionableCapability_IsCreated_AndPassesTheVerdictAsync"]}
public sealed class BrokerPluginProvisioner(IBrokerAdmin admin) : ICapabilityProvisioner {
  public string Provider => "broker";

  public async Task<CapabilityStatus> ProvisionAsync(
      CapabilityStatus status, CapabilityProvisionAction action, CancellationToken cancellationToken) {
    if (!await admin.TryEnablePluginAsync(status.Descriptor.Id.Name, status.Scope, cancellationToken)) {
      return status with { State = CapabilityState.NoPrivilege, Reason = "the broker refused to enable the plugin" };
    }
    return status with { State = CapabilityState.Ready, Provisioning = CapabilityProvisioningOutcome.Created };
  }
}

services.TryAddEnumerable(ServiceDescriptor.Singleton<ICapabilityProvisioner, BrokerPluginProvisioner>());
```

## Health {#health}
{verified: CapabilityHealthCheckTests.AnExplicitRequirementFailing_IsUnhealthy_WithItsLineAsync, CapabilityHealthCheckTests.AnImplicitRequirementDegrading_IsDegradedAsync, CapabilityHealthCheckTests.EveryRequirementSatisfied_IsHealthyAsync, CapabilityServiceCollectionExtensionsTests.Registers_TheManifestSource_TheEnforcer_AndOneHealthEntry_HoweverOftenCalledAsync}

`AddWhizbangCapabilities()` registers one health entry, `whizbang_capabilities` (tags `whizbang`,
`capabilities`), read from the latest verdict:

| Status | When |
|---|---|
| Healthy | no capability is required, or every required one is `Ready` |
| Degraded | a required capability warns or degrades |
| Unhealthy | an explicitly configured feature lacks its capability |

Its data holds, under `capabilities`, the verdict line of every required capability that is not satisfied.

## Metrics {#metrics}

`whizbang.capability.state` on the `Whizbang.Capabilities` meter: one series per capability and scope,
value 1, tagged `provider`, `capability`, `scope`, `state` and `required` (`explicit`, `implicit` or `none`,
from the latest verdict). See the
[metrics reference](../observability/metrics.md#capabilities).

## Configuration {#configuration}
{verified: CapabilityServiceCollectionExtensionsTests.ProbeOnStartup_DefaultsToTrue_WithoutConfigurationAsync, CapabilityServiceCollectionExtensionsTests.ProbeOnStartup_BindsFromConfigurationAsync, CapabilitiesStartupStepTests.ProbeTurnedOff_IsSkippedWithoutProbingAsync, CapabilityServiceCollectionExtensionsTests.AutoProvision_DefaultsToTrue_AndBindsFromConfigurationAsync}

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:Capabilities:ProbeOnStartup` | `Whizbang__Capabilities__ProbeOnStartup` | `true` | `false` skips the startup probe; every capability then reads `Unknown`, and nothing is provisioned. |
| `Whizbang:Capabilities:AutoProvision` | `Whizbang__Capabilities__AutoProvision` | `true` | `false` stops the library creating or upgrading any capability; detection is unchanged. See [provisioning](#switching-provisioning-off). |
| `Whizbang:Capabilities:<provider>:AutoProvision` | `Whizbang__Capabilities__postgres__AutoProvision` | inherits | Overrides the global switch for one provider. |
| `Whizbang:Capabilities:<provider>:<name>:AutoProvision` | `Whizbang__Capabilities__postgres__pg_squeeze__AutoProvision` | inherits | Overrides both for one capability. |

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

- **On a bool property**, the feature needs the capability when the setting is `true`. **On any other
  property**, it needs it whenever the setting has a value.
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
`Squeeze` (default `Off`), and `broker/delayed_exchange` for "Delayed archiving" when `Archive:DelayArchiving`
is `true` (default `false`).

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
stable order. Each `CapabilityRequirement` carries the capability, the feature, the full key, the value that
turns the feature on (an enum member's name, `true` for a bool, `null` when any value does) and the setting's
declared default. The capability verdict reads it through a [requirement source](#requirement-sources); code
can too:

```csharp{title="List the features that need a capability" description="Reads every loaded assembly's declared requirements from the registry the generated manifests fill at load." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["capabilities", "requirements", "configuration", "registry"] tests=["ConfigurationManifestRegistryTests.Requirements_AreEveryBindingsRequirementsOnceAcrossManifestsAsync", "RequiresCapabilityAttributeTests.Requirement_ReadsAsItsCapabilityKeyAndValueAsync"]}
foreach (var requirement in ConfigurationManifestRegistry.Requirements
    .Where(r => r.Capability == new CapabilityId("postgres", "pg_squeeze"))) {
  // postgres/pg_squeeze: Online table rewrite (Archive:Rewrite = Squeeze)
  Console.WriteLine(requirement);
}
```

`ConfigurationManifestRegistry.Manifests` holds the rest of each manifest: per assembly, every section it
binds, the options type, and the keys under it.

The generator records each setting's **declared default** from its initializer when that is a compile-time
constant (`= RewriteMode.Off`, `= true`, `= DEFAULT_LIMIT`). With no initializer, a bool defaults to `false`
and an enum to its zero member; a nullable setting has no default. A non-constant initializer
(`= TimeSpan.FromMinutes(5)`), or an options type from a referenced assembly, whose initializers metadata does
not carry, has no default the generator can read.

### Activation {#activation}
{verified: CapabilityActivationResolverTests.KeySetToTheMember_IsExplicitAsync, CapabilityActivationResolverTests.KeyAbsent_DefaultTurnsTheFeatureOn_IsImplicitAsync, CapabilityActivationResolverTests.KeySetToAnotherMember_IsNotInForce_EvenWhenTheDefaultWouldBeAsync, CapabilityActivationResolverTests.WildcardKey_IsInForceOncePerConfiguredEntryThatTurnsItOnAsync}

At startup each requirement is checked against configuration:

- **Explicit**: the key is set to a value that turns the feature on (compared without regard to case). For a
  key with a `*` segment, each configured entry is checked on its own, under its own key.
- **Implicit**: the key is absent and the declared default turns the feature on. An entry under a `*` segment
  exists only when configured, so it has no default.
- **Not in force**: the key is set to anything else (the operator turned the feature off), or it is absent and
  the default leaves the feature off.

Only configuration is read. A value set in code (`services.Configure<T>(o => ...)`) is not seen: the feature is
judged by its key and declared default.

### Requirement sources {#requirement-sources}
{verified: ConfigurationManifestRequirementSourceTests.Requirements_AreTheConfigurationManifestsAsync, CapabilitiesStartupStepTests.ExplicitRequirement_OnACapabilityNotReady_IsAnErrorLine_AndTheVerdictIsPublishedAsync}

The verdict reads every registered `ICapabilityRequirementSource`. The configuration manifests are the first,
registered by `AddWhizbangCapabilities()`. A package that finds requirements at run time (a schema that
declares vector columns, say) implements the interface and registers it with `TryAddEnumerable`; its
requirements are judged exactly as declared ones are.

A source may scope its requirements to one database: `ScopedCapabilityRequirementSource` applies another
source's requirements to one scope only, and the verdict judges a scoped requirement only on that scope's status
(Unknown, with the reason, where no provider probes it). The EF Core driver does this for every context, so a
context's schema requires pgvector or pg_trgm on the database it uses, never on another database the host also
probes.

## See also

- [Postgres extensions](postgres-extensions.md), the first provider
- [Storage maintenance: table rewrite strategy](storage-maintenance.md#table-rewrite-strategy), the first setting that requires a capability
- [Startup pipeline](../startup/startup-pipeline.md)
- [Metrics reference: Whizbang.Capabilities](../observability/metrics.md#capabilities)
- [Configuration reference](../configuration/configuration-reference.md#capabilities-options)
