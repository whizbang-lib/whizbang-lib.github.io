---
title: Transport Traffic Classes & Multi-Namespace Routing
category: Architecture & Design
order: 37
tags: transport, service-bus, namespaces, traffic-classes, control-plane, ttl, throttling, tags, isolation
---

# Transport Traffic Classes & Multi-Namespace Routing

One transport namespace carrying interactive traffic, bulk traffic, and the framework's own
control-plane chatter means every class competes for one broker quota and one failure domain.
This proposal introduces **traffic classes** — declared with the existing message-tag vocabulary,
bound to policy in host configuration — and two capabilities they unlock: **routing classes to
separate broker namespaces** (horizontal isolation before vertical scale) and **control-plane
delivery semantics** (short-TTL, sessionless, non-durable) for messages whose value expires.

:::planned
Unreleased design proposal. Builds on **Tag-Bound Policies & Message Coalescing** (the binding
mechanism) and on the transport-hardening lessons of the 2026-08 namespace-saturation incident.
:::

## Motivation — a measured incident

A dev fleet (~28 pods, Azure Service Bus **Standard**) ran for weeks with chronic, unattributable
throttling. Measured root cause, end to end:

- The transport's session receive machinery (defaults: 200 concurrent acceptors × 1-second idle
  timeout per pod) demanded **5,000+ operations/sec against the namespace's ~1,000 credits/sec
  pool — at idle**. The namespace ran pinned at its ceiling: **317,669 incoming requests per
  5 minutes, 33,368 throttled**, while only ~500 genuine messages entered.
- Starved connection keepalives caused broker-side connection closure; every session lock on the
  connection died mid-batch; in-flight messages redelivered — **~80,000 deliveries per 15 minutes
  of the *same* messages**. Subscription backlogs (16,642 messages on one) were **hostage, not
  poison**: when the churn stopped, they drained to zero untouched.
- Interactive traffic shared the same pool and the same subscriptions: chat exchanges stalled for
  tens of seconds behind machinery that was doing nothing.
- After a one-line timeout fix: **6,793 requests per 5 minutes, 0 throttled** — a 98% collapse.

Three structural lessons, beyond the tuned default:

1. **On Standard, the namespace is the only isolation boundary.** Throttling is namespace-scoped;
   no topic/subscription topology partitions the credit pool. Class isolation requires namespaces.
2. **Control-plane traffic must not be a first-class durable citizen.** Supersedable messages
   (integrity checkpoints, doorbells) queued durably for weeks, worthless on arrival, feeding the
   redelivery loop.
3. **The transport must observe itself.** The machinery that consumed the whole quota logged
   nothing when healthy — the only witness was the cloud provider's billing meter.

## Design

### Traffic classes are tag-bound policy

Message tags classify; policies bind (the coalescing proposal's mechanism, reused verbatim):

```csharp{title="Binding traffic classes to tags" description="Classes declared against tag strings in host options — no new attributes on message types" category="Architecture" difficulty="INTERMEDIATE" tags=["Transport","Tags","Namespaces"] framework="NET10"}
services.AddWhizbang(options => {
  // Route by tag. Unmatched traffic uses the default (primary) namespace.
  options.Tags.RouteNamespace("sys-control", "control");   // framework control-plane
  options.Tags.RouteNamespace("bulk-import", "bulk");      // application bulk lanes

  options.Transport.Namespaces = new() {
    ["default"] = config.GetConnectionString("servicebus"),
    ["bulk"]    = config.GetConnectionString("servicebus-bulk"),
    ["control"] = config.GetConnectionString("servicebus-control"),
  };
});
```

- Framework control-plane types (integrity checkpoints, manifests, redelivery commands, signal
  probes) carry a reserved `sys-control` tag; `sys-` remains the reserved framework prefix with
  startup validation.
- One vocabulary, additive policies: a tag that already coalesces can also route; neither policy
  adds metadata to the message type.
- Single-namespace hosts are unaffected: with no routing bindings, everything uses `default` and
  behavior is exactly today's.

### Multi-namespace transport

- The transport holds one client per configured namespace and provisions each class's entities in
  its own namespace on startup (same auto-provisioning as today, per namespace).
- Each Standard namespace brings its own ~1,000 credits/sec pool and its own failure domain: a
  bulk storm cannot throttle interactive receives; a control whirlpool cannot starve domain locks.
  Aggregate capacity scales horizontally at commodity cost before any Premium migration.
- Ordering and transactionality are unaffected: classes are independent by construction, and the
  outbox pattern already decouples publish from commit — sends were never transactional with the
  store.
- Consumers subscribe per class: a service's inbox subscription exists in every namespace whose
  classes it consumes (most services consume `default` + `control` only).

### Control-plane delivery semantics

The `control` class changes delivery semantics, not just location:

- **Short TTL** — control messages are minted with `TimeToLive ≈ 2× their cadence`. A superseded
  checkpoint expires on the broker instead of queueing; a control backlog is structurally
  impossible. This is the transport-level twin of ephemeral events: value that expires must not
  be durable.
- **Sessionless receive** — control consumers need no ordering; sessionless subscriptions remove
  the accept/lock machinery entirely for this class.
- **Non-durable receive path** — control messages are receive → compare → discard: no inbox row,
  no completion bookkeeping, no dead-lettering (extends the existing rule that control-plane
  failures drop rather than DLQ).
- Combined with the checkpoint-economy work (elected per-service publisher, decaying idle
  cadence), the control class idles near zero.

### Transport self-observability

- **Ops-rate self-check**: the transport counts its own operations per second (accepts, receives,
  renews, sends) and degrades its managed-health component when idle churn alone approaches a
  configurable share of a Standard pool. The failure mode of this incident — invisible while
  healthy — becomes a loud health signal.
- **Backlog-age duty**: a cheap scheduled peek of subscription depth and oldest-enqueue age per
  class; a backlog older than a threshold degrades health with the entity named.
- **Adaptive acceptor count**: session acceptors scale with observed active-session demand
  (floor 2–4, growth on pressure) instead of a standing army of 200; the idle cost of the receive
  machinery trends to zero by construction.
- **Sane defaults, bindable options**: `SessionIdleTimeout` default rises from 1s to ≥30s, and
  `AzureServiceBusOptions` becomes configuration-bindable — during the incident, the knobs were
  unreachable without a code change in every host.

## Build increments

1. Configuration-bindable `AzureServiceBusOptions` + revised defaults + ops-rate self-check.
2. Tag-bound namespace routing (options, validation, per-namespace clients + provisioning).
3. Control class semantics: `sys-control` tag on framework control types, TTL minting,
   sessionless subscription provisioning, non-durable receive path.
4. Backlog-age duty + adaptive acceptor count.
5. OTel: per-class ops-rate gauges, per-namespace throttle counters, backlog-age gauge.

## Open questions

- **Delivery-count semantics under lock loss**: during the incident, thousands of redeliveries
  never tripped `MaxDeliveryCount = 10` — connection-death lock loss appears not to increment
  delivery count the way abandon does, so the DLQ safety valve does not fire under exactly the
  storm conditions that need it. Needs a precise answer before relying on DLQ as a backstop.
- Whether per-class namespaces should be required in production profiles or remain advisory.
- Migration mechanics for existing single-namespace deployments (entity duplication window while
  consumers re-subscribe per class).

## Related proposals

- **Tag-Bound Policies & Message Coalescing** (order 36) — the tag-binding mechanism this reuses
- [Managed-Resource Control Plane](managed-resource-health) — where the ops-rate and backlog-age
  signals surface as health components
- [Fleet Startup Orchestration](fleet-startup-orchestration) — the same "idle is never idle"
  family: fleet-scale behavior emerging from individually reasonable per-instance defaults
