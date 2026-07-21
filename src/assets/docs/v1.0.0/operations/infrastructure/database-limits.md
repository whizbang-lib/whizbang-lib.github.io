---
title: Database Identifier Limits
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Infrastructure
order: 7
description: >-
  Compile-time validation of database identifier lengths - table names, column
  names, and index names checked against provider-specific byte limits
tags: >-
  database, limits, identifiers, validation, postgresql, compile-time,
  source-generators
codeReferences:
  - src/Whizbang.Generators.Shared/Limits/IDbProviderLimits.cs
  - src/Whizbang.Generators.Shared/Utilities/IdentifierValidation.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Limits/PostgresLimits.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Utilities/IdentifierValidationTests.cs
  - tests/Whizbang.Generators.Tests/Limits/PostgresLimitsTests.cs
  - >-
    tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs
lastMaintainedCommit: '01f07906'
---

# Database Identifier Limits

Whizbang validates database identifier lengths **at compile time** via source generators. This prevents deployment failures caused by table names, column names, or index names exceeding the target database's maximum identifier length.

## Why Compile-Time Validation?

Database providers impose strict limits on identifier lengths. Violating these limits causes migration failures or silent truncation at deployment time - often discovered only in production.

| Problem | Impact |
|---------|--------|
| **Silent truncation** | PostgreSQL silently truncates identifiers beyond 63 bytes, causing name collisions |
| **Migration failures** | Names exceeding limits fail during `CREATE TABLE` or `CREATE INDEX` |
| **Late discovery** | Issues found at deployment, not development time |
| **Byte vs character confusion** | Multi-byte UTF-8 characters consume more than one byte toward the limit |

Whizbang's source generators validate all generated identifiers during compilation, surfacing errors immediately in your IDE.

---

## Provider Limits

### IDbProviderLimits Interface

The `IDbProviderLimits` interface defines the contract for provider-specific identifier limits:

```csharp{title="IDbProviderLimits Interface" description="Contract for database provider identifier length limits" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Database", "Limits"] tests=["PostgresLimitsTests.ImplementsIDbProviderLimitsAsync"]}
public interface IDbProviderLimits {
  int MaxTableNameBytes { get; }
  int MaxColumnNameBytes { get; }
  int MaxIndexNameBytes { get; }
  string ProviderName { get; }
}
```

Each database provider package supplies its own implementation with the correct limits.

### PostgreSQL Limits

PostgreSQL uses **byte-based** limits derived from the `NAMEDATALEN` compile-time constant (default 64, with 1 byte reserved for the null terminator):

```csharp{title="PostgreSQL Limits" description="PostgreSQL identifier limits - 63 bytes for all identifiers" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "PostgreSQL", "Limits"] tests=["PostgresLimitsTests.MAX_IDENTIFIER_BYTES_Is63Async", "PostgresLimitsTests.MaxTableNameBytes_Returns63Async", "PostgresLimitsTests.MaxColumnNameBytes_Returns63Async", "PostgresLimitsTests.MaxIndexNameBytes_Returns63Async", "PostgresLimitsTests.ProviderName_ReturnsPostgreSQLAsync", "PostgresLimitsTests.Instance_IsSingletonAsync"]}
public sealed class PostgresLimits : IDbProviderLimits {
  public const int MAX_IDENTIFIER_BYTES = 63;

  public int MaxTableNameBytes => MAX_IDENTIFIER_BYTES;   // 63 bytes
  public int MaxColumnNameBytes => MAX_IDENTIFIER_BYTES;  // 63 bytes
  public int MaxIndexNameBytes => MAX_IDENTIFIER_BYTES;   // 63 bytes
  public string ProviderName => "PostgreSQL";

  public static PostgresLimits Instance { get; } = new();
  private PostgresLimits() { }
}
```

| Identifier Type | PostgreSQL Limit | Measurement |
|----------------|-----------------|-------------|
| Table name | 63 bytes | UTF-8 bytes |
| Column name | 63 bytes | UTF-8 bytes |
| Index name | 63 bytes | UTF-8 bytes |

### Other Provider Limits

The `IDbProviderLimits` interface supports any database provider. Common limits for reference:

| Provider | Table Name | Column Name | Index Name | Measurement |
|----------|-----------|-------------|------------|-------------|
| **PostgreSQL** | 63 bytes | 63 bytes | 63 bytes | Bytes (UTF-8) |
| **MySQL** | 64 chars | 64 chars | 64 chars | Characters |
| **SQL Server** | 128 chars | 128 chars | 128 chars | Characters |

---

## How Validation Works

### Byte-Based Measurement

All validation is performed in **UTF-8 bytes**, not characters. This is critical because:

- PostgreSQL measures identifier limits in bytes
- Multi-byte characters (e.g., accented characters, CJK characters) consume 2-4 bytes each
- An identifier that appears to be 50 characters may actually be 100+ bytes

```csharp{title="Byte-Based Measurement" description="IdentifierValidation measures in UTF-8 bytes, not characters" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Validation", "UTF-8"] tests=["IdentifierValidationTests.GetByteCount_AsciiString_ReturnsLengthAsync", "IdentifierValidationTests.GetByteCount_UnicodeString_ReturnsCorrectBytesAsync"]}
// ASCII characters: 1 byte each
IdentifierValidation.GetByteCount("orders");        // 6 bytes
IdentifierValidation.GetByteCount("order_items");   // 11 bytes

// Multi-byte characters: 2-4 bytes each
IdentifierValidation.GetByteCount("pedidos_accion");    // 15 bytes (all ASCII)
IdentifierValidation.GetByteCount("pedidos_accion");   // May differ with accented chars
```

### Validation Methods

The `IdentifierValidation` class provides validation for each identifier type:

```csharp{title="Validation Methods" description="Validate identifiers against provider-specific limits" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Validation", "Methods"] tests=["IdentifierValidationTests.ValidateTableName_ExceedsLimit_ReturnsErrorAsync", "IdentifierValidationTests.ValidateTableName_WithinLimit_ReturnsNullAsync", "IdentifierValidationTests.ValidateColumnName_WithinLimit_ReturnsNullAsync", "IdentifierValidationTests.ValidateIndexName_WithinLimit_ReturnsNullAsync", "IdentifierValidationTests.IsTableNameValid_WithinLimit_ReturnsTrueAsync", "IdentifierValidationTests.IsColumnNameValid_WithinLimit_ReturnsTrueAsync", "IdentifierValidationTests.IsIndexNameValid_WithinLimit_ReturnsTrueAsync"]}
var limits = PostgresLimits.Instance;

// Validate table name - returns error message or null
string? error = IdentifierValidation.ValidateTableName(
    "very_long_table_name_that_might_exceed_the_limit", limits);

if (error is not null) {
  // "Table name 'very_long...' is 48 bytes, exceeding PostgreSQL limit of 63 bytes"
}

// Validate column name
error = IdentifierValidation.ValidateColumnName("my_column_name", limits);

// Validate index name
error = IdentifierValidation.ValidateIndexName("ix_my_table_my_column", limits);

// Boolean helpers for quick checks
bool tableOk = IdentifierValidation.IsTableNameValid("orders", limits);      // true
bool columnOk = IdentifierValidation.IsColumnNameValid("order_id", limits);  // true
bool indexOk = IdentifierValidation.IsIndexNameValid("ix_orders_id", limits); // true
```

### Source Generator Integration

Whizbang's EF Core source generators call `IdentifierValidation` during code generation. When a generated identifier exceeds the provider limit, the generator emits a compile-time error diagnostic:

| Diagnostic | Meaning |
|-----------|---------|
| `WHIZ820` | Table name exceeds database limit |
| `WHIZ821` | Column name exceeds database limit |
| `WHIZ822` | Index name exceeds database limit (pattern `ix_{table}_{column}`) |

```
error WHIZ820: Perspective model 'CustomerOrderFulfillmentStatusHistoryProjectionView' generates
table name 'wh_per_customer_order_fulfillment_status_history_projection_view' (64 bytes) which
exceeds PostgreSQL limit of 63 bytes. Shorten the model name or configure suffix stripping.
```

This means you see the error in your IDE immediately, not when running migrations.

---

## Common Scenarios

### Long Perspective Table Names

Perspective table names are derived from the model type name. Long model names can exceed limits:

```csharp{title="Long Perspective Table Names" description="Long model type names may produce table names exceeding limits" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Perspectives", "Table"]}
// Model type name is long
public class CustomerOrderFulfillmentStatusView { }

// Generated table name (wh_per_ prefix + snake_case model name):
// "wh_per_customer_order_fulfillment_status_view"
// = 45 bytes (within 63-byte PostgreSQL limit)

// A longer model name can push the generated name past 63 bytes
```

### Generated Index Names

Composite index names combine table and column names, which can easily exceed limits:

```csharp{title="Generated Index Names" description="Composite index names may exceed identifier limits" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Index", "Names"]}
// Index name pattern for indexed physical fields: ix_{table}_{column}
// Example: ix_wh_per_order_view_customer_id
// = 32 bytes (within limit)

// Long names can exceed:
// ix_wh_per_customer_fulfillment_status_view_customer_reference_id
// = 64 bytes (exceeds 63-byte PostgreSQL limit!)
```

### Fixing Limit Violations

When you encounter a limit violation, you have several options:

1. **Shorten the model type name** - Use a more concise name for your perspective model
2. **Use a custom table name** - Override the generated table name via EF Core configuration
3. **Abbreviate columns** - Use shorter property names on the model

---

## Extending for New Providers

To add support for a new database provider, implement `IDbProviderLimits`:

```csharp{title="Custom Provider Limits" description="Implement IDbProviderLimits for a new database provider" category="Internals" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Custom", "Provider"] unverified="example custom provider implementation — user code illustrating how to implement IDbProviderLimits; MySqlLimits is not a shipped or tested type"}
public sealed class MySqlLimits : IDbProviderLimits {
  public const int MAX_IDENTIFIER_LENGTH = 64;

  public int MaxTableNameBytes => MAX_IDENTIFIER_LENGTH;
  public int MaxColumnNameBytes => MAX_IDENTIFIER_LENGTH;
  public int MaxIndexNameBytes => MAX_IDENTIFIER_LENGTH;
  public string ProviderName => "MySQL";

  public static MySqlLimits Instance { get; } = new();
  private MySqlLimits() { }
}
```

The `IdentifierValidation` utility works with any `IDbProviderLimits` implementation, so your custom provider automatically gets compile-time validation.

---

## AOT Compatibility

All validation utilities are AOT-compatible:

- `Encoding.UTF8.GetByteCount()` is a standard BCL method
- No reflection or dynamic code generation
- Runs entirely at compile time within source generators
- Provider limits are simple property accessors on sealed classes

---

## See Also

- [Migrations](migrations.md) - Database migration management
- [Perspective Discovery](../../extending/source-generators/perspective-discovery.md) - How perspective table names are generated
- [Source Generator Configuration](../../extending/source-generators/configuration.md) - Generator settings

---

*Version 1.0.0 - Foundation Release*
