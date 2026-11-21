---
title: 'WHIZ609: Test Fixture Tears Down Twice'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test class in the Whizbang repository has a TUnit
  [After(Test)] hook and is also disposable, so TUnit runs its teardown twice
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - testing
  - tunit
  - analyzer
codeReferences:
  - src/Whizbang.TestAnalyzers/SingleTeardownAnalyzer.cs
testReferences:
  - tests/Whizbang.TestAnalyzers.Tests/SingleTeardownAnalyzerTests.cs
---

# WHIZ609: Test Fixture Tears Down Twice

**Severity**: Error
**Raised by**: `Whizbang.TestAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's test projects and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A test class has a TUnit `[After(Test)]` hook and also implements `IDisposable` or `IAsyncDisposable`:

```csharp{title="The fixture WHIZ609 reports" description="A fixture with an [After(Test)] hook that is also IAsyncDisposable, whose DisposeAsync calls the hook." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz609", "repository-check", "tunit", "analyzer"] tests=["SingleTeardownAnalyzerTests.AsyncDisposableFixture_WithATestTeardownHook_ReportsWhiz609Async", "SingleTeardownAnalyzerTests.DisposableFixture_WithATestTeardownHook_ReportsWhiz609Async"]}
public class OrdersTests : IAsyncDisposable {
  [After(Test)]
  public async Task TeardownAsync() {
    // drop the test database
  }

  public async ValueTask DisposeAsync() => await TeardownAsync();
}
```

The rule is a build error in every test project in the repository: `tests/Directory.Build.props` loads `Whizbang.TestAnalyzers` into each one. The report sits on the class name and names the interfaces the class implements.

{verified: SingleTeardownAnalyzerTests.AsyncDisposableFixture_WithATestTeardownHook_ReportsWhiz609Async, SingleTeardownAnalyzerTests.AFixtureThatIsBoth_NamesBothInterfacesAsync, SingleTeardownAnalyzerTests.Diagnostic_IsLocatedOnTheClassIdentifierAsync}

## Why it matters

TUnit runs a test class's `[After(Test)]` hooks and then, when the instance is disposable, disposes it. A class that is both tears down twice: once as the hook and again as the `Dispose` or `DisposeAsync` that calls it. A hook that is itself named `DisposeAsync` runs twice too, once as the hook and once as the dispose.

An idempotent teardown hides the second run. A teardown that is not idempotent (a second drop of a database whose name another test already reuses, a second dispose of a shared data source) fails somewhere else, later, and usually only when the suites run together.

{verified: SingleTeardownAnalyzerTests.AHookThatIsTheDisposeMethodItself_IsReportedAsync}

## Which classes it reports

- The hook and the interface count whether they are declared on the class or inherited. A hook on a base class and the interface on the derived class is reported on the derived class.
- When a base class in the same project is itself both, only the base is reported, once, since that is the one place to fix. The classes deriving from it are not reported as well.
- When the base class that is both comes from another assembly, this project cannot fix it in place, so the class deriving from it is reported instead.
- Only the `[After(Test)]` hook counts. Other hooks on a disposable class, a disposable class with no hook, a struct, and an attribute named `AfterAttribute` that is not TUnit's are not reported.

{verified: SingleTeardownAnalyzerTests.AHookInTheBaseClass_AndTheInterfaceInTheDerived_ReportsTheDerivedAsync, SingleTeardownAnalyzerTests.ABaseClassThatIsBoth_IsReportedOnce_OnTheBaseAsync, SingleTeardownAnalyzerTests.ABaseClassThatIsBoth_FromAnotherAssembly_IsReportedOnTheDerivedAsync, SingleTeardownAnalyzerTests.OtherHooks_OnADisposableFixture_ReportNothingAsync, SingleTeardownAnalyzerTests.ADisposableFixtureWithoutAHook_ReportsNothingAsync, SingleTeardownAnalyzerTests.AStruct_IsNoFixture_AndReportsNothingAsync, SingleTeardownAnalyzerTests.ALookAlikeAfterAttribute_ReportsNothingAsync}

## How to fix it

Keep the `[After(Test)]` hook, which TUnit runs whether the test passed or failed, as the one teardown. Move anything `Dispose` released into the hook and drop the interface:

```csharp{title="Clearing WHIZ609" description="The [After(Test)] hook is the only teardown and the class is no longer disposable." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz609", "repository-check", "tunit", "analyzer"] tests=["SingleTeardownAnalyzerTests.AHookAlone_IsTheOneTeardown_AndReportsNothingAsync"]}
public class OrdersTests {
  [After(Test)]
  public async Task TeardownAsync() {
    // drop the test database
  }
}
```

- A hook named `DisposeAsync` is renamed, to `TeardownAsync` for example, when the interface goes, so it no longer reads as a dispose method.
- A fixture that wraps another (a nested test fixture deriving from a shared test base) calls the wrapped fixture's `TeardownAsync` from its own hook, not its `DisposeAsync`.
- When the hook disposes a field the fixture creates, CA1001 may ask for the interface back. Suppress CA1001 on the class with the reason (the hook disposes the field) rather than restoring the interface.

{verified: SingleTeardownAnalyzerTests.AHookAlone_IsTheOneTeardown_AndReportsNothingAsync}

## Related

- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
- [Testing a New Data Engine](../../../contributors/data-engines/testing-a-new-engine.md), where the single-teardown rule for engine fixtures is described
