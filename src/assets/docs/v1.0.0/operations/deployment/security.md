---
title: Security Best Practices
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Advanced Topics
order: 5
description: >-
  Security guidelines - authentication, authorization, encryption, secrets
  management, OWASP Top 10
tags: 'security, authentication, authorization, encryption, owasp, secrets'
codeReferences:
  - src/Whizbang.Core/Security/SecurityOptions.cs
  - src/Whizbang.Core/Security/MessageSecurityServiceCollectionExtensions.cs
  - src/Whizbang.Core/Security/ISecurityContextExtractor.cs
  - src/Whizbang.Core/Security/MessageSecurityOptions.cs
  - src/Whizbang.Core/Security/Attributes/RequirePermissionAttribute.cs
  - src/Whizbang.Hosting.AspNet/WhizbangSecurityHeadersMiddleware.cs
testReferences:
  - tests/Whizbang.Core.Tests/Security/MessageSecurityContextProviderTests.cs
  - tests/Whizbang.Core.Integration.Tests/SecurityIntegrationTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/WhizbangSecurityHeadersMiddlewareTests.cs
lastMaintainedCommit: '01f07906'
---

# Security Best Practices

Comprehensive **security guide** for Whizbang applications - authentication, authorization, data encryption, secrets management, and OWASP Top 10 mitigations.

---

## Security Checklist

| Category | Requirement | Status |
|----------|-------------|--------|
| **Authentication** | JWT with RS256 signing | ✅ |
| **Authorization** | Policy-based RBAC | ✅ |
| **Encryption** | TLS 1.3 in transit | ✅ |
| **Encryption** | AES-256 at rest | ✅ |
| **Secrets** | Azure Key Vault | ✅ |
| **Input Validation** | Command validation | ✅ |
| **SQL Injection** | Parameterized queries | ✅ |
| **CSRF** | SameSite cookies | ✅ |

---

## Authentication

### JWT with RS256

**Why RS256 (asymmetric)?**:
- ✅ Public key verification (no shared secret)
- ✅ Harder to compromise (private key stays on auth server)
- ✅ Standard for microservices

**appsettings.json**:

```json{title="JWT with RS256" description="**appsettings." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "JWT", "RS256"]}
{
  "Authentication": {
    "Authority": "https://login.microsoftonline.com/{tenant-id}/v2.0",
    "Audience": "api://order-service",
    "ValidIssuer": "https://login.microsoftonline.com/{tenant-id}/v2.0"
  }
}
```

**Program.cs**:

```csharp{title="JWT with RS256 (2)" description="JWT with RS256" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "JWT", "RS256"]}
builder.Services
  .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
  .AddJwtBearer(options => {
    options.Authority = builder.Configuration["Authentication:Authority"];
    options.Audience = builder.Configuration["Authentication:Audience"];
    options.TokenValidationParameters = new TokenValidationParameters {
      ValidateIssuer = true,
      ValidateAudience = true,
      ValidateLifetime = true,
      ValidateIssuerSigningKey = true,
      ValidIssuer = builder.Configuration["Authentication:ValidIssuer"],
      ClockSkew = TimeSpan.Zero  // No grace period for expired tokens
    };
  });

app.UseAuthentication();
app.UseAuthorization();
```

### Require Authentication on Endpoints

```csharp{title="Require Authentication on Endpoints" description="Require Authentication on Endpoints" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Require", "Authentication"]}
app.MapPost("/orders", async (
  CreateOrderCommand command,
  IDispatcher dispatcher
) => {
  var result = await dispatcher.LocalInvokeAsync<CreateOrderCommand, OrderCreatedEvent>(command);
  return Results.Created($"/orders/{result.OrderId}", result);
})
.RequireAuthorization();  // ✅ Require authentication
```

---

## Authorization

### Policy-Based Authorization

**Program.cs**:

```csharp{title="Policy-Based Authorization" description="Policy-Based Authorization" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Policy-Based", "Authorization"]}
builder.Services.AddAuthorizationBuilder()
  .AddPolicy("CreateOrder", policy => policy
    .RequireAuthenticatedUser()
    .RequireClaim("scope", "orders.write"))
  .AddPolicy("ViewOrders", policy => policy
    .RequireAuthenticatedUser()
    .RequireClaim("scope", "orders.read"))
  .AddPolicy("AdminOnly", policy => policy
    .RequireAuthenticatedUser()
    .RequireRole("Admin"));
```

**Usage**:

```csharp{title="Policy-Based Authorization (2)" description="Policy-Based Authorization" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Policy-Based", "Authorization"]}
app.MapPost("/orders", async (
  CreateOrderCommand command,
  IDispatcher dispatcher
) => {
  var result = await dispatcher.LocalInvokeAsync<CreateOrderCommand, OrderCreatedEvent>(command);
  return Results.Created($"/orders/{result.OrderId}", result);
})
.RequireAuthorization("CreateOrder");  // ✅ Require specific policy

app.MapGet("/orders/{orderId}", async (
  string orderId,
  IDbConnection db
) => {
  var order = await db.QuerySingleOrDefaultAsync<OrderRow>(
    "SELECT * FROM orders WHERE order_id = @OrderId",
    new { OrderId = orderId }
  );
  return order is not null ? Results.Ok(order) : Results.NotFound();
})
.RequireAuthorization("ViewOrders");
```

### Resource-Based Authorization

**OrderAuthorizationHandler.cs**:

```csharp{title="Resource-Based Authorization" description="**OrderAuthorizationHandler." category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Resource-Based", "Authorization"]}
public class OrderAuthorizationHandler : AuthorizationHandler<OperationAuthorizationRequirement, OrderRow> {
  protected override Task HandleRequirementAsync(
    AuthorizationHandlerContext context,
    OperationAuthorizationRequirement requirement,
    OrderRow order
  ) {
    var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    // Users can only view their own orders (unless admin)
    if (requirement.Name == "View") {
      if (context.User.IsInRole("Admin") || order.CustomerId == userId) {
        context.Succeed(requirement);
      }
    }

    // Only admins can delete orders
    if (requirement.Name == "Delete") {
      if (context.User.IsInRole("Admin")) {
        context.Succeed(requirement);
      }
    }

    return Task.CompletedTask;
  }
}
```

**Registration**:

```csharp{title="Resource-Based Authorization (2)" description="Registration:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Resource-Based", "Authorization"]}
builder.Services.AddSingleton<IAuthorizationHandler, OrderAuthorizationHandler>();
```

**Usage**:

```csharp{title="Resource-Based Authorization (3)" description="Resource-Based Authorization" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Resource-Based", "Authorization"]}
app.MapDelete("/orders/{orderId}", async (
  string orderId,
  IDbConnection db,
  IAuthorizationService authz,
  HttpContext context
) => {
  var order = await db.QuerySingleOrDefaultAsync<OrderRow>(
    "SELECT * FROM orders WHERE order_id = @OrderId",
    new { OrderId = orderId }
  );

  if (order is null) {
    return Results.NotFound();
  }

  // Check authorization
  var authResult = await authz.AuthorizeAsync(
    context.User,
    order,
    new OperationAuthorizationRequirement { Name = "Delete" }
  );

  if (!authResult.Succeeded) {
    return Results.Forbid();
  }

  await db.ExecuteAsync(
    "DELETE FROM orders WHERE order_id = @OrderId",
    new { OrderId = orderId }
  );

  return Results.NoContent();
})
.RequireAuthorization();
```

### Whizbang Message Security

HTTP-level authorization covers your endpoints; **message-level security** covers everything flowing through the dispatcher and transports. Whizbang ships this as a first-class subsystem:

```csharp{title="Whizbang Message Security" description="AddWhizbangMessageSecurity + receptor permission gates" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Message", "Security"]}
// Program.cs - message security pipeline
builder.Services.AddWhizbangMessageSecurity(options => {
  options.AllowAnonymous = false;               // default: reject messages without a security context
  options.EnableAuditLogging = true;            // default: true
  options.ValidateCredentials = true;           // default: true
  options.PropagateToOutgoingMessages = true;   // default: true - context flows to cascaded/outgoing messages
  options.ExemptMessageTypes.Add(typeof(HealthPingCommand));  // opt specific messages out
});

// Receptor-level permission gate - enforced by the receptor interceptor pipeline
[RequirePermission("orders.write")]
public class CreateOrderReceptor(IDispatcher dispatcher, ILogger<CreateOrderReceptor> logger)
  : IReceptor<CreateOrderCommand, OrderCreatedEvent> {
  // ...
}
```

The security context captured at the edge (e.g., from the JWT) travels **with the message** across the outbox, transport, and inbox - receptors on other services see the same principal. Row-level scoping (`[Scoped]`) and column-level masking (`[FieldPermission]`) build on the same context; see the Security fundamentals page for the full model.

---

## Encryption

### TLS 1.3 (In Transit)

**appsettings.json**:

```json{title="TLS 1.3 (In Transit)" description="**appsettings." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "TLS", "1.3"]}
{
  "Kestrel": {
    "Endpoints": {
      "Https": {
        "Url": "https://0.0.0.0:443",
        "Certificate": {
          "Path": "/app/certs/certificate.pfx",
          "Password": "***"
        },
        "Protocols": "Http1AndHttp2AndHttp3",
        "SslProtocols": ["Tls13"]
      }
    }
  }
}
```

### AES-256 Encryption (At Rest)

**DataEncryptionService.cs**:

```csharp{title="AES-256 Encryption (At Rest)" description="**DataEncryptionService." category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "AES-256", "Encryption"]}
public interface IDataEncryptionService {
  byte[] Encrypt(byte[] plaintext);
  byte[] Decrypt(byte[] ciphertext);
}

public class AesDataEncryptionService : IDataEncryptionService {
  private readonly byte[] _key;

  public AesDataEncryptionService(IConfiguration config) {
    // Get encryption key from Azure Key Vault
    _key = Convert.FromBase64String(config["Encryption:Key"]);

    if (_key.Length != 32) {
      throw new InvalidOperationException("Encryption key must be 256 bits (32 bytes)");
    }
  }

  public byte[] Encrypt(byte[] plaintext) {
    using var aes = Aes.Create();
    aes.Key = _key;
    aes.GenerateIV();  // Random IV for each encryption

    using var encryptor = aes.CreateEncryptor();
    using var ms = new MemoryStream();

    // Write IV first (needed for decryption)
    ms.Write(aes.IV, 0, aes.IV.Length);

    using (var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write)) {
      cs.Write(plaintext, 0, plaintext.Length);
    }

    return ms.ToArray();
  }

  public byte[] Decrypt(byte[] ciphertext) {
    using var aes = Aes.Create();
    aes.Key = _key;

    // Read IV from ciphertext
    var iv = new byte[16];
    Array.Copy(ciphertext, 0, iv, 0, 16);
    aes.IV = iv;

    using var decryptor = aes.CreateDecryptor();
    using var ms = new MemoryStream(ciphertext, 16, ciphertext.Length - 16);
    using var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read);
    using var result = new MemoryStream();

    cs.CopyTo(result);
    return result.ToArray();
  }
}
```

**Usage**:

```csharp{title="AES-256 Encryption (At Rest) (2)" description="AES-256 Encryption (At Rest)" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "AES-256", "Encryption"]}
public async ValueTask<PaymentProcessedEvent> HandleAsync(
  ProcessPaymentCommand command,
  CancellationToken cancellationToken = default
) {
  // Encrypt sensitive data before storing
  var encryptedCardNumber = _encryption.Encrypt(
    Encoding.UTF8.GetBytes(command.CardNumber)
  );

  await _db.ExecuteAsync(
    """
    INSERT INTO payments (payment_id, order_id, encrypted_card_number, created_at)
    VALUES (@PaymentId, @OrderId, @EncryptedCardNumber, NOW())
    """,
    new {
      PaymentId = paymentId,
      OrderId = command.OrderId,
      EncryptedCardNumber = encryptedCardNumber
    }
  );

  return new PaymentProcessedEvent { PaymentId = paymentId };
}
```

---

## Secrets Management

### Azure Key Vault

**Program.cs**:

```csharp{title="Azure Key Vault" description="Azure Key Vault" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Azure", "Key"]}
var keyVaultUri = new Uri(builder.Configuration["KeyVault:VaultUri"]);

builder.Configuration.AddAzureKeyVault(
  keyVaultUri,
  new DefaultAzureCredential()
);
```

**Azure Key Vault Secrets**:

```bash{title="Azure Key Vault (2)" description="Azure Key Vault Secrets:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Azure", "Key"]}
# Create secrets in Key Vault
az keyvault secret set \
  --vault-name whizbang-kv \
  --name "Database--ConnectionString" \
  --value "Host=...;Database=orders;Username=app;Password=***"

az keyvault secret set \
  --vault-name whizbang-kv \
  --name "AzureServiceBus--ConnectionString" \
  --value "Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=***"

az keyvault secret set \
  --vault-name whizbang-kv \
  --name "Encryption--Key" \
  --value "base64-encoded-256-bit-key"
```

**Usage**:

```csharp{title="Azure Key Vault (3)" description="Azure Key Vault" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Azure", "Key"]}
// Automatically resolved from Key Vault
var connectionString = builder.Configuration["Database:ConnectionString"];
var serviceBusConnectionString = builder.Configuration["AzureServiceBus:ConnectionString"];
var encryptionKey = builder.Configuration["Encryption:Key"];
```

### Managed Identity (Avoid Credentials)

**appsettings.json**:

```json{title="Managed Identity (Avoid Credentials)" description="**appsettings." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Managed", "Identity"]}
{
  "KeyVault": {
    "VaultUri": "https://whizbang-kv.vault.azure.net/"
  }
}
```

**No credentials needed** - Azure Managed Identity provides access:

```bash{title="Managed Identity (Avoid Credentials) (2)" description="No credentials needed - Azure Managed Identity provides access:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Managed", "Identity"]}
# Assign Managed Identity to App Service
az webapp identity assign --name whizbang-api --resource-group whizbang-rg

# Grant Key Vault access to Managed Identity
az keyvault set-policy \
  --name whizbang-kv \
  --object-id <managed-identity-object-id> \
  --secret-permissions get list
```

---

## Input Validation

### Command Validation

**CreateOrderValidator.cs**:

```csharp{title="Command Validation" description="**CreateOrderValidator." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Command", "Validation"]}
public static class CreateOrderValidator {
  public static ValidationResult Validate(CreateOrderCommand command) {
    var errors = new List<string>();

    if (command.LineItems.Count == 0) {
      errors.Add("Order must contain at least one item");
    }

    foreach (var item in command.LineItems) {
      if (item.Quantity <= 0) {
        errors.Add($"Item {item.ProductId}: Quantity must be greater than zero");
      }

      if (item.UnitPrice <= 0) {
        errors.Add($"Item {item.ProductId}: Unit price must be greater than zero");
      }
    }

    return errors.Count == 0
      ? ValidationResult.Success()
      : ValidationResult.Failure(errors);
  }
}
```

**Enforce in the receptor** (the pattern used by the ECommerce sample - validation runs before any event is published):

```csharp{title="Command Validation - Receptor Guard" description="Validate at the top of HandleAsync, before publishing" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Command", "Validation"]}
public class CreateOrderReceptor(IDispatcher dispatcher, ILogger<CreateOrderReceptor> logger)
  : IReceptor<CreateOrderCommand, OrderCreatedEvent> {

  public async ValueTask<OrderCreatedEvent> HandleAsync(
    CreateOrderCommand command,
    CancellationToken cancellationToken = default) {

    var result = CreateOrderValidator.Validate(command);
    if (!result.IsSuccess) {
      throw new ValidationException(string.Join("; ", result.Errors));
    }

    // ... publish OrderCreatedEvent only after validation passes
  }
}
```

For validation that must run for *every* message of a type regardless of which receptor handles it, register a lifecycle receptor with `[FireAt(LifecycleStage.PreOutboxInline)]` (sender side) or `[FireAt(LifecycleStage.PreInboxInline)]` (receiver side) - inline stages block the pipeline until the guard completes.

### SQL Injection Prevention

**✅ ALWAYS use parameterized queries**:

```csharp{title="SQL Injection Prevention" description="✅ ALWAYS use parameterized queries:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "SQL", "Injection"]}
// ✅ GOOD - Parameterized query (safe)
var orders = await _db.QueryAsync<OrderRow>(
  """
  SELECT * FROM orders
  WHERE customer_id = @CustomerId AND created_at >= @StartDate
  """,
  new { CustomerId = customerId, StartDate = startDate }
);

// ❌ BAD - String interpolation (SQL injection risk)
var orders = await _db.QueryAsync<OrderRow>(
  $"SELECT * FROM orders WHERE customer_id = '{customerId}'"
);
```

---

## OWASP Top 10 Mitigations

### 1. Broken Access Control

**✅ Mitigation**: Policy-based authorization + resource-based authorization

```csharp{title="Broken Access Control" description="✅ Mitigation: Policy-based authorization + resource-based authorization" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Broken", "Access"]}
// Check user can access resource
var authResult = await _authz.AuthorizeAsync(user, order, "View");
if (!authResult.Succeeded) {
  return Results.Forbid();
}
```

### 2. Cryptographic Failures

**✅ Mitigation**: TLS 1.3 + AES-256 encryption + Azure Key Vault

```csharp{title="Cryptographic Failures" description="✅ Mitigation: TLS 1." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Cryptographic", "Failures"]}
// Encrypt sensitive data
var encryptedData = _encryption.Encrypt(sensitiveData);
```

### 3. Injection

**✅ Mitigation**: Parameterized queries + input validation

```csharp{title="Injection" description="✅ Mitigation: Parameterized queries + input validation" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Injection"]}
// Always use parameters
await _db.ExecuteAsync(
  "INSERT INTO orders (...) VALUES (@Value)",
  new { Value = userInput }
);
```

### 4. Insecure Design

**✅ Mitigation**: Principle of least privilege + defense in depth

```csharp{title="Insecure Design" description="✅ Mitigation: Principle of least privilege + defense in depth" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Insecure", "Design"]}
// Multiple layers of security
app.MapPost("/orders", CreateOrderEndpoint)
  .RequireAuthorization("CreateOrder");            // Layer 1: HTTP policy

builder.Services.AddWhizbangMessageSecurity();     // Layer 2: message security context

[RequirePermission("orders.write")]                // Layer 3: receptor permission gate
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, OrderCreatedEvent> {
  // Layer 4: command validation inside HandleAsync
}
```

### 5. Security Misconfiguration

**✅ Mitigation**: Secure defaults + configuration validation

```csharp{title="Security Misconfiguration" description="✅ Mitigation: Secure defaults + configuration validation" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Security", "Misconfiguration"]}
// Validate configuration on startup
var requiredSettings = new[] {
  "Database:ConnectionString",
  "AzureServiceBus:ConnectionString",
  "Encryption:Key"
};

foreach (var setting in requiredSettings) {
  if (string.IsNullOrEmpty(builder.Configuration[setting])) {
    throw new InvalidOperationException($"Missing required setting: {setting}");
  }
}
```

### 6. Vulnerable and Outdated Components

**✅ Mitigation**: Automated dependency scanning

```yaml{title="Vulnerable and Outdated Components" description="✅ Mitigation: Automated dependency scanning" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Vulnerable", "Outdated"]}
# .github/workflows/security-scan.yml
name: Security Scan

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'
      - name: Upload results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

### 7. Identification and Authentication Failures

**✅ Mitigation**: JWT with short expiry + refresh tokens

```csharp{title="Identification and Authentication Failures" description="✅ Mitigation: JWT with short expiry + refresh tokens" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Identification", "Authentication"]}
options.TokenValidationParameters = new TokenValidationParameters {
  ValidateLifetime = true,
  ClockSkew = TimeSpan.Zero  // No grace period
};
```

### 8. Software and Data Integrity Failures

**✅ Mitigation**: Envelope identity + inbox deduplication + authenticated transports

Every Whizbang message travels in a `MessageEnvelope` with a unique `MessageId` and a per-service hop chain (`CorrelationId` / `CausationId`), and the inbox **deduplicates** on message identity - a replayed or duplicated message is rejected before your receptors run (`whizbang.dispatcher.duplicates_detected` counts these). Combine that with:

- **Authenticated transports** - Azure Service Bus (AAD / SAS) and RabbitMQ credentials authenticate every publish and consume; TLS protects the payload in transit.
- **Credential validation on messages** - `MessageSecurityOptions.ValidateCredentials = true` (default) rejects messages whose security context fails validation.
- **Supply-chain integrity** - lock files + signed packages for the software half of this OWASP category.

### 9. Security Logging and Monitoring Failures

**✅ Mitigation**: Structured logging + Application Insights

```csharp{title="Security Logging and Monitoring Failures" description="✅ Mitigation: Structured logging + Application Insights" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Security", "Logging"]}
_logger.LogWarning(
  "Unauthorized access attempt: User {UserId} attempted to access Order {OrderId}",
  userId,
  orderId
);
```

### 10. Server-Side Request Forgery (SSRF)

**✅ Mitigation**: Whitelist allowed hosts + URL validation

```csharp{title="Server-Side Request Forgery (SSRF)" description="✅ Mitigation: Whitelist allowed hosts + URL validation" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "10.", "Server-Side"]}
// Guard any receptor that makes outbound calls from message-supplied URLs
public static class OutboundUrlGuard {
  private static readonly string[] AllowedHosts = [
    "api.stripe.com",
    "api.twilio.com"
  ];

  public static void EnsureAllowed(string url) {
    var uri = new Uri(url);
    if (uri.Scheme != Uri.UriSchemeHttps || !AllowedHosts.Contains(uri.Host)) {
      throw new SecurityException($"Host not allowed: {uri.Host}");
    }
  }
}

// In the receptor, before calling out:
OutboundUrlGuard.EnsureAllowed(command.CallbackUrl);
```

---

## Security Headers

Whizbang ships a security-headers middleware in **`Whizbang.Hosting.AspNet`** - opt in with one line instead of hand-rolling:

```csharp{title="Security Headers" description="UseWhizbangSecurityHeaders from Whizbang.Hosting.AspNet" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Security", "Headers"]}
// Defaults: Strict-Transport-Security (1y, includeSubDomains, preload),
// X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
// CSP: frame-ancestors 'none', Referrer-Policy: strict-origin-when-cross-origin,
// Permissions-Policy: camera=(), microphone=(), geolocation=()
app.UseWhizbangSecurityHeaders();

// Or customize (set a header value to null to suppress it):
app.UseWhizbangSecurityHeaders(options => {
  options.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'";
  options.XFrameOptions = "SAMEORIGIN";
});
```

Headers are only added when absent, so app-specific values you set elsewhere win.

---

## Rate Limiting

**Program.cs**:

```csharp{title="Rate Limiting" description="Rate Limiting" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Rate", "Limiting"]}
builder.Services.AddRateLimiter(options => {
  options.AddFixedWindowLimiter("api", limiter => {
    limiter.PermitLimit = 100;
    limiter.Window = TimeSpan.FromMinutes(1);
    limiter.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    limiter.QueueLimit = 10;
  });
});

app.UseRateLimiter();
```

**Usage**:

```csharp{title="Rate Limiting (2)" description="Rate Limiting" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Rate", "Limiting"]}
app.MapPost("/orders", async (
  CreateOrderCommand command,
  IDispatcher dispatcher
) => {
  var result = await dispatcher.LocalInvokeAsync<CreateOrderCommand, OrderCreatedEvent>(command);
  return Results.Created($"/orders/{result.OrderId}", result);
})
.RequireAuthorization()
.RequireRateLimiting("api");
```

---

## Key Takeaways

✅ **JWT with RS256** - Asymmetric signing for microservices
✅ **Policy-Based Authorization** - Fine-grained access control
✅ **TLS 1.3 + AES-256** - Encryption in transit and at rest
✅ **Azure Key Vault** - Centralized secrets management
✅ **Input Validation** - Validate all commands
✅ **Parameterized Queries** - Prevent SQL injection
✅ **OWASP Top 10** - Comprehensive mitigations
✅ **Rate Limiting** - Prevent abuse

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
