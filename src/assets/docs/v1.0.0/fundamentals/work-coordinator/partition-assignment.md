---
title: Partition assignment
pageType: concept
order: 5
version: 1.0.0
description: >-
  The elected partition assigner: one instance decides which instances are live and publishes the
  partition assignment every claimer uses, fenced by the role epoch, leased by the assigner's own
  liveness, and cached by claimers at no cost per claim.
tags: 'work-coordinator, partition-assignment, claim-work, role-election, liveness, fencing'
codeReferences:
  - src/Whizbang.Core/Workers/PartitionAssignment.cs
  - src/Whizbang.Core/Workers/PartitionAssigner.cs
  - src/Whizbang.Core/Workers/PartitionAssignerWorker.cs
  - src/Whizbang.Core/Workers/PartitionAssignmentCache.cs
  - src/Whizbang.Core/Workers/IInstanceConnectionModeSource.cs
  - src/Whizbang.Data.Postgres/Notifications/PgPartitionAssignmentStore.cs
  - src/Whizbang.Data.Postgres/Migrations/203_PartitionAssigner.sql
testReferences:
  - tests/Whizbang.Partitioning.Tests/PartitionAssignerTests.cs
  - tests/Whizbang.Partitioning.Tests/PartitionAssignmentCacheTests.cs
  - tests/Whizbang.Core.Component.Tests/PartitionAssignerWorkerLoopTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionAssignmentSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionAssignerWorkerPostgresTests.cs
---

# Partition assignment

Unowned work is spread across instances by partition: an instance of rank `r` among `n` takes the
partitions where `partition_number % n = r`. Something has to decide `r` and `n`. Without an
assigner, every claim ranks the instances it believes are alive (a fresh heartbeat row). When that
belief is wrong, the shares overlap. Two situations make it wrong for everyone at once:

- a database pause lets every heartbeat go stale together;
- a connection pooler hides the application names that would otherwise show an instance as live.

Each instance then ranks itself alone and claims every partition. Overlap never causes double
processing (stream leases and row locks give each stream one owner), but it wastes acquisitions and
it is the condition under which concurrent claims contend for the same stream-ledger rows.

The **partition assigner** removes the guess. One instance, elected through the role election,
decides liveness once for everyone and publishes the assignment. Claimers read it.

## The assignment

| Field | Meaning |
|---|---|
| `Members` | The live instances, in rank order. Partition `p` belongs to `Members[p % Members.Count]`. |
| `Epoch` | The role election's epoch for the assigner's tenure. |
| `Revision` | The publish count within that tenure, from 1. |
| `AssignerInstanceId` | The instance that published it. |
| `LeaseExpiresAt` | When it stops being valid unless the assigner renews it. |

`(Epoch, Revision)` is the assignment's version. Operators can read the current assignment, its epoch
and its assigner with `SELECT * FROM wh_read_partition_assignment();`. In code, use
`IPartitionAssignmentSource.Current`, or `PartitionAssignerWorker.IsAssigner`, `Epoch` and
`LastPublished` on the instance that holds the role.

## How it behaves

**Election.** Every instance runs `PartitionAssignerWorker` and votes for the `partition-assigner`
role. The holder leads; the others vote again each renewal interval.

**Liveness, by connection mode.** Each instance records at registration how it reaches the database:

- `direct`: a dedicated direct connection that holds the instance's session alive-lock. The lock is
  authoritative: held, the instance is live. Without the lock, the heartbeat decides, over
  `DirectHeartbeatWindow` (default 180 s, three of the slow beats a lock holder makes).
- `pooled`: pooled connections only, so no lock or application name can be seen. The heartbeat
  decides, over `PooledHeartbeatWindow` (default 90 s).

**Publishing.** Each tick of its tenure (one per role renewal interval) the assigner judges the
registered instances and publishes when the live set changes: an alive-lock gained or lost, a
heartbeat gone stale or fresh. It also publishes when its tenure has not published yet, and on a
slow backstop (`RepublishInterval`, default 5 minutes).

**Fencing.** The role epoch is checked in two places:

- where the assignment is written: a deposed assigner's publish is refused;
- where `claim_work` reads it: a claim accepts the version it presents only while that version is
  still the published one and its lease has not run out.

**Expiry is the assigner's liveness.** The assignment carries a lease (`AssignmentLease`, default
90 s). The assigner renews it as part of its own liveness: on its alive-lock tick while it holds the
lock, and with every heartbeat. So "the assignment expired" and "the assigner has not been seen" are
one timeout, not two.

**Missing or stale assignment.** A claimer keeps using its last assignment until it expires, then
ranks itself as before. A claim never stops for want of an assignment.

## Cost

Claimers cache the assignment in memory (`PartitionAssignmentCache`). The assigner announces each
publish with `NOTIFY wh_partition_assignment` (payload `epoch:revision`). A claimer that hears it, or
whose claim reports its copy stale, refreshes with one keyed read of a one-row table. A claim
presents only the version. Its fence is one read of a one-row table, and it replaces the claim's ranking
query instead of adding to it, so a claim with the assignment costs no more than one without.

## Configuration

`PartitionAssignerOptions`:

| Option | Default | Meaning |
|---|---|---|
| `Enabled` | `true` | Elect an assigner and use its assignment. Takes effect where role assignment is enabled. |
| `PooledHeartbeatWindow` | 90 s | How long a pooled instance's heartbeat counts it as live. |
| `DirectHeartbeatWindow` | 180 s | How long a direct instance's heartbeat counts it as live while its lock is not held. |
| `AssignmentLease` | 90 s | How long an assignment holds without renewal. Must exceed 60 s, the slow heartbeat cadence. |
| `RepublishInterval` | 5 min | The backstop: republish at least this often. |

```csharp{title="Tune the partition assigner" description="Shorten the backstop republish interval" category="Configuration" difficulty="INTERMEDIATE" tags=["Work coordinator", "Partition assignment", "Options"] tests=["PartitionAssignerTests.Validate_TheDefaults_PassAsync"]}
services.Configure<PartitionAssignerOptions>(options => {
  options.RepublishInterval = TimeSpan.FromMinutes(2);
});
```

## Signals

Every transition has a public event, for diagnostics and for tests that wait on the transition itself:

- `PartitionAssignerWorker`: `OnBecameAssigner`, `OnStoppedAssigning`, `OnEvaluated`, `OnPublished`.
- `PartitionAssignmentCache`: `OnPublishAnnounced`, `OnRefreshed`, `OnAssignmentChanged`.

## Related

- [Claim loop](claim-loop.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Commit sequence](commit-sequence.md): the commit-order stamper is elected the same way.
