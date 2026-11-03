---
title: 'WHIZ601: Test Project Declares No WhizbangTestType'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test project in the Whizbang repository declares no
  WhizbangTestType, so no test runner would ever run it
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - testing
  - msbuild
codeReferences:
  - Directory.Build.targets
  - diagnostic-ids.txt
testReferences:
  - .github/scripts/tests/Test-WhizbangTestType.Tests.ps1
  - .github/scripts/tests/Test-DiagnosticIds.Tests.ps1
---

# WHIZ601: Test Project Declares No WhizbangTestType

**Severity**: Error
**Raised by**: `Directory.Build.targets` (MSBuild)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A project with `IsTestProject=true` has no `<WhizbangTestType>` property. The build stops before compiling it.

## Why it matters

`Run-Tests.ps1`, `Test-SolutionTestProjects.ps1`, the CI build slices and the CI suites all select test projects by this property. Each one skips a project it cannot place without a word: the project builds and its tests never run.

## How to fix it

Declare one of the known types, `Unit`, `Component`, `Integration`, `Benchmark` or `Soak`, in the project file:

```xml{title="Declaring the test type WHIZ601 asks for" description="A component test project declares its test type." category="Diagnostics" difficulty="BEGINNER" tags=["whiz601", "repository-check", "msbuild", "testing"] unverified="MSBuild property in a test project file; the check is an MSBuild Error task, not exercised by a .NET test"}
<PropertyGroup>
  <WhizbangTestType>Component</WhizbangTestType>
</PropertyGroup>
```

The list of known types lives in `WhizbangKnownTestTypes` in `Directory.Build.targets`; `docs/TEST-PROJECTS.md` in the library repository describes each one.

## Related

- [WHIZ600](whiz600.md) - the test project declares no `WhizbangTestTags`
- [WHIZ602](whiz602.md) - the declared `WhizbangTestType` is unknown
