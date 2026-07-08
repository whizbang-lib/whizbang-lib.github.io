---
title: Testing a new engine
order: 6
---

# Testing a new engine

A conformant engine implementation passes the standard test suite. Here's what you need to write — and what you can reuse.

## Test projects

Pattern matches `Whizbang.Data.<Engine>` and `Whizbang.Data.<ORM>.<Engine>`:

```
tests/Whizbang.Data.<Engine>.Tests/                  Engine-level tests (SQL functions)
tests/Whizbang.Data.<ORM>.<Engine>.Tests/            ORM-level integration tests
```

For Postgres + EFCore, see `tests/Whizbang.Data.EFCore.Postgres.Tests/` for the shipping reference (~31 SQL function tests + ~16 IWorkCoordinator method tests + ~280 broader integration tests).

## Per-SQL-function tests

Each new SQL function gets a dedicated `*SqlTests.cs` file. Pattern:

```csharp
public class ClaimWorkSqlTests : EFCoreTestBase {

  [Test]
  public async Task ClaimWork_FunctionExists_InPublicSchemaAsync() { /* pg_proc EXISTS check */ }

  [Test]
  public async Task ClaimWork_HasExpectedSignatureAsync() { /* pg_get_function_arguments check */ }

  [Test]
  public async Task ClaimWork_EmptyQueues_DoesNotInvokeOrphanClaimSubfunctionsAsync() {
    // Reset pg_stat_user_functions, call claim_work on empty DB, verify sub-functions never ran
  }

  [Test]
  public async Task ClaimWork_OutboxHasUnprocessedWork_ReturnsThatWorkAsync() { /* happy path */ }

  [Test]
  public async Task ClaimWork_RespectsMaxStreamsCapAsync() { /* insert N+M rows, claim with cap=N, expect ≤N returned */ }

  [Test]
  public async Task ClaimWork_LocksClaimedRowsToCallerAsync() { /* verify instance_id + lease_expiry set after claim */ }

  [Test]
  public async Task ClaimWork_FullBatch_RaisesHasMoreNoticeAsync() { /* subscribe to NpgsqlConnection.Notice, verify */ }
}
```

Cover at minimum:

- **Function existence + signature** (cheap; catches schema-drift regressions).
- **Empty-call short-circuit** (load-bearing performance contract).
- **Happy path** (insert, call, verify side effects).
- **Cap behavior** (verify limits respected).
- **Locking semantics** (concurrent callers don't double-claim).
- **NOTIFY emission** (when applicable).

## Per-IWorkCoordinator-method tests

`tests/Whizbang.Data.<ORM>.<Engine>.Tests/EFCore<Method>Tests.cs` — verify the C# wrapper invokes the SQL function correctly with proper parameter binding:

```csharp
public class EFCoreRecordHeartbeatTests : EFCoreTestBase {

  [Test]
  public async Task RecordHeartbeatAsync_NewInstance_InsertsRowAsync() { /* call, verify row present */ }

  [Test]
  public async Task RecordHeartbeatAsync_ExistingInstance_AdvancesLastHeartbeatAtAsync() { /* call twice, verify advance */ }

  [Test]
  public async Task RecordHeartbeatAsync_NullRequest_ThrowsAsync() { /* validation */ }
}
```

## Test fixture (postgres reference)

`EFCoreTestBase.cs` in the Postgres reference provides:

- Shared testcontainer (`SharedPostgresContainer`) that starts once and is reused.
- Per-test database isolation via `CREATE DATABASE test_<guid>` + cleanup.
- Pre-configured `NpgsqlDataSource` with JSON serializer + pgvector mappings.
- `EnsureWhizbangDatabaseInitializedAsync()` runs all migrations.
- Helper methods like `CreateTestEnvelope` and `CreateTestOutboxMessage`.

Adapt for your engine — the principle is "fresh schema per test, container reused across tests."

## Conformance suite (future)

The plan calls for an engine-agnostic conformance suite — a shared test project that any engine can run by providing a fixture. Today, Postgres is the only engine and tests live alongside it. When SQL Server or MySQL backends start, refactor the Postgres tests to depend on a shared `IWorkCoordinatorContractTests` base.

## Performance benchmarks

`tests/Whizbang.Benchmarks.Postgres/` (when added) hosts BenchmarkDotNet benchmarks:

- `IdleClaimCallCost` — `claim_work` on empty queues. Target: ≤ 1 ms.
- `IdleStackCpu` — postgres CPU on idle 11-DB stack. Target: ≤ 2%.
- `BurstThroughputInbox` — handlers/sec sustained. Target: ≥ 2000/s.
- `WalPressureUnderLoad` — WAL bytes/sec written.
- `ConnectionFootprint` — total connections per pod.

For new engines, run the same benchmarks; results contextualize the engine's performance characteristics.

## Test execution

```bash
# Unit + integration, AI-formatted output
pwsh scripts/Run-Tests.ps1 -Mode Ai

# Just one engine's test project
pwsh scripts/Run-Tests.ps1 -Mode AiIntegrations -ProjectFilter "EFCore.Postgres"

# Single test class via direct dotnet run
cd tests/<TestProject>
dotnet run --no-build -- --treenode-filter "/*/*/<TestClass>/*"
```

**Gotcha:** `Run-Tests.ps1 -Mode AiUnit` SKIPS the postgres testcontainer setup. SQL function tests fail in setup with "infrastructure errors" and no parsed results. Use `-Mode Ai` or `-Mode AiIntegrations` for tests that touch the DB. For real failure detail, bypass the wrapper script.

## Regression check after engine changes

After modifying engine code, run the full suite to confirm no regressions:

```bash
pwsh scripts/Run-Tests.ps1 -Mode Ai
```

Look for **new** failures (compare against a baseline run on `develop`). Pre-existing flakes don't count — verify by stashing your changes (`git stash --include-untracked`) and re-running the failing test alone.

## Related

- [Overview](overview.md)
- [SQL function contracts](sql-function-contracts.md)
- [Implementing IWorkCoordinator](implementing-iworkcoordinator.md)
