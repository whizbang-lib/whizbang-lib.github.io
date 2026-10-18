---
title: 'WHIZ150: Minted composite constructed outside the mint'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a composite event type (a CompositeEventBase subclass) is constructed directly instead of
  inside a composite-factory builder, bypassing the grouping, count and size limits the mint enforces.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - composite-events
  - minting
  - messaging
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/MintedCompositeConstructionAnalyzer.cs
  - src/Whizbang.Core/Minting/CompositeEventBase.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/MintedCompositeConstructionAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ150: Minted composite constructed outside the mint

**Severity**: Warning
**Category**: Minting

## Description

A [composite event](../../fundamentals/messaging/composite-events) bundles several events into one message on the
wire. Composite types derive from `CompositeEventBase`: the built-in `RedeliveryComposite`, `CoalescedEventsComposite`
and `AuditEventsComposite`, and any composite you define yourself.

Composites are meant to be built by the mint. When the mint plans composites it splits the input so that each composite
goes to one destination (same group key, same destination), stays under a sender-side count cap, and stays within a
byte budget. A composite created with `new` anywhere else skips all of that, so it can mix destinations, exceed the
broker's message-size limit, or exceed the receiver's expansion cap.

WHIZ150 is reported on any object creation (`new T { ... }` or target-typed `new()`) of a type that derives from
`CompositeEventBase`, except when the creation is:

1. inside a lambda assigned to `CompositeMintRequest<T>.BuildComposite` (the request you pass to the composite factory
   reached through `IEventMint.Composites`),
2. inside a lambda assigned to `CoalescePolicyOptions.CompositeFactory` (a coalesce binding's factory),
3. in code whose namespace is `Whizbang.Core.Minting` or below it, or
4. in the `Whizbang.Core` assembly itself.

The lambda exemption covers both object-initializer assignment and plain assignment, and a helper lambda nested inside
one of those builders. A lambda passed some other way, for example as a method argument, is not exempt.

## Diagnostic Message

```
'{CompositeTypeName}' is a minted composite — construct it inside a composite-factory builder (CompositeMintRequest<T>.BuildComposite via IEventMint.Composites, or a coalesce binding's CompositeFactory) so the mint enforces grouping, count caps, and byte budgets
```

## Common Causes

1. **Building a composite by hand** to bundle a batch of events before sending.
2. **Repair or redelivery code** creating a `RedeliveryComposite` directly.
3. **A builder lambda stored in a variable or passed to a helper** rather than assigned to `BuildComposite` or
   `CompositeFactory`, so the analyzer cannot see that it is a factory builder.
4. **Test fixtures** that construct composites to exercise a receiver.

## How to Fix

Move the construction into a composite-factory builder so the mint calls it once per planned composite.

### Before (causes WHIZ150)

```csharp{title="Composite constructed directly" description="A consumer-defined CompositeEventBase subclass created with new in application code reports WHIZ150." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["composite-events", "minting", "WHIZ150"] testFile="MintedCompositeConstructionAnalyzerTests.cs" testMethod="ConsumerCompositeSubclass_ConstructedDirectly_ReportsWhiz150Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/MintedCompositeConstructionAnalyzerTests.cs" tests=["MintedCompositeConstructionAnalyzerTests.ConsumerCompositeSubclass_ConstructedDirectly_ReportsWhiz150Async"]}
using System.Collections.Generic;
using Whizbang.Core;
using Whizbang.Core.Minting;

namespace ConsumerApp;

public sealed class OrderBulkImportComposite : CompositeEventBase;

public class ImportHandler {
  public IMessage Bundle(List<IMessage> events) {
    return new OrderBulkImportComposite { Inner = events };  // WHIZ150
  }
}
```

### After (no diagnostic)

```csharp{title="Composite built inside BuildComposite" description="The composite is created in the BuildComposite lambda of a CompositeMintRequest, so the mint plans the split and WHIZ150 is not reported." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["composite-events", "minting", "WHIZ150"] testFile="MintedCompositeConstructionAnalyzerTests.cs" testMethod="Construction_InsideMintRequestBuilder_IsSilentAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/MintedCompositeConstructionAnalyzerTests.cs" tests=["MintedCompositeConstructionAnalyzerTests.Construction_InsideMintRequestBuilder_IsSilentAsync"]}
using System.Linq;
using Whizbang.Core;
using Whizbang.Core.Minting;

namespace ConsumerApp;

public sealed class DigestComposite : CompositeEventBase;

public class DigestShipper {
  public object Plan(ICompositeFactory factory, System.Collections.Generic.List<IMessage> events) {
    return factory.Create(new CompositeMintRequest<IMessage> {
      Constituents = events,
      GroupKey = CompositeGroupKey.FromKey<IMessage>(_ => "digest"),
      BuildComposite = batch => new DigestComposite { Inner = [.. batch.Constituents] },
    });
  }
}
```

A coalesce binding's factory is also a sanctioned place:

```csharp{title="Composite built inside a coalesce CompositeFactory" description="Construction inside the lambda assigned to CoalescePolicyOptions.CompositeFactory is exempt." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["composite-events", "coalescing", "WHIZ150"] testFile="MintedCompositeConstructionAnalyzerTests.cs" testMethod="Construction_InsideCoalesceBindingFactory_IsSilentAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/MintedCompositeConstructionAnalyzerTests.cs" tests=["MintedCompositeConstructionAnalyzerTests.Construction_InsideCoalesceBindingFactory_IsSilentAsync"]}
using System.Linq;
using Whizbang.Core.Minting;
using Whizbang.Core.Tags;

public class BindingSetup {
  public void Configure(CoalescePolicyOptions binding) {
    binding.CompositeFactory = batch => new CoalescedEventsComposite {
      InnerEventIds = [.. batch.Singles.Select(s => s.MessageId)],
    };
  }
}
```

## Suppressing

```csharp{title="Suppress WHIZ150 for one construction" description="Disables WHIZ150 around a deliberate direct construction." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ150"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ150
var composite = new RedeliveryComposite { StreamId = streamId };
#pragma warning restore WHIZ150
```

```ini{title="Disable WHIZ150 in .editorconfig" description="Turns WHIZ150 off for every C# file the section matches, for example in a test project." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ150"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ150.severity = none
```

Suppressing is appropriate in test projects, whose fixtures build composites directly on purpose (the analyzer's own
documentation names `NoWarn` in test projects as the intended approach). In application code, suppress only when you
are certain the composite holds events for a single destination and is well within the size limits; otherwise route it
through the mint.

## Related

- [Composite events](../../fundamentals/messaging/composite-events)
