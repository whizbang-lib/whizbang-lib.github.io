---
title: Postgres Extensions
pageType: reference
verifiedAgainstCommit: 4af1150a
verifiedDate: 2026-10-19
version: 1.0.0
category: Infrastructure
order: 10
description: >-
  Which Postgres extensions Whizbang can use, how it probes each database for
  them at startup, what each state means and what to do about it, and the
  configuration key that turns the probe off
tags: >-
  postgres, extensions, pgvector, pg_trgm, pg_squeeze, pg_stat_statements,
  allowlist, shared_preload_libraries, startup, capabilities
codeReferences:
  - src/Whizbang.Data.Postgres/PostgresExtensionCatalog.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionState.cs
  - src/Whizbang.Data.Postgres/PostgresCapabilityProbe.cs
  - src/Whizbang.Data.Postgres/IPostgresCapabilities.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionReport.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionsStartupStep.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionsOptions.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionMetrics.cs
testReferences:
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresExtensionCatalogTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresCapabilityProbeTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresCapabilitiesTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresExtensionReportTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresExtensionsStartupStepTests.cs
  - >-
    tests/Whizbang.Core.Tests/PostgresExtensions/PostgresExtensionServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresCapabilityProbeIntegrationTests.cs
---

# Postgres Extensions

Some Whizbang features are built on a Postgres extension: vector fields need `vector`, substring
indexes need `pg_trgm`, statement diagnostics read `pg_stat_statements`. Whether an extension can be
used depends on the server, and on a managed server the answer is often "installed, but not allowed".
Whizbang answers the question once per database at startup and tells you, in one log block, which
extensions it can use and what each one gives you.

Both Postgres drivers (EF Core and Dapper) do this with no setup. Nothing here creates an extension
or changes the schema: the probe is a read of the server's catalogs.

## Catalog {#catalog}
{verified: PostgresExtensionCatalogTests.BuiltIn_NamesExactlyTheEightKnownExtensionsAsync, PostgresExtensionCatalogTests.LibraryMayCreate_MatchesTheDesignAsync, PostgresExtensionCatalogTests.NeedsPreload_FollowsThePrerequisitesAsync}

The extensions Whizbang knows about, what each enables, whether Whizbang may run `CREATE EXTENSION`
for it, and what the server needs beyond the extension's files. Every entry also needs a managed
server's allowlist to name it, when the server has one.

| Extension | Enables | Whizbang may create it | Extra prerequisites |
|---|---|---|---|
| `vector` | vector fields and their similarity indexes | yes | none |
| `pg_trgm` | substring (trigram) indexes | yes | none |
| `pg_squeeze` | online table rewrite without a long exclusive lock | yes | `shared_preload_libraries`, `wal_level = logical` |
| `pg_repack` | online table rewrite run by its own client program | no | the `pg_repack` client, run outside the process |
| `pg_partman` | partition management (a built-in fallback exists) | yes | none (its background worker is optional) |
| `pgstattuple` | exact table bloat measurement (otherwise estimated) | yes | none |
| `pg_stat_statements` | query statistics | yes | `shared_preload_libraries` |
| `pg_cron` | in-database scheduling | no (it lives in one database) | `shared_preload_libraries` |

## How the probe works {#probe}

At startup, after the schema is ready, the `PostgresExtensions` step of the
[startup pipeline](../startup/startup-pipeline.md) runs one query per registered database. Extensions
are per database, while the allowlist and the preload list are per server, so each database gets its
own answer. The query reads:

- `pg_extension`: what is installed in this database, and at which version;
- `pg_available_extensions`: whether the server has the extension's files;
- `pg_available_extension_versions`: whether the extension is marked trusted;
- `current_setting('azure.extensions', true)`: the managed-server allowlist, or NULL when the server
  has no such setting (no allowlist);
- `shared_preload_libraries` (from `pg_settings`): what the server loaded at start. A role without
  `pg_read_all_settings` cannot see it; then only the extensions that need preloading read `Unknown`,
  and the rest of the answer stands;
- the role's superuser flag and its `CREATE` privilege on the database.

The step does not block readiness, and it cannot stop the host. A database the probe cannot read
(unreachable, refused, timed out) reads **Unknown** for every extension, and one warning names the
database and the reason.

```mermaid{caption="How one extension's state is decided, in order." tests=["PostgresCapabilityProbeTests.Installed_WhenPresentInTheDatabaseAsync","PostgresCapabilityProbeTests.Missing_TakesPrecedenceOverTheAllowlistAsync","PostgresCapabilityProbeTests.NotAllowlisted_WhenAnAllowlistExistsAndDoesNotNameItAsync","PostgresCapabilityProbeTests.NeedsPreload_WhenAllowlistedButItsLibraryIsNotPreloadedAsync","PostgresCapabilityProbeTests.NoPrivilege_WhenTheRoleLacksCreateOnTheDatabaseAsync","PostgresCapabilityProbeTests.Available_WhenCreatableAsync","PostgresCapabilityProbeTests.Unknown_WhenInstalledButThePreloadListCannotBeReadAsync"]}
flowchart TD
  A[In pg_extension?] -->|yes| B{Preloaded, or needs no preload?}
  B -->|yes| Installed
  B -->|no| NeedsPreload
  B -->|list unreadable| Unknown
  A -->|no| C{Files on the server?}
  C -->|no| Missing
  C -->|yes| D{Allowlist exists and omits it?}
  D -->|yes| NotAllowlisted
  D -->|no| E{Preloaded, or needs no preload?}
  E -->|no| NeedsPreload
  E -->|list unreadable| Unknown
  E -->|yes| F{This role may create it?}
  F -->|no| NoPrivilege
  F -->|yes| Available
```

## States, and what to do about each {#states}
{verified: PostgresCapabilityProbeTests.Installed_WhenPresentInTheDatabaseAsync, PostgresCapabilityProbeTests.Unknown_WhenCreatableButThePreloadListCannotBeReadAsync, PostgresCapabilityProbeTests.Available_WhenCreatableAsync, PostgresCapabilityProbeTests.NotAllowlisted_WhenAnAllowlistExistsAndDoesNotNameItAsync, PostgresCapabilityProbeTests.NeedsPreload_WhenInstalledButItsLibraryIsNotPreloadedAsync, PostgresCapabilityProbeTests.NoPrivilege_WhenTheRoleLacksCreateOnTheDatabaseAsync, PostgresCapabilityProbeTests.Missing_WhenTheServerHasNoControlFilesAsync, PostgresCapabilityProbeTests.ProbeAsync_ConnectionFails_EveryExtensionIsUnknownAsync}

`Installed` and `Available` are usable. Every other state names the one thing in the way.

| State | Meaning | What to do |
|---|---|---|
| `Installed` | Present in the database, and preloaded when it must be. | Nothing. |
| `Available` | Creatable here: files present, allowlisted (or no allowlist exists), preloaded if needed, and this role may create it. | Nothing. Whizbang creates it when a feature needs it, for the extensions it may create. |
| `NotAllowlisted` | The server has the files, but its allowlist exists and does not name it. | Add the extension's name to the server's allowlist (for example `azure.extensions` on Azure Database for PostgreSQL). If it also needs preloading, add it to `shared_preload_libraries` and restart the server. |
| `NeedsPreload` | Installed or creatable, but its library is not in `shared_preload_libraries`. | Add it to `shared_preload_libraries` and restart the server. |
| `NoPrivilege` | Some role could create it, this one cannot: it is not a superuser and either lacks `CREATE` on the database, or the extension is not trusted and no managed-server allowlist grants it. | Run `CREATE EXTENSION <name>` once as a role that may (a superuser, or the server's administrator role), or grant this role `CREATE` on the database. |
| `Missing` | The server has no files for it. | Install the extension's package on the server, or use a server image that includes it. |
| `Unknown` | The probe could not decide: the database was unreachable or refused the query, the probe is turned off or has not run yet, or the extension needs preloading and this role cannot read `shared_preload_libraries`. | Read the warning that names the database, and check that it is reachable and this role can connect. For an extension that needs preloading, grant this role `pg_read_all_settings`. |

### Managed servers and the allowlist {#allowlist}

Managed Postgres services usually ship many extensions' files but let you create only the ones an
allowlist names. The list is a server parameter, set through the provider's console, CLI or
infrastructure templates rather than with SQL, and on most services it is written in upper case
(`VECTOR,PG_TRGM`). Whizbang compares names without regard to case and ignores spaces, so the list
can be written either way. An allowlist that exists but is empty allows nothing.

Extensions that also need `shared_preload_libraries` (here `pg_squeeze`, `pg_stat_statements` and
`pg_cron`) need both changes, and the preload change takes effect only after the server restarts.
`pg_squeeze` additionally needs `wal_level = logical`, which is also a restart-time parameter.

## Startup report {#startup-report}
{verified: PostgresExtensionReportTests.FormatUsable_ListsExactlyTheUsableExtensionsWithTheirPurposeAsync, PostgresExtensionReportTests.Log_WritesOneInformationBlockAndOneDebugBlockAsync, PostgresExtensionsStartupStepTests.ProbeOn_ProbesOnceAndReportsEachDatabaseAsync}

Each probed database writes one Information block listing exactly the usable extensions and what
each enables:

```text
Postgres extensions on database 'orders-db': 4 usable of 8 known
  vector 0.8.0 (Installed): vector fields and their similarity indexes
  pg_trgm (Available): substring (trigram) indexes
  pg_stat_statements (Available): query statistics
  pg_cron (Available): in-database scheduling
```

The extensions that are not usable are listed at **Debug**, with their state and the fix:

```text
Postgres extensions on database 'orders-db' that are not usable here
  pg_squeeze (NotAllowlisted): online table rewrite without a long exclusive lock. Fix: add PG_SQUEEZE to ...
```

The same answer is available to code through `IPostgresCapabilities`, a singleton both drivers
register, and to dashboards through the `whizbang.postgres.extension.state` gauge on the
[`Whizbang.Postgres` meter](../observability/metrics.md#postgres).

```csharp{title="Ask whether an extension is usable on a database" description="IPostgresCapabilities answers one state per extension and database; Unknown before the probe runs or when the database could not be read." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["postgres", "extensions", "capabilities", "startup"] tests=["PostgresCapabilitiesTests.GetState_UnknownDatabase_IsUnknownAsync", "PostgresCapabilityProbeIntegrationTests.TheDapperDriver_RegistersItsDatabaseForTheProbeAsync"]}
public sealed class SearchFeature(IPostgresCapabilities capabilities) {
  public bool CanUseSubstringIndexes(string database) =>
    capabilities.GetState(database, "pg_trgm") is PostgresExtensionState.Installed or PostgresExtensionState.Available;
}
```

The database name is the driver's name for it: the connection-string name for the EF Core driver
(`db` unless you named the context's connection), and the database named in the connection string
for the Dapper driver.

## Configuration {#configuration}
{verified: PostgresExtensionServiceCollectionExtensionsTests.ProbeOnStartup_DefaultsToTrueAsync, PostgresExtensionServiceCollectionExtensionsTests.ProbeOnStartup_BindsFromConfigurationAsync, PostgresExtensionsStartupStepTests.ProbeTurnedOff_IsSkippedWithoutProbingAsync}

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:PostgresExtensions:ProbeOnStartup` | `Whizbang__PostgresExtensions__ProbeOnStartup` | `true` | `false` skips the startup probe; every extension then reads `Unknown`. |

The section is `Whizbang:PostgresExtensions`, not `Whizbang:Postgres`, whose children are database
names. A key present in configuration overrides a value set in code; an absent key leaves it.

```json{title="Turn the startup probe off" description="Skips the extension probe at startup; every extension then reads Unknown." category="Configuration" difficulty="BEGINNER" tags=["postgres", "extensions", "configuration", "startup"] tests=["PostgresExtensionServiceCollectionExtensionsTests.ProbeOnStartup_BindsFromConfigurationAsync"]}
{
  "Whizbang": {
    "PostgresExtensions": {
      "ProbeOnStartup": false
    }
  }
}
```

## See also

- [Startup pipeline](../startup/startup-pipeline.md)
- [Metrics reference: Whizbang.Postgres](../observability/metrics.md#postgres)
- [Configuration reference](../configuration/configuration-reference.md)
