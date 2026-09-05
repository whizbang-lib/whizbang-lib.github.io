---
title: Canary Recovery — Held Cohorts, Probes, and Verdicts
pageType: concept
verifiedAgainstCommit: 13e9de48cac47ad3753719a70db9fe591c106257
verifiedDate: 2026-09-03
version: 1.0.0
category: Dead Letter Queue
order: 6
description: >-
  How a mass of held dead letters comes back after a fix: an operator sets one flag and
  restarts, the campaign probes a stratified sample of each fingerprint cohort, and a
  cohort releases only when its probes recover — staggered eligibility drained by the
  normal paced scans, with Mixed verdicts reported for operator review instead of
  auto-released.
tags: >-
  dead-letter, canary, cohort, fingerprint, probes, verdict, held, retry-on-startup,
  release, stagger, campaign
codeReferences:
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
  - src/Whizbang.Core/Messaging/IDeadLetterRecoveryService.cs
  - src/Whizbang.Data.Postgres/Migrations/127_DlqCanaryCampaigns.sql
---

# Canary Recovery

A mass dead-letter event ends with rows in **HeldForReview**: their recovery budgets are
spent, and re-driving them blindly would replay the failure at full volume. But held rows
are evidence about an old build — when a deploy fixes the bug, thousands of rows are
suddenly recoverable and nobody wants to release them one operator click at a time.

Canary recovery is the bridge: **probe a few, release the cohort only when the probes
prove the fix.**

## The operator lever

```
Whizbang__DeadLetterRecovery__RetryHeldOnStartup=Canary   # or Full
```

Set it, restart the service. On startup (after generation replay) the worker runs the
campaign; the flag binds turnkey from configuration. `Off` is the default — held rows
are an operator decision until an operator makes one.

| Mode | Behavior |
|------|----------|
| `Off` | Held rows stay held (default) |
| `Canary` | Probe each cohort; release only cohorts whose probes all recover |
| `Full` | Release every cohort without probing — a trust shortcut, **never** a pacing shortcut |

## The campaign, step by step

1. **Grandfather gate.** Held rows whose envelope is not a re-drivable JSON object can
   never be recovered by anything — they are marked PermanentlyFailed (visible in the
   operator ledger, never silently skipped). Campaigns operate only on rows the machinery
   can actually re-drive.
2. **Cohorts.** Held rows group by `error_fingerprint` — one campaign unit per failure
   shape. Operator dispositions (`HoldIndefinitely`, `MarkPermanentlyFailed`) are never
   campaign material.
3. **Probes.** `CanaryProbeSize` rows (default 10) per cohort, **stratified across the
   cohort's message types** — a cohort can span dozens of types (34 observed in the
   incident that motivated this design), and an all-one-type probe set would hide a split.
   Probes simply return to Pending due-now; the **normal paced scans re-drive them** under
   housekeeping arbitration. Campaigns never bypass pacing.
4. **Verdict.** Evaluated on the scan cadence. A probe that recovered and stayed recovered
   succeeded. A probe whose message **dead-lettered again** after the campaign started
   failed — the round trip is the evidence, and coming back is the failure. Probes still
   in flight keep the verdict `Pending`; a verdict from silence would be a verdict from
   no evidence.
5. **Release.** `Pass` releases the cohort as **staggered eligibility**: rows return to
   Pending with `next_recovery_at` spread across `ReleaseStaggerMinutes` (default 30),
   and the paced scans drain them. `Fail` keeps the cohort held — the bug is still live.
   `Mixed` (some probes recovered, some did not) keeps the cohort held and **reports the
   split**: the cohort likely spans more than one real failure, and auto-releasing would
   re-drive the failing part at full volume.

## Deploys re-test the hypothesis automatically

Attempt counts are evidence about a **build**. When a new build generation is detected at
startup (generation replay found rows from an older build), the campaign runs in Canary
mode automatically even with the flag `Off` — a deploy that fixed the bug self-heals its
cohorts at probe cost. `AutoCanaryOnNewGeneration=false` opts out; an explicit operator
mode always wins. Two boundaries keep this honest:

- **`GenerationBudget`** (default 3): a cohort whose campaigns have *failed* on that many
  distinct generations stops being probed automatically — permanently pending an operator
  decision, said loudly in the log.
- **Observation windows scope to the generation**: a probed message sitting at the
  redelivery observation bound gets a fresh window (same bound) — otherwise its first
  probe redelivery would re-cross the bound and auto-fail, silently excluding exactly the
  poison-quarantine class from recovery.

Failed individual recoveries also back off **exponentially** (policy cooldown × 2^attempts,
capped at 24 hours) instead of metronomically.

## Mixed cohorts: trickle release

A `Mixed` verdict no longer parks the cohort outright — it earns trust in doublings:

1. A probe-sized first wave releases immediately (staggered, like everything else).
2. Each **clean** wave (no new dead letters with the cohort's fingerprint since the wave
   started) doubles the next.
3. Any **washback** halts the trickle: the remainder stays held, the halt is logged at
   Warning with the wave number and washback count, and the cohort is pending an operator.
4. An **empty** wave means the cohort fully drained through clean waves — campaign closed.

Every wave lands on `whizbang.dead_letters.release_waves{cohort, outcome=clean|halted}`.

## Operator endpoints

- `GET /whizbang/dlq/cohorts` — held cohorts (fingerprint, row count, message-type spread):
  the campaign overview.
- `POST /whizbang/dlq/cohorts/{fingerprint}/release?staggerMinutes=30` — releases a cohort
  through the **same staggered-eligibility path** the campaigns use. There is no firehose
  endpoint, by design.

## Stack history — trends that outlive the dead letters

Every recorded stack also increments a **rolling daily log** (`wh_stack_daily`: one row per
stack per day) and bumps `wh_stacks.last_seen`. This is what answers "which failure shapes
are trending over time" **after** the underlying dead letters are purged or archived — the
occurrence timeline is decoupled from DLQ retention. Growth is bounded (a storm is a handful
of stacks, not a row per event).

The recovery worker prunes the log on its idle-gated scan:

- `StackHistoryRetentionDays` (default **90**) — daily rows older than this are pruned.
- A **non-positive** value **disables the rolling cleanup**: the log is kept forever, and
  the worker makes no prune round trip at all.

`first_seen`, `last_seen`, and a running `total_occurrences` on `wh_stacks` are the cheap
always-there summary (how-many / first / last in one row-read); the daily table is the
distribution. The backfill records a whole batch of stacks in **one** round trip, and each
prune pass is counted on `whizbang.dead_letters.stack_history_pruned` (and the
`whizbang.housekeeping.items{activity=Maintenance}` volume rollup) so the cleanup is a
visible maintenance facet, not just a log line.

## Restart safety

The campaign record (`wh_dlq_probe_campaigns`, one row per fingerprint x build
generation) is durable. A pod restarting mid-campaign resumes evaluating the existing
probes — starting a campaign is idempotent per generation and never mints a second probe
set.

## Configuration

| Key (under `Whizbang:DeadLetterRecovery`) | Default | Meaning |
|---|---|---|
| `RetryHeldOnStartup` | `Off` | `Off` / `Canary` / `Full` |
| `CanaryProbeSize` | `10` | Probe rows per cohort; also the first trickle wave size |
| `ReleaseStaggerMinutes` | `30` | Window a release is spread across |
| `AutoCanaryOnNewGeneration` | `true` | New build generation auto-canaries held cohorts; an explicit mode wins |
| `GenerationBudget` | `3` | Distinct generations whose campaigns may FAIL before a cohort is permanently pending operator |
| `StackBackfillBatchSize` | `500` | Dead letters normalized into the stack layer per scan; `0` disables |

## Reading the logs

Campaign lines carry the fingerprint throughout: probes started (with cohort size and
type count), cohort released (with row count and whether canary-pass or full), campaign
failed, and — at Warning — the Mixed split with its succeeded/failed counts, because a
Mixed verdict nobody hears about is a cohort parked silently.
