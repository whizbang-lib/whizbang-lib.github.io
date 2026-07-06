---
title: HTTP Security Headers & Method Filtering
version: 1.0.0
category: Security
order: 10
description: >-
  Opt-in ASP.NET Core middleware that applies hardened HTTP response headers
  (HSTS, X-Frame-Options, CSP frame-ancestors, nosniff, Referrer-Policy,
  Permissions-Policy) and rejects unexpected HTTP methods with 405.
tags: 'security, headers, hsts, clickjacking, middleware, http, hardening'
codeReferences:
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersOptions.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersMiddleware.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersMiddlewareExtensions.cs
  - src/Whizbang.Hosting.AspNet/WhizbangKestrelExtensions.cs
---

# HTTP Security Headers & Method Filtering

`Whizbang.Hosting.AspNet` ships an **opt-in** middleware that hardens every HTTP response a service emits — REST (FastEndpoints), GraphQL (HotChocolate), health probes, and framework-generated errors (401/404/405) alike — and rejects HTTP methods your service does not use.

It is **not** registered by `AddWhizbangAspNet()`. Adding response headers (notably `X-Frame-Options: DENY`) silently for every consumer would be a breaking change, so you enable it explicitly per service:

```csharp{title="Enable security headers" description="Demonstrates enabling the middleware with defaults" category="Security" difficulty="BEGINNER" tags=["Security", "Headers", "Middleware"]}
var app = builder.Build();

app.UseWhizbangSecurityHeaders();   // place BEFORE UseRouting so error responses are covered
app.UseRouting();
```

## Default headers

| Header | Default value |
|--------|---------------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` — **only on HTTPS requests** (or `X-Forwarded-Proto: https`) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Every value is overridable (set to `null` to suppress a header entirely):

```csharp{title="Customize headers" description="Demonstrates overriding header defaults" category="Security" difficulty="INTERMEDIATE" tags=["Security", "Headers", "Options"]}
app.UseWhizbangSecurityHeaders(options => {
  options.ContentSecurityPolicy = "frame-ancestors 'self'";
  options.PermissionsPolicy = null;              // don't emit
  options.AllowedMethods.Add("DELETE");          // this API really uses DELETE
});
```

## Behavior guarantees

- **Idempotent** — a header already present on the response (for example, set by an edge proxy such as Azure Front Door or Application Gateway) is **never overwritten**. The edge wins; the middleware only fills gaps. Origin + edge = defense-in-depth.
- **HSTS is TLS-aware** — pods typically listen on plain HTTP behind a TLS-terminating edge. HSTS is emitted only when `Request.IsHttps` is true **or** the request carries `X-Forwarded-Proto: https`. Emitting HSTS on plain HTTP is meaningless and can mask misconfiguration.
- **Method filtering** — requests whose method is not in `AllowedMethods` (default `GET, HEAD, POST, OPTIONS`) are short-circuited with **405 Method Not Allowed** and an `Allow` header, before reaching routing.
- **Reflection-free / AOT-safe** — headers are applied via `HttpResponse.OnStarting`; no reflection, no dynamic types (Whizbang Key Principles 1–2).

## Suppressing the Kestrel `Server` header

Response header hardening usually pairs with removing the `Server: Kestrel` banner. Use the Kestrel helper:

```csharp{title="Suppress Server header" description="Demonstrates removing the Server response header" category="Security" difficulty="BEGINNER" tags=["Security", "Kestrel", "Server"]}
builder.WebHost.UseWhizbangKestrelSecurityDefaults();   // sets AddServerHeader = false
```

## When to use

Enable this middleware on any Whizbang service that terminates HTTP for browsers or external callers. If an edge layer already injects these headers, still enable it — the idempotence guarantee means the origin only covers responses the edge misses (direct pod access, internal calls, edge misconfiguration).

## See also

- [GraphQL Production Hardening](../../apis/graphql/production-hardening.md) — introspection and error-detail hardening for HotChocolate services.
