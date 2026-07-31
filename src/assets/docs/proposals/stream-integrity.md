---
title: Stream Integrity (Cross-Service Anti-Entropy & Repair)
category: Architecture & Design
order: 28
tags: stream-integrity, anti-entropy, re-delivery, backfill, digest, manifest, continuity, checkpoint, repair, cross-service, bootstrap
---

# Stream Integrity (Cross-Service Anti-Entropy & Repair)

Whizbang's cross-service delivery is **store-and-forward**: an origin service persists an event, the
outbox publishes it to a topic, and each consuming service stores its own copy and projects its own
read models. The design is deliberately decoupled — there is no shared log, no consumer cursor over
the origin's store — which means there is also **no built-in answer to the question "did every
consumer actually get everything?"**

In practice, divergence happens. A real (generalized) incident that motivated this proposal: a
consumer service went through a window in which composite events arrived but their **inner events
were silently dropped** at the receive boundary (an unrelated storage defect zeroed the flags the
fan-out keyed on). The origin's store was complete; the consumer's copy was missing thousands of
events; nothing errored anywhere. The gap surfaced **weeks later** when a person noticed two UI
counts disagreeing — and the only repair available was bespoke, app-level re-ingestion.

This proposal makes stream integrity a **first-class, self-healing framework capability**:
detect divergence in bounded time, name it precisely, and repair it idempotently — the same
philosophy the migration-ledger redefinition closure applies to schema, applied to data.

---

## Goals

1. **Repair** — an origin can re-deliver any subset of its persisted events to the wire, and
   consumers converge idempotently, with no bespoke application code.
2. **Fast detection** — a consumer discovers *missing subscribed events* in minutes, not weeks.
3. **Deep audit** — a scheduled cycle proves consumer copies complete against the origin
   (existence-level), with drill-down that names exactly which streams/events differ.
4. **Backfill as a feature, not an accident** — a service that *grows* its consumption (a new
   perspective; a perspective adding an event type; an entirely new consumer service) gets the
   history it now needs, automatically.
5. **Local coverage** — a perspective whose coverage starts later than the history it should fold
   (born after the events) is detected and rebuilt locally.
6. All of it **configurable with safe defaults**, observable, AOT-clean, and off the hot path.

## Non-goals (with rationale)

- **Payload/body verification.** Digests cover event *identity* (existence), not payload bytes.
  Payloads legitimately differ across services (envelope metadata, serialization shape) and must
  survive crypto-shredding; content verification is a separable follow-up that can ride the
  fingerprint subsystem's optional per-event body hash.
- **Tamper-evidence.** A forward-only hash *chain* proves an untampered prefix, but breaks on
  out-of-order arrival and on Whizbang's deliberate deletions (ephemeral reap, close-stream
  truncation, pointer pruning). Integrity between trusted services needs an order-independent,
  removable digest instead (see below). Audit-grade tamper-evidence is a different threat model
  and a different feature.
- **Pull-based consumer cursors over the origin's store** (the KurrentDB/Debezium shape). It makes
  gaps impossible by construction but inverts Whizbang's delivery architecture: origins would serve
  their event stores to consumers, coupling availability and databases. Rejected for Whizbang.
- **Read-model *content* verification.** Perspectives are locally rebuildable projections; if the
  local event copy is right and coverage is right, rebuild reproduces content. We verify the two
  preconditions, not projected values.

---

## The divergence taxonomy

| # | Scenario | Local store state | Detection | Repair |
|---|---|---|---|---|
| 1 | Subscribed events dropped in flight (the incident class) | Missing rows | Continuity checkpoints (fast) / digest audit (deep) | Origin re-delivery → conflict-skip + inversion-rewind convergence |
| 2 | Consumer corruption/loss after receipt (bad restore, data loss) | Missing rows | Digest audit | Same re-delivery |
| 3 | New perspective over event types the service **already stores** | Complete | Local coverage audit (perspective born after history) | **Local rebuild** — no cross-service traffic |
| 4 | Perspective adds an event type the service **never subscribed to** (or a brand-new consumer service) | Missing that type's history entirely | Startup reconciler detects the consumption-set growth (proactive); digest audit is the safety net | Subscription-expansion backfill (re-delivery scoped to the new types) → local rebuild |
| 5 | Consumer has **extras** the origin lacks | Extra rows | Digest audit (set difference is bidirectional) | Policy: extras below the origin's close/archival floor are legitimate; extras above it are surfaced for investigation, never auto-deleted |
| 6 | Events present but a projection missed applying them | Complete | Local cursor-coverage audit | Local rewind/rebuild via existing machinery |

The repair primitive is one mechanism with four consumers: incident repair (1, 2), new-perspective
coverage (3), subscription growth / consumer bootstrap (4), and scheduled-audit remediation.

---

## Ephemeral and temporal traffic (wire-covered, window-matched)

Ephemeral events and schedule occurrences cross the wire like any event, and both are protected —
each phase applies where the payload's *lifetime* makes protection meaningful, rather than blanket
inclusion or blanket exclusion.

**Ephemeral events** are included in **continuity checkpoints by default**. A dropped ephemeral
delivery is detected within a checkpoint interval — inside the rewind **grace window**, while the
origin still retains the body — so repair is **grace-bounded best-effort**: standard re-delivery
while the origin's copy lives, and on a confirmed gap the origin may place a **destruction hold**
(the existing destruction-hold mechanism) on the gap's events until re-delivery completes, so
prompt detection actively extends repairability instead of racing the reaper. Once genuinely
reaped, the gap is reported as *accepted ephemeral loss* — the same acceptance the out-of-grace
rewind already makes. The **deep audit excludes ephemeral by mode** — a tautology, not a gap:
digests cannot converge across sovereign purge lifecycles, and ephemeral has no deep history to
audit; its entire integrity window *is* the grace window, which the checkpoint phase owns.
**Backfill** likewise excludes ephemeral types (nothing is retained to deliver; ephemeral state is
now-scoped by design).

**Schedule occurrences** are ordinary persisted events on the wire: checkpoints detect their drops
and re-delivery repairs them. Refinements:

- **At-least-once occurrences are fully repairable** — deterministic occurrence ids make
  re-delivery idempotent by contract, and a recently dropped occurrence is a job the consumer was
  supposed to run and still should.
- **At-most-once occurrences are detect-and-report only** — re-delivery would violate the exact
  guarantee they were declared for. The re-delivery selection filters on the occurrence's
  `deliveryGuarantee` metadata.
- **Old occurrence gaps are report-only past a window** (`RepairOccurrenceGapsNoOlderThan`,
  default = the checkpoint confirmation horizon): whether a *late* fire is wanted is per-schedule
  taste already expressed by the temporal engine's misfire policy, and integrity does not override
  it.
- **Backfill never manufactures occurrence history for a subscription that did not exist when the
  occurrences fired** (`IncludeScheduleOccurrencesInBackfill = false`, per-type opt-in). The
  governing line: **repair delivers what a live subscriber missed; backfill builds state — and
  never re-fires triggers.**

Schedule **definitions** (`wh_schedules`) are service-local durable configuration, outside stream
integrity entirely: missed fires at the origin are governed solely by the temporal engine's
misfire policy (coalesce / catch-up / skip, with burst caps) — integrity adds no second mechanism
that could fight it. Commands and composite envelopes remain structurally out of scope (never
persisted); composite *inner* events are ordinary facts and fully in scope.

---

## Design

### Phase R1 — the re-delivery primitive (everything else depends on it)

`IWorkCoordinator.RedeliverAsync(RedeliveryRequest)` on the **origin**: select persisted events by
(tenant scope, event types, stream ids, commit-sequence range), re-enqueue them through the normal
outbox → topic path, rate-capped (`MaxEventsPerCycle`, `MaxBatchesPerSecond`). The events go to the
same topics as the original publish; every consumer sees them.

**Convergence needs no new consumer code** — it composes from delivery semantics that already exist:

- An event the consumer **already has** hits the event-id conflict skip at the store seam: no row,
  no work items, zero perspective churn. Re-delivery is free where nothing is wrong.
- An event the consumer **was missing** appends normally and generates perspective work. Because it
  is *older* than the perspective's cursor, the **cursor-inversion detector** fires and the rewind
  path replays the stream from its snapshot/anchor with the now-complete event set. Late history
  folds in correctly because the pipeline already knows what late history means.

**Re-delivery rides composites.** A repair set is "many events for one stream" — the composite
decision-table row, with its measured bulk-transport win. The redelivery pump bundles each
stream's ordered repair slice into a framework `RedeliveryComposite` (`Independent` atomicity —
one poison inner event must not dead-letter a stream's whole repair; the next cycle re-detects any
remainder) and publishes it **wire-only** (the origin already holds these events; no local
re-processing). Inner events are the original envelopes — original ids, original continuity
sequences — so identity and gap-tracking are preserved; the `redelivery` marker rides the
composite and its fanout children. Ordering by stream version makes damaged streams append-only
composites and wholly-missing streams (bootstrap) naturally init-first. `MaxInnerEventsAllowed`
and the rate caps double as the chunker. One honest note: repair thereby uses the same fan-out
machinery whose (storage-defect-induced) failure motivated this proposal — acceptable because
**repair traffic is itself integrity-checked**: re-delivered events carry original sequences, so
a dropped repair re-alarms at the next checkpoint instead of silently "completing."

**Targeted re-delivery.** Repair sets are computed per (consumer, origin) pair, so the traffic is
inherently addressed to one service — a `redelivery-target` transport property (the *logical
service identity* that names the target's subscription, never an instance id) makes the address
explicit. Non-target consumers discard at the receive seam before deserialization or fan-out
(the same boundary discipline as unsubscribed-message discard, one property compare); transports
with native subscription filtering (e.g. `target IS NULL OR target = @me` rules, wired through the
infrastructure-provisioner seam and advertised via transport capabilities) filter broker-side so
non-targets never receive the message at all. An **absent** target remains meaningful: broadcast
re-delivery for operator-initiated origin-wide repairs. A mis-targeted repair is benign — the
service that needed it discards it, the gap persists, and the next checkpoint re-alarms.
*Considered and rejected:* opportunistic acceptance by non-targets that coincidentally share the
gap — it reinstates the broadcast cost for everyone to serve a rare coincidence that the
coincident consumer's own detection loop repairs anyway; strict discard keeps the cost model
predictable.

A request/response wrapper (`RequestRedeliveryCommand` on the wire, origin-routed) lets any
consumer ask an origin for re-delivery without out-of-band coordination — the request carries the
requester's service identity, which becomes the re-delivery target.

### Phase B — continuity checkpoints (fast drop detection)

The origin stamps a monotone **per (origin service, tenant, event type) sequence** on each published
event, and periodically emits a lightweight **checkpoint signal** ("type T in tenant X is at
sequence N"). Consumers verify contiguity for the types they subscribe to — TCP-SACK-style state:
highest-contiguous plus a bounded gap list.

- Detects the incident class **at receive time / within one checkpoint interval**, not at the next
  nightly audit.
- Near-zero cost: one counter update folded into the existing outbox emit; checkpoints are doorbell-
  sized control messages.
- Subscription subsets are handled by construction — the sequence is per *type*, so a consumer only
  checks types it consumes.
- A confirmed gap raises a typed integrity event (report), and — when auto-repair is enabled —
  issues a scoped `RequestRedeliveryCommand` for the gap.

Ephemeral types are **included** here by default — for a self-destructing event the checkpoint
window is the only integrity window there is (see *Ephemeral and temporal traffic*).

What it cannot see: loss *after* successful receipt (case 2) and anything historical. That is the
deep audit's job.

### Phase S — subscription-expansion backfill (startup, on by default)

The startup type-definition reconciler already diffs each service's catalog against its persisted
registration. It gains one comparison: **the consumed-type set**. When a deploy grows it (new
perspective; perspective adds a type; first boot of a new consumer), the reconciler records the
expansion (with the fingerprint lineage carrying the *birth* moment), requests re-delivery of the
new types' history from their origins, and schedules the local rebuild that folds it into the new
projection once delivery completes.

This turns "we added a perspective over old events" and "we stood up a new consumer service" from
runbook procedures into a deploy-time non-event. Configurable, **on by default**
(`StreamIntegrityOptions.BackfillOnSubscriptionGrowth = true`); disabling leaves the expansion
*recorded* so the audit reports it as pending rather than screaming divergence.

### Phase A — digest manifests (the scheduled deep audit)

**Digest algebra.** The atomic unit is an order-independent **set hash** per
**(tenant, event type, stream)**: the XOR (or 128-bit additive) fold of `H(event_id)` over the
bucket's events. Properties that fit Whizbang's real lifecycle:

- **O(1) add** on append and — critically — **O(1) remove** on deletion: the ephemeral reaper,
  `close_stream` truncation, and pointer pruning subtract the same hashes in the same transaction.
  (A forward-only chain hash fails here: it cannot unhash a removed element and it breaks on
  out-of-order arrival, forcing recomputes exactly where Whizbang reorders and deletes by design.)
- **Arrival-order independence** — consumers fold in receive order, origins in commit order, same
  digest.
- Identity-only hashing survives crypto-shredding and serialization differences.

Rollups: per (tenant, type) and per (tenant, stream) digests derive from the atomic buckets, giving
a two/three-level drill-down — mismatch at type level → compare that type's stream digests →
mismatched stream → exchange its event-id list (streams are short by design; a set-reconciliation
encoding à la IBLT is a v2 optimization) → the difference IS the repair set.

**Maintenance strategy.** Digests are maintained **incrementally, transactionally, at batch
granularity** inside the existing emit chain: one digest upsert per distinct (tenant, type) in the
batch — not per event — so bulk imports do not serialize on a hot digest row. Deletion paths
subtract in their own transactions. Because incremental state can rot (the hard-won lesson of
Cassandra's incremental repair), a low-frequency **self-verification** recomputes a sample of
buckets from the store and alarms on drift between the digest table and reality.

**Comparison protocol.**

- Manifests are **watermarked**: "complete up to origin commit sequence ≤ N / older than T − grace",
  so in-flight events never read as divergence. A mismatch alarms only after persisting across
  **two consecutive cycles**.
- Scope is **pair-relative and catalog-anchored**: the comparison covers the intersection of the
  origin's published types and the consumer's consumed types, referenced by type-definition ids
  from the fingerprint subsystem, so both sides provably compare the same universe even across
  deploys and reclassifications.
- **Expected vs unexpected missing:** history older than a subscription's recorded birth (Phase S
  lineage) is *pending-backfill* (informational, auto-resolvable) — not an integrity violation. An
  audit that cries wolf on every deploy trains everyone to ignore it; this discriminator is what
  keeps the alarms meaningful.
- **Lifecycle floors:** ephemeral types are excluded by mode (see *Ephemeral and temporal
  traffic* — the checkpoint phase owns their window); each stream's comparison floor is the
  origin's close/archival point, so closing-the-books truncation never reads as loss.

**Message economics (chatter scales with divergence, not data).** Per (consumer, origin) pair per
audit cycle, the healthy path is **two messages**: one manifest request, one sparse top-level
response (per-(tenant, type) digests, ~60 bytes per non-empty bucket; claim-check offload past the
size threshold). The consumer diffs locally against its own digest table — a match ends the cycle.
Origins serve manifests from the maintained digest table (a rollup `SELECT`, never a store scan)
and may cache the watermarked answer per cycle for multi-consumer fan-in. Drill-down is **one
batched round-trip per level, never per bucket**: all mismatched (tenant, type) buckets in one
stream-level exchange, all mismatched streams in one id-level exchange — so even a messy
divergence costs ~6–8 control messages plus the repair payload itself. The steady-state hum
belongs to Phase B's checkpoints (one doorbell-sized ephemeral event per origin per interval),
tunable as emit-on-publish with a slow max-idle heartbeat — never fully silent, because
checkpoint absence is the transport-liveness alarm.

### Phase L — local perspective-coverage audit

Entirely local, no manifest exchange: verify per (stream, perspective) that cursor coverage reaches
the stream head and that the perspective's birth does not postdate history it should have folded
(case 3/6). Remediation is the existing targeted rebuild — the same non-destructive
"find only the broken streams and replay just those" shape proven by prior consumer-side repairs.

---

## Scheduling, startup, and the repair policy ladder

**Scheduling dogfoods the temporal engine.** The deep audit and the local audit are recurring
`ScheduleDefinition`s (default: daily). The **pre-fire hook** supplies the idle-or-force semantics
requested: at fire time it checks work-pump depth and defers while the service is busy — but a
configurable **grace deadline** (default: weekly) forces the run regardless. Continuity checkpoints
are continuous (default interval 60s). Everything is standard options-pattern configuration:

```csharp
services.Configure<StreamIntegrityOptions>(o => {
  o.Enabled = true;                          // master switch — ON by default
  o.ReconcileOnStartup = true;               // Phase S + registration checks at boot — ON by default
  o.BackfillOnSubscriptionGrowth = true;     // Phase S action (detection is always recorded)
  o.CheckpointInterval = TimeSpan.FromSeconds(60);
  o.DeepAuditSchedule = "0 3 * * *";         // daily, idle-preferred via pre-fire hook
  o.DeepAuditForceAfter = TimeSpan.FromDays(7);
  o.RepairMode = RepairMode.ReportOnly;      // ladder: ReportOnly → AutoRepairCapped → (dry-run available)
  o.MaxRedeliveryEventsPerCycle = 50_000;    // storm caps, always enforced
});
```

**Startup activity is configurable and on by default** — the boot-time reconciler work (consumption-
set diff, pending-backfill registration, digest-table presence checks) runs unless explicitly
disabled, mirroring the detect-by-default / act-by-opt-in convention — except that Phase S's *act*
defaults on too, because its action is additive and idempotent (delivering history a service has
declared it needs).

**Repair is a ladder, not a reflex.** `ReportOnly` is the default release posture: typed integrity
events + metrics + a health signal, no writes. `AutoRepairCapped` opts into scoped re-delivery with
hard rate caps and a dry-run mode that logs the exact repair set without sending. The industry
lesson (repair storms taking down clusters that were merely *suspected* of divergence) is encoded
as: caps always on, auto-repair never default, every repair loudly attributed.

---

## Standards compliance (definition of done)

- **AOT / zero reflection.** Type sets, consumed-type derivations, and digest scopes come from the
  generated message-type catalog and the fingerprint registries — no runtime reflection anywhere.
  Digest arithmetic is SQL + plain code; new metadata rides existing generated carriers.
- **Strict TDD (red → green).** Every increment starts with a failing test failing for the right
  reason — including the SQL (digest add/remove/recompute parity) and the reconciler diffs.
- **True multi-service integration tests.** The multi-service harness (in-memory wire transport,
  per-service catalogs) is the proving ground: *inject a drop* at one consumer (the harness can
  suppress delivery of selected inner events), then assert detection (checkpoint gap; digest
  mismatch naming the exact stream) and repair (re-delivery → conflict-skip on the healthy
  consumer, inversion-rewind convergence on the damaged one, byte-equal read models afterward).
  Postgres integration covers the emit-chain digest maintenance, deletion subtraction, and the
  recompute self-verification. Multi-tenant isolation and the expected-vs-unexpected discriminator
  each get their own regression locks.
- **Docs.** This proposal graduates alongside the implementation: behavior + configuration
  reference for `StreamIntegrityOptions`, the integrity event types, the health signal, and an
  operations note (reading a mismatch report, running a manual audit, invoking re-delivery).
  Code↔docs↔tests linking per the standard: `<docs>` tags on all new public surface, `<tests>`
  tags where convention needs help, maps regenerated and link-validated.
- **Observability.** Meters: checkpoint gaps detected/confirmed, digest mismatches by class
  (expected/unexpected), events re-delivered, repairs deferred by caps, audit duration, digest
  self-verification drift. A health source degrades on confirmed-unrepaired divergence.

## Increments

1. **R1** — re-delivery primitive + request command + convergence integration test (drop-injection
   harness scenario end-to-end). Independently valuable on day one.
2. **B** — per-type sequence stamping + checkpoint signal + consumer gap tracker (report-only), then
   the auto-repair hookup behind the ladder.
3. **S** — reconciler consumption-set diff + birth lineage + startup backfill orchestration.
4. **A1a** — digest table + emit-chain batch maintenance + deletion subtraction + recompute
   self-verification (SQL-first, both Postgres providers).
5. **A1b** — manifest exchange + comparison protocol (watermarks, two-cycle confirmation,
   catalog anchoring, floors) + drill-down + report pipeline.
6. **L** — local coverage audit + targeted rebuild remediation.
7. **Ladder completion** — AutoRepairCapped mode, dry-run, storm caps, operations doc.

## Open questions (for review)

1. Digest width: 64-bit XOR is cheapest; 128-bit additive is safer against accidental collision at
   large scale. Default 128?
2. Checkpoint carrier: dedicated signal type on the signal bus (doorbell + fetch) vs. a small
   normal event per (tenant, type) — leaning signal-bus doorbell with a fetchable checkpoint table.
3. Should Phase B sequences live in envelope metadata (like the ephemeral TTL carrier) or as a
   store column? Metadata keeps the emit chain untouched; a column is queryable for gap forensics.
4. Cross-origin fan-in: a consumer aggregating N origins runs N independent comparisons — any value
   in a combined report beyond per-origin rows?
5. Does the digest table participate in debug mode (retain per-operation digest journal) or stay
   current-state-only?
