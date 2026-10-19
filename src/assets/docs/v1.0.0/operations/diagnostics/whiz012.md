---
title: 'WHIZ012: Perspective Invoker Routing Generated'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that the source generator produced event-to-perspective routing for a discovered perspective.
  No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - routing
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveInvokerGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ012: Perspective Invoker Routing Generated

**Severity**: Info
**Category**: Source Generation / Perspectives

## Description

This is a discovery notice, not a problem. The `PerspectiveInvokerGenerator` builds the routing that sends each
event to the perspectives that handle it, without reflection. It reports WHIZ012 once for every perspective it
includes in that routing, naming the perspective and the events routed to it. The notice is reported at the
perspective class's name.

A class is included when it:

- is **not abstract** (abstract classes are skipped), and
- implements a perspective interface with at least one event type, such as `IPerspectiveFor<TModel, TEvent>` or
  `IPerspectiveWithActionsFor<TModel, TEvent>`.

A class that implements only the model-only marker interface (one type argument, no events) is skipped and produces no
WHIZ012. When no perspective is found at all, the generator emits an empty invoker and reports nothing.

If a perspective you wrote does not appear in a WHIZ012 notice, events will not be routed to it by the generated
invoker. Checking for the notice is a quick way to confirm discovery.

## Diagnostic Message

```
Generated perspective invoker routing for '{PerspectiveName}' → {EventNames}
```

`{PerspectiveName}` is the perspective's simple class name. `{EventNames}` is a comma-separated list of the simple
names of the event types the perspective handles.

## Common Causes

1. **A perspective class was declared** in a project that references the Whizbang generators.
2. **An event type was added** to an existing perspective's interface, which changes the event list in the message.

## How to Fix

There is nothing to fix. If a perspective is missing from the notices, check that the class is not abstract and that
it implements a perspective interface that names at least one event type. See
[Perspective Discovery](../../extending/source-generators/perspective-discovery).

## What Produces It

Any concrete perspective produces the notice. No test asserts the WHIZ012 ID itself; the shape below is the one the
generator tests use to check that routing is generated for a perspective.

```csharp{title="A perspective that produces WHIZ012" description="A concrete perspective handling one event; the generator routes the event to it and reports WHIZ012." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "perspectives", "routing"] unverified="no test asserts the WHIZ012 ID; routing for this shape is checked by PerspectiveInvokerGeneratorTests.Generator_IPerspectiveWithActionsFor_GeneratesInvokerAsync"}
using System;
using Whizbang.Core;
using Whizbang.Core.Perspectives;

namespace TestApp;

public record DeletedEvent : IEvent {
  [StreamId]
  public Guid Id { get; init; }
}

public record OrderModel {
  [StreamId]
  public Guid Id { get; init; }
}

// Reported as: Generated perspective invoker routing for 'OrderPurgePerspective' → DeletedEvent
public class OrderPurgePerspective : IPerspectiveWithActionsFor<OrderModel, DeletedEvent> {
  public ApplyResult<OrderModel> Apply(OrderModel current, DeletedEvent @event)
    => ApplyResult<OrderModel>.Purge();
}
```

## Suppressing

WHIZ012 is reported at the perspective class's name, so you can silence it for one perspective by wrapping the class
in a `#pragma` region:

```csharp{title="Silence WHIZ012 for one perspective" description="A pragma region around the perspective class hides its routing notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "pragma"] unverified="suppression/config, not exercised by a test"}
#pragma warning disable WHIZ012
public class OrderPurgePerspective : IPerspectiveWithActionsFor<OrderModel, DeletedEvent> {
  public ApplyResult<OrderModel> Apply(OrderModel current, DeletedEvent @event)
    => ApplyResult<OrderModel>.Purge();
}
#pragma warning restore WHIZ012
```

A `[*.cs]` section in `.editorconfig` with `dotnet_diagnostic.WHIZ012.severity = none` also applies. To turn it off
for the whole project, set the severity in a global analyzer config file:

```ini{title="Silence WHIZ012 project-wide" description="A global analyzer config that turns off the WHIZ012 routing notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ012.severity = none
```

Silencing it is safe: it only reports what was generated. Keep it on while you are tracking down a perspective that
never receives events.

## Related

- [Perspectives](../../fundamentals/perspectives/perspectives)
- [Perspectives With Actions](../../fundamentals/perspectives/perspectives-with-actions)
- [Perspective Discovery](../../extending/source-generators/perspective-discovery)
