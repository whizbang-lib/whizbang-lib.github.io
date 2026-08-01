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

**Directed messages (`target`) — a general capability this feature consumes twice.** Repair sets
are computed per (consumer, origin) pair, so repair traffic is inherently addressed to one
service; rather than a repair-branded header, Whizbang gains a first-class **`target`** address —
the *logical service identity* that names the target's subscription (never an instance id) —
mapped to the transport's **native `To`/`ReplyTo`** properties where they exist (AMQP bare-message
`to`; Service Bus `To` with SQL-filterable rules) and carried as portable envelope metadata
elsewhere. Non-target consumers discard at the receive seam before deserialization or fan-out
(the same boundary discipline as unsubscribed-message discard, one property compare); transports
with native filtering (`target IS NULL OR target = @me`, wired through the
infrastructure-provisioner seam and advertised via transport capabilities) filter broker-side so
non-targets never receive the message at all. An **absent** target means broadcast, as today.

The defining semantic rule — which is what keeps targeting coherent with the rest of this
proposal: **a targeted message is point-to-point by definition and therefore outside the
broadcast-integrity universe.** It never increments shared continuity sequences and never enters
digests; its delivery assurance comes from its own loop (re-delivery is self-checking via
re-alarm; request/response has a waiting requester). Without this rule, a targeted message would
punch a permanent false gap into every non-target's continuity tracker. Guidance (a future
analyzer nudge, not a prohibition): **facts broadcast — direction is for control-plane, repair,
and response traffic**; targeting ordinary domain events undermines "events are facts anyone can
consume."

Within this feature: re-delivery composites carry `target` = the damaged consumer (a mis-targeted
repair is benign — the needing service discards, the gap persists, the next checkpoint
re-alarms); **manifest responses** carry `target` = the requester (sparing every other service
even the relevance-discard); Phase S backfill targets the expanding consumer. *Considered and
rejected:* opportunistic acceptance by non-targets that coincidentally share a gap — it reinstates
the broadcast cost for everyone to serve a rare coincidence that the coincident consumer's own
detection loop repairs anyway; strict discard keeps the cost model predictable.

A request/response wrapper (`RequestRedeliveryCommand` on the wire, origin-routed) lets any
consumer ask an origin for re-delivery without out-of-band coordination — the request carries the
requester's service identity (`reply-to`), which becomes the response and re-delivery `target`.

### Phase B — continuity checkpoints (fast drop detection)

:::updated
**Design amendment (emit-chain spike result).** The original sketch stamped a NEW monotone
per-(origin, tenant, type) sequence at emit. The spike showed that cannot ride the wire without
either hot-path per-(tenant,type) counter rows in the emit chain or publish-time byte patching —
and it is unnecessary: the origin's **commit sequence already rides every wire envelope**
(`SourceServiceId` + `SourceCommitSequence`, injected at outbox publish from the async
commit-order stamper) and **already persists at consumers** (`wh_inbox.source_commit_sequence`;
received events keep `origin_service_id` + `origin_commit_sequence` in the consumer's event
store). Phase B therefore adds NO per-event stamping at all — it verifies **counts over origin
commit-sequence windows**.
:::

The origin periodically publishes a lightweight **`IntegrityCheckpoint`** (an `[Ephemeral]` system
event, default 60s): "between commit-sequence watermark W₁ (exclusive) and W₂ (inclusive), I
emitted these per-(tenant, type) counts" — a bounded bucket list. Consumers count the events they
have persisted from that origin inside the same window (keyed by the already-stored origin
sequence) for the types they subscribe to, and compare.

- A deficit that persists past the NEXT checkpoint (two-cycle confirmation, absorbing in-flight
  stragglers) is a **confirmed gap** → typed integrity report event, and — when auto-repair is
  enabled on the ladder — a scoped `RequestRedeliveryCommand` for exactly that window
  (`FromCommitSequence = W₁`, `ToCommitSequence = W₂`, the deficit's types/tenant). Window repair
  converges by identity: already-present events conflict-skip, missing ones land.
- Detects the incident class **within one to two checkpoint intervals**, not at the next nightly
  audit.
- Near-zero origin cost: one `GROUP BY` over the stamped window per interval; checkpoints are
  doorbell-sized control messages. Checkpoints publish even when the window is empty — a missing
  checkpoint (3× interval) is itself a **liveness alarm**.
- Subscription subsets are handled by construction — buckets are per *type*, so a consumer only
  compares types it consumes. At-most-once schedule occurrences are excluded from the counts (a
  non-delivered at-most-once occurrence is its declared behavior, not a gap).
- Re-delivered events carry their ORIGINAL origin identity (`OriginServiceId` + per-child original
  commit sequences ride the re-delivery composite and are stamped onto the fanned-out children),
  so a repaired window recounts correctly.

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

:::updated
**Design specifics (as built):**

- **The backfill request BROADCASTS** (no `Target`) — an expanding consumer cannot know which
  origins emitted a type's history. Every service's re-delivery receptor runs the scoped selection;
  origins holding matching events answer with bundles targeted back at the requester, everyone
  else selects nothing. A consumer that persisted forwarded copies may answer too — extra sources
  converge harmlessly by event-id identity.
- **"Backfill builds state, never re-fires triggers" rides the ENVELOPE**: a `stateOnly` delivery
  marker (wire key `sto`, sibling of the directed `tgt`) stamped on the bundle by the pump and
  inherited by every fanned-out child. A state-only child is event-stored and projected normally,
  but the inbox dispatch SKIPS its trigger-receptor stages. The perspective-side lifecycle
  completion stages still fire — they are completion accounting, not domain triggers.
- **First boot baselines**: an empty consumed-type registry records the whole catalog WITHOUT
  backfilling (nothing existed to miss). Only types appearing on a LATER boot are expansions.
  The registry (`wh_consumed_types`) carries per-type backfill status — the audit surface for
  "pending backfill" when the feature is disabled.
:::

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

:::updated
**Startup audit (as built): the deep audit ALSO runs at startup by default.** The original
interval-first scheduling (first audit a full interval after boot, to avoid deploy-time audit
storms) predates A1c — with the type-level exchange an audit costs O(types) on the wire, so the
storm rationale no longer holds. `AuditOnStartup` (default true) fires the first audit after a
30-second floor plus a random splay of up to `StartupAuditMaxJitterSeconds` (default 300), so a
fleet deploy's audits de-synchronize; subsequent cycles follow `AuditIntervalMinutes`. The
consequence that motivated the change: historical divergence (a consumer that drifted BEFORE the
current boot — e.g. a read model missing events from an origin) now heals minutes after a deploy
instead of a day later. Opting out restores interval-first.
:::

**Repair is a ladder, not a reflex.** `ReportOnly` is the default release posture: typed integrity
events + metrics + a health signal, no writes. `AutoRepairCapped` opts into scoped re-delivery with
hard rate caps and a dry-run mode that logs the exact repair set without sending. The industry
lesson (repair storms taking down clusters that were merely *suspected* of divergence) is encoded
as: caps always on, auto-repair never default, every repair loudly attributed.

:::updated
**Default REVISED (as built): SELF-HEALING out of the box.** `RepairMode` defaults to
`AutoRepairCapped` — the shipped posture detects AND repairs, with every rung hard-capped
(per-checkpoint, per-audit-chunk, per-cycle rebuilds, drill-down types, per-request event caps) so
a mass divergence reports loudly instead of storming. What changed from the original stance: the
storm-lesson is encoded in the CAPS, not in a disabled-by-default repair — a capped repair of a
provably-missing delivery is additive and idempotent (the same event id folds once), so the risk
that made auto-repair dangerous elsewhere (destructive repair of *suspected* divergence) does not
apply to this design's confirmed-gap, identity-preserving re-delivery. `ReportOnly` remains the
explicit opt-DOWN for operators who want report-and-decide; every report still states exactly what
auto-repair would have done, so ReportOnly IS the dry-run.

**Observability (as built): meter `Whizbang.StreamIntegrity`.** Self-healing by default demands
visibility into what the healer does. Counters:
`checkpoints_published` / `checkpoints_received` (the liveness beat), `gaps_detected` +
`divergences_detected` + `coverage_gaps_detected` (the three detection surfaces — sustained
non-zero means deliveries are being lost; find the infrastructure cause),
`repairs_requested` (tagged `source=checkpoint|audit`) + `rebuilds_requested` (what the healer
did about it), `manifests_requested` / `manifest_chunks_sent` / `drill_downs_requested` (audit
wire activity), `backfills_requested` (Phase S), and `digest_buckets_verified` +
`digest_drift_healed` (the trust-but-verify sweep — any drift healed means an unaccounted write
path touched audited rows and warrants investigation).
:::

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

   :::new
   **R1 is built** (with its R0 prerequisite), in four steps:

   - **R0 — directed messages.** `IMessageEnvelope.Target` (wire key `tgt`, omitted when null =
     broadcast); the transport consumer discards a foreign-targeted message at the receive seam
     (ordinal match against the service's own identity, fail-open when identity is unknown).
   - **R1a — selection.** `RedeliveryRequest`/`RedeliveryEvent` + the coordinator's
     `SelectRedeliveryEventsAsync` (EFCore Postgres, raw SQL, no migration): conjunctive optional
     filters (tenant, event types, streams, commit-sequence window), ordered `(stream, version)`,
     hard `MaxEvents` cap; at-most-once occurrences excluded by delivery guarantee, reaped
     ephemeral bodies excluded structurally by the body join.
   - **R1a2 — identity-preserving composites.** Composite fan-out ordinarily mints fresh child ids;
     `IIdentityPreservingComposite` lets `RedeliveryComposite` stamp the ORIGINAL event ids onto
     its children (strict pairing — a count mismatch dead-letters the bundle). `RedeliveryPump`
     bundles a selection per stream (chunked), rehydrates payloads through the event store's AOT
     path, and publishes wire-only through the envelope-serializer seam with `Target` set.
   - **R1b — the request command.** `RequestRedeliveryCommand` (framework command; auto
     wire-registered) rides directed messaging: the requester stamps `Target` = origin service and
     names itself as `RequesterService` + the reply `Topic`. The origin's built-in receptor
     (driver assembly, runtime-registered) runs the selection and pumps targeted bundles back.
     The origin clamps every request's `MaxEvents` by its configured
     `RedeliveryPumpOptions.MaxEventsPerRequest` — a requester can never raise an origin's cap.
     This command is also the OPERATOR surface: dispatch it in-process on the origin (or targeted
     from anywhere) to trigger a manual repair.
   - **R1c — the convergence proof.** The multi-service harness gained per-consumer delivery-fault
     injection (`SuppressDeliveries`); the flagship test drops deliveries at one consumer,
     re-delivers via a targeted bundle over the real JSON wire, and proves: the healthy consumer
     discards at the receive seam, the damaged consumer's fan-out yields children carrying the
     original event ids and original bodies — convergence is idempotent by identity. The proof
     surfaced and fixed two real defects: the envelope serializer dropped `Target` on conversion,
     and generated JSON contexts bound a composite's inner `IMessage` list to their own assembly's
     options (cross-assembly inner events serialized as empty objects) — now bound to the
     serializing options via cycle-safe lazy registry accessors.
   :::
2. **B** — per-type sequence stamping + checkpoint signal + consumer gap tracker (report-only), then
   the auto-repair hookup behind the ladder.

   :::new
   **Phase B is built** (per the amended windowed-count design above): re-delivery bundles carry
   original origin identity (B0); the origin publishes `IntegrityCheckpoint` windows through a
   multi-instance-safe watermark advance, empty windows included as the liveness beat (B1); the
   consumer verifies windowed receipt counts with two-cycle confirmation, reports
   `IntegrityGapDetected`, and — at `AutoRepairCapped` — sends the scoped, directed, wire-only
   `RequestRedeliveryCommand` back to the origin, storm-capped per checkpoint (B2–B4). Checkpoints
   and gap detection default ON; repair defaults to `ReportOnly`.
   :::
3. **S** — reconciler consumption-set diff + birth lineage + startup backfill orchestration.

   :::new
   **Phase S is built**: the state-only envelope marker (`sto`) with its dispatch-seam gate (S0);
   the consumed-type registry `wh_consumed_types` with Baseline/Pending/Requested lifecycle (S1);
   and the startup `SubscriptionExpansionWorker` — first boot baselines, later-boot additions
   register Pending and repair via one broadcast state-only re-delivery request, with disabled
   mode recording Pending as the audit surface (S2/S3). On by default.
   :::
4. **A1a** — digest table + emit-chain batch maintenance + deletion subtraction + recompute
   self-verification (SQL-first, both Postgres providers).

   :::updated
   **As built (two passes).** Digest algebra: **two-lane 64-bit XOR** of
   `hashtextextended(event_id, seed)` with seeds 0 and 1 — 128-bit-equivalent collision
   resistance, order-independent, self-inverse (a deletion is subtracted by folding the same
   hashes again), pure SQL. Ephemeral (mode-excluded) and at-most-once occurrences are excluded,
   matching Phase B's counts. The first pass shipped digests as COMPUTED on demand (one indexed
   `GROUP BY` at audit time); a scalability review then landed the proposal's original incremental
   design in full — see **A1c** below. The recompute survives as the sweep/verification path.
   :::
5. **A1b** — manifest exchange + comparison protocol (watermarks, two-cycle confirmation,
   catalog anchoring, floors) + drill-down + report pipeline.

   :::updated
   **As built: consumer-driven manifest exchange.** Each consumer's audit worker asks every origin
   it knows (the checkpoint tracker's origin set — an origin that never checkpoints is already a
   liveness alarm) for a manifest: a DIRECTED `RequestIntegrityManifest` command; the origin
   answers with `[Ephemeral]` `IntegrityManifest` events (digest rows, chunked) TARGETED back.
   The consumer compares against its own from-that-origin digests for subscribed types; a
   mismatched (tenant, type, stream) bucket raises `IntegrityDivergenceDetected` (Sourced report)
   and — on the `AutoRepairCapped` rung — a stream-scoped `RequestRedeliveryCommand`. Extras
   (consumer-only streams) are reported, never auto-deleted (taxonomy #5).
   :::

   **A1c** — the incremental digest table + hierarchical exchange (the scale story).

   :::new
   **Built as the proposal originally specified, after a scalability review of the computed-only
   pass.** Growth no longer grows the audit: cost scales with *what changed*, not store size.

   - **`wh_stream_digests`** — one row per (origin, tenant, event type, stream) bucket, PK on
     those four columns; the zero-uuid origin is this service's own lane, a non-zero origin is
     the local copy of events received FROM that origin. Maintained by the write paths
     themselves: both emit-chain functions gain a `digest_folds` CTE (joined to the stored-events
     CTE so idempotent re-stores never double-fold); `close_stream` and
     `reclassify_events_ephemeral` XOR the rows they remove back out — and these two are provably
     the ONLY deletion paths touching audited buckets, because the reaper and pointer-prune act
     exclusively on ephemeral rows, which the mode exclusion keeps out of digests entirely. An
     idempotent backfill seeds buckets from existing history; a ledger replay never clobbers
     maintained values.
   - **Origin identity, live.** The inbox emit chain now stamps
     `wh_event_store.origin_service_id / origin_commit_sequence` from the transport-delivered
     source columns (normalized: a self/zero source is locally-originated and stays NULL). The
     columns' contract predates this proposal but no writer ever populated them — without this
     stamp, every consumer-side origin-keyed comparison (checkpoint counts, consumer digests)
     was inert in production.
   - **Hierarchical exchange.** Scheduled audits request **type-level roll-ups** first (XOR of a
     type's stream buckets — valid because they partition the type's events): O(types) wire cost,
     one comparison proving every stream bucket of the type complete. Mismatched types drill down
     (capped, `MaxDrillDownTypesPerAudit`) to a directed stream-level exchange; only divergent
     buckets ever pay stream-level cost. Table-driven compares **settle-skip** buckets whose
     `updated_at` is inside the settle window on either side — the incremental equivalent of the
     recompute's created-at filter.
   - **Trust-but-verify sweep.** Every `FullSweepEveryNthAudit`-th cycle (default 7 — weekly at
     the daily default), each service reconciles its own table against a full recompute and
     HEALS it (drifted buckets updated, phantoms removed, missing added; non-zero drift is a loud
     alarm — an unaccounted write path), and the manifest exchange runs recompute-to-recompute
     end to end, covering busy buckets that settle-skip on table-driven cycles. Providers without
     the digest table transparently fall back to the recompute.
   :::
6. **L** — local coverage audit + targeted rebuild remediation.

   :::new
   **Phases A and L are built** (per the amendments above): computed two-lane XOR digests, the
   consumer-driven manifest exchange with per-bucket comparison and stream-scoped capped repair,
   and the local coverage audit with capped local rebuilds — all ON by default, daily, ladder at
   `ReportOnly`. With R0–R1, B, and S, **every phase of this proposal is implemented**; the
   `ReportOnly` reports double as the dry-run for `AutoRepairCapped`. Graduation of this proposal
   into the behavior/configuration reference rides this PR's merge.
   :::
7. **Ladder completion** — AutoRepairCapped mode, dry-run, storm caps, operations doc.

   :::new
   **Closed**: `AutoRepairCapped` is implemented at every repair site (checkpoint gaps, audit
   divergences, local rebuilds); `ReportOnly` IS the dry-run (every report carries exactly what
   auto-repair would have done); storm caps exist at every rung.
   :::

## Open questions (for review)

1. Digest width: 64-bit XOR is cheapest; 128-bit additive is safer against accidental collision at
   large scale. Default 128?
2. Checkpoint carrier: dedicated signal type on the signal bus (doorbell + fetch) vs. a small
   normal event per (tenant, type) — leaning signal-bus doorbell with a fetchable checkpoint table.
3. ~~Should Phase B sequences live in envelope metadata or as a store column?~~ **Resolved by the
   emit-chain spike:** neither — Phase B introduces no new sequence. The existing
   `SourceCommitSequence` (wire) / `origin_commit_sequence` (store) carry per-event origin order,
   and checkpoints verify per-(tenant, type) COUNTS over commit-sequence windows (see the Phase B
   amendment above).
4. Cross-origin fan-in: a consumer aggregating N origins runs N independent comparisons — any value
   in a combined report beyond per-origin rows?
5. Does the digest table participate in debug mode (retain per-operation digest journal) or stay
   current-state-only?
