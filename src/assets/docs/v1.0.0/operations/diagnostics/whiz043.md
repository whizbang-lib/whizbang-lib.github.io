---
title: 'WHIZ043: WhizbangId Accepts No Version'
pageType: troubleshooting
verifiedAgainstCommit: 'b865cd6b'
verifiedDate: 2026-11-21
description: >-
  Error when a strongly-typed id accepts no UUID version: its Versions list is empty, or its [WhizbangId]
  declarations list no version in common.
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

# WHIZ043: WhizbangId Accepts No Version

**Severity**: Error
**Category**: Source Generation / Identity

## Description

A strongly-typed id must accept at least one UUID version through `From`, `Parse`, the explicit cast, JSON and the
GraphQL scalar. WHIZ043 is reported when it would accept none:

- its [`Versions`](../../fundamentals/identity/whizbang-ids#accepted-versions) list is empty (`UuidVersions.None`),
  or holds no version 1 to 8 (a bit outside them is also [WHIZ044](whiz044)); or
- the `[WhizbangId]` declarations for it (the struct, a property, a parameter) list no version in common, for
  example `V5` on the struct and the default `V7` on a property. It is then reported at a declaration that wrote
  `Versions`, not at one that took the default.

## Diagnostic Message

```
'{IdType}' accepts no UUID version: {Reason}. List at least one version in Versions, the same on every [WhizbangId] for this id.
```

## How to Fix

List at least one version, and list the same versions on every `[WhizbangId]` for the id.

### Before (causes WHIZ043)

```csharp{title="Declarations with no version in common" description="The struct lists v5 only and a property's attribute keeps the default v7, so no version is accepted by both." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions", "error"] testFile="WhizbangIdVersionsTests.cs" testMethod="RoutesWithNoVersionInCommon_ReportWhiz043AtADeclarationThatWroteVersionsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.RoutesWithNoVersionInCommon_ReportWhiz043AtADeclarationThatWroteVersionsAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(Versions = UuidVersions.V5)]  // WHIZ043: nothing in common with the property's v7
public readonly partial struct ProductId;

public class CreateProduct {
  [WhizbangId]
  public ProductId Id { get; set; }
}
```

### After

```csharp{title="One declaration with a non-empty list" description="The id is declared once, on the struct, with versions to accept, so WHIZ043 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions"] testFile="WhizbangIdVersionsTests.cs" testMethod="ExplicitType_WithAllowList_ChecksTheListedVersionsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.ExplicitType_WithAllowList_ChecksTheListedVersionsAsync"]}
[WhizbangId(Versions = UuidVersions.V7 | UuidVersions.V5)]
public readonly partial struct ProductId;

public class CreateProduct {
  public ProductId Id { get; set; }  // the struct's declaration is enough
}
```

## Related

- [WhizbangIds: A list of accepted versions](../../fundamentals/identity/whizbang-ids#accepted-versions)
- [WHIZ038: WhizbangId Versions Narrowed](whiz038)
- [WHIZ039: WhizbangId AcceptAnyVersion With Versions](whiz039)
- [WHIZ044: WhizbangId Versions Outside 1 To 8](whiz044)
