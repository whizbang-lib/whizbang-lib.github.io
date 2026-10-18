---
title: "WHIZ060: Property uses non-serializable type 'object'"
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a public property on a command, event or [WhizbangSerializable] type is declared as
  object. The generated JSON context cannot serialize it without runtime reflection, which AOT does not allow.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - serialization
  - aot
  - object
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/SerializablePropertyAnalyzer.cs
  - src/Whizbang.Core/Attributes/WhizbangSerializableAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ060: Property uses non-serializable type 'object'

**Severity**: Error
**Category**: Serialization Validation

## Description

Whizbang serializes commands and events with source-generated System.Text.Json contexts, so that serialization works
under Native AOT without reflection. A property declared as `object` tells the serializer nothing about what it will
hold; working that out at runtime needs reflection, which AOT does not allow. The `SerializablePropertyAnalyzer`
reports WHIZ060 so you find out at build time instead of when the first message fails to serialize.

### When it fires

The analyzer checks a type when **all** of these hold:

- The type is `public`.
- It implements `ICommand` or `IEvent` (directly or through another interface), or it carries
  `[WhizbangSerializable]`.

It then reports WHIZ060 for each **public, instance** property, including properties inherited from base classes,
whose type is `object`. A nullable annotation does not change that: `object?` is still `object`.

### When it does not fire

- On non-public message types, and on public types that are neither messages nor `[WhizbangSerializable]`.
- On `static`, `private` or `internal` properties.
- When `object` appears only as a type argument, for example `List<object>` or `Dictionary<string, object>`. The
  analyzer does not inspect those arguments, but the values still cannot be serialized under AOT. Keep type arguments
  concrete.
- In generated code.
- When the `object` property is on a type the message references rather than on the message itself. That case is
  reported as [WHIZ063](whiz063).

## Diagnostic Message

```text{title="WHIZ060 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ060", "Serialization", "Diagnostics"] unverified="message format read from the descriptor"}
Property '{PropertyName}' on '{TypeName}' uses type 'object' which cannot be serialized for AOT. Use a concrete type instead.
```

`{TypeName}` is the message type being analyzed. For an inherited property that is the derived message type, not the
base class that declares the property.

## Common Causes

1. **A catch-all payload** such as `object Payload` or `object Data`, meant to carry "anything".
2. **Loosely typed metadata** carried alongside a message.
3. **Porting from a reflection-based serializer** where `object` properties worked.

## How to Fix

Give the property a concrete type. If the shape varies, model the variants as their own types.

### Before (causes WHIZ060)

```csharp{title="Before (causes WHIZ060)" description="A command whose positional property is typed object" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ060", "Serialization", "AOT"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_CommandWithObjectProperty_ReportsWHIZ060Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_CommandWithObjectProperty_ReportsWHIZ060Async"]}
using Whizbang.Core;

namespace TestApp;

public record CreateOrderCommand(object Payload) : ICommand;  // WHIZ060
```

### After (no diagnostic)

```csharp{title="After (no WHIZ060)" description="The payload is a concrete type the generated context can serialize" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ060", "Serialization", "AOT"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_CommandWithConcreteCustomType_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_CommandWithConcreteCustomType_NoErrorAsync"]}
using Whizbang.Core;

namespace TestApp;

public class Address {
  public string Street { get; set; }
  public string City { get; set; }
}

public class ShippingCommand : ICommand {
  public Address ShippingAddress { get; set; }
}
```

The same rule applies to a `[WhizbangSerializable]` type: an `object` property on it is reported as WHIZ060
{verified: SerializablePropertyAnalyzerTests.Analyzer_WhizbangSerializableWithObjectProperty_ReportsWHIZ060Async}.

If the value has a few known shapes, a class hierarchy is one option: a class-typed property is not flagged by this
analyzer. See [Polymorphic Serialization](../../extending/source-generators/polymorphic-serialization) for how
derived types are serialized.

## Related

- [WHIZ061: Property uses non-serializable type 'dynamic'](whiz061)
- [WHIZ062: Property Uses Non-Serializable Interface Type](whiz062)
- [WHIZ063: Nested type contains non-serializable property](whiz063)
- [Serializable Property Analyzer](serializable-property-analyzer)
- [JSON Contexts: serializing additional types](../../extending/source-generators/json-contexts#serializing-additional-types)
- [Native AOT](../../operations/deployment/native-aot)
