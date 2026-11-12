---
title: Sensitive Settings
pageType: reference
version: 1.0.0
category: Configuration
order: 4
description: >-
  Settings that hold credentials are SensitiveString values: they redact
  themselves in ToString, logs, string formatting and JSON, bind from
  configuration under native AOT, and are read only through Reveal
tags: >-
  configuration, security, secrets, connection strings, redaction, logging,
  aot
codeReferences:
  - src/Whizbang.Core/Configuration/SensitiveString.cs
  - src/Whizbang.Core/Configuration/ConfigurationValueBinder.cs
  - tools/Whizbang.RepoAnalyzers/PlainStringCredentialSettingAnalyzer.cs
testReferences:
  - tests/Whizbang.Core.Tests/Configuration/SensitiveStringTests.cs
  - tests/Whizbang.Core.Tests/Configuration/ConfigurationValueBinderTests.cs
  - tests/Whizbang.Documentation.Component.Tests/ConfigurationKeyManifestTests.cs
---

# Sensitive Settings

Every Whizbang setting that holds a credential (a connection string, an account key, a password) is a `SensitiveString`. The type writes a redaction wherever it is written out, so a credential cannot leak by being logged, formatted, serialized or shown in the [startup settings report](startup-settings-report.md). The value itself is reached through one explicit call, `Reveal()`.

## What it writes

The redaction keeps what identifies the target and nothing that authenticates to it:

| Value | Written as |
|-------|-----------|
| A `key=value` connection string | its host and database keys (`Host`, `Server`, `Data Source`, `Endpoint`, `Port`, `Database`, `Initial Catalog`, `AccountName`), then `[redacted]` when anything was dropped |
| A URI | scheme, host, port and path, then `[redacted]`; the user information and query are dropped |
| Anything else | `[redacted]` |

```csharp{title="A credential writes its redaction" description="ToString, interpolation, logging and JSON all write the redaction; Reveal returns the value." category="Configuration" difficulty="BEGINNER" tags=["configuration", "security", "redaction"] tests=["SensitiveStringTests.ToString_OfAConnectionString_KeepsHostAndDatabase_AndDropsTheCredentialsAsync", "SensitiveStringTests.Reveal_ReturnsTheValueAsConfiguredAsync"]}
SensitiveString connection = "Host=db.internal;Port=5432;Database=orders;Username=app;Password=hunter2";

Console.WriteLine(connection);         // Host=db.internal;Port=5432;Database=orders;[redacted]
var raw = connection.Reveal();         // the full string, for the client that connects
```

Logging writes the redaction through the type's `ToString` and `IFormattable` implementations, and JSON serialization writes it through the type's converter, which source-generated serializer contexts pick up with no registration. Reading JSON accepts a string.

## The settings that use it

| Setting | Key |
|---------|-----|
| `AzureBlobArchiveOptions.ConnectionString` | `Whizbang:Archive:AzureBlob:ConnectionString` |
| `AzureBlobOffloadOptions.ConnectionString` | `Whizbang:Offloads:AzureBlob:<provider>:ConnectionString` |
| `WhizbangNotificationOptions.DirectConnectionString` | `Whizbang:Database:DirectConnectionString` |
| `WhizbangPinnedPoolOptions.ConnectionString` | `Whizbang:Workers:PinnedPool:ConnectionString` |

Code that sets one assigns a string as before: the conversion from `string` is implicit, and a null string stays null. Code that reads one calls `Reveal()`.

**Upgrade:** code that read one of these properties as a `string` calls `.Reveal()` on it now.

## Binding

The configuration binder source generator does not bind `SensitiveString`, and skips such a property without a warning. Whizbang binds each one itself with `ConfigurationValueBinder.BindSensitive`, which reads the key, skips a blank value and wraps the rest. No reflection is involved, so the binding works under native AOT. The configuration key manifest test fails when an options type declares a `SensitiveString` property that its registration leaves unbound, and records every key bound to one in `sensitive-configuration-keys.txt`, which the startup settings report reads to redact by type.

## Enforcement

[WHIZ606](../diagnostics/whiz606.md) fails the Whizbang build when a settings property whose name says it holds a credential is a plain `string`.

## Related

- [Startup settings report](startup-settings-report.md)
- [Configuration reference](configuration-reference.md)
