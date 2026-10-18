---
title: 'WHIZ020: WhizbangId Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational descriptor for a discovered [WhizbangId] strongly-typed id. It is defined but not reported by the
  current generator, so you will not see it in build output.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/WhizbangIdGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ020: WhizbangId Discovered

**Severity**: Info
**Category**: Source Generation / Identity

## Description

WHIZ020 is defined as an informational notice meaning "a `[WhizbangId]` strongly-typed id was found and its value
object will be generated". The descriptor's description says the id "will be generated with UUIDv7 support".

**Current behavior**: the `WhizbangIdGenerator` does not report WHIZ020. It generates the id types silently and reports
only [WHIZ021](whiz021) (struct not `partial`) and [WHIZ024](whiz024) (same id name in two namespaces). You will not
see WHIZ020 in build output, and no test asserts it.

## Diagnostic Message

```
Found [WhizbangId] on {TypeName} in namespace {Namespace}
```

## Common Causes

The descriptor describes this situation, which today produces generated code but no notice:

1. **A struct is marked `[WhizbangId]`**, for example `public readonly partial struct ProductId;`.
2. **A property or constructor parameter is marked `[WhizbangId]`**, which asks the generator to create an id type named
   after the property or parameter type.

## How to Fix

Nothing to fix. To confirm an id was generated, look for its generated source (for example `ProductId.g.cs`) under the
project's generated files, rather than for a WHIZ020 notice.

```csharp{title="A WhizbangId declaration" description="A partial struct marked [WhizbangId]; the generator produces the value object for it without reporting WHIZ020." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "whizbang-id", "strongly-typed-ids"] unverified="WHIZ020 is never reported; generation for this shape is checked by WhizbangIdGeneratorTests.Generator_WithExplicitTypeDeclaration_GeneratesValueObjectAsync"}
using Whizbang.Core;

namespace MyApp.Domain;

[WhizbangId]
public readonly partial struct ProductId;
```

## Suppressing

There is nothing to suppress while the generator does not report it. If a future version starts reporting it, the
usual severity setting would apply:

```ini{title="Silence WHIZ020 project-wide" description="A global analyzer config that would turn off the WHIZ020 discovery notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ020.severity = none
```

## Related

- [WhizbangIds: Strongly-Typed Identity Values](../../fundamentals/identity/whizbang-ids)
- [WHIZ021: WhizbangId Must Be Partial](whiz021)
- [WHIZ024: Duplicate WhizbangId Type Name](whiz024)
