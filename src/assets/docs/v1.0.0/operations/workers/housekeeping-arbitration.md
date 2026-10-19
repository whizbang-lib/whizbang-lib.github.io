---
title: Housekeeping Arbitration — Ranks, Idle Gating, and the Starvation Floor
pageType: concept
verifiedAgainstCommit: 04fcb537e7397619eac5b6dbf5da102e2b17e19a
verifiedDate: 2026-09-03
version: 1.0.0
category: Workers
order: 6
description: >-
  How dead-letter recovery, integrity work, and maintenance sweeps share one
  service without racing each other or degrading live traffic: the rank order,
  the settledness gate and what counts as busy, the bounded-deferral escape
  that prevents permanent starvation, and the decisions/running/items metrics
  that make every verdict a dashboard fact.
tags: >-
  housekeeping, arbitration, dead-letter-recovery, maintenance, integrity,
  idle, settledness, deferral, wait-for-idle, starvation, observability
codeReferences:
  - src/Whizbang.Core/Workers/HousekeepingCoordinator.cs
  - src/Whizbang.Core/Workers/HousekeepingSettingsValidator.cs
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Observability/HousekeepingMetrics.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/HousekeepingCoordinatorTests.cs
  - tests/Whizbang.Core.Tests/Workers/HousekeepingCooldownTests.cs
  - tests/Whizbang.Core.Tests/Workers/HousekeepingDeferralCeilingTests.cs
---

# Housekeeping Arbitration

Three background activities want the same quiet moments: dead-letter recovery re-drives parked
messages, integrity work verifies and repairs streams, and maintenance sweeps reclaim space.
Left uncoordinated they race each other and the live workload — a recovery pass in the middle
of a drain puts its re-driven messages straight back onto the queues it is competing with,
which is how a recovery becomes a second storm.

The `HousekeepingCoordinator` arbitrates. Every activity asks permission before running
(`TryBegin`), receives a verdict, and reports completion (`End`). One coordinator per service;
every verdict is counted on the `Whizbang.Housekeeping` meter.

## The rank order

Activities yield only to a **strictly higher** rank:

| rank | activity | why it wins |
|------|----------|-------------|
| 0 | Dead-letter recovery | The DLQ frequently holds the very messages integrity would detect as gaps and ask an origin to redeliver over the wire — healing locally removes the reason to ask |
| 1 | Integrity | Correctness before tidiness |
| 2 | Maintenance | Space reclamation waits for everyone |

Equal ranks never overlap themselves (`AlreadyRunning`), and a lower rank starting while a
higher one runs is refused (`HigherPriorityRunning`).

## The settledness gate

Recovery and maintenance are gated on **service settledness**: the store's own backlog counts
(unprocessed inbox rows, active leases, oldest-row age), measured by the same eligibility
predicate the claim path uses. Rows parked with a future `scheduled_for` — operator
quarantine, tag-bound coalescing — are deliberately not claimable, so they are not busy-ness:
counting them once held recovery and maintenance on `ServiceBusy` for a day against a service
that was genuinely idle.

A gate that cannot measure must not silently disable what it gates: when the backend reports
no backlog measurement at all, the activity proceeds with the distinct `ProceedUnmeasured`
verdict rather than waiting on evidence that will never arrive.

Integrity is not settledness-gated here — its checkpoint path applies its own admission
policy, which distinguishes a lagging consumer from a genuine deficit.

## The starvation floor

A service with a permanent trickle of inbound work never reads settled at the instant a scan
fires. Without a floor, its dead letters defer forever — observed in production as 20,000 due
rows behind a rule working exactly as written, on a service whose backlog never once touched
zero.

Both gated activities therefore carry a **bounded-deferral escape**: once `MaxDeferral` (default
one hour) has passed since an activity's first deferral, its next request forces one pass through
anyway. The ceiling is a time, not a count of ticks, so it stays put when an operator shortens or
lengthens a scan interval. The forced pass is reported as `ProceedDeferralLimit`, distinct from
`Proceed`, so a dashboard can tell "ran because idle" from "ran because it was never idle once all
hour". The window re-arms when a pass completes, making the escape a bounded trickle under
sustained load, never an open gate. The windows are per activity: recovery's deferrals cannot open
maintenance's escape, and each measures from its own first deferral.

### Tick, idle gate, and forced ceiling

Three settings decide when maintenance runs, and they answer different questions:

| setting | default | question it answers |
|---------|---------|---------------------|
| `Whizbang:Workers:Maintenance:IntervalMinutes` (the tick) | `10` | How often the sweep asks to run |
| `Whizbang:Housekeeping:SettledCooldown` (the idle gate) | `00:02:00` | How long the service must read settled, without a break, before an ask is granted |
| `Whizbang:Housekeeping:MaxDeferral` (the forced ceiling) | `01:00:00` | The longest asks can keep being refused before one is granted anyway |

The forced pass lands on the first tick at or after the ceiling, so the actual wait is at most
`MaxDeferral` plus one tick. Dead-letter recovery asks on its own tick
(`Whizbang:DeadLetterRecovery:ScanIntervalMinutes`) and shares the same idle gate and ceiling.

### Precedence over the legacy count

Before `MaxDeferral`, the ceiling was `MaxConsecutiveDeferrals` (default 6) deferred asks, which made
the real limit the count times the tick. The count still works, with this precedence:

1. `MaxDeferral` is configured: the time governs, and the count is ignored.
2. Only `MaxConsecutiveDeferrals` is configured: the legacy count governs, unchanged.
3. Neither is configured: the default one-hour time ceiling governs.

At the default 10-minute tick, the default hour forces the same seventh ask the default count did,
so a host that configured neither sees no change until it changes the tick.

## Recovery's own opt-down

`DeadLetterRecoveryOptions.WaitForIdle` (default `true`) is what enrolls recovery in the
arbitration. Setting it `false` restores the legacy anytime-runner: no settledness gate, and
no slot held — it never defers integrity or maintenance either. The safety mechanisms that are
not scheduling — the loop breaker, redelivery observation accounting, poison detection — apply
in both modes.

## Configuration

Bound turnkey from configuration (no host code; hosts without `IConfiguration` keep code
defaults):

| section | key | default | meaning |
|---------|-----|---------|---------|
| `Whizbang:Housekeeping` | `MaxDeferral` | `01:00:00` | Longest time an activity can be deferred before a forced pass; the starvation floor for recovery and maintenance alike. Must be positive |
| `Whizbang:Housekeeping` | `SettledCooldown` | `00:02:00` | How long the service must read settled continuously before a pass is admitted |
| `Whizbang:Housekeeping` | `MaxConsecutiveDeferrals` | `6` | Legacy fallback, used only when set and `MaxDeferral` is not: busy verdicts tolerated before a forced pass |
| `Whizbang:DeadLetterRecovery` | `WaitForIdle` | `true` | Enrolls recovery in the arbitration at the highest rank |

## Observability

Everything above is a dashboard fact on the `Whizbang.Housekeeping` meter:

| instrument | tags | reads as |
|------------|------|----------|
| `whizbang.housekeeping.decisions` | `activity`, `verdict` | Every arbitration answer: `Proceed`, `ProceedUnmeasured`, `ProceedDeferralLimit`, `ServiceBusy`, `AlreadyRunning`, `HigherPriorityRunning` |
| `whizbang.housekeeping.running` | `activity` | Which activity holds the slot right now |
| `whizbang.housekeeping.items` | `activity` | Volume rollup: rows recovered, swept, or repaired per activity |
| `whizbang.idle.seconds_since_activity` | `last_source` | The idle signal the gate ultimately protects |

A healthy service under load shows `ServiceBusy` deferrals punctuated by `Proceed` grants in
idle windows; a permanently busy one shows the periodic `ProceedDeferralLimit` heartbeat, one per `MaxDeferral` after
the first deferral. A
`decisions` stream that is entirely absent means the coordinator is not the metered one — a
wiring defect, not quiet.
