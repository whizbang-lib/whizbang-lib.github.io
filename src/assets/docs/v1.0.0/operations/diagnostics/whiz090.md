---
title: 'WHIZ090: MessageTag Parameter Naming'
description: >-
  Error diagnostic when a constructor parameter in a MessageTagAttribute subclass
  does not match any property name (case-insensitive)
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - message-tags
  - attributes
  - source-generator
  - naming-convention
---

# WHIZ090: MessageTag Parameter Naming

**Severity**: Error
**Category**: Attribute Validation

## Description

This error is reported when a constructor parameter in a class that derives from `MessageTagAttribute` does not match any property name (case-insensitive). Whizbang's source generators extract attribute values using constructor parameter names, so parameter names must match property names for values to be extracted correctly.

## Diagnostic Message

```
Constructor parameter 'tagName' in 'MyTagAttribute' does not match any property. Rename to 'tag' to match property 'Tag'.
```

## Why This Matters

Whizbang uses Roslyn's `AttributeData` API to extract attribute constructor arguments at compile time. This API identifies arguments by their parameter names, not by analyzing constructor body assignments. If a parameter name doesn't match a property name:

1. **Value Extraction Fails** - The generator cannot find the corresponding property
2. **Silent Bugs** - Properties get empty/default values instead of expected values
3. **Runtime Surprises** - Tags, configuration, and metadata are missing

## Example

### Incorrect Code (Triggers WHIZ090)

```csharp{title="Incorrect Code (Triggers WHIZ090)" description="Demonstrates incorrect Code (Triggers WHIZ090)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Incorrect", "Code"]}
[AttributeUsage(AttributeTargets.Class)]
public class NotificationTagAttribute : MessageTagAttribute {
  public NotificationTagAttribute(string tagName) {  // WHIZ090: 'tagName' doesn't match 'Tag'
    Tag = tagName;
  }
}
```

### Correct Code

```csharp{title="Correct Code" description="Demonstrates correct Code" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Correct", "Code"]}
[AttributeUsage(AttributeTargets.Class)]
public class NotificationTagAttribute : MessageTagAttribute {
  public NotificationTagAttribute(string tag) {  // 'tag' matches 'Tag' (case-insensitive)
    Tag = tag;
  }
}
```

## Understanding the Convention

### Case-Insensitive Matching

Parameter names are matched to property names case-insensitively:

```csharp{title="Case-Insensitive Matching" description="Parameter names are matched to property names case-insensitively:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Case-Insensitive", "Matching"]}
// All of these are valid:
public MyTagAttribute(string tag) { Tag = tag; }       // Exact match
public MyTagAttribute(string TAG) { Tag = TAG; }       // All caps
public MyTagAttribute(string Tag) { Tag = Tag; }       // PascalCase
```

### Multiple Parameters

Each constructor parameter must match a corresponding property:

```csharp{title="Multiple Parameters" description="Each constructor parameter must match a corresponding property:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Multiple", "Parameters"]}
[AttributeUsage(AttributeTargets.Class)]
public class MyTagAttribute : MessageTagAttribute {
  public string? Category { get; set; }

  // Both 'tag' and 'category' must match properties
  public MyTagAttribute(string tag, string category) {
    Tag = tag;           // 'tag' matches 'Tag'
    Category = category; // 'category' matches 'Category'
  }
}
```

### Inherited Properties

Parameters can match properties from base classes:

```csharp{title="Inherited Properties" description="Parameters can match properties from base classes:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Inherited", "Properties"]}
public class MyTagAttribute : MessageTagAttribute {
  // 'tag' matches inherited 'Tag' property
  // 'includeEvent' matches inherited 'IncludeEvent' property
  public MyTagAttribute(string tag, bool includeEvent) {
    Tag = tag;
    IncludeEvent = includeEvent;
  }
}
```

## How to Fix

### Option 1: Rename Parameter to Match Property

```csharp{title="Option 1: Rename Parameter to Match Property" description="Demonstrates option 1: Rename Parameter to Match Property" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Option", "Rename"]}
// Before (WHIZ090 error)
public MyTagAttribute(string tagName) {
  Tag = tagName;
}

// After (fixed)
public MyTagAttribute(string tag) {
  Tag = tag;
}
```

### Option 2: Add a Property That Matches the Parameter

If you intentionally want a different parameter name, add a property that matches:

```csharp{title="Option 2: Add a Property That Matches the Parameter" description="If you intentionally want a different parameter name, add a property that matches:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Option", "Add"]}
public class MyTagAttribute : MessageTagAttribute {
  // Property matches parameter name
  public string TagName { get => Tag; set => Tag = value; }

  public MyTagAttribute(string tagName) {
    TagName = tagName;  // Now 'tagName' matches 'TagName'
  }
}
```

## Technical Background

Roslyn's `AttributeData` exposes constructor arguments via `ConstructorArguments`, but these are identified by the parameter's declared name in the method signature. The Roslyn API cannot see what happens inside the constructor body, so it cannot determine which property a parameter value is assigned to.

```csharp{title="Technical Background" description="Roslyn's AttributeData exposes constructor arguments via ConstructorArguments, but these are identified by the" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Technical", "Background"]}
// What Roslyn sees:
// - Constructor parameter: "tagName"
// - Constructor arguments: ["tenants"]

// What Roslyn CANNOT see:
// - That Tag = tagName happens in the body
```

Whizbang's `MessageTagDiscoveryGenerator` looks for a parameter whose name matches a known property (like `Tag`, `IncludeEvent`). If no match is found, the value cannot be extracted.

## Related Diagnostics

- No related diagnostics at this time.

## See Also

- [Message Tags](../../fundamentals/messages/message-tags.md) - Overview of the message tagging system
- [Custom Message Tag Attributes](../advanced/custom-message-tags.md) - Creating custom tag attributes
