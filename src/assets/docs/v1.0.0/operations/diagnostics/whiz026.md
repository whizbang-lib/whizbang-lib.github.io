---
title: 'WHIZ026: No Topic Filters Found'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported when the topic filter generator finds no command carrying a [TopicFilter] attribute,
  so no TopicFilterRegistry is generated for the project.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - topic-filters
  - commands
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/TopicFilterGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ026: No Topic Filters Found

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The topic filter generator looks at every class and record that carries at least one attribute, keeps the ones that
implement `ICommand`, and collects their `[TopicFilter]` attributes (including attributes derived from
`TopicFilterAttribute`). When that search finds nothing, the generator reports WHIZ026 and stops: no
`TopicFilterRegistry` source file is added to the compilation.

This is an informational notice, not a problem. A project that does not route commands by topic filter will see it
on every build. It only deserves attention when you expected filters to be picked up.

The diagnostic is reported once per compilation with no source location.

## Diagnostic Message

```text
No [TopicFilter] attributes were found in the compilation. TopicFilterRegistry will not be generated.
```

## Common Causes

1. **The project has no topic filters**, which is normal for projects that do not use them.
2. **The `[TopicFilter]` attribute is on a type that does not implement `ICommand`.** The generator skips such types
   (they are reported separately as WHIZ025), so they do not count toward the registry.
3. **The commands with filters live in another project.** The generator only sees the types declared in the project
   being compiled.

## How to Fix

If you do not use topic filters, nothing needs fixing; silence the notice as shown below if it is noise.

If you expected a registry:

- Make sure each command that should be filtered implements `ICommand` and carries `[TopicFilter("...")]` (or an
  attribute derived from `TopicFilterAttribute`).
- Make sure those commands are declared in the project you are building.

### Example that produces WHIZ026

A command with no `[TopicFilter]` attribute gives the generator nothing to register:

```csharp{
title: "A command without topic filters"
description: "No [TopicFilter] in the compilation, so the generator reports WHIZ026 and emits no registry"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Topic Filters"]
unverified: "no test asserts WHIZ026; the same input is used by TopicFilterGeneratorTests.Generator_WithNoFilters_GeneratesEmptyRegistryAsync, which only asserts that no error is reported"
}
using Whizbang.Core;

namespace TestNamespace;

public record SomeCommand : ICommand {
}
```

## Suppressing

WHIZ026 has no source location, so a `#pragma warning disable WHIZ026` region cannot reach it. Turn it off in a
global analyzer config file instead:

```ini{
title: "Silence WHIZ026"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ026.severity = none
```

The same `dotnet_diagnostic.WHIZ026.severity = none` line works in an `.editorconfig` that sets `is_global = true`.
Suppressing is appropriate in any project that does not use topic filters. Keep it visible while you are setting up
topic filters, since its presence tells you none were found.

## Related

- [Topic Filters](../../messaging/topic-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
