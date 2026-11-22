---
title: 'WHIZ038: WhizbangId AcceptAnyVersion With Versions'
pageType: troubleshooting
verifiedAgainstCommit: 'b865cd6b'
verifiedDate: 2026-11-21
description: >-
  Error when one [WhizbangId] writes both AcceptAnyVersion = true and Versions, which contradict each other.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - versions
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
  - src/Whizbang.Core/WhizbangIdAttribute.cs
  - src/Whizbang.Core/UuidVersions.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs
lastMaintainedCommit: 'b865cd6b'
---

# WHIZ038: WhizbangId AcceptAnyVersion With Versions

**Severity**: Error
**Category**: Source Generation / Identity

## Description

[`AcceptAnyVersion = true`](../../fundamentals/identity/whizbang-ids#accept-any-version) makes an id accept any
non-empty Guid; [`Versions`](../../fundamentals/identity/whizbang-ids#accepted-versions) lists the UUID versions it
accepts. A `[WhizbangId]` that writes both says two different things, so the generator refuses it. `AcceptAnyVersion
= false` next to `Versions` is the default and is not reported.

## Diagnostic Message

```
This [WhizbangId] for '{IdType}' writes both AcceptAnyVersion = true and Versions. Write Versions to list the accepted versions, or AcceptAnyVersion = true to accept any non-empty Guid, not both.
```

## How to Fix

Keep one. List the versions when you know how the id's values are made (minted, derived by name); keep
`AcceptAnyVersion = true` only for ids issued outside your system, whose version you do not control.

### Before (causes WHIZ038)

```csharp{title="An attribute that writes both" description="AcceptAnyVersion = true and Versions on the same attribute contradict each other." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions", "error"] testFile="WhizbangIdVersionsTests.cs" testMethod="AcceptAnyVersionAndVersions_ReportWhiz038AtTheAttributeAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.AcceptAnyVersionAndVersions_ReportWhiz038AtTheAttributeAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(AcceptAnyVersion = true, Versions = UuidVersions.V5)]  // WHIZ038
public readonly partial struct ProductId;
```

### After

```csharp{title="A list of versions alone" description="The attribute lists the accepted versions and does not set AcceptAnyVersion, so no error is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions"] testFile="WhizbangIdVersionsTests.cs" testMethod="AcceptAnyVersionFalseWithVersions_ReportsNoWhiz038Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.AcceptAnyVersionFalseWithVersions_ReportsNoWhiz038Async"]}
[WhizbangId(Versions = UuidVersions.V7 | UuidVersions.V5)]
public readonly partial struct ProductId;
```

## Related

- [WhizbangIds: A list of accepted versions](../../fundamentals/identity/whizbang-ids#accepted-versions)
- [WhizbangIds: Ids that are not UUIDv7](../../fundamentals/identity/whizbang-ids#accept-any-version)
