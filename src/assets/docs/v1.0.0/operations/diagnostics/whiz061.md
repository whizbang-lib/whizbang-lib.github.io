---
title: "WHIZ061: Property uses non-serializable type 'dynamic'"
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a public property on a command, event or [WhizbangSerializable] type is declared as
  dynamic. Serializing it needs runtime reflection, which AOT does not allow.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - serialization
  - aot
  - dynamic
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/SerializablePropertyAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ061: Property uses non-serializable type 'dynamic'

**Severity**: Error
**Category**: Serialization Validation

## Description

Whizbang serializes commands and events with source-generated System.Text.Json contexts so that they work under
Native AOT. A `dynamic` property has no compile-time type at all, so the generated context cannot produce code for it,
and resolving it at runtime needs reflection. The `SerializablePropertyAnalyzer` reports WHIZ061 at build time so the
problem never reaches a running system.

### When it fires

The analyzer checks `public` types that implement `ICommand` or `IEvent`, or carry `[WhizbangSerializable]`. It
reports WHIZ061 for each **public, instance** property, including inherited ones, whose type is `dynamic`.

### When it does not fire

- On non-public message types, and on public types that are neither messages nor `[WhizbangSerializable]`.
- On `static`, `private` or `internal` properties.
- When `dynamic` appears only as a type argument, such as `List<dynamic>`. The analyzer does not inspect type
  arguments, but the values still cannot be serialized under AOT.
- In generated code.
- When the `dynamic` property is on a type the message references. That case is reported as [WHIZ063](whiz063).

## Diagnostic Message

```text{title="WHIZ061 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ061", "Serialization", "Diagnostics"] unverified="message format read from the descriptor"}
Property '{PropertyName}' on '{TypeName}' uses type 'dynamic' which cannot be serialized for AOT. Use a concrete type instead.
```

## Common Causes

1. **An untyped payload** received from an external system and passed straight through.
2. **Prototype code** that used `dynamic` to avoid defining a type.
3. **Porting from a reflection-based serializer** where `dynamic` properties worked.

## How to Fix

Define a type for the data and use it in place of `dynamic`.

### Before (causes WHIZ061)

```csharp{title="Before (causes WHIZ061)" description="An event with a dynamic payload property" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ061", "Serialization", "AOT"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_EventWithDynamicProperty_ReportsWHIZ061Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_EventWithDynamicProperty_ReportsWHIZ061Async"]}
using Whizbang.Core;

namespace TestApp;

public class DynamicEvent : IEvent {
  public dynamic Payload { get; set; }  // WHIZ061
}
```

### After (no diagnostic)

```csharp{title="After (no WHIZ061)" description="Concrete property types the generated context can serialize" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ061", "Serialization", "AOT"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_CommandWithConcreteCustomType_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_CommandWithConcreteCustomType_NoErrorAsync"]}
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

A type with several problem properties gets one report for each: an `object` property, a `dynamic` property and a
non-generic interface property on the same command produce WHIZ060, WHIZ061 and WHIZ062 once each
{verified: SerializablePropertyAnalyzerTests.Analyzer_MultipleNonSerializableProperties_ReportsAllAsync}.

## Related

- [WHIZ060: Property uses non-serializable type 'object'](whiz060)
- [WHIZ062: Property Uses Non-Serializable Interface Type](whiz062)
- [WHIZ063: Nested type contains non-serializable property](whiz063)
- [Serializable Property Analyzer](serializable-property-analyzer)
- [Native AOT](../../operations/deployment/native-aot)
