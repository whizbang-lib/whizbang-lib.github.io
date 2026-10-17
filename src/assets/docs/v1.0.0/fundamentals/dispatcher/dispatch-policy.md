---
title: "Dispatch Policy"
pageType: concept
version: 1.0.0
category: "Core Concepts"
order: 3
description: >-
  Every dispatch call asks one central dispatch policy whether the message runs in this service, goes
  to the outbox, is stored only, is deferred, or is refused. The defaults are a published decision
  table; per-call overrides, developer hooks and custom policies adjust it, guarded against decisions
  the dispatcher cannot carry out.
tags: 'dispatch-policy, dispatcher, outbox, routing, owned-domains, scheduling, cancellation, timeout, hooks'
codeReferences:
  - src/Whizbang.Core/Dispatch/Policy/DispatchPolicies.cs
  - src/Whizbang.Core/Dispatch/Policy/DispatchRules.cs
  - src/Whizbang.Core/Dispatch/Policy/DispatchPolicy.cs
  - src/Whizbang.Core/Dispatch/Policy/DispatchPolicyEngine.cs
  - src/Whizbang.Core/Dispatch/Policy/DispatchDecisionGuard.cs
  - src/Whizbang.Core/Dispatch/DispatchBehaviors.cs
  - src/Whizbang.Core/Dispatch/BatchFailureMode.cs
  - src/Whizbang.Core/Dispatcher.cs
testReferences:
  - tests/Whizbang.Core.Tests/Dispatch/Policy/DispatchDecisionTableTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/Policy/DispatchRulesTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/Policy/DispatchPolicyTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/Policy/DispatchPolicyExtensionTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/Policy/DispatchPolicyAllocationTests.cs
  - tests/Whizbang.Core.Component.Tests/Dispatcher/DispatchPolicyBehaviorComponentTests.cs
---

# Dispatch Policy

Every way of dispatching a message (`SendAsync`, `PublishAsync`, `LocalInvokeAsync`, the batch calls, and the messages a handler returns) asks one central **dispatch policy** what to do with it. The call site only describes its situation; the policy decides. The defaults below are the complete decision table, and every row of it is a test.

## The rule {#the-rule}

A dispatch runs this service's local handlers when it has any, and also goes to the outbox, **unless it is a local call or its parameters keep it in**.

- **Local calls** (`LocalInvokeAsync`, `LocalSendManyAsync`) never leave the service.
- **An owned command** (in one of the service's [owned namespaces](routing.md#owned-domain-routing)) never leaves the service, on any call and any route, `Route.Outbox` included. With no handler here it is refused.
- **An owned event** with no handler here still goes to the outbox: other services subscribe to it.
- **A framework system command** reaches every service, the sender included, exactly once.
- **A route** (`Route.Local`, `Route.Outbox`, `Route.EventStoreOnly`, ...) decides, on a send, a publish or a cascade. A command routed to the event store only is refused: commands are not stored.
- **A schedule** (`DispatchOptions.ScheduledFor` in the future) defers both halves: the copy is written for later, and this service handles it when the copy comes back. A local call cannot be scheduled.

The outbox copy of a message this service already handled is **marked as handled here**, so this service does not run it again when its own copy comes back. A local handler that throws does not stop the outbox write: other services still receive the message, and the caller sees the original exception.

## Situation and decision {#situation}

A decision depends only on facts the dispatcher computes without the payload:

| Fact | Meaning |
|------|---------|
| Message kind | command, system command or event (with composite and owned flags), computed once per type |
| Local handlers | whether this service has a generated or runtime-registered handler |
| Route | the caller's `Route.X` wrapper or `[DefaultRouting]`, if any |
| Schedule | `ScheduledFor`, and whether it is later than the dispatcher's `TimeProvider` |
| Outbox | whether a work coordinator is registered |
| Overrides | the caller's [`DispatchBehaviors`](#behaviors) |
| Result required | whether the caller needs the handler's result back (a typed `LocalInvokeAsync`) |

### The decision {#decision}

The decision says when local handlers run (now, at the scheduled time, or not), whether the outbox is written, whether an event is stored without being sent, the delivery time, and, when refused, why (`DispatchRejection`). A refusal surfaces as the exception callers have always seen: `ReceptorNotFoundException` for a missing handler or outbox, `ArgumentException` for `Route.None()` or contradictory overrides, and `DispatchRejectedException` (with its `Rejection`) for the rest.

## Named policies {#policies}

Each kind of call has a named policy, composed from [shared rules](#rules) so a rule exists exactly once:

| Policy | Calls | Expectations |
|--------|-------|--------------|
| `Send` | `SendAsync` (every overload) | refuses with no outbox when nothing runs here |
| `SendMany` | `SendManyAsync` | `Send` per message; the batch is checked before anything runs |
| `LocalInvoke` | `LocalInvokeAsync`, `LocalInvokeAndSyncAsync` | local only; returns the handler's result; refuses with no handler |
| `LocalSendMany` | `LocalSendManyAsync` | local only per message; the batch is checked first |
| `Publish` | `PublishAsync` | every local receptor runs; with no outbox, defers to the deferred channel or logs |
| `PublishMany` | `PublishManyAsync` | `Publish` per message; the batch is checked first |
| `Cascade` | messages a handler returns, `CascadeMessageAsync` | the route decides; a cascade routed `Route.None()` is skipped quietly |

## Shared rules {#rules}

Rules run in order; a refusal ends the run. The order is part of a policy: the route is applied before the owned rule, so `Route.Outbox` cannot take an owned command's handling away.

| Rule | Used by | What it does |
|------|---------|--------------|
| `BehaviorsAreConsistent` | all | refuses `ThrowWhenNoHandler` together with `ContinueWhenNoHandler` |
| `RouteDecides` | Send, Publish, Cascade (and their batches) | local only when the route includes local dispatch, outbox only when it includes the outbox, store-only for an event routed to the event store alone |
| `LocalCallNeverSendsOut` | LocalInvoke, LocalSendMany | no outbox, no event store |
| `OwnedCommandStaysLocal` | Send, Publish, Cascade | an owned command never leaves the service |
| `SystemCommandBroadcasts` | Send, Publish, Cascade | a system command always goes out |
| `CommandCannotBeStoreOnly` | Send, Publish, Cascade | refuses a command routed store-only |
| `HandlerRequired` | all | refuses a missing handler where one is required (local calls, owned commands, a command kept in the service) |
| `ScheduledDefersBoth` | all | defers local handling to the returning copy; refuses a schedule that cannot hold |
| `ResultRequiresLocalRun` | all | refuses when the caller needs a result but the handler would not run now |
| `NoOutbox` | Send, Publish, Cascade | per policy: not sent on, refused, or handed to the deferred channel |

## Per-call overrides {#behaviors}

`DispatchOptions.Behaviors` adjusts the defaults for one call:

| Override | Effect |
|----------|--------|
| `ThrowWhenNoHandler` | fail whenever this service has no local handler, even where the default goes ahead (an event kept local with no subscriber) |
| `ContinueWhenNoHandler` | never fail for a missing handler; a call that must return the handler's result still fails |
| `AllowScheduleWithoutOutbox` | let a scheduled message fall back to the call's no-outbox behavior instead of failing |

```csharp{title="Overriding the missing-handler default" description="Continue quietly when no handler exists for an owned command" category="Usage" difficulty="INTERMEDIATE" tags=["Dispatcher", "Dispatch Policy", "Behaviors"] tests=["DispatchRulesTests.HandlerRequired_ContinueOverride_GoesAheadAsync"]}
var options = new DispatchOptions().WithBehaviors(DispatchBehaviors.ContinueWhenNoHandler);
await dispatcher.SendAsync(command, options);
```

## Batches {#batches}

The batch calls decide every message first, so one refused message fails the whole batch before anything runs. `DispatchOptions.BatchFailure` decides what happens when a local handler fails midway:

- `Stop` (the default): messages already handled keep their effects, the failed message's outbox copy is still written, the rest are neither handled nor queued, and the failure surfaces.
- `ContinueAndAggregate`: every message is handled and queued, then an `AggregateException` lists the failures.

## Scheduling {#scheduling}

A future `ScheduledFor` writes the outbox copy with that delivery time and marks it `LocalDeferred`. When the copy comes back, the sending service's PostInbox stage handles it (the same-service skip applies only to copies that were already handled here). A message that never leaves the service (a local call, an owned command, a local route) cannot be scheduled, and neither can one with no outbox unless the caller sets `AllowScheduleWithoutOutbox`.

## Cancellation and timeout {#cancellation}

The caller's `CancellationToken` reaches the local run, the cascades it triggers, the outbox write and its flush. `DispatchOptions.Timeout` links that token with a timer on the dispatcher's `TimeProvider` for the whole call. The token lives in one place, so a future distributed cancellation links in the same spot.

```csharp{title="A dispatch with a deadline" description="Cancel the whole dispatch after five seconds" category="Usage" difficulty="BEGINNER" tags=["Dispatcher", "Cancellation", "Timeout"] tests=["DispatchPolicyBehaviorComponentTests.Send_TimeoutElapsesDuringTheOutboxFlush_CancelsTheDispatchAsync"]}
await dispatcher.SendAsync(command, new DispatchOptions { Timeout = TimeSpan.FromSeconds(5) });
```

## Extending the policy {#extending}

### Hooks {#hooks}

An `IDispatchPolicyHook` runs after the policy, in `Order`, and sees the previous result. Returning the proposal unchanged is "no opinion". Register hooks in the container; with none registered the dispatcher uses the policy's decision directly.

```csharp{title="A dispatch policy hook" description="Keep one tenant's commands in-process" category="Extensibility" difficulty="ADVANCED" tags=["Dispatcher", "Dispatch Policy", "Hooks"] tests=["DispatchPolicyExtensionTests.Engine_Hook_ChangesTheDecisionAsync"]}
public sealed class KeepAuditCommandsLocal : IDispatchPolicyHook {
  public int Order => 100;

  public DispatchDecision Decide(DispatchPolicy policy, in DispatchSituation situation, in DispatchDecision proposed) {
    if (situation.IsCommand && situation.MessageType.Namespace == "MyApp.Audit" && situation.HasLocalHandler) {
      return proposed with { WriteOutbox = false };
    }
    return proposed;
  }
}

services.TryAddEnumerable(ServiceDescriptor.Singleton<IDispatchPolicyHook, KeepAuditCommandsLocal>());
```

### Guardrails {#guardrails}

A hook may change ownership or broadcast, but not ask for the impossible. `DispatchDecisionGuard` refuses, with `InvalidDispatchPolicyException`, a decision that runs local handlers where there are none, writes the outbox or event store from a local-only call, defers local handling without an outbox copy, sets a delivery time without an outbox copy, stores a command, or withholds a required result.

### Custom policies {#custom-policies}

Compose your own policy from the shared rules (and your own `DispatchRule`s), register it with an id of 1000 or more, and select it per call:

```csharp{title="A custom dispatch policy" description="Register a policy and select it for one call" category="Extensibility" difficulty="ADVANCED" tags=["Dispatcher", "Dispatch Policy", "Custom Policies"] tests=["DispatchPolicyExtensionTests.Registry_ResolvesARegisteredCustomPolicyAsync", "DispatchPolicyExtensionTests.Engine_Resolve_UsesTheCallsPolicyUnlessTheCallerChoseOneAsync"]}
var localOnlySend = new DispatchPolicy(new DispatchPolicyId(1001), "LocalOnlySend",
  DispatchExpectations.LocalOnly | DispatchExpectations.ThrowWhenNoHandler, NoOutboxBehavior.Throw,
  DispatchRules.BehaviorsAreConsistent,
  DispatchRules.LocalCallNeverSendsOut,
  DispatchRules.HandlerRequired);

registry.Register(localOnlySend);
await dispatcher.SendAsync(command, new DispatchOptions().WithPolicy(localOnlySend.Id));
```

## Performance {#performance}

A decision is structs and static rules and allocates nothing; the engine returns the policy's decision directly when no hook is registered. A test pins both at zero bytes.

## The complete decision table {#decision-table}

Every combination of the inputs (about 23,500) is checked by a test to behave like one of these named rows, so a behavior nobody named fails the build until it is added here. The rows are the test cases of `DispatchDecisionTableTests`, and the Component tests carry out the same decisions on the real dispatcher.

```csharp{title="The decision table as tests" description="Each row of this table is one test case" category="Testing" difficulty="ADVANCED" tags=["Dispatcher", "Dispatch Policy", "Testing"] tests=["DispatchDecisionTableTests.Row_DecidesAsTheTableSaysAsync", "DispatchDecisionTableTests.EveryCombination_BehavesLikeANamedRowAsync", "DispatchDecisionTableTests.EveryCombination_KeepsTheInvariantsAsync"]}
var decision = DispatchPolicies.Send.Decide(in situation);
```

### Send {#table-send}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 1 | command, handler here | now | yes | yes | – | goes ahead | `Send_Row01_UnownedCommand_Handled_RunsHereAndGoesOut` |
| 2 | command, no handler here | – | yes | – | – | goes ahead | `Send_Row02_UnownedCommand_NoHandler_GoesOut` |
| 3 | owned command, handler here | now | – | – | – | goes ahead | `Send_Row03_OwnedCommand_Handled_StaysHere` |
| 4 | owned command, no handler here | – | – | – | – | refused: NoHandler | `Send_Row04_OwnedCommand_NoHandler_Throws` |
| 5 | system command, handler here | now | yes | yes | – | goes ahead | `Send_Row05_SystemCommand_Handled_RunsHereAndGoesOut` |
| 6 | system command, no handler here | – | yes | – | – | goes ahead | `Send_Row06_SystemCommand_NoHandler_GoesOut` |
| 7 | event, handler here | now | yes | yes | – | goes ahead | `Send_Row07_UnownedEvent_Handled_RunsHereAndGoesOut` |
| 8 | owned event, no handler here | – | yes | – | – | goes ahead | `Send_Row08_OwnedEvent_NoHandler_GoesOut` |
| 9 | command, handler here, Route.Local | now | – | – | – | goes ahead | `Send_Row09_RoutedLocal_RunsHereOnly` |
| 10 | command, handler here, Route.Outbox | – | yes | – | – | goes ahead | `Send_Row10_RoutedOutbox_GoesOutOnly` |
| 11 | owned command, handler here, Route.Outbox | now | – | – | – | goes ahead | `Send_Row11_OwnedCommand_RoutedOutbox_StaysHere` |
| 12 | command, handler here, Route.EventStoreOnly | – | – | – | – | refused: CommandCannotBeStoreOnly | `Send_Row12_Command_RoutedEventStoreOnly_Throws` |
| 13 | command, handler here, scheduled for later | when the copy comes back | yes, scheduled | – | – | goes ahead | `Send_Row13_Handled_Scheduled_RunsWhenItComesBack` |
| 14 | command, no handler here, scheduled for later | – | yes, scheduled | – | – | goes ahead | `Send_Row14_NoHandler_Scheduled_GoesOutLater` |
| 15 | owned command, handler here, scheduled for later | – | – | – | – | refused: CannotScheduleInProcess | `Send_Row15_OwnedCommand_Scheduled_Throws` |
| 16 | command, handler here, no outbox | now | – | – | – | goes ahead | `Send_Row16_Handled_NoOutbox_RunsHereOnly` |
| 17 | command, no handler here, no outbox | – | – | – | – | refused: NoOutbox | `Send_Row17_NoHandler_NoOutbox_Throws` |
| 18 | command, handler here, Route.None | – | – | – | – | refused: NoRoute | `Send_Row18_RoutedNone_Throws` |
| 19 | event, handler here, Route.EventStoreOnly | – | – | – | yes | goes ahead | `Send_Row19_Event_RoutedEventStoreOnly_StoredOnly` |
| 54 | command, no handler here, Route.Local | – | – | – | – | refused: NoHandler | `Send_Row54_Command_RoutedLocal_NoHandler_Throws` |
| 55 | command, no handler here, Route.Local, ContinueWhenNoHandler | – | – | – | – | goes ahead | `Send_Row55_Command_RoutedLocal_NoHandler_ContinueOverride_DoesNothing` |
| 60 | owned command, no handler here, ContinueWhenNoHandler | – | – | – | – | goes ahead | `Send_Row60_OwnedCommand_NoHandler_ContinueOverride_DoesNothing` |
| 64 | command, handler here, ThrowWhenNoHandler + ContinueWhenNoHandler | – | – | – | – | refused: ConflictingBehaviors | `Send_Row64_BothHandlerOverrides_Throws` |
| 67 | command, handler here, scheduled for later, no outbox | – | – | – | – | refused: NoOutbox | `Send_Row67_Command_Scheduled_NoOutbox_Throws` |
| 68 | command, handler here, scheduled for later, no outbox, AllowScheduleWithoutOutbox | – | – | – | – | refused: NoOutbox | `Send_Row68_Command_Scheduled_NoOutbox_AllowOverride_StillThrows` |
| 69 | event, handler here, Route.Local | now | – | – | yes | goes ahead | `Send_Row69_Event_RoutedLocal_RunsHereAndIsStored` |
| 83 | command, no handler here, result required | – | – | – | – | refused: ResultUnavailable | `Send_Row83_ResultRequired_NotHandledHere_Throws` |
| 84 | command, handler here, Route.Outbox, result required | – | – | – | – | refused: ResultUnavailable | `Send_Row84_ResultRequired_RoutedOutbox_Throws` |
| 86 | command, handler here, result required | now | yes | yes | – | goes ahead | `Send_Row86_ResultRequired_Handled_RunsHereAndGoesOut` |

### SendMany {#table-sendmany}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 20 | command, handler here | now | yes | yes | – | goes ahead | `SendMany_Row20_UnownedCommand_Handled_RunsHereAndGoesOut` |
| 21 | owned command, no handler here | – | – | – | – | refused: NoHandler | `SendMany_Row21_OwnedCommand_NoHandler_Throws` |
| 22 | command, no handler here, no outbox | – | – | – | – | refused: NoOutbox | `SendMany_Row22_NoHandler_NoOutbox_Throws` |

### LocalInvoke {#table-localinvoke}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 23 | command, handler here | now | – | – | – | goes ahead | `LocalInvoke_Row23_Handled_RunsHereOnly` |
| 24 | command, no handler here | – | – | – | – | refused: NoHandler | `LocalInvoke_Row24_NoHandler_Throws` |
| 25 | command, handler here, scheduled for later | – | – | – | – | refused: CannotScheduleInProcess | `LocalInvoke_Row25_Scheduled_Throws` |
| 26 | system command, handler here | now | – | – | – | goes ahead | `LocalInvoke_Row26_SystemCommand_StaysHere` |
| 27 | event, handler here, Route.Outbox | now | – | – | – | goes ahead | `LocalInvoke_Row27_RouteIgnored_RunsHereOnly` |
| 62 | command, no handler here, ContinueWhenNoHandler | – | – | – | – | goes ahead | `LocalInvoke_Row62_NoHandler_ContinueOverride_DoesNothing` |
| 63 | command, no handler here, ContinueWhenNoHandler, result required | – | – | – | – | refused: NoHandler | `LocalInvoke_Row63_NoHandler_ContinueOverride_ResultRequired_StillThrows` |
| 75 | command, handler here, ThrowWhenNoHandler + ContinueWhenNoHandler | – | – | – | – | refused: ConflictingBehaviors | `LocalInvoke_Row75_BothHandlerOverrides_Throws` |

### LocalSendMany {#table-localsendmany}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 28 | command, handler here | now | – | – | – | goes ahead | `LocalSendMany_Row28_Handled_RunsHereOnly` |
| 29 | command, no handler here | – | – | – | – | refused: NoHandler | `LocalSendMany_Row29_NoHandler_Throws` |

### Publish {#table-publish}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 30 | event, handler here | now | yes | yes | – | goes ahead | `Publish_Row30_Event_Handled_RunsHereAndGoesOut` |
| 31 | event, no handler here | – | yes | – | – | goes ahead | `Publish_Row31_Event_NoHandler_GoesOut` |
| 32 | event, handler here, scheduled for later | when the copy comes back | yes, scheduled | – | – | goes ahead | `Publish_Row32_Event_Handled_Scheduled_RunsWhenItComesBack` |
| 33 | event, no handler here, no outbox | – | deferred channel or log | – | – | goes ahead | `Publish_Row33_Event_NoHandler_NoOutbox_DefersOrLogs` |
| 34 | event, handler here, no outbox | now | deferred channel or log | yes | – | goes ahead | `Publish_Row34_Event_Handled_NoOutbox_RunsHereAndDefersOrLogs` |
| 35 | owned command, handler here | now | – | – | – | goes ahead | `Publish_Row35_OwnedCommand_Handled_StaysHere` |
| 36 | owned command, no handler here | – | – | – | – | refused: NoHandler | `Publish_Row36_OwnedCommand_NoHandler_Throws` |
| 37 | owned event, handler here | now | yes | yes | – | goes ahead | `Publish_Row37_OwnedEvent_Handled_RunsHereAndGoesOut` |
| 56 | event, no handler here, Route.LocalNoPersist | – | – | – | – | goes ahead | `Publish_Row56_Event_RoutedLocalNoPersist_NoHandler_DoesNothing` |
| 57 | event, no handler here, Route.LocalNoPersist, ThrowWhenNoHandler | – | – | – | – | refused: NoHandler | `Publish_Row57_Event_RoutedLocalNoPersist_NoHandler_ThrowOverride_Throws` |
| 58 | event, no handler here, Route.Local | – | – | – | yes | goes ahead | `Publish_Row58_Event_RoutedLocal_NoHandler_IsStored` |
| 61 | event, no handler here, ThrowWhenNoHandler | – | – | – | – | refused: NoHandler | `Publish_Row61_Event_NoHandler_ThrowOverride_Throws` |
| 65 | event, handler here, scheduled for later, no outbox | – | – | – | – | refused: NoOutbox | `Publish_Row65_Event_Scheduled_NoOutbox_Throws` |
| 66 | event, handler here, scheduled for later, no outbox, AllowScheduleWithoutOutbox | when the copy comes back | deferred channel or log | – | – | goes ahead | `Publish_Row66_Event_Scheduled_NoOutbox_AllowOverride_DefersOrLogs` |
| 70 | event, handler here, Route.Local | now | – | – | yes | goes ahead | `Publish_Row70_Event_RoutedLocal_RunsHereAndIsStored` |
| 71 | command, no handler here, Route.None | – | – | – | – | refused: NoRoute | `Publish_Row71_RoutedNone_Throws` |
| 72 | command, no handler here, Route.EventStoreOnly | – | – | – | – | refused: CommandCannotBeStoreOnly | `Publish_Row72_Command_RoutedEventStoreOnly_Throws` |
| 73 | event, handler here, Route.Local, scheduled for later | – | – | – | – | refused: CannotScheduleInProcess | `Publish_Row73_Event_RoutedLocal_Scheduled_Throws` |
| 76 | event, handler here, ThrowWhenNoHandler + ContinueWhenNoHandler | – | – | – | – | refused: ConflictingBehaviors | `Publish_Row76_BothHandlerOverrides_Throws` |
| 78 | event, no handler here, scheduled for later, no outbox, AllowScheduleWithoutOutbox | – | deferred channel or log | – | – | goes ahead | `Publish_Row78_Event_NoHandler_Scheduled_NoOutbox_AllowOverride_DefersOrLogs` |
| 85 | event, handler here, scheduled for later, result required | – | – | – | – | refused: ResultUnavailable | `Publish_Row85_ResultRequired_Scheduled_Throws` |

### PublishMany {#table-publishmany}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 38 | event, handler here | now | yes | yes | – | goes ahead | `PublishMany_Row38_Event_Handled_RunsHereAndGoesOut` |
| 39 | event, no handler here | – | yes | – | – | goes ahead | `PublishMany_Row39_Event_NoHandler_GoesOut` |

### Cascade {#table-cascade}

| # | Situation | Runs here | Outbox copy | Marked handled here | Stored only | Result | Test case |
|---|---|---|---|---|---|---|---|
| 40 | event, handler here | now | yes | yes | – | goes ahead | `Cascade_Row40_Event_NoRouteChosen_RunsHereAndGoesOut` |
| 41 | event, handler here, Route.Both | now | yes | yes | – | goes ahead | `Cascade_Row41_Event_RoutedBoth_RunsHereAndGoesOut` |
| 42 | owned command, handler here, Route.Both | now | – | – | – | goes ahead | `Cascade_Row42_OwnedCommand_RoutedBoth_StaysHere` |
| 43 | event, handler here, Route.Local | now | – | – | yes | goes ahead | `Cascade_Row43_Event_RoutedLocal_RunsHereAndIsStored` |
| 44 | command, handler here, Route.Local | now | – | – | – | goes ahead | `Cascade_Row44_Command_RoutedLocal_RunsHereOnly` |
| 45 | event, handler here, Route.LocalNoPersist | now | – | – | – | goes ahead | `Cascade_Row45_Event_RoutedLocalNoPersist_RunsHereOnly` |
| 46 | event, handler here, Route.Outbox | – | yes | – | – | goes ahead | `Cascade_Row46_Event_RoutedOutbox_GoesOutOnly` |
| 47 | owned command, handler here, Route.Outbox | now | – | – | – | goes ahead | `Cascade_Row47_OwnedCommand_RoutedOutbox_StaysHere` |
| 48 | event, no handler here, Route.EventStoreOnly | – | – | – | yes | goes ahead | `Cascade_Row48_Event_RoutedEventStoreOnly_StoredOnly` |
| 49 | command, no handler here, Route.EventStoreOnly | – | – | – | – | refused: CommandCannotBeStoreOnly | `Cascade_Row49_Command_RoutedEventStoreOnly_Throws` |
| 50 | owned command, no handler here, Route.Both | – | – | – | – | refused: NoHandler | `Cascade_Row50_OwnedCommand_NoHandler_Throws` |
| 51 | system command, handler here, Route.Local | now | yes | yes | – | goes ahead | `Cascade_Row51_SystemCommand_RoutedLocal_StillGoesOut` |
| 52 | event, handler here, Route.Local, scheduled for later | – | – | – | – | refused: CannotScheduleInProcess | `Cascade_Row52_Event_RoutedLocal_Scheduled_Throws` |
| 53 | event, no handler here, Route.Both, no outbox | – | deferred channel or log | – | – | goes ahead | `Cascade_Row53_Event_NoHandler_NoOutbox_DefersOrLogs` |
| 59 | command, no handler here, Route.Local | – | – | – | – | refused: NoHandler | `Cascade_Row59_Command_RoutedLocal_NoHandler_Throws` |
| 74 | command, no handler here, Route.None | – | – | – | – | refused: NoRoute | `Cascade_Row74_RoutedNone_RefusedAndTheCascadeSkipsItQuietly` |
| 77 | event, handler here, ThrowWhenNoHandler + ContinueWhenNoHandler | – | – | – | – | refused: ConflictingBehaviors | `Cascade_Row77_BothHandlerOverrides_Throws` |
| 79 | event, no handler here, scheduled for later, no outbox | – | – | – | – | refused: NoOutbox | `Cascade_Row79_Event_NoHandler_Scheduled_NoOutbox_Throws` |
| 80 | event, no handler here, scheduled for later, no outbox, AllowScheduleWithoutOutbox | – | deferred channel or log | – | – | goes ahead | `Cascade_Row80_Event_NoHandler_Scheduled_NoOutbox_AllowOverride_DefersOrLogs` |
| 81 | event, handler here, scheduled for later, no outbox, AllowScheduleWithoutOutbox | when the copy comes back | deferred channel or log | – | – | goes ahead | `Cascade_Row81_Event_Handled_Scheduled_NoOutbox_AllowOverride_RunsWhenItComesBack` |
| 82 | command, no handler here, Route.Local, ContinueWhenNoHandler | – | – | – | – | goes ahead | `Cascade_Row82_Command_RoutedLocal_NoHandler_ContinueOverride_DoesNothing` |
| 87 | command, no handler here, result required | – | – | – | – | refused: ResultUnavailable | `Cascade_Row87_ResultRequired_NotHandledHere_Throws` |

### Batch policies {#table-batches}

A batch policy decides each message exactly as its single-message sibling does, so every row of the sibling also applies to the batch policy, numbered from the offset below and marked "same as" the original in the test names (for example `SendMany_Row100_SameAs01_UnownedCommand_Handled_RunsHereAndGoesOut`).

| Batch policy | Same as | Rows | Plus |
|---|---|---|---|
| SendMany | Send rows 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 54, 55, 60, 64, 67, 68, 69, 83, 84, 86 | 100–128 | its own rows 20, 21, 22 |
| LocalSendMany | LocalInvoke rows 23, 24, 25, 26, 27, 62, 63, 75 | 200–207 | its own rows 28, 29 |
| PublishMany | Publish rows 30, 31, 32, 33, 34, 35, 36, 37, 56, 57, 58, 61, 65, 66, 70, 71, 72, 73, 76, 78, 85 | 300–320 | its own rows 38, 39 |

## Related {#related}

- [Dispatcher routing](routing.md): owned domains, topics and echo suppression
- [Lifecycle stages](../lifecycle/lifecycle-stages.md#stage-semantics): when local and pipeline stages fire
- [Message cascade](message-cascade.md): returning messages from a handler, and `Route.X`
