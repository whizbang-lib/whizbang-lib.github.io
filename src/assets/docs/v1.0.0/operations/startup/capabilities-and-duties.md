---
title: Capabilities and Duties
pageType: concept
verifiedAgainstCommit: 924d20f7
verifiedDate: 2026-10-22
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
  - src/Whizbang.Data.Postgres/Notifications/PgRoleElector.cs
  - src/Whizbang.Data.Postgres/MigratorWatch.cs
  - src/Whizbang.Data.Postgres/SchemaBootstrapPhase.cs
  - src/Whizbang.Data.Postgres/Migrations/184_RoleAssignmentResilience.sql
  - src/Whizbang.Data.Postgres/DutyLockKey.cs
  - src/Whizbang.Data.Postgres/Migrations/108_InstanceCapabilities.sql
  - src/Whizbang.Core/Startup/IDutyAcquisitionHandler.cs
  - src/Whizbang.Core/Startup/DutyHolderWorker.cs
  - src/Whizbang.Core/Workers/WorkTableVacuumOnAcquisition.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DutyElectionE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableRewriteJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceCapabilitiesSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupPipelineRunnerDutyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Chaos/RoleAssignmentChaosTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Chaos/MaintainerAcquisitionVacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkTableVacuumTests.cs
  - tests/Whizbang.Core.Tests/Workers/WorkTableVacuumOnAcquisitionTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/DutyHolderWorkerTests.cs
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
| **Election** — who performs a duty | Database primitive: by default a one-statement vote that assigns the duty as a row with an epoch and a lease ([role assignment](#role-assignment-the-default)); otherwise a session advisory lock on a process-stable key | Linearizable against the authority every instance already depends on, and decided entirely in the database |
| **Membership** — who is alive, what they hold | Heartbeat plus the instance-alive session lock ([instance liveness](../../fundamentals/workers/instance-liveness)) | Drives re-attempt prompts, observability, and the reaping backstop |

Liveness never decides an election. A holder that is alive but briefly slow would otherwise get declared dead by peers watching a timeout, a replacement elected, and two instances believing they hold the duty — for `migrator`, two instances running DDL at once. Heartbeats and `InstanceDiedSignal` only *prompt re-attempts*; the lock grants or refuses.

### The bootstrap registration records `Migrating` {#bootstrap-registration-records-migrating}
{verified: WorkEligibilitySqlTests.BootstrapRegistration_RecordsTheInstanceAsMigrating_SoItIsNotACandidateAsync}

An instance has to be registered before it can vote for a duty, so the schema bootstrap registers it during the migrator election, before its migration pass. That registration also records the instance's lifecycle phase as `Migrating`.

The phase matters because only an instance whose recorded phase is `AcceptingCommands` or `Running` is [eligible for work](../../fundamentals/workers/instance-liveness#alive-versus-eligible), while a row that records no phase reads as an older build, which is eligible whenever it is alive. In earlier releases the bootstrap row had no phase, so a starting instance looked like an older build and was handed a share of the partitions for its whole migration, a share nobody worked until it was ready. The lifecycle's own `Migrating` write runs before the row exists and finds nothing to update, which is why the registration writes the phase itself.

On an empty database the bootstrap registers before the migration that adds the phase-recording function exists, so it records no phase there. With no older instance in the fleet, there is no peer to hand a share to anyway.

## Winning a duty

```csharp{title="The elector seam" description="Attempt acquisition — the primitive grants, or refuses with a reason" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Duties"] tests=["DutyElectionE2ETests.Contention_ExactlyOneWins_AndTheRowReportsTheLockHolderAsync","DutyElectionE2ETests.DirtyDeath_TheGrantKnowsItIsLost_AndAnotherInstanceAcquiresAsync","StartupPipelineRunnerDutyTests.AwaitDutyStep_WhoseDutyIsNeverGrantable_FailsBoundedlyInsteadOfHangingAsync"]}
public interface IDutyElector {
  // Grants, or refuses WITH A REASON — losing the race is the only refusal worth retrying,
  // and a caller that cannot tell the reasons apart retries the unretryable forever.
  Task<DutyAttempt> TryAcquireAsync(string duty, CancellationToken ct);
}

public enum DutyRefusal {
  Contended,     // another instance holds it — retry; the holder's release frees it
  Unavailable,   // no coordination connection at all — a standing misconfiguration
  Refused,       // this instance is evicted/unregistered — needs an operator, not a retry
}

public sealed record DutyAttempt {   // exactly one of Grant / Refusal is present
  public IDutyGrant? Grant { get; }
  public DutyRefusal? Refusal { get; }
  public string? Detail { get; }     // the human-readable diagnosis a log line should carry
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

The Postgres implementation takes a session advisory lock on a process-stable key derived from the schema and duty name — process-stable because a per-process hash seed would give every instance its own private lock and exclude nothing. Winning records the holding; a refusal carries its reason and the [pipeline](startup-pipeline) acts on it: `Skip` non-holders carry on; `Await` non-holders retry **only while the refusal is `Contended`** — an `Unavailable` or `Refused` duty fails the step immediately, naming the duty and the elector's detail, because boot failing loudly beats boot hanging silently. While a legitimate contended wait persists, the runner narrates it through `IStartupStepObserver.OnStepWaitingAsync` on a backoff, so a long wait is a story in the logs rather than silence.

The **eviction fence reaches election**: an instance that has been [evicted](../../fundamentals/workers/instance-liveness#eviction-reaping-is-a-fence-not-just-a-deletion) is refused at acquisition even when it wins the primitive, and the implementation releases what it won. That is what turns eviction from a request into a guarantee for exclusive work.

### When the elector itself fails

A refusal is an *answer*. Separately, the question can fail to be asked at all: the elector reaches its coordination primitive over a network, so a read timeout there is neither a grant nor a refusal — it is the absence of a verdict, and it says nothing about whether the step should run.

Such a failure is **absorbed and retried**, exactly as a `Contended` refusal is, because it is the same class of blip every other worker rides out on its next tick. It is also **bounded**: after `MaxTransientDutyFailures` consecutive failures the step fails, naming the underlying exception. Both halves matter, and for the same reason — retrying a standing outage forever is the other way to be silently broken. A clean refusal in between resets the count, because it proves the elector is reachable and therefore that the earlier failures were blips rather than the leading edge of an outage.

What this deliberately does *not* do is stop the host. The startup pipeline runs as a `BackgroundService`, and .NET's default `HostOptions.BackgroundServiceExceptionBehavior` is `StopHost` — so an exception escaping the pipeline terminates the whole process. Worse, it terminates it *gracefully*: the process exits **zero** and writes an orderly shutdown log, making a host destroyed this way indistinguishable from one that was asked to stop. Nothing watching exit codes, restart reasons, or OOM kills can see it, so it can recur indefinitely while every crash signal stays clean.

Staying up is also the more informative outcome, and fail-closed is what makes it safe: a pipeline that never completes leaves the availability filter refusing writes, so the instance is up, [reports unready](startup-status), and carries the reason in its logs. `NonHolderBehavior.Skip` keeps its single non-blocking attempt throughout — a transient failure reports the step skipped with the elector's error as the reason, rather than quietly promoting it into a waiter.

## Role assignment (the default) {#role-assignment-the-default}

With the Postgres driver, duties are held by **role assignment** unless `Whizbang:Database:RoleAssignment:Enabled` is `false`. The advisory lock decides only the vote, a single statement; from then on the duty is a row in `wh_role_assignments` with a holder, an **epoch** and a **lease** in database time. The holder's own work loop renews the lease through `VerifyStillHeldAsync`, so a holder that is stuck, paused or partitioned stops renewing and loses the duty after one lease, and exclusive work presents `(holder, epoch)` to the database (`wh_assert_role_epoch`), so a holder that lost the duty cannot write. The grant carries the epoch as `IDutyGrant.Epoch`.

Held this way: `maintainer`, `migrator`, and the commit-order stamper's leadership (`commit-stamper`). Any other duty name stays on the session lock described below. A few behaviors to know:

- **A newer release takes over cooperatively.** An instance on a newer library version asks an older holder to drain (`IDutyGrant.DrainRequested`); the holder finishes its current step and releases. A vacant duty goes to the newest version voting for it.
- **One long statement does not lose the duty.** Each duty may declare its own lease, and a holder that marks the backend running its statement (`PgRoleElector.MarkDutyBackendAsync`) stays live while that statement runs.
- **A database outage does not cool anyone down.** After an involuntary lapse an instance waits `CooldownAfterLapse` before winning the duty back, unless every holder lapsed together.
- **Rolling deploy from a session-lock release.** The bridge (`HoldLegacySessionLock`) is on by default in this release, so old and new instances never both act. It will default to off in a later release; `Whizbang__Database__RoleAssignment__HoldLegacySessionLock=false` turns it off early.

Health reports the duties under the `roles` component and the meter `Whizbang.Roles` counts elections, hand-offs, drains and losses. The full design, the resilience requirements it meets and the chaos suite that tests them are in the [Duty Role Assignment](../../../proposals/duty-role-assignment) proposal; the options are in the [configuration reference](../configuration/configuration-reference#role-assignment-options).

## Takeover

An instance never looks up whether it has been *assigned* a capability — it attempts acquisition. Takeover therefore needs no coordinator:

1. The holder holds its session lock; its record names the capability.
2. The holder dies. On clean session termination PostgreSQL releases the lock **immediately**, server-side.
3. The record is briefly stale, still claiming the capability.
4. Another instance attempts — because it was already blocked on the lock, on its next poll, or prompted by `InstanceDiedSignal`.
5. It acquires the lock and **is the holder from that instant**, whatever any row still says.
6. Its record is written; the dead instance's rows are reaped at lease expiry and cascade away.

The record is inconsistent only between steps 2 and 6 — the same heartbeat-lease window the system already reaps. A half-open session whose lock lingers (a pod killed for memory) is bounded by the stale-instance cleanup's definitive-dead cutoff, which is why heartbeat liveness is a **correctness backstop** here rather than a latency optimization: the lock handles every clean failure; the cutoff bounds the pathological one.

The steps above are the session-lock model. Under role assignment, step 2 is the lease lapsing in database time (or a clean release, which hands over at once and announces it), and step 5 is the next vote, which voids the lapsed assignment and grants a new epoch.

For `Migrate`, waiters watch the migrator directly: its assignment row, and the duty's session lock for a migrator on an older release. A migrator that stops cleanly releases its duty, so a waiter that finds the schema current exits at once; a migrator that dies is noticed when its lease lapses (30 seconds by default, held open while its migration statement runs), and the schema lock still guarantees that only one instance applies DDL at a time. The duties that rely on signal-plus-poll re-attempt — `maintainer` among them — are precisely the ones for which tens of seconds is immaterial.

## Acquiring a duty {#acquiring-a-duty}

Some work belongs to *winning* a duty rather than to holding it. An `IDutyAcquisitionHandler` names a role and runs on the holder loop's pass that wins that role, before the role's owed work. It does not run again on the passes that merely keep the role, and it runs again each time the role is lost and won back. An instance that never wins the role never runs it.

The grant tells the handler where the role came from. `IDutyGrant.PreviousHolderInstanceId` is the instance that held the role before, when this grant took it over (a hand-off or a takeover after a lapse), and `null` for a first assignment. It is the last holder the role recorded, so after the whole fleet stops, the next cold start counts as a takeover from the last instance that held it.

A handler runs on the holder loop, so it is bounded the same way owed work is: one that hangs stops the loop and the role lapses to another instance. A failure is logged with the handler and the role, and the role is kept. Handlers need role assignment; without it nothing holds a duty from the loop, and no handler runs. A role held only for its acquisition work is still woken at once when its holder releases it, like any other role (see [what starts a pass](#what-starts-a-pass)).

### Vacuum on acquiring the maintainer duty {#vacuum-on-acquiring-the-maintainer-duty}

The work tables (`wh_outbox`, `wh_inbox`, `wh_perspective_events`, `wh_message_deduplication`) are vacuumed by the instance that acquires the `maintainer` duty, never merely by an instance that started:

| The duty | Vacuum |
|---|---|
| First assigned in the fleet | Always, once per process |
| Handed off, or taken over after the holder lapsed | Yes, unless `MaintainOnReassignment` is off |
| Kept by its holder, or regained by the same instance | No |
| Not acquired (an instance joining a fleet with a live holder) | Never |

Schema initialization no longer purges or vacuums. It runs on every instance at every start, and a service that scales out on its backlog starts instances at the peak of a load, so every new instance vacuumed the work tables at the worst moment. The purge runs in the maintenance cycle behind its busy check; between acquisitions, autovacuum and that cycle carry the tables.

Every vacuum runs with the table owner's rights. Postgres does not refuse a non-owner's `VACUUM`: it warns, skips the table, and reports success. So the vacuum runs on the schema-initialization connection (`ConnectionStrings:{name}-init`) when one is configured. Without one, it runs on the application connection only for a table that role owns, and every other table is logged as a warning that names the table and the role, rather than passing for done. The post-ready table rewrite follows the same rule.

```json{
title: "Turn off the vacuum on a maintainer hand-off"
description: "MaintainOnReassignment controls whether an instance that takes the maintainer duty over from another instance vacuums the work tables."
framework: "NET10"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["maintenance", "vacuum", "maintainer-duty", "configuration"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "MaintainOnReassignment": false
      }
    }
  }
}
```

Turn `MaintainOnReassignment` off when hand-offs are frequent and the maintenance cycle is enough between them.

## The holder loop {#the-holder-loop}

Under role assignment, `DutyHolderWorker` holds every duty this instance has work for: owed duty work (an `IDutyWorkHandler`), or [work that runs on acquiring the duty](#acquiring-a-duty). Each pass keeps every duty it holds by verifying it, which renews the lease, and votes in one call for every duty it does not hold. Then, for each duty it holds, it runs the acquisition work if this pass won the duty, then the owed work that is due, then a drain if a newer release asked for one.

```mermaid{caption="One pass of the holder loop: keep what is held, vote for the rest, then run each held duty's work. A pass starts on the renew interval or at once on a release." tests=["DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync","DutyHolderWorkerTests.APass_VotesForEveryRoleItDoesNotHold_InOneCallAsync","DutyHolderWorkerTests.WinningTheRole_RunsTheAcquisitionHandlerOnce_WithTheGrantThatWonItAsync"]}
graph TB
    Wait["Wait<br/>RenewInterval, or a wake"]
    Keep["Keep each held duty<br/>verify, which renews the lease"]
    Vote["Vote for every duty not held<br/>one call"]
    Won["Won a duty<br/>OnBecameHolder"]
    Acq["Acquisition work<br/>only on the pass that won it"]
    Owed["Owed work that is due"]
    Drain["Drain if a newer release asked"]

    Wait --> Keep --> Vote
    Vote -->|"granted"| Won --> Acq --> Owed
    Vote -->|"already held"| Owed
    Owed --> Drain --> Wait

    style Won fill:#d4edda,stroke:#28a745,stroke-width:2px
    style Wait fill:#cce5ff,stroke:#0d6efd,stroke-width:2px
```

### What starts a pass {#what-starts-a-pass}

| Trigger | Effect | Verified |
|---|---|---|
| `RoleAssignmentOptions.RenewInterval` elapses (5 seconds by default) | The next pass runs | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| A release announced on `wh_role_released` for a duty this instance holds or votes for | A pass runs at once, so a graceful hand-off does not wait for the interval | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| The same release, for a duty held only for its acquisition work | A pass runs at once, as for any other duty | {verified: DutyHolderWorkerTests.TheHostedLoop_ARelease_OfARoleHeldOnlyForItsAcquisitionWork_WakesAPassAsync} |
| A release of a duty this instance has no work for | Nothing; the duty is not this instance's to take | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| `DutyHolderWorker.Wake()` | A pass runs at once | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| The host stops | Every held duty is released, which announces it to the rest of the fleet | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |

A duty can be held only because work runs on acquiring it, such as the [maintainer's vacuum](#vacuum-on-acquiring-the-maintainer-duty) on an instance that has no owed maintainer work. Earlier releases woke the loop only for duties with owed work, so a hand-off of such a duty waited up to one renew interval. A release of it now wakes the loop like any other.

### Watching the loop {#watching-the-holder-loop}

`DutyHolderWorker` raises two events. Both must not block: one runs on the loop, and the other on whichever thread announced the release.

| Event | Raised | Verified |
|---|---|---|
| `OnBecameHolder` (`Action<string>`, the duty) | Once this instance wins a duty and records it as held, so `Holds(duty)` already returns true. It is raised on the pass that won the duty, before the duty's acquisition and owed work run. | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| `OnWakeRequested` (`Action`) | On the caller's thread, each time the next pass is asked to run at once: a release of a duty this instance holds or votes for, or a call to `Wake()`. A release of any other duty does not raise it. | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync, DutyHolderWorkerTests.TheHostedLoop_ARelease_OfARoleHeldOnlyForItsAcquisitionWork_WakesAPassAsync} |

```csharp{
title: "Log and count the duty holder's transitions"
description: "Subscribes to the duty holder loop's events: one line when this instance wins a duty, and a counter of passes woken early by a release."
framework: "NET10"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["duties", "role-assignment", "holder-loop", "events", "observability"]
tests: ["DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync"]
}
// Null when this host has no duty work to hold, or role assignment is off.
if (app.Services.GetService<DutyHolderWorker>() is { } holder) {
  holder.OnBecameHolder += duty => logger.LogInformation("This instance now holds {Duty}", duty);
  holder.OnWakeRequested += () => earlyPasses.Add(1);
}
```

Because `OnWakeRequested` is raised before the notification call returns, whether a release woke the loop is known at once. That makes it the signal to wait on in a test, where waiting for a pass to happen, or not, would be a race.

## Related

- [The Startup Pipeline](startup-pipeline) — where duties decide who runs an exclusive step
- [Rolling Upgrades](rolling-upgrades) — standby, eviction, and the verdict that releases capabilities
- [Instance Liveness](../../fundamentals/workers/instance-liveness) — the heartbeat, the alive lock, and the eviction tombstone
- [The Startup Status Surface](startup-status) — holdings as a fleet-level query
