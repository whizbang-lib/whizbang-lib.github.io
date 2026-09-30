---
title: 'WHIZ163: Type-Name Key Assigned From A Hand-Built String'
pageType: troubleshooting
description: >-
  Warning diagnostic when a type-name key (a member, parameter, or local named *ClrTypeName*,
  *TypeName*, *EventType*, or *EnvelopeType*) is assigned from an interpolated or concatenated
  string instead of a TypeNameFormatter or TypeNameUtilities result.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - type-naming
  - analyzer
  - clr-type-name
  - registry-key
  - type-name-formatter
codeReferences:
  - src/Whizbang.Generators/Analyzers/TypeNameHandlingAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/TypeNameHandlingAnalyzerTests.cs
---

# WHIZ163: Type-Name Key Assigned From A Hand-Built String

**Severity**: Warning
**Category**: Type Naming

## Description
{verified: TypeNameHandlingAnalyzerTests.KeyAssignedFromAHandBuiltString_ReportsWhiz163Async}

Members and parameters that carry a type-name key are looked up by the other side of the framework: a
generator writes `clr_type_name`, the runtime reads it back at startup; the runtime writes `event_type`,
a later read matches it against the registered types. A value composed locally is a second rendering
that can drift from the helper's, and the drift shows up as a lookup that matches nothing.

WHIZ163 reports a **type-name key** assigned from a **hand-built string**:

- A key is a member, parameter, or local whose name carries `ClrTypeName`, `TypeName`, `EventType`, or
  `EnvelopeType`. Names ending in `Formatter` or `Helper` are not keys.
- A hand-built string is an interpolated string with at least one hole, or a `+` concatenation that
  includes a string literal or an interpolated string.

Three sites are checked: a simple assignment (`row.ClrTypeName = $"{ns}.{name}"`), an argument passed to a
parameter with a key name (named or positional; the analyzer resolves the parameter through the semantic
model), and a local declared with a key name (`var eventType = $"..."`). An assignment from a variable, a
literal, a helper call, or another key is a pass-through and is not reported. Generated code is not
analyzed, and the rule is heuristic by nature, so it ships as a warning.

## Diagnostic Message

```
'{0}' is a type-name key but is assigned from a string built by hand. Assign a
TypeNameFormatter / TypeNameUtilities result (or a typed key) so the key matches what the other
side renders.
```

`{0}` is the key: the assignment target, the parameter name, or the local's name.

## Common Causes

1. **Joining namespace and name in a generator**: `row.ClrTypeName = $"{ns}.{name}"`. Nested types render
   with `.` in display strings and `+` in the CLR key, so the two disagree the first time a model is
   nested.
2. **Composing the envelope form**: `` row.EnvelopeType = "MessageEnvelope`1[[" + t.FullName + "]]" ``.
   The envelope form has its own helper.
3. **Building a local key and passing it on**: `var eventType = $"{ns}.{name}, {ns}"` handed to a
   `clrTypeName:` parameter. The local is reported; the pass-through into the parameter is not, because
   the local is where the rendering happened.

## How to Fix

Assign a helper result. At runtime: `TypeNameFormatter.FormatClrTypeName(type)` for the CLR form,
`TypeNameFormatter.Format(type)` for the wire form, `EnvelopeTypeNameHelper.Format(inner)` for the
envelope form. In a generator: `TypeNameUtilities.BuildClrTypeName(symbol)` and
`TypeNameUtilities.FormatTypeNameForRuntime(symbol)`. A literal is fine (a fixed known key in a fixture or
a constant), and so is another key.

Before (reported):

```csharp{
title: "Keys built by hand"
description: "Three keys WHIZ163 reports: a ClrTypeName from an interpolation, an EnvelopeType from a concatenation, and a local named eventType from an interpolation; the pass-through from the local into an initializer is not reported."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz163", "type-naming", "analyzer", "counter-example"]
unverified: "counter-example; the three assignments are what WHIZ163 reports, as the fixture in TypeNameHandlingAnalyzerTests shows"
}
var row = new Row();
row.ClrTypeName = $"{ns}.{name}";                                 // WHIZ163
row.EnvelopeType = "MessageEnvelope`1[[" + t.FullName + "]]";     // WHIZ163
var eventType = $"{ns}.{name}, {ns}";                              // WHIZ163
return new Row { ClrTypeName = eventType };                        // pass-through: not reported here
```

After:

```csharp{
title: "Keys assigned from the shared helpers"
description: "A helper result, a literal, and another key are the three legitimate sources for a type-name key; each assignment here is clean."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz163", "type-naming", "type-name-formatter", "envelope-type-name-helper"]
tests: ["TypeNameHandlingAnalyzerTests.KeyAssignedFromAHelper_ALiteral_OrAnotherKey_IsCleanAsync"]
}
var row = new Row();
row.ClrTypeName = TypeNameFormatter.FormatClrTypeName(t);                        // a helper result
row.EnvelopeType = EnvelopeTypeNameHelper.Format(TypeNameFormatter.Format(t));   // the envelope form
row.ClrTypeName = other.ClrTypeName;                                              // another key
row.ClrTypeName = "TestApp.Fixed";                                                // a literal, in a fixture
```

## When It Is Intentional

- **The helpers are exempt.** Code inside a type named `TypeNameFormatter`, `TypeNameUtilities`,
  `EventTypeMatchingHelper`, `EnvelopeTypeNameHelper`, or `TypeFormatter` is not analyzed. That is where
  the one rendering per form lives. {verified: TypeNameHandlingAnalyzerTests.InsideTheHelpersThemselves_EverythingIsAllowedAsync}
- **The member holds display text, not a key.** A member named with a key marker that only ever carries
  text for a log line or a UI is misnamed. Rename it (for example `DisplayName`) rather than suppress, so
  the next reader does not persist it. If renaming is not an option, suppress the assignment with a
  one-line reason (`#pragma warning disable WHIZ163 // display only: ...`).
- **A literal key.** A fixed, known key in a fixture or a constant is already clean; nothing to suppress.
  {verified: TypeNameHandlingAnalyzerTests.KeyAssignedFromAHelper_ALiteral_OrAnotherKey_IsCleanAsync}
- **Test fixtures.** The framework's own test projects turn the four rules off in `tests/.editorconfig`,
  because fixtures compose keys deliberately, including malformed ones that prove the parsers' tolerance.
  A consumer's test project can do the same.

## Related

- [WHIZ160: Type Name Composed By Hand](whiz160)
- [WHIZ161: Type Name Dissected By Hand](whiz161)
- [WHIZ162: Type Names Compared Without The Matching Helper](whiz162)
- [Type Formatting](../../fundamentals/identity/type-formatting)
- `ai-docs/type-naming.md` in the library repository: the forms, their helpers, and the columns each form belongs to
