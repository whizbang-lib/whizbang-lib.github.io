---
title: 'WHIZ015: Generic Message Types Are Not Supported'
pageType: troubleshooting
verifiedAgainstCommit: 8dd179a8
verifiedDate: 2026-10-19
description: >-
  Warning when a command, event or other message type is generic. The source generators skip an open generic type,
  because generated code must name a closed one, so it is not in the message catalog, the topic registry or the
  serialization context and cannot cross a transport.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - messages
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/GenericMessageTypeAnalyzer.cs
  - src/Whizbang.Generators/MessageTypeCatalogGenerator.cs
  - src/Whizbang.Generators/TopicRegistryGenerator.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/GenericMessageTypeAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/GenericMessageTypeGenerationTests.cs
lastMaintainedCommit: '8dd179a8'
---

# WHIZ015: Generic Message Types Are Not Supported

**Severity**: Warning
**Category**: Messages

## Description

Generated code names every message type it registers, routes or serializes, and it has to name a closed type. An
open generic type such as `GenericAnswer<T>` has no closed form to name, so the source generators skip it: it is not
in the message catalog, the topic registry or the serialization context. WHIZ015 says so at the type's declaration.

Before this check, the generators emitted the open type literally and the project failed to build with
`CS0246: The type or namespace name 'T' could not be found`, with errors pointing into generated files rather than
at the type that caused them.

What still works: a receptor of a **closed** form, such as `IReceptor<GenericCommand<int>, GenericAnswer<int>>`, is
routed for local dispatch. The closed form has no generated serializer, so it cannot be sent across a transport.

WHIZ015 is reported for a generic class, record or struct that implements `IMessage` (directly, or through
`ICommand`, `IEvent` or an interface of your own). A generic interface is not reported, because the generators never
name an interface as a message type.

## Diagnostic Message

```text
Message type '{TypeName}' is generic, so the source generators skip it: it is not in the message catalog, the topic registry or the serialization context, and it cannot be sent across a transport. Declare a non-generic message type instead.
```

## How to Fix

Declare a non-generic message type for each closed form you send.

### Before (causes WHIZ015)

```csharp{title="A generic message type" description="An open generic record that implements IMessage through an interface is skipped by the generators and reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "messages", "generics", "warning"] testFile="GenericMessageTypeAnalyzerTests.cs" testMethod="AGenericMessage_IsReportedAtItsDeclarationAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/GenericMessageTypeAnalyzerTests.cs" tests=["GenericMessageTypeAnalyzerTests.AGenericMessage_IsReportedAtItsDeclarationAsync", "GenericMessageTypeGenerationTests.OpenGenericMessageTypes_GeneratedCodeCompilesAsync"]}
using System;
using Whizbang.Core;

namespace Shop;

public interface IAnswer : IMessage {
  Guid Id { get; }
}

// WHIZ015: skipped by the generators
public record GenericAnswer<T>(Guid Id, T Value) : IAnswer;
```

### After (no warning)

```csharp{title="A message type per closed form" description="Each answer the service sends is its own non-generic type, so it is cataloged, routed and serialized." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "messages", "generics"] testFile="GenericMessageTypeAnalyzerTests.cs" testMethod="NonGenericMessagesAndNonMessages_AreNotReportedAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/GenericMessageTypeAnalyzerTests.cs" tests=["GenericMessageTypeAnalyzerTests.NonGenericMessagesAndNonMessages_AreNotReportedAsync"]}
using System;
using Whizbang.Core;

namespace Shop;

public interface IAnswer : IMessage {
  Guid Id { get; }
}

public record PriceAnswer(Guid Id, decimal Value) : IAnswer;
public record StockAnswer(Guid Id, int Value) : IAnswer;
```

A non-generic type that derives from a closed generic base, such as `record IntEvent(int Value) : GenericEvent<int>(Value)`,
is not reported: it is closed and the generators handle it like any other message type.

## Suppressing

WHIZ015 is reported at the type's name, so a `#pragma` region around the declaration silences it:

```csharp{title="Suppress WHIZ015 for one type" description="A pragma region around the declaration." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "pragma"] unverified="suppression/config, not exercised by a test"}
#pragma warning disable WHIZ015 // Only ever dispatched locally as GenericAnswer<int>
public record GenericAnswer<T>(Guid Id, T Value) : IAnswer;
#pragma warning restore WHIZ015
```

Suppress it only when every closed form is dispatched locally; the type still has no generated serializer.

## Related

- [Error Reference](error-reference)
- [Message Registry](../../extending/source-generators/message-registry)
