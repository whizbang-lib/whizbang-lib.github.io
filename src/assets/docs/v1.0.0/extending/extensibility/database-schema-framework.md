---
title: Database Schema Framework
version: 1.0.0
category: Extensibility
order: 11
description: >-
  Implement database drivers using the Whizbang.Data.Schema framework -
  database-agnostic table and column definitions for PostgreSQL, SQLite, SQL
  Server, and custom databases
tags: >-
  schema, database, drivers, postgresql, sqlite, sqlserver, table-definition,
  column-definition, whizbang-data-type
codeReferences:
  - src/Whizbang.Data.Schema/TableDefinition.cs
  - src/Whizbang.Data.Schema/ColumnDefinition.cs
  - src/Whizbang.Data.Schema/IndexDefinition.cs
  - src/Whizbang.Data.Schema/WhizbangDataType.cs
  - src/Whizbang.Data.Schema/DefaultValue.cs
  - src/Whizbang.Data.Schema/DefaultValueFunction.cs
  - src/Whizbang.Data.Schema/SchemaConfiguration.cs
---

# Database Schema Framework

**The Whizbang.Data.Schema framework** provides a database-agnostic abstraction layer for defining infrastructure tables. This enables library developers to implement database drivers for PostgreSQL, SQLite, SQL Server, and custom databases while maintaining a single canonical schema definition.

:::note
This documentation is for **library developers** implementing database drivers. For application developers using Whizbang, see [PostgreSQL Data](../data/postgres-data.md) or [SQLite Data](../data/sqlite-data.md).
:::

---

## Why Schema Framework?

**Single Source of Truth**: Define infrastructure tables (outbox, inbox, event_store, etc.) once, generate SQL for multiple databases.

| Database | Without Framework | With Framework |
|----------|-------------------|----------------|
| **PostgreSQL** | Hand-write CREATE TABLE | Generate from TableDefinition |
| **SQLite** | Hand-write CREATE TABLE | Generate from TableDefinition |
| **SQL Server** | Hand-write CREATE TABLE | Generate from TableDefinition |
| **Dapper SQL** | Duplicate schema in SQL files | Generate from TableDefinition |
| **EF Core** | Duplicate schema in migrations | Generate from TableDefinition |

**Benefits**:
- ✅ **Single Canonical Definition** - Schema defined once in C# (e.g., OutboxSchema)
- ✅ **Type Safety** - Compile-time validation of column names and types
- ✅ **Database Portability** - Support PostgreSQL, SQLite, SQL Server from one definition
- ✅ **AOT Compatible** - Value-type records with structural equality
- ✅ **Incremental Generator Support** - ImmutableArray enables efficient source generation

---

## Architecture

### Core Types

```csharp
namespace Whizbang.Data.Schema;

// Complete table definition
public sealed record TableDefinition(
  string Name,
  ImmutableArray<ColumnDefinition> Columns,
  ImmutableArray<IndexDefinition> Indexes = default
);

// Column definition with type and constraints
public sealed record ColumnDefinition(
  string Name,
  WhizbangDataType DataType,
  int? MaxLength = null,
  bool Nullable = true,
  bool PrimaryKey = false,
  DefaultValue? DefaultValue = null
);

// Index definition (simple or composite)
public sealed record IndexDefinition(
  string Name,
  ImmutableArray<string> Columns,
  bool Unique = false,
  string? WhereClause = null
);

// Database-agnostic type system
public enum WhizbangDataType {
  Uuid,         // UUID/GUID
  String,       // VARCHAR/TEXT/NVARCHAR
  TimestampTz,  // TIMESTAMPTZ/DATETIMEOFFSET
  Json,         // JSONB/TEXT/NVARCHAR(MAX)
  BigInt,       // 64-bit integer
  Integer,      // 32-bit integer
  SmallInt,     // 16-bit integer
  Boolean       // BOOLEAN/BIT/INTEGER(0/1)
}

// Default value abstraction
public abstract record DefaultValue {
  public static DefaultValue Integer(int value) => new IntegerDefault(value);
  public static DefaultValue Function(DefaultValueFunction func) => new FunctionDefault(func);
}

// Database functions for defaults
public enum DefaultValueFunction {
  DateTime_Now,  // CURRENT_TIMESTAMP/NOW()/GETDATE()
  Guid_New       // gen_random_uuid()/NEWID()/uuid()
}
```

---

## Simple Table Example

### Pattern 1: Message Deduplication Table (2 Columns)

**Use Case**: Minimal table for permanent message deduplication tracking.

```csharp
using System.Collections.Immutable;
using Whizbang.Data.Schema;

public static class MessageDeduplicationSchema {
  public static readonly TableDefinition Table = new(
    Name: "message_deduplication",
    Columns: ImmutableArray.Create(
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.Uuid,
        PrimaryKey: true,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "first_seen_at",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DateTime_Now)
      )
    ),
    Indexes: ImmutableArray.Create(
      new IndexDefinition(
        Name: "idx_message_dedup_first_seen",
        Columns: ImmutableArray.Create("first_seen_at")
      )
    )
  );

  public static class Columns {
    public const string MessageId = "message_id";
    public const string FirstSeenAt = "first_seen_at";
  }
}
```

**Why This Works**:
- **Sealed record** - Value-type semantics with structural equality (critical for incremental generators)
- **ImmutableArray** - Enables value equality for collections (no reference equality issues)
- **Constants class** - Type-safe column name access in queries
- **AOT Compatible** - No reflection, all types known at compile time

---

## Complex Table Example

### Pattern 2: Outbox Table (18 Columns, 6 Indexes)

**Use Case**: Complete transactional outbox with work coordination, partitioning, and leasing.

```csharp
using System.Collections.Immutable;
using Whizbang.Data.Schema;

public static class OutboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "outbox",
    Columns: ImmutableArray.Create(
      // Identity
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.Uuid,
        PrimaryKey: true,
        Nullable: false
      ),
      // Routing
      new ColumnDefinition(
        Name: "destination",
        DataType: WhizbangDataType.String,
        MaxLength: 500,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "stream_id",
        DataType: WhizbangDataType.Uuid,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: "partition_number",
        DataType: WhizbangDataType.Integer,
        Nullable: true
      ),
      // Message content
      new ColumnDefinition(
        Name: "event_type",
        DataType: WhizbangDataType.String,
        MaxLength: 500,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "event_data",
        DataType: WhizbangDataType.Json,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "metadata",
        DataType: WhizbangDataType.Json,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "scope",
        DataType: WhizbangDataType.Json,
        Nullable: true
      ),
      // Work coordination
      new ColumnDefinition(
        Name: "status",
        DataType: WhizbangDataType.Integer,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(1)  // Stored = 1
      ),
      new ColumnDefinition(
        Name: "attempts",
        DataType: WhizbangDataType.Integer,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(0)
      ),
      new ColumnDefinition(
        Name: "error",
        DataType: WhizbangDataType.String,
        Nullable: true
      ),
      // Leasing
      new ColumnDefinition(
        Name: "instance_id",
        DataType: WhizbangDataType.Uuid,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: "lease_expiry",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: true
      ),
      // Failure tracking
      new ColumnDefinition(
        Name: "failure_reason",
        DataType: WhizbangDataType.Integer,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(99)  // None = 99
      ),
      new ColumnDefinition(
        Name: "scheduled_for",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: true
      ),
      // Timestamps
      new ColumnDefinition(
        Name: "created_at",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DateTime_Now)
      ),
      new ColumnDefinition(
        Name: "published_at",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: true
      ),
      // Flags
      new ColumnDefinition(
        Name: "is_event",
        DataType: WhizbangDataType.Boolean,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(0)  // false = 0
      )
    ),
    Indexes: ImmutableArray.Create(
      new IndexDefinition(
        Name: "idx_outbox_status_created_at",
        Columns: ImmutableArray.Create("status", "created_at")
      ),
      new IndexDefinition(
        Name: "idx_outbox_published_at",
        Columns: ImmutableArray.Create("published_at")
      ),
      new IndexDefinition(
        Name: "idx_outbox_lease_expiry",
        Columns: ImmutableArray.Create("lease_expiry"),
        WhereClause: "lease_expiry IS NOT NULL"
      ),
      new IndexDefinition(
        Name: "idx_outbox_status_lease",
        Columns: ImmutableArray.Create("status", "lease_expiry"),
        WhereClause: "(status & 32768) = 0 AND (status & 2) != 2"  // Not terminal, not completed
      ),
      new IndexDefinition(
        Name: "idx_outbox_failure_reason",
        Columns: ImmutableArray.Create("failure_reason"),
        WhereClause: "(status & 32768) = 32768"  // Terminal status
      ),
      new IndexDefinition(
        Name: "idx_outbox_scheduled_for",
        Columns: ImmutableArray.Create("stream_id", "scheduled_for", "created_at"),
        WhereClause: "scheduled_for IS NOT NULL"
      )
    )
  );

  public static class Columns {
    public const string MessageId = "message_id";
    public const string Destination = "destination";
    public const string StreamId = "stream_id";
    public const string PartitionNumber = "partition_number";
    public const string EventType = "event_type";
    public const string EventData = "event_data";
    public const string Metadata = "metadata";
    public const string Scope = "scope";
    public const string Status = "status";
    public const string Attempts = "attempts";
    public const string Error = "error";
    public const string InstanceId = "instance_id";
    public const string LeaseExpiry = "lease_expiry";
    public const string FailureReason = "failure_reason";
    public const string ScheduledFor = "scheduled_for";
    public const string CreatedAt = "created_at";
    public const string PublishedAt = "published_at";
    public const string IsEvent = "is_event";
  }
}
```

**Key Patterns**:
- **Composite Indexes** - Multi-column indexes for complex queries
- **Partial Indexes** - `WhereClause` for filtered indexes (PostgreSQL only)
- **Integer Defaults** - Enums stored as integers (status flags, failure reasons)
- **Optional Columns** - `Nullable: true` for conditional data (stream_id, error, etc.)

---

## PostgreSQL Schema Generator

### Pattern 3: Generating CREATE TABLE for PostgreSQL

**Use Case**: Convert TableDefinition to PostgreSQL DDL.

```csharp
using Whizbang.Data.Schema;
using System.Text;

public static class PostgresSchemaGenerator {
  public static string GenerateCreateTable(
    TableDefinition table,
    string prefix = "wh_"
  ) {
    var sb = new StringBuilder();
    var tableName = $"{prefix}{table.Name}";

    sb.AppendLine($"CREATE TABLE IF NOT EXISTS {tableName} (");

    // Columns
    var columns = table.Columns.Select(c => GenerateColumn(c));
    sb.AppendLine($"  {string.Join(",\n  ", columns)}");

    sb.AppendLine(");");

    // Indexes
    foreach (var index in table.Indexes) {
      sb.AppendLine();
      sb.AppendLine(GenerateIndex(tableName, index));
    }

    return sb.ToString();
  }

  private static string GenerateColumn(ColumnDefinition column) {
    var parts = new List<string> { column.Name, MapType(column) };

    if (!column.Nullable) {
      parts.Add("NOT NULL");
    }

    if (column.PrimaryKey) {
      parts.Add("PRIMARY KEY");
    }

    if (column.DefaultValue != null) {
      parts.Add($"DEFAULT {MapDefault(column.DefaultValue)}");
    }

    return string.Join(" ", parts);
  }

  private static string MapType(ColumnDefinition column) {
    return column.DataType switch {
      WhizbangDataType.Uuid => "UUID",
      WhizbangDataType.String => column.MaxLength.HasValue
        ? $"VARCHAR({column.MaxLength})"
        : "TEXT",
      WhizbangDataType.TimestampTz => "TIMESTAMPTZ",
      WhizbangDataType.Json => "JSONB",
      WhizbangDataType.BigInt => "BIGINT",
      WhizbangDataType.Integer => "INTEGER",
      WhizbangDataType.SmallInt => "SMALLINT",
      WhizbangDataType.Boolean => "BOOLEAN",
      _ => throw new NotSupportedException($"Unsupported type: {column.DataType}")
    };
  }

  private static string MapDefault(DefaultValue defaultValue) {
    return defaultValue switch {
      IntegerDefault i => i.Value.ToString(),
      FunctionDefault f => f.FunctionType switch {
        DefaultValueFunction.DateTime_Now => "CURRENT_TIMESTAMP",
        DefaultValueFunction.Guid_New => "gen_random_uuid()",
        _ => throw new NotSupportedException($"Unsupported function: {f.FunctionType}")
      },
      _ => throw new NotSupportedException($"Unsupported default: {defaultValue}")
    };
  }

  private static string GenerateIndex(string tableName, IndexDefinition index) {
    var sb = new StringBuilder();

    var uniqueKeyword = index.Unique ? "UNIQUE " : "";
    var columns = string.Join(", ", index.Columns);

    sb.Append($"CREATE {uniqueKeyword}INDEX IF NOT EXISTS {index.Name} ");
    sb.Append($"ON {tableName} ({columns})");

    if (!string.IsNullOrEmpty(index.WhereClause)) {
      sb.Append($" WHERE {index.WhereClause}");
    }

    sb.Append(";");

    return sb.ToString();
  }
}
```

**Usage**:
```csharp
var createTableSql = PostgresSchemaGenerator.GenerateCreateTable(
  OutboxSchema.Table,
  prefix: "wh_"
);

// Output:
// CREATE TABLE IF NOT EXISTS wh_outbox (
//   message_id UUID NOT NULL PRIMARY KEY,
//   destination VARCHAR(500) NOT NULL,
//   stream_id UUID,
//   ...
//   created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   published_at TIMESTAMPTZ
// );
//
// CREATE INDEX IF NOT EXISTS idx_outbox_status_created_at ON wh_outbox (status, created_at);
// ...
```

---

## SQLite Schema Generator

### Pattern 4: Generating CREATE TABLE for SQLite

**Use Case**: Convert TableDefinition to SQLite DDL (different type mappings).

```csharp
using Whizbang.Data.Schema;
using System.Text;

public static class SqliteSchemaGenerator {
  public static string GenerateCreateTable(
    TableDefinition table,
    string prefix = "wh_"
  ) {
    var sb = new StringBuilder();
    var tableName = $"{prefix}{table.Name}";

    sb.AppendLine($"CREATE TABLE IF NOT EXISTS {tableName} (");

    // Columns
    var columns = table.Columns.Select(c => GenerateColumn(c));
    sb.AppendLine($"  {string.Join(",\n  ", columns)}");

    sb.AppendLine(");");

    // Indexes
    foreach (var index in table.Indexes) {
      sb.AppendLine();
      sb.AppendLine(GenerateIndex(tableName, index));
    }

    return sb.ToString();
  }

  private static string GenerateColumn(ColumnDefinition column) {
    var parts = new List<string> { column.Name, MapType(column) };

    if (!column.Nullable) {
      parts.Add("NOT NULL");
    }

    if (column.PrimaryKey) {
      parts.Add("PRIMARY KEY");
    }

    if (column.DefaultValue != null) {
      parts.Add($"DEFAULT {MapDefault(column.DefaultValue)}");
    }

    return string.Join(" ", parts);
  }

  private static string MapType(ColumnDefinition column) {
    return column.DataType switch {
      WhizbangDataType.Uuid => "BLOB",  // SQLite stores UUIDs as BLOB
      WhizbangDataType.String => "TEXT",  // SQLite ignores VARCHAR length
      WhizbangDataType.TimestampTz => "TEXT",  // ISO8601 string
      WhizbangDataType.Json => "TEXT",  // JSON stored as TEXT
      WhizbangDataType.BigInt => "INTEGER",  // SQLite uses INTEGER for all ints
      WhizbangDataType.Integer => "INTEGER",
      WhizbangDataType.SmallInt => "INTEGER",
      WhizbangDataType.Boolean => "INTEGER",  // 0/1
      _ => throw new NotSupportedException($"Unsupported type: {column.DataType}")
    };
  }

  private static string MapDefault(DefaultValue defaultValue) {
    return defaultValue switch {
      IntegerDefault i => i.Value.ToString(),
      FunctionDefault f => f.FunctionType switch {
        DefaultValueFunction.DateTime_Now => "(datetime('now'))",
        DefaultValueFunction.Guid_New => "(randomblob(16))",  // Random UUID
        _ => throw new NotSupportedException($"Unsupported function: {f.FunctionType}")
      },
      _ => throw new NotSupportedException($"Unsupported default: {defaultValue}")
    };
  }

  private static string GenerateIndex(string tableName, IndexDefinition index) {
    var sb = new StringBuilder();

    var uniqueKeyword = index.Unique ? "UNIQUE " : "";
    var columns = string.Join(", ", index.Columns);

    sb.Append($"CREATE {uniqueKeyword}INDEX IF NOT EXISTS {index.Name} ");
    sb.Append($"ON {tableName} ({columns})");

    // SQLite supports WHERE clauses on indexes
    if (!string.IsNullOrEmpty(index.WhereClause)) {
      sb.Append($" WHERE {index.WhereClause}");
    }

    sb.Append(";");

    return sb.ToString();
  }
}
```

**Key Differences from PostgreSQL**:
- **UUID** - `BLOB` instead of native UUID type
- **TimestampTz** - `TEXT` (ISO8601 format) instead of TIMESTAMPTZ
- **JSON** - `TEXT` instead of JSONB
- **All Integer Types** - `INTEGER` (SQLite only has INTEGER affinity)
- **Boolean** - `INTEGER` (0/1) instead of BOOLEAN
- **Default Functions** - `datetime('now')` instead of CURRENT_TIMESTAMP

---

## Schema Configuration

### Pattern 5: Using SchemaConfiguration

**Use Case**: Generate schemas for all infrastructure tables with custom prefix.

```csharp
using Whizbang.Data.Schema;
using Whizbang.Data.Schema.Schemas;

public class SchemaConfiguration {
  public string Prefix { get; init; } = "wh_";

  public IReadOnlyList<TableDefinition> GetAllTables() {
    return new[] {
      OutboxSchema.Table,
      InboxSchema.Table,
      EventStoreSchema.Table,
      ReceptorProcessingSchema.Table,
      PerspectiveCheckpointsSchema.Table,
      ServiceInstancesSchema.Table,
      MessageDeduplicationSchema.Table,
      RequestResponseSchema.Table,
      SequencesSchema.Table
    };
  }

  public string GenerateFullSchema(ISchemaGenerator generator) {
    var sb = new StringBuilder();

    foreach (var table in GetAllTables()) {
      sb.AppendLine(generator.GenerateCreateTable(table, Prefix));
      sb.AppendLine();
    }

    return sb.ToString();
  }
}

public interface ISchemaGenerator {
  string GenerateCreateTable(TableDefinition table, string prefix);
}
```

**Usage**:
```csharp
var config = new SchemaConfiguration { Prefix = "prod_" };
var postgresGenerator = new PostgresSchemaGenerator();

var fullSchemaSql = config.GenerateFullSchema(postgresGenerator);

// Generates CREATE TABLE statements for all 9 infrastructure tables
// with "prod_" prefix (prod_outbox, prod_inbox, etc.)
```

---

## Testing Schema Generators

### Testing Table Generation

```csharp
using TUnit.Assertions;
using TUnit.Core;
using Whizbang.Data.Schema;

public class PostgresSchemaGeneratorTests {
  [Test]
  public async Task GenerateCreateTable_SimpleTable_GeneratesCorrectSqlAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test",
      Columns: ImmutableArray.Create(
        new ColumnDefinition(
          Name: "id",
          DataType: WhizbangDataType.Uuid,
          PrimaryKey: true,
          Nullable: false
        ),
        new ColumnDefinition(
          Name: "name",
          DataType: WhizbangDataType.String,
          MaxLength: 100,
          Nullable: false
        )
      )
    );

    // Act
    var sql = PostgresSchemaGenerator.GenerateCreateTable(table, prefix: "test_");

    // Assert
    await Assert.That(sql).Contains("CREATE TABLE IF NOT EXISTS test_test");
    await Assert.That(sql).Contains("id UUID NOT NULL PRIMARY KEY");
    await Assert.That(sql).Contains("name VARCHAR(100) NOT NULL");
  }

  [Test]
  public async Task GenerateCreateTable_WithIndexes_GeneratesIndexSqlAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test",
      Columns: ImmutableArray.Create(
        new ColumnDefinition(Name: "id", DataType: WhizbangDataType.Uuid, PrimaryKey: true, Nullable: false),
        new ColumnDefinition(Name: "created_at", DataType: WhizbangDataType.TimestampTz, Nullable: false)
      ),
      Indexes: ImmutableArray.Create(
        new IndexDefinition(
          Name: "idx_test_created_at",
          Columns: ImmutableArray.Create("created_at")
        )
      )
    );

    // Act
    var sql = PostgresSchemaGenerator.GenerateCreateTable(table, prefix: "test_");

    // Assert
    await Assert.That(sql).Contains("CREATE INDEX IF NOT EXISTS idx_test_created_at");
    await Assert.That(sql).Contains("ON test_test (created_at)");
  }

  [Test]
  public async Task GenerateCreateTable_WithDefaults_GeneratesDefaultsAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test",
      Columns: ImmutableArray.Create(
        new ColumnDefinition(Name: "id", DataType: WhizbangDataType.Uuid, PrimaryKey: true, Nullable: false),
        new ColumnDefinition(
          Name: "created_at",
          DataType: WhizbangDataType.TimestampTz,
          Nullable: false,
          DefaultValue: DefaultValue.Function(DefaultValueFunction.DateTime_Now)
        ),
        new ColumnDefinition(
          Name: "status",
          DataType: WhizbangDataType.Integer,
          Nullable: false,
          DefaultValue: DefaultValue.Integer(1)
        )
      )
    );

    // Act
    var sql = PostgresSchemaGenerator.GenerateCreateTable(table, prefix: "test_");

    // Assert
    await Assert.That(sql).Contains("created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await Assert.That(sql).Contains("status INTEGER NOT NULL DEFAULT 1");
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Use sealed record** for TableDefinition, ColumnDefinition, IndexDefinition (structural equality)
- ✅ **Use ImmutableArray** for collections (enables value equality)
- ✅ **Define column constants** in nested Columns class for type safety
- ✅ **Map database-agnostic types** correctly for each database (UUID → BLOB in SQLite, UUID in Postgres)
- ✅ **Support partial indexes** via WhereClause (PostgreSQL feature)
- ✅ **Test generated SQL** with real databases (Testcontainers)
- ✅ **Use default prefixes** ("wh_") but allow customization

### DON'T ❌

- ❌ Use class instead of sealed record (breaks structural equality)
- ❌ Use List or Array (reference equality, breaks incremental generators)
- ❌ Hardcode table names in queries (use Columns.ColumnName constants)
- ❌ Skip database-specific type mapping (VARCHAR(n) works in Postgres, not SQLite)
- ❌ Forget WHERE clauses on partial indexes (only supported in PostgreSQL)
- ❌ Mix schema definition and SQL generation (separate concerns)
- ❌ Use reflection for schema generation (breaks AOT)

---

## Further Reading

**Data Access**:
- [PostgreSQL Data](../data/postgres-data.md) - PostgreSQL implementation
- [SQLite Data](../data/sqlite-data.md) - SQLite implementation
- [Event Store](../data/event-store.md) - Event sourcing tables

**Extensibility**:
- [Custom Storage](custom-storage.md) - Custom perspective stores
- [Custom Work Coordinators](custom-work-coordinators.md) - Work coordination

**Infrastructure**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Transactional outbox
- [Work Coordination](../messaging/work-coordination.md) - Lease-based processing

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-16*
