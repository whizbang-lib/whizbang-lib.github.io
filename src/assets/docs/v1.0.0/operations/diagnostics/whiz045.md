---
title: 'WHIZ045: WhizbangId Declares IsAccepted'
pageType: troubleshooting
verifiedAgainstCommit: '5038af701'
verifiedDate: 2026-11-25
description: >-
  Error when a [WhizbangId] type declares its own member named IsAccepted, which every generated id declares for its
  version rule.
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
  - src/Whizbang.Generators/Templates/Snippets/WhizbangIdRuleSnippets.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs
lastMaintainedCommit: '5038af701'
---

# WHIZ045: WhizbangId Declares IsAccepted

**Severity**: Error
**Category**: Source Generation / Identity

## Description

Every generated id declares `public static bool IsAccepted(Guid value)`: whether its
[version rule](../../fundamentals/identity/whizbang-ids#accepted-versions), or a
[grandfathered value](../../fundamentals/identity/whizbang-ids#grandfathered-values), accepts the value, without an
exception. The stream-id report asks it on every append of a stream id that is not UUIDv7, and an allow-list id's `From`
checks through it. WHIZ045 is reported when the id type, as you wrote it, already declares a member named `IsAccepted`
(a method, a property or a field), which would collide with the generated one.

## Diagnostic Message

```
'{IdType}' declares a member named IsAccepted, which the generated id declares to say whether its version rule accepts a value. Rename the member.
```

## How to Fix

Rename your member. To ask whether the id's rule accepts a value, call the generated `IsAccepted`.

### Before (causes WHIZ045)

```csharp{title="An id that declares IsAccepted" description="The member collides with the IsAccepted every generated id declares." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "whizbang-id", "error"] testFile="WhizbangIdVersionsTests.cs" testMethod="AnIdThatDeclaresIsAccepted_ReportsWhiz045Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.AnIdThatDeclaresIsAccepted_ReportsWhiz045Async"]}
[WhizbangId]
public readonly partial struct ProductId {
  public bool IsAccepted => true;  // WHIZ045
}
```

### After

```csharp{title="The member renamed" description="The id declares nothing named IsAccepted, so the generated one is the only one." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "whizbang-id"] testFile="WhizbangIdVersionsTests.cs" testMethod="AnIdThatDeclaresIsAccepted_ReportsWhiz045Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.AnIdThatDeclaresIsAccepted_ReportsWhiz045Async"]}
[WhizbangId]
public readonly partial struct ProductId {
  public bool IsApproved => true;
}

var accepted = ProductId.IsAccepted(value);  // the generated rule check, never throws
```

## Related

- [WhizbangIds: A list of accepted versions](../../fundamentals/identity/whizbang-ids#accepted-versions)
- [WHIZ043: WhizbangId Accepts No Version](whiz043)
- [WHIZ044: WhizbangId Versions Outside 1 To 8](whiz044)
