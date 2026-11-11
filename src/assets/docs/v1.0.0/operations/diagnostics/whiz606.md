---
title: 'WHIZ606: Type Name Read Outside the Shared Naming Code'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: Whizbang library code reads a type, namespace or
  assembly name, or resolves a type from a string, outside the shared naming
  code, so two services or two builds of one assembly could render one type
  two ways
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - type-names
  - naming
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/TypeNameSourceAnalyzer.cs
  - src/Whizbang.Core/TypeNameAuthorityAttribute.cs
  - src/Whizbang.Core/TypeNameFormatter.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/TypeNameSourceAnalyzerTests.cs
---

# WHIZ606: Type Name Read Outside the Shared Naming Code

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code. It runs only on the library projects under `src/` and never ships in a package, so an application that uses Whizbang never sees it. Tests, tools, samples and benchmarks have it turned off (`TypeNaming.OutsideLibrary.globalconfig`). See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

Code outside a class marked `[TypeNameAuthority]` reads a name the shared naming code owns:

- **Runtime code**: `Name`, `FullName`, `Namespace`, `AssemblyQualifiedName` or `ToString()` on a receiver typed `System.Type` (or `TypeInfo`); `Assembly.FullName`, `Assembly.GetName()`, `AssemblyName.Name` or `AssemblyName.FullName`; or a type resolved from a string with `Type.GetType(string, ...)` or `Assembly.GetType(string, ...)`.
- **Generator code**: `Name`, `MetadataName`, `ContainingNamespace`, `ContainingAssembly`, `Identity`, `ToDisplayString()` or `ToDisplayParts()` on a type, namespace or assembly symbol.

A member's name read through a member receiver (`MethodInfo.Name`, `PropertyInfo.Name`, `IMethodSymbol.Name`) is not a type name and is not reported. Comparing two `Type` values is not reported either.

```csharp{title="The reads WHIZ606 reports" description="A type's name and an assembly's name read directly in library code, outside the shared naming code." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz606", "repository-check", "type-names", "analyzer"] tests=["TypeNameSourceAnalyzerTests.Runtime_ANameReadOffATypeOrAssembly_IsReportedAsync", "TypeNameSourceAnalyzerTests.Runtime_TypeGetTypeAndAssemblyGetType_AreEachReportedAsync"]}
internal static class OrderRouting {
  public static string RouteKey(Type messageType) =>
    messageType.FullName + ", " + messageType.Assembly.GetName().Name;   // WHIZ606 on each read

  public static Type? Resolve(string name) => Type.GetType(name);       // WHIZ606
}
```

```csharp{title="Generator reads WHIZ606 reports" description="A type symbol's name and display string read in generator code outside TypeNameUtilities." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz606", "repository-check", "generators", "analyzer"] tests=["TypeNameSourceAnalyzerTests.Generator_ANameReadOffATypeNamespaceOrAssemblySymbol_IsReportedAsync", "TypeNameSourceAnalyzerTests.Generator_AMemberSymbolsName_IsNotReportedAsync"]}
internal static class HandlerModel {
  public static string Key(INamedTypeSymbol type) =>
    type.ContainingNamespace.Name + "." + type.Name;   // WHIZ606 on each read

  public static string Signature(IMethodSymbol method) =>
    method.Name;                                      // not reported: a member's name
}
```

## Why it matters

A type name is a key: a perspective's table, a message's route, a composite child's id, a priority rule. Every place that renders one its own way is a place where two services, or two builds of one contract assembly, can disagree. A composite child once derived three different ids on three paths for exactly this reason, and its stream digests disagreed with nothing missing ([Deterministic child ids](../../fundamentals/messaging/composite-events.md#deterministic-child-ids)). With one source of names, a key cannot drift by accident.

## How to fix it

Call the helper for the form you need. [Type Names in Library Code](../../../contributors/type-naming.md#which-helper) lists which helper gives which form; the common ones:

```csharp{title="Clearing WHIZ606" description="The same reads through the shared naming code: the version-free wire form for a key, the shared resolver for a type from a name." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz606", "repository-check", "type-names", "type-name-formatter"] tests=["TypeNameWireFormTests.Format_CarriesNoVersionAtAnyDepthAsync", "TypeNameWireFormTests.SimpleNames_AreTheTypesOwnAsync"]}
internal static class OrderRouting {
  public static string RouteKey(Type messageType) =>
    TypeNameFormatter.Format(messageType);         // Namespace.Type, Assembly; version-free

  public static string Describe(Type messageType) =>
    TypeNameFormatter.ForLog(messageType);         // text for a log line, never a key

  public static Type? Resolve(IMessageTypeBinder binder, string name) =>
    binder.Bind(name);                             // the shared resolver
}
```

In generators, use `TypeNameUtilities` (`SimpleName`, `MetadataNameOf`, `NamespaceOf`, `AssemblyOf`, `Display`, `FormatTypeNameForRuntime`, `BuildClrTypeName`).

When the read genuinely cannot go through a helper (an analyzer assembly that does not reference the generators' shared project, for example), suppress it with `[SuppressMessage]` and a `Justification` that says why. A suppression without one, or any `#pragma warning disable WHIZ606`, is [WHIZ607](whiz607.md).
{verified: TypeNameSourceAnalyzerTests.Runtime_ASuppressionThatSaysWhy_IsHonoredAsync, TypeNameSourceAnalyzerTests.Runtime_InsideANamingAuthority_IsNotReportedAsync}

## Related

- [Type Names in Library Code](../../../contributors/type-naming.md), which lists every helper, the authorities and the banned symbols
- [WHIZ607](whiz607.md), a suppression of this rule that does not say why
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
