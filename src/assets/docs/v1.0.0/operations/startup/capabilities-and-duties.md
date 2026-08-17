---
title: Capabilities and Duties
pageType: concept
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 2
description: >-
  The capability model behind fleet-exclusive startup work — duties won by
  election, holdings recorded but never consulted to decide, takeover with no
  coordinator, and the eviction fence
tags: >-
  capabilities, duties, election, advisory-lock, migrator, maintainer,
  takeover, fencing, multi-instance
codeReferences:
  - src/Whizbang.Core/Startup/IDutyElector.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDutyElector.cs
  - src/Whizbang.Data.Postgres/DutyLockKey.cs
  - src/Whizbang.Data.Postgres/Migrations/108_InstanceCapabilities.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DutyElectionE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableRewriteJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceCapabilitiesSqlTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupPipelineRunnerDutyTests.cs
---

# Capabilities and Duties

"Exactly one instance does this" appears throughout a multi-instance deployment — one instance migrates the schema, one runs the table rewrites. A **capability** names that idea: something an instance **holds**, acquired by winning it. Nothing declares in advance which instances may hold what — every instance attempts everything, and holding is a named, recorded fact rather than an implicit consequence of winning a lock.

Capabilities come in two kinds, and [step exclusivity](startup-pipeline#the-step-contract) falls out of the distinction rather than being a separate property:

- **Exclusive capabilities** — held by one instance at a time. An exclusive capability is a **duty**: `migrator`, `maintainer`. Election decides which instance holds it.
- **Shared capabilities** — held by every instance at once, like the default `every-instance` capability a step gets when it declares nothing.

A step requiring a duty runs on one instance; a step requiring a shared capability runs on all of them. A step therefore cannot declare a contradiction — there is no way to claim fleet-exclusivity while requiring a capability every instance holds.

## The lock decides, the row reports

Capability holdings are **recorded** in `wh_instance_capabilities`, but never **consulted to decide**:

> An instance acquires a capability by attempting the primitive, not by reading a table. If the record and the lock ever disagree, the lock is right and the record is stale.

Treating a stored assignment as authoritative is what reintroduces orphaned state — a dead instance's row goes on claiming a capability until something reaps it. Treating it as *derived* state costs nothing and buys the questions that matter during an incident: *which instance is the migrator right now, how long has it been, is a duty currently unheld* — answered as a query, not a broadcast to instances that may not be answering. The [status surface's fleet section](startup-status) reads exactly this record.

Holdings live in their own table keyed by *(instance, capability)* rather than as a column on the instance row: an instance holds several at once, the relationship carries its own `acquired_at`, and capability writes stay off the heartbeat's write-suppression path. Reaping stays free — stale instances are genuinely deleted and the foreign key cascades.

## Election is not membership

These are two different problems and they use two different mechanisms:

| Concern | Mechanism | Why |
|---|---|---|
| **Election** — who performs a duty | Database primitive: a session advisory lock on a process-stable key | Linearizable against the authority every instance already depends on. Self-healing, no timeout to tune, no split-brain window |
| **Membership** — who is alive, what they hold | Heartbeat plus the instance-alive session lock ([instance liveness](../../fundamentals/workers/instance-liveness)) | Drives re-attempt prompts, observability, and the reaping backstop |

Liveness never decides an election. A holder that is alive but briefly slow would otherwise get declared dead by peers watching a timeout, a replacement elected, and two instances believing they hold the duty — for `migrator`, two instances running DDL at once. Heartbeats and `InstanceDiedSignal` only *prompt re-attempts*; the lock grants or refuses.

## Winning a duty

```csharp{title="The elector seam" description="Attempt acquisition — the primitive grants or refuses" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Duties"] tests=["DutyElectionE2ETests.Contention_ExactlyOneWins_AndTheRowReportsTheLockHolderAsync","DutyElectionE2ETests.DirtyDeath_TheGrantKnowsItIsLost_AndAnotherInstanceAcquiresAsync"]}
public interface IDutyElector {
  // Returns the grant when this instance now holds the duty, or null when another
  // instance does — or when this instance has been evicted. Never blocks on the holder.
  Task<IDutyGrant?> TryAcquireAsync(string duty, CancellationToken ct);
}

public interface IDutyGrant : IAsyncDisposable {
  string Duty { get; }
  DateTimeOffset AcquiredAt { get; }

  // Fencing: round-trips the session that holds the primitive. A long-tenure holder calls
  // this before each unit of exclusive work — a grant whose session died is a grant another
  // instance may already hold.
  Task<bool> VerifyStillHeldAsync(CancellationToken ct);
}
```

The Postgres implementation takes a session advisory lock on a process-stable key derived from the schema and duty name — process-stable because a per-process hash seed would give every instance its own private lock and exclude nothing. Winning records the holding; losing returns `null` and the [pipeline](startup-pipeline) applies the step's declared `NonHolderBehavior`.

The **eviction fence reaches election**: an instance that has been [evicted](../../fundamentals/workers/instance-liveness#eviction-reaping-is-a-fence-not-just-a-deletion) is refused at acquisition even when it wins the primitive, and the implementation releases what it won. That is what turns eviction from a request into a guarantee for exclusive work.

## Takeover

An instance never looks up whether it has been *assigned* a capability — it attempts acquisition. Takeover therefore needs no coordinator:

1. The holder holds its session lock; its record names the capability.
2. The holder dies. On clean session termination PostgreSQL releases the lock **immediately**, server-side.
3. The record is briefly stale, still claiming the capability.
4. Another instance attempts — because it was already blocked on the lock, on its next poll, or prompted by `InstanceDiedSignal`.
5. It acquires the lock and **is the holder from that instant**, whatever any row still says.
6. Its record is written; the dead instance's rows are reaped at lease expiry and cascade away.

The record is inconsistent only between steps 2 and 6 — the same heartbeat-lease window the system already reaps. A half-open session whose lock lingers (a pod killed for memory) is bounded by the stale-instance cleanup's definitive-dead cutoff, which is why heartbeat liveness is a **correctness backstop** here rather than a latency optimization: the lock handles every clean failure; the cutoff bounds the pathological one.

For `Migrate` the failover is the fastest in the system and needs no detection machinery at all: waiters are already blocked on the advisory lock, and the server frees it the moment the holder's session ends. The duties that rely on signal-plus-poll re-attempt — `maintainer` among them — are precisely the ones for which tens of seconds is immaterial.

## Related

- [The Startup Pipeline](startup-pipeline) — where duties decide who runs an exclusive step
- [Rolling Upgrades](rolling-upgrades) — standby, eviction, and the verdict that releases capabilities
- [Instance Liveness](../../fundamentals/workers/instance-liveness) — the heartbeat, the alive lock, and the eviction tombstone
- [The Startup Status Surface](startup-status) — holdings as a fleet-level query
