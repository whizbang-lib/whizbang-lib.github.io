---
title: 'WHIZ021: WhizbangId Must Be Partial'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when [WhizbangId] is placed on a struct that is not declared partial. The generator cannot add the id's
  members to it, so no id code is generated for that struct.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - partial
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
  - src/Whizbang.Core/WhizbangIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ021: WhizbangId Must Be Partial

**Severity**: Warning
**Category**: Source Generation / Identity

## Description

`[WhizbangId]` turns a struct into a strongly-typed id: the generator writes the value, the JSON converter, the
factory and the provider for it. It does this by adding a second `partial` declaration of the same struct, which C#
only allows when your declaration is `partial` too.

When the `WhizbangIdGenerator` finds `[WhizbangId]` on a struct declaration without the `partial` modifier, it reports
WHIZ021 on that declaration and **skips the struct**: no value object, converter, factory or provider is generated for
it. Code that expects the generated members will then fail to compile or behave as a plain empty struct.

The check applies only to `[WhizbangId]` on a struct. When `[WhizbangId]` is on a property or a constructor parameter,
the generator creates the id type itself, so there is no declaration of yours to check.

## Diagnostic Message

```
[WhizbangId] on {StructName} requires the struct to be declared as 'partial'
```

## Common Causes

1. **The `partial` keyword was left out**, for example `public readonly struct ProductId;`.
2. **An existing hand-written id struct** was converted to a generated one by adding the attribute, without adding
   `partial`.

## How to Fix

Add `partial` to the struct declaration.

### Before (causes WHIZ021)

```csharp{title="WhizbangId on a non-partial struct" description="The struct is missing the partial modifier, so the generator reports WHIZ021 and generates nothing for it." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "whizbang-id", "partial", "warning"] testFile="WhizbangIdGeneratorTests.cs" testMethod="Generator_WithNonPartialStruct_ProducesDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs" tests=["WhizbangIdGeneratorTests.Generator_WithNonPartialStruct_ProducesDiagnosticAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId]
public readonly struct ProductId;  // WHIZ021: missing 'partial'
```

### After (generates the id)

```csharp{title="WhizbangId on a partial struct" description="With the partial modifier the generator produces ProductId.g.cs with the TrackedGuid-backed value object." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "whizbang-id", "partial"] testFile="WhizbangIdGeneratorTests.cs" testMethod="Generator_WithExplicitTypeDeclaration_GeneratesValueObjectAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs" tests=["WhizbangIdGeneratorTests.Generator_WithExplicitTypeDeclaration_GeneratesValueObjectAsync"]}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId]
public readonly partial struct ProductId;
```

## Suppressing

WHIZ021 is reported on the struct declaration, so the usual mechanisms work:

```csharp{title="Suppress WHIZ021 with a pragma" description="A pragma region around the declaration silences WHIZ021 for that struct only." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "pragma"] unverified="suppression, not exercised by a test"}
#pragma warning disable WHIZ021
[WhizbangId]
public readonly struct ProductId;
#pragma warning restore WHIZ021
```

```ini{title="Suppress WHIZ021 in .editorconfig" description="Turns off WHIZ021 for the C# files the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "editorconfig"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ021.severity = none
```

Suppressing is almost never appropriate. Silencing the warning does not make the generator produce the id; it only
hides why the id is missing. If you do not want a generated id, remove `[WhizbangId]` instead.

## Related

- [WhizbangIds: Defining a WhizbangId](../../fundamentals/identity/whizbang-ids#defining-a-whizbangid)
- [WHIZ024: Duplicate WhizbangId Type Name](whiz024)
- [WHIZ020: WhizbangId Discovered](whiz020)
