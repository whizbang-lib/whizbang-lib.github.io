---
title: 'WHIZ038: WhizbangId Versions Narrowed'
pageType: troubleshooting
verifiedAgainstCommit: 'b865cd6b'
verifiedDate: 2026-11-21
description: >-
  Warning when the [WhizbangId] declarations for one strongly-typed id list different Versions. The id accepts the
  versions they have in common, whatever order the attributes are found in.
version: 1.0.0
category: Diagnostics
severity: Warning
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

# WHIZ038: WhizbangId Versions Narrowed

**Severity**: Warning
**Category**: Source Generation / Identity

## Description

The `WhizbangIdGenerator` collects every `[WhizbangId]` in the project, whether it is on a struct, a property or a
constructor parameter, and generates each id once. When the attributes for one id list different
[`Versions`](../../fundamentals/identity/whizbang-ids#accepted-versions) (an attribute that does not write `Versions`
lists `UuidVersions.V7`), the id accepts only the versions every one of them lists: the strictest common set, whatever
order the attributes are found in. WHIZ038 is reported at each attribute whose list was narrowed, naming the versions
the id accepts.

## Diagnostic Message

```
The Versions on this [WhizbangId] are narrowed: the [WhizbangId] declarations for '{IdType}' list different versions, so the id accepts the ones they have in common, {Versions}. List the same Versions on every [WhizbangId] for this id.
```

## How to Fix

List the same `Versions` on every `[WhizbangId]` for the id. Usually the id should be declared once, on the struct,
and the property and parameter attributes are not needed.

### Before (causes WHIZ038)

```csharp{title="Two declarations that list different versions" description="The struct lists v7 and v5 and a property's attribute keeps the default, so the id accepts v7 only and WHIZ038 points at the narrowed list." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions", "warning"] testFile="WhizbangIdVersionsTests.cs" testMethod="RoutesThatDisagree_TakeTheCommonVersionsAndReportWhiz038AtTheNarrowedListAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.RoutesThatDisagree_TakeTheCommonVersionsAndReportWhiz038AtTheNarrowedListAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(Versions = UuidVersions.V7 | UuidVersions.V5)]  // WHIZ038: narrowed to UUIDv7
public readonly partial struct ProductId;

public class CreateProduct {
  [WhizbangId]  // lists UUIDv7 only
  public ProductId Id { get; set; }
}
```

### After (no warning)

```csharp{title="Declarations that list the same versions" description="Every [WhizbangId] for the id lists the same versions, so the id accepts v7 or v5 and no warning is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions", "info"] testFile="WhizbangIdVersionsTests.cs" testMethod="RoutesThatAgreeOnVersions_ReportNothingAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.RoutesThatAgreeOnVersions_ReportNothingAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(Versions = UuidVersions.V7 | UuidVersions.V5)]
public readonly partial struct ProductId;

public class CreateProduct {
  [WhizbangId(Versions = UuidVersions.V5 | UuidVersions.V7)]
  public ProductId Id { get; set; }
}
```

## Suppressing

Do not suppress WHIZ038: it means a listed version is refused at runtime. Make the declarations agree instead.

## Related

- [WhizbangIds: A list of accepted versions](../../fundamentals/identity/whizbang-ids#accepted-versions)
- [WHIZ029: WhizbangId AcceptAnyVersion Disagrees](whiz029)
- [WHIZ043: WhizbangId Accepts No Version](whiz043)
