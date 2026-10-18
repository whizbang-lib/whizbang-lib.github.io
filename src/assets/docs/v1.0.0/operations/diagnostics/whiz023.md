---
title: 'WHIZ023: Enum Filter No Description'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational descriptor for an enum-based topic filter whose enum member has no [Description], so the member name is
  used as the filter. It is defined but not reported by the current generator; the fallback happens silently.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - topic-filters
  - enums
  - description-attribute
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/TopicFilterGenerator.cs
  - src/Whizbang.Core/TopicFilterAttribute{TEnum}.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ023: Enum Filter No Description

**Severity**: Info
**Category**: Source Generation / Topic Filters

## Description

With `[TopicFilter<TEnum>(TEnum.Member)]`, the topic filter string normally comes from the enum member's
`[Description("...")]` attribute. When the member has no `[Description]`, the generator falls back to the **member
name** (for example `Payments`). WHIZ023 is defined to tell you that this fallback happened, because a member name is
rarely the topic string a transport expects.

**Current behavior**: the `TopicFilterGenerator` does not report WHIZ023. The fallback to the member name happens
silently, and no test asserts the WHIZ023 ID. The fallback itself is tested: the registry contains the member name.
You can still see the resulting string in the [WHIZ022](whiz022) notice for that filter.

One further case is also silent: an enum value that matches no declared member (such as a combination of `[Flags]`
values) is used as its numeric value.

## Diagnostic Message

```
Enum value '{EnumName}.{MemberName}' has no [Description] attribute. Using enum symbol name '{MemberName}' as filter.
```

## Common Causes

1. **An enum member without `[Description]`** used in `[TopicFilter<TEnum>(...)]`.
2. **A new member added** to a topics enum without copying the `[Description]` pattern of its neighbors.

## How to Fix

Add `[Description("...")]` to the enum member with the topic string you want. If the member name is the string you
want, nothing needs to change.

### Before (falls back to the member name)

```csharp{title="Enum topic filter without Description" description="The Payments member has no Description, so the generated registry uses the string Payments as the filter." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "enums"] unverified="WHIZ023 is never reported; the silent fallback is checked by TopicFilterGeneratorTests.Generator_WithEnumFilterNoDescription_UsesSymbolNameAsync"}
using Whizbang.Core;

namespace TestNamespace;

public enum Topics {
  Payments,  // No Description attribute: filter becomes "Payments"
  Orders
}

[TopicFilter<Topics>(Topics.Payments)]
public record ProcessPaymentCommand : ICommand {
}
```

### After (uses the Description)

```csharp{title="Enum topic filter with Description" description="The member's Description value becomes the filter string in the generated registry." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "topic-filters", "enums", "description-attribute"] unverified="WHIZ023 is never reported; Description extraction is checked by TopicFilterGeneratorTests.Generator_WithEnumFilter_ExtractsDescriptionAsync"}
using System.ComponentModel;
using Whizbang.Core;

namespace TestNamespace;

public enum Topics {
  [Description("orders.created")]
  OrdersCreated,

  [Description("orders.updated")]
  OrdersUpdated
}

[TopicFilter<Topics>(Topics.OrdersCreated)]
public record CreateOrderCommand : ICommand {
}
```

## Suppressing

There is nothing to suppress while the generator does not report it. If a future version starts reporting it, the
usual severity setting would apply:

```ini{title="Silence WHIZ023 project-wide" description="A global analyzer config that would turn off the WHIZ023 notice." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ023.severity = none
```

Using member names as topic strings on purpose is a legitimate choice, in which case silencing it would be appropriate.

## Related

- [Topic Filters: Enum-Based Filters](../../messaging/topic-filters#enum-based-filters)
- [Topic Filter Discovery](../../extending/source-generators/topic-filter-discovery)
- [WHIZ022: Topic Filter Discovered](whiz022)
- [WHIZ025: TopicFilter On Non-Command](whiz025)
