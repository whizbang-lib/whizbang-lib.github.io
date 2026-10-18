---
title: 'WHIZ099: MessageJsonContextGenerator Running'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported once per build by the message JSON context generator, naming the assembly and the number
  of message types it found.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - json
  - serialization
  - aot
  - source-generator
codeReferences:
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/UnnamedAssemblyFallbackTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ099: MessageJsonContextGenerator Running

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The message JSON context generator produces the source-generated JSON serialization metadata for your commands,
events and the other message types it discovers, so serialization works without reflection. Every time it runs it
reports WHIZ099 first, with the assembly name and the number of distinct message types it found (duplicates are
removed before counting).

WHIZ099 is a progress note. It is reported even when the count is zero; the JSON context is still generated in that
case. When the compilation has no assembly name, the note names `Unknown`.

Unlike most diagnostics, WHIZ099 is not declared in the shared descriptor list; the generator creates it inline. It
has no source location.

## Diagnostic Message

```text
MessageJsonContextGenerator invoked for assembly '{AssemblyName}' with {MessageTypeCount} message type(s)
```

## Common Causes

1. **The generator ran**, which happens on every build of a project that references the generators.

## How to Fix

Nothing needs fixing. Use the count as a quick check: if it is `0` in a project that defines commands or events,
the generator did not see them, for example because they are declared in a different project.

### Example that produces WHIZ099

```csharp{
title: "A project with no message types"
description: "No ICommand or IEvent types, so WHIZ099 reports 0 message type(s)"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "JSON", "Source Generators"]
testFile: "tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs"
testMethod: "Generator_NoMessageTypes_ReportsDiagnosticWithZeroCountAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs"
tests: ["MessageJsonContextGeneratorTests.Generator_NoMessageTypes_ReportsDiagnosticWithZeroCountAsync"]
}
using System;

namespace MyApp;

public class RegularClass {
  public string Name { get; set; } = string.Empty;
}
```

The build reports a message ending in `with 0 message type(s)`, and `MessageJsonContext.g.cs` is still generated.

## Suppressing

WHIZ099 has no source location, so a `#pragma warning disable WHIZ099` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ099"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ099.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is safe; it only hides the note.

## Related

- [WHIZ072: Polymorphic Base Type Discovered](whiz072)
- [JSON Contexts](../../extending/source-generators/json-contexts)
- [Native AOT](../deployment/native-aot)
