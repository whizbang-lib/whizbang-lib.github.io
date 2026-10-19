---
title: 'WHIZ024: Duplicate WhizbangId Type Name'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when two [WhizbangId] ids with the same type name are generated in different namespaces. Both are still
  generated; the warning flags the likely confusion and can be silenced with SuppressDuplicateWarning.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - namespaces
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
  - src/Whizbang.Core/WhizbangIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/WhizbangIdGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ024: Duplicate WhizbangId Type Name

**Severity**: Warning
**Category**: Source Generation / Identity

## Description

The `WhizbangIdGenerator` collects every `[WhizbangId]` in the project, whether it is on a struct, a property or a
constructor parameter. Ids with the same name and namespace are merged and generated once. Ids with the **same type
name** in **different namespaces** are all generated (each into its own namespace, with a namespace-qualified generated
file name such as `MyAppDomain.ProductId.g.cs`), and WHIZ024 is reported for each such pair.

Nothing is broken. The warning exists because two different `ProductId` types are easy to mix up: a `using` directive
decides which one a file gets, and the compiler treats them as unrelated types.

The namespace an id is generated into is the namespace it is declared in, unless the attribute sets one through its
constructor argument or its `Namespace` property. A property-based `[WhizbangId(Namespace = "...")]` is therefore a
common way to end up with a second id of the same name.

The warning is skipped for a pair when **either** of the two declarations sets `SuppressDuplicateWarning = true`.

## Diagnostic Message

```
WhizbangId type '{TypeName}' exists in multiple namespaces ({FirstNamespace} and {SecondNamespace}). This may cause confusion. Set SuppressDuplicateWarning = true to suppress.
```

## Common Causes

1. **The same id name declared in two places**, for example a `ProductId` struct in a domain namespace and a
   property-based `[WhizbangId(Namespace = "MyApp.Commands")]` whose type is also `ProductId`.
2. **A `Namespace` argument that differs** between two declarations meant to be the same id.
3. **Two bounded contexts** that each define their own id with a common name, on purpose.

## How to Fix

- **One id was intended**: make the declarations agree on the namespace (or remove the `Namespace` override) so they
  merge into one generated type.
- **Two ids are intended**: rename one of them, or keep both and set `SuppressDuplicateWarning = true` on either
  declaration.

### Before (causes WHIZ024)

The test compiles both declarations in one source; they are shown here as two files.

```csharp{title="Two ProductId ids in different namespaces" description="A struct-based ProductId and a property-based ProductId in another namespace produce WHIZ024; both ids are still generated." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "namespaces", "warning"] testFile="WhizbangIdGeneratorTests.cs" testMethod="Generator_WithCollision_EmitsDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs" tests=["WhizbangIdGeneratorTests.Generator_WithCollision_EmitsDiagnosticAsync"]}
// ProductId.cs
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId]
public readonly partial struct ProductId;

// CreateProductCommand.cs
using Whizbang.Core;

namespace MyApp.Commands;

public class CreateProductCommand {
  [WhizbangId(Namespace = "MyApp.Commands")]  // WHIZ024: ProductId also in MyApp.Domain
  public ProductId Id { get; set; }
}
```

### After (no warning, both ids kept on purpose)

```csharp{title="Duplicate id name acknowledged with SuppressDuplicateWarning" description="Setting SuppressDuplicateWarning on one of the two declarations silences WHIZ024 for the pair." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "whizbang-id", "namespaces", "suppression"] testFile="WhizbangIdGeneratorTests.cs" testMethod="Generator_WithCollisionSuppressed_NoWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/WhizbangIdGeneratorTests.cs" tests=["WhizbangIdGeneratorTests.Generator_WithCollisionSuppressed_NoWarningAsync"]}
// ProductId.cs
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId]
public readonly partial struct ProductId;

// CreateProductCommand.cs
using Whizbang.Core;

namespace MyApp.Commands;

public class CreateProductCommand {
  [WhizbangId(Namespace = "MyApp.Commands", SuppressDuplicateWarning = true)]
  public ProductId Id { get; set; }
}
```

`SuppressDuplicateWarning` is honored on struct-based declarations
{verified: WhizbangIdGeneratorCoverageTests.Generator_TypeBasedSuppressDuplicateWarning_SuppressesCollisionWarningAsync}
and on constructor parameters
{verified: WhizbangIdGeneratorCoverageTests.Generator_ParameterBasedSuppressDuplicateWarning_SuppressesCollisionWarningAsync}
as well as on properties.

## Suppressing

Prefer `SuppressDuplicateWarning = true` on the attribute: it documents at the declaration that the duplicate name is
deliberate, and it silences only that pair.

WHIZ024 is reported with no source location, so a `#pragma warning disable WHIZ024` region cannot reach it, and a
file-scoped `.editorconfig` section (`[*.cs]`) does not apply to it either. To turn it off for a whole project, use a
global analyzer config file:

```ini{title="Silence WHIZ024 project-wide" description="A global analyzer config that turns off the WHIZ024 duplicate-name warning." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ024.severity = none
```

Turning it off project-wide is appropriate only when duplicate id names across namespaces are an accepted convention
in your codebase; otherwise it hides accidental duplicates.

## Related

- [WhizbangIds: Strongly-Typed Identity Values](../../fundamentals/identity/whizbang-ids)
- [WHIZ021: WhizbangId Must Be Partial](whiz021)
- [WHIZ020: WhizbangId Discovered (retired)](whiz020)
