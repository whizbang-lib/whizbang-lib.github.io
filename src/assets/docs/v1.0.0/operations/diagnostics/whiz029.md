---
title: 'WHIZ029: WhizbangId AcceptAnyVersion Disagrees'
pageType: troubleshooting
verifiedAgainstCommit: 'c583edcb'
verifiedDate: 2026-11-09
description: >-
  Warning when the same strongly-typed id is declared through more than one [WhizbangId] and only some of them set
  AcceptAnyVersion. The id keeps the UUIDv7 rule, whatever order the attributes are found in.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - accept-any-version
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
  - src/Whizbang.Core/WhizbangIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdAcceptAnyVersionTests.cs
lastMaintainedCommit: 'c583edcb'
---

# WHIZ029: WhizbangId AcceptAnyVersion Disagrees

**Severity**: Warning
**Category**: Source Generation / Identity

## Description

The `WhizbangIdGenerator` collects every `[WhizbangId]` in the project, whether it is on a struct, a property or a
constructor parameter, and generates each id once. When the attributes for one id disagree on
[`AcceptAnyVersion`](../../fundamentals/identity/whizbang-ids#accept-any-version), the generator cannot honor both.
The id keeps the default rule (`From`, `Parse`, the cast and the transport JSON reader take UUIDv7 only), whatever
order the attributes are found in, and WHIZ029 is reported at each `[WhizbangId(AcceptAnyVersion = true)]` that is
ignored.

## Diagnostic Message

```
AcceptAnyVersion = true on this [WhizbangId] is ignored: another [WhizbangId] for '{IdType}' does not set it, so the id keeps the UUIDv7 rule. Set AcceptAnyVersion the same on every [WhizbangId] for this id.
```

## How to Fix

Set `AcceptAnyVersion` the same way on every `[WhizbangId]` for the id. Usually the id should be declared once, on
the struct, and the property and parameter attributes are not needed.

### Before (causes WHIZ029)

```csharp{title="Two declarations that disagree on AcceptAnyVersion" description="The struct opts in and a property's attribute does not, so the id keeps the UUIDv7 rule and WHIZ029 points at the opt-in." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "accept-any-version", "warning"] testFile="WhizbangIdAcceptAnyVersionTests.cs" testMethod="RoutesThatDisagree_KeepTheUuidV7RuleAndReportWhiz029AtTheOptInAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdAcceptAnyVersionTests.cs" tests=["WhizbangIdAcceptAnyVersionTests.RoutesThatDisagree_KeepTheUuidV7RuleAndReportWhiz029AtTheOptInAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(AcceptAnyVersion = true)]  // WHIZ029: ignored, the property below does not set it
public readonly partial struct ProductId;

public class CreateProduct {
  [WhizbangId]
  public ProductId Id { get; set; }
}
```

### After (no warning)

```csharp{title="Declarations that agree on AcceptAnyVersion" description="Every [WhizbangId] for the id sets AcceptAnyVersion the same way, so the id takes any non-empty Guid and no warning is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "accept-any-version"] testFile="WhizbangIdAcceptAnyVersionTests.cs" testMethod="RoutesThatAgreeOnAcceptAnyVersion_ReportNoWhiz029Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdAcceptAnyVersionTests.cs" tests=["WhizbangIdAcceptAnyVersionTests.RoutesThatAgreeOnAcceptAnyVersion_ReportNoWhiz029Async"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId(AcceptAnyVersion = true)]
public readonly partial struct ProductId;

public class CreateProduct {
  [WhizbangId(AcceptAnyVersion = true)]
  public ProductId Id { get; set; }
}
```

## Suppressing

Do not suppress WHIZ029: it means an opt-in has no effect. Make the declarations agree instead.

## Related

- [WhizbangIds: Ids that are not UUIDv7](../../fundamentals/identity/whizbang-ids#accept-any-version)
- [WHIZ024: Duplicate WhizbangId Type Name](whiz024)
- [WHIZ021: WhizbangId Must Be Partial](whiz021)
