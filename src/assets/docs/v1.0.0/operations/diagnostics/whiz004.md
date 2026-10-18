---
title: 'WHIZ004: Command Stream ID Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that a command type carries a [StreamId] and the generator produced a stream ID extractor
  for it. No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - streamid
  - commands
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ004: Command Stream ID Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The `StreamIdGenerator` found a `[StreamId]` on a command and generated a zero-reflection extractor for it, so the
framework can read the command's stream ID at runtime. WHIZ004 is reported once per such command, with no source
location. It is the command counterpart of [WHIZ010](whiz010), which reports the same discovery for events.

A type is reported when all of these hold:

- it is `public` (non-public types cannot be reached from generated code and are skipped),
- it implements `ICommand`,
- it has a property marked `[StreamId]` (inherited properties count), or a constructor parameter marked `[StreamId]`
  whose name matches one of the type's properties (the usual case for positional records).

A constructor parameter marked `[StreamId]` with **no** property of the same name is skipped: there is nothing to
read at extraction time, so no extractor and no WHIZ004 are produced.

The message uses the command's simple name and the name of the stream ID property.

## Diagnostic Message

```text
Found [StreamId] on command {CommandName}.{PropertyName}
```

## Common Causes

1. **A command declares its stream ID** with `[StreamId]`, which is the intended setup.

## How to Fix

Nothing to fix. If you expected WHIZ004 for a command and it is missing, check that the command is `public`,
implements `ICommand`, and that a `[StreamId]` constructor parameter has a property with the same name.

## Example

```csharp{title="A command that produces WHIZ004" description="A public ICommand with a [StreamId] property is reported as discovered." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ004", "StreamId", "Commands"] tests=["StreamIdGeneratorCoverageTests.Generator_CommandWithGuidStreamIdProperty_GeneratesCommandExtractorsAsync"] testFile="StreamIdGeneratorCoverageTests.cs" testMethod="Generator_CommandWithGuidStreamIdProperty_GeneratesCommandExtractorsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs"}
using System;
using Whizbang.Core;

namespace TestNamespace;

// Reported as: Found [StreamId] on command AssignOrderCommand.OrderId
public class AssignOrderCommand : ICommand {
  [StreamId]
  public Guid OrderId { get; set; }
}
```

## Suppressing

WHIZ004 has no source location, so `#pragma warning disable WHIZ004` cannot reach it. Set its severity in a global
analyzer config file:

```ini{title="Silence WHIZ004 project-wide" description="Global analyzer config entry that hides the command stream ID notice." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ004", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ004.severity = none
```

Silencing it is safe; the extractor is generated either way.

## Related

- [WHIZ010: StreamId Discovered](whiz010)
- [WHIZ009: Missing StreamId Attribute](whiz009)
- [StreamId Attribute](../../extending/attributes/streamid)
- [Stream ID](../../fundamentals/events/stream-id)
