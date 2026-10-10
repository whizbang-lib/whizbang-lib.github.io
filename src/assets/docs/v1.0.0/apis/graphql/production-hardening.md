---
title: Production Hardening
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: API
order: 8
description: >-
  One-call defaults for HotChocolate GraphQL services: a query depth limit in
  every environment, and outside development no introspection and no exception
  details in errors.
tags: 'graphql, security, introspection, hardening, production, errors, depth'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateSecurityExtensions.cs
testReferences:
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/HotChocolateSecurityExtensionsTests.cs
---

# GraphQL Production Hardening

`Whizbang.Transports.HotChocolate` provides a single opt-in call that applies production-safe GraphQL defaults:

```csharp{title="Production hardening" description="Demonstrates applying GraphQL security defaults" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Security"] tests=["HotChocolateSecurityExtensionsTests.Production_RejectsIntrospectionQueryAsync", "HotChocolateSecurityExtensionsTests.Production_StripsExceptionDetailsFromErrorsAsync"]}
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddWhizbangGraphQLSecurityDefaults(isProduction: !builder.Environment.IsDevelopment())
    .AddQueryType<Query>();
```

## What it does

In every environment:

- **Query depth is limited** to 15 levels by default. Each level multiplies resolver work, and HotChocolate bounds cost and execution time by default but not depth. The limit is the same in development, so a query development accepts is never one production refuses. Introspection fields are not counted, so tooling keeps working. Set another limit with `maxExecutionDepth`. {verified: HotChocolateSecurityExtensionsTests.AQueryDeeperThanTheLimit_IsRejectedBeforeItRunsAsync, HotChocolateSecurityExtensionsTests.AQueryAtTheLimit_RunsAsync, HotChocolateSecurityExtensionsTests.TheDepthLimit_CanBeSetByTheHostAsync, HotChocolateSecurityExtensionsTests.Introspection_IsNotCountedAgainstTheDepthLimitInDevelopmentAsync}

```csharp{title="Setting the depth limit" description="A host whose lenses nest deeper than the default raises the limit" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Security"] tests=["HotChocolateSecurityExtensionsTests.TheDepthLimit_CanBeSetByTheHostAsync"]}
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddWhizbangGraphQLSecurityDefaults(isProduction: !builder.Environment.IsDevelopment(), maxExecutionDepth: 20);
```

HotChocolate's own defaults already enforce cost limits and a 30 second execution timeout; the call leaves them as they are.

When `isProduction` is `true`, also:

- **Introspection is disabled** — `__schema` / `__type` queries are rejected, so the schema is not enumerable by anonymous callers.
- **Exception details are stripped** — errors carry no stack traces or exception messages (`IncludeExceptionDetails = false`), preventing internal implementation details from leaking through the `errors` payload.

When `isProduction` is `false`, local development keeps introspection (Banana Cake Pop, IDE tooling) and full exception details; only the depth limit applies.

## Field suggestions

HotChocolate 15.x does not implement similar-name field suggestions ("Did you mean `userName`?") for unknown fields — an unknown-field error names only the field the client sent and the parent type. The Whizbang test suite pins this with a regression test so a future HotChocolate upgrade that introduces suggestion hints is caught at test time rather than in production.

## Why a boolean parameter instead of environment sniffing

The extension deliberately takes `isProduction` rather than reading `IHostEnvironment` itself: "production" for this purpose usually means *every deployed environment* (staging included), which only the host application can decide. Pass `!builder.Environment.IsDevelopment()` for the common case.

## See also

- [GraphQL Setup](setup.md) — base HotChocolate integration.
- [HTTP Security Headers & Method Filtering](../../fundamentals/security/http-security-headers.md) — transport-level response hardening for the same services.
