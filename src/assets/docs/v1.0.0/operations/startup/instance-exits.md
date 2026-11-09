---
title: Instance Exits
pageType: concept
verifiedAgainstCommit: 4f0bb517
verifiedDate: 2026-11-08
version: 1.0.0
category: Startup
order: 5
description: >-
  Every way an instance's process ends goes through one exit path: a clean halt,
  one detailed log entry with an ExitCause, a row in wh_instance_exits, and one
  exit code per cause. An evicted instance exits so its host restarts it, and a
  crash on any thread takes the same path.
tags: >-
  exit, exit-code, exitcause, shutdown, eviction, crash, wh_instance_exits,
  run-control, operations, kubernetes, supervisor
codeReferences:
  - src/Whizbang.Core/RunControl/ExitCause.cs
  - src/Whizbang.Core/RunControl/IWhizbangInstanceExit.cs
  - src/Whizbang.Core/RunControl/WhizbangInstanceExit.cs
  - src/Whizbang.Core/RunControl/InstanceExitLogEntry.cs
  - src/Whizbang.Core/RunControl/ProcessCrashEvents.cs
  - src/Whizbang.Core/RunControl/WhizbangRunControlServiceCollectionExtensions.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Workers/MaintenanceRetentionOptions.cs
  - src/Whizbang.Data.Postgres/InstanceExitSql.cs
  - src/Whizbang.Data.Postgres/Migrations/363_EveryExitIsRecorded.sql
  - src/Whizbang.Data.Postgres/Migrations/364_InstanceExitRetentionIsASetting.sql
  - BannedSymbols.Exit.txt
testReferences:
  - tests/Whizbang.Core.Tests/RunControl/ExitCauseContractTests.cs
  - tests/Whizbang.Core.Component.Tests/RunControl/WhizbangInstanceExitTests.cs
  - tests/Whizbang.Core.Component.Tests/RunControl/WhizbangInstanceExitCrashTests.cs
  - tests/Whizbang.Core.Component.Tests/RunControl/InstanceExitSourceGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/HeartbeatWorkerStartupBeatTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceExitRecordSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartingInstanceHeartbeatE2ETests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperInstanceExitTests.cs
---

# Instance Exits

An instance's process ends for many reasons: the host is asked to stop, an operator stops it, a newer version takes
over, something crashes, startup cannot complete, the schema is newer than the binary, or the fleet evicts it. Each of
those used to end the process its own way, and most said little about why. Now **every exit, good or bad, goes through
one exit path**, `IWhizbangInstanceExit`, which does the same four things whatever the cause:

1. **It halts cleanly** through the [one run-control path](../../resilience/managed-resource-run-control#one-run-control-path)
   (`HaltAsync` with `RunHaltReason.Stop`, bounded by the host's stop token): the run permit closes, the work in hand
   finishes, and leased streams and roles are released, so a peer takes them over at once.
2. **It writes one detailed log entry** that says why, with every fact as a structured field ([the log entry](#the-log-entry)).
3. **It records the same facts** as a row of `wh_instance_exits` when the database is reachable ([the exit record](#the-exit-record)).
4. **It sets the process exit code** for the cause ([exit codes](#exit-codes)) and stops the host through
   `IHostApplicationLifetime`, never `Environment.Exit`.

The first request wins. A later request, of any cause, changes nothing, so the process exits once and the cause the
entry states is the one that started the exit.

| Behavior | Why | Verified by |
|---|---|---|
| Every cause halts through the run-control path, writes one entry at its level, sets its exit code and stops the host, once. | One path means no exit can forget a step: an exit that ended the process without releasing roles left a peer waiting out a lease, and one that said nothing left an operator guessing. | {verified: WhizbangInstanceExitTests.EachCause_SetsItsExitCode_WritesOneEntryAtItsLevel_HaltsAndStopsTheHostOnceAsync, WhizbangInstanceExitTests.TheRunControlRegistration_ProvidesOneExitPath_AndTheProcessExitCodeAsync} |
| The first cause wins; a later request or a host stop changes nothing. | Two failures often arrive together (an eviction and the shutdown it triggers). The entry must name the one that started it, and the process must not exit twice. | {verified: WhizbangInstanceExitTests.TheFirstCauseWins_ALaterRequestOrAHostStopChangesNothingAsync} |
| In a host, a request stops the host at once, and the host's own stop completes the exit on the host's stop token. Outside a host, the request completes the exit itself. | The host's shutdown budget bounds the halt, so an unreachable database cannot hold a dying process past `HostOptions.ShutdownTimeout`. | {verified: WhizbangInstanceExitTests.AHostedExit_StopsTheHostFirst_AndTheHostsStopCompletesItOnTheStopTokenAsync, WhizbangInstanceExitTests.AHostedExit_WithoutAHostLifetime_CompletesItselfAsync, WhizbangInstanceExitTests.TheHostsStopBudget_RunningOut_WhileAnotherCallerCompletesTheExit_EndsOnlyTheWaitAsync, StartupStageHostLifecycleTests.Stopping_CompletesTheExitPath_OnTheHostsStopTokenAsync, StartupStageHostLifecycleTests.Starting_EntersPreflight_AndTellsTheExitPathTheHostStartedAsync} |
| A host stop that no cause asked for is `HostShutdown`; one that follows a hosted worker's fault is `Crash`, naming the worker and its failure. | A SIGTERM from a deployment and a worker that threw are different events, and an operator needs to tell them apart without reading the lines before. | {verified: WhizbangInstanceExitTests.AHostStopNoCauseAskedFor_IsAHostShutdownAsync, WhizbangInstanceExitTests.AHostStop_AfterAHostedWorkerFaulted_IsACrash_NamingTheWorkerAndItsFailureAsync} |
| A halt that throws is said in the entry, and the exit goes on; a host with no run-control path still exits and says it had nothing to halt. | An exit is the last thing a process does. A failure in one step must not keep the others (the entry, the row, the exit code) from happening. | {verified: WhizbangInstanceExitTests.AHaltThatThrows_IsSaidInTheEntry_AndTheExitGoesOnAsync, WhizbangInstanceExitTests.AHostWithoutARunControlPath_StillExits_SayingThereWasNothingToHaltAsync} |
| `ExitAsync`'s token ends only the caller's wait; the exit goes on. | A caller giving up on waiting is not a reason to leave the process half exited. | {verified: WhizbangInstanceExitTests.ExitAsync_ItsTokenEndsOnlyTheWaitAsync} |

## Who exits, and with which cause {#who-exits}

| What happens | Cause | Who asks | Verified by |
|---|---|---|---|
| The host is asked to stop (SIGTERM, Ctrl+C, the application stopping itself) | `HostShutdown` | The host's own stop, through `StartupStageHostLifecycle` | {verified: WhizbangInstanceExitTests.AHostStopNoCauseAskedFor_IsAHostShutdownAsync} |
| An operator stops the instance with the killswitch's `StopAsync` | `OperatorStop` | `WhizbangKillswitch` ([operator killswitch](../../resilience/managed-resource-run-control#operator-killswitch)) | {verified: WhizbangInstanceExitTests.TheKillswitchStop_ExitsAsAnOperatorStop_WithExitCodeZeroAsync} |
| An instance standing by for a newer version's migration sees that migration commit | `UpgradeStandDown` | `StandbyWatcher` ([the standby handshake](rolling-upgrades#the-standby-handshake)) | {verified: StandbyWatcherTests.AWithdrawnRequestAndACommittedMigration_ShutsUsDownAsync, StandbyHandshakeE2ETests.Handshake_CommitPath_PeersDrainAcknowledgeAndShutDownAsync} |
| A hosted worker faults and stops the host, or an exception nothing caught reaches the runtime | `Crash` | The host stop that follows; the process's own failure events ([a crash on any thread](#a-crash-on-any-thread)) | {verified: WhizbangInstanceExitTests.AHostStop_AfterAHostedWorkerFaulted_IsACrash_NamingTheWorkerAndItsFailureAsync, WhizbangInstanceExitCrashTests.ACrashOnAnyThread_IsACrashExit_WithItsEntryRowHaltAndDeregistrationAsync} |
| The fleet evicted the instance: its heartbeat, startup beat or claim registration is refused | `ClusterEviction` | `HeartbeatWorker`, `ClaimWorker`, the stood-down instance's beat ([evictions](#evictions)) | {verified: HeartbeatWorkerStartupBeatTests.OnceTheSchemaIsReady_ARefusedBeat_ExitsOnce_AsAClusterEvictionAsync, ClaimWorkerLifecyclePhaseTests.ARefusedRegistration_ExitsAsAClusterEvictionAsync, StartupStandDownTests.KeepVisible_WhenTheRegistryEvictedTheInstance_ExitsOnce_AsAClusterEvictionAsync} |
| A required capability is not ready | `StartupFailure` | `CapabilityVerdictEnforcer` ([capability validation](../infrastructure/capabilities#validation)) | {verified: CapabilityVerdictEnforcerTests.AFailingVerdict_ExitsAsAStartupFailure_NamingTheLineAsync} |
| A blocking schema initialization (`NonBlockingSchemaInit = false`) fails | `StartupFailure` | `WhizbangDatabaseInitializerService` ([blocking initialization](../../data/turnkey-initialization#how-it-works)) | {verified: SchemaInitializationRunnersTests.Blocking_AnUnreadableVersionRecord_ExitsAsAStartupFailure_WithTheGateClosedAsync, SchemaInitializationRunnersTests.Blocking_ACanceledHostStart_IsNotAnExit_ButACancellationThatIsNotTheHosts_IsAsync} |
| A blocking schema initialization finds the schema newer than the binary | `SchemaIncompatible` | `WhizbangDatabaseInitializerService` | {verified: SchemaInitializationRunnersTests.Blocking_ASchemaNewerThanThisBinary_ExitsAsSchemaIncompatibleAsync} |

**A stood-down instance does not exit.** An instance whose [Assess verdict](rolling-upgrades#standing-down) is
`StandDown`, or that [stands down while running](rolling-upgrades#cluster-wide-stand-down), stays alive, standing by and
visible, because the standby handshake and the resume depend on it: it exits only when the newer version's migration
commits (`UpgradeStandDown`), and otherwise resumes when nothing newer is serving. `SchemaIncompatible` is the exit of a
blocking initialization, which has no standby to offer.
{verified: SchemaInitializationRunnersTests.StandDown_RunsNoRunner_KeepsTheGateClosed_AndRegistersTheInstanceVisiblyAsync, StandbyWatcherUpgradeStandDownTests.TheNewerInstanceDies_TheStoodDownInstanceResumes_BecauseAFreshStartWouldServeAsync}

:::updated{version="1.0.0" type="breaking"}
**Two exit codes changed.** A required capability that is not ready now exits with code 4 (it was 1). A blocking
schema initialization that fails now exits with code 4, or 5 for a schema newer than the binary, instead of throwing
out of host start, which ended the process as an unhandled crash. The killswitch's `StopAsync` now ends the process
(exit code 0) once held work and roles are released; before, the process kept running in `Stopped`.
:::

## Exit codes {#exit-codes}

`ExitCause` is a closed set, and each cause has one exit code: 0 for an intended stop, non-zero for a failure, so a
supervisor (Kubernetes or any other) restarts the process. The names, values and codes are a contract with operators
and supervisors; a test fails if one changes.

| `ExitCause` | Exit code | Intended | Log level |
|---|---|---|---|
| `HostShutdown` | 0 | yes | Information |
| `OperatorStop` | 0 | yes | Information |
| `UpgradeStandDown` | 0 | yes | Information |
| `Crash` | 1 | no | Error |
| `Unknown` | 2 | no | Error |
| `ClusterEviction` | 3 | no | Error |
| `StartupFailure` | 4 | no | Error |
| `SchemaIncompatible` | 5 | no | Error |

A value outside the enum exits with `Unknown`'s code. The code is set in one place, `IProcessExitCode`
(`ProcessExitCode.Instance` sets `Environment.ExitCode`); a test host registers its own so the test process keeps its
exit code.
{verified: ExitCauseContractTests.TheSetOfCauses_IsClosed_AtEightAsync, ExitCauseContractTests.AValueOutsideTheEnum_ExitsWithUnknownsCodeAsync, ExitCauseContractTests.TheDefaultExitCode_SetsTheProcessExitCodeAsync}

**Why one code per cause.** A pod's last exit code is often the only fact an orchestrator keeps. With one code per cause,
`kubectl describe pod` (or any supervisor's record) already says whether the instance was evicted, failed to start, or
met a schema it cannot run against, before anyone opens a log.

## The log entry {#the-log-entry}

An exit writes **one** entry, under the `WhizbangInstanceExit` category with EventId 1 (`InstanceExit`): at Error for a
failure, at Information for an intended stop, with the failure's exception attached when there is one. The message is
self-explanatory and ends with a link to this page:

```text{title="An eviction's exit entry" description="The one entry an evicted instance writes as it exits: the cause, the exit code, where it was, what it held, the eviction and what to check." category="Operations" difficulty="BEGINNER" tags=["Startup","Exit","Eviction","Logging"] tests=["WhizbangInstanceExitTests.TheEntry_CarriesEveryRequiredFact_ForAnEvictionAsync"]}
Instance 0199a1c4-... of service orders on host orders-7c9f (process 1) is exiting: ClusterEviction, a failure.
Its heartbeat was refused: the fleet evicted this instance (a peer reaped it and tombstoned it). It was evicted at
2026-11-07T14:02:11.0000000+00:00 by peer instance 0199a1b8-..., recorded reason "...": judged dead by the one
liveness rule because its last heartbeat, at 2026-11-07T14:01:30.0000000+00:00, was older than its liveness window of
30 seconds. Exit code 3: the host (Kubernetes or another supervisor) restarts the process, and the new process
registers under a new instance id. At the exit it was in startup stage Running, lifecycle phase Running, up 3605.2
seconds; its last accepted heartbeat was 41.0 seconds before. It held the roles maintainer, 12 leased stream(s) and 3
unit(s) of work in hand; the run-control path released what it could, and a peer takes over anything left when its
lease lapses. The exit is recorded in wh_instance_exits. If this was not expected, check for heartbeat starvation
(thread-pool starvation, long garbage-collection or CPU-throttling pauses), database connectivity from this host, and
long process pauses (a debugger, a suspended VM or container) around the last heartbeat. See
https://whizbang-lib.github.io/docs/v1.0.0/operations/startup/instance-exits
```

Every fact is also a structured field under a stable name, so a log query finds every exit of a cause without parsing
text:

| Field | Meaning |
|---|---|
| `ExitCause`, `ExitCode`, `Intended` | The cause, its code, and whether it was an intended stop |
| `InstanceId`, `ServiceName`, `HostName`, `ProcessId` | Which process exited |
| `Reason` | What happened, in a sentence an operator can act on |
| `StartupStage`, `LifecyclePhase`, `UptimeSeconds`, `SecondsSinceLastHeartbeat` | Where it was: its stage and phase, how long the host had run, and how long since its last accepted heartbeat |
| `HeldRoles`, `HeldLeases`, `InHand` | What it held when the exit began, read before the halt released it |
| `ExitRecorded`, `ExitRecordNote` | Whether the row was written to `wh_instance_exits`, and why not when it was not |
| `EvictedAt`, `EvictedBy`, `EvictionReason`, `EvictedLastHeartbeatAt`, `LivenessWindowSeconds` | For an eviction, the tombstone's account of it |
| `DocsLink` | This page |

The sentence that closes the message says what to check for each cause: what asked the host to stop, who used the
killswitch, the rollout that migrated the schema, the exception and the worker that threw it, heartbeat starvation and
connectivity for an eviction, connectivity and capabilities for a startup failure, and the newer release for an
incompatible schema.

| Behavior | Why | Verified by |
|---|---|---|
| The entry carries every fact as a field and ends with its format. | One entry per exit, queryable by field, replaces scattered lines at different levels (the heartbeat's own eviction line, the capability enforcer's Critical lines, the watcher's shutdown line), which said less and could not be found together. | {verified: WhizbangInstanceExitTests.TheEntry_CarriesEveryRequiredFact_ForAnEvictionAsync, WhizbangInstanceExitTests.TheEntry_IsAListOfItsFields_EndingWithItsFormatAsync} |
| What the instance held is read before the halt releases it. | Read afterwards, it would always say nothing, and an operator could not tell what a peer had to take over. | {verified: WhizbangInstanceExitTests.TheEntry_StatesWhatTheInstanceHeld_ReadBeforeTheHaltReleasedItAsync} |
| A host with nothing to report still exits, saying what it could not tell (no host start seen, no accepted heartbeat). | A missing fact is stated as missing, never left blank or guessed. | {verified: WhizbangInstanceExitTests.AHostWithNothingToReport_StillExits_SayingWhatItCouldNotTellAsync} |
| An eviction the tombstone does not fully describe says so; any cause states a tombstone the instance has. | A tombstone written by an older release, or by the standby handshake's fence, lacks the heartbeat and window; the entry says which parts are unknown. | {verified: WhizbangInstanceExitTests.AnEvictionTheTombstoneDoesNotFullyDescribe_SaysSo_AndAnyCauseStatesATombstoneItHasAsync} |

:::updated
**Replaced lines.** The heartbeat's eviction line (`HeartbeatWorker` EventId 8, `has been evicted ... heartbeat
refused`) and the standby watcher's shutdown line (`StandbyWatcher` EventId 4) are gone, and the capability enforcer no
longer logs at Critical: the exit's one entry states each of them. Alerts that matched those lines should match
`WhizbangInstanceExit` EventId 1 with the `ExitCause` field instead.
:::

## The exit record {#the-exit-record}

The same facts are recorded durably, one row per exit of any kind, in `wh_instance_exits` (migration 363), written
through `IWorkCoordinator.RecordInstanceExitAsync`, which calls `wh_record_instance_exit`. The function also reads the
instance's eviction tombstone in the same call, so the entry can state the eviction from one round trip.

| Column | Meaning |
|---|---|
| `exit_id` | Identity |
| `instance_id`, `service_name`, `host_name`, `process_id` | Which process exited |
| `exit_cause`, `exit_code`, `intended` | The cause (the `ExitCause` name), its code, and whether it was intended |
| `reason`, `exception_type`, `exception_message` | What happened, and the failure behind it |
| `startup_stage`, `lifecycle_phase`, `uptime_seconds`, `seconds_since_last_heartbeat` | Where it was |
| `held_roles`, `held_leases`, `in_hand` | What it held |
| `library_version` | The library version it ran |
| `evicted_at`, `evicted_by`, `eviction_reason`, `evicted_last_heartbeat_at`, `evicted_liveness_window_seconds` | The tombstone's account of an eviction |
| `exited_at` | When, on the database's clock |

```sql{title="Recent exits, newest first" description="Every exit of every instance in the last day, with its cause, code and reason" category="Operations" difficulty="BEGINNER" tags=["Startup","Exit","SQL"] tests=["InstanceExitRecordSqlTests.AnExit_IsRecordedWithEveryFact_AndNoTombstoneAsync","InstanceExitRecordSqlTests.AnEvictedInstancesExit_RecordsAndReturnsTheTombstoneAsync"]}
SELECT exited_at, service_name, host_name, exit_cause, exit_code, reason, evicted_by
FROM wh_instance_exits
WHERE exited_at > now() - interval '1 day'
ORDER BY exited_at DESC;
```

**The write is best effort.** The row is written when the database is reachable. When it is not (the database is down,
the function does not exist yet on a Dapper host whose pass has not run, or the host's work coordinator keeps no
instance records), the exit still completes and the entry says the row could not be written, and why
(`ExitRecorded = false`, `ExitRecordNote`). Any other failure of the write is reported in the entry as well.

**Retention is a setting.** The next exit's write removes rows older than `wh_settings.instance_exit_retention_days`,
30 days when nothing sets it. Set it from `Whizbang:Workers:Maintenance:Retention:InstanceExitDays`
(`MaintenanceRetentionOptions.InstanceExitDays`), published like every other
[retention window](../configuration/configuration-reference#database-side-settings) (migration 364). Exits are rare, so
the write prunes; the maintenance sweep does not.

| Behavior | Why | Verified by |
|---|---|---|
| One row per exit of any kind, not columns on the eviction tombstone. | Most exits are not evictions. A table of exits answers "why did this pod restart" for every cause, and survives the instance row, which shutdown deregisters. | {verified: InstanceExitRecordSqlTests.AnExit_IsRecordedWithEveryFact_AndNoTombstoneAsync, InstanceExitRecordSqlTests.AnExitWithNothingOptional_IsRecorded_WithTheGapsLeftEmptyAsync, WhizbangInstanceExitTests.TheDurableRow_IsWrittenThroughTheCoordinator_WithTheFactsTheEntryStatesAsync} |
| An evicted instance's exit records and returns its tombstone; a tombstone written before 363 is returned with its gaps. | The entry states the eviction as the evicting peer recorded it, from the same call that writes the row. | {verified: InstanceExitRecordSqlTests.AnEvictedInstancesExit_RecordsAndReturnsTheTombstoneAsync, InstanceExitRecordSqlTests.ATombstoneWrittenBeforeThisRelease_IsReturnedWithItsGapsAsync, DapperInstanceExitTests.AnEvictedInstancesExit_RecordsAndReturnsTheTombstoneAsync, DapperInstanceExitTests.AnExitOfAnInstanceNeverEvicted_IsRecordedWithoutATombstoneAsync} |
| A row that cannot be written leaves the exit to complete, and the entry says why. | The exit must never wait on, or fail because of, the database it may be exiting from. | {verified: WhizbangInstanceExitTests.WhenTheRowIsNotWritten_TheEntrySaysWhy_AndTheExitStillCompletesAsync, DapperInstanceExitTests.AnExit_BeforeThePassCreatedItsFunction_IsNotRecorded_AndSaysWhyAsync, DapperInstanceExitTests.AnExit_ThatFailsForAnyOtherReason_ThrowsAsync, WorkCoordinatorDefaultInterfaceTests.RecordInstanceExitAsync_DefaultImplementation_KeepsNoRecordAsync} |
| Rows older than the configured retention are removed by the next write; 30 days by default. | An operator decides how long the record is kept, as for every other retention window; a constant inside the function could not be changed without a migration. | {verified: InstanceExitRecordSqlTests.AWrite_RemovesRowsOlderThanThirtyDaysAsync, InstanceExitRecordSqlTests.AWrite_RemovesRowsOlderThanTheConfiguredRetentionAsync, RetentionSettingsBridgeTests.EachIntegerOption_PublishesItsKeyAsAnIntegerLiteralAsync} |
| The table, its function and the tombstone's new columns are in the bootstrap region. | A starting instance beats from its registration, so it can be evicted, and exit, before the main pass reaches 363. | {verified: StartingInstanceHeartbeatE2ETests.AnInstanceEvictedWhileStarting_ExitsOnce_WithCodeThree_AndRecordsWhoEvictedItAsync} |

## Evictions {#evictions}

A peer whose heartbeat runs the reap removes every instance [the one liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule)
calls dead and tombstones it in `wh_instance_evictions`. The evicted instance learns it on its next beat: its
heartbeat, its startup beat (while it is still starting), or its claim registration is refused.

**An evicted instance exits** with `ClusterEviction`, exit code 3, so its host restarts it. The new process registers
under a new instance id. Nothing re-registers in place and nothing keeps running sidelined.

The tombstone now records the eviction in full (migration 363): the evicting peer for a reap too (`evicted_by`; it was
recorded only for the standby handshake's fence before), and what the rule judged the instance by: its last heartbeat
(`last_heartbeat_at`) and its liveness window (`liveness_window_seconds`, `NULL` when its row recorded none and the
rule used 30 seconds). The exit's entry states all of it, and names what to check: heartbeat starvation (thread-pool
starvation, long garbage-collection or CPU-throttling pauses), database connectivity from the host, and long process
pauses around the last heartbeat.

| Behavior | Why | Verified by |
|---|---|---|
| A refused beat, startup or full, exits once with `ClusterEviction` (code 3). | Before, a refused heartbeat stopped the heartbeat loop and left the process running, out of the fleet, holding nothing and serving nothing, until someone restarted it by hand. Exiting hands that to the supervisor that already restarts failed processes. | {verified: HeartbeatWorkerStartupBeatTests.BeforeTheSchemaIsReady_ARefusedBeat_EndsTheLoopAsEvictedAsync, HeartbeatWorkerStartupBeatTests.OnceTheSchemaIsReady_ARefusedBeat_ExitsOnce_AsAClusterEvictionAsync, StartingInstanceHeartbeatE2ETests.AnInstanceEvictedWhileStarting_ExitsOnce_WithCodeThree_AndRecordsWhoEvictedItAsync, StartingInstanceHeartbeatE2ETests.AnInstanceEvictedWhileRunning_ExitsOnce_WithCodeThree_AndRecordsWhoEvictedItAsync} |
| A refused claim registration exits the same way; in a host without an exit path it is not a failure of the claim loop. | The claim is a third place the registry can refuse an evicted instance, and it must lead to the same exit. | {verified: ClaimWorkerLifecyclePhaseTests.ARefusedRegistration_ExitsAsAClusterEvictionAsync, ClaimWorkerLifecyclePhaseTests.ARefusedRegistration_InAHostWithoutAnExitPath_IsNotAFailureOfTheLoopAsync} |
| A stood-down instance whose beat is refused exits once. | A stood-down instance keeps beating to stay visible; an eviction ends that the same way it ends a running instance. | {verified: StartupStandDownTests.KeepVisible_WhenTheRegistryEvictedTheInstance_ExitsOnce_AsAClusterEvictionAsync} |
| The tombstone records the reaper, the last heartbeat and the window; a reap by any caller that is not a peer's heartbeat records no reaper. | The exit says who evicted the instance and on what evidence, so an operator can tell a starved instance from an unreachable one. | {verified: InstanceExitRecordSqlTests.APeersReap_RecordsTheReaper_AndTheHeartbeatAndWindowItJudgedAsync, InstanceExitRecordSqlTests.AReapByAnyOtherCaller_RecordsNoReaperAsync, DapperInstanceExitTests.APeersReap_RecordsTheReaper_AndTheHeartbeatAndWindowItJudgedAsync} |

A starting instance is no longer evicted for being slow to start: its heartbeat now starts when it registers (see
[the startup beat](startup-status#the-startup-beat)).

## A crash on any thread {#a-crash-on-any-thread}

When the host starts, the exit path subscribes to the process's own failure events (`IProcessCrashEvents`,
`ProcessCrashEvents.Instance` unless a test registers its own), once, and gives them back when its exit completes. An
exception nothing caught, on any thread, is a `Crash` (exit code 1) unless an exit is already under way, whose cause
stands. The crash exit:

1. halts through the run-control path, releasing roles and leases;
2. writes the `Crash` entry, with the exception;
3. records the durable row, best effort;
4. sets the exit code;
5. deregisters the instance (its leases and its row), which a graceful stop leaves to the shutdown service that a dying
   process never reaches.

All of it is bounded by `WhizbangInstanceExit.CrashExitBudget` (5 seconds) on the exit path's clock, as well as by the
token each step is given, so nothing it does can hold the dying process, throw into the runtime's handler, or exit
twice. A faulted task nobody observed is said at Error (EventId 2, `UnobservedTaskException`) and does not end the
process, since the runtime does not end it either.

| Behavior | Why | Verified by |
|---|---|---|
| The host start hooks the crash events once, and the exit gives them back; with no host start there is no hook. | A process-wide hook must not be added twice, nor left behind by a host that has exited. | {verified: WhizbangInstanceExitCrashTests.TheHostStart_SubscribesTheExitPathOnce_AndTheExitGivesTheEventsBackAsync, WhizbangInstanceExitCrashTests.NoHostStart_NoHook_AndAnExitWithoutOneUnhooksNothingAsync, WhizbangInstanceExitCrashTests.TheRegistration_HooksTheRegisteredCrashEvents_WhenTheHostStartsAsync, WhizbangInstanceExitCrashTests.TheProcessEvents_AreTheRuntimesOwnAsync} |
| A crash on any thread is a `Crash` exit, with its entry, row, halt and deregistration; something thrown that is not an exception, or a null, is still one. | Before, a crash on a thread the host did not own ended the process with no entry, no row and no release, so peers waited out every lease it held. | {verified: WhizbangInstanceExitCrashTests.ACrashOnAnyThread_IsACrashExit_WithItsEntryRowHaltAndDeregistrationAsync, WhizbangInstanceExitCrashTests.SomethingThrownThatIsNotAnException_IsStillACrashExitAsync, WhizbangInstanceExitCrashTests.ANullThrown_IsStillACrashExitAsync} |
| A crash during an exit already under way keeps that exit's cause and does not exit twice; a second crash deregisters nothing twice. | The first cause is the true one; a shutdown that crashes was still a shutdown. | {verified: WhizbangInstanceExitCrashTests.ACrashDuringAnExitAlreadyUnderWay_KeepsThatExitsCause_AndDoesNotExitTwiceAsync, WhizbangInstanceExitCrashTests.ASecondCrashAfterTheExit_DeregistersNothingTwiceAsync} |
| The crash exit is bounded by its budget and never throws into the runtime's handler. | The process is already dying; the exit may slow it by seconds, never hang it or replace the original failure with its own. | {verified: WhizbangInstanceExitCrashTests.AnExitThatNeverFinishes_DoesNotHoldTheDyingProcess_PastTheBudgetAsync, WhizbangInstanceExitCrashTests.NothingTheCrashExitDoes_Throws_IntoTheRuntimesHandlerAsync, WhizbangInstanceExitCrashTests.AClockThatFails_DoesNotLetTheCrashExitThrowAsync, WhizbangInstanceExitCrashTests.ACrashWithNoIdentity_OrNoCoordinator_StillExits_AndDeregistersNothingAsync} |
| An unobserved faulted task is said at Error and does not exit. | The runtime does not end the process for it, so neither does the exit path; saying it once keeps it from being invisible. | {verified: WhizbangInstanceExitCrashTests.AnUnobservedTaskException_IsSaid_AndDoesNotExitAsync, WhizbangInstanceExitCrashTests.AnUnobservedTaskException_ThatCannotBeSaid_DoesNotEscapeAsync} |

## Nothing else ends the process {#one-exit-path}

Library code can no longer stop the host or set the exit code anywhere but the exit path. `BannedSymbols.Exit.txt`
bans `IHostApplicationLifetime.StopApplication`, `Environment.Exit`, `Environment.ExitCode` and
`Environment.FailFast` in every library project, and a source guard, `InstanceExitSourceGuardTests`, fails on any call
the analyzer cannot see. Each message says what to use instead: `IWhizbangInstanceExit.RequestExit` with an
`ExitCause`. See [Gravity: one exit path](../../../contributors/gravity.md#exit-path-guard).
{verified: InstanceExitSourceGuardTests.NoLibraryCode_StopsTheHostOrSetsTheExitCode_OutsideTheOneExitPathAsync, InstanceExitSourceGuardTests.TheScan_FindsAnExitWrittenAnywhereElseAsync, InstanceExitSourceGuardTests.TheScan_IgnoresAnExitNamedInACommentAsync, InstanceExitSourceGuardTests.TheBannedSymbols_BanEveryExitApi_InLibraryProjectsAsync}

The ban covers library projects only. Your application owns its own process and may end it however it likes; to
take the library's exit path from application code, resolve `IWhizbangInstanceExit` and request an exit with a cause.

## Related

- [Managed-Resource Run-Control](../../resilience/managed-resource-run-control): the halt every exit takes
- [Instance Liveness](../../fundamentals/workers/instance-liveness): the rule that decides an eviction
- [Rolling Upgrades](rolling-upgrades): stand-down, which does not exit, and the committed migration, which does
- [The Startup Status Surface](startup-status): the instance row and the startup beat
