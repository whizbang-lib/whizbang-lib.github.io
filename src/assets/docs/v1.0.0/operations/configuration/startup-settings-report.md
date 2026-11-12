---
title: Startup Settings Report
pageType: reference
version: 1.0.0
category: Configuration
order: 3
description: >-
  Once a service is running, Whizbang logs every setting it reads with the
  value it runs with and where that came from: configured (and by which
  provider), default, or derived from inputs such as memory or pool size
tags: >-
  configuration, startup, logging, diagnostics, derived settings, redaction
codeReferences:
  - src/Whizbang.Core/Configuration/StartupSettingsReport.cs
  - src/Whizbang.Core/Configuration/StartupSettingsReportService.cs
  - src/Whizbang.Core/Configuration/DerivedSetting.cs
  - src/Whizbang.Core/Configuration/KnownConfigurationKeys.cs
  - src/Whizbang.Core/Configuration/ConfigurationKeyDefaults.cs
testReferences:
  - tests/Whizbang.Core.Tests/Configuration/StartupSettingsReportTests.cs
  - tests/Whizbang.Core.Component.Tests/Configuration/StartupSettingsReportServiceTests.cs
  - tests/Whizbang.Core.Tests/Configuration/DerivedSettingTests.cs
---

# Startup Settings Report

When a pod misbehaves, the first question is what limits it was running with. Several Whizbang limits depend on things that differ from pod to pod (memory, processor count, connection pool size), so the answer is not in the configuration files. Once a service reaches the Running stage, Whizbang writes the answer to its log: every setting it reads, the value it runs with, and where that value came from.

## What it writes

One Information entry per settings section, each listing that section's settings:

```text
Settings Whizbang:BatchBuffer: MaxBufferedBytes=53687091 (derived: 0.05 x TotalAvailableMemoryBytes; TotalAvailableMemoryBytes=1073741824); MaxBufferedBytesFraction=0.05 (default); MaxBufferedMessages=10000 (default); TransactionCeilingMultiplier=2 (default); InteractiveReserveFraction=0.1 (derived: WorkCoordinatorGate InteractiveReserve / MaxConcurrent; InteractiveReserve=5, MaxConcurrent=50)
Settings Whizbang:Startup: AllowLossyRollback (default); LogSettings=true (default); OverrideIncompatibility (default); RegistrationCollisions=Fail (configured: EnvironmentVariablesConfigurationProvider Prefix: '')
```

Each setting is one of:

| Source | Written as | Meaning |
|--------|-----------|---------|
| Configured | `Name=value (configured: <provider>)` | A configuration provider set it; the provider named is the last one that has the key, the one whose value wins. |
| Default | `Name=value (default)` | Nothing set it; the code default applies, and its value is shown. A key whose default is not a single value the options type holds (a value the binder fills in by hand, a name the consumer chooses) is written `Name (default)`. |
| Derived | `Name=value (derived: <rule>; <input>=<value>, ...)` | Computed from inputs that vary from host to host; the inputs are listed. A derived value wins over a configured one, because it is the value the service runs with. |

A key with a `*` segment (a name the consumer chooses, such as a circuit breaker or a provider) is listed once for each configured name, or once as written when none is configured.

The defaults are recorded, not hand-written: the configuration key manifest test resolves each options type over a
configuration that holds nothing, reads the value at every manifest key it read, and writes `configuration-defaults.txt` (read by `ConfigurationKeyDefaults`), which is
embedded in the library. The test fails when a default in code and the recorded default drift apart, so the report
never shows a stale default, and nothing reflects over options types at run time. A credential's default is redacted
like a configured credential.

## Complete by construction

The report walks the configuration key manifest, the same list the key manifest test records from the binders and the documentation build checks every documented key against. A key a binder reads is a key the report shows, and a test fails when a key in the manifest is missing from it.

## Credentials are redacted by type

A setting bound to a [`SensitiveString`](sensitive-settings.md), and every connection string, is written as the type's redaction: host and database, never the credential. The list of keys bound to a `SensitiveString` is recorded from the options types by the configuration key manifest test, so the report redacts by the setting's type rather than by guessing from its name. As a second line of defense, a key whose name ends in a credential word (`ConnectionString`, `Password`, `Secret`, `Token`, `Key`, `Credential`) is redacted too. A test configures every credential the library reads with a secret in each common shape and fails if any reaches the log.

## Derived settings

A value computed from something that varies is built as a `DerivedSetting<T>`, which keeps the inputs it came from, and is supplied to the report by an `IDerivedSettingSource` registered in the container. The code uses the same object's `Value`, so the value the report shows is the value the service runs with.

The values reported as derived today:

| Setting | Derived from |
|---------|--------------|
| `Whizbang:BatchBuffer:MaxBufferedBytes` | a share of the process memory limit (when no number is set) |
| `Whizbang:BatchBuffer:InteractiveReserveFraction` | the work coordinator gate's reserve over its permits |
| `Whizbang:WorkCoordinatorGate:InteractiveReserve` | the gate's permits (one tenth, or the configured value), leaving one shared |
| `Whizbang:WorkCoordinatorGate:MaxConcurrent` | the connection pool size less a reserve, for a gate built with `FromPoolSize` |
| `Whizbang:Workers:ThreadPoolFloor` | the processor count (or the configured floor), never below the current minimum |
| `Whizbang:Workers:Perspective:MaxConcurrentPerspectives` | the configured width, at most half the gate split across the drain consumers |
| `Whizbang:Workers:InboxDispatch:MaxConcurrentDispatch` | the configured fan-out, at most the gate's permits |

```csharp{title="A derived setting carries its inputs" description="FractionOf records the share and the input it was taken of; Describe writes the rule and the inputs." category="Configuration" difficulty="INTERMEDIATE" tags=["configuration", "derived settings"] tests=["DerivedSettingTests.FractionOf_MultipliesTheInput_AndRecordsItAsync", "DerivedSettingTests.Clamp_KeepsTheValueInRange_AndSaysWhenItClampedAsync"]}
var limit = DerivedSetting.FractionOf(
  "Whizbang:BatchBuffer:MaxBufferedBytes", 0.05,
  "TotalAvailableMemoryBytes", GC.GetGCMemoryInfo().TotalAvailableMemoryBytes);

var width = DerivedSetting.Clamp("Whizbang:Workers:Width", requested: 80, min: 1, max: 50,
  SettingInput.Of("GateMaxConcurrent", 50));   // 50, rule "80 clamped to [1, 50]"
```

## Turning it off

`Whizbang:Startup:LogSettings` (default `true`) controls the report. Set to `false`, the service writes only one line, so the log still says that the report is off:

```text
The startup settings report is off (Whizbang:Startup:LogSettings = false)
```

## When it is written

The report is registered by `AddWhizbang` with the startup stage table at the Running stage, so it is written once the service is fully up, after every setting that is resolved during startup has been resolved. A host without the worker pipeline writes it when its schema-ready gate opens.

## Related

- [Sensitive settings](sensitive-settings.md)
- [Configuration reference](configuration-reference.md)
- [Startup stages](../startup/startup-status.md#startup-stages)
