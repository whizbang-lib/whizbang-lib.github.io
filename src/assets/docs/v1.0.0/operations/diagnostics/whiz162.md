---
title: 'WHIZ162: Type Names Compared Without The Matching Helper'
pageType: troubleshooting
description: >-
  Warning diagnostic when two type-name strings are compared with ==, !=, or string.Equals instead
  of through EventTypeMatchingHelper, so a version-decorated persisted name never matches its bare
  registered form.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - type-naming
  - analyzer
  - event-type
  - type-matching
  - event-type-matching-helper
codeReferences:
  - src/Whizbang.Generators/Analyzers/TypeNameHandlingAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/TypeNameHandlingAnalyzerTests.cs
---

# WHIZ162: Type Names Compared Without The Matching Helper

**Severity**: Warning
**Category**: Type Naming

## Description
{verified: TypeNameHandlingAnalyzerTests.Comparison_OfTwoTypeNameStrings_ReportsWhiz162Async}

The wire form of a type name is sometimes carried with assembly version decoration (`Version=`,
`Culture=`, `PublicKeyToken=`) and sometimes bare. A producer on an older build may have written a
different assembly name. A nested type may appear with `.` from a display string. Ordinal equality between
a persisted name and a registered one therefore fails on a build change, and it fails quietly: the filter
simply matches nothing.

WHIZ162 reports two shapes:

- `==` or `!=` between two string-typed expressions whose names both carry a key marker (`TypeName`,
  `ClrTypeName`, `EventType`, `EnvelopeType`), such as `entry.EventType == eventType`;
- `string.Equals(a, b)` or `string.Equals(a, b, comparison)` where both arguments are type-name values
  (see [WHIZ160](whiz160) for what counts as one).

Comparing two `Type` instances is exact and is not reported. Comparing two helper results (for example
`NormalizeTypeName(a) == NormalizeTypeName(b)`) is not reported either. Generated code is not analyzed,
and the rule is heuristic by nature, so it ships as a warning.

## Diagnostic Message

```
'{0}' and '{1}' are compared as plain strings. A persisted type name may be version-decorated;
normalize both sides with EventTypeMatchingHelper.NormalizeTypeName (or resolve through
TryResolveType) so the bare and decorated forms agree.
```

`{0}` and `{1}` are the two operands as written in source.

## Common Causes

1. **Filtering stored events against a registered type**: `entry.EventType == eventType` while walking
   `wh_event_store` rows.
2. **A registry lookup by name**: `string.Equals(clrTypeName, otherTypeName, StringComparison.Ordinal)`.
3. **Checking an envelope-type header**: comparing the wire header against `typeof(T).AssemblyQualifiedName`,
   which is the versioned form and changes with every assembly version.

## How to Fix

Go through `EventTypeMatchingHelper`, which is keyed by every form a producer may have written:

- `EventTypeMatchingHelper.BuildTypeLookup(candidateTypes)` builds the lookup once.
- `EventTypeMatchingHelper.TryResolveType(lookup, storedName, out type)` resolves a stored name, raw first
  and normalized second.
- `EventTypeMatchingHelper.NormalizeTypeName(name)` strips the version decoration when a bare comparison
  is unavoidable; apply it to both sides.

The polymorphic event-store reads and the resurrection-on-wake probe use exactly this.

Before (reported):

```csharp{
title: "Comparing type names as plain strings"
description: "Two comparisons WHIZ162 reports: == between two key-named strings and string.Equals between two type-name values."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz162", "type-naming", "analyzer", "counter-example"]
unverified: "counter-example; both comparisons are what WHIZ162 reports, as the fixtures in TypeNameHandlingAnalyzerTests show"
}
// WHIZ162: a stored name may be version-decorated; ordinal equality misses its bare form
public bool Same(Entry e, string eventType) => e.EventType == eventType;

// WHIZ162: string.Equals between two type-name values is the same comparison
public bool SameEquals(string clrTypeName, string otherTypeName) =>
  string.Equals(clrTypeName, otherTypeName, StringComparison.Ordinal);
```

After:

```csharp{
title: "Matching through EventTypeMatchingHelper"
description: "Resolves a stored name against the registered candidates, normalizes both sides when a bare comparison is unavoidable, and compares Type instances directly where the values are types rather than strings."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz162", "type-naming", "event-type-matching-helper", "normalize"]
tests: ["TypeNameHandlingAnalyzerTests.Comparison_OfTwoTypes_OrThroughTheMatchingHelper_IsCleanAsync"]
}
// Resolve a stored name against the registered candidates (raw first, normalized second)
var lookup = EventTypeMatchingHelper.BuildTypeLookup(handledEventTypes);
if (EventTypeMatchingHelper.TryResolveType(lookup, storedEventType, out var resolved)) {
  // resolved is the registered Type the stored name refers to
}

// When a bare comparison is unavoidable, normalize both sides
var same = EventTypeMatchingHelper.NormalizeTypeName(eventType)
  == EventTypeMatchingHelper.NormalizeTypeName(storedEventType);

// Two Type instances compare exactly; the rule is about strings
var sameType = entry.EventType == eventType;   // entry.EventType is a Type here
```

## When It Is Intentional

- **The helpers are exempt.** Code inside a type named `TypeNameFormatter`, `TypeNameUtilities`,
  `EventTypeMatchingHelper`, `EnvelopeTypeNameHelper`, or `TypeFormatter` is not analyzed. The matching
  helper compares strings because that is its job. {verified: TypeNameHandlingAnalyzerTests.InsideTheHelpersThemselves_EverythingIsAllowedAsync}
- **The values are types, not strings.** `Type == Type` is exact and is never reported.
  {verified: TypeNameHandlingAnalyzerTests.Comparison_OfTwoTypes_OrThroughTheMatchingHelper_IsCleanAsync}
- **A display-only site** (deduplicating names in a diagnostic dump, sorting a report) may suppress the
  rule for that expression with a one-line reason (`#pragma warning disable WHIZ162 // display only: ...`).
- **Test fixtures.** The framework's own test projects turn the four rules off in `tests/.editorconfig`,
  because fixtures compare hand-written names deliberately. A consumer's test project can do the same.

## Related

- [WHIZ160: Type Name Composed By Hand](whiz160)
- [WHIZ161: Type Name Dissected By Hand](whiz161)
- [WHIZ163: Type-Name Key Assigned From A Hand-Built String](whiz163)
- [Type Formatting](../../fundamentals/identity/type-formatting)
- `ai-docs/type-naming.md` in the library repository: the forms, their helpers, and how a persisted name is matched against a registered one
