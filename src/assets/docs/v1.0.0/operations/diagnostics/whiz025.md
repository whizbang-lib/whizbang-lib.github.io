---
title: 'WHIZ025: TopicFilter On Non-Command'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning descriptor for a [TopicFilter] on a type that does not implement ICommand. It is defined but not reported by
  the current generator: such filters are ignored silently.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - topic-filters
  - commands
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/TopicFilterGenerator.cs
  - src/Whizbang.Core/TopicFilterAttribute.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ025: TopicFilter On Non-Command

**Severity**: Warning
**Category**: Source Generation / Topic Filters

## Description

Topic filters route **commands**. The `TopicFilterGenerator` only reads `[TopicFilter]` attributes on classes and
records that implement `ICommand`; on any other type the attribute has no effect, and the type is left out of the
generated `TopicFilterRegistry`. WHIZ025 is defined to warn you that the filter will be ignored.

**Current behavior**: the generator does not report WHIZ025. It checks for `ICommand` first and skips any other type
before looking at its attributes, so the filter is ignored **silently**: no warning and no error. The tested behavior
is exactly that: the registry does not mention the type and no error is reported. If that type held the only filters
in the project, the generator reports WHIZ026 (no topic filters found) and does not generate the registry.

The attribute itself is allowed on any class (`AttributeTargets.Class`), so the compiler does not catch this either.

## Diagnostic Message

```
[TopicFilter] on type '{TypeName}' which does not implement ICommand. Filter will be ignored.
```

## Common Causes

1. **The filter was put on an event** or another message type instead of a command.
2. **`ICommand` was left off** a type that is meant to be a command.

## How to Fix

Implement `ICommand` on the type if it is a command, or remove the `[TopicFilter]` if it is not. Because nothing
reports the problem today, check the [WHIZ022](whiz022) notices: a filter that does not appear there was not registered.

### Before (filter silently ignored)

```csharp{title="TopicFilter on a type that is not a command" description="The record does not implement ICommand, so the generator skips it and the filter never reaches the registry." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "commands"] unverified="WHIZ025 is never reported; the silent skip is checked by TopicFilterGeneratorTests.Generator_WithFilterOnNonCommand_ReportsErrorAsync"}
using Whizbang.Core;

namespace TestNamespace;

[TopicFilter("should.fail")]
public record NotACommand {  // Missing ICommand: filter is ignored
}
```

### After (filter registered)

```csharp{title="TopicFilter on a command" description="Implementing ICommand makes the generator add the filter to TopicFilterRegistry." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "commands"] unverified="WHIZ025 is never reported; registration for this shape is checked by TopicFilterGeneratorTests.Generator_WithStringFilter_GeneratesRegistryAsync"}
using Whizbang.Core;

namespace TestNamespace;

[TopicFilter("orders.create")]
public record CreateOrderCommand : ICommand {
}
```

## Suppressing

There is nothing to suppress while the generator does not report it. If a future version starts reporting it, the
usual severity settings would apply (`#pragma warning disable WHIZ025` if it is reported on the type, or
`dotnet_diagnostic.WHIZ025.severity = none` in `.editorconfig` or a `.globalconfig`):

```ini{title="Silence WHIZ025" description="An analyzer config entry that would turn off the WHIZ025 warning." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "editorconfig"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ025.severity = none
```

Suppressing it would rarely be appropriate: a filter on a non-command never does anything, so the attribute should be
removed instead.

## Related

- [Topic Filters](../../messaging/topic-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
- [WHIZ022: Topic Filter Discovered](whiz022)
- [WHIZ023: Enum Filter No Description](whiz023)
