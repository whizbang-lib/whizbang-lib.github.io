---
title: Message Priority and Work Classes
category: Architecture & Design
order: 38
tags: priority, work-classes, quality-of-service, fairness, starvation, interactive-workloads, bulk-import, claim-worker, lanes, bulkheads, traffic-classes, hooks
---

# Message Priority and Work Classes

**A message carries the priority its producer declared; each consumer decides the priority it processes at; a stream is scheduled by the fold of its pending rows; the claim, the drain, the gate, and the transport honor the bucket that priority falls in; every one of those decisions is a hook a developer can replace.**

:::planned
**Proposal.** Nothing here is implemented. It composes with three accepted designs: the true-edge doorbell (idle latency), transport traffic classes (broker isolation), and tag-bound coalescing (supersedable traffic). This proposal covers the piece all three left out: contention latency, an interactive hop queued behind bulk work that is actively draining.
:::

## 1. The problem, measured

The framework drains every inbox in arrival order. A conversational service that also subscribes to a domain's events receives a user's command into the same inbox that a bulk ingest elsewhere in the system is filling with tens of thousands of fan-in events. The command is stored promptly and then waits its turn:

| observation | value |
|---|---|
| command stored | promptly, unclaimed, attempts 0 |
| rows ahead of it in the same inbox | about 42,000 |
| rows arriving | about 38 per second |
| rows completing | about 9 per second |
| time until the command was answered | 17 minutes |
| time the model took once claimed | 2 seconds |

Nothing malfunctioned. The acceptor pool grew on demand, the service drained at its normal rate, and the command was answered when the backlog reached it. From the user's chair the service was down for a quarter of an hour, and the cause was work the user did not create.

Three properties of the incident shape the design:

1. **Same type, different urgency.** A job-creation event produced by a user editing one record and the same event produced by an import saga creating hundreds are indistinguishable by type. Urgency is a property of the message's origin, not its schema.
2. **Same message, different urgency per consumer.** The service that owns the domain needs its own events promptly. A downstream service that keeps a secondary read model of them does not; for it, every job event is background, however it was produced.
3. **Order within a stream is not negotiable.** Per-stream FIFO is a framework invariant. Priority can only reorder *between* streams, never within one.

The framework already contains the pieces of a solution, applied to other axes: a fresh-versus-retry weighted share in the claim (migration 126, added after a 28,000-row retry backlog put a new user stream "hours out"), breadth-first ordering across streams (#568), a strictly ranked scheduler for housekeeping, tag-bound routing of a class to its own broker namespace, and tag-bound coalescing. None of them knows what an interactive message is.

## 2. Prior art

**In this repository**

- `plans/audit-event-perspective-priority.md` proposed perspective tiers: opt-in low priority for audit projections, the budget split done in the claim SQL rather than by sorting in C#, and a 5 to 10 percent floor so the low tier never starves. It targets a function that has since been folded into `claim_work`, and it covers perspectives only. This proposal subsumes it.
- The true-edge doorbell proposal listed priority as explicitly out of scope: "declared per message type, ordering between streams (never within one), plus a reserved drain lane." That is this proposal, with one correction: declaration per type is not enough (property 1 above).
- The transport traffic classes proposal binds tags to broker namespaces (`RouteNamespace("bulk-import", "bulk")`) for isolation of the credit pool. It is the transport half of a lane; this proposal supplies the classification that decides which lane a message belongs in and the claim half inside the database.
- A rank-aware guard inside `claim_work` was attempted once and rolled back after a saga-completion regression. Any change to the claim carries that regression test.

**In the industry**

- Brokers mostly do not offer per-message priority. Azure Service Bus, SQS, and Kafka have none; the documented pattern (the Azure Architecture Center's Priority Queue pattern) is separate queues per class with more consumers on the urgent one. RabbitMQ offers native priority queues and its documentation warns that strict priority starves the low levels.
- Database work queues put priority in the claim: `ORDER BY class, enqueued_at` with `SKIP LOCKED`, partial indexes per class, and an aging term so old low-priority rows eventually win.
- Schedulers solved starvation with weighted fair queuing and deficit round robin: every class gets a guaranteed share of each cycle by weight, not a strict order.
- Overload engineering propagates a criticality label in the request context, callees may lower it and never raise it silently, and admission control and load shedding read the label. Bulkheads (separate pools per class) protect latency better than ordering alone, because a stalled bulk transaction cannot occupy the interactive class's connections.
- Recent workflow engines add exactly the two dimensions this proposal needs: a priority per task and a fairness key with weights, both enforced by the server-side matcher.

The consensus: classify at the edge, propagate, weight rather than order strictly, always keep a floor, and isolate pools.

## 3. Design

### 3.1 A priority number on every message, a bucket for everything that schedules

| | who sets it | where it lives | who reads it |
|---|---|---|---|
| **declared priority** | the producer, from dispatch context, a declared rule, or the producer hook | the envelope: one integer, lower is more urgent | the consumer's receive hook |
| **effective priority** | the consumer, at its receive boundary, and again over each claimed batch | a `priority` column on `wh_inbox`, `wh_outbox`, and `wh_perspective_events`, plus three per-bucket pending counters on the stream's active-streams row | the claim, the batch hook, the drain, the gate, the transport lane, the meters |

Two layers, kept distinct on purpose:

**The number is the declaration.** Producers, consumers, inheritance, and aging all work in one integer space, so an override is arithmetic, aging is a decrement, and "a little more urgent than an ordinary interactive message" is a smaller number. Named constants cover the common cases and sit in the middle of their band, so a declaration can move in either direction without changing bucket:

| constant | value | band | meaning | examples |
|---|---|---|---|---|
| (reserved) | `0` | control plane | the framework's own signals; nothing a producer declares can reach it | `sys-control` |
| `WorkPriority.Interactive` | `50` | `1` to `99` | a person or a synchronous caller is waiting | a user command, its direct cascade, a saga's completion signal the UI shows |
| `WorkPriority.Standard` | `150` | `100` to `199` | domain work with no one waiting | ordinary events between services |
| `WorkPriority.Background` | `250` | `200` and up | work that exists because of volume or maintenance | bulk ingest fan-in, replays, rebuilds, audit, recovery re-drives |

**The bucket is the scheduling class.** `bucket(priority)` maps the number onto the three bands, and everything that needs a bounded set of queues works on the bucket: the deficit round robin and its floors, the claim's partial indexes, the transport lane, the gate and pool reservations, the meters. Weighted fair queuing does not work over a continuum; it needs a handful of queues with weights, and three plus the control plane is the smallest set that can still say "no one is waiting but it is not bulk". Inside a bucket the number orders streams, and aging applies inside the bucket too (section 3.4), so a stream declared 250 cannot hold one declared 299 behind it forever; the floor protects the bucket, aging protects the tail within it. If a fourth bucket is ever needed, "Deferred" for replays and rebuilds is the candidate; nothing here precludes it.

The number travels on the envelope as one small field (in place of the two flag bits an earlier draft proposed), and the effective number gets its own column because it is a per-consumer decision, not a property of the message, and because the claim SQL indexes it. The meters report the bucket everywhere and the raw number only in traces, so the meaning stays legible: a dashboard says "Interactive", not "137".

### 3.2 Declaration: the producer knows the origin

The dispatcher stamps the declared priority from context it already has; this is the default implementation of the producer hook (section 3.9):

- A command arriving at a synchronous boundary (an HTTP or GraphQL mutation, a SignalR call) is `Interactive`.
- Work dispatched by a saga's item handlers, a replay, a rebuild, a scheduled job, or the maintenance workers is `Background`.
- Everything else is `Standard`.

A producer may declare explicitly when the context is ambiguous, through the same tag surface that already binds coalescing and namespace routing, with a constant or any number in a band:

```csharp{
title: "Declaring a priority for a producer's message types"
description: "Tag-bound declaration on the host options, mirroring RouteNamespace and Coalesce; the framework's context-derived default applies to everything not listed, and the producer hook is the general form behind this sugar."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["work-class", "priority", "tags", "configuration"]
unverified: "proposal, not implemented"
}
services.AddWhizbang(options => {
  options.Tags.DeclarePriority("bulk-import", WorkPriority.Background);
  options.Tags.DeclarePriority("user-session", WorkPriority.Interactive);
  // A number anywhere in a band is valid: more urgent than an ordinary interactive message, same bucket.
  options.Tags.DeclarePriority("permission-revoked", WorkPriority.Interactive - 40);
});
```

**Inheritance.** A cascade child is declared with its parent's *effective* number at the handling service. A message produced while handling background work is background, even if its type is one a user normally triggers. A child can never be declared more urgent than its parent by inheritance alone; only an explicit declaration (a rule or the producer hook) can raise it, and that is recorded.

### 3.3 Classification: the consumer knows its own role

At the receive boundary, before `store_inbox_messages`, the consumer applies its policy and records the effective number. This is the receive hook (section 3.9); the rules below are its sugar:

```csharp{
title: "A consumer's ingress policy"
description: "Rules by namespace, by type, or by predicate decide the effective priority; the default accepts the declared number. The predicate form covers content-dependent cases."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["work-class", "ingress-policy", "routing", "configuration"]
unverified: "proposal, not implemented"
}
services.AddWhizbang(options => {
  // Everything from the job domain is background for this service, whatever the producer said.
  options.Routing.ClassifyNamespace("Contracts.Job", WorkPriority.Background);

  // A consumer may raise or lower by declared policy; both are recorded. Never by inheritance.
  options.Routing.ClassifyType<PermissionRevokedEvent>(WorkPriority.Interactive);

  // Content-dependent: a predicate over the envelope and payload; null keeps the declared number.
  options.Routing.Classify((envelope, payload) =>
    payload is JobCreatedEvent { Source: JobSource.Import } ? WorkPriority.Background : null);
});
```

The default policy is "accept the declared number," so a service that declares nothing behaves as today plus the framework's context-derived defaults. The domain-owning service therefore processes its own interactive messages first; a secondary consumer of the same messages processes them as background. Each consumer is in control of its own situation: lowering and raising are both allowed by a declared rule or the receive hook, and the audit trail records both numbers.

Classification is positive: a rule or hook that does not match leaves the declared number in place. A lookup miss must never land a message in the urgent bucket by default. The command lane's first outing showed why: composite children whose types a consumer never handled were stored as commands because a catalog miss defaulted the wrong way, and a consumer's fast lane filled with rows it would discard (#736).

Classification runs where the transport hands the message over, which is also where a transport lane decision belongs (section 3.6): a policy that marks a namespace background on a given consumer can also route that namespace to a separate subscription for that consumer.

### 3.4 The claim: weighted shares with a floor and aging

The claim is where contention latency is decided, and it has to happen in SQL, inside `claim_work`, `claim_orphaned_inbox`, and the perspective claim, because a C# sort over rows the SQL already chose cannot reach the flood.

**The stream is the unit.** Per-stream FIFO means the scheduler never picks a row; it picks a stream and takes that stream's rows in order. A stream with ten pending rows at several priorities therefore needs one number, folded from all of its pending rows, and the fold is a declared policy:

| fold | the stream's priority is | when to use it |
|---|---|---|
| `MostUrgent` (default) | its most urgent pending row | an interactive row queued behind bulk rows on the same stream pulls the stream forward; its predecessors are prerequisites, and the waiting person cannot be answered any other way |
| `LeastUrgent` | its least urgent pending row | a stream known to be a bulk carrier, where one urgent row must not drag a long tail of bulk rows into the fast lane |

The fold runs in two places, and neither queries anything:

- **In the claim, over counters.** The inbox store increments one of three per-bucket pending counters on the stream's active-streams row as it inserts, completion decrements it, and the claim reads the counters on a row it already joins. The SQL fold is `least` (or `greatest`) over three integers. Recomputing a stream's priority over its rows at claim time would be the per-stream probe cost #714 removed, so the counters are the design, not an optimization.
- **In memory, over the batch.** The claim returns rows grouped by stream, so folding each stream's exact numbers is a pass over rows the worker already holds. That fold sets the dispatch order within the batch and is what the batch hook (section 3.9) sees and adjusts.

The existing fresh-versus-retry merge generalizes into a deficit round robin across buckets:

- Each bucket has a weight (interactive highest) and a floor. A batch is filled by weight; a bucket with pending streams always receives at least its floor, so background never starves and audit backlogs never grow without bound (the perspective-tier plan's 5 to 10 percent).
- Within a bucket, streams order by their folded number, then by the existing breadth-first order (each stream's Nth row competes with other streams' Nth rows), and the fresh-versus-retry share stays as the inner merge.
- **Aging is a wait target per bucket, not a rate.** The framework holds a target per bucket (interactive about a second, standard tens of seconds, background minutes), adapted from the measured drain, and a producer or consumer may declare its own. A stream's effective number falls as its oldest pending row ages against that target, so aging works inside a bucket (a 299 catches up with a 250) and across bands (a background stream that has waited past its target is promoted). Every promotion is counted.
- Per-stream FIFO is untouched. Priority reorders streams, never rows within a stream.
- The same budget is per work category: the per-category outstanding cap the acquisition bound calls for (`plans/inbox-acquisition-bound.md`, cycle 11) is the same accounting, so one perspective backlog cannot consume the whole window and starve inbox acquisition.

The weights and the targets are not knobs. They adapt from measured per-bucket backlog age against the per-bucket target: when interactive age exceeds its target, interactive weight rises until it does not; when it is idle, its share flows to the others. The operator sees the targets and the measured ages, not a weight table.

### 3.5 Bulkheads: the gate and the pool honor the bucket

Ordering alone does not protect latency when the shared resources are held by stalled bulk work. Two reservations follow the bucket:

- The work coordinator gate reserves a slice of its permits for `Interactive` callers. Background work can never take the last interactive permit.
- The connection pool reserves a small number of connections for interactive and control traffic (the control plane already has the pinned pool for this shape). A batch of bulk commits waiting on the database cannot exhaust the connections an interactive command or a heartbeat needs.

Both are the same shape as the drain-width clamp that already exists: a share of a shared resource that one bucket cannot consume entirely.

### 3.6 Lanes on the transport

For consumers whose background traffic dwarfs their interactive traffic, the claim lane is not enough: the background rows still arrive through the same subscription and occupy the same receive sessions. The transport traffic classes proposal already routes a tag to its own broker namespace. This proposal adds the bucket as a routing key: a consumer's policy can route `Background` (or a namespace it classifies as background) to a separate subscription with its own concurrency, so interactive receives never wait on bulk receives. Ordering and transactionality are unaffected: a bucket is an independent stream of streams.

### 3.7 Supersedable traffic coalesces

Tagged notifications and other "send the latest, drop the rest" signals are neither interactive nor background: they are supersedable. The tag-bound coalescing mechanism already exists for audit. Under load, notification tags coalesce per tag with a short slide window, so a burst of ten thousand refresh signals becomes one per tag per window. This is a policy binding, not a new mechanism, and it removes the largest source of front-end saturation during an ingest.

### 3.8 Fairness across tenants (second phase)

The bucket is one axis. The other is who the work belongs to: one tenant's ingest must not starve another tenant's interactive session even within the same bucket. Every row already carries a scope. The deficit round robin extends to a second key (bucket, then scope) with weights per tenant, the same construction recent workflow engines call a fairness key. It is a second phase because it multiplies the budget's dimensions and needs its own measurements.

### 3.9 Hooks: every policy above is replaceable

The tag rules in sections 3.2 and 3.3 and the aging in 3.4 are the defaults of three hooks. A developer whose case the provided options do not fit writes the policy; the framework keeps the invariants.

| hook | runs | sees | may set |
|---|---|---|---|
| **producer** | at dispatch, as a lifecycle stage of the dispatcher | the envelope, the payload, the dispatch context (boundary, saga, replay, schedule), the parent's effective number | the declared number |
| **receive** | at the consumer's receive boundary, before the store | the declared number, the envelope, the payload, the consumer's own state | the effective number stored on the row |
| **batch** | after each claim, before dispatch order is decided | the batch as streams with their folded numbers, oldest ages and per-bucket counts; a read-only view of the pending counters | a stream's effective number for this batch |

The batch hook is where dynamic policies live: decay with age and then bump back when work of some type arrives, hold a stream back while a related one is in flight, or apply a rule the defaults never anticipated. The API sets a stream's number, never a row's position, so per-stream FIFO is an invariant no hook can break.

Each hook is a pure function over a context object, which is what makes a policy unit-testable without a database and composable with the framework's own tests. The defaults (context-derived declaration, inheritance, "accept the declared number", the wait-target aging) are ordinary implementations that can be replaced or wrapped, and the meters record every change a hook makes, so a custom policy is as visible as the framework's.

## 4. Observability

Everything the scheduler decides is visible through the passive meters:

- backlog age and pending rows per bucket per service (the existing backlog-age meter gains a `work_class` tag holding the bucket)
- claim cycles per bucket with streams claimed and floor invocations
- declared-versus-effective divergences per consumer (how often policy lowered or raised)
- adjustments per hook per bucket (producer, receive, batch), so a custom policy is visible
- aging promotions per bucket, within a band and across bands
- gate and pool reservations hit

The health source flips when interactive backlog age exceeds its target for a sustained window, which is the user-visible symptom this proposal exists to prevent.

## 5. What changes, what does not

| unchanged | changed |
|---|---|
| per-stream FIFO | order between streams within a claim batch |
| the envelope schema, apart from one integer field | a `priority` column on inbox, outbox, perspective events, and three per-bucket counters on active streams |
| routing by namespace | routing may also select a lane by bucket |
| coalescing mechanism | notification tags bound to it by default |
| fresh-versus-retry fairness | becomes the inner merge of a bucket-level budget |
| gate and pool sizes | a reserved share per bucket inside them |

### Alternatives considered

| alternative | why not |
|---|---|
| Priority by message type only | The same type is interactive or bulk depending on origin (property 1). |
| Producer-only classification | The domain owner and a secondary consumer need different classes for the same message (property 2). |
| Consumer-only classification | The consumer cannot see origin; only the producer knows a saga created the row. |
| Strict priority (interactive always first) | Starves background; audit and recovery backlogs grow without bound. Every scheduler that shipped strict priority added a floor later. |
| Separate queues only, no claim change | Fixes the transport hop; the inbox still drains in arrival order. |
| A C# sort after the claim | The SQL chose the rows; the flood is already in the batch. The perspective-tier plan reached the same conclusion. |
| Hand-tuned weights | Every knob is a future incident. The owner's standing preference is adaptive tuning. |
| A closed vocabulary only (three names, no number) | No room between values; an override, a "slightly more urgent", and aging all need arithmetic, and a second vocabulary would follow the first. |
| A number only, no buckets | Fair queuing needs a bounded set of queues with weights and floors; a continuum cannot have a floor. The number orders inside a bucket; the bucket schedules. |
| Fold the stream's priority at claim time over its rows | That is the per-stream probe cost #714 removed. The counters are maintained where rows are already written. |
| Fixed policies, no hooks | Every case the options do not fit becomes a framework change; a hook keeps the invariants and hands the rest to the developer. |

## 6. Test plan

Every increment ships red first. The suite states the contract:

- **One command, one cycle.** 10,000 background rows across a few streams, then one interactive command on a new stream: the next claim cycle includes the command. Repeated with the command inserted while a drain is in progress: its completion latency is bounded by one batch, not by the backlog.
- **Floor.** 10,000 interactive rows and 100 background rows: background rows still complete at the floor rate; the background backlog never grows across cycles.
- **Aging.** A background row older than the aging bound is claimed ahead of younger interactive rows.
- **Stream FIFO.** Rows of one stream are claimed in order regardless of their priorities.
- **Stream fold.** With the default fold, an interactive row behind nine background rows on one stream brings the whole stream into the next interactive claim; with `LeastUrgent` declared, the same stream waits with the background bucket. The counters on the active-streams row equal a recount of the pending rows after every store and every completion.
- **In-bucket aging.** Two background streams declared 250 and 299, the 299 older than the bucket's target: the 299 is claimed first.
- **Hooks.** Each hook is exercised in isolation over a context object and then through the pipeline: a producer hook that declares by payload, a receive hook that lowers a namespace, a batch hook that decays and bumps a stream; every adjustment appears in the meters; no hook can change the order of rows within a stream.
- **Inheritance.** A child dispatched while handling a background parent is declared background; an interactive parent's child is interactive; a child never exceeds its parent without a declared rule.
- **Policy.** A consumer that classifies a namespace background stores those rows as background while the producer's row shows interactive; a raise rule is recorded; a rule that does not match leaves the declared number in place (a miss never promotes).
- **Bulkheads.** With the gate saturated by background callers, an interactive caller acquires within the reserved share; with the pool exhausted by stalled bulk commits, a heartbeat and an interactive command still get a connection.
- **Regression.** The saga-completion scenario that rolled back the earlier rank-aware guard (all items complete, no double completion) runs against the class-aware claim.
- **Partition independence.** Bucket budgets are computed per instance over rows that instance is eligible to acquire, so a skewed partition space cannot hide a class from an instance.

## 7. Rollout

1. The envelope field, the column, the per-bucket stream counters, stamping from dispatch context, inheritance, and the three hooks with their default implementations. No scheduling change; every row now carries both numbers and the meters show them.
2. The tag surfaces (declare, classify, fold) as sugar over the hooks, and the default "accept the declared number" policy.
3. Bucket-aware claim budget with floor, the stream fold over the counters, and wait-target aging in `claim_work`, `claim_orphaned_inbox`, and the perspective claim; the per-category outstanding cap with it.
4. Gate and pool reservations.
5. Transport lane by class on top of namespace routing.
6. Notification tags bound to coalescing by default.
7. Tenant fairness key.

Each step is independently shippable and independently measurable by the meters added in step 1.

## 8. Decisions

Settled in review (2026-09-09); the earlier open questions and their answers:

- **May a consumer raise a priority?** Yes. Lowering and raising are both allowed by a declared rule or the receive hook, never by inheritance, and both are recorded. Each consumer is in control of its own situation; a producer's number is advice with a good default, not a ceiling.
- **Does the producer declare explicitly, or does the framework derive only from context?** Both: the framework derives by default (the producer hook's default implementation) and the tag surface or a custom hook declares for the ambiguous cases.
- **How many classes?** A number with three buckets plus the reserved control plane. The number gives fine ordering and arithmetic inside a bucket; the buckets give fair queuing its bounded set of queues. More buckets add round-robin queues, partial indexes and floors for little gain; a fourth ("Deferred") is possible if a case demands it.
- **How is a stream's priority decided when its rows differ?** By a declared fold over all of its pending rows: `MostUrgent` by default, `LeastUrgent` for bulk carriers, maintained as per-bucket counters so the claim never queries for it.
- **Where does the aging bound come from?** A wait target per bucket, defaulted by the framework from the measured drain, declarable by the producer, overridable by the consumer, applied inside a bucket and across bands.
- **What if the provided policies do not fit?** The producer, receive and batch hooks; the provided policies are their default implementations.

## Related proposals and issues

- Transport traffic classes and multi-namespace routing (the transport half of a lane)
- Notify on the true edge (idle latency; lists contention latency as this proposal's scope)
- Tag-bound coalescing (the supersedable class)
- `plans/audit-event-perspective-priority.md` (perspective tiers; subsumed here)
- `plans/inbox-acquisition-bound.md` (per-category outstanding cap; the same accounting)
- Issues: #721 (interactive commands starve behind bulk fan-in), #736 (a classification miss filled the command lane), #720 (notify commit serialization), #719 (unbounded in-process acquisition), #714 (claim cost grows with the pending set), #724 (re-offer livelock), #725 (partition residue skew)
