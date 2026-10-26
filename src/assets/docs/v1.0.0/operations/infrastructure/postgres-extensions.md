---
title: Postgres Extensions
pageType: reference
verifiedAgainstCommit: ddb69a39
verifiedDate: 2026-10-19
version: 1.0.0
category: Infrastructure
order: 11
description: >-
  The Postgres extensions capability provider: which extensions Whizbang can
  use, how it probes each database at startup, each Postgres state and the
  generic capability state it maps onto, and what to do about each
tags: >-
  postgres, extensions, pgvector, pg_trgm, pg_squeeze, pg_repack, pg_partman,
  pg_stat_statements, allowlist, shared_preload_libraries, capabilities
codeReferences:
  - src/Whizbang.Data.Postgres/PostgresExtensionCatalog.cs
  - src/Whizbang.Data.Postgres/PostgresExtensionState.cs
  - src/Whizbang.Data.Postgres/PostgresCapabilityProbe.cs
  - src/Whizbang.Data.Postgres/PostgresCapabilityProvider.cs
testReferences:
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresExtensionCatalogTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresCapabilityProbeTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresCapabilityProviderTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresCapabilityProbeIntegrationTests.cs
---

# Postgres Extensions

Some Whizbang features are built on a Postgres extension: vector fields need `vector`, substring
indexes need `pg_trgm`, statement diagnostics read `pg_stat_statements`. Whether an extension can be
used depends on the server, and on a managed server the answer is often "installed, but not allowed".
Whizbang answers the question once per database at startup and tells you, in one log block, which
extensions it can use and what each one gives you.

Postgres extensions are the first provider of the library's [capability](capabilities.md) pattern:
each extension is the capability `postgres/<name>`, the scope is the database, and the states, the
startup verdict, the gauge and the configuration are the ones every provider shares. Both Postgres
drivers (EF Core and Dapper) register the provider with no setup. Nothing here creates an extension or
changes the schema: the probe is a read of the server's catalogs.

## Catalog {#catalog}
{verified: PostgresExtensionCatalogTests.BuiltIn_NamesExactlyTheEightKnownExtensionsAsync, PostgresExtensionCatalogTests.LibraryMayCreate_MatchesTheDesignAsync, PostgresExtensionCatalogTests.NeedsPreload_FollowsThePrerequisitesAsync}

The extensions Whizbang knows about, what each enables, whether Whizbang may run `CREATE EXTENSION`
for it, and what the server needs beyond the extension's files. Every entry also needs a managed
server's allowlist to name it, when the server has one.

The split of work is the same for every extension the library may create: the operator enables it at
the server level (the allowlist, and `shared_preload_libraries` where it needs preloading), and the
library creates, updates and manages it from there. This release detects and reports; creating,
updating and managing the extensions arrive in later releases.

| Extension | Enables | Whizbang may create it | Extra prerequisites |
|---|---|---|---|
| `vector` | vector fields and their similarity indexes | yes | none |
| `pg_trgm` | substring (trigram) indexes | yes | none |
| `pg_squeeze` | online table rewrite without a long exclusive lock, driven by the library's table rewriter | yes | `shared_preload_libraries`, `wal_level = logical` |
| `pg_repack` | online table rewrite through the `pg_repack` client, run in process or as an external job | yes | the `pg_repack` client program |
| `pg_partman` | ledger partition management: `create_parent`, then `run_maintenance` from the library's maintenance worker (a built-in fallback exists) | yes | none (its background worker is optional) |
| `pgstattuple` | exact table bloat measurement (otherwise estimated) | yes | none |
| `pg_stat_statements` | query statistics | yes | `shared_preload_libraries` |
| `pg_cron` | in-database scheduling | no (it lives in one database) | `shared_preload_libraries` |

## How the probe works {#probe}

At startup, after the schema is ready, the `Capabilities` step of the
[startup pipeline](../startup/startup-pipeline.md) asks the provider to probe each registered database,
with one query each. Extensions
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
provider, the database and the reason.

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
{verified: PostgresCapabilityProbeTests.Installed_WhenPresentInTheDatabaseAsync, PostgresCapabilityProbeTests.Unknown_WhenCreatableButThePreloadListCannotBeReadAsync, PostgresCapabilityProbeTests.Available_WhenCreatableAsync, PostgresCapabilityProbeTests.NotAllowlisted_WhenAnAllowlistExistsAndDoesNotNameItAsync, PostgresCapabilityProbeTests.NeedsPreload_WhenInstalledButItsLibraryIsNotPreloadedAsync, PostgresCapabilityProbeTests.NoPrivilege_WhenTheRoleLacksCreateOnTheDatabaseAsync, PostgresCapabilityProbeTests.Missing_WhenTheServerHasNoControlFilesAsync, PostgresCapabilityProviderTests.EachPostgresState_MapsOntoOneGenericStateAsync}

Each Postgres state maps onto one [generic capability state](capabilities.md#states); the Postgres
state stays in the status as its detail. `Installed` and `Available` are usable. Every other state names
the one thing in the way.

| Postgres state | Capability state | Meaning | What to do |
|---|---|---|---|
| `Installed` | `Ready` | Present in the database, and preloaded when it must be. | Nothing. |
| `Available` | `Provisionable` | Creatable here: files present, allowlisted (or no allowlist exists), preloaded if needed, and this role may create it. | Nothing. When a feature in force requires it, Whizbang [creates it](capabilities.md#provisioning-postgres) before the verdict, for the extensions it may create, unless `AutoProvision` is off. |
| `NotAllowlisted` | `NotPermitted` | The server has the files, but its allowlist exists and does not name it. | Add the extension's name to the server's allowlist (for example `azure.extensions` on Azure Database for PostgreSQL). If it also needs preloading, add it to `shared_preload_libraries` and restart the server. |
| `NeedsPreload` | `NeedsServerChange` | Installed or creatable, but its library is not in `shared_preload_libraries`. | Add it to `shared_preload_libraries` and restart the server. |
| `NoPrivilege` | `NoPrivilege` | Some role could create it, this one cannot: it is not a superuser and either lacks `CREATE` on the database, or the extension is not trusted and no managed-server allowlist grants it. | Run `CREATE EXTENSION <name>` once as a role that may (a superuser, or the server's administrator role), or grant this role `CREATE` on the database. |
| `Missing` | `Missing` | The server has no files for it. | Install the extension's package on the server, or use a server image that includes it. |
| `Unknown` | `Unknown` | The probe could not decide: the database was unreachable or refused the query, the probe is turned off or has not run yet, or the extension needs preloading and this role cannot read `shared_preload_libraries`. | Read the warning that names the database, and check that it is reachable and this role can connect. For an extension that needs preloading, grant this role `pg_read_all_settings`. |

### Managed servers and the allowlist {#allowlist}

Managed Postgres services usually ship many extensions' files but let you create only the ones an
allowlist names. The list is a server parameter, set through the provider's console, CLI or
infrastructure templates rather than with SQL, and on most services it is written in upper case
(`VECTOR,PG_TRGM`). Whizbang compares names without regard to case and ignores spaces, so the list
can be written either way. An allowlist that exists but is empty allows nothing.

Extensions that also need `shared_preload_libraries` (here `pg_squeeze`, `pg_stat_statements` and
`pg_cron`) need both changes, and the preload change takes effect only after the server restarts.
`pg_squeeze` additionally needs `wal_level = logical`, which is also a restart-time parameter.

## Startup verdict {#startup-report}
{verified: CapabilityReportTests.Log_WritesOneBlockPairPerProviderAndScopeAsync, PostgresCapabilityProbeIntegrationTests.TheDapperDriver_RegistersItsDatabaseAsAPostgresScopeAsync}

Each probed database writes the [capability verdict](capabilities.md#verdict): one Information block
listing exactly the usable extensions and what each enables, with the Postgres state as the detail:

```text
Capabilities of postgres on 'orders-db': 4 usable of 8
  postgres/vector (Ready, 0.8.0; Installed): vector fields and their similarity indexes
  postgres/pg_trgm (Provisionable; Available): substring (trigram) indexes
  postgres/pg_stat_statements (Provisionable; Available): query statistics
  postgres/pg_cron (Provisionable; Available): in-database scheduling
```

and the rest at **Debug**, each with the fix:

```text
Capabilities of postgres on 'orders-db' that are not usable
  postgres/pg_squeeze (NotPermitted; NotAllowlisted): online table rewrite without a long exclusive lock. Fix: add PG_SQUEEZE to ...
```

Code reads the same answer through `ICapabilityRegistry`, and dashboards through the
`whizbang.capability.state` gauge on the [`Whizbang.Capabilities` meter](../observability/metrics.md#capabilities):

```csharp{title="Ask whether an extension is usable on a database" description="The capability registry answers one state per extension and database; Unknown before the probe runs or when the database could not be read." framework="NET10" category="Configuration" difficulty="INTERMEDIATE" tags=["postgres", "extensions", "capabilities", "startup"] tests=["PostgresCapabilityProbeIntegrationTests.TheDapperDriver_RegistersItsDatabaseAsAPostgresScopeAsync", "CapabilityRegistryTests.GetState_ComparesProviderAndNameWithoutRegardToCaseAsync"]}
public sealed class SearchFeature(ICapabilityRegistry capabilities) {
  public bool CanUseSubstringIndexes(string database) =>
    capabilities.GetState(new CapabilityId(PostgresExtensionCatalog.PROVIDER, "pg_trgm"), database)
      is CapabilityState.Ready or CapabilityState.Provisionable;
}
```

The scope is the driver's name for the database: the connection-string name for the EF Core driver
(`db` unless you named the context's connection), and the database named in the connection string for
the Dapper driver.

## Configuration {#configuration}

The probe is turned off with the capability key every provider shares,
`Whizbang:Capabilities:ProbeOnStartup`; see [Capabilities: configuration](capabilities.md#configuration).

## See also

- [Capabilities](capabilities.md), the pattern this provider follows
- [Startup pipeline](../startup/startup-pipeline.md)
- [Metrics reference: Whizbang.Capabilities](../observability/metrics.md#capabilities)
- [Configuration reference](../configuration/configuration-reference.md)
