---
title: 'WHIZ603: IsNotNull() on a Nullable Value Cannot Fail'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test in the Whizbang repository calls TUnit's
  IsNotNull() on a nullable value type, an assertion that passes even when the
  subject is null under the pinned TUnit
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - testing
  - tunit
  - analyzer
codeReferences:
  - src/Whizbang.TestAnalyzers/NullableIsNotNullAnalyzer.cs
testReferences:
  - tests/Whizbang.TestAnalyzers.Tests/NullableIsNotNullAnalyzerTests.cs
---

# WHIZ603: IsNotNull() on a Nullable Value Cannot Fail

**Severity**: Error
**Raised by**: `Whizbang.TestAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's test projects and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A test asserts `IsNotNull()` on a nullable value type such as `int?` or `TimeSpan?`:

```csharp{title="The assertion WHIZ603 reports" description="IsNotNull() on an int? subject passes under the pinned TUnit even when count is null." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz603", "repository-check", "tunit", "analyzer"] tests=["NullableIsNotNullAnalyzerTests.IsNotNull_OnNullableInt_ReportsWhiz603Async"]}
public static async Task RunAsync(int? count) {
  await Assert.That(count).IsNotNull();
}
```

## Why it matters

In the TUnit version this repository pins, `IsNotNull()` on a nullable value type maps the subject through `.Value`. On a null subject that throws; the exception is recorded with a default value, and the null check reads only the default, which is never null. The assertion passes whether or not the subject has a value, so the test verifies nothing. A later TUnit release fixed the check; this rule can be retired once the repository moves past it.

## How to fix it

Assert that the subject has a value, or assert on the value itself, which a null subject fails:

```csharp{title="Clearing WHIZ603" description="Asserting HasValue with IsTrue(), or asserting on the value, fails when the subject is null." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz603", "repository-check", "tunit", "analyzer"] tests=["NullableIsNotNullAnalyzerTests.Descriptor_CarriesTheRuleAndTheReplacementAsync"]}
public static async Task RunAsync(int? count) {
  await Assert.That(count.HasValue).IsTrue();
  await Assert.That(count).IsEqualTo(3);
}
```

## Related

- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
