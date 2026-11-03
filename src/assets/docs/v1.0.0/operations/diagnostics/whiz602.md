---
title: 'WHIZ602: Test Project Declares an Unknown WhizbangTestType'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test project in the Whizbang repository declares a
  WhizbangTestType that no test runner knows, so its tests would never run
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

# WHIZ602: Test Project Declares an Unknown WhizbangTestType

**Severity**: Error
**Raised by**: `Directory.Build.targets` (MSBuild)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A project sets `<WhizbangTestType>` to a value that is not in `WhizbangKnownTestTypes` (`Unit`, `Component`, `Integration`, `Benchmark`, `Soak`). The build stops before compiling it.

## Why it matters

Every test runner and CI suite selects projects by type, and each skips a type it does not know. A misspelled or new type therefore builds cleanly and is never run anywhere.

## How to fix it

- If the value is a typo, use one of the known types.
- If a new type is really needed, add it to `WhizbangKnownTestTypes` and teach every reader of the property about it, as `docs/TEST-PROJECTS.md` ("Adding a test type") in the library repository describes. `.github/scripts/Test-WhizbangTestType.ps1` fails the pull request until every runner knows the new type.

## Related

- [WHIZ601](whiz601.md) - the test project declares no `WhizbangTestType`
- [WHIZ600](whiz600.md) - the test project declares no `WhizbangTestTags`
