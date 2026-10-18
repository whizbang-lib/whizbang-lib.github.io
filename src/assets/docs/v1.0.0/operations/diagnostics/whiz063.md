---
title: 'WHIZ063: Nested type contains non-serializable property'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a type reachable from a command, event or [WhizbangSerializable] type has an object,
  dynamic or non-generic interface property. The whole object graph has to be serializable for AOT.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - serialization
  - aot
  - nested-types
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/SerializablePropertyAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ063: Nested type contains non-serializable property

**Severity**: Error
**Category**: Serialization Validation

## Description

A message is serialized together with everything it references. If a command holds an `OrderItem`, and `OrderItem`
has an `object` property, the generated JSON context cannot serialize the command under Native AOT even though the
command's own properties look fine. The `SerializablePropertyAnalyzer` walks the types a message references and
reports WHIZ063 when one of them has a property the analyzer would have flagged on the message itself:

| Property type found in the nested type | On the message itself it would be |
|---|---|
| `object` | [WHIZ060](whiz060) |
| `dynamic` | [WHIZ061](whiz061) |
| a non-generic interface, such as `IEnumerable` | [WHIZ062](whiz062) |

### How the walk works

- It starts at each `public` type that implements `ICommand` or `IEvent`, or carries `[WhizbangSerializable]`, and
  follows its public, instance properties (including inherited ones).
- It unwraps arrays, `Nullable<T>` and generic types before following them. For a generic type it follows the **last**
  type argument: `List<OrderItem>` and `OrderItem[]` lead to `OrderItem`, and `Dictionary<string, OrderItem>` leads to
  `OrderItem`.
- It recurses to any depth: a problem three levels down is still found
  {verified: SerializablePropertyAnalyzerTests.Analyzer_DeeplyNestedTypeWithObjectProperty_ReportsWHIZ063Async}.
- Each nested type is checked once per message, so a type reached along two paths is reported once, and circular or
  self-referencing types do not loop
  {verified: SerializablePropertyAnalyzerTests.Analyzer_DiamondDependency_ChecksOnceAsync, SerializablePropertyAnalyzerTests.Analyzer_CircularReference_NoInfiniteLoopAsync}.
- The nested type itself does not need to be public.

### What the walk does not follow

- **Value types** (structs, record structs, enums). A struct with an `object` property is not reported.
- **`string`**, and any type whose namespace starts with `System` or `Microsoft`.
- **The generic type itself.** For `Envelope<OrderItem>`, the walk follows `OrderItem` but does not look at
  `Envelope<T>`'s own properties.
- Generated code, and non-public message types.

## Diagnostic Message

```text{title="WHIZ063 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ063", "Serialization", "Diagnostics"] unverified="message format read from the descriptor"}
Nested type '{NestedType}' (used by '{MessageType}.{ReferencingProperty}') contains non-serializable property '{PropertyName}' of type '{PropertyType}'
```

- `{ReferencingProperty}` is the property that leads **directly** to the nested type. When the nested type sits more
  than one level down, that property is on an intermediate type, not on `{MessageType}`.
- `{PropertyType}` is `object`, `dynamic`, or the interface's full name.
- The error is placed on `{ReferencingProperty}`, not on the offending property inside the nested type.

## Common Causes

1. **A shared model or DTO** with a loosely typed `object Metadata` or `dynamic Extra` property, reused inside a message.
2. **A collection of items** (`List<T>` or `T[]`) whose item type has such a property.
3. **A non-generic collection interface** (`IEnumerable`, `IList`) deep inside a referenced type.

## How to Fix

Fix the property inside the nested type, the same way you would fix WHIZ060, WHIZ061 or WHIZ062 on the message: give
it a concrete type, or a generic collection with a concrete element type.

### Before (causes WHIZ063)

```csharp{title="Before (causes WHIZ063)" description="A command that references a type with an object property" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ063", "Serialization", "Nested Types"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_NestedTypeWithObjectProperty_ReportsWHIZ063Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_NestedTypeWithObjectProperty_ReportsWHIZ063Async"]}
using Whizbang.Core;

namespace TestApp;

public class OrderItem {
  public object Metadata { get; set; }  // the problem
}

public class CreateOrderCommand : ICommand {
  public OrderItem Item { get; set; }    // WHIZ063 is reported here
}
```

The same command with `List<OrderItem>` or `OrderItem[]` in place of `OrderItem` is reported the same way
{verified: SerializablePropertyAnalyzerTests.Analyzer_ListOfNestedTypeWithObjectProperty_ReportsWHIZ063Async, SerializablePropertyAnalyzerTests.Analyzer_ArrayOfNestedTypeWithObjectProperty_ReportsWHIZ063Async}.

### After (no diagnostic)

```csharp{title="After (no WHIZ063)" description="The referenced type has only serializable properties" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ063", "Serialization", "Nested Types"] testFile="SerializablePropertyAnalyzerTests.cs" testMethod="Analyzer_CommandWithConcreteCustomType_NoErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs" tests=["SerializablePropertyAnalyzerTests.Analyzer_CommandWithConcreteCustomType_NoErrorAsync"]}
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

## Related

- [WHIZ060: Property uses non-serializable type 'object'](whiz060)
- [WHIZ061: Property uses non-serializable type 'dynamic'](whiz061)
- [WHIZ062: Property Uses Non-Serializable Interface Type](whiz062)
- [Serializable Property Analyzer](serializable-property-analyzer)
- [Native AOT](../../operations/deployment/native-aot)
