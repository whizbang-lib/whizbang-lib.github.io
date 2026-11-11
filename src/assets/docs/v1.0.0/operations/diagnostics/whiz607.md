---
title: 'WHIZ607: Type-Naming Exception Without a Reason'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a suppression of WHIZ606 carries no justification, or
  WHIZ606 is hidden with a pragma that cannot carry one, so an exception to
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

# WHIZ607: Type-Naming Exception Without a Reason

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code. Like [WHIZ606](whiz606.md), it runs only on the library projects under `src/` and never ships in a package. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

An exception to [WHIZ606](whiz606.md) does not say why it was made. The rule reports:

- a `[SuppressMessage]` whose check id starts with `WHIZ606` and that has no `Justification`, or one that is empty or only whitespace;
- any `#pragma warning disable WHIZ606`, which has no place for a reason. The matching `restore`, and pragmas for other rules, are not reported.

A suppression of another rule without a justification is not this rule's concern.

```csharp{title="The exceptions WHIZ607 reports" description="A SuppressMessage with no justification and a pragma that hides WHIZ606 are both reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz607", "whiz606", "repository-check", "suppression"] tests=["TypeNameSourceAnalyzerTests.Suppression_WithoutAJustification_IsReportedAsync", "TypeNameSourceAnalyzerTests.Pragma_ThatHidesTheRule_IsReportedAsync", "TypeNameSourceAnalyzerTests.Suppression_OfAnotherRule_WithoutAJustification_IsNotThisRulesConcernAsync"]}
internal static class Diagnostics {
  [SuppressMessage("Naming", "WHIZ606", Justification = "")]   // WHIZ607
  public static string Describe(Type type) => type.Name;

#pragma warning disable WHIZ606                                  // WHIZ607
  public static string Describe2(Type type) => type.Name;
#pragma warning restore WHIZ606
}
```

## Why it matters

Every exception to the type-naming rule is a place a name is rendered outside the shared code. The reason recorded where it is made is what lets a reviewer, or a later contributor, tell a deliberate exception from a shortcut, and remove it when the reason no longer holds.

## How to fix it

Prefer moving the read into the shared naming code ([how to fix WHIZ606](whiz606.md#how-to-fix-it)). If the exception stands, use `[SuppressMessage]` with a `Justification` that says why:

```csharp{title="Clearing WHIZ607" description="A WHIZ606 suppression whose Justification records why the type is named here." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz607", "whiz606", "repository-check", "suppression"] tests=["TypeNameSourceAnalyzerTests.Runtime_ASuppressionThatSaysWhy_IsHonoredAsync"]}
internal static class Diagnostics {
  [SuppressMessage("Naming", "WHIZ606:A type name is read outside the shared naming code",
    Justification = "the exception message names the type for a reader")]
  public static string Describe(Type type) => type.Name;
}
```

## Related

- [WHIZ606](whiz606.md), the rule these suppressions are exceptions to
- [Type Names in Library Code](../../../contributors/type-naming.md#making-an-exception)
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
