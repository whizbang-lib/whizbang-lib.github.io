---
title: 'WHIZ011: JSON Serializable Type Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that the JSON context generator found a message, nested, collection or enum type and added it
  to the generated JSON context for AOT-compatible serialization. No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - json
  - serialization
  - aot
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ011: JSON Serializable Type Discovered

**Severity**: Info
**Category**: Source Generation / JSON

## Description

This is a discovery notice, not a problem. The `MessageJsonContextGenerator` reports WHIZ011 once for every type it adds
to the generated JSON context, so that the type can be serialized without reflection (which is what Native AOT needs).

The generator reports it for:

- every **message type** it discovers: commands (`ICommand`), events (`IEvent`), and other serializable types such as
  types marked `[WhizbangSerializable]`, types marked `[GraphQLName]`, and perspective models;
- every **nested type** found in the properties of those messages;
- every **collection and special type** those messages use: `List<T>`, `IReadOnlyList<T>`, arrays,
  `Dictionary<TKey, TValue>` and enums.

If a type you expect to be serialized does not appear in a WHIZ011 notice, the generator did not see it, and it will
not be in the generated context. That is the main use of this message: confirming what the context contains.

## Diagnostic Message

```
Found {Kind} type '{TypeName}' - adding to JsonSerializerContext for AOT-compatible serialization
```

`{Kind}` is one of `command`, `event`, `serializable type`, `nested type`, `collection type`,
`collection interface type`, `array type`, `dictionary type` or `enum type`. `{TypeName}` is the simple type name, or
a readable form such as `List<OrderItem>` for collections.

Because the format already ends the kind with the word `type`, kinds that themselves end in `type` read with the word
twice, for example `Found nested type type 'OrderItem' ...`.

## Common Causes

1. **A command or event was declared** in a project that references the Whizbang generators.
2. **A message property uses a custom type**, a collection, a dictionary or an enum, which the generator follows and
   adds as well.
3. **A type was opted in** with `[WhizbangSerializable]` or `[GraphQLName]`, or is the model of a perspective.

## How to Fix

There is nothing to fix. Use the notices to check that every type you serialize was picked up. When a type is missing,
see [JSON Contexts](../../extending/source-generators/json-contexts) for how discovery works and
[Serializing Additional Types](../../extending/source-generators/json-contexts#serializing-additional-types) for opting
a type in.

## What Produces It

A single command is enough to produce the notice. This is the source the test runs the generator against; the test
asserts an Info diagnostic with ID `WHIZ011` whose message contains `CreateOrder`.

```csharp{title="A command discovered by the JSON context generator" description="Declaring a command makes the generator add it to the JSON context and report WHIZ011 for it." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "json", "commands", "discovery"] testFile="MessageJsonContextGeneratorTests.cs" testMethod="Generator_ReportsDiagnostic_ForDiscoveredMessageTypeAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs" tests=["MessageJsonContextGeneratorTests.Generator_ReportsDiagnostic_ForDiscoveredMessageTypeAsync"]}
using Whizbang.Core;

namespace MyApp.Commands;

// Reported as: Found command type 'CreateOrder' - adding to JsonSerializerContext ...
public record CreateOrder(string OrderId) : ICommand;
```

## Suppressing

WHIZ011 is reported with no source location, so a `#pragma warning disable WHIZ011` region cannot reach it, and a
file-scoped `.editorconfig` section (`[*.cs]`) does not apply to it either. Set the severity in a global analyzer
config file instead:

```ini{title="Silence WHIZ011 project-wide" description="A global analyzer config that turns off the WHIZ011 discovery notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ011.severity = none
```

Silencing it is reasonable once you trust discovery, since it is purely informational and can be numerous in a large
project. Leave it on while you are diagnosing a "type not serializable" error at run time, because its absence for a
type is the quickest clue.

## Related

- [JSON Contexts](../../extending/source-generators/json-contexts)
- [Polymorphic Serialization](../../extending/source-generators/polymorphic-serialization)
- [Native AOT](../../operations/deployment/native-aot)
- [Error Reference](error-reference)
