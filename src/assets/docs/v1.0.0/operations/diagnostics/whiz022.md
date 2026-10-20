---
title: 'WHIZ022: Topic Filter Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Informational notice that the topic filter generator found a [TopicFilter] on a command and added it to the
  generated TopicFilterRegistry. No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - topic-filters
  - commands
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/TopicFilterGenerator.cs
  - src/Whizbang.Core/TopicFilterAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/TopicFilterGeneratorTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ022: Topic Filter Discovered

**Severity**: Info
**Category**: Source Generation / Topic Filters

## Description

This is a discovery notice, not a problem. The `TopicFilterGenerator` reads `[TopicFilter]` attributes on commands and
builds a `TopicFilterRegistry` that looks the filters up without reflection. It reports WHIZ022 once for **each filter**
it adds to that registry, so a command with three filters produces three notices.

A filter is discovered when:

- the attribute is on a class or record that implements `ICommand`;
- the attribute is `[TopicFilter("...")]`, `[TopicFilter<TEnum>(...)]`, or a custom attribute derived from
  `TopicFilterAttribute`.

For enum-based filters, the filter string in the message is the value of the enum member's `[Description]`, or the
member name when it has none, without a separate notice (the retired [WHIZ023](whiz023) once described one).

A `[TopicFilter]` on a type that does not implement `ICommand` is skipped and produces no WHIZ022; the
[WHIZ025](whiz025) warning is reported on that attribute instead. When no filter is found in the project at all, the generator reports WHIZ026 instead and does not
generate the registry.

## Diagnostic Message

```
Found topic filter '{Filter}' on command '{CommandName}'
```

`{Filter}` is the filter string as it will appear in the registry. `{CommandName}` is the command's simple type name.

## Common Causes

1. **A command was given a `[TopicFilter]`** in a project that references the Whizbang generators.
2. **An enum-based or custom derived topic filter attribute** was applied to a command.

## How to Fix

There is nothing to fix. Use the notices to confirm that each filter has the string you expect, which is most useful
for enum-based filters whose string comes from `[Description]`. See [Topic Filters](../../messaging/topic-filters).

## What Produces It

Each notice is reported at the `[TopicFilter]` attribute it describes, so an IDE shows it on that line.

```csharp{title="A command with a topic filter" description="A string topic filter on a command; the generator adds it to TopicFilterRegistry and reports WHIZ022." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "commands"] tests=["TopicFilterGeneratorTests.Generator_ReportsEachDiscoveredFilterAtItsAttributeAsync", "TopicFilterGeneratorTests.Generator_WithStringFilter_GeneratesRegistryAsync"]}
using Whizbang.Core;

namespace TestNamespace;

// Reported as: Found topic filter 'orders.create' on command 'CreateOrderCommand'
[TopicFilter("orders.create")]
public record CreateOrderCommand : ICommand {
}
```

## Suppressing

WHIZ022 is reported at the `[TopicFilter]` attribute, so `#pragma warning disable WHIZ022` around the command or a
`dotnet_diagnostic.WHIZ022.severity = none` entry in an `.editorconfig` section that matches the file silences it. To
turn it off for a whole project, a global analyzer config file works too:

```ini{title="Silence WHIZ022 project-wide" description="A global analyzer config that turns off the WHIZ022 discovery notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ022.severity = none
```

Silencing it is safe; it only reports what was generated.

## Related

- [Topic Filters](../../messaging/topic-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
- [WHIZ023: Enum Filter No Description (retired)](whiz023)
- [WHIZ025: TopicFilter On Non-Command](whiz025)
