---
title: 'WHIZ023: Enum Filter No Description (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ023 (Enum Filter No Description) was declared but never reported. It is removed from the generator
  package and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - topic-filters
  - enums
  - description-attribute
  - source-generator
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ023: Enum Filter No Description (retired)

**Status**: Retired. Never reported.
**Former severity**: Info

## Retired

WHIZ023 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ023 was declared to say that an enum-based topic filter, `[TopicFilter<TEnum>(TEnum.Member)]`, used the member
name because the member has no `[Description]`. The `TopicFilterGenerator` never reported it.

The message it would have shown:

```text
Enum value '{EnumName}.{MemberName}' has no [Description] attribute. Using enum symbol name '{MemberName}' as filter.
```

## Why There Is No Rule

Falling back to the member name is documented behavior, and using member names as topic strings is a legitimate
choice, so a notice for every such filter would be noise. The filter string the generator actually used is already
visible in the [WHIZ022](whiz022) notice for each filter, reported at its attribute.

To get a different topic string, add `[Description("...")]` to the enum member (see
[Topic Filters: Enum-Based Filters](../../messaging/topic-filters#enum-based-filters)).

## If You Suppress It

A suppression of WHIZ023 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ023` /
`#pragma warning restore WHIZ023` lines, any `dotnet_diagnostic.WHIZ023.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ023 from any `<NoWarn>` list.

## Related

- [Topic Filters: Enum-Based Filters](../../messaging/topic-filters#enum-based-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
- [WHIZ022: Topic Filter Discovered](whiz022)
- [WHIZ025: TopicFilter On Non-Command](whiz025)
