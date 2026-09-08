---
title: Message Priority and Work Classes
category: Architecture & Design
order: 38
tags: priority, work-classes, quality-of-service, fairness, starvation, interactive-workloads, bulk-import, claim-worker, lanes, bulkheads, traffic-classes
---

# Message Priority and Work Classes

**A message carries the class its producer declared; each consumer decides the class it processes at; the claim, the drain, the gate, and the transport all honor that class.**

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

### 3.1 Two classes on every message: declared and effective

| | who sets it | where it lives | who reads it |
|---|---|---|---|
| **declared class** | the producer, from dispatch context | the envelope (`EventFlags` treatment bits, already on the wire and in the `flags` column) | the consumer's ingress policy |
| **effective class** | the consumer, at its receive boundary | a `work_class` column on `wh_inbox`, `wh_outbox`, and `wh_perspective_events` | claim, drain, gate, transport lane, metrics |

The vocabulary is small and closed:

| class | meaning | examples |
|---|---|---|
| `Interactive` | a person or a synchronous caller is waiting | a user command, its direct cascade, a saga's completion signal the UI shows |
| `Standard` | domain work with no one waiting | ordinary events between services |
| `Background` | work that exists because of volume or maintenance | bulk ingest fan-in, replays, rebuilds, audit, recovery re-drives |

The framework's control-plane traffic (`sys-control`) is already its own class with its own delivery semantics and is not part of this vocabulary.

Two bits of `EventFlags` encode the declared class on the wire (`Standard` is the absence of both), which costs no migration for outbox, inbox, or event store. The effective class gets its own column because it is a per-consumer decision, not a property of the message, and because the claim SQL needs to index it.

### 3.2 Declaration: the producer knows the origin

The dispatcher stamps the declared class from context it already has:

- A command arriving at a synchronous boundary (an HTTP or GraphQL mutation, a SignalR call) is `Interactive`.
- Work dispatched by a saga's item handlers, a replay, a rebuild, a scheduled job, or the maintenance workers is `Background`.
- Everything else is `Standard`.

A producer may declare explicitly when the context is ambiguous, through the same tag surface that already binds coalescing and namespace routing:

```csharp{
title: "Declaring a class for a producer's message types"
description: "Tag-bound declaration on the host options, mirroring RouteNamespace and Coalesce; the framework's context-derived default applies to everything not listed."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["work-class", "priority", "tags", "configuration"]
unverified: "proposal, not implemented"
}
services.AddWhizbang(options => {
  options.Tags.DeclareClass("bulk-import", WorkClass.Background);
  options.Tags.DeclareClass("user-session", WorkClass.Interactive);
});
```

**Inheritance.** A cascade child is declared with its parent's *effective* class at the handling service. A message produced while handling background work is background, even if its type is one a user normally triggers. A child can never be declared more urgent than its parent by inheritance alone; only an explicit declaration by policy can raise it, and that is recorded.

### 3.3 Classification: the consumer knows its own role

At the receive boundary, before `store_inbox_messages`, the consumer applies its policy and records the effective class:

```csharp{
title: "A consumer's ingress policy"
description: "Rules by namespace, by type, or by predicate decide the effective class; the default accepts the declared class. The predicate form covers content-dependent cases."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["work-class", "ingress-policy", "routing", "configuration"]
unverified: "proposal, not implemented"
}
services.AddWhizbang(options => {
  // Everything from the job domain is background for this service, whatever the producer said.
  options.Routing.ClassifyNamespace("Contracts.Job", WorkClass.Background);

  // A consumer may raise a class only by declared policy, never by inheritance.
  options.Routing.ClassifyType<PermissionRevokedEvent>(WorkClass.Interactive);

  // Content-dependent: a predicate over the envelope and payload.
  options.Routing.Classify((envelope, payload) =>
    payload is JobCreatedEvent { Source: JobSource.Import } ? WorkClass.Background : null);
});
```

The default policy is "accept the declared class," so a service that declares nothing behaves as today plus the framework's context-derived defaults. The domain-owning service therefore processes its own interactive messages first; a secondary consumer of the same messages processes them as background. Lowering is always allowed. Raising is allowed only by an explicit rule, and the audit trail records both classes.

Classification runs where the transport hands the message over, which is also where a transport lane decision belongs (section 3.6): a policy that marks a namespace background on a given consumer can also route that namespace to a separate subscription for that consumer.

### 3.4 The claim: weighted shares with a floor and aging

The claim is where contention latency is decided, and it has to happen in SQL, inside `claim_work`, `claim_orphaned_inbox`, and the perspective claim, because a C# sort over rows the SQL already chose cannot reach the flood.

The existing fresh-versus-retry merge generalizes into a deficit round robin across classes:

- Each class has a weight (interactive highest) and a floor. A batch is filled by weight; a class with pending rows always receives at least its floor, so background never starves and audit backlogs never grow without bound (the perspective-tier plan's 5 to 10 percent).
- Within a class, the existing breadth-first order across streams stays (each stream's Nth row competes with other streams' Nth rows), and the fresh-versus-retry share stays as the inner merge.
- An aging term lifts a row's effective class one step when it has waited longer than a bound derived from the observed drain rate, so a background row is never behind forever.
- Per-stream FIFO is untouched. Classes reorder streams, never rows within a stream.
- The same budget is per work category: the per-category outstanding cap the acquisition bound calls for (`plans/inbox-acquisition-bound.md`, cycle 11) is the same accounting, so one perspective backlog cannot consume the whole window and starve inbox acquisition.

The weights are not knobs. They adapt from measured per-class backlog age against a per-class latency target: when interactive age exceeds its target, interactive weight rises until it does not; when it is idle, its share flows to the others. The operator sees the targets and the measured ages, not a weight table.

### 3.5 Bulkheads: the gate and the pool honor the class

Ordering alone does not protect latency when the shared resources are held by stalled bulk work. Two reservations follow the class:

- The work coordinator gate reserves a slice of its permits for `Interactive` callers. Background work can never take the last interactive permit.
- The connection pool reserves a small number of connections for interactive and control traffic (the control plane already has the pinned pool for this shape). A batch of bulk commits waiting on the database cannot exhaust the connections an interactive command or a heartbeat needs.

Both are the same shape as the drain-width clamp that already exists: a share of a shared resource that one class cannot consume entirely.

### 3.6 Lanes on the transport

For consumers whose background traffic dwarfs their interactive traffic, the claim lane is not enough: the background rows still arrive through the same subscription and occupy the same receive sessions. The transport traffic classes proposal already routes a tag to its own broker namespace. This proposal adds the class as a routing key: a consumer's policy can route `Background` (or a namespace it classifies as background) to a separate subscription with its own concurrency, so interactive receives never wait on bulk receives. Ordering and transactionality are unaffected: a class is an independent stream of streams.

### 3.7 Supersedable traffic coalesces

Tagged notifications and other "send the latest, drop the rest" signals are neither interactive nor background: they are supersedable. The tag-bound coalescing mechanism already exists for audit. Under load, notification tags coalesce per tag with a short slide window, so a burst of ten thousand refresh signals becomes one per tag per window. This is a policy binding, not a new mechanism, and it removes the largest source of front-end saturation during an ingest.

### 3.8 Fairness across tenants (second phase)

Class is one axis. The other is who the work belongs to: one tenant's ingest must not starve another tenant's interactive session even within the same class. Every row already carries a scope. The deficit round robin extends to a second key (class, then scope) with weights per tenant, the same construction recent workflow engines call a fairness key. It is a second phase because it multiplies the budget's dimensions and needs its own measurements.

## 4. Observability

Everything the scheduler decides is visible through the passive meters:

- backlog age and pending rows per class per service (the existing backlog-age meter gains a `work_class` tag)
- claim cycles per class with rows claimed and floor invocations
- declared-versus-effective divergences per consumer (how often policy lowered or raised)
- aging promotions per class
- gate and pool reservations hit

The health source flips when interactive backlog age exceeds its target for a sustained window, which is the user-visible symptom this proposal exists to prevent.

## 5. What changes, what does not

| unchanged | changed |
|---|---|
| per-stream FIFO | order between streams within a claim batch |
| the envelope schema (two flag bits already carried) | a `work_class` column on inbox, outbox, perspective events |
| routing by namespace | routing may also select a lane by class |
| coalescing mechanism | notification tags bound to it by default |
| fresh-versus-retry fairness | becomes the inner merge of a class-level budget |
| gate and pool sizes | a reserved share per class inside them |

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

## 6. Test plan

Every increment ships red first. The suite states the contract:

- **One command, one cycle.** 10,000 background rows across a few streams, then one interactive command on a new stream: the next claim cycle includes the command. Repeated with the command inserted while a drain is in progress: its completion latency is bounded by one batch, not by the backlog.
- **Floor.** 10,000 interactive rows and 100 background rows: background rows still complete at the floor rate; the background backlog never grows across cycles.
- **Aging.** A background row older than the aging bound is claimed ahead of younger interactive rows.
- **Stream FIFO.** Rows of one stream are claimed in order regardless of their classes.
- **Inheritance.** A child dispatched while handling a background parent is declared background; an interactive parent's child is interactive; a child never exceeds its parent without a declared rule.
- **Policy.** A consumer that classifies a namespace background stores those rows as background while the producer's row shows interactive; a raise rule is recorded.
- **Bulkheads.** With the gate saturated by background callers, an interactive caller acquires within the reserved share; with the pool exhausted by stalled bulk commits, a heartbeat and an interactive command still get a connection.
- **Regression.** The saga-completion scenario that rolled back the earlier rank-aware guard (all items complete, no double completion) runs against the class-aware claim.
- **Partition independence.** Class budgets are computed per instance over rows that instance is eligible to acquire, so a skewed partition space cannot hide a class from an instance.

## 7. Rollout

1. Flag bits, column, stamping from dispatch context, inheritance. No scheduling change; every row now carries both classes and the meters show them.
2. Ingress policy surface and the default "accept declared" policy.
3. Class-aware claim budget with floor and aging in `claim_work`, `claim_orphaned_inbox`, and the perspective claim; the per-category outstanding cap with it.
4. Gate and pool reservations.
5. Transport lane by class on top of namespace routing.
6. Notification tags bound to coalescing by default.
7. Tenant fairness key.

Each step is independently shippable and independently measurable by the meters added in step 1.

## 8. Open questions

- **May a consumer raise a class?** Recommended: yes, only by an explicit declared rule, never by inheritance, and always recorded. The alternative (lower only) is simpler but leaves a consumer no way to prioritize a security event a producer marked standard.
- **Does the producer declare explicitly, or does the framework derive only from context?** Recommended: the framework derives by default and the tag surface allows explicit declaration for the ambiguous cases. A purely explicit model puts the burden on every producer; a purely derived model cannot see a producer's intent.
- **How many classes?** Three plus the existing control plane. More levels invite hand-tuning; fewer cannot express "no one is waiting but it is not bulk."
- **Where does the aging bound come from?** From the measured drain rate per class, so it is a latency promise rather than a row count.

## Related proposals and issues

- Transport traffic classes and multi-namespace routing (the transport half of a lane)
- Notify on the true edge (idle latency; lists contention latency as this proposal's scope)
- Tag-bound coalescing (the supersedable class)
- `plans/audit-event-perspective-priority.md` (perspective tiers; subsumed here)
- `plans/inbox-acquisition-bound.md` (per-category outstanding cap; the same accounting)
- Issues: #721 (interactive commands starve behind bulk fan-in), #720 (notify commit serialization), #719 (unbounded in-process acquisition), #714 (claim cost grows with the pending set), #724 (re-offer livelock), #725 (partition residue skew)
