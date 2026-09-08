---
title: 'WHIZ161: Type Name Dissected By Hand'
pageType: troubleshooting
description: >-
  Warning diagnostic when Split, Substring, IndexOf('+'), or Replace("global::", ...) is applied to a
  type-name value instead of parsing it through TypeNameFormatter (runtime) or TypeNameUtilities
  (generators); hand parsing misses version decoration, nested '+' and generic arity.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - type-naming
  - analyzer
  - clr-type-name
  - wire-type-name
  - parsing
codeReferences:
  - src/Whizbang.Generators/Analyzers/TypeNameHandlingAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/TypeNameHandlingAnalyzerTests.cs
---

# WHIZ161: Type Name Dissected By Hand

**Severity**: Warning
**Category**: Type Naming

## Description
{verified: TypeNameHandlingAnalyzerTests.Dissection_SplitOnTheAssemblyComma_ReportsWhiz161Async}

A persisted type name is not a flat string. It may carry version, culture, and public-key decoration
(`Version=`, `Culture=`, `PublicKeyToken=`), nested-type `+` separators, and generic arity (`` `1 ``
with the argument list in `[[...]]`, where more commas appear). Splitting or trimming it locally
reproduces one of those cases and misses the rest, and the miss is silent: the code keeps returning a
string, just not the key the other side wrote.

WHIZ161 reports a string dissector applied to a **type-name value** (see [WHIZ160](whiz160) for what
counts as one) when the argument is a separator the helpers own:

| Method | Reported when |
|--------|---------------|
| `Split` | the separator is `","`, `", "`, or `"+"` |
| `IndexOf`, `LastIndexOf` | the argument is `"+"`, `","`, or the generic arity backtick |
| `Replace` | the text to replace is `"global::"` |
| `Substring` | always; a substring of a type name is a hand parse whatever the offsets |

The receiver must be a type-name value. A `Split(',')` on a CSV field is not the rule's business.
Generated code is not analyzed, and the rule is heuristic by nature, so it ships as a warning.

## Diagnostic Message

```
'{0}' is applied to a type name. Parse it with TypeNameFormatter.Parse / GetSimpleName /
GetNamespace (runtime) or TypeNameUtilities (generators) instead; hand parsing misses version
decoration, nested '+' and generic arity.
```

`{0}` is the method that was applied: `Split`, `Substring`, `IndexOf`, `LastIndexOf`, or `Replace`.

## Common Causes

1. **Stripping the assembly from a wire name**: `eventType.Split(',')[0]`. The wire form of a generic
   type carries commas inside its `[[...]]` argument list, so the first segment is not the CLR form.
2. **Extracting a nested type's simple name**: `clrTypeName.Substring(clrTypeName.IndexOf('+') + 1)`.
3. **Turning a generated-source name into a key**: `fullyQualifiedTypeName.Replace("global::", "")`. The
   fully qualified form renders nested types with `.`, so the result is not the CLR key even after the
   prefix is gone.

## How to Fix

Parse through the helper for that side. At runtime `TypeNameFormatter.GetFullName` returns the bare CLR
form of a wire name, `GetSimpleName` and `GetNamespace` take a name apart, `Parse` gives the parts at
once, `EventTypeMatchingHelper.NormalizeTypeName` strips version decoration, and
`EnvelopeTypeNameHelper.ExtractInnerTypeName` unwraps an envelope type name. In a generator, render the
form you need from the symbol (`TypeNameUtilities.BuildClrTypeName`, `FormatTypeNameForRuntime`,
`GetSimpleName`) instead of post-processing a display string.

Before (reported):

```csharp{
title: "Hand parsing the wire and CLR forms"
description: "Two hand parses WHIZ161 reports: Split on the assembly comma and Substring/IndexOf('+') on a nested CLR name."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz161", "type-naming", "analyzer", "counter-example"]
unverified: "counter-example; both expressions are what WHIZ161 reports, as the fixtures in TypeNameHandlingAnalyzerTests show"
}
// WHIZ161: Split on the assembly comma; a generic wire name has commas inside [[...]]
public string Bare(string eventType) => eventType.Split(',')[0];

// WHIZ161: Substring and IndexOf('+') on a CLR name
public string Nested(string clrTypeName) => clrTypeName.Substring(clrTypeName.IndexOf('+') + 1);
```

After:

```csharp{
title: "Parsing through the shared helpers"
description: "The bare CLR form and the simple name come from TypeNameFormatter, and a generator renders the key from the symbol instead of trimming a display string."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz161", "type-naming", "type-name-formatter", "type-name-utilities"]
tests: ["TypeNameHandlingAnalyzerTests.Dissection_ThroughTheHelper_IsCleanAsync"]
}
// Runtime: the bare CLR form of a wire name, and the simple name of a nested type
public string Bare(string eventType) => TypeNameFormatter.GetFullName(eventType);
public string Nested(string clrTypeName) => TypeNameFormatter.GetSimpleName(clrTypeName);

// Generator: render the key from the symbol instead of post-processing a display string
var clrTypeName = TypeNameUtilities.BuildClrTypeName(symbol);
```

## When It Is Intentional

- **The helpers are exempt.** Code inside a type named `TypeNameFormatter`, `TypeNameUtilities`,
  `EventTypeMatchingHelper`, `EnvelopeTypeNameHelper`, or `TypeFormatter` is not analyzed. That is where
  the parsing lives. {verified: TypeNameHandlingAnalyzerTests.InsideTheHelpersThemselves_EverythingIsAllowedAsync}
- **The receiver is not a type name.** A `Split` or `Substring` on a value whose name carries no key
  marker and does not come from `typeof`, `GetType()`, or a helper is not reported.
  {verified: TypeNameHandlingAnalyzerTests.Dissection_ThroughTheHelper_IsCleanAsync}
- **A display-only site** that trims a name for a log line or a trace tag may suppress the rule for that
  expression with a one-line reason (`#pragma warning disable WHIZ161 // display only: ...`).
- **Test fixtures.** The framework's own test projects turn the four rules off in `tests/.editorconfig`,
  because fixtures compose and dissect names deliberately, including malformed ones that prove the
  parsers' tolerance. A consumer's test project can do the same.

## Related

- [WHIZ160: Type Name Composed By Hand](whiz160)
- [WHIZ162: Type Names Compared Without The Matching Helper](whiz162)
- [WHIZ163: Type-Name Key Assigned From A Hand-Built String](whiz163)
- [Type Formatting](../../fundamentals/identity/type-formatting)
- `ai-docs/type-naming.md` in the library repository: the forms, their helpers, and the columns each form belongs to
