---
title: HTTP Security Headers & Method Filtering
pageType: concept
version: 1.0.0
category: Security
order: 10
description: >-
  Turnkey ASP.NET Core middleware that applies hardened HTTP response headers
  (HSTS, X-Frame-Options, CSP frame-ancestors, nosniff, Referrer-Policy,
  Permissions-Policy) and can reject unexpected HTTP methods with 405.
tags: 'security, headers, hsts, clickjacking, middleware, http, hardening'
codeReferences:
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersOptions.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersMiddleware.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersMiddlewareExtensions.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersStartupFilter.cs
  - src/Whizbang.Hosting.AspNet/WhizbangKestrelExtensions.cs
---

# HTTP Security Headers & Method Filtering

`Whizbang.Hosting.AspNet` hardens every HTTP response a service emits — REST (FastEndpoints), GraphQL (HotChocolate), health probes, and framework-generated errors (401/404/405) alike.

It is **turnkey**: `AddWhizbangAspNet()` auto-wires the middleware via an `IStartupFilter` (the same mechanism as correlation capture), so a service gets the hardened headers with no explicit pipeline call — and picks them up automatically on a framework upgrade.

```csharp{title="Turnkey security headers" description="Demonstrates the automatic wiring" category="Security" difficulty="BEGINNER" tags=["Security", "Headers", "Middleware"]}
// Program.cs — nothing to add; AddWhizbangAspNet() wires the headers for you.
builder.Services.AddWhizbangAspNet();
```

This is safe to auto-enable because the headers are **idempotent** (an edge-set header is never overwritten), HSTS is emitted only over TLS/forwarded-TLS, and **method filtering is off by default** (see below). A service that manages its own headers can opt out with `Enabled = false`.

You can still call `UseWhizbangSecurityHeaders(...)` explicitly if you need to control the exact pipeline position, but it is not required.

## Default headers

| Header | Default value |
|--------|---------------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` — **only on HTTPS requests** (or `X-Forwarded-Proto: https`) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Every value is overridable (set to `null` to suppress a header entirely). Configure the turnkey middleware through options:

```csharp{title="Customize headers" description="Demonstrates overriding header defaults" category="Security" difficulty="INTERMEDIATE" tags=["Security", "Headers", "Options"]}
builder.Services.Configure<WhizbangSecurityHeadersOptions>(options => {
  options.ContentSecurityPolicy = "frame-ancestors 'self'";
  options.PermissionsPolicy = null;              // don't emit
  // Opt in to method filtering (off by default) — reject anything outside this list with 405:
  options.AllowedMethods.Add("GET");
  options.AllowedMethods.Add("HEAD");
  options.AllowedMethods.Add("POST");
  options.AllowedMethods.Add("OPTIONS");
});
```

## Behavior guarantees

- **Idempotent** — a header already present on the response (for example, set by an edge proxy such as Azure Front Door or Application Gateway) is **never overwritten**. The edge wins; the middleware only fills gaps. Origin + edge = defense-in-depth.
- **HSTS is TLS-aware** — pods typically listen on plain HTTP behind a TLS-terminating edge. HSTS is emitted only when `Request.IsHttps` is true **or** the request carries `X-Forwarded-Proto: https`. Emitting HSTS on plain HTTP is meaningless and can mask misconfiguration.
- **Method filtering (opt-in)** — `AllowedMethods` is **empty by default**, so every verb passes. This keeps the turnkey wiring safe: auto-enabling a `GET, HEAD, POST, OPTIONS` allowlist would 405 every service that legitimately serves PUT/PATCH/DELETE. Populate `AllowedMethods` on a service that should reject other verbs at the origin — then requests outside the list are short-circuited with **405 Method Not Allowed** and an `Allow` header before routing.
- **Opt-out** — set `Enabled = false` to make the middleware a transparent pass-through (no headers, no filtering) for a service that manages its own response headers.
- **Reflection-free / AOT-safe** — headers are applied via `HttpResponse.OnStarting`; no reflection, no dynamic types (Whizbang Key Principles 1–2).

## Suppressing the Kestrel `Server` header

Response header hardening usually pairs with removing the `Server: Kestrel` banner. Use the Kestrel helper:

```csharp{title="Suppress Server header" description="Demonstrates removing the Server response header" category="Security" difficulty="BEGINNER" tags=["Security", "Kestrel", "Server"]}
builder.WebHost.UseWhizbangKestrelSecurityDefaults();   // sets AddServerHeader = false
```

## When to use

Nothing to enable — any service calling `AddWhizbangAspNet()` gets the headers automatically. If an edge layer already injects these headers, the turnkey middleware still adds value: the idempotence guarantee means the origin only covers responses the edge misses (direct pod access, internal calls, edge misconfiguration). Opt out per service with `Enabled = false`, and opt **in** to method filtering by populating `AllowedMethods`.

## See also

- [GraphQL Production Hardening](../../apis/graphql/production-hardening.md) — introspection and error-detail hardening for HotChocolate services.
