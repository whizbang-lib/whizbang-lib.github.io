---
title: 'WHIZ701: EF Core Perspective Discovery'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic in which the EF Core perspective configuration generator reports how many perspectives it found to
  configure in the EF Core model. It is a build-log notice, not a problem.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - ef-core
  - perspectives
  - model-builder
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ701: EF Core Perspective Discovery

**Severity**: Info
**Category**: EF Core / Model Configuration

## Description

The EF Core perspective configuration generator builds the `ModelBuilder` extension that maps every perspective's
table into your EF Core model. Each time it runs, it reports WHIZ701 with the number of perspectives it found. Use it
to confirm the generator saw the perspectives you expect.

- It is reported once per compilation that references the generator, including when the count is zero. It is not
  reported when compiling the `Whizbang.Data.EFCore.Postgres` library itself.
- A perspective is any class that implements an `IPerspectiveFor<TModel, ...>` interface; the model is its first type
  argument.
- The count is taken **before** perspectives that share a model type are collapsed, so two perspectives over the same
  model count as two.
- Perspectives rejected because a generated table, column or index name is too long for the database
  ([WHIZ820, WHIZ821, WHIZ822](error-reference)), or whose `[PerspectiveTable]` name is invalid
  ([WHIZ824](whiz824)), are not counted.
- The diagnostic has no source location.

The descriptor is declared inline in the generator, not in the shared descriptor list.

## Diagnostic Message

```
Discovered {Count} perspective(s) for EF Core ModelBuilder configuration
```

## What Produces It

Any project that references the EF Core Postgres generators. With one perspective such as the following, the notice
reads `Discovered 1 perspective(s) for EF Core ModelBuilder configuration`:

```csharp{
title: "One perspective, counted by WHIZ701"
description: "A class implementing IPerspectiveFor is discovered and counted by the EF Core configuration generator."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz701", "ef-core", "perspectives", "discovery"]
unverified: "no test asserts WHIZ701; illustration of a discovered perspective"
}
public record OrderModel {
  [StreamId]
  public Guid Id { get; init; }
}

public class OrderPerspective : IPerspectiveFor<OrderModel, OrderCreatedEvent> {
  public OrderModel Apply(OrderModel currentData, OrderCreatedEvent @event) {
    return currentData;
  }
}
```

If the count is lower than you expect, check that each perspective class implements `IPerspectiveFor<...>` and look
for WHIZ820 to WHIZ822 and WHIZ824 errors in the same build.

## Suppressing

Suppressing is always safe: it hides the notice and changes nothing about what is generated. The diagnostic has no
source location, so `#pragma warning disable WHIZ701` has no effect; set the severity in a global analyzer config
file:

```ini{
title: "Silence WHIZ701 in a global analyzer config"
description: "Sets the WHIZ701 severity to none for the whole project."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz701", "suppression", "globalconfig"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ701.severity = none
```

## Related

- [WHIZ702: EF Core migration files discovery](whiz702)
- [WHIZ703: No DbContext found](whiz703)
- [WHIZ807: Physical fields discovered](whiz807)
- [EF Core Integration](../../data/efcore-integration)
- [Perspectives](../../fundamentals/perspectives/perspectives)
