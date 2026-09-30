---
title: 'WHIZ160: Type Name Composed By Hand'
pageType: troubleshooting
description: >-
  Warning diagnostic when an expression composes a type name by string concatenation or
  interpolation with the CLR nested separator '+' or the wire assembly separator ', ' instead of
  rendering the form through TypeNameFormatter (runtime) or TypeNameUtilities (generators).
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - type-naming
  - analyzer
  - clr-type-name
  - wire-type-name
  - type-name-formatter
codeReferences:
  - src/Whizbang.Generators/Analyzers/TypeNameHandlingAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/TypeNameHandlingAnalyzerTests.cs
---

# WHIZ160: Type Name Composed By Hand

**Severity**: Warning
**Category**: Type Naming

## Description
{verified: TypeNameHandlingAnalyzerTests.Composition_WithTheWireSeparator_ReportsWhiz160Async, TypeNameHandlingAnalyzerTests.Composition_WithTheNestedSeparator_InAnInterpolation_ReportsWhiz160Async}

Type-name strings are keys all over the framework: `clr_type_name`, `event_type`, perspective names,
registry JSON, routing tables. One side writes the string and the other side looks it up, and the two
sides are different programs: a source generator at compile time and the runtime at startup. There is
exactly one correct rendering per form, and the shared helpers produce it on both sides. A site that
renders its own has silently broken row retention, routing, and registry lookups more than once. In one
case a nested perspective model's registry key was written as `Outer.Model` and looked up as
`Outer+Model`, which un-enrolled row retention for every nested model without an error anywhere.

WHIZ160 reports an expression that composes a type name by hand: a string concatenation or interpolation
that joins a **type-name value** with the CLR nested separator (`+`) or the wire assembly separator
(`, `). A type-name value is one of:

- a `typeof(...)` or `GetType()` rooted `FullName` or `AssemblyQualifiedName` access (`Type.Name` is
  display only, so it is not one);
- a call on one of the shared helpers (`TypeNameFormatter`, `TypeNameUtilities`,
  `EventTypeMatchingHelper`, `EnvelopeTypeNameHelper`);
- an identifier or member whose name carries `TypeName`, `ClrTypeName`, `EventType`, or `EnvelopeType`.

The separator must join two parts of a name: a type-name value on its left and another non-literal value
on its right. A `", "` that ends a clause in a log message is prose and is not reported. In an interpolated
string the separator text must sit between two holes with the type-name value on the left. Only the
outermost `+` of a concatenation chain reports, so one expression yields one diagnostic. Generated code is
not analyzed. {verified: TypeNameHandlingAnalyzerTests.Prose_ThatEndsAClauseWithACommaAfterATypeName_IsNotCompositionAsync}

The rule is heuristic by nature, so it ships as a warning.

## Diagnostic Message

```
This expression composes a type name with the separator '{0}'. Render the form you need with
TypeNameFormatter (runtime) or TypeNameUtilities (generators) instead; a local rendering drifts
from the key the other side looks up.
```

`{0}` is the separator the expression used: `+` or `, `.

## Common Causes

1. **Building the wire form by hand**: `t.FullName + ", " + t.Assembly.GetName().Name` or
   `$"{typeName}, {assembly}"`.
2. **Building the CLR form of a nested type by hand**: `$"{outer.FullName}+{inner.Name}"`, often in a
   generator that walks `ContainingType` and joins the parts.
3. **Appending the assembly to a helper result**: `$"{TypeNameFormatter.FormatClrTypeName(t)}, {assembly}"`.
   A helper call is a type-name value too, and the wire form has its own helper.

## How to Fix

Render the form you need with the helper for that side. One helper per form, on each side:

| Form | Example | Runtime (`Whizbang.Core`) | Generator (`Whizbang.Generators.Shared`) |
|------|---------|---------------------------|------------------------------------------|
| CLR form (no assembly, `+` for nested, arity on generics) | `MyApp.Outer+Model` | `TypeNameFormatter.FormatClrTypeName(Type)` | `TypeNameUtilities.BuildClrTypeName(ITypeSymbol)` |
| Wire form (CLR form plus the simple assembly name) | `MyApp.Outer+Model, MyApp` | `TypeNameFormatter.Format(Type)` | `TypeNameUtilities.FormatTypeNameForRuntime(ITypeSymbol)` |
| Display text (logs, traces, messages; never a key) | `MyApp.Outer+Model` | `TypeNameFormatter.DisplayName(Type)` | `TypeNameUtilities.Display(ISymbol)` |
| Envelope type name | `` MessageEnvelope`1[[<wire form>]], Whizbang.Core `` | `EnvelopeTypeNameHelper.Format(inner)` | n/a |
| Fully qualified for generated source (never a key) | `global::MyApp.Outer.Model` | n/a | `TypeNameUtilities.FullyQualified(ISymbol)` |

`ai-docs/type-naming.md` in the library repository lists which persisted columns hold which form.

Before (reported):

```csharp{
title: "Composing the wire and CLR forms by hand"
description: "Two hand renderings WHIZ160 reports: the wire form joined with ', ' and a nested CLR name joined with '+'."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz160", "type-naming", "analyzer", "counter-example"]
unverified: "counter-example; both expressions are what WHIZ160 reports, as the fixtures in TypeNameHandlingAnalyzerTests show"
}
// WHIZ160: composes the wire form with ', '
public string Wire(Type t) => t.FullName + ", " + t.Assembly.GetName().Name;

// WHIZ160: composes a nested CLR name with '+'
public string Clr(Type outer, Type inner) => $"{outer.FullName}+{inner.Name}";
```

After:

```csharp{
title: "Rendering the form through the shared helpers"
description: "The wire form and the CLR form come from TypeNameFormatter at runtime and from TypeNameUtilities in a generator, so both sides of a lookup agree on the key."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz160", "type-naming", "type-name-formatter", "type-name-utilities"]
tests: ["TypeNameHandlingAnalyzerTests.KeyAssignedFromAHelper_ALiteral_OrAnotherKey_IsCleanAsync"]
}
// Runtime: the wire form and the CLR form, one call each
public string Wire(Type t) => TypeNameFormatter.Format(t);
public string Clr(Type nested) => TypeNameFormatter.FormatClrTypeName(nested);

// Generator: the same two forms from the symbol
var clrTypeName = TypeNameUtilities.BuildClrTypeName(modelSymbol);
var wireTypeName = TypeNameUtilities.FormatTypeNameForRuntime(eventSymbol);
```

## When It Is Intentional

- **The helpers are exempt.** Code inside a type named `TypeNameFormatter`, `TypeNameUtilities`,
  `EventTypeMatchingHelper`, `EnvelopeTypeNameHelper`, or `TypeFormatter` is not analyzed. That is where
  the one rendering per form lives. {verified: TypeNameHandlingAnalyzerTests.InsideTheHelpersThemselves_EverythingIsAllowedAsync}
- **A display-only site** (a log line, an exception message, a trace tag) that genuinely needs to join a
  name with `+` or `, ` may suppress the rule for that expression with a one-line reason, so the audit
  stays visible:

  ```csharp{
  title: "Suppressing WHIZ160 at a display-only site"
  description: "A pragma with a one-line reason keeps a deliberate hand-joined display string out of the warning list while leaving the decision visible in the diff."
  framework: "NET10"
  category: "Diagnostics"
  difficulty: "BEGINNER"
  tags: ["whiz160", "type-naming", "suppression", "pragma"]
  unverified: "suppression illustration; no behavior to assert"
  }
  #pragma warning disable WHIZ160 // display only: the joined text is a log message, never a key
  logger.LogWarning("No handler for {Type}", outer.FullName + "+" + inner.Name);
  #pragma warning restore WHIZ160
  ```

- **Test fixtures.** The framework's own test projects turn the four rules off in `tests/.editorconfig`
  (`dotnet_diagnostic.WHIZ160.severity = none` through `WHIZ163`), because fixtures compose names
  deliberately, including malformed ones that prove the parsers' tolerance. A consumer's test project
  can do the same.

## Related

- [WHIZ161: Type Name Dissected By Hand](whiz161)
- [WHIZ162: Type Names Compared Without The Matching Helper](whiz162)
- [WHIZ163: Type-Name Key Assigned From A Hand-Built String](whiz163)
- [Type Formatting](../../fundamentals/identity/type-formatting)
- `ai-docs/type-naming.md` in the library repository: the forms, their helpers, and the columns each form belongs to
