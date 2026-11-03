---
title: 'WHIZ600: Test Project Declares No WhizbangTestTags'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test project in the Whizbang repository declares no
  WhizbangTestTags, so tag-based test selection would skip it without a word
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
  - .github/scripts/tests/Test-DiagnosticIds.Tests.ps1
---

# WHIZ600: Test Project Declares No WhizbangTestTags

**Severity**: Error
**Raised by**: `Directory.Build.targets` (MSBuild)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A project with `IsTestProject=true` has no `<WhizbangTestTags>` property. The build stops before compiling it.

## Why it matters

The tags are how tests are selected: `scripts/Run-Tests.ps1 -Tag` and the CI integration jobs built on it pick projects by tag. A project with no tags matches no selection. It does not fail; it simply never runs, and CI stays green while its suite stops being exercised.

## How to fix it

Add a kind tag (`Unit`, `Component` or `Integration`) to the project file, plus `Docker` and the infrastructure the project needs (`Postgres`, `RabbitMQ`, `AzureServiceBus`, `AzureBlob`, `InMemory`) when it uses containers:

```xml{title="Declaring the tags WHIZ600 asks for" description="A unit test project declares its kind tag and its test type." category="Diagnostics" difficulty="BEGINNER" tags=["whiz600", "repository-check", "msbuild", "testing"] unverified="MSBuild property in a test project file; the check is an MSBuild Error task, not exercised by a .NET test"}
<PropertyGroup>
  <WhizbangTestTags>Unit</WhizbangTestTags>
  <WhizbangTestType>Unit</WhizbangTestType>
</PropertyGroup>
```

## Related

- [WHIZ601](whiz601.md) - the test project declares no `WhizbangTestType`
- [WHIZ602](whiz602.md) - the declared `WhizbangTestType` is unknown
