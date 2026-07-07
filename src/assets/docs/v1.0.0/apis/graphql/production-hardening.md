---
title: Production Hardening
version: 1.0.0
category: API
order: 8
description: >-
  One-call production defaults for HotChocolate GraphQL services — disable
  introspection and strip exception details outside development, while keeping
  the full developer experience locally.
tags: 'graphql, security, introspection, hardening, production, errors'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateSecurityExtensions.cs
---

# GraphQL Production Hardening

`Whizbang.Transports.HotChocolate` provides a single opt-in call that applies production-safe GraphQL defaults:

```csharp{title="Production hardening" description="Demonstrates applying GraphQL security defaults" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Security"]}
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddWhizbangGraphQLSecurityDefaults(isProduction: !builder.Environment.IsDevelopment())
    .AddQueryType<Query>();
```

## What it does

When `isProduction` is `true`:

- **Introspection is disabled** — `__schema` / `__type` queries are rejected, so the schema is not enumerable by anonymous callers.
- **Exception details are stripped** — errors carry no stack traces or exception messages (`IncludeExceptionDetails = false`), preventing internal implementation details from leaking through the `errors` payload.

When `isProduction` is `false` the call is a **no-op**: local development keeps introspection (Banana Cake Pop, IDE tooling) and full exception details.

## Field suggestions

HotChocolate 15.x does not implement similar-name field suggestions ("Did you mean `userName`?") for unknown fields — an unknown-field error names only the field the client sent and the parent type. The Whizbang test suite pins this with a regression test so a future HotChocolate upgrade that introduces suggestion hints is caught at test time rather than in production.

## Why a boolean parameter instead of environment sniffing

The extension deliberately takes `isProduction` rather than reading `IHostEnvironment` itself: "production" for this purpose usually means *every deployed environment* (staging included), which only the host application can decide. Pass `!builder.Environment.IsDevelopment()` for the common case.

## See also

- [GraphQL Setup](setup.md) — base HotChocolate integration.
- [HTTP Security Headers & Method Filtering](../../fundamentals/security/http-security-headers.md) — transport-level response hardening for the same services.
