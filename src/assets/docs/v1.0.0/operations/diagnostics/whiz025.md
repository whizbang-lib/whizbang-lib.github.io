---
title: 'WHIZ025: TopicFilter On Non-Command'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Warning reported on a [TopicFilter] attribute placed on a type that does not implement ICommand. Topic filters route
  commands only, so the generator ignores the filter.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - topic-filters
  - commands
  - source-generator
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/TopicFilterTargetAnalyzer.cs
  - src/Whizbang.Generators/TopicFilterGenerator.cs
  - src/Whizbang.Core/TopicFilterAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/TopicFilterTargetAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/TopicFilterGeneratorTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ025: TopicFilter On Non-Command

**Severity**: Warning
**Category**: Source Generation / Topic Filters

## Description

Topic filters route **commands**. The `TopicFilterGenerator` only reads `[TopicFilter]` attributes on classes and
records that implement `ICommand`; on any other type the attribute has no effect, and the type is left out of the
generated `TopicFilterRegistry`. The attribute itself is allowed on any class (`AttributeTargets.Class`), so the
compiler does not catch the mistake.

WHIZ025 reports it. An analyzer checks every type that carries `[TopicFilter]`, in either form (`[TopicFilter("...")]`
or `[TopicFilter<TEnum>(...)]`), and warns when the type does not implement `ICommand`, directly or through a base
type or interface. The warning sits on the attribute. A type with several filters gets one warning, on the first.

The generator's behavior is unchanged: the type is skipped and no error is reported. If that type held the only filters
in the project, the generator also reports [WHIZ026](whiz026) (no topic filters found) and does not generate the
registry.

## Diagnostic Message

```text
[TopicFilter] on type '{TypeName}' which does not implement ICommand. Filter will be ignored.
```

## Common Causes

1. **The filter was put on an event** or another message type instead of a command.
2. **`ICommand` was left off** a type that is meant to be a command.

## How to Fix

Implement `ICommand` on the type if it is a command, or remove the `[TopicFilter]` if it is not.

### Before (reports WHIZ025)

```csharp{title="TopicFilter on an event" description="The record is an event, not a command, so the filter is ignored and WHIZ025 is reported on the attribute." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "commands", "WHIZ025"] tests=["TopicFilterTargetAnalyzerTests.ATopicFilterOnAnEvent_ReportsWhiz025Async", "TopicFilterGeneratorTests.Generator_WithFilterOnNonCommand_EmitsNoMappingForItAsync"]}
using Whizbang.Core;

[TopicFilter("orders")]           // WHIZ025: OrderPlaced is not a command
public record OrderPlaced : IEvent;
```

### After (filter registered)

```csharp{title="TopicFilter on a command" description="The type implements ICommand, so no warning is reported and the generator adds the filter to TopicFilterRegistry." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "commands", "WHIZ025"] tests=["TopicFilterTargetAnalyzerTests.ATopicFilterOnACommand_IsNotReportedAsync"]}
using Whizbang.Core;

[TopicFilter("orders")]
public record PlaceOrder : ICommand;
```

## Suppressing

The warning is reported at the attribute, so `#pragma warning disable WHIZ025` around the type or
`dotnet_diagnostic.WHIZ025.severity = none` in `.editorconfig` silences it:

```ini{title="Silence WHIZ025" description="An analyzer config entry that turns off the WHIZ025 warning." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "editorconfig"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ025.severity = none
```

Suppressing it is rarely appropriate: a filter on a non-command never does anything, so remove the attribute instead.

## Related

- [Topic Filters](../../messaging/topic-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
- [WHIZ022: Topic Filter Discovered](whiz022)
- [WHIZ026: No Topic Filters Found](whiz026)
