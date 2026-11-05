---
title: Orphan Inbox Janitor
pageType: concept
version: 1.0.0
category: Workers
order: 8
description: >-
  The opt-in startup worker that deletes pending inbox rows of types nothing on this
  service consumes, what it counts as handled, and why it keeps events in an absorbed
  namespace.
tags: >-
  inbox, orphan-inbox-janitor, consumer-registry, absorbed-namespaces, startup,
  operations
codeReferences:
  - src/Whizbang.Core/Workers/OrphanInboxJanitor.cs
  - src/Whizbang.Core/Workers/OrphanInboxJanitorExtensions.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/ConsumedMessageTypes.cs
  - src/Whizbang.Data.Postgres/PendingInboxTypesSql.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/OrphanInboxJanitorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorLifecycleAndJanitorTests.cs
---

# Orphan Inbox Janitor

The receive boundary discards an inbound message nothing here consumes, so new orphans never land in `wh_inbox`. Rows
can still be left behind: rows received before that filter was deployed, and rows of a type the service stopped
consuming. The orphan-inbox janitor removes them once, at host startup.

It is opt-in. Register it after every receptor registration, because it snapshots the registered receptors when it is
added:

```csharp{title="Registering the orphan-inbox janitor" description="Opt in after every receptor registration so the receptor snapshot is complete" category="Workers" difficulty="INTERMEDIATE" tags=["inbox","orphan-inbox-janitor","startup"] framework="NET10" unverified="registration call only; the janitor's behavior is verified in the sections below"}
builder.Services.AddOrphanInboxJanitor();
```

The janitor starts with the worker pipeline, runs one pass in the background without holding up startup, and exits.
A failure is logged and never stops the host.
{verified: OrphanInboxJanitorTests.StartAsync_ReturnsWithoutBlockingOnThePurgeAsync, OrphanInboxJanitorTests.StartAsync_CoordinatorThrows_DoesNotPropagateAsync}

## What counts as handled {#what-counts-as-handled}
{verified: OrphanInboxJanitorTests.StartAsync_HandledNames_IncludeEveryTypeTheConsumerRegistryEnumeratesAsync, OrphanInboxJanitorTests.StartAsync_UnionsConsumerAndRawRegistries_IntoHandledNamesAsync, OrphanInboxJanitorTests.StartAsync_NoHandledTypes_SkipsPurgeAsync}

The janitor deletes the pending, unleased rows whose type is not in its handled list. The list is the union of:

- the receptor snapshot taken when the janitor was registered,
- every type the [consumer registry](../../extending/internals/receptor-registry-query#what-a-service-consumes)
  lists (perspectives, inbox and lifecycle receptors, synchronous receptors, notification tags, composites and the
  collective sink), and
- the pending types the receive boundary keeps without a consumer (next section).

When the list is empty, the janitor deletes nothing. An empty list at startup means the registry has not loaded, and
purging then would empty the inbox.

Leased rows are skipped, so the janitor never removes a row a worker is dispatching.

## Absorbed events are not orphans {#absorbed-events-are-not-orphans}
{verified: OrphanInboxJanitorTests.StartAsync_APendingTypeInAnAbsorbedNamespace_IsKeptAsync, EFCoreWorkCoordinatorLifecycleAndJanitorTests.GetPendingInboxMessageTypesAsync_ReturnsTheDistinctTypesOfPendingUnleasedRowsAsync}

An event in a namespace the service absorbs (`RoutingOptions.AbsorbNamespaces`) has no consumer here. It is stored on
purpose, so a later perspective can rebuild from it. The janitor reads the distinct types of the pending rows it may
delete (`IWorkCoordinator.GetPendingInboxMessageTypesAsync`) and asks the receive boundary's own keep decision
(`ConsumedMessageTypes.Keeps`) about each. A type the receive boundary would keep is added to the handled list, so the
janitor and the receive boundary can never disagree about what belongs in the inbox.

**Why.** The janitor used to treat every type without a consumer as an orphan, so it purged absorbed events that the
receive boundary had just kept.
