---
title: Broker DLQ Import
category: Architecture & Design
order: 39
tags: dead-letter, dlq, recovery, transport, service-bus, rabbitmq, custody, aot
---

# Broker DLQ Import — one custody model for failed messages

Whizbang has two custody models for failed messages, and only one of them is real. A message that
fails **after** reaching the inbox lands in `wh_dead_letters`: queryable, retried under per-reason
policies, visible to operators, and auto-replayed when a new build generation deploys. A message
that fails **before** reaching the inbox — broker-side delivery-attempt exhaustion during a
throttling storm, a deserialization failure on an old build, session lock churn — lands in the
**broker's** dead-letter queue: an opaque bucket with no policies, no replay, no attempt
accounting, and no Whizbang-visible signal at all.

This proposal makes the broker DLQ a **source** that drains into `wh_dead_letters`, so the flow
that already works owns every failed message.

:::planned
Unreleased design proposal. Supersedes the resubmit-to-topic semantics of the (never-wired)
`AzureServiceBusDeadLetterDrainer` / `RabbitMqDeadLetterDrainer` pair.
:::

## The incident that motivates this

On a consumer fleet, a bulk operation's entire event fan — thousands of composite bundles — was
dead-lettered broker-side when a serializer gap made every delivery attempt throw
(`MaxDeliveryAttemptsExceeded`). The messages sat invisibly for weeks: the drain worker that
should have recovered them iterates `GetServices<ITransportDeadLetterDrainer>()`, and **nothing
ever registers one** — both drainer implementations are orphans with zero construction sites, and
an empty drain pass exits without logging. Meanwhile `wh_dead_letters` on the same service
processed and recovered 46,000+ internal failures flawlessly over the same period. The machinery
that works never saw the messages that mattered.

Two properties of the existing resubmit-to-topic drainer design would have made even a wired-up
version a poor fit:

- **Re-broadcast**: re-sending to the *topic* fans the message out to every subscription again.
  Draining N subscriptions of the same topic multiplies the burst by the subscriber count —
  exactly the broker ops-rate pressure that caused the original throttling.
- **The carousel**: a message that still fails (the serializer gap persisted across builds)
  redelivers, re-exhausts, re-dead-letters — around forever, invisible at every revolution,
  burning broker operations. Custody never transfers to something with attempt accounting.

## Design

### Drain action: import, not resubmit

`TransportDeadLetterDrainWorker` keeps its shape — poll every `IntervalMinutes`, cap at
`MaxPerTick`, fan across registered `ITransportDeadLetterDrainer`s (broker DLQs are pull-only; a
worker must poll them). What changes is the drain **action**: each dead-lettered message is
**imported as a `wh_dead_letters` row**, then completed at the broker. One hop, no re-broadcast,
custody transfers permanently.

The import is **raw-JSON custody — no deserialization, no reflection**:

| `wh_dead_letters` column | Source (ASB) |
|---|---|
| `source_table` | `'broker'` (new) |
| `source_id` | the wire `MessageId` (a Whizbang message id — already a GUID string on the wire) |
| `stream_id` | `SessionId` (the per-stream session key) |
| `message_type` | the `EnvelopeType` application property |
| `destination` | `{topic}/{subscription}` |
| `envelope` | the message body, verbatim JSONB |
| `failure_reason` | `BrokerDeadLetter` (new enum member) |
| `error_text` | broker `DeadLetterReason` + `DeadLetterErrorDescription` — preserved instead of discarded |
| `metadata` | broker enqueue time, delivery count, dead-letter source |

A message whose body is not even valid JSON still gets custody (stored as an escaped JSON string)
— the import path must never lose a message to a parse failure, because messages that fail to
parse are precisely the ones that need forensics.

### Replay: the existing recovery flow, one new branch

`DeadLetterRecoveryWorker` already owns retry: per-reason policies, exponential backoff, operator
disposition, and generation-tagged auto-replay. Imported rows join that flow with:

1. A `PolicyByReason` default for `BrokerDeadLetter`: `MediumRetry` (a broker dead-letter usually
   means "the build couldn't process this" — worth retrying after a deploy, not aggressively).
2. One new branch in `recover_dead_letter`: `source_table = 'broker'` inserts into **`wh_inbox`**
   (`message_id = source_id`, `event_data = envelope`, `ON CONFLICT DO NOTHING`) — the same
   front door every received message uses, so dispatch, composite fan-out, perspective apply,
   and the internal max-attempts → dead-letter ladder all apply unchanged. A bundle that still
   cannot deserialize on the current build fails **visibly**: it re-parks in `wh_dead_letters`
   with a real error fingerprint instead of orbiting the broker.

Generation replay composes beautifully here: import the backlog once, and every subsequent deploy
automatically re-offers any rows not yet retried on that build — "the fix shipped, replay the
storm's casualties" becomes a zero-touch consequence of deploying.

### Wiring: the fleet drainer (fixes the registration gap)

Per-subscription drainers cannot be individual DI registrations — subscriptions are established at
runtime, after the container seals. The ASB hosting registration contributes **one**
`ITransportDeadLetterDrainer`: a fleet drainer that, on each pass, snapshots the transport's
active `(topic, subscription)` pairs and drains each one's DLQ through a cached per-subscription
importer. `MaxPerTick` is a **total** cap per pass, not per-subscription — the worker's pacing
contract must not scale with subscriber count. Construction never dials the broker (the client
resolves lazily), so container validation stays hermetic.

`TransportDeadLetterDrainWorker` additionally warns **once** when it is enabled but resolves zero
drainers — the silent-no-op failure mode this incident exposed must never be silent again.

RabbitMQ gets the same treatment: `RabbitMqDeadLetterDrainer` imports from the dead-letter queue
into `wh_dead_letters` under the same `'broker'` source and reason.

### Adjacent fix: capture the terminal exception

`move_to_dead_letters` rows for perspective/inbox failures currently store only the wrapper text
("attempts=11 > max=10 …"). The underlying exception is not captured anywhere durable; once pod
logs rotate, root cause is unrecoverable — observed directly when 7,700+ perspective dead-letters
from a single day shared one fingerprint and no stored cause. The worker-side dead-letter call
sites will pass the terminal exception's `ToString()` into `error_text` alongside the wrapper.

## AOT posture

- Import stores the wire body verbatim — zero deserialization, zero reflection, no
  `JsonTypeInfo` dependence at custody time.
- Replay rides the existing inbox path, whose deserialization is source-generated
  (`JsonContextRegistry` combined contexts).
- All new DI wiring is explicit factory registration; the fleet drainer takes
  `Func<ServiceBusClient>` / delegate seams — nothing is discovered reflectively.

## TDD plan (RED → GREEN)

1. **RED**: ASB hosting registration test — `AddAzureServiceBusTransport` must register at least
   one `ITransportDeadLetterDrainer` (fails today: zero registrations, the #514 wiring gap).
2. **RED**: fleet drainer behavior — drains every active subscription; budget is a total cap;
   subscriptions appearing after startup are picked up; per-subscription importers are cached.
3. **RED**: import semantics — a dead-lettered broker message becomes a `wh_dead_letters` row
   with `source_table='broker'`, `failure_reason=BrokerDeadLetter`, broker reason preserved in
   `error_text`, body stored verbatim; import is idempotent on `message_id`; a non-JSON body
   still imports.
4. **RED**: recovery branch — `recover_dead_letter` on a `'broker'` row inserts into `wh_inbox`
   idempotently and marks the row Recovered (SQL-level test alongside the existing recovery
   suite).
5. **RED**: drain worker warns once when enabled with zero drainers.
6. **RED**: terminal-exception capture — perspective dead-letter rows carry the inner exception
   text, not only the attempts wrapper.
7. **GREEN**: implement migration (import function + `'broker'` branch), enum + policy default,
   coordinator import API, importer drainers, fleet drainer, registration, worker warning.

## Rollout

Single library PR; ships in the next alpha. On a fleet with an existing broker DLQ backlog, the
first ticks import at `MaxPerTick` per pass (paced, throttle-safe); the rows then heal through
recovery — or park visibly if the current build still cannot process them, which is itself the
diagnostic outcome the broker bucket never provided.
