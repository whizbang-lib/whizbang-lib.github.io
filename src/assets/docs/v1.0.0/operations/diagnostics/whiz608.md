---
title: 'WHIZ608: Type-Naming Exception Without a Reason'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a suppression of WHIZ607 carries no justification, or
  WHIZ607 is hidden with a pragma that cannot carry one, so an exception to
  the type-naming rule does not record why it was made
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - type-names
  - suppression
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/TypeNameSourceAnalyzer.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/TypeNameSourceAnalyzerTests.cs
---

# WHIZ608: Type-Naming Exception Without a Reason

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code. Like [WHIZ607](whiz607.md), it runs only on the library projects under `src/` and never ships in a package. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

An exception to [WHIZ607](whiz607.md) does not say why it was made. The rule reports:

- a `[SuppressMessage]` whose check id starts with `WHIZ607` and that has no `Justification`, or one that is empty or only whitespace;
- any `#pragma warning disable WHIZ607`, which has no place for a reason. The matching `restore`, and pragmas for other rules, are not reported.

A suppression of another rule without a justification is not this rule's concern.

```csharp{title="The exceptions WHIZ608 reports" description="A SuppressMessage with no justification and a pragma that hides WHIZ607 are both reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz608", "whiz607", "repository-check", "suppression"] tests=["TypeNameSourceAnalyzerTests.Suppression_WithoutAJustification_IsReportedAsync", "TypeNameSourceAnalyzerTests.Pragma_ThatHidesTheRule_IsReportedAsync", "TypeNameSourceAnalyzerTests.Suppression_OfAnotherRule_WithoutAJustification_IsNotThisRulesConcernAsync"]}
internal static class Diagnostics {
  [SuppressMessage("Naming", "WHIZ607", Justification = "")]   // WHIZ608
  public static string Describe(Type type) => type.Name;

#pragma warning disable WHIZ607                                  // WHIZ608
  public static string Describe2(Type type) => type.Name;
#pragma warning restore WHIZ607
}
```

## Why it matters

Every exception to the type-naming rule is a place a name is rendered outside the shared code. The reason recorded where it is made is what lets a reviewer, or a later contributor, tell a deliberate exception from a shortcut, and remove it when the reason no longer holds.

## How to fix it

Prefer moving the read into the shared naming code ([how to fix WHIZ607](whiz607.md#how-to-fix-it)). If the exception stands, use `[SuppressMessage]` with a `Justification` that says why:

```csharp{title="Clearing WHIZ608" description="A WHIZ607 suppression whose Justification records why the type is named here." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz608", "whiz607", "repository-check", "suppression"] tests=["TypeNameSourceAnalyzerTests.Runtime_ASuppressionThatSaysWhy_IsHonoredAsync"]}
internal static class Diagnostics {
  [SuppressMessage("Naming", "WHIZ607:A type name is read outside the shared naming code",
    Justification = "the exception message names the type for a reader")]
  public static string Describe(Type type) => type.Name;
}
```

## Related

- [WHIZ607](whiz607.md), the rule these suppressions are exceptions to
- [Type Names in Library Code](../../../contributors/type-naming.md#making-an-exception)
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
