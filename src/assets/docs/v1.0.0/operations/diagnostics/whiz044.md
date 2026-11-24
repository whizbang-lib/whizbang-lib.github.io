---
title: 'WHIZ044: WhizbangId Versions Outside 1 To 8'
pageType: troubleshooting
verifiedAgainstCommit: '7a65287a'
verifiedDate: 2026-11-23
description: >-
  Error when a [WhizbangId] Versions value has bits that name no UUID version, such as a cast like
  (UuidVersions)1 or a bit above version 8.
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
  - src/Whizbang.Core/UuidVersions.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs
lastMaintainedCommit: '7a65287a'
---

# WHIZ044: WhizbangId Versions Outside 1 To 8

**Severity**: Error
**Category**: Source Generation / Identity

## Description

Each `UuidVersions` flag is the bit of its version number, from `V1` (`1 << 1`) to `V8` (`1 << 8`). A
[`Versions`](../../fundamentals/identity/whizbang-ids#accepted-versions) value with any other bit set, such as
`(UuidVersions)1` (bit 0) or `(UuidVersions)(1 << 9)`, names no version. Such a bit takes no part in the rule, and
WHIZ044 is reported at the attribute so it is not dropped silently. The valid bits still decide what the id accepts;
when none are left, [WHIZ043](whiz043) is reported too.

## Diagnostic Message

```
'{IdType}' lists bits {Bits} in Versions that name no UUID version. Use the UuidVersions flags (V1 to V8) only.
```

`{Bits}` is the stray bits in hexadecimal, for example `0x200`.

## How to Fix

Write the versions with the `UuidVersions` flags rather than casting a number.

### Before (causes WHIZ044)

```csharp{title="A bit that names no version" description="Bit 9 is not a UUID version, so it is reported; the id accepts UUIDv7 only." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions", "error"] testFile="WhizbangIdVersionsTests.cs" testMethod="VersionsWithBitsOutsideOneToEight_ReportWhiz044Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.VersionsWithBitsOutsideOneToEight_ReportWhiz044Async"]}
[WhizbangId(Versions = UuidVersions.V7 | (UuidVersions)(1 << 9))]  // WHIZ044: 0x200 is no version
public readonly partial struct CustomerId;
```

### After

```csharp{title="Only UuidVersions flags" description="The versions are written as flags, so every bit names a version." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "versions"] testFile="WhizbangIdVersionsTests.cs" testMethod="ExplicitType_WithAllowList_ChecksTheListedVersionsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdVersionsTests.cs" tests=["WhizbangIdVersionsTests.ExplicitType_WithAllowList_ChecksTheListedVersionsAsync"]}
[WhizbangId(Versions = UuidVersions.V7 | UuidVersions.V4)]
public readonly partial struct CustomerId;
```

## Related

- [WhizbangIds: A list of accepted versions](../../fundamentals/identity/whizbang-ids#accepted-versions)
- [WHIZ043: WhizbangId Accepts No Version](whiz043)
