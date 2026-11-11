---
title: Type Names in Library Code
pageType: reference
audience: [contributor]
status: current
order: 6
description: Every type name the Whizbang library reads comes from the shared naming code. Which helper gives which form, how the naming authorities are marked, what the banned-symbol list forbids, and how WHIZ606 and WHIZ607 enforce it at build time.
tags: contributing, analyzers, type-names, naming, banned-symbols, whiz606, whiz607
codeReferences:
  - src/Whizbang.Core/TypeNameFormatter.cs
  - src/Whizbang.Core/Messaging/EventTypeMatchingHelper.cs
  - src/Whizbang.Core/TypeFormatter.cs
  - src/Whizbang.Core/Messaging/MultiPassMessageTypeBinder.cs
  - src/Whizbang.Core/TypeNameAuthorityAttribute.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameAuthorityAttribute.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
  - src/Whizbang.Core/Messaging/CompositeChildIdentity.cs
  - tools/Whizbang.RepoAnalyzers/TypeNameSourceAnalyzer.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/TypeNameSourceAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/TypeNameWireFormTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/TypeNameUtilitiesNamingTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeChildIdentityCanonicalTests.cs
---

# Type Names in Library Code

A type name in Whizbang is a key. It names a perspective's table, a message's route, a composite child's id and a
priority rule. Every place that renders a name its own way is a place where two services, or two builds of one
contract assembly, can disagree. A composite child once derived three different ids on three paths because each
path rendered its type differently, so stream digests disagreed while nothing was missing.

So the library reads type names from one place, the shared naming code, and the build fails anywhere else. This is
[gravity](gravity.md) applied to naming: the easy call is the right one, and the wrong one does not compile.

## Which helper for which form {#which-helper}

| You need | Runtime code | Generators |
|---|---|---|
| A cross-service key: storage, routing, hashing, matching (`Namespace.Type, Assembly`, version-free at every depth) | `TypeNameFormatter.Format(type)`; `FormatOrDisplay(type)` for a type that may have no full name | `TypeNameUtilities.FormatTypeNameForRuntime` |
| A CLR key without the assembly (`Namespace.Outer+Inner`) | `TypeNameFormatter.FormatClrTypeName(type)`, `TryFormatClrTypeName` | `TypeNameUtilities.BuildClrTypeName` |
| A stored or received name compared with a key | `EventTypeMatchingHelper.NormalizeTypeName(name)` on the received side, then ordinal equality | |
| Text for a log line, exception, trace or metric tag | `TypeNameFormatter.ForLog(type)` (the simple name, as messages have always printed it), or `DisplayName(type)` for the full name | `TypeNameUtilities.SimpleName(symbol)` |
| The simple name as a local key (a handler name, a collection name) | `TypeNameFormatter.SimpleName(type)` | `TypeNameUtilities.SimpleName(symbol)`, `MetadataNameOf(symbol)` |
| A namespace | `TypeNameFormatter.NamespaceOf(type)` | `TypeNameUtilities.NamespaceOf(symbol)`, `IsSystemNamespace(ns)` |
| An assembly's simple name or version | `TypeNameFormatter.AssemblySimpleName(assembly)`, `AssemblyVersion(assembly)`, `AssemblyIdentity(assembly)` | `TypeNameUtilities.AssemblyOf(symbol)`, `AssemblyIdentityVersion(assembly)`, `AssemblySimpleName(assembly)` |
| A flags-controlled rendering (namespace, assembly, version, culture, token) | `TypeFormatter.FormatType(type, qualifications)` | |
| A type from a name a publisher wrote | `IMessageTypeBinder` (`MultiPassMessageTypeBinder`), or `EventTypeMatchingHelper.TryResolveType` over a lookup of candidate types | |
| A composite child's id | `CompositeChildIdentity.ForChild(compositeId, ordinal, type)` or `ForChild(compositeId, ordinal, wireName)` | |
| A symbol in a caller's display format | | `TypeNameUtilities.Display(symbol, format)` |

{verified: TypeNameWireFormTests.Format_CarriesNoVersionAtAnyDepthAsync, TypeNameWireFormTests.Format_IsWhatTheStringNormalizerMakesOfEveryRenderingAsync, TypeNameWireFormTests.Parse_DelegatesToTheNormalizer_ForEveryRenderingAsync, TypeNameWireFormTests.SimpleNames_AreTheTypesOwnAsync, TypeNameUtilitiesNamingTests.SymbolRoutes_ReadTheSymbolsOwnNamesAsync, TypeNameUtilitiesNamingTests.IsSystemNamespace_IsTheRootSystemNamespaceOnlyAsync, TypeNameUtilitiesNamingTests.RuntimeRoutes_ReadTheTypeAndAssemblyNamesAsync, CompositeChildIdentityCanonicalTests.ForChild_TheTypeAndEveryRenderingOfItsName_DeriveOneIdAsync}

Every rendering these helpers return is the one the call site printed before it moved to them, so moving a call
changes no log line and no key. `Format` is the exception the rule was written for: it is now version-free at every
depth, so a generic type's name no longer carries its type arguments' assembly versions and equals what the string
normalizer makes of any rendering of it.

### The versioned forms {#versioned-forms}

`TypeNameFormatter.AssemblyQualifiedName`, `AssemblyQualifiedNameOrNull` and `AssemblyQualifiedNameOrDisplay` keep the
version decoration, which differs between builds of one assembly. They are banned. The remaining uses are the
envelope and message type names a receiver resolves a type from, each with a commented suppression at that line
saying so:

```csharp{title="A versioned name kept on purpose" description="The one legitimate use of the versioned form: the message type a receiver resolves the payload from, suppressed with its reason at the line." framework="NET10" category="Design" difficulty="ADVANCED" tags=["type-names", "banned-symbols", "envelope", "suppression"] unverified="excerpt of library source (Dispatcher.cs); the ban itself is verified by CompositeChildIdentityCanonicalTests.TheBanList_ForbidsTheRawDerivation_AndTheVersionedTypeNamesAsync"}
#pragma warning disable RS0030 // versioned on purpose: the message type a receiver resolves the payload from (#2267)
      MessageType = TypeNameFormatter.AssemblyQualifiedName(eventType),
#pragma warning restore RS0030
```

## The naming authorities {#type-name-authority}

The shared naming code is the set of classes marked `[TypeNameAuthority]`:

| Class | Assembly | Role |
|---|---|---|
| `TypeNameFormatter` | `Whizbang.Core` | Keys, display text, namespaces and assembly names |
| `EventTypeMatchingHelper` | `Whizbang.Core` | The string normalizer and matching over stored names |
| `TypeFormatter` | `Whizbang.Core` | The `TypeQualifications` flag renderings |
| `MultiPassMessageTypeBinder` | `Whizbang.Core` | Resolving a type from a name |
| `TypeNameUtilities` | `Whizbang.Generators.Shared` | Every symbol name the generators read |

`TypeNameAuthorityAttribute` is internal and applies to classes. The analyzer matches it by name, so the generators'
shared project carries its own copy. Code nested inside an authority is part of it. Add a class to this set only when
it is a renderer or a resolver in its own right; a class that merely needs a name calls one of these.
{verified: TypeNameSourceAnalyzerTests.Runtime_InsideANamingAuthority_IsNotReportedAsync, TypeNameSourceAnalyzerTests.Generator_InsideANamingAuthority_IsNotReportedAsync}

## What the build enforces {#enforcement}

Two layers fail a library build that reads a name another way.

**WHIZ606 and WHIZ607** come from `TypeNameSourceAnalyzer` in `Whizbang.RepoAnalyzers`.
[WHIZ606](../v1.0.0/operations/diagnostics/whiz606.md) reports a type, namespace or assembly name read, or a type
resolved from a string, outside an authority. [WHIZ607](../v1.0.0/operations/diagnostics/whiz607.md) reports a
suppression of WHIZ606 that does not say why. Both apply to projects under `src/` only:
`Directory.Build.props` gives every project outside `src/` the `TypeNaming.OutsideLibrary.globalconfig`, which turns
them off, because tests, tools, samples and benchmarks name types to describe them.

**`BannedSymbols.txt`** is the backstop, read by the banned-API analyzer (`RS0030`). Its type-naming entries:

| Banned | Use instead |
|---|---|
| `Type.FullName` | `TypeNameFormatter.DisplayName`, `FormatClrTypeName` or `Format` |
| `Type.AssemblyQualifiedName` | `TypeNameFormatter.Format`; compare persisted names through `EventTypeMatchingHelper` |
| `Assembly.FullName` | `TypeNameFormatter.AssemblyDisplayName` |
| `TypeNameFormatter.AssemblyQualifiedName`, `AssemblyQualifiedNameOrNull`, `AssemblyQualifiedNameOrDisplay` | `TypeNameFormatter.Format` (`TryFormatClrTypeName` for a type that may have no name, `DisplayName` for a log) |
| `CompositeChildIdentity.Derive` | `CompositeChildIdentity.ForChild` |
| `Type.Namespace` | `TypeNameFormatter.NamespaceOf` |
| `Assembly.GetName()`, `Assembly.GetName(bool)` | `TypeNameFormatter.AssemblySimpleName`, `AssemblyVersion` or `AssemblyIdentity` |
| `AssemblyName.Name` | `TypeNameFormatter.AssemblySimpleName` |
| `Type.GetType(string, ...)`, `Assembly.GetType(string, ...)` (each overload) | `IMessageTypeBinder` (`MultiPassMessageTypeBinder`) or `EventTypeMatchingHelper.TryResolveType` |

{verified: CompositeChildIdentityCanonicalTests.TheBanList_ForbidsTheRawDerivation_AndTheVersionedTypeNamesAsync}

## Making an exception {#making-an-exception}

An exception is made where it is used, with its reason, and only through `[SuppressMessage]` with a non-empty
`Justification`. A `#pragma warning disable WHIZ606` cannot carry a reason, so WHIZ607 reports every one:

```csharp{title="A WHIZ606 exception that says why" description="The only accepted way out of WHIZ606: a SuppressMessage attribute whose Justification records the reason." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz606", "whiz607", "suppression", "type-names"] tests=["TypeNameSourceAnalyzerTests.Runtime_ASuppressionThatSaysWhy_IsHonoredAsync", "TypeNameSourceAnalyzerTests.Suppression_WithoutAJustification_IsReportedAsync", "TypeNameSourceAnalyzerTests.Pragma_ThatHidesTheRule_IsReportedAsync"]}
[System.Diagnostics.CodeAnalysis.SuppressMessage(
  "Naming", "WHIZ606:A type name is read outside the shared naming code",
  Justification = "A test-code analyzer, which does not reference the generator naming helpers; the type is named only in the diagnostic message it reports (#2267)")]
private static void _report(SymbolAnalysisContext context, INamedTypeSymbol type) {
  // ...
}
```

Prefer moving the read into a helper over suppressing it. A suppression is for code that cannot reference the
helpers, such as an analyzer assembly that does not reference the generators' shared project.

## Related

- [WHIZ606](../v1.0.0/operations/diagnostics/whiz606.md) and [WHIZ607](../v1.0.0/operations/diagnostics/whiz607.md)
- [Repository Checks and Diagnostic IDs](repository-checks.md)
- [TypeFormatter and TypeNameFormatter](../v1.0.0/fundamentals/identity/type-formatting.md)
- [Normalizing type names](../v1.0.0/operations/infrastructure/migrations.md#normalizing-type-names)
- [Deterministic child ids](../v1.0.0/fundamentals/messaging/composite-events.md#deterministic-child-ids)
