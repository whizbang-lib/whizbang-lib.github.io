---
title: Message Priority
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-09-09
order: 8
description: >-
  One integer on every message and three scheduling buckets. The producer
  declares from context, the consumer classifies at its receive boundary, a
  child inherits its parent's effective number, and three hooks (producer,
  receive, batch) make every default replaceable.
tags: 'priority, work-class, interactive, background, hooks, inheritance, scheduling'
codeReferences:
  - src/Whizbang.Core/Priority/WorkPriority.cs
  - src/Whizbang.Core/Priority/PriorityHooks.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/IMessageEnvelope.cs
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/ReceivedInboxMessageBuilder.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/149_MessagePriority.sql
testReferences:
  - tests/Whizbang.Core.Tests/Priority/WorkPriorityTests.cs
  - tests/Whizbang.Core.Tests/Priority/PriorityHooksTests.cs
  - tests/Whizbang.Core.Tests/Priority/DispatcherPriorityStampingTests.cs
  - tests/Whizbang.Core.Tests/Priority/ConsumerPriorityClassificationTests.cs
  - tests/Whizbang.Core.Tests/Priority/InboxDispatchWorkerPriorityContextTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MessagePrioritySqlTests.cs
---

# Message Priority

Contention latency is the time an interactive message waits behind work nobody is waiting for. A
bulk import fans in tens of thousands of events per minute; a user's command arrives in the same
inbox, is claimed by the same loop, and waits its turn. Priority is how the framework tells the two
apart and schedules them differently, without breaking the one rule that is not negotiable: rows of
one stream are processed in order.

This page is the released design. The decisions it records were settled in review and are listed
at the end.

## The number and the bucket {#the-number-and-the-bucket}

{verified: WorkPriorityTests.Constants_SitMidBandAsync, WorkPriorityTests.Bucket_MapsTheBandsAsync, WorkPriorityTests.Bucket_TreatsUndeclaredAsStandardAsync, WorkPriorityTests.Effective_ReplacesUndeclaredWithStandard_AndKeepsADeclaredNumberAsync, WorkPriorityTests.IsDeclared_IsTrueOnlyForAPositiveNumberAsync}

Priority is **one integer on every message, lower is more urgent**. Producers, consumers,
inheritance and aging all work in one integer space, so an override is arithmetic and "a little more
urgent than an ordinary interactive message" is a smaller number. The named constants sit in the
middle of their band, so a declaration can move in either direction without changing bucket:

| constant | value | band | meaning |
|---|---|---|---|
| `WorkPriority.UNDECLARED` | `0` | none | nothing declared; read as `STANDARD` wherever an effective number is needed |
| `WorkPriority.INTERACTIVE` | `50` | `1` to `99` | a person or a synchronous caller is waiting |
| `WorkPriority.STANDARD` | `150` | `100` to `199` | domain work with no one waiting |
| `WorkPriority.BACKGROUND` | `250` | `200` and up | work that exists because of volume or maintenance |

**The bucket is the scheduling class.** `WorkPriority.Bucket(n)` maps a number onto `WorkBucket`
(`Interactive`, `Standard`, `Background`), and everything that needs a bounded set of queues works
on the bucket: fair queuing needs a handful of queues with weights, and three is the smallest set
that can still say "no one is waiting, but it is not bulk". Inside a bucket the number orders
streams.

Zero is reserved for "not declared". It costs nothing on the wire, and `WorkPriority.Effective(0)`
reads it as `STANDARD`, so nothing a producer leaves unset can land in the urgent bucket. A negative
number is treated the same way.

The number travels on the envelope as one small field, `pri`, omitted when undeclared: {verified: PriorityHooksTests.Envelope_CarriesTheDeclaredPriorityUnderAShortKey_AndOmitsItWhenUndeclaredAsync}

## Declaration and classification {#declaration}

Two decisions, kept distinct on purpose:

| | who sets it | where it lives | who reads it |
|---|---|---|---|
| **declared priority** | the producer, from dispatch context or the producer hook | the envelope, one integer | the consumer's receive hook |
| **effective priority** | the consumer, at its receive boundary | the consumer's own row | the claim, the batch hook, the drain, the meters |

**The producer knows the origin.** The framework's producer default,
`ContextPriorityProducerHook`, derives the declared number from context the dispatcher already has:

- An application-initiated dispatch (no handler on the dispatch context) is `INTERACTIVE`: a caller
  is waiting at a boundary.
- Scheduled work is `BACKGROUND`.
- Everything else, which is work a handler emits, is `STANDARD`.
- **Inheritance.** A message produced while handling another inherits the parent's effective number,
  and inheritance never raises above the parent: a message produced while handling background work
  is background whatever its type normally is. Only an explicit declaration raises it, and that is
  kept.

{verified: PriorityHooksTests.ProducerDefault_AnApplicationInitiatedDispatch_IsInteractiveAsync, PriorityHooksTests.ProducerDefault_ADispatchInsideAHandler_IsStandardAsync, PriorityHooksTests.ProducerDefault_ScheduledWork_IsBackgroundAsync, PriorityHooksTests.ProducerDefault_AChildInheritsItsParentsEffectiveNumberAsync, PriorityHooksTests.ProducerDefault_InheritanceNeverRaisesAboveTheParentAsync, PriorityHooksTests.ProducerDefault_KeepsAnExplicitDeclarationAsync}

**The consumer knows its own role.** The framework's receive default,
`AcceptDeclaredPriorityReceiveHook`, accepts the declared number and reads an undeclared one as
`STANDARD`. A consumer may lower or raise by its own rule; both are allowed and both numbers are
kept. The domain-owning service therefore processes its own interactive messages first, while a
secondary consumer of the same messages may treat them as background. Classification is positive: a
rule that does not match leaves the declared number in place, and a lookup miss never lands a message
in the urgent bucket. {verified: PriorityHooksTests.ReceiveDefault_AcceptsTheDeclaredNumber_AndReadsUndeclaredAsStandardAsync}

### Where the two decisions run

{verified: DispatcherPriorityStampingTests.Send_OutsideAnyHandling_DeclaresInteractive_OnTheEnvelopeAndTheRowAsync, DispatcherPriorityStampingTests.Send_WhileHandlingBackgroundWork_InheritsBackgroundAsync, DispatcherPriorityStampingTests.Send_WithAHostProducerHook_UsesItsDeclarationAsync, DispatcherPriorityStampingTests.Send_WithNoChainRegistered_LeavesTheEnvelopeUndeclaredAsync, ConsumerPriorityClassificationTests.Receive_StoresTheDeclaredNumber_WhenTheDefaultChainAcceptsItAsync, ConsumerPriorityClassificationTests.Receive_ReadsAnUndeclaredNumberAsStandardAsync, ConsumerPriorityClassificationTests.Receive_AHostReceiveHook_LowersTheNumber_AndTheRowCarriesItsAnswerAsync, ConsumerPriorityClassificationTests.Receive_WithNoChainRegistered_StoresTheDeclaredNumbersEffectiveValueAsync}

- **The dispatcher declares.** Every message it sends to the outbox goes through the producer hooks
  with the dispatch context, the schedule, the ambient parent and whatever the envelope already
  carries. The answer lands on the envelope, so it travels, and on the outbox row, so the store keeps
  it. A host that never registered the chain sends undeclared envelopes exactly as before.
- **The consumer classifies.** Both consumer workers (the transport consumer and the Service Bus
  consumer) run the receive hooks before the row is stored and write the answer to the inbox row.
  Without a chain the row carries the declared number's effective value, so nothing is ever stored
  as zero.
- **The dispatch worker enters the row's number** as the ambient parent for the whole handling, so
  every lifecycle stage and everything a receptor dispatches from inside one inherits it.
  {verified: InboxDispatchWorkerPriorityContextTests.Dispatch_EntersTheRowsPriorityAsTheAmbientParent_ForEveryStageAsync}

## Storage {#storage}

{verified: MessagePrioritySqlTests.StoreInboxMessages_WritesTheEffectivePriority_AndReadsUndeclaredAsStandardAsync, MessagePrioritySqlTests.StoreOutboxMessages_WritesTheDeclaredPriority_AndReadsUndeclaredAsStandardAsync, MessagePrioritySqlTests.FetchInboxBatch_ReturnsTheRowsPriorityAsync, MessagePrioritySqlTests.CommitHandlerResult_PerspectiveWorkCreatedFromAnInboxEvent_InheritsTheEventRowsPriorityAsync}

Migration `149_MessagePriority.sql` adds `priority INTEGER NOT NULL DEFAULT 150` to `wh_inbox`,
`wh_outbox` and `wh_perspective_events`. The store functions read the message's `Priority` and write
it to the row, and an undeclared (zero) number lands in the standard band, so a row is never stored as
zero and a caller that predates the column behaves as before. The inbox fetch returns the number with
each row, and the perspective work created when an inbox event is committed inherits the event row's
number, so an interactive event's projection is not queued as standard behind bulk projections.

The effective number gets its own column because it is a per-consumer decision, not a property of
the message, and because the claim orders by it. The meters report the bucket everywhere and the raw
number only in traces, so a dashboard says "Interactive", not "137".

## Hooks {#hooks}

{verified: PriorityHooksTests.Chain_RunsProducerHooksInOrder_EachSeeingThePreviousAnswerAsync, PriorityHooksTests.Chain_RunsReceiveHooksInOrder_AndTheLastWordWinsAsync, PriorityHooksTests.Chain_WithNoHooks_ReturnsWhatItWasGivenAsync}

Every policy the framework ships is the default implementation of one of three hooks. A developer
whose case the provided options do not fit writes the policy; the framework keeps the invariants.

| hook | runs | sees | returns |
|---|---|---|---|
| `IPriorityProducerHook` | at dispatch | `PriorityDeclarationContext`: the envelope, the message type name, the dispatch context, whether it is scheduled, the parent's effective number, the number declared so far | the declared number |
| `IPriorityReceiveHook` | at the consumer's receive boundary, before the store | `PriorityReceiveContext`: the number declared so far, the envelope, the message type name | the effective number |
| `IPriorityBatchHook` | after each claim, before dispatch order is decided | `PriorityBatchEntry` for the stream (its folded number, oldest age, pending rows) and the batch around it | the stream's number for this batch |

Hooks run in `Order` (lower first; the framework defaults run at 1000), and each sees the previous
answer, so a host's hook composes with the defaults or replaces them by running later. Each hook is
a pure function over a context object, which makes a policy testable without a database. The batch
hook sets a stream's number, never a row's position, so per-stream order is an invariant no hook can
break.

```csharp{
title: "A producer hook that marks one namespace background"
description: "Runs before the framework default (Order 1000 runs last), so the default keeps the explicit declaration and the message is background whatever context it was dispatched from."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["priority", "hooks", "producer", "background"]
tests: ["PriorityHooksTests.Chain_RunsProducerHooksInOrder_EachSeeingThePreviousAnswerAsync", "PriorityHooksTests.ProducerDefault_KeepsAnExplicitDeclarationAsync"]
}
public sealed class BulkNamespaceIsBackground : IPriorityProducerHook {
  public int Order => 100;

  public int DeclarePriority(PriorityDeclarationContext context) =>
    context.MessageTypeName.StartsWith("Contracts.Import.", StringComparison.Ordinal)
      ? WorkPriority.BACKGROUND
      : context.Declared;   // leave what an earlier hook decided; the default derives the rest
}

services.AddSingleton<IPriorityProducerHook, BulkNamespaceIsBackground>();
```

The defaults are registered by `AddWhizbang` through `AddWhizbangPriority`, with `TryAddEnumerable`,
so a host's own hook adds to the chain and a second registration of a default is a no-op:
{verified: PriorityHooksTests.Defaults_AreRegisteredByTheCoreRegistration_SoAHostGetsThemWithoutWiringAsync}

```csharp{
title: "The chain a host resolves"
description: "PriorityHookChain sorts the registered hooks of each kind once and threads each answer to the next; with nothing registered it returns its input."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["priority", "hooks", "chain", "dependency-injection"]
tests: ["PriorityHooksTests.Defaults_AreRegisteredByTheCoreRegistration_SoAHostGetsThemWithoutWiringAsync", "PriorityHooksTests.Chain_WithNoHooks_ReturnsWhatItWasGivenAsync"]
}
var chain = serviceProvider.GetRequiredService<PriorityHookChain>();
var declared = chain.DeclarePriority(new PriorityDeclarationContext(
  envelope, messageTypeName, envelope.DispatchContext,
  IsScheduled: false, ParentEffectivePriority: PriorityContext.CurrentParent, Declared: envelope.Priority));
```

### The ambient parent

The effective number of the message being handled is ambient while its handler runs, so anything
produced during that handling, including work the handler starts on another thread, can inherit it.
The dispatch workers enter it for the duration of a handler; leaving the handling clears it.
{verified: PriorityHooksTests.PriorityContext_FlowsTheParentsEffectiveNumberToWorkStartedWhileHandlingAsync}

```csharp{
title: "The ambient effective priority of the message being handled"
description: "PriorityContext.Enter sets the parent's number for the async flow of one handling; CurrentParent reads it, and Dispose restores what was there before."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["priority", "inheritance", "async-local", "handlers"]
tests: ["PriorityHooksTests.PriorityContext_FlowsTheParentsEffectiveNumberToWorkStartedWhileHandlingAsync"]
}
using (PriorityContext.Enter(effectivePriority)) {
  await handler.HandleAsync(message, ct);   // everything dispatched in here sees CurrentParent
}
```

## Decisions {#decisions}

Settled in review; the earlier open questions and their answers:

- **May a consumer raise a priority?** Yes. Lowering and raising are both allowed by a declared rule
  or the receive hook, never by inheritance, and both numbers are kept. Each consumer is in control
  of its own situation; a producer's number is advice with a good default, not a ceiling.
- **Does the producer declare explicitly, or does the framework derive only from context?** Both:
  the framework derives by default (the producer hook's default implementation), and a custom hook
  declares for the ambiguous cases.
- **How many classes?** A number with three buckets. The number gives fine ordering and arithmetic
  inside a bucket; the buckets give fair queuing its bounded set of queues. More buckets add
  round-robin queues, partial indexes and floors for little gain.
- **How is a stream's priority decided when its rows differ?** By a declared fold over all of its
  pending rows: most urgent by default, least urgent for bulk carriers, maintained as per-bucket
  counters so the claim never queries for it.
- **Where does the aging bound come from?** A wait target per bucket, defaulted by the framework from
  the measured drain, declarable by the producer, overridable by the consumer, applied inside a bucket
  and across bands.
- **What if the provided policies do not fit?** The producer, receive and batch hooks; the provided
  policies are their default implementations.

## Related

- [Composite events](composite-events.md): a composite's children inherit the composite's effective
  number.
- [Claim backpressure](../../operations/workers/claim-backpressure.md): the outstanding budget the
  bucket shares divide.
- [Metrics](../../operations/observability/metrics.md): every decision the scheduler makes is
  counted by bucket.
