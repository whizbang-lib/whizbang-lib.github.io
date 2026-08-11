---
title: Stream Integrity
pageType: guide
version: 1.0.0
category: Resilience
order: 4
description: Cross-service anti-entropy — continuity checkpoints, digest audits, and idempotent re-delivery repair, self-healing by default
tags: 'stream-integrity, anti-entropy, re-delivery, backfill, digest, manifest, continuity, checkpoint, repair, cross-service, bootstrap'
codeReferences:
  - src/Whizbang.Core/Messaging/IntegrityCheckpoint.cs
  - src/Whizbang.Core/Messaging/IntegrityAudit.cs
  - src/Whizbang.Core/Messaging/IntegrityGapTracker.cs
  - src/Whizbang.Core/Workers/IntegrityCheckpointWorker.cs
  - src/Whizbang.Core/Workers/IntegrityAuditWorker.cs
  - src/Whizbang.Core/Transports/ControlPlaneDestination.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityCheckpointReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityManifestReceptors.cs
  - src/Whizbang.Core/Messaging/Redelivery.cs
  - src/Whizbang.Core/Messaging/RedeliveryComposite.cs
  - src/Whizbang.Core/Messaging/RedeliveryPump.cs
  - src/Whizbang.Core/Workers/SubscriptionExpansionWorker.cs
  - src/Whizbang.Core/Observability/StreamIntegrityMetrics.cs
  - src/Whizbang.Data.EFCore.Postgres/RedeliveryRequestReceptor.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/087_StreamDigests.sql
  - src/Whizbang.Data.Postgres/Migrations/086_ConsumedTypeRegistry.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityCheckpointReceptorRegistrar.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/IntegrityCheckpointWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityAuditWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/SubscriptionExpansionWorkerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityGapTrackerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntegrityCheckpointWireSerializationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamIntegrityOptionsDefaultsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryPumpTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryCompositeWireSerializationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeInboxFanoutTests.cs
  - tests/Whizbang.Core.Tests/MultiService/StreamIntegrityRedeliveryE2ETests.cs
  - tests/Whizbang.Core.Tests/MultiService/DirectedMessageE2ETests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerDirectedTargetTests.cs
  - tests/Whizbang.Core.Tests/Observability/StreamIntegrityMetricsTests.cs
  - tests/Whizbang.Core.Tests/Security/ControlPlaneSecurityExemptionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityCheckpointAdvanceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityCheckpointReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityManifestReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RedeliveryRequestReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SelectRedeliveryEventsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamDigestTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamDigestTableSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ConsumedTypeRegistryTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Integration.Tests/ControlPlaneSessionIntegrationTests.cs
verifiedAgainstCommit: a64ba9a0
verifiedDate: 2026-08-04
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

Stream integrity is a **first-class, self-healing framework capability**: detect divergence in
bounded time, name it precisely, and repair it idempotently — the same philosophy the
migration-ledger redefinition closure applies to schema, applied to data. It is ON by default,
with automatic capped repair (`AutoRepairCapped`) and a `ReportOnly` opt-down that doubles as a
dry run.

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
prompt detection actively extends repairability instead of racing the reaper *(design intent —
the hold mechanism exists, but no integrity code path invokes it as of a64ba9a)*. Once genuinely
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
- **Old occurrence gaps are report-only past a window** *(design intent — the config knob for
  this window is not yet built as of a64ba9a; the intended default is the checkpoint confirmation
  horizon)*: whether a *late* fire is wanted is per-schedule taste already expressed by the
  temporal engine's misfire policy, and integrity does not override it.
- **Backfill builds state and never re-fires triggers** — as built, this rides the request, not a
  per-type key: backfill requests set `RequestRedeliveryCommand.StateOnly`, so backfilled
  occurrences are event-stored and projected without firing trigger receptors, and the selection
  itself excludes at-most-once occurrences outright. A per-type opt-in for including occurrence
  history in backfill is design intent, not yet built. The governing line: **repair delivers what
  a live subscriber missed; backfill builds state — and never re-fires triggers.**

Schedule **definitions** (`wh_schedules`) are service-local durable configuration, outside stream
integrity entirely: missed fires at the origin are governed solely by the temporal engine's
misfire policy (coalesce / catch-up / skip, with burst caps) — integrity adds no second mechanism
that could fight it. Commands and composite envelopes remain structurally out of scope (never
persisted); composite *inner* events are ordinary facts and fully in scope.

---

## Design

### Phase R1 — the re-delivery primitive (everything else depends on it)

`IWorkCoordinator.SelectRedeliveryEventsAsync(RedeliveryRequest)` on the **origin**: select
persisted events by (tenant scope, event types, stream ids, commit-sequence range); the
`RedeliveryPump` publishes the selection **wire-only, directly through `ITransport`** — no outbox
row, no local dispatch (the origin already holds these events, so its own pipeline has nothing to
do with them). The events go to the same topics as the original publish.

**The origin's memory and message sizes are bounded by design**, not by hoping requests stay
small — a first full audit against a large store arrives as a burst of wide repair requests, and
an unbounded answer path takes the origin down with it. Four knobs on `RedeliveryPumpOptions`
(register the instance in DI to override; every default is production-safe):

| Option | Default | Bounds |
|---|---|---|
| `MaxEventsPerRequest` | 10,000 | Hard per-request clamp — a requester's `MaxEvents` is never raised above the origin's cap (the storm-cap rung) |
| `SelectPageSize` | 500 | The origin selects and publishes in **keyset-continued pages** — memory holds one page of bodies regardless of how wide the request is |
| `MaxInnerEventsPerComposite` | 500 | Per-composite chunk bound by **count** (`CompositeEventBase.MaxInnerEventsAllowed` defends the receiver) |
| `MaxBytesPerComposite` | 192,000 | Per-composite chunk bound by **raw stored body bytes** — large-bodied histories flush below the count bound instead of exhausting memory during serialization or exceeding the broker's message-size limit; a single event larger than the budget still ships alone |

Pages continue strictly after the previous page's last (stream, version) — no loss, no overlap,
per-stream order preserved across page boundaries. Additionally, an origin runs **one repair
build at a time per process**: concurrent request bursts (per-bucket auto-repair and
subscription-expansion broadcasts land together after a deploy) queue instead of multiplying
page-plus-serialization footprints.

**Convergence needs no new consumer code** — it composes from delivery semantics that already exist:

- An event the consumer **already has** hits the event-id conflict skip at the store seam: no row,
  no work items, zero perspective churn. Re-delivery is free where nothing is wrong.
- An event the consumer **was missing** appends normally and generates perspective work. Because it
  is *older* than the perspective's cursor, the **cursor-inversion detector** fires and the rewind
  path replays the stream from its snapshot/anchor with the now-complete event set. Late history
  folds in correctly because the pipeline already knows what late history means.

**Re-delivery rides composites, and the children ride RAW.** A repair set is "many events for one
stream" — the composite decision-table row, with its measured bulk-transport win. The redelivery
pump bundles each stream's ordered repair slice into a framework `RedeliveryComposite`
(`Independent` atomicity — one poison inner event must not dead-letter a stream's whole repair;
the next cycle re-detects any remainder) and publishes it **wire-only** (the origin already holds
these events; no local re-processing). Inner events are carried as the **raw stored wire JSON**
(`IRawInnerComposite.InnerPayloads`) plus their stored wire type names — the origin never
rehydrates typed payloads. Re-serializing typed payloads polymorphically was redundant work, an
upcast/version-skew fidelity risk, and an AOT cliff: a consumer payload shape whose metadata is
not reachable through the polymorphic resolver chain made the re-serialization throw, so the
repair never shipped. Raw carry removes the class — the origin needs **no type knowledge at all**
to repair, and the receive-side fan-out builds children directly from the raw payloads (the child
envelope IS the inbox storage form; no serializer runs on the path). Original ids and continuity
sequences ride as `RedeliveryComposite.InnerEventIds` / `OriginServiceId` /
`InnerCommitSequences` — identity and gap-tracking are preserved; there is no dedicated
`redelivery` marker — the directed `tgt` (and, for backfill, state-only `sto`) envelope markers
ride the composite and its fanned-out children. Ordering by stream version makes damaged streams
append-only composites and wholly-missing streams (bootstrap) naturally init-first.
`MaxInnerEventsPerComposite` is the sender-side chunker; `CompositeEventBase.MaxInnerEventsAllowed`
defends the receiver. One honest note: repair thereby uses the same fan-out
machinery whose (storage-defect-induced) failure motivated this proposal — acceptable because
**repair traffic is itself integrity-checked**: re-delivered events carry original sequences, so
a dropped repair re-alarms at the next checkpoint instead of silently "completing."

**Directed messages (`target`) — a general capability this feature consumes twice.** Repair sets
are computed per (consumer, origin) pair, so repair traffic is inherently addressed to one
service; rather than a repair-branded header, Whizbang gains a first-class **`target`** address —
the *logical service identity* that names the target's subscription (never an instance id) —
carried as portable envelope metadata (wire key `tgt`). As built, non-target consumers discard at
the receive seam before deserialization or fan-out (the same boundary discipline as
unsubscribed-message discard, one property compare) — exactly the R0 build record below. Mapping
`target` to the transport's **native `To`/`ReplyTo`** properties where they exist (AMQP
bare-message `to`; Service Bus `To` with SQL-filterable rules) and broker-side filtering
(`target IS NULL OR target = @me`, wired through the infrastructure-provisioner seam and
advertised via transport capabilities, so non-targets never receive the message at all) are
design intent — not yet wired in any transport as of a64ba9a. An **absent** target means
broadcast, as today.

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
requester's service identity (`RequesterService`, which becomes the response and re-delivery
`target`) and the reply `Topic` the bundles publish back on.

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

:::updated
**Design amendment (live-validation result) — checkpoints ride the origin's own event topics.**
The first live deployment on a domain-ownership transport topology (per-namespace topics,
subscriptions generated from the compile-time registry) exposed a delivery hole: publishing the
checkpoint through the normal dispatcher routes it to the *control-plane namespace topic*, and no
consumer ever subscribes there — the integrity receptors are **runtime-registered** framework
receptors, invisible to subscription generation, so the broker silently dropped every checkpoint.
Origin tracking never populated, and the deep audit (whose origin set is the checkpoint tracker)
was permanently inert. The checkpoint publisher therefore publishes **directly through the
transport to the DISTINCT topics of the origin's own audited event types** — the current window's
types unioned with the historically-emitted own-lane digest types, so quiet periods still
heartbeat every covered topic — resolved with the production outbox routing strategy. Consumers
receive checkpoints on exactly the topics they already subscribe to for the origin's events; the
receive-side receptor ignores the origin's own self-delivered copy. Hosts without transport
infrastructure (in-memory) keep the dispatcher publish as the fallback. A companion fix from the
same live validation: the receive-side discard gates initially dropped messages consumed only by
these runtime-registered integrity receptors as "unsubscribed" — the
`IReceptorRegistry.HasRuntimeConsumerFor` seam (commit a64ba9a, PR #412) teaches the discard
gates to recognize runtime-registered receptors as consumers.
:::

What it cannot see: loss *after* successful receipt (case 2) and anything historical. That is the
deep audit's job.

### Phase S — subscription-expansion backfill (startup, on by default)

The startup type-definition reconciler already diffs each service's catalog against its persisted
registration. It gains one comparison: **the consumed-type set**. When a deploy grows it (new
perspective; perspective adds a type; first boot of a new consumer), the
`SubscriptionExpansionWorker` records the expansion in the consumed-type registry and sends **one
broadcast, state-only `RequestRedeliveryCommand`** for the new types' history. Delivered history
folds into projections through the normal pipeline (state-only children are event-stored and
projected); an explicit "schedule the local rebuild once delivery completes" step is design
intent, not yet wired as of a64ba9a.

This turns "we added a perspective over old events" and "we stood up a new consumer service" from
runbook procedures into a deploy-time non-event. Configurable, **on by default**
(`StreamIntegrityOptions.BackfillOnSubscriptionGrowth = true`); disabling leaves the expansion
*recorded* as Pending in the registry. (Surfacing that Pending state through the deep audit as
"pending backfill" is design intent — as of a64ba9a the registry is read only by the startup
worker itself.)

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
  The registry (`wh_consumed_types`) carries per-type backfill status
  (Baseline/Pending/Requested); today only the startup worker reads it — wiring it into the
  deep audit as the "pending backfill" surface is not yet done as of a64ba9a.
:::

### Phase A — digest manifests (the scheduled deep audit)

**Both halves of the exchange are storm-bounded.** Audit traffic is inherently bursty — after a
deploy, every consumer audits on a similar cadence and every origin answers at once. An origin
runs **one manifest answer at a time** per process, and a consumer runs **one manifest
comparison at a time**; concurrent chunks queue instead of multiplying recompute footprints
(observed live: consumers with unpopulated digest lanes memory-cycled through their first full
audit wave). Types-level digests — both the origin's answer and the consumer's comparison side —
**roll up at the store** (`IWorkCoordinator.ComputeTypeDigestsAsync`, a per-(tenant, type)
`GROUP BY` bounded by types × tenants) instead of materializing one row per stream in memory to
answer a types-level question; the SQL fold is bit-identical to the C# roll-up of stream buckets
because the buckets partition the type's events.

**The repair loop is convergence-bounded.** Detection being bounded is not enough — the *repair
loop* must converge even when it cannot repair (the origin is down, or a bucket is genuinely
damaged). Without memory of what it already said and asked, a consumer re-reports and re-requests
every divergent bucket on every audit cycle forever; observed live, that flood alone — an
`IntegrityDivergenceDetected` per bucket per cycle, minted faster than the outbox drained —
saturated a shared database server, which kept the one origin that could heal the divergence from
ever finishing a startup. Three rules make the loop convergent, all carried by the in-memory
`IntegrityRepairLedger` (a singleton sibling of the gap tracker; a restart re-reports once, then
re-bounds):

- **Reports cool down.** An UNCHANGED divergence re-reports only once per
  `DivergenceReportCooldownMinutes` (default 60) — the audit cadence is not news. A **changed
  signature** (either side's digest moved: progress, or fresh damage) always reports immediately,
  and a bucket that heals is forgotten entirely, so a later re-divergence is a brand-new incident.
- **Repair requests back off.** Each divergent bucket's first repair request goes immediately;
  every further attempt doubles the wait (`RepairRequestBackoffSeconds` base, default 300), and
  past `MaxRepairAttemptsPerBucket` (default 8) the requester stops asking — the divergence still
  re-reports at the cooldown cadence, but a repair that has not worked eight times needs operator
  eyes, not an infinite loop. A signature change resets the budget.
- **Requests batch and are directed or not at all.** Divergent streams of one (tenant, type)
  batch into ONE `RequestRedeliveryCommand` (the origin's selection takes a stream set — per-stream
  commands multiplied wire volume by the stream count for nothing). And every integrity request —
  repair, drill-down, manifest — publishes ONLY to the origin-carried request address learned from
  its checkpoints. When that address is not yet known the request is **withheld and logged**, never
  published to the requester's own topic: on a shared topic that "fallback" fanned each request out
  to every service (and back to the requester itself), turning one unhealed divergence into
  all-to-all noise.

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

Rollups: per (tenant, type) digests derive from the atomic buckets, giving a two-level drill-down
as built (`ManifestLevel` has exactly `Types` and `Streams`) — mismatch at type level → compare
that type's stream digests → a mismatched stream goes straight to a stream-scoped re-delivery
request, which converges by event-id identity. An id-level third step — exchanging the stream's
event-id list so the set difference IS the repair set (streams are short by design; a
set-reconciliation encoding à la IBLT as an optimization) — is a future refinement, not yet built
as of a64ba9a.

**Maintenance strategy.** Digests are maintained **incrementally, transactionally, at batch
granularity** inside the existing emit chain: one digest upsert per distinct (tenant, type) in the
batch — not per event — so bulk imports do not serialize on a hot digest row. Deletion paths
subtract in their own transactions. Because incremental state can rot (the hard-won lesson of
Cassandra's incremental repair), a low-frequency **self-verification** recomputes a sample of
buckets from the store and alarms on drift between the digest table and reality.

**Comparison protocol.**

- Manifests settle **by time**, not by commit-sequence watermark: buckets updated inside
  `AuditSettleWindowMinutes` (default 60) on either side are settle-skipped, so in-flight events
  never read as divergence. (The original commit-sequence watermark — "complete up to origin
  commit sequence ≤ N" — remains design intent; as built the audit reports a mismatch on the
  first settled cycle, while two-cycle confirmation is Phase B's checkpoint discipline.)
- Scope is **pair-relative and catalog-anchored**: the comparison covers the intersection of the
  origin's published types and the consumer's consumed types, referenced by type-definition ids
  from the fingerprint subsystem, so both sides provably compare the same universe even across
  deploys and reclassifications.
- **Expected vs unexpected missing** *(design intent — not yet built as of a64ba9a)*: history
  older than a subscription's recorded birth (Phase S lineage) would be *pending-backfill*
  (informational, auto-resolvable) — not an integrity violation. An audit that cries wolf on every
  deploy trains everyone to ignore it; this discriminator is what would keep the alarms
  meaningful. As built, the audit compare takes no birth-lineage input (the registry's
  `first_seen_at` is recorded but never read by the audit), so backfill-pending history reads the
  same as any other divergence.
- **Lifecycle floors:** ephemeral types are excluded by mode (see *Ephemeral and temporal
  traffic* — the checkpoint phase owns their window); each stream's comparison floor is the
  origin's close/archival point, so closing-the-books truncation never reads as loss.

**Message economics (chatter scales with divergence, not data).** Per (consumer, origin) pair per
audit cycle, the healthy path is **two messages**: one manifest request, one sparse top-level
response (per-(tenant, type) digests, ~60 bytes per non-empty bucket; claim-check offload past the
size threshold). The consumer diffs locally against its own digest table — a match ends the cycle.
Origins serve manifests from the maintained digest table (a rollup `SELECT`, never a store scan)
and may cache the answer per cycle for multi-consumer fan-in (not yet implemented). Drill-down is
**one batched round-trip per level, never per bucket**: all mismatched (tenant, type) buckets in
one stream-level exchange — a mismatched stream then goes straight to stream-scoped re-delivery
(the id-level exchange is a future refinement) — so even a messy divergence costs a handful of
control messages plus the repair payload itself. The steady-state hum
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

### How the phases unfold from a cold start

A restarted service reconciles in **layers** — the local layer immediately, the cross-service
layer as soon as it has *heard from* its origins. The origin set is deliberately in-memory
(a restart re-baselines it), so the first audit after a fleet-wide deploy usually runs only the
local half; the next cycle has a warm tracker and runs the full exchange.

```mermaid {caption="One reconcile cycle: checkpoints warm the origin tracker, the audit exchanges digest manifests, divergence drills down to an exact re-delivery" tests=["IntegrityCheckpointWorkerTests.RunCheckpointOnce_WithTransport_PublishesToOwnEventTopicsAsync","IntegrityAuditWorkerTests.KnownOrigins_GetDirectedManifestRequestsAsync","ControlPlaneSessionIntegrationTests.ControlPlanePublish_SessionRequiredSubscription_DeliversAsync"]}
sequenceDiagram
    autonumber
    participant O as Origin service
    participant B as Broker (origin's event topics)
    participant C as Consumer service

    Note over C: boot: runtime receptors register,<br/>workers start
    Note over C: AUDIT #1 (t+30s…jitter):<br/>LOCAL half — coverage gaps →<br/>capped reports + rebuilds.<br/>Origin set still empty →<br/>cross-service half skipped.
    loop every checkpoint interval (60s)
        O->>B: IntegrityCheckpoint (session = origin's checkpoint stream)
        B->>C: delivered on the topics C already subscribes to
        C->>C: track origin + verify fresh-window counts (Phase B)
    end
    Note over C: AUDIT #2 (next cycle):<br/>origin tracker is warm
    C->>O: RequestIntegrityManifest (directed, type-level)
    O->>C: IntegrityManifest — per-type digests (chunked, one session)
    C->>C: compare vs own received-lane digests
    alt type digests disagree
        C->>O: drill-down request (stream-level)
        O->>C: stream-level manifest
        C->>O: RequestRedeliveryCommand (exact missing window)
        O->>B: re-publish missing events (per-stream sessions)
        B->>C: conflict-skip idempotent landing → perspectives fold
    else all types agree
        Note over C: nothing lost — cycle complete
    end
```

```mermaid {caption="A consumer's first minutes after a deploy — local repair immediately, cross-service exchange once the origin tracker is warm" tests=["IntegrityAuditWorkerTests.FirstAuditDelay_OnStartupDefault_IsJitteredStartupWindowAsync","IntegrityCheckpointWorkerTests.RunCheckpointOnce_PublishesWindowWithOriginIdentityAsync"]}
timeline
    title One consumer's first minutes after deploy
    t+0s : boot — receptors registered, workers start
    t+30s…5m : AUDIT #1 (jittered) — local gaps repaired; origin set empty
    every 60s : checkpoints flow — origin tracker fills, fresh-window verify active
    t+~24h : AUDIT #2 (one AuditIntervalMinutes later — only the first cycle is jittered) — manifest exchange per known origin → divergence → repair
```

**Scheduling (as built): a plain background loop.** The deep audit and the local audit run from
the `IntegrityAuditWorker` — a `BackgroundService` whose first cycle waits a jittered startup
window and whose subsequent cycles `Task.Delay` for `AuditIntervalMinutes` (default 1440 —
daily). There is no work-pump-depth check and no grace deadline yet: dogfooding the temporal
engine — recurring `ScheduleDefinition`s with a **pre-fire hook** supplying idle-or-force
semantics (defer while busy, a configurable weekly **grace deadline** forcing the run
regardless) — remains design intent, not yet wired as of a64ba9a. Continuity checkpoints
are continuous (default interval 60s). Everything is standard options-pattern configuration:

```csharp{title="StreamIntegrityOptions" description="The shipped self-healing defaults and their storm caps" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","StreamIntegrity"] tests=["StreamIntegrityOptionsDefaultsTests.Defaults_SelfHealingOutOfTheBoxAsync","StreamIntegrityOptionsDefaultsTests.Defaults_StormCapsBoundEveryRepairRungAsync"]}
services.Configure<StreamIntegrityOptions>(o => {
  // Phase B — continuity checkpoints (fast drop detection)
  o.CheckpointsEnabled = true;               // ON by default
  o.CheckpointIntervalSeconds = 60;
  o.GapDetectionEnabled = true;

  // Phases A + L — the scheduled deep audit
  o.AuditEnabled = true;                     // ON by default
  o.AuditOnStartup = true;                   // first audit ~30s + jitter after boot
  o.StartupAuditMaxJitterSeconds = 300;      // de-synchronizes a fleet rollout
  o.AuditIntervalMinutes = 1440;             // daily
  o.AuditSettleWindowMinutes = 60;           // in-flight deliveries are not gaps
  o.FullSweepEveryNthAudit = 7;              // trust-but-verify digest sweep (weekly at daily cadence)

  // Repair posture + storm caps (always enforced)
  o.RepairMode = IntegrityRepairMode.AutoRepairCapped;  // ladder: ReportOnly is the opt-down/dry-run
  o.RepairTopic = null;                      // topic repair requests publish to AND bundles return on
                                             // (null = the consumer's first subscribed destination)
  o.MaxAutoRepairRequestsPerCheckpoint = 10;
  o.MaxAutoRepairRequestsPerAudit = 25;
  o.MaxAutoRebuildsPerAudit = 5;
  o.MaxCoverageGapReportsPerAudit = 100;     // both the query and the report loop are bounded
  o.MaxDrillDownTypesPerAudit = 10;
  o.MaxDigestsPerManifest = 500;

  // Convergence bounding (the IntegrityRepairLedger's dials)
  o.DivergenceReportCooldownMinutes = 60;    // unchanged divergence re-reports once per hour, not per cycle
  o.RepairRequestBackoffSeconds = 300;       // per-bucket retry base; each attempt doubles the wait
  o.MaxRepairAttemptsPerBucket = 8;          // then stop asking (reports continue); signature change resets

  // Phase S — subscription growth
  o.BackfillOnSubscriptionGrowth = true;
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

**Repair is a ladder, not a reflex.** The original proposal made `ReportOnly` the default release
posture: typed integrity events + metrics (a dedicated integrity health source is still planned —
none is registered as of a64ba9a), no writes, with `AutoRepairCapped` as the opt-in. The industry
lesson (repair storms taking down clusters that were merely *suspected* of divergence) is encoded
as: caps always on, every repair loudly attributed — and, as the revision below records, the
shipped default landed on `AutoRepairCapped` with `ReportOnly` as the opt-down.

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
wire activity), `backfills_requested` (Phase S), `redelivery_requests_received` (re-delivery
requests served as an origin — repair + backfill flows), and `digest_buckets_verified` +
`digest_drift_healed` (the trust-but-verify sweep — any drift healed means an unaccounted write
path touched audited rows and warrants investigation).
:::

---

## Bounded reconciliation — epochs, negotiated scope, seals

The phases above answer *"do two services hold the same events?"* correctly — but as originally
built, the **cost of asking grew with accumulated history** rather than with the size of the
discrepancy. This layer (designed in the
[bounded-integrity-reconciliation proposal](/proposals/bounded-integrity-reconciliation) after a
live deployment paid a year's history per audit) changes the asymptote: the exchange becomes
proportional to **what is missing**, verified history is **sealed and never re-read on the hot
path**, and the expensive full verification is **scheduled at an idle hour**.

### Epoch seals (the substrate)

Each origin lane's sequence space is partitioned into fixed-width **epochs** (migration 092,
`integrity_epoch_width`, default 100 000). One immutable XOR fold per
`(origin lane, tenant, type, epoch)` bucket lives in `wh_digest_epochs`; a contiguous per-lane
**frontier** records how far closure has advanced, with the width **pinned per lane at first
close** (epoch identity is `floor(seq / width)` — a changed setting must never remap existing
boundaries).

Three deliberate design points:

- **Derived at closure, not on the write path.** The local lane's `commit_sequence` is stamped
  asynchronously after emit, so emit-time epoch assignment is impossible — and the emit chain is
  the hottest path in the system. Closure rides the maintenance cycle
  (`CloseDigestEpochsAsync`, bounded by `MaxEpochClosuresPerMaintenanceCycle`) and recomputes each
  epoch once; the emit chain is byte-identical to before.
- **The redelivery guard.** An epoch closes only when the lane's settled max lies beyond it AND no
  *unsettled* event sits inside its range — redelivery can land a **fresh** event carrying an
  **old** origin sequence, and a settled-max frontier alone would seal over it.
- **One canonical fold.** Close, refold (repair), and verify all read the same SQL function
  (`_wh_epoch_buckets`), so the fold predicates — ephemeral (`flags & 8`) and at-most-once
  excluded, mirroring the emit-chain digest fold — cannot drift apart across consumers.

### Answers come from seals, not scans

Type-level digest answers (`ComputeTypeDigestsAsync` and the windowed variants) compose sealed
epochs by XOR and fold **only the open window** live — O(open window), not O(store). Once sealed,
an epoch is **authoritative for answers**: re-verifying it per answer would re-buy the full-scan
cost the epochs exist to end. Detecting a bad seal is the sweep's job (below), and the regression
suite pins the semantics from both directions — a corrupted seal *must* flow into a
fully-covering answer, and must *not* leak into a partially-covering one (a seal is indivisible;
fringes fold live).

### Negotiated scope and the two-dimensional cursor

A windowed manifest exchange agrees on a **half-open sequence window `[since, until)`** — chosen
half-open so epoch boundaries align exactly and the answer's watermark (`ComputedThrough`, the
exclusive end actually covered, always capped at the origin's settled max) IS the next ask's
`since`. Stream-level answers additionally page by stream id (`MaxDigests` — the *asker's* memory
is the constraint — plus `ResumeAfterStreamId`); pages walk whole streams, and a non-null
returned cursor means the window is incomplete. A **quiet window still answers** (only an answer
can carry the watermark; silence would freeze the asker forever), and an engine that cannot
window falls back to the legacy full answer with **no watermark claimed**.

The consumer records its verified watermark per origin in `wh_integrity_seals` and advances it
only on a window that **provably** passed whole: every bucket matched, `ChunkCount == 1`, no
resume cursor. Chunks carry no assembly protocol, so a multi-chunk window still compares and
repairs — it just never certifies. The seal is GREATEST-monotonic (a replayed stale advance can
never re-open verified history), and steady-state audits ask windowed **from the seal**; the
sweep deliberately asks full history — it is trust-but-verify for exactly the state the seals
assume is fine, and a windowed sweep would be circular trust.

### Deficit repairs; mismatch alarms

Only a **deficit** (`localCount < originCount`) is repairable. Equal counts with differing folds
mean the consumer holds the same *number* of events with different *identity* — redelivery
re-ships what the origin has, dedup drops what the consumer already holds, the fold never moves,
and the repair loop can never converge (observed live as an unbounded redelivery storm). A local
*surplus* cannot be fixed by asking the origin for more, and local history is never auto-deleted
on a remote's say-so. Both still **alarm** (ledger + report + `reason` metric tag:
`deficit | identity_mismatch | local_extra`); neither mints a redelivery request. A deficit found
comparing a *windowed* manifest is a deficit **in that window** — the repair request carries the
range, so the origin re-ships a slice, never a stream's whole history.

### The scheduled sweep and the seal backstop

The full sweep moves off the every-Nth-audit counter onto the temporal engine
(`FullSweepCron`, default `"0 3 * * *"`): the heaviest verification runs at a configured idle
hour, with the default minute replaced by a **stable per-service splay** (FNV-1a of the service
name — `string.GetHashCode` is randomized per process and would re-randomize the very collisions
the splay prevents). The counter stands down only once the schedule actually registered
(`IntegritySweepScheduleState.CronActive`); no engine, a disabled cron, or a registration failure
all leave `FullSweepEveryNthAudit` in charge — the sweep is never silently lost.

Each sweep also runs the **seal backstop** (`verify_digest_epochs`, bounded by
`MaxEpochVerificationsPerSweep`): every closed epoch recomputed from the store, compared
bucket-for-bucket, refolded on drift. Non-zero drift means an unaccounted write path touched
sealed history — logged as the alarm it is. Epochs holding an unsettled arrival are skipped
whole, exactly like closure.

### Origin generation — seals survive legitimate mutation

A close-the-books truncation or a reclassification **legitimately changes** what a fold over
sealed history computes. The two mutation sites (migration 093) now refold the affected sealed
epochs **inline** — the origin's own answers are correct immediately, not next sweep — and bump
the **origin generation** (`integrity_origin_generation`), which rides every manifest. The
consumer-side guard (`integrity_seal_generation_guard`) is one atomic call: an unchanged
generation proceeds; a changed one **resets the seal once**, records the new generation, and
skips that comparison round (its windows were aligned to the old world) — the next audit
re-verifies from the beginning, cheaply, because the origin answers from epochs. Sealed-range
divergence *without* a generation change remains what it always was: damage.

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
  recompute self-verification. Multi-tenant isolation gets its own regression locks; the
  expected-vs-unexpected discriminator's lock rides its future implementation (the discriminator
  is not yet built as of a64ba9a).
- **Docs.** This proposal graduates alongside the implementation: behavior + configuration
  reference for `StreamIntegrityOptions`, the integrity event types, the health signal (planned —
  no integrity health source is registered as of a64ba9a), and an
  operations note (reading a mismatch report, running a manual audit, invoking re-delivery).
  Code↔docs↔tests linking per the standard: `<docs>` tags on all new public surface, `<tests>`
  tags where convention needs help, maps regenerated and link-validated.
- **Observability.** Meters: checkpoint gaps detected/confirmed, digest mismatches by class
  (expected/unexpected), events re-delivered, repairs deferred by caps, audit duration, digest
  self-verification drift. A health source that degrades on confirmed-unrepaired divergence is
  planned — not yet registered as of a64ba9a.

## Implementation status

**Every phase is implemented, shipped, and live-validated** on a real multi-service deployment:
continuity checkpoints ride the origin's own event topics with session keys, the incremental
digest table feeds the hierarchical manifest exchange, local coverage gaps rebuild under storm
caps, and repairs converge idempotently. The increments below are kept as the build record —
each amendment callout marks where live validation refined the original sketch.

### Build record

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
   and gap detection default ON; repair defaults to `AutoRepairCapped` (the revised self-healing
   default above — `ReportOnly` is the opt-down).
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
   (consumer-only streams) are never auto-deleted (taxonomy #5), but they are NOT yet reported
   either: extra detection needs the full manifest set and rides a later increment — as of
   a64ba9a only origin-reported buckets are compared.
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
   `AutoRepairCapped` (the revised self-healing default — `ReportOnly` is the opt-down). With
   R0–R1, B, and S, **every phase of this proposal is implemented**; the
   `ReportOnly` reports double as the dry-run for `AutoRepairCapped`. Graduation of this proposal
   into the behavior/configuration reference rides this PR's merge.
   :::
7. **Ladder completion** — AutoRepairCapped mode, dry-run, storm caps, operations doc.

   :::new
   **Closed**: `AutoRepairCapped` is implemented at every repair site (checkpoint gaps, audit
   divergences, local rebuilds); `ReportOnly` IS the dry-run (every report carries exactly what
   auto-repair would have done); storm caps exist at every rung.
   :::

8. **Bounded reconciliation** — epochs, negotiated scope, seals, deficit exchange, scheduled
   sweep, origin generation (the [proposal](/proposals/bounded-integrity-reconciliation),
   motivated by a live deployment whose audits paid a year's history to find nothing wrong).

   :::new
   **Built end to end** (see the *Bounded reconciliation* section above), in six increments:
   the epoch substrate + closure/refold primitives (migration 092, closure on the maintenance
   cadence); epoch-served type answers (sealed-epoch authority, sabotage-tested both
   directions); the negotiated half-open window + two-dimensional resume cursor (origin
   honoring, watermark on every chunk, quiet-window answers); the deficit/alarm taxonomy +
   range-bounded repair (only a deficit can converge under redelivery — the equal-count
   identity mismatch that stormed live now alarms instead of looping); the consumer seal store
   + windowed asking end to end (GREATEST-monotonic seals, single-chunk certification rule);
   the idle-time cron sweep with stable per-service splay + counter fallback, carrying the
   `verify_digest_epochs` seal backstop; and origin generation (migration 093 — the two
   legitimate fold-mutation sites refold sealed epochs inline and bump the generation; the
   consumer guard resets its seal once per change instead of alarming on deliberate history).
   Implementation refined the design in three places worth naming: windows are half-open
   `[since, until)` so epoch boundaries align exactly and the watermark IS the next `since`; a
   receiver certifies only single-chunk windows (chunks carry no assembly protocol, so seeing
   ALL of a window must be provable, not assumed); and mutation sites refold inline rather than
   waiting for the sweep, so an origin never serves stale seals between a close and 3 AM.
   :::

## Future work

- **Persist the origin set?** The checkpoint origin tracker is deliberately in-memory (a restart
  re-baselines), so after a fleet-wide deploy the FIRST audit usually runs only its local half —
  the cross-service exchange starts on the next cycle, once checkpoints have re-announced the
  origins. Persisting the origin set (a small table) would let the first audit exchange
  immediately, trading a startup-freshness guarantee for it.

### Original review questions

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
