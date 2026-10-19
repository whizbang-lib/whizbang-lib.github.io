---
title: 'WHIZ104: Apply method should use event timestamps instead of reading the clock'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective Apply method (or a [CollectiveApplyFor] method) reads the wall clock through
  DateTime or DateTimeOffset Now or UtcNow. Replay would stamp the model with the rebuild time instead of the event time.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - purity
  - determinism
  - timestamps
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ104: Apply method should use event timestamps instead of reading the clock

**Severity**: Warning
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

`Apply` must produce the same model every time it folds the same events. Reading the clock breaks that: when a
perspective is rebuilt, a field set from `DateTime.UtcNow` gets the time of the rebuild, not the time of the event.
A timestamp carried on the event gives the same value on every replay.

WHIZ104 is reported for each read of `DateTime.Now`, `DateTime.UtcNow`, `DateTimeOffset.Now` or
`DateTimeOffset.UtcNow` inside a method named `Apply` on a perspective class (`IPerspectiveFor`,
`IPerspectiveWithActionsFor`, `IPerspectiveBase`, `IGlobalPerspectiveFor`) or inside any method marked
`[CollectiveApplyFor]`. Other members of those types, such as `DateTime.MaxValue` or `DateTimeOffset.MinValue`,
are constants and are not reported.

A read is found by the property it binds to, not by how it is spelled, so `System.DateTime.UtcNow` and
`global::System.DateTimeOffset.Now` are reported as well. It is a warning, not an error.

## Diagnostic Message

```text
Apply method '{MethodName}' uses {ClockRead} which is non-deterministic. Use event timestamps instead for purity.
```

`{ClockRead}` names the read that was found: `DateTime.Now`, `DateTime.UtcNow`, `DateTimeOffset.Now` or
`DateTimeOffset.UtcNow`. For example, `uses DateTimeOffset.Now`.

## Common Causes

1. **Stamping an `UpdatedAt` or `ProcessedAt` field** with the current time.
2. **A collective apply that records when it ran.** Collective applies are folded during replay too, so the same
   rule applies to `[CollectiveApplyFor]` methods.

## How to Fix

Take the time from the event. Add a timestamp property to the event (set by the command side when the event is
created) and assign it in `Apply`.

### Before (causes WHIZ104)

```csharp{title="Apply reads DateTime.UtcNow (causes WHIZ104)" description="Stamping the model with the wall clock inside Apply is reported as WHIZ104." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ104"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_DateTimeUtcNowUsage_ReportsWHIZ104WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_DateTimeUtcNowUsage_ReportsWHIZ104WarningAsync"]}
using System;
using Whizbang.Core.Perspectives;

public record Order {
  public Guid Id { get; set; }
  public DateTimeOffset UpdatedAt { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public Order Apply(Order current, OrderUpdated @event) {
    return current with { UpdatedAt = DateTime.UtcNow };  // WHIZ104
  }
}
```

### After (no diagnostic)

```csharp{title="Apply takes the time from the event" description="Reading the event's own timestamp is deterministic and reports no purity diagnostics." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ104"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync"]}
using System;
using Whizbang.Core.Perspectives;

public class Order {
  public Guid Id { get; set; }
  public string Status { get; set; } = "";
  public int Version { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
  public string NewStatus { get; set; } = "";
  public DateTimeOffset OccurredAt { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public Order Apply(Order current, OrderUpdated @event) {
    current.Id = @event.OrderId;
    current.Status = @event.NewStatus;
    current.Version++;
    return current;
  }
}
```

## Suppressing

Suppress only when the value read from the clock does not reach the model (for example, it feeds a log line) and
you accept that replay will not reproduce it. Do not suppress to keep an `UpdatedAt` field stamped with the
current time: that field will change on every rebuild.

For a single occurrence:

```csharp{title="Suppress WHIZ104 with a pragma" description="Disables WHIZ104 around one line of an Apply method." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ104", "Suppression"] unverified="suppression syntax, standard Roslyn behavior not exercised by a WHIZ104 test"}
#pragma warning disable WHIZ104
var observedAt = DateTime.UtcNow;
#pragma warning restore WHIZ104
```

For a whole project, in `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ104.severity = none
```

## Related

- [WHIZ100: Apply method must be synchronous](whiz100)
- [WHIZ106: Collective apply must not query other perspectives at apply time](whiz106)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
- [Collective Events](../../fundamentals/messaging/collective-events)
