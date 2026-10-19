---
title: 'WHIZ151: Command type has more than one inbox receptor'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when two or more receptor classes in one compilation handle the same command type from the inbox;
  one service owns a command, and a second handler would process every command twice.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - commands
  - receptors
  - routing
  - ownership
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/CommandOwnershipAnalyzer.cs
  - src/Whizbang.Generators/CompileTimeMessageClassification.cs
  - src/Whizbang.Core/Messaging/FireAtAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/CommandOwnershipAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ151: Command type has more than one inbox receptor

**Severity**: Error
**Category**: Routing

## Description

A command has exactly one owner. Unlike events, which fan out to every interested receptor, a command type is handled
by one service. Under per-namespace command inboxes, each service with an inbox receptor for a command subscribes to
that command namespace's inbox, so a second receptor class for the same command is a second claim on the inbox, and
every command would be delivered and handled twice.

WHIZ151 reports this when it is visible at build time: two or more **different** concrete classes in the same
compilation implement `IReceptor<TCommand>` (with or without a response type) or `ISyncReceptor<TCommand>` for the
same command type. The diagnostic is reported on every claiming class, at compilation end, and lists all of them.
Duplicates across separately built services cannot be seen by the analyzer; the description of this rule assigns that
case to a runtime topology check.

The message type counts as a command using the same rules as routing: a `[MessageKind]` attribute first, then the
framework system-command namespace (which classifies as System, not Command), then the `ICommand` marker interface,
then a `Commands` namespace segment, then the type-name suffix. A type in a `.Commands` namespace is therefore a command
even without `ICommand`.

These are **not** claims and never trigger WHIZ151:

- receptors for events, queries or framework system commands;
- abstract receptor classes (only concrete classes are registration units);
- one class that implements both `IReceptor<T>` and `ISyncReceptor<T>` for the same command (one registration unit);
- lifecycle receptors whose `[FireAt(...)]` stages are all inbox, perspective or lifecycle-completion stages (names
  starting with `PreInbox`, `PostInbox`, `PrePerspective`, `PostPerspective`, `PostAllPerspectives` or
  `PostLifecycle`). These observe the command rather than handle it.

A receptor with no `[FireAt]`, or with any stage outside that list, counts as an inbox handler.

## Diagnostic Message

```
Command '{CommandType}' has inbox receptors in multiple classes ({ReceptorClasses}); one service owns a command type; move the command's handling into a single receptor (lifecycle observers should use [FireAt(...)] stages instead)
```

## Common Causes

1. **A second handler was added** for a command that already has one, for example for auditing or metrics.
2. **Sync and async receptors in separate classes** handle the same command; they are the same claim.
3. **Two services' receptor projects are compiled together** into one assembly.
4. **A type in a `.Commands` namespace** is treated as a command, though it was intended as something else.

## How to Fix

- **Keep one receptor** for the command and move the other class's handling into it.
- **Turn observers into lifecycle receptors**: if the second class only watches the command (audit, metrics), mark it
  with `[FireAt(...)]` at an inbox stage such as `PreInboxInline` or `PostInboxDetached`.
- **Combine sync and async surfaces** into one class if both are needed.
- **Reclassify the message** with `[MessageKind]` or move it out of the `Commands` namespace if it is really an event.

### Before (causes WHIZ151)

```csharp{title="Two receptor classes for one command" description="Two concrete classes implement IReceptor<CreateOrder>; WHIZ151 is reported on both as an error." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["commands", "receptors", "ownership", "WHIZ151"] testFile="CommandOwnershipAnalyzerTests.cs" testMethod="TwoReceptorClasses_SameCommand_ReportsWhiz151OnEachAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/CommandOwnershipAnalyzerTests.cs" tests=["CommandOwnershipAnalyzerTests.TwoReceptorClasses_SameCommand_ReportsWhiz151OnEachAsync"]}
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;

namespace ConsumerApp.Orders.Commands;

public record CreateOrder(string Name) : ICommand;

public class CreateOrderReceptor : IReceptor<CreateOrder> {  // WHIZ151
  public ValueTask HandleAsync(CreateOrder message, CancellationToken cancellationToken = default)
    => ValueTask.CompletedTask;
}

public class DuplicateCreateOrderReceptor : IReceptor<CreateOrder> {  // WHIZ151
  public ValueTask HandleAsync(CreateOrder message, CancellationToken cancellationToken = default)
    => ValueTask.CompletedTask;
}
```

### After (no diagnostic)

Observers that only watch the command run at lifecycle stages and do not claim it:

```csharp{title="Lifecycle observers of a command" description="Receptors whose [FireAt] stages are inbox lifecycle stages observe the command and do not count as inbox handlers." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["commands", "receptors", "lifecycle", "WHIZ151"] testFile="CommandOwnershipAnalyzerTests.cs" testMethod="LifecycleOnlyReceptors_SameCommand_AreSilentAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/CommandOwnershipAnalyzerTests.cs" tests=["CommandOwnershipAnalyzerTests.LifecycleOnlyReceptors_SameCommand_AreSilentAsync"]}
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;
using Whizbang.Core.Messaging;

namespace ConsumerApp.Orders.Commands;

public record CreateOrder(string Name) : ICommand;

[FireAt(LifecycleStage.PreInboxInline)]
public class AuditHook : IReceptor<CreateOrder> {
  public ValueTask HandleAsync(CreateOrder message, CancellationToken cancellationToken = default)
    => ValueTask.CompletedTask;
}

[FireAt(LifecycleStage.PostInboxDetached)]
public class MetricsHook : IReceptor<CreateOrder> {
  public ValueTask HandleAsync(CreateOrder message, CancellationToken cancellationToken = default)
    => ValueTask.CompletedTask;
}
```

Keeping a single handler class for `CreateOrder` (alone, or alongside such observers) also clears the error.

## Related

- [Routing](../../fundamentals/dispatcher/routing)
- [Receptors](../../fundamentals/receptors/receptors)
- [Lifecycle Receptors](../../fundamentals/receptors/lifecycle-receptors)
- [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages)
