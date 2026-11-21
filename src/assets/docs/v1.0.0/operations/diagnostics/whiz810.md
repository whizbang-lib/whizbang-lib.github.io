---
title: 'WHIZ810: Perspective Model Contained a Dictionary Property (retired)'
pageType: troubleshooting
verifiedAgainstCommit: d5bc1d709
verifiedDate: 2026-11-20
description: >-
  Retired. WHIZ810 warned that a perspective model held a dictionary the mapped JSON document could not store.
  Dictionaries are now stored as arrays of key/value objects, so nothing reports it; the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - dictionary
  - ef-core
  - analyzer
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/DictionaryMemberForms.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryMemberStorageTests.cs
lastMaintainedCommit: 'd5bc1d709'
---

# WHIZ810: Perspective Model Contained a Dictionary Property (retired)

**Status**: Retired in [#1911](https://github.com/whizbang-lib/whizbang/issues/1911). No longer reported.
**Former severity**: Warning

## Retired

WHIZ810 is **retired**. Its analyzer and descriptor have been removed from the Entity Framework generator
package, because the model it warned about now works: a dictionary on a perspective model is stored as an
array of key/value objects, read back and queried with no attribute and no rewrite. See
[Dictionary Members](../../fundamentals/perspectives/dictionary-members.md).

The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for it can never
match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).
{verified: DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync, DictionaryMemberStorageTests.WhatEntityFrameworkWrote_ReadsBackAsync}

## What It Described

WHIZ810 was a warning on a property of a perspective model, or of an object or collection element the model
held, whose type was `Dictionary<TKey, TValue>`, `IDictionary<TKey, TValue>` or
`IReadOnlyDictionary<TKey, TValue>`. Entity Framework's `ComplexProperty().ToJson()` mapping took such a
property for a navigation and refused the model. A top-level `[PhysicalField]` stored in its own jsonb column
was not reported, since it was kept out of the mapped document.

The message it showed:

```text
Property '{PropertyName}' on perspective model '{DeclaringType}' uses Dictionary<{KeyType}, {ValueType}> which is not supported by EF Core's ComplexProperty().ToJson(). Use a List of a class with Key ({KeyType}) and Value ({ValueType}) properties instead.
```

## Why There Is No Rule

The warning asked the author to work around a mapping limit: replace the dictionary with a list of a
key/value class, or promote it to a jsonb column. The framework now does that itself, for every dictionary at
any depth, with one stored form shared by Entity Framework and the atomic upsert, and translates `ContainsKey`
and the indexer to SQL. There is nothing left to warn about.

Other dictionary types are still not handled: `SortedDictionary`, `ImmutableDictionary`,
`ConcurrentDictionary` and custom dictionary types. Entity Framework refuses them in a mapped document in its
own words when the model is built, naming the member; see
[what is not supported](../../fundamentals/perspectives/dictionary-members.md#not-supported).

## If You Worked Around It

- **Remove the suppression.** Delete any `#pragma warning disable WHIZ810` / `#pragma warning restore WHIZ810`
  lines, any `dotnet_diagnostic.WHIZ810.severity` entry in `.editorconfig` or a `.globalconfig`, and WHIZ810 from
  any `<NoWarn>` list.
- **A model rewritten to satisfy it can go back to a plain dictionary.** A list of key/value objects, or a
  dictionary split out with `[PerspectiveStorage(FieldStorageMode.Split)]` and `[PhysicalField]` only to get
  past the warning, can be declared as a dictionary again. That is a model change of its own; if the member's
  stored name changes, declare it with `[StoredForm(PreviousName = ...)]`. See
  [upgrading](../../fundamentals/perspectives/dictionary-members.md#upgrading).
- **SQL you own over a dictionary** (a query, a view, an index) must read the new stored form, an array of
  pairs, after the first start of this release. See
  [upgrading](../../fundamentals/perspectives/dictionary-members.md#upgrading).

## Related

- [Dictionary Members](../../fundamentals/perspectives/dictionary-members.md)
- [Physical Fields: jsonb columns](../../fundamentals/perspectives/physical-fields#jsonb-columns)
- [WHIZ811: Perspective Model Contains Polymorphic Type](whiz811)
- [WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted](whiz812)
