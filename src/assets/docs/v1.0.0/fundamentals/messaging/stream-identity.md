---
title: Stream Identity
pageType: concept
order: 9
description: >-
  Which stream a message is stored on, wherever it is stored: the producer's
  outbox, a consumer's inbox, dead-letter recovery and every child a composite
  fans out into. One rule, one helper, and a parity suite that holds every
  delivery path to it.
tags: 'stream-id, streams, composite-events, fan-out, redelivery, audit, rebuild, re-key'
codeReferences:
  - src/Whizbang.Core/Messaging/StreamIdentity.cs
  - src/Whizbang.Core/Messaging/CompositeInboxFanout.cs
  - src/Whizbang.Core/Workers/ReceivedInboxMessageBuilder.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Messaging/RedeliveryPump.cs
  - src/Whizbang.Core/Minting/RedeliveryComposite.cs
  - src/Whizbang.Core/SystemEvents/AuditOutboxMessageBuilder.cs
  - src/Whizbang.Core/Transports/TransportManager.cs
  - src/Whizbang.Core/Perspectives/RebuildRowRouting.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/StreamIdentityTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamResolutionParityTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamResolutionSitesTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/StreamResolutionSourceGuardTests.cs
---

# Stream identity

Every perspective row is keyed by a stream, and every path that folds an event onto a row (live apply, the rewind and a
rebuild) takes the row from the stream the event is **stored on**. So the stream a service stores an event on must be
the stream its producer stored it on. When the two differ, live apply folds the event onto a row nobody reads, and the
row the event is about never receives it.

## The rule {#the-rule}

A producer names a message's stream on the message's first hop and stores the message on that stream. Every receiver
reads the same hop:

| Where | Stream |
|---|---|
| The producer's outbox | The stream the first hop names (written from the payload's `[StreamId]`), or the message's own id when it names none. |
| A consumer's inbox, on receipt | The same: the first hop's stream, or the message id. |
| Dead-letter recovery | The same as the delivery it replaces. |
| A composite's child | The stream the bundle recorded for the child, else the one the child's own `[StreamId]` names, else the composite's own stream (its hop, then its own `[StreamId]`), and only then the composite envelope's id. |

A composite is transport packaging, never a stream rewrite: each child is stored where its producer stored it. A
producer that builds an envelope outside the dispatcher (the audit builders, the integrity re-delivery pump,
`TransportManager`, `DispatcherTransportBridge`) names the stream on the hop too.

The rule lives in one internal helper, `StreamIdentity`; every storing site calls it.
{verified: StreamIdentityTests.Of_WithoutAHopStream_IsTheMessageIdAsync, StreamIdentityTests.OfFanoutChild_PrefersRecordedThenPayloadThenCompositeAsync, StreamIdentityTests.OfComposite_PrefersTheHopThenItsOwnStreamThenTheEnvelopeIdAsync}

## Rebuilds and re-keys {#rebuilds}

A rebuild keeps every event on the row of the stream it is stored on, except an event an
[upcaster re-keyed](../events/event-upcasting.md#re-key-re-routes-on-rebuild-not-on-live-drain), which folds onto the row
it now names together with that row's own events, in commit order (`RebuildRowRouting`).

## Kept honest by tests {#parity}

- **The parity table** (`StreamResolutionParityTests`) holds every delivery shape: plain delivery with and without a
  stream, dead-letter recovery, typed composite children with and without their own stream, coalesced, audit and
  re-delivery bundles in their current and older forms, a lone audit record from either builder, collectives with and
  without an ordering key and inside a composite, and the two direct transport publishers. Each row produces the event
  with the producer's code, stores it with the receiver's, and asserts the stored stream is the producer's.
- **The completeness guards** fail the build when a new path appears without a row: every composite type the framework
  defines (found by reflection and checked against the compile-time catalog), every site that reads or writes the
  stream hop, and every site that builds an inbox or outbox row.

## Repairing what was stored before {#repair}

Children stored on the wrong stream before this rule held are moved by the composite child refile. See
[Purging streams: refiling composite children](../../operations/infrastructure/purging-streams.md#refiling-composite-children).
