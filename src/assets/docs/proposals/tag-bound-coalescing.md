---
title: Tag-Bound Policies & Message Coalescing
category: Architecture & Design
order: 36
tags: tags, coalescing, batching, audit, throughput, service-bus, policies, sliding-window
---

# Tag-Bound Policies & Message Coalescing

Whizbang's message tags (`MessageTagAttribute`) already give every message type a compile-time,
AOT-discovered **semantic classification** — "this is an audit record", "this is telemetry".
This proposal makes tags the binding point for **operational policies**: behaviors configured
per tag in the host, never declared as new attributes or fields on the message types themselves.
The first tag-bound policy is **coalescing** — a sliding-window batcher that folds tagged
outbox singles into composite envelopes — and the framework's own audit stream becomes its
first consumer.

:::planned
Unreleased design proposal, approved in principle. The audit building blocks (the `#507`
unattributed-context fix, the `ScheduledFor` safety floor, the `AuditEventsComposite` carrier)
land first; the generic tag-bound coalescer supersedes the audit-specific shipper before release.
:::

## Motivation

A measured production incident: a 350-job bulk import published its ~17,500 domain events as
~350 composite envelopes (efficient by design), but auditing emitted **17,677 individual
`EventAudited` transport messages** — one per inner event. On Azure Service Bus Standard,
where the whole namespace shares one per-second credit pool, that flood throttled every
consumer in the namespace: the import ran 3× slower than its historical baseline, and
interactive chat hops degraded from 0.4s to 10–21s. The audit records were then all
dead-lettered at the consumer anyway (a separate attribution bug, #507).

The audit stream needed to be **durable, not real-time**. But bolting a delay/batch knob onto
`EventAudited` — or introducing a dedicated `[Coalesce]` attribute — would continue a pattern
worth breaking: every new operational behavior accreting more metadata onto event contracts
(`[Ephemeral]`, `[RowTtl]`, `[StreamGroup]`, …). Events should declare **what they are** once;
**how the runtime treats them** should bind externally and evolve freely.

## Design

### Tags classify; policies bind

- A message type carries one or more tags (existing mechanism: subclass `MessageTagAttribute`,
  discovered by the `MessageTagDiscoveryGenerator`, registered AOT-safe in the
  `MessageTagRegistry`). Tags are semantic: `"audit"`, `"telemetry"`, `"notification-digest"`.
- A **policy** is configured in the host against a tag string:

```csharp{title="Binding a coalesce policy to a tag" description="Coalescing is configured against a tag string in host options — no new attribute, no new fields on the event type" category="Architecture" difficulty="INTERMEDIATE" tags=["Tags","Coalescing","Configuration"] framework="NET10"}
services.AddWhizbang(options => {
  options.Tags.Coalesce("audit", c => {
    c.SlideSeconds = 15;        // quiet-timer: resets on each new pending single
    c.MaxDelaySeconds = 120;    // hard freshness cap, oldest-first under continuous load
    c.MaxBatchCount = 500;      // inners per composite envelope
    c.Atomicity = FanoutAtomicity.Independent;  // one bad inner never dead-letters siblings
  });
});
```

- One vocabulary, many behaviors: future tag-bound policies (trace sampling, work-class
  priority, retention hints) bind to the same tags without touching a single message type.

### Reserved system tags and override precedence

- **Framework-internal tags carry the `sys-` prefix** (`sys-audit`, `sys-telemetry`, …),
  following the `$wb-system` / `wh_` naming family, and are exposed as constants
  (`SystemTags.Audit == "sys-audit"`). The `sys-` prefix is **reserved**: startup validation
  rejects application-declared tag attributes that mint new `sys-*` tags, so framework and
  application tag namespaces can never collide.
- **Built-in policies ship as defaults, never as locks.** Enabling a framework feature registers
  its tag binding with documented defaults; a host-supplied binding for the same tag **replaces**
  the built-in one entirely (last-registration-wins at the options layer, with the built-in
  always registered first). Overriding is the same API as declaring:

```csharp{title="Overriding the built-in audit coalesce binding" description="EnableAudit ships the sys-audit binding with defaults; a host binding for the same tag replaces it" category="Architecture" difficulty="BEGINNER" tags=["Tags","Coalescing","Audit","Configuration"] framework="NET10"}
services.AddWhizbang(options => {
  // Ships automatically with EnableAudit(): Coalesce(SystemTags.Audit) with
  // SlideSeconds=15, MaxDelaySeconds=120, MaxBatchCount=500, Independent.
  // Override by binding the same tag yourself:
  options.Tags.Coalesce(SystemTags.Audit, c => {
    c.SlideSeconds = 30;
    c.MaxDelaySeconds = 300;   // audit freshness relaxed to 5 minutes
  });
});
```

### Coalescing mechanics

Mint time — when an outbox message's type carries a tag with a coalesce binding:

1. The single is written to the outbox **in the same transaction as its cause** (durability is
   unchanged and immediate), stamped with `ScheduledFor = now + MaxDelaySeconds`. The floor
   makes it invisible to the normal claim pump until the deadline — **the safety net, not the
   mechanism**: if the coalescer never runs, singles ship individually at the deadline.
   Degraded is slower, never lost.

Ship time — a generic **coalesce worker** (one per service, all groups):

2. Runs a true sliding window per tag group: a quiet timer of `SlideSeconds` that resets
   whenever new pending singles arrive, firing on quiet — so a burst's entire tail coalesces
   and ships at burst-end. The `MaxDelaySeconds` cap forces an oldest-first ship under
   continuous arrivals.
3. On fire, it claims all pending singles for the group (regardless of their floor), folds them
   oldest-first into **raw-carry composite envelopes** (the AOT-safe idiom the redelivery pump
   established — no per-group code generation), capped at `MaxBatchCount` inners, and **in one
   transaction** writes the composite outbox row(s) and completes the folded singles. The
   composite ships immediately; the consumer's existing composite fan-out delivers each inner
   exactly as a single would have arrived.
4. Crash-safety falls out of the transaction: a single is either still pending (floor intact)
   or folded (composite exists) — never both, never neither.

### Hot-path isolation

Coalescing must be invisible — in cost, not just in results — to every message that does not
participate. During a burst, thousands of coalesce-pending singles sit in `wh_outbox` for up to
`MaxDelaySeconds`; the normal claim path must not evaluate, scan past, or be woken by them.

- **A real column, not metadata.** `wh_outbox` gains a nullable `coalesce_group` column, stamped
  at mint only for bound tags. Filtering must be index-served, so the group rides the row.
- **The hot index excludes them by definition.** The outbox eligible-scan partial index gains
  `AND coalesce_group IS NULL` in its predicate: coalesce-pending singles never *enter* the
  index the claim path scans. Non-coalesced traffic pays zero per-row filtering — the exclusion
  happens at index-membership time, and the claim SQL's shape is unchanged.
- **The coalesce worker gets its own tiny index.** A partial index on
  `(coalesce_group, created_at) WHERE coalesce_group IS NOT NULL AND processed_at IS NULL`
  serves the group scan; only coalesce-pending rows ever live in it.
- **No doorbell noise.** The empty→non-empty edge doorbell already counts only
  *schedule-eligible* pending rows, and coalesce singles are minted with a future
  `ScheduledFor` — so their arrival rings nothing and wakes no claim loop.
- **Deadline-degrade is an explicit release, not a query union.** Because matured singles are
  still outside the hot index, the safety floor works as a visible transition: the coalesce
  worker on recovery — with a maintenance-task backstop — *releases* rows past their deadline
  (`coalesce_group = NULL, ScheduledFor = NULL`), which moves them into the hot index and the
  normal pump ships them individually. The degrade is counted (OTel), never silent, and the hot
  index stays pure in both healthy and degraded states.
- **Validated like every hot-path SQL change** — the copy-table `EXPLAIN ANALYZE` experiment
  has already been run against a live dev database (120k-row outbox: 100k processed, 200
  eligible, 20k coalesce-pending):

  | Claim scan for 100 eligible rows | Today's index shape | Membership exclusion |
  |---|---|---|
  | Rows removed by per-row filter | 19,814 | 0 |
  | Buffers touched | 500 | 3 |
  | Execution time | 6.0 ms | 0.23 ms |

  The baseline degrades linearly with coalesce depth (every pending single is walked per poll,
  per instance); the proposed shape is flat. The worker's group scan returned 500 rows in
  0.47 ms from its own 808 kB partial index, and the release semantics were confirmed live
  (`coalesce_group = NULL` immediately surfaces rows to the claim query). One consequence for
  the claim SQL: the eligible CTEs add `AND coalesce_group IS NULL` so the planner matches the
  new index predicate — locked by regression tests that a mixed batch claim returns zero
  coalesce-pending rows while released rows ship normally.

### Semantics and guardrails

- **Independence by default.** Coalesce groups are for self-contained records. Default
  `Atomicity = Independent`; `Atomic` is opt-in for groups that genuinely want all-or-nothing.
- **Ordering.** Folding is oldest-first and composites ship in order. Messages that participate
  in same-stream causal sequences should not be coalesced; an analyzer warning flags a
  coalesce-bound tag on a stream-sequenced event type.
- **Ambiguity is an error.** A message type whose tags match more than one coalesce binding
  fails startup validation (the `WHIZ134` precedent) — silent first-match-wins is how policy
  drift hides.
- **`SlideSeconds = 0`** disables the group: singles ship immediately with no floor, exactly
  today's behavior.

### Audit as the first consumer

`EventAudited` carries the built-in `SystemTags.Audit` tag (`"sys-audit"`);
`AddSystemEvents(o => o.EnableAudit())` registers that tag's coalesce binding with the defaults
above, and a host binding for `SystemTags.Audit` overrides it (see *Reserved system tags*). The
framework dogfoods the public feature — there is no audit-specific shipping code. Combined with the #507 attribution fix (system events establish an unattributed
context rather than dead-lettering), the incident above becomes: ~350 import composites ship in
real time, chat never notices, and the complete audit trail follows as a handful of composite
envelopes within two minutes — durable from the moment each audited event committed.

## Build increments

1. `#507` fix + `ScheduledFor` safety floor + `AuditEventsComposite` carrier (in flight).
2. Coalesce policy options + tag binding + startup ambiguity validation + the `coalesce_group`
   column, hot-index predicate change, and worker index (EXPLAIN-ANALYZE-validated).
3. The generic coalesce worker (sliding window, transactional fold, raw-carry composites).
4. Audit rebased onto the generic binding; audit-specific pieces deleted.
5. Analyzer warning for coalesce-bound tags on stream-sequenced types.
6. OTel: pending-per-group gauge, folds/ships/deadline-degrades counters, coalesce latency histogram.

## Related Documentation

- Message Tags — the classification substrate this binds to
- Audit Logging — the first tag-bound consumer
- Composite Events — the fan-out mechanics composites ride
