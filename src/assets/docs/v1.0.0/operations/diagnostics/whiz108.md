---
title: "WHIZ108: An overwrite-only perspective's Apply must not read its current model"
pageType: troubleshooting
verifiedAgainstCommit: 34936cf3
verifiedDate: 2026-10-30
description: >-
  Warning diagnostic when an Apply of a perspective marked [OverwriteOnly] reads its current-model parameter. A rewind
  of an overwrite-only perspective applies only the stream's last event to an empty model, so anything the Apply
  carries forward from the model would be lost.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - rewind
  - overwrite-only
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectiveCurrentModelAnalyzer.cs
  - src/Whizbang.Core/Attributes/OverwriteOnlyAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/OverwriteOnlyAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/OverwriteOnlyRewindTests.cs
lastMaintainedCommit: '34936cf3'
---

# WHIZ108: An overwrite-only perspective's Apply must not read its current model

**Severity**: Warning
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

`[OverwriteOnly]` declares that every `Apply` of a perspective builds the row from its event alone, so the row after
any event is that event's. The runner relies on the promise: a rewind of a marked perspective applies only the
stream's last event, to an empty model, instead of replaying the whole stream (see
[Overwrite-only perspectives](../../fundamentals/perspectives/rewind#overwrite-only)).

An `Apply` that reads its current-model parameter folds earlier events into the row: a counter, a merged list, a value
kept from a previous event. The live drain would keep that value, but a rewind would drop it, because the rewind never
applies the earlier events. The live row and the rewound row would differ.

WHIZ108 is reported once per `Apply` of a perspective marked `[OverwriteOnly]` that reads its current-model parameter,
at the first read, however many times the `Apply` reads it. Passing the model to a helper counts as reading it.

It is **not** reported for:

- `nameof(current)`, which names the parameter without reading it;
- an `Apply` of a perspective that is not marked `[OverwriteOnly]`; folding onto the current model is the default.

{verified: OverwriteOnlyAnalyzerTests.AnOverwriteOnlyApplyThatReadsItsCurrentModel_IsWarnedAsync, OverwriteOnlyAnalyzerTests.AnOverwriteOnlyApplyThatIgnoresItsCurrentModel_IsNotWarnedAsync, OverwriteOnlyAnalyzerTests.AnUnmarkedApplyThatReadsItsCurrentModel_IsNotWarnedAsync}

## Diagnostic Message

```text
Apply method '{MethodName}' of overwrite-only perspective '{PerspectiveName}' reads its current model '{ParameterName}'. A rewind of an [OverwriteOnly] perspective applies only the stream's last event to an empty model, so whatever this Apply carries forward from the model would be lost. Build the model from the event alone, or remove [OverwriteOnly].
```

## Common Causes

1. **A counter or history** kept on the row (`Changes = current.Changes + 1`) on a perspective otherwise built from
   each event.
2. **A `with` expression** on the current model (`current with { Set = @event.Set }`) where building a new model was
   meant.
3. **The marker added to the wrong perspective**, one that genuinely folds its events.

## How to Fix

Decide which is true of the perspective.

- **Every event carries the whole row.** Build the model from the event alone and drop the read.
- **The row depends on earlier events.** The perspective is not overwrite-only: remove `[OverwriteOnly]`, and its
  rewinds replay the stream in full.

### Before (causes WHIZ108)

```csharp{title="An overwrite-only Apply reads its current model (causes WHIZ108)" description="current with { ... } and current.Changes read the model a rewind of a marked perspective never folds" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "OverwriteOnly", "WHIZ108"] tests=["OverwriteOnlyAnalyzerTests.AnOverwriteOnlyApplyThatReadsItsCurrentModel_IsWarnedAsync"]}
using System;
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

public record Grants {
  [StreamId] public Guid UserId { get; init; }
  public string Set { get; init; } = "";
  public int Changes { get; init; }
}

public record GrantsSet : IEvent {
  [StreamId] public Guid UserId { get; init; }
  public string Set { get; init; } = "";
}

[OverwriteOnly]
public class GrantsPerspective : IPerspectiveFor<Grants, GrantsSet> {
  // WHIZ108: Changes depends on every earlier event, which a rewind does not apply
  public Grants Apply(Grants current, GrantsSet @event) =>
    current with { Set = @event.Set, Changes = current.Changes + 1 };
}
```

### After (no diagnostic)

```csharp{title="An overwrite-only Apply builds the model from its event" description="The model is built from the event alone, so applying only the stream's last event writes the same row a full replay writes" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "OverwriteOnly", "WHIZ108"] tests=["OverwriteOnlyAnalyzerTests.AnOverwriteOnlyApplyThatIgnoresItsCurrentModel_IsNotWarnedAsync", "OverwriteOnlyRewindTests.ARewindOfAnOverwriteOnlyPerspective_AppliesOnlyTheLastEvent_AndWritesTheRowAFullReplayWritesAsync"]}
[OverwriteOnly]
public class GrantsPerspective : IPerspectiveFor<Grants, GrantsSet> {
  public Grants Apply(Grants current, GrantsSet @event) =>
    new() { UserId = @event.UserId, Set = @event.Set };
}
```

If the count of changes matters, carry it on the event (the producer knows the revision) rather than accumulating it on
the row.

## If the Diagnostic Is Suppressed

Nothing at run time catches it. A rewind of the perspective applies only the last event to an empty model, so the row
it writes loses whatever the `Apply` carried forward, and differs from the row the live drain had built.

## Related

- [Perspective Rewind: Overwrite-only perspectives](../../fundamentals/perspectives/rewind#overwrite-only)
- [WHIZ107: Apply never receives a null model](whiz107)
- [Error Reference](error-reference)
