---
title: Per-Namespace Command Inboxes
category: Architecture & Design
order: 38
tags: transport, inbox, commands, routing, service-bus, rabbitmq, topics, sessions, decomposition
---

# Per-Namespace Command Inboxes

Today every command in a deployment rides **one shared inbox topic** with one subscription per
service. Commands are point-to-point — exactly one service handles any given command type — but
the shared topic makes them broadcast at the broker: every service's subscription materializes,
receives, and completes (then discards) every command in the fleet. This proposal decomposes the
inbox by **contract namespace**, mirroring the topology the event side already uses, on both the
Azure Service Bus and RabbitMQ transports.

:::planned
Unreleased design proposal. Intended to ship **together with Transport Traffic Classes &
Multi-Namespace Routing** (order 37) as one transport-topology arc for both Service Bus and
RabbitMQ — the two proposals touch the same provisioning and routing surface, traffic classes
supply the namespace-level isolation, and per-namespace inboxes are the routable unit those
classes assign.
:::

## Motivation — a measured import

During a bulk import on a Standard-tier Service Bus namespace (~1,000 credited operations/sec,
namespace-wide), a per-entity decomposition of the operation counters showed:

| Share | Entity |
|---|---|
| **75%** | the shared `inbox` topic |
| ~25% | all domain-event topics combined |

One imported item's command cost roughly 15–25 broker operations: one send, then the broker
copied it into **twelve** subscriptions, and twelve consumers each paid session-accept,
receive, and complete operations — eleven of them only to discard the message at the receive
boundary. The import ran unthrottled for its first ~90 seconds, then the operation burst
crossed the credit ceiling, throttling engaged, and retry-backoff paced throughput to roughly
a third of its initial rate. The domain events — the traffic that *legitimately* fans out —
were never the problem.

The shared-inbox tax scales with **subscription count × command volume**, so it worsens as a
deployment adds services, silently and quadratically-ish. Point-to-point messages must stop
paying broadcast prices.

## Design

### Routing derives from the type — no routing table

The transport already names event topics after contract namespaces. Commands get the same rule:

- **Publish side:** a command's own CLR namespace determines its inbox entity
  (`inbox.<contract-namespace>`). The publisher always knows its message's type — no knowledge
  of consumers required.
- **Consume side:** each service derives its inbox subscriptions from its **receptor registry**
  — the same generated source of truth the receive-side dispatch already uses. A service
  handling commands from K contract namespaces subscribes to exactly those K inbox entities.

Both ends are self-service; neither holds a cross-service routing table. A command whose
namespace only one service handles costs **1 send + 1 receive + 1 complete** — the shared-inbox
multiplier is gone, against the same credit pool.

### The routing strategy owns every topology decision

The seam already exists — today's shared inbox is literally the default
`IInboxRoutingStrategy` (`SharedTopicInboxStrategy`), and `IOutboxRoutingStrategy` already
resolves publish destinations per message type and kind. This proposal widens that seam so
**every** topology decision flows through one strategy, and everything else — publishers,
provisioners, the composite splitter, subscription sync, analyzers, acceptor budgeting — asks
it instead of encoding its own rules:

- **Publish side (exists, extended):** `GetDestination(messageType, kind)` answers for every
  kind — events to domain topics, commands to their inbox entity, system/broadcast types to
  the system inbox. Broadcast classification lives *inside* the strategy so publish and
  subscribe sides agree by construction.
- **Consume side (widened):** `GetSubscription(ownedDomains, serviceName, kind)` becomes
  plural and registry-driven — `GetSubscriptions(context)` where the context carries the
  service's **handled** message metadata (receptor registry), not just its owned domains. The
  namespace implementation returns one subscription per handled contract namespace plus the
  system inbox. (The existing `DomainTopicInboxStrategy`, which subscribes only the *primary
  owned* domain, is superseded by this implementation.)
- **Composite split key (new):** `GetCompositeGroupKey(constituentType, kind)` with the
  invariant *same key ⇔ same destination* — the default implementation simply delegates to
  `GetDestination`, so the splitter can never disagree with the router.
- **Provisioning manifest (derived):** the provisioner takes the union of publish destinations
  across the message catalog and the strategy's subscription set — no entity exists that the
  strategy didn't name, and nothing the strategy names is missing. A helper materializes this
  as a topology manifest for startup provisioning and for drift checks.
- **Budget input (derived):** the subscription count per service feeds the acceptor-budget
  scaling, so machinery cost follows topology automatically.

All inputs come from the generated catalogs and registries (no reflection — AOT holds). The
invariant that makes the seam sound: **route, split, subscribe, and provision are all
projections of `GetDestination`** — one function, four consumers, impossible to skew.

Ownership enforcement (one service per command type) has two candidate enforcement points:
a contracts-level analyzer where all handler registrations are visible at build time, and a
startup/topology drift check that flags a second service subscription appearing on a command
inbox entity. The proposal carries both; the census decides whether build-time visibility is
sufficient.

### Transport mapping

| Concern | Azure Service Bus | RabbitMQ |
|---|---|---|
| Inbox entity | Topic `inbox.<contract-namespace>`, one subscription per handling service | Direct/topic exchange with routing key `inbox.<contract-namespace>`, one queue per (service, namespace) binding |
| Ordering | Sessions (session id = stream id), per entity | Single-consumer per queue + per-stream serialization in the work pump |
| DLQ | Per-subscription DLQ (now per contract area) | Per-queue DLX (now per contract area) |
| Provisioning | Same turnkey auto-provisioning, per entity | Same, exchange + queue + binding |

Both transports implement the same contract; the transport-tier E2E harness runs the same
scenarios against both.

### What stays

- **Discard-at-receive-boundary** remains as the safety belt — routing becomes the reason it
  rarely fires, not a replacement for it.
- **Inbox idempotency** (store-side dedup by message id) remains — and is what makes the
  migration's dual-delivery window safe.
- **System messages get one dedicated broadcast inbox.** Genuinely all-services traffic
  (run-control, killswitches, rebuild/reseed system commands) is broadcast by nature, so it
  belongs on a broadcast entity: a single `inbox.<framework-namespace>` topic that every
  service subscribes to. One send + N deliveries — versus N sends if copies were fanned into
  every per-namespace inbox, which would also re-mix the per-area DLQs this proposal just
  untangled. Because framework composite envelopes and system commands share the
  "every service handles these" property, this entity carries durable system commands only —
  composites are split per namespace before publish (see Composite splitting below).
  Supersedable control *signals* (probes, checkpoints) later migrate again to the control
  class from the traffic-classes proposal; durable system commands stay here.

### Entity-count and machinery budgets

Contract namespaces number in the tens; a Standard namespace allows 10,000 entities — count is
a non-issue. The budgets that DO move:

- **Session-acceptor multiplication:** a service listening on K inbox entities runs K acceptor
  sets. Per-subscription acceptor budgets must shrink as subscription counts grow
  (`MaxConcurrentSessions` scaled per entity; the adaptive-acceptor work from the
  traffic-classes proposal becomes a prerequisite here). The transport ops-rate self-check
  guards the aggregate.
- **Startup provisioning:** more entities means more management calls at boot. Provision only
  what the service publishes or handles, cache existence checks, and splay under fleet-wide
  restarts.

### Ordering semantics — the one deliberate change

Today a stream's commands to one service share a single session on one topic: totally ordered
on the wire. Decomposed, a stream's commands in *different* contract namespaces travel
different entities and may interleave in wire order. Within one namespace, ordering is
unchanged. The store-side work pump remains the ordering authority (per-stream claim and
ordering guard re-serialize regardless of arrival order), so this is expected to be
observationally equivalent — but it is a semantic change and gets its own regression lock, not
an assumption.

## Migration

Rolls one contract namespace at a time; each phase is independently reversible.

0. **Traffic census** — instrument one representative bulk run: command volume per contract
   namespace × handling services. Validates the single-handler assumption and sizes the win
   before any code moves.
1. **Provision + subscribe (dark)** — create inbox entities; consumers subscribe per their
   registries. The shared inbox still carries everything; new entities sit idle.
2. **Publisher flip per namespace** — route that namespace's commands to its inbox entity.
   During the overlap, a message can arrive via at most one path (the publisher picks one), and
   store-side idempotency absorbs any replay overlap. Old inbox drains naturally.
3. **Retire** — when the shared inbox is empty of a namespace's types across the fleet, drop
   the catch-all responsibility for it; when all namespaces have moved, retire the shared inbox
   (or retain it solely for the broadcast carve-out until the control class ships).

Rollback at any point = flip the publisher back; subscriptions and entities are harmless while
idle.

## Test cases

**Routing & delivery**
- Command type → inbox entity derivation matches its contract namespace (both transports).
- Single-handler namespace: exactly the handling service receives; non-handlers incur zero
  operations (assert via broker metrics/emulator counters, not just absence of processing).
- Multi-handler namespace: all handling services receive (legitimate fan-out preserved).
- Consumer subscription set derives from the receptor registry — including **composite and
  raw-carry envelope types** (redelivery bundles, coalesced composites): a composite must route
  to every service that handles any constituent's namespace. This is the highest-risk mapping;
  it gets its own locks.
- Unroutable command (no namespace mapping / no subscriber): loud failure at publish, never
  silent drop.
- Discard-at-receive-boundary still discards a mis-delivered message safely.

**Ordering**
- Same stream, same namespace: strict wire order preserved (sessions / single-consumer queue).
- Same stream, commands across two namespaces interleaved at publish: store-side pump yields
  the correct final state (E2E, both transports) — the lock for the deliberate semantic change.

**Idempotency & migration**
- Dual-delivery overlap: same message id via old and new path → processed once (store dedup).
- Phase 1 dark state: new entities idle, zero behavior change.
- Publisher flip: no loss, no duplicate processing across the flip boundary (E2E with traffic
  in flight during the flip).
- Rollback mid-migration: flip back, no loss.

**DLQ & recovery**
- Failures land in the per-namespace DLQ; dead-letter recovery flows enumerate and replay from
  the new entities; replay preserves routing properties end-to-end.

**Provisioning & budgets**
- Idempotent entity creation; concurrent fleet startup creates each entity once.
- Existence-cache prevents re-checking on every boot; management-op count per boot bounded and
  asserted.
- Acceptor budget: per-entity session-acceptor count scales down as a service's inbox
  subscription count grows; aggregate idle ops per pod stay under the ops-rate self-check
  threshold (integration assert, both transports).
- Non-default schema / multi-deployment naming: entity names remain collision-free per
  deployment convention.

**Carve-outs & composition**
- Broadcast/control types never route to per-namespace inboxes (analyzer or startup validation
  + runtime test).
- Traffic-class composition: inbox entity names are routable by tag→namespace rules (naming
  compatibility asserted now, even before traffic classes ship).

**Throughput lock**
- Transport-tier E2E (emulator/container): a bulk burst of N single-handler commands costs
  O(3N) broker operations, not O(3N × subscription count) — the regression lock for the entire
  proposal, asserted against broker operation counters on both transports.

## Resolved design decisions

- **Command ownership is per-service, scale-out is per-instance.** Exactly one *service* may
  register inbox handlers for a command type — two different services handling the same
  command is a modeling error (that message is an event) and the analyzer enforces it as an
  error. Multiple *instances* of the owning service are the normal case and unaffected: they
  compete on the one subscription (sessions distribute streams across instances), exactly as
  today.
- **Composite construction is locked behind a factory.** `ICompositeFactory` is the only
  sanctioned way to build a composite: callers hand it constituents, it returns an
  **enumerable of composites** — already split along every grouping dimension the caller
  should never re-implement: the routing strategy's group key (`GetCompositeGroupKey`, so no
  envelope spans entities), the count cap, and the byte budget (today re-implemented
  separately by the coalesce ship worker and the redelivery pump; the factory unifies them).
  Callers publish what they receive — the correct path is the only natural path. Composite
  types expose their construction through an AOT-safe static creation seam (static abstract
  interface member / generated registration — no reflection), and an analyzer flags direct
  construction outside the factory, the same enforcement idiom the ephemeral and tag systems
  already use. Existing framework producers (coalesce fold, raw-carry redelivery) refactor
  onto the factory as its first two consumers.
- **The factory establishes the minted-event idiom — applied per family, not unified
  prematurely.** Several framework event families encode construction *policy* (grouping,
  sizing, cadence, routing consistency) that must not leak to call sites — composites today;
  checkpoint minting and snapshot/carry-forward events are shaped similarly. The pattern is
  the idiom — a DI-registered, strategy-aware factory per family + creation-seam + analyzer —
  documented as the way to add "special" event families. A single generic
  factory-of-factories is deliberately **not** proposed: unify only if a third family proves
  the same shape (rule of three), otherwise it is abstraction ahead of evidence.
- **The shared inbox retires entirely.** End state: per-namespace inbox topics + the one
  system broadcast inbox. No catch-all remnant; phase 3 completes with the shared inbox
  deleted. Control signals make their second hop to the control class when the traffic-classes
  arc ships — bundling the two proposals makes that a single migration for those types.

## Open questions

- **Splitter coupling to the naming strategy.** The composite splitter keys off the topic
  naming strategy, which today is contract-namespace-based everywhere. If an alternative
  naming strategy ever ships, the splitter must key off that strategy's routing function, not
  namespaces — the splitter API should take the strategy as its input from day one. Worth
  further ideation before the helper API freezes.

## Related proposals

- [Transport Traffic Classes & Multi-Namespace Routing](transport-traffic-classes) — supplies
  the namespace-level supply-side isolation; this proposal cuts demand-side waste. They compose:
  per-namespace inboxes are the routable unit.
- **Tag-Bound Policies & Message Coalescing** (order 36) — coalescing reduced audit fan-out on
  the event side; this is the command-side sibling.
