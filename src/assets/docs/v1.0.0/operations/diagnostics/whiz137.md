---
title: 'WHIZ137: Destruction value has not shipped'
pageType: troubleshooting
description: >-
  Error diagnostic when code names Destruction.OnCompaction or Destruction.Archived, whose handlers for ephemeral event
  bodies have not shipped, so the declaration fails the build instead of compiling into a silent delete.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - ephemeral
  - destruction
  - archive
  - analyzer
codeReferences:
  - src/Whizbang.Generators/UnshippedDestructionAnalyzer.cs
  - src/Whizbang.Core/Attributes/Destruction.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
testReferences:
  - tests/Whizbang.Generators.Tests/UnshippedDestructionAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerDispositionTests.cs
---

# WHIZ137: Destruction value has not shipped

**Severity**: Error
**Category**: Ephemeral Events

## Description

`Destruction` says how an [ephemeral](../../fundamentals/events/ephemeral-events) event self-destructs. Two of its
values name a handler the reaper does not have yet:

| Value | Why it cannot run | What to do instead |
|---|---|---|
| `OnCompaction` | The framework ships no compaction handler for event bodies. | Return `Disposition.Compact` from a PreDestruction hook and register an `ICompactionHandler` ([dispositions](../../fundamentals/events/stream-end-of-life#dispositions)). |
| `Archived` | The archive store moves a stream's prefix or its whole stream, not event bodies picked across streams; an event-level archive is tracked in #1975. | Archive the stream through `IArchiveStore` or a prefix truncate with `Disposition.Archive`. |

Before this diagnostic, both values compiled and the event was simply deleted once consumed, which is the opposite of
what `Archived` promises. WHIZ137 makes the build fail wherever either value is named, matched by symbol (a member of
another enum with the same name is not flagged), so the declaration can never become a silent delete. A documentation
`cref` that names the value is not a use and is not flagged.
{verified: UnshippedDestructionAnalyzerTests.OnCompaction_OnAnEphemeralEvent_IsAnErrorAsync, UnshippedDestructionAnalyzerTests.Archived_NamedAnywhere_IsAnErrorAsync, UnshippedDestructionAnalyzerTests.ShippedValues_AndAnotherEnumsMemberOfTheSameName_PassAsync}

The reaper keeps the same rule at run time: a PreDestruction hook that returns `Disposition.Archive` for an ephemeral
batch has the batch held for the retry backoff and logged, never deleted.
{verified: MaintenanceWorkerDispositionTests.Archive_HoldsTheBatchForTheBackoff_AndLogsWhy_BecauseTheReaperCannotArchiveEventBodiesAsync}

## Diagnostic Message

```
Destruction.{Value} has not shipped: {why, and what to do instead}
```

## How to Fix

### Before (causes WHIZ137)

```csharp{title="An ephemeral event declaring an unshipped destruction" description="Destruction.OnCompaction has no handler for event bodies, so it fails the build." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "destruction", "WHIZ137"] tests=["UnshippedDestructionAnalyzerTests.OnCompaction_OnAnEphemeralEvent_IsAnErrorAsync"]}
[Ephemeral(Destruction = Destruction.OnCompaction)]
public record PresencePing : IEvent;  // WHIZ137
```

### After (no diagnostic)

```csharp{title="A shipped destruction value" description="WhenConsumed and AfterTtl are acted on by the reaper." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "destruction", "WHIZ137"] tests=["UnshippedDestructionAnalyzerTests.ShippedValues_AndAnotherEnumsMemberOfTheSameName_PassAsync"]}
[Ephemeral(Destruction = Destruction.AfterTtl, TtlSeconds = 60)]
public record PresencePing : IEvent;
```

## Related

- [Stream end of life: dispositions](../../fundamentals/events/stream-end-of-life#dispositions)
- [Ephemeral events](../../fundamentals/events/ephemeral-events)
- [WHIZ134: Ambiguous ephemeral composition](whiz134)
