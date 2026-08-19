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
Unreleased design proposal. Companion to **Transport Traffic Classes & Multi-Namespace Routing**
(order 37): per-namespace inboxes are the unit that traffic-class routing later assigns to
broker namespaces.
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
- **Broadcast and control-plane messages do not move.** Genuinely all-services traffic
  (run-control, killswitches, control-plane signals) keeps its own channel — per the
  traffic-classes proposal, ultimately the control class. The inventory of which types those
  are is a migration prerequisite, not an afterthought.

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

## Open questions

- Should multi-handler command namespaces be allowed long-term, or flagged by an analyzer as a
  design smell (commands are point-to-point by definition; events already have a home)?
- Does the composite/raw-carry envelope routing want its own dedicated inbox namespace instead
  of fanning to constituent namespaces?
- Retirement timing for the shared inbox's broadcast remnant — before or with the control
  class from the traffic-classes proposal?

## Related proposals

- [Transport Traffic Classes & Multi-Namespace Routing](transport-traffic-classes) — supplies
  the namespace-level supply-side isolation; this proposal cuts demand-side waste. They compose:
  per-namespace inboxes are the routable unit.
- **Tag-Bound Policies & Message Coalescing** (order 36) — coalescing reduced audit fan-out on
  the event side; this is the command-side sibling.
