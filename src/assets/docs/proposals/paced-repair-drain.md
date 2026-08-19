---
title: Paced Repair Drain (Discovery/Dispatch Separation)
category: Architecture & Design
order: 28
tags: stream-integrity, repair, drain, backpressure, aimd, throttling, idle-filler, reconciliation, pacing, work-class
---

# Paced Repair Drain (Discovery/Dispatch Separation)

Stream-integrity repair today is **cadence-burst shaped**: repair requests are granted and
dispatched *inside* the audit's manifest compare, so an entire cycle's budget leaves the
process in seconds — then nothing for the rest of the interval. This proposal separates
**discovery** (audits compare and record deficits) from **dispatch** (a continuous drain
issues repair traffic at an adaptive rate), turning the repair ledger into what it already
almost is: a durable work queue, drained as fast as the transport actually allows — and no
faster.

:::planned
This is a proposed capability, motivated by live catch-up operations. It builds on the
delivered stream-integrity subsystem (deficit ledger, range-bounded redelivery, bulk
escalation, type rotation) and composes with the planned per-work-class run-permit
self-throttling.
:::

## The incident shape this prevents

A consumer fleet recovering from a long receive-side outage carried hundreds of thousands of
recorded deficits. Raising the per-audit repair budget (the only available throughput lever)
by 20× produced exactly what the shape predicts:

- **Request bursts saturated the broker namespace.** Every audit tick, each consumer fired
  its full budget of directed repair requests within seconds — plus manifests, drill-downs,
  and the origins' redelivery composites answering them. The namespace throttled
  (server-busy), and the *receive* side — the half that actually heals — starved behind
  retry loops. Requests flowed at thousands per hour while **zero redelivered events landed**.
- **The lever is a guess.** The budget that saturates one namespace tier idles another.
  Operators tune a constant against an invisible, moving ceiling, re-tuning as each
  service's audit phase drifts and as more consumers join the catch-up.
- **Between bursts, paid-for capacity goes unused.** A quiet namespace at minute 7 of a
  15-minute cycle serves nobody; the backlog waits for the next tick regardless.

The deeper defect is structural: **dispatch is welded to discovery cadence**. Audit
frequency is a *verification* concern; repair throughput is a *transport capacity* concern.
One knob serves both masters and serves neither.

## Design

### 1. The ledger is the queue

Every repair-eligible deficit already lives in the durable repair ledger with per-bucket
attempt counts and backoff state. Discovery (manifest compares, checkpoint gap detection)
becomes **record-only**: classify the bucket, write or refresh the ledger row, never send.
The compare's repair budget disappears entirely — compares get cheaper and their cost stops
scaling with repair volume.

**New at discovery: persist the compared window.** Range-bounded repair
(`FromCommitSequence`/`ToCommitSequence`) currently derives its bounds from the in-flight
manifest, which only exists during the compare. Ledger rows gain the window columns, stamped
at discovery, so a later dispatch asks for exactly the slice that disagreed. Rows recorded
before this change (or whose window is stale) fall back to deriving the window per origin
from the seal → settled-watermark pair — correct, just coarser.

### 2. The repair drain worker

A continuous worker drains eligible ledger rows — past backoff (a lane at the attempt cap is
not denied forever: it flattens to the ladder's terminal cadence, base × 2⁶, so a deficit whose
budget burned against a down origin still converges once the origin returns), not already in
flight — and issues the same directed, range-bounded requests the compare issues today,
including bulk escalation for threshold-crossing type deficits. Dispatch order:
least-recently-attempted first (the same fairness rule as drill-down rotation), so no lane
starves behind a hot one. The drain honors `IntegrityRepairMode`: `ReportOnly` silences it
entirely — it neither claims (a claim stamps an attempt) nor dispatches.

Rate control is a **token bucket**: requests spend tokens, tokens refill at the current
drain rate. The burst dies; the same 500 requests that left in five seconds now leave over
the whole interval — or faster, when the pipe is idle (see §4).

### 3. Adaptive rate (AIMD on transport feedback)

The transport's throttle-backoff policy already observes every server-busy response — it
just keeps the knowledge to itself. It gains a feedback seam (an event/callback the drain
subscribes to), and the drain rate becomes **AIMD**: a throttle observation multiplicatively
cuts the rate; each clean interval additively raises it, between a configured floor and
ceiling. The system finds the namespace's actual capacity on its own and re-finds it when
the ceiling moves — no operator constant, no tier-specific tuning, TCP's forty-year-old
answer to exactly this problem.

### 4. Idle filling (yield to foreground work)

Reconciliation is maintenance: it should consume **leftover** capacity, never compete with
business traffic. The drain rate is additionally gated by foreground pressure — the
outbox/inbox work depth the coordinator already tracks. Deep foreground queues squeeze the
drain toward its floor; an idle system lets AIMD climb toward the ceiling. This is the
planned per-work-class run-permit self-throttling meeting the repair path: reconciliation
becomes the canonical low-priority work class, and a catch-up that would have taken
tuned-guess days completes in whatever the quiet hours allow.

### 5. What replaces the budget knobs

`MaxAutoRepairRequestsPerAudit` stops governing dispatch (discovery no longer sends) and is
retired in favor of drain pacing options: initial/floor/ceiling rate, AIMD increments, and
the idle-gate thresholds. Attempt caps, per-bucket backoff, the repair mode, and bulk
thresholds keep their meanings — they gate *eligibility*, which stays exactly where it is:
in the ledger.

## Observability

The drain exposes: current rate (gauge), tokens available, requests dispatched (by origin
and source), throttle observations consumed, foreground-pressure gate state, and in-flight
count. Together with the existing repair/heal meters, the catch-up story becomes one
dashboard: eligible → dispatched → shipped → applied → healed, with the rate visibly
breathing against throttle and foreground load.

## Testing

- **Determinism**: the token bucket and AIMD run on `TimeProvider`; unit tests advance a
  fake clock — no wall-clock sleeps.
- **RED-first per increment**: discovery-records-but-never-sends; the drain dispatches
  eligible rows in fairness order with correct window bounds; a throttle observation halves
  the rate and a clean interval raises it; deep foreground queues squeeze the rate; bulk
  escalation flows through the drain; capped lanes hold the terminal cadence without starving
  their types (the delivered invariant, re-locked at the drain tier).
- **Integration**: fake transport injecting throttle responses proves the closed loop; the
  multi-service harness proves end-to-end heal under a constrained pipe.

## Build increments

1. **Window persistence + record-only discovery + fixed-rate drain (MVP).** ✅ BUILT —
   migration adds the ledger window columns, a discovery-time stamp, and an atomic
   SKIP-LOCKED claim mirroring the single-key grant ladder; the stream-level compare is
   discovery-only under the new default (legacy burst path behind a flag); the drain worker
   dispatches token-bucket-paced grouped range-bounded requests on `TimeProvider`. Ledger window
   columns stamped at discovery; compares stop sending; the drain worker dispatches at a
   configured constant rate. Already strictly better than budget-bursts.
2. **AIMD feedback.** The throttle-policy seam + multiplicative-decrease/additive-increase
   pacing with floor/ceiling.
3. **Idle gating.** Foreground work-depth modulation; converges with the run-permit
   work-class design.
4. **Bulk-through-drain + knob retirement.** Bulk asks dispatch via the drain's pacing;
   the per-audit budget is removed from the compare path and its options deprecated.

## Alternatives considered

- **Sub-batch pacing inside the compare** (spread the budget over the cycle from within the
  handler): smaller change, but dispatch stays welded to audit cadence — dead time between
  cycles persists, compares stay expensive and long-running, and the rate still can't adapt
  to the transport. Rejected as the destination; increment 1 subsumes its benefit.
- **Raise the namespace tier**: real money to avoid a self-tuning problem the software can
  solve; and the burst shape simply saturates the next ceiling during a large enough
  catch-up.
- **Status quo (per-audit budgets)**: the incident. A constant cannot track a moving
  ceiling, and bursts starve the very receive path healing depends on.
