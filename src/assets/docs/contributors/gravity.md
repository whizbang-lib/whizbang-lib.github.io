---
title: Gravity, the Design Principle Behind Whizbang's APIs
pageType: explanation
audience: [contributor]
status: current
order: 2
description: Whizbang is designed so the path of least resistance is the correct design. The core system owns a behavior through a pipeline or registration API, and a test or analyzer fails when something bypasses it, instead of relying on every author remembering a shared helper.
tags: contributing, architecture, design-principles, api-design, gravity
---

# Gravity, the Design Principle Behind Whizbang's APIs

**Gravity** is the principle every part of Whizbang is designed by: the path of least resistance is the correct design
and architecture. The core system forces you down the right path, so that if you trip and fall, you fall toward the
gravity.

A behavior with gravity is one nobody has to remember. The easiest thing to write is the right thing, and the wrong
thing is either impossible or fails the build.

## Gravity versus a shared helper

When the same correct behavior is needed in many places, there are two ways to share it:

| | A shared helper | Gravity |
|---|---|---|
| Shape | A method each caller invokes | A pipeline, registration or base the system runs |
| Who decides it runs | Every author, every time | The core system, once |
| A new author who does not know about it | Writes it by hand, or forgets it | Gets it anyway |
| When the rule changes | Every call site has to change | One place changes |
| Enforcement | Code review, hope | A test or analyzer that fails when it is bypassed |

A helper is better than copies, but it still depends on the next author choosing it. Gravity removes the choice.

## A worked example: when a worker starts

Every background worker has to wait until startup reaches the right stage before it touches the database. Before
gravity was applied, about 41 places each wrote the same wait by hand: a null check, an await on the schema-ready gate,
and a catch that returns on shutdown. Each copy was a chance to get it subtly wrong, and a new worker had to know to
write it at all.

With gravity, a worker is **registered with the point it starts at**, and the host starts it there. The worker
contains no gate code:

```csharp{title="A worker registered with its start point" description="The host starts the worker once the instance is eligible for work; the worker holds no wait of its own" category="Workers" difficulty="BEGINNER" tags=["Gravity","Startup","Workers","Registration"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync"]}
// Accept commands unless another stage is named: the safe default for anything that touches the message tables.
services.AddWhizbangWorker<OrderArchiveWorker>();

// The few that must run before the instance is eligible (the heartbeat, for one) start when the schema is ready.
services.AddWhizbangWorkerAtSchemaReady<InstanceMetricsWorker>();
```

Every one of those hand-written waits was deleted. Two checks keep it that way:

- **A test fails when a hosted service has no start point.** It composes a host the way an application does and fails,
  naming the service, when any hosted service it resolves has no place in the start table.
  {verified: StartupHostedServiceAuditTests.EveryHostedService_HasAPlaceInTheStageTable_AndTheStagedOnesStartAtTheirStageAsync}
- **A guard fails when worker code waits on the gate to decide its own start.** It scans the library's hosted services
  for the schema-ready gate and allows only the startup machinery that opens and drives it.
  {verified: WorkerStartGateSourceGuardTests.NoHostedService_DecidesItsOwnStartOnTheSchemaReadyGate_ButTheStartupMachineryAsync}

The default is the safe choice too: a worker named without a stage starts at Accept commands, once the instance's row
says it is eligible for work. The easiest way to add a worker is now also the only correct one. See
[Registering a worker with its start point](/v1.0.0/operations/startup/startup-status#add-whizbang-worker) for the
API and the start of every framework worker (issue [#1636](https://github.com/whizbang-lib/whizbang/issues/1636),
startup stages).

## A worked example: one way to coordinate {#coordination-source-guard}

Instances coordinate through the database: they say they are alive, hold duties, and wake one another. Before
[#2027](https://github.com/whizbang-lib/whizbang/issues/2027) each feature did this its own way, and "alive" alone had
about a dozen definitions: the partition assigner's two windows, the standby watcher's option, two fleet readers with
2 minute windows, the claim's 30 s, the reap's caller cutoffs, the orphan claims' named connections and the doorbells'
30 s and 5 minutes. Each was a helper someone chose to write, and the lifecycle monitor and the reap could disagree
about the same instance at the same moment.

With gravity there is **one rule**, defined once in SQL, and every reader asks it through `wh_live_instance_ids()` or
`wh_instance_is_live(id)` (see [Instance liveness](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule)). The
copies were deleted. What keeps them deleted is a source guard, `CoordinationSourceGuardTests`, which fails when one
of these mechanisms appears outside an allowlist:

| Mechanism | Where the guard looks | Ask instead |
|---|---|---|
| A raw notification channel (`LISTEN`, `NOTIFY`, `pg_notify`) | C# under `src`, and each SQL function's latest definition | The signal bus |
| A subscription of its own to the shared notification connection (`INotifySubscription`, `ISharedNotifyConnection`) | C# under `src` | A typed signal on the bus (`ISignalBus.Subscribe`) |
| A coordination channel's name (`wh_committed`, `wh_role_released`, `wh_partition_assignment`, `wh_multi_stream_work`) | C# under `src` | The typed coordination signal; only the bus's wire, `PgSignalWire.cs`, names the channel |
| An advisory lock (any `pg_advisory_*` call in C#; a session lock in SQL) | The same | A role assignment with a lease and an epoch |
| A liveness check (a comparison against `last_heartbeat_at` or `LastHeartbeatAt`, `is_instance_alive`, `pg_stat_activity`, `pg_locks`) | The same | The one liveness rule |

The C# scan reads every source file under `src` with its comments removed. The SQL scan reads the migration corpus and
judges only each function's **last** definition, the one a database runs, also without comments, so a history of old
definitions and a comment that names `pg_stat_activity` are not offenders.
{verified: CoordinationSourceGuardTests.NotifyAndListen_AppearOnlyInTheCoordinationFilesAsync, CoordinationSourceGuardTests.RawChannelSubscriptions_AppearOnlyInTheSignalBusFilesAsync, CoordinationSourceGuardTests.CoordinationChannels_AreNamedOnlyByTheBussWireAsync, CoordinationSourceGuardTests.AdvisoryLocks_AppearOnlyInTheAllowlistedFilesAsync, CoordinationSourceGuardTests.LivenessChecks_AppearOnlyInTheAllowlistedFilesAsync, CoordinationSourceGuardTests.SqlLivenessChecks_AppearOnlyInTheRuleAndTheAllowlistedFunctionsAsync, CoordinationSourceGuardTests.SqlSessionAdvisoryLocks_AppearOnlyInTheAllowlistedFunctionsAsync, CoordinationSourceGuardTests.SqlNotifications_AppearOnlyInTheAllowlistedFunctionsAsync}

**Every allowlist entry states its reason.** A file or function is allowed because it *is* the mechanism (the rule
itself, the lock half of the rule, the one LISTEN connection, the signal bus's transport), because it only displays or
throttles and judges nothing (a status report showing how long ago an instance beat, a write throttle on the beat
itself), or because it holds a lock for one statement or DDL pass, which is mutual exclusion and not a duty (the concurrent index
drop, which cannot run in a transaction, holds the schema lock at session level for its three statements and nothing
more).

**No entry is a debt.** While the standard was being folded in, entries marked `PENDING` named mechanisms still to
move, each with the part of the work that would remove it. The advisory-lock duties went first: since
[#2044](https://github.com/whizbang-lib/whizbang/issues/2044) every duty is a role assignment. The raw channels went
last: since [#2046](https://github.com/whizbang-lib/whizbang/issues/2046) every coordination channel is a
[signal on the bus](/v1.0.0/fundamentals/signal-bus/signal-bus#coordination-signals). In C#, only the shared
connection and the bus's Postgres transport issue `NOTIFY` or `LISTEN`; only the bus's files subscribe to the shared
connection; only `PgSignalWire.cs` names a coordination channel. In SQL, only `ring_doorbells`, the bus's after-commit
doorbell ringer, and `wh_publish_signal`, the bus's publish, notify. Every pending entry is gone, and a check fails if
any allowlist reason says `PENDING` again: an allowlist is a list of reasons, never of debts.
{verified: CoordinationSourceGuardTests.NoAllowlistEntry_IsLeftPendingAsync, CoordinationSourceGuardTests.SqlNotifications_AppearOnlyInTheAllowlistedFunctionsAsync}

```csharp{title="An allowlist entry carries its reason" description="Each allowed file or SQL function maps to why it may use the mechanism; no entry may be marked PENDING." category="Testing" difficulty="INTERMEDIATE" tags=["Gravity", "Source guard", "Liveness", "Coordination"] tests=["CoordinationSourceGuardTests.SqlLivenessChecks_AppearOnlyInTheRuleAndTheAllowlistedFunctionsAsync", "CoordinationSourceGuardTests.AdvisoryLocks_AppearOnlyInTheAllowlistedFilesAsync", "CoordinationSourceGuardTests.CoordinationChannels_AreNamedOnlyByTheBussWireAsync", "CoordinationSourceGuardTests.NoAllowlistEntry_IsLeftPendingAsync", "CoordinationSourceGuardTests.EveryAllowlistEntry_StillMatchesAsync"]}
private static readonly Dictionary<string, string> _sqlLivenessAllowlist = new(StringComparer.Ordinal) {
  ["wh_instance_liveness"] = "THE liveness rule",
  ["wh_direct_alive_lock_holders"] = "the lock half of the rule",
  ["register_instance_heartbeat"] = "a write throttle on the beat itself; it judges no peer",
};

private static readonly Dictionary<string, string> _coordinationChannelAllowlist = new(StringComparer.Ordinal) {
  ["src/Whizbang.Data.Postgres/Notifications/PgSignalWire.cs"] = "the signal bus's Postgres wire: which channel each "
    + "coordination signal travels on, by the name an older release uses",
};

private static readonly Dictionary<string, string> _advisoryAllowlist = new(StringComparer.Ordinal) {
  ["src/Whizbang.Data.Postgres/SchemaInitializationLock.cs"] = EXCLUSION,
  ["src/Whizbang.Data.Postgres/Schema/ManagedSchemaReconciler.cs"] = EXCLUSION + "; and " + CONCURRENT_DROP,
};
```

**The allowlist only shrinks.** An entry whose file or function no longer uses the mechanism fails
`EveryAllowlistEntry_StillMatchesAsync`, so a stale entry cannot linger as a pre-approved hole for the next author;
the commit that removes the last use removes the entry with it. And a guard that reads nothing passes everything, so
`TheScans_SeeTheMechanismsTheyGuardAsync` proves each scan finds what it exists to find: the LISTEN connection, the
bus's SQL publish, the bus's transport as a subscriber, the bus's wire naming a channel, a sample old-style
`pg_notify` and channel constant, a schema lock, the rule itself and a sample heartbeat comparison, while `claim_work`, which asks the rule, is not flagged.
The SQL scan reads a function's last word: a function a later migration drops is not scanned, because no database
runs it, and one dropped and then defined again is scanned by its new definition.
{verified: CoordinationSourceGuardTests.EveryAllowlistEntry_StillMatchesAsync, CoordinationSourceGuardTests.TheScans_SeeTheMechanismsTheyGuardAsync}

**No duty is held by an advisory lock, and a test says so.** An allowlist can only say where a lock may appear, not
what it may be used for, so a separate check names the files that hold duties and fails if any of them takes an
advisory lock: the role elector, the commit-order stamper and the migrator watch, which also may not use the lock probe.
It fails as well if the session-lock duty elector comes back, or if any allowlist entry is still waiting for the
advisory-lock duties to move.
{verified: CoordinationSourceGuardTests.NoDuty_IsHeldByAnAdvisoryLockAnywhereAsync}

```csharp{title="No duty file takes an advisory lock" description="The guard names the files that hold duties and fails if any takes an advisory lock, if the migrator watch uses the lock probe, or if the session-lock elector returns." category="Testing" difficulty="INTERMEDIATE" tags=["Gravity", "Source guard", "Duties", "Coordination"] tests=["CoordinationSourceGuardTests.NoDuty_IsHeldByAnAdvisoryLockAnywhereAsync"]}
string[] dutyHolders = [
  "src/Whizbang.Data.Postgres/Notifications/PgRoleElector.cs",
  "src/Whizbang.Data.Postgres/Notifications/PgCommitOrderStamperWorker.cs",
  "src/Whizbang.Data.Postgres/MigratorWatch.cs",
];
foreach (var path in dutyHolders) {
  await Assert.That(_advisory().IsMatch(csharp[path])).IsFalse().Because($"{path} holds a duty; a duty is a role assignment");
}
await Assert.That(csharp["src/Whizbang.Data.Postgres/MigratorWatch.cs"].Contains("AdvisoryLockProbe", StringComparison.Ordinal)).IsFalse();
await Assert.That(csharp.Keys.Any(p => p.EndsWith("/PgDutyElector.cs", StringComparison.Ordinal))).IsFalse();
```

### Every worker obeys the run permit {#run-permit-guard}

The same standard covers how an instance stops taking work. Before
[#2045](https://github.com/whizbang-lib/whizbang/issues/2045) a stand-down, a pause and a stop were three paths: the
standby watcher and the startup stand-down wrote `StandingBy` directly, the killswitch broadcast a phase that workers
kept polling through, and host shutdown wrote its stages in one service and released roles in another. Now there is
one run permit and [one path](/v1.0.0/resilience/managed-resource-run-control#one-run-control-path) that closes it, and
two tests keep every worker on it.

The source guard gained three checks:

| Check | Fails on | Ask instead |
|---|---|---|
| `EveryClaim_ObeysTheRunPermitAsync` | A file that calls a claim (`Claim*Async`, `Lease*Async`, `FetchPendingCoalesceAsync`, the integrity claims) and neither takes a hold (`RunPermit.EnterAsync`) nor asks `MaintainerDuty.IsThisInstancesTurn` | Take a hold around the claim, or run it on the maintainer's turn |
| `HaltingPhases_AreWrittenOnlyByTheRunControlPathAsync` | `Pausing`, `Paused`, `StandingBy`, `Stopping`, `Stopped` or `Resuming` written through `AdvanceToAsync` or `EnterPhaseAsync` outside the path | `IWhizbangRunController.HaltAsync` or `ResumeAsync` |
| `EveryHostedConsumer_ObeysTheRunPermitAsync` | A `BackgroundService` that subscribes to a transport without `RunPermit.Obey` | Obey the permit: pause every subscription on a close, resume on a reopening |

{verified: CoordinationSourceGuardTests.EveryClaim_ObeysTheRunPermitAsync, CoordinationSourceGuardTests.HaltingPhases_AreWrittenOnlyByTheRunControlPathAsync, CoordinationSourceGuardTests.EveryHostedConsumer_ObeysTheRunPermitAsync}

Each allowlist entry states its reason, as above: the store implementations that declare and run the claims, the
maintenance steps that run on the maintainer's turn, a deduplication claim taken while handling a message the instance
already holds, and a test harness's manual pump. Only the path itself may write a halting phase, and the startup
stand-down may record `StandingBy` alone only in a host with no path, where there is no permit, no held work and no
role to release.

**The scans prove they see.** `TheRunControlScans_SeeWhatTheyGuardAsync` checks that the claim scan finds the claim
worker's claim and its hold, the maintainer question in the integrity audit, and the path's own phase writes, and that
the halting-phase pattern matches a sample direct write; the hosted-consumer check asserts that it found exactly the two
consumers it vouches for, `TransportConsumerWorker` and `ServiceBusConsumerWorker`. A stale allowlist entry fails, as
everywhere in the guard.
{verified: CoordinationSourceGuardTests.TheRunControlScans_SeeWhatTheyGuardAsync, CoordinationSourceGuardTests.EveryHostedConsumer_ObeysTheRunPermitAsync}

```csharp{title="A hosted consumer must obey the run permit" description="The guard lists every hosted worker that subscribes to a transport, fails any that does not obey the run permit, and checks it found both consumers so it cannot pass by reading nothing." category="Testing" difficulty="INTERMEDIATE" tags=["Gravity", "Source guard", "RunControl", "Coordination"] tests=["CoordinationSourceGuardTests.EveryHostedConsumer_ObeysTheRunPermitAsync"]}
var offenders = _csharpSources()
  .Where(f => _hostedWorker().IsMatch(f.Value) && _subscribes().IsMatch(f.Value)
    && !f.Value.Contains("RunPermit.Obey(", StringComparison.Ordinal))
  .Select(f => f.Key)
  .ToList();
await Assert.That(offenders).IsEmpty();
var consumers = _csharpSources().Where(f => _hostedWorker().IsMatch(f.Value) && _subscribes().IsMatch(f.Value))
  .Select(f => f.Key).Order(StringComparer.Ordinal).ToList();
await Assert.That(consumers).IsEquivalentTo([
  "src/Whizbang.Core/Workers/ServiceBusConsumerWorker.cs",
  "src/Whizbang.Core/Workers/TransportConsumerWorker.cs",
]).Because("the scan must see the consumers it vouches for, or it vouches for nothing");
```

**A source scan cannot see a registration, so a host test does.** `RunPermitAuditTests` composes a real host the way a
consumer does (registering `ServiceBusConsumerWorker` the way a host does), builds it without starting it, and gives
every hosted service a stated place: it obeys the permit itself and holds the container's one permit, it obeys through
the maintainer question or the role elector, it finishes work the instance already holds, or it takes no work. A new
hosted service with no place fails, naming it, so its author decides how it obeys a stand-down, a pause and a stop
instead of taking work through all three. A worker that obeys a permit of its own, rather than the container's, fails
too: the path would close a permit nothing reads.
{verified: RunPermitAuditTests.EveryHostedService_SaysHowItObeysTheRunPermit_AndTheObeyersHoldTheOnePermitAsync}

The failure message says what to use instead (for a liveness check: *ask the one rule, `wh_instance_is_live` or
`wh_live_instance_ids`*), so an author who trips the guard falls toward the standard path, not toward a new allowlist
entry.

## Applying it

When you design or review a Whizbang change, ask:

1. **What does the easiest path produce?** If a contributor or a consumer takes the obvious route, is the result
   correct? If not, the API is wrong, not the contributor.
2. **Who owns the behavior?** Prefer the pipeline, the registration or the generator owning it over each caller
   implementing it.
3. **What fails when someone bypasses it?** Back the design with a test, an analyzer diagnostic, or a type that cannot
   be built the wrong way. Prefer errors to warnings for a new diagnostic.
4. **Is the default safe?** A consumer who configures nothing should get the correct, conservative behavior.

Gravity works alongside the project's other standards: every design choice is documented with its reason and locked by
a test that fails if it flips, and no type ships with tests but no caller.
