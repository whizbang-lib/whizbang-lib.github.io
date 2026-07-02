---
title: Dead-Letter Queue
order: 4
---

# Dead-Letter Queue

Whizbang has two parallel dead-letter mechanisms, each solving a different
problem:

| Flow | Lives in | Trigger | Recovery |
|---|---|---|---|
| **Internal DLQ** | `wh_dead_letters` table | Worker (inbox / outbox / perspective) observes `attempts > Max…Attempts` | Policy-driven, per-row, generation-tagged auto-replay |
| **Transport DLQ** | Broker (ASB `$DeadLetterQueue`, RMQ `<queue>.dlq`) | Broker drops a message after its own redelivery cap | Aggressive on-cadence drain, blanket re-submit |

The internal DLQ is the **policy** surface — operators decide which failure
reasons retry, how aggressively, and when to give up. The transport DLQ is the
**janitor** — broker DLQs get drained back onto the normal receive path
automatically so they don't grow unbounded.

The pages in this section cover:

- [Internal DLQ (`wh_dead_letters`)](./internal-dlq) — table schema, the
  `MoveAsync` boundary, and how the worker dead-letter check fires.
- [Recovery worker + policy matrix](./recovery) — per-`MessageFailureReason`
  defaults, custom `IDeadLetterRecoveryPolicy` implementations, generation
  replay semantics.
- [Operator HTTP API](./operator-api) — list pending, retry now, hold,
  give up, manual scan.
- [Transport DLQ recovery (ASB + RMQ)](./transport-recovery) — broker-side
  drain mechanics.
- [Perspective-event dead-lettering](./perspective-events) — pre-apply check
  and how it interacts with the cooldown cache.
