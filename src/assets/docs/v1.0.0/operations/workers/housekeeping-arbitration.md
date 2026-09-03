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
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Observability/HousekeepingMetrics.cs
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

Both gated activities therefore carry a **bounded-deferral escape**: after
`MaxConsecutiveDeferrals` consecutive busy verdicts (default 6 — roughly an hour at the
10-minute scan cadence), one pass forces through anyway. The forced pass is reported as
`ProceedDeferralLimit`, distinct from `Proceed`, so a dashboard can tell "ran because idle"
from "ran because it was never idle once all hour". The budget re-arms when the forced pass
completes, making the escape a bounded trickle under sustained load, never an open gate. The
counters are per-activity: recovery's spent deferrals cannot open maintenance's escape.

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
| `Whizbang:Housekeeping` | `MaxConsecutiveDeferrals` | `6` | Busy verdicts tolerated before a forced pass; the starvation floor for recovery and maintenance alike |
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
idle windows; a permanently busy one shows the periodic `ProceedDeferralLimit` heartbeat. A
`decisions` stream that is entirely absent means the coordinator is not the metered one — a
wiring defect, not quiet.
