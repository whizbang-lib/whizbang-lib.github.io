---
title: JSON Serialization Customizations
version: 1.0.0
category: Internals
order: 1
description: >-
  Custom JSON converters and type handling for AOT-compatible serialization,
  including database-specific edge cases and array type discovery
tags: 'json, serialization, aot, converters, postgresql, datetime'
codeReferences:
  - src/Whizbang.Core/Serialization/LenientDateTimeOffsetConverter.cs
  - src/Whizbang.Generators/ArrayTypeInfo.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Generators/Templates/Snippets/JsonContextSnippets.cs
---

# JSON Serialization Customizations

Whizbang uses AOT-compatible JSON serialization via source-generated `JsonTypeInfo` factories. This page documents custom converters and type handling for edge cases that System.Text.Json does not handle by default.

## Overview

When data flows through `MessageJsonContext` (especially for polymorphic models stored as JSONB), custom handling is required for:

- Database-specific timestamp formats (PostgreSQL infinity values)
- Timestamps without timezone offsets
- Array types discovered in message properties
- Nullable enum types

## When Customizations Apply

- Polymorphic models using `Property().HasColumnType("jsonb")` instead of `ComplexProperty().ToJson()`
- Message/event serialization through `JsonContextRegistry`
- Any type resolved via the generated `MessageJsonContext`

## Custom Converters

### LenientDateTimeOffsetConverter

Handles `DateTimeOffset` values that do not conform to strict ISO 8601 format, particularly from PostgreSQL JSONB storage.

```csharp{title="LenientDateTimeOffsetConverter" description="Custom converter for lenient DateTimeOffset parsing" category="Reference" difficulty="INTERMEDIATE" tags=["JSON", "Serialization", "Converters"]}
// Supports various input formats:
// - ISO 8601 with offset: "2024-01-15T10:30:00+05:00"
// - Zulu time: "2024-01-15T10:30:00Z"
// - No timezone (assumes UTC): "2024-01-15T10:30:00"
// - Date only: "2024-01-15"
// - PostgreSQL special values: "-infinity", "infinity"
```

| Input Format | Output | Notes |
|--------------|--------|-------|
| `"2024-01-15T10:30:00+05:00"` | Preserves offset | Standard ISO 8601 with offset |
| `"2024-01-15T10:30:00Z"` | UTC (offset = 0) | Zulu time |
| `"2024-01-15T10:30:00"` | UTC (offset = 0) | No timezone - assumes UTC |
| `"2024-01-15"` | Midnight UTC | Date-only format |
| `"-infinity"` | `DateTimeOffset.MinValue` | PostgreSQL special value |
| `"infinity"` | `DateTimeOffset.MaxValue` | PostgreSQL special value |
| `""` | `default(DateTimeOffset)` | Empty string |

**Database-Specific Notes**:

- **PostgreSQL**: Stores `timestamptz` without explicit offset in JSONB; uses `-infinity`/`infinity` for unbounded ranges
- **SQL Server**: May have different edge cases (TBD)
- **MySQL**: May have different edge cases (TBD)

### LenientNullableDateTimeOffsetConverter

Nullable wrapper for `LenientDateTimeOffsetConverter`. Handles `null` JSON values and delegates all other values to the non-nullable converter.

```csharp{title="LenientNullableDateTimeOffsetConverter" description="Nullable wrapper for lenient DateTimeOffset parsing" category="Reference" difficulty="INTERMEDIATE" tags=["JSON", "Serialization", "Converters"]}
// Handles:
// - null -> returns null
// - Any valid DateTimeOffset string -> delegates to LenientDateTimeOffsetConverter
```

## Generator-Managed Type Handling

### ArrayTypeInfo

The `ArrayTypeInfo` record contains information about discovered array types used in messages. This enables the source generator to create `JsonTypeInfo<T[]>` factories automatically.

```csharp{title="ArrayTypeInfo Record" description="Value type for discovered array type information" category="Reference" difficulty="ADVANCED" tags=["JSON", "Serialization", "Source-Generators"]}
// Example: For a property of type IEvent[]
// ArrayTypeName: "global::Whizbang.Core.IEvent[]"
// ElementTypeName: "global::Whizbang.Core.IEvent"
// ElementSimpleName: "IEvent"
// ElementUniqueIdentifier: "Whizbang_Core_IEvent"
```

**Properties**:

| Property | Description | Example |
|----------|-------------|---------|
| `ArrayTypeName` | Fully qualified array type name | `"global::Whizbang.Core.IEvent[]"` |
| `ElementTypeName` | Fully qualified element type name | `"global::Whizbang.Core.IEvent"` |
| `ElementSimpleName` | Simple element type name | `"IEvent"` |
| `ElementUniqueIdentifier` | Sanitized identifier for C# code generation | `"Whizbang_Core_IEvent"` |

The `ElementUniqueIdentifier` sanitizes special characters to create valid C# identifiers:

- Strips `global::` prefix
- Replaces `.`, `<`, `>`, `,` with `_`
- Replaces `?` with `__Nullable`

### Array Type Discovery

When the message JSON context generator encounters array properties, it automatically generates `JsonTypeInfo<T[]>` factories:

```csharp{title="Array Type Discovery" description="Automatic discovery and generation of array type info" category="Reference" difficulty="ADVANCED" tags=["JSON", "Serialization", "Source-Generators"]}
// Message with array property
public record BatchCommand : ICommand {
  public Guid[] ItemIds { get; init; } = [];
  public IEvent[] Events { get; init; } = [];
}

// Generator creates:
// - CreateArray_System_Guid()
// - CreateArray_Whizbang_Core_IEvent()
```

**Supported Array Types**:

| Property Type | Generated Factory |
|--------------|-------------------|
| `string[]` | `CreateArray_System_String` |
| `int[]` | `CreateArray_System_Int32` |
| `Guid[]` | `CreateArray_System_Guid` |
| `int?[]` | `CreateArray_System_Int32__Nullable` |
| `CustomType[]` | `CreateArray_Namespace_CustomType` |
| `Dictionary<string, string>[]` | `CreateArray_System_Collections_Generic_Dictionary_string__string_` |

### Nullable Enum Types

When an enum type is discovered, the generator automatically creates `JsonTypeInfo` for both:

- `EnumType` (non-nullable)
- `EnumType?` (nullable)

This ensures `System.Nullable`1[EnumType]` is always available without tracking which enums are used as nullable.

## Troubleshooting

### "JsonTypeInfo metadata for type 'X' was not provided"

**Cause**: The type was not discovered by the generator or does not have a factory.

**Check**:
1. Is it a nested type? Verify the generator handles CLR name format (`Namespace.Container+NestedClass`)
2. Is it a nullable enum? Generator should create both versions automatically
3. Is it a custom type? Needs `[WhizbangSerializable]` or be reachable from a message property

### "Unable to parse DateTimeOffset from value: X"

**Cause**: `LenientDateTimeOffsetConverter` does not handle this format.

**Check**:
1. What is the actual value? May need to add handling to `LenientDateTimeOffsetConverter`
2. Which database? May need database-specific handling
3. Add a test case to `LenientDateTimeOffsetConverterTests.cs`

### "Circular type reference detected"

**Cause**: Type A has property of type B, type B has property of type A.

**Solution**: Use `[JsonIgnore]` on one property to break the cycle, or use a custom `JsonConverter`.

## Adding New Custom Handling

1. **Create converter** in `src/Whizbang.Core/Serialization/`
2. **Add tests** in `tests/Whizbang.Core.Tests/Serialization/`
3. **Update generator** if needed (snippets in `JsonContextSnippets.cs`)
4. **Update this documentation** with the new handling
5. **Link tests** using `<tests>` tags in code

## See Also

- [Message JSON Context](../../fundamentals/messages/json-serialization) - Generated JSON context overview
- [Source Generators](../source-generators/overview) - How generators create type info
- [AOT Compatibility](../../operations/deployment/aot-compatibility) - Native AOT requirements
