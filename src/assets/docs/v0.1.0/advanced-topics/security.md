---
title: "Security Best Practices"
version: 0.1.0
category: Advanced Topics
order: 5
description: "Security guidelines - authentication, authorization, encryption, secrets management, OWASP Top 10"
tags: security, authentication, authorization, encryption, owasp, secrets
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

```json
{
  "Authentication": {
    "Authority": "https://login.microsoftonline.com/{tenant-id}/v2.0",
    "Audience": "api://order-service",
    "ValidIssuer": "https://login.microsoftonline.com/{tenant-id}/v2.0"
  }
}
```

**Program.cs**:

```csharp
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

```csharp
app.MapPost("/orders", async (
  CreateOrder command,
  IDispatcher dispatcher,
  CancellationToken ct
) => {
  var result = await dispatcher.DispatchAsync<CreateOrder, OrderCreated>(command, ct);
  return Results.Created($"/orders/{result.OrderId}", result);
})
.RequireAuthorization();  // ✅ Require authentication
```

---

## Authorization

### Policy-Based Authorization

**Program.cs**:

```csharp
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

```csharp
app.MapPost("/orders", async (
  CreateOrder command,
  IDispatcher dispatcher,
  CancellationToken ct
) => {
  var result = await dispatcher.DispatchAsync<CreateOrder, OrderCreated>(command, ct);
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

```csharp
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

```csharp
builder.Services.AddSingleton<IAuthorizationHandler, OrderAuthorizationHandler>();
```

**Usage**:

```csharp
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

---

## Encryption

### TLS 1.3 (In Transit)

**appsettings.json**:

```json
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

```csharp
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

```csharp
public async Task<PaymentProcessed> HandleAsync(
  ProcessPayment command,
  CancellationToken ct = default
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

  return new PaymentProcessed { PaymentId = paymentId };
}
```

---

## Secrets Management

### Azure Key Vault

**Program.cs**:

```csharp
var keyVaultUri = new Uri(builder.Configuration["KeyVault:VaultUri"]);

builder.Configuration.AddAzureKeyVault(
  keyVaultUri,
  new DefaultAzureCredential()
);
```

**Azure Key Vault Secrets**:

```bash
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

```csharp
// Automatically resolved from Key Vault
var connectionString = builder.Configuration["Database:ConnectionString"];
var serviceBusConnectionString = builder.Configuration["AzureServiceBus:ConnectionString"];
var encryptionKey = builder.Configuration["Encryption:Key"];
```

### Managed Identity (Avoid Credentials)

**appsettings.json**:

```json
{
  "KeyVault": {
    "VaultUri": "https://whizbang-kv.vault.azure.net/"
  }
}
```

**No credentials needed** - Azure Managed Identity provides access:

```bash
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

```csharp
public static class CreateOrderValidator {
  public static ValidationResult Validate(CreateOrder command) {
    var errors = new List<string>();

    if (string.IsNullOrWhiteSpace(command.CustomerId)) {
      errors.Add("Customer ID is required");
    }

    if (command.Items.Length == 0) {
      errors.Add("Order must contain at least one item");
    }

    foreach (var item in command.Items) {
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

**ValidationPolicy.cs**:

```csharp
public class ValidationPolicy : IPolicy {
  public async Task ApplyAsync(PolicyContext context, CancellationToken ct = default) {
    var result = context.Message switch {
      CreateOrder cmd => CreateOrderValidator.Validate(cmd),
      UpdateOrder cmd => UpdateOrderValidator.Validate(cmd),
      _ => ValidationResult.Success()
    };

    if (!result.IsSuccess) {
      throw new ValidationException(string.Join("; ", result.Errors));
    }
  }
}
```

### SQL Injection Prevention

**✅ ALWAYS use parameterized queries**:

```csharp
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

```csharp
// Check user can access resource
var authResult = await _authz.AuthorizeAsync(user, order, "View");
if (!authResult.Succeeded) {
  return Results.Forbid();
}
```

### 2. Cryptographic Failures

**✅ Mitigation**: TLS 1.3 + AES-256 encryption + Azure Key Vault

```csharp
// Encrypt sensitive data
var encryptedData = _encryption.Encrypt(sensitiveData);
```

### 3. Injection

**✅ Mitigation**: Parameterized queries + input validation

```csharp
// Always use parameters
await _db.ExecuteAsync(
  "INSERT INTO orders (...) VALUES (@Value)",
  new { Value = userInput }
);
```

### 4. Insecure Design

**✅ Mitigation**: Principle of least privilege + defense in depth

```csharp
// Multiple layers of security
.RequireAuthorization("CreateOrder")  // Layer 1: Policy
.AddPolicy(new ValidationPolicy())    // Layer 2: Validation
.AddPolicy(new TenantIsolationPolicy())  // Layer 3: Tenant isolation
```

### 5. Security Misconfiguration

**✅ Mitigation**: Secure defaults + configuration validation

```csharp
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

```yaml
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

```csharp
options.TokenValidationParameters = new TokenValidationParameters {
  ValidateLifetime = true,
  ClockSkew = TimeSpan.Zero  // No grace period
};
```

### 8. Software and Data Integrity Failures

**✅ Mitigation**: Message signing + envelope validation

```csharp
public class MessageIntegrityPolicy : IPolicy {
  public async Task ApplyAsync(PolicyContext context, CancellationToken ct = default) {
    var signature = context.Envelope.Headers.GetValueOrDefault("signature");
    if (string.IsNullOrEmpty(signature)) {
      throw new SecurityException("Missing message signature");
    }

    var expectedSignature = ComputeSignature(context.Message);
    if (signature != expectedSignature) {
      throw new SecurityException("Invalid message signature");
    }
  }

  private string ComputeSignature(object message) {
    var json = JsonSerializer.Serialize(message);
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
    return Convert.ToBase64String(hash);
  }
}
```

### 9. Security Logging and Monitoring Failures

**✅ Mitigation**: Structured logging + Application Insights

```csharp
_logger.LogWarning(
  "Unauthorized access attempt: User {UserId} attempted to access Order {OrderId}",
  userId,
  orderId
);
```

### 10. Server-Side Request Forgery (SSRF)

**✅ Mitigation**: Whitelist allowed hosts + URL validation

```csharp
public class UrlValidationPolicy : IPolicy {
  private static readonly string[] AllowedHosts = [
    "api.stripe.com",
    "api.twilio.com"
  ];

  public async Task ApplyAsync(PolicyContext context, CancellationToken ct = default) {
    if (context.Message is IExternalApiCall apiCall) {
      var uri = new Uri(apiCall.Url);
      if (!AllowedHosts.Contains(uri.Host)) {
        throw new SecurityException($"Host not allowed: {uri.Host}");
      }
    }
  }
}
```

---

## Security Headers

**SecurityHeadersMiddleware.cs**:

```csharp
app.Use(async (context, next) => {
  // Prevent clickjacking
  context.Response.Headers.Append("X-Frame-Options", "DENY");

  // Prevent MIME sniffing
  context.Response.Headers.Append("X-Content-Type-Options", "nosniff");

  // Enable XSS protection
  context.Response.Headers.Append("X-XSS-Protection", "1; mode=block");

  // Content Security Policy
  context.Response.Headers.Append(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'"
  );

  // Strict Transport Security (HSTS)
  context.Response.Headers.Append(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  await next();
});
```

---

## Rate Limiting

**Program.cs**:

```csharp
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

```csharp
app.MapPost("/orders", async (
  CreateOrder command,
  IDispatcher dispatcher,
  CancellationToken ct
) => {
  var result = await dispatcher.DispatchAsync<CreateOrder, OrderCreated>(command, ct);
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

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
