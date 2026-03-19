---
title: Schema Generation Pattern
version: 1.0.0
category: Data Access
order: 6
description: >-
  Database-agnostic schema definitions with ISchemaBuilder for Postgres, SQLite,
  and custom database engines
tags: 'schema-generation, database, postgres, sqlite, ddl, ef-core, dapper, aot'
codeReferences:
  - src/Whizbang.Data.Schema/ISchemaBuilder.cs
  - src/Whizbang.Data.Schema/PostgresSchemaBuilder.cs
  - src/Whizbang.Data.Schema/TableDefinition.cs
  - src/Whizbang.Data.Schema/Schemas/InboxSchema.cs
  - src/Whizbang.Data.Schema/Schemas/OutboxSchema.cs
  - src/Whizbang.Data.Schema/Schemas/EventStoreSchema.cs
---

# Schema Generation Pattern

Whizbang uses a **database-agnostic schema definition pattern** where infrastructure schemas are defined once in C# and transformed into database-specific DDL via the `ISchemaBuilder` interface.

## Core Concept

**Problem**: Different databases (Postgres, SQLite, MySQL) have different DDL syntax, but the logical schema structure is the same.

**Solution**: Define schema once using `TableDefinition`, `ColumnDefinition`, `IndexDefinition`, then transform to database-specific SQL via `ISchemaBuilder` implementations.

```
┌─────────────────────────────┐
│  C# Schema Definitions      │
│  (Database-Agnostic)        │
│                             │
│  - InboxSchema              │
│  - OutboxSchema             │
│  - EventStoreSchema         │
│  - PerspectiveCheckpoints   │
└──────────────┬──────────────┘
               │
               ▼
      ┌────────────────┐
      │ ISchemaBuilder │
      └────────┬───────┘
               │
      ┌────────┼────────┐
      │        │        │
      ▼        ▼        ▼
┌─────────┐ ┌────────┐ ┌────────┐
│ Postgres│ │ SQLite │ │ MySQL  │
│ Builder │ │ Builder│ │ Builder│
└────┬────┘ └───┬────┘ └───┬────┘
     │          │           │
     ▼          ▼           ▼
  Postgres   SQLite      MySQL
    DDL        DDL         DDL
```

---

## ISchemaBuilder Interface

```csharp
public interface ISchemaBuilder {
  /// <summary>
  /// Database engine name (e.g., "Postgres", "SQLite", "MySQL").
  /// </summary>
  string DatabaseEngine { get; }

  /// <summary>
  /// Builds CREATE TABLE DDL for a single table.
  /// </summary>
  string BuildCreateTable(TableDefinition table, string prefix);

  /// <summary>
  /// Builds CREATE INDEX DDL for a single index.
  /// </summary>
  string BuildCreateIndex(IndexDefinition index, string tableName, string prefix);

  /// <summary>
  /// Builds CREATE SEQUENCE DDL for a single sequence.
  /// </summary>
  string BuildCreateSequence(SequenceDefinition sequence, string prefix);

  /// <summary>
  /// Builds complete infrastructure schema DDL.
  /// AUTHORITATIVE method - all consumers MUST use this for consistency.
  /// </summary>
  string BuildInfrastructureSchema(SchemaConfiguration config);

  /// <summary>
  /// Builds perspective table DDL.
  /// Fixed schema: stream_id (PK), data (JSON), version, updated_at.
  /// </summary>
  string BuildPerspectiveTable(string tableName);
}
```

**Key Methods**:
- `BuildInfrastructureSchema()` - **Primary method** for generating all infrastructure tables
- `BuildCreateTable()` - Individual table generation
- `BuildCreateIndex()` - Individual index generation
- `BuildPerspectiveTable()` - Perspective-specific tables with fixed schema

---

## Database-Agnostic Schema Definitions

### TableDefinition

```csharp
public sealed record TableDefinition(
  string Name,                                    // Table name without prefix
  ImmutableArray<ColumnDefinition> Columns,       // Column definitions
  ImmutableArray<IndexDefinition> Indexes,        // Index definitions
  ImmutableArray<UniqueConstraintDefinition> UniqueConstraints
);
```

**Example - Inbox Table**:

```csharp
using System.Collections.Immutable;
using Whizbang.Data.Schema;

public static class InboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "inbox",
    Columns: ImmutableArray.Create(
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.Uuid,
        PrimaryKey: true,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "handler_name",
        DataType: WhizbangDataType.String,
        MaxLength: 500,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "received_at",
        DataType: WhizbangDataType.TimestampTz,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DateTime_Now)
      )
    ),
    Indexes: ImmutableArray.Create(
      new IndexDefinition(
        Name: "idx_inbox_received_at",
        Columns: ImmutableArray.Create("received_at")
      )
    )
  );
}
```

### ColumnDefinition

```csharp
public sealed record ColumnDefinition(
  string Name,                     // Column name
  WhizbangDataType DataType,       // Database-agnostic type
  int? MaxLength = null,           // For strings
  bool PrimaryKey = false,         // Is primary key
  bool Nullable = false,           // Can be null
  bool Unique = false,             // Has unique constraint
  DefaultValue? DefaultValue = null // Default value
);
```

**WhizbangDataType Enum**:
```csharp
public enum WhizbangDataType {
  Uuid,           // UUID/GUID
  String,         // VARCHAR
  Integer,        // INT/BIGINT
  BigInt,         // BIGINT
  Boolean,        // BOOL
  TimestampTz,    // TIMESTAMPTZ
  Json,           // JSON/JSONB
  Decimal         // DECIMAL/NUMERIC
}
```

### IndexDefinition

```csharp
public sealed record IndexDefinition(
  string Name,                            // Index name
  ImmutableArray<string> Columns,         // Indexed columns
  bool Unique = false,                    // Unique index
  string? WhereClause = null              // Partial index (Postgres)
);
```

**Example - Partial Index**:
```csharp
new IndexDefinition(
  Name: "idx_inbox_lease_expiry",
  Columns: ImmutableArray.Create("lease_expiry"),
  WhereClause: "lease_expiry IS NOT NULL"  // Only index non-null
)
```

---

## PostgreSQL Implementation

### PostgresSchemaBuilder

```csharp
using Whizbang.Data.Schema;

public class PostgresSchemaBuilder : ISchemaBuilder {
  public string DatabaseEngine => "Postgres";

  public string BuildCreateTable(TableDefinition table, string prefix) {
    var tableName = $"{prefix}{table.Name}";

    // Generate: CREATE TABLE IF NOT EXISTS {tableName} ( ... );
    // - Handle composite primary keys
    // - Handle unique constraints
    // - Handle default values

    return sql;
  }

  public string BuildCreateIndex(IndexDefinition index, string tableName, string prefix) {
    var fullTableName = $"{prefix}{tableName}";
    var unique = index.Unique ? "UNIQUE " : "";
    var columns = string.Join(", ", index.Columns);
    var whereClause = index.WhereClause != null ? $" WHERE {index.WhereClause}" : "";

    return $"CREATE {unique}INDEX IF NOT EXISTS {index.Name} ON {fullTableName} ({columns}){whereClause};";
  }

  public string BuildInfrastructureSchema(SchemaConfiguration config) {
    var sb = new StringBuilder();

    // Generate all infrastructure tables
    var tables = new[] {
      InboxSchema.Table,
      OutboxSchema.Table,
      EventStoreSchema.Table,
      PerspectiveCheckpointsSchema.Table,
      // ... etc
    };

    foreach (var table in tables) {
      sb.AppendLine(BuildCreateTable(table, config.InfrastructurePrefix));

      foreach (var index in table.Indexes) {
        sb.AppendLine(BuildCreateIndex(index, table.Name, config.InfrastructurePrefix));
      }
    }

    return sb.ToString();
  }
}
```

**Type Mapping - Postgres**:
```csharp
internal static class PostgresTypeMapper {
  public static string MapDataType(WhizbangDataType type, int? maxLength) {
    return type switch {
      WhizbangDataType.Uuid => "UUID",
      WhizbangDataType.String => maxLength.HasValue
        ? $"VARCHAR({maxLength.Value})"
        : "TEXT",
      WhizbangDataType.Integer => "INT",
      WhizbangDataType.BigInt => "BIGINT",
      WhizbangDataType.Boolean => "BOOLEAN",
      WhizbangDataType.TimestampTz => "TIMESTAMPTZ",
      WhizbangDataType.Json => "JSONB",  // Postgres-specific: JSONB not JSON
      WhizbangDataType.Decimal => "DECIMAL(18,2)",
      _ => throw new ArgumentException($"Unsupported data type: {type}")
    };
  }
}
```

---

## Usage Patterns

### Pattern 1: EF Core Migration Generator

```csharp
using Whizbang.Data.Schema;
using Whizbang.Data.Postgres.Schema;

public class InfrastructureMigration {
  public void BuildSchema(MigrationBuilder migrationBuilder) {
    var builder = new PostgresSchemaBuilder();
    var config = new SchemaConfiguration {
      InfrastructurePrefix = "wh_",
      PerspectivePrefix = "wh_per_"
    };

    // Generate complete DDL
    var ddl = builder.BuildInfrastructureSchema(config);

    // Execute via EF Core
    migrationBuilder.Sql(ddl);
  }
}
```

### Pattern 2: Dapper Embedded Schema

```csharp
using Whizbang.Data.Schema;
using Whizbang.Data.Postgres.Schema;

public class PostgresDatabaseInitializer {
  private readonly IDbConnection _connection;

  public async Task InitializeSchemaAsync() {
    var builder = new PostgresSchemaBuilder();
    var config = new SchemaConfiguration {
      InfrastructurePrefix = "wh_",
      PerspectivePrefix = "wh_per_"
    };

    var ddl = builder.BuildInfrastructureSchema(config);

    // Execute directly with Dapper
    await _connection.ExecuteAsync(ddl);
  }
}
```

### Pattern 3: Custom Perspective Tables

```csharp
using Whizbang.Data.Schema;
using Whizbang.Data.Postgres.Schema;

public class PerspectiveSchemaGenerator {
  public string GeneratePerspectiveTable<TModel>() {
    var builder = new PostgresSchemaBuilder();
    var tableName = $"wh_per_{typeof(TModel).Name.ToLower()}";

    // Perspective tables have fixed schema:
    // - stream_id UUID PRIMARY KEY
    // - data JSONB NOT NULL
    // - version BIGINT NOT NULL
    // - updated_at TIMESTAMPTZ NOT NULL
    return builder.BuildPerspectiveTable(tableName);
  }
}
```

---

## SchemaConfiguration

```csharp
public record SchemaConfiguration {
  /// <summary>
  /// Prefix for infrastructure tables (inbox, outbox, events).
  /// Default: "wh_"
  /// </summary>
  public string InfrastructurePrefix { get; init; } = "wh_";

  /// <summary>
  /// Prefix for perspective tables (read models).
  /// Default: "wh_per_"
  /// </summary>
  public string PerspectivePrefix { get; init; } = "wh_per_";
}
```

**Example Prefixes**:
```
Infrastructure Tables:
- wh_inbox
- wh_outbox
- wh_events
- wh_perspective_checkpoints

Perspective Tables:
- wh_per_product_catalog
- wh_per_order_summary
- wh_per_customer_statistics
```

---

## Infrastructure Schemas

Whizbang provides pre-defined schemas for core infrastructure:

### InboxSchema

```csharp
public static class InboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "inbox",
    Columns: ImmutableArray.Create(
      // message_id (PK)
      // handler_name
      // event_type
      // event_data (JSONB)
      // metadata (JSONB)
      // status, attempts, error
      // lease_expiry, instance_id
      // received_at, processed_at
    ),
    Indexes: ImmutableArray.Create(
      // idx_inbox_received_at
      // idx_inbox_lease_expiry (partial: WHERE lease_expiry IS NOT NULL)
      // idx_inbox_status_lease (partial: for claiming work)
    )
  );
}
```

### OutboxSchema

```csharp
public static class OutboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "outbox",
    Columns: ImmutableArray.Create(
      // message_id (PK)
      // correlation_id, causation_id
      // message_type
      // payload (JSONB)
      // topic, stream_key, partition_key
      // status, attempts, error
      // lease_expiry, instance_id
      // created_at, processed_at
    ),
    Indexes: ImmutableArray.Create(
      // idx_outbox_created_at
      // idx_outbox_lease_expiry (partial)
      // idx_outbox_status_lease (partial)
    )
  );
}
```

### EventStoreSchema

```csharp
public static class EventStoreSchema {
  public static readonly TableDefinition Table = new(
    Name: "events",
    Columns: ImmutableArray.Create(
      // event_id (PK, UUIDv7)
      // stream_id (UUID)
      // sequence_number (per stream)
      // global_sequence (across all streams)
      // event_type
      // event_data (JSONB)
      // metadata (JSONB)
      // timestamp
    ),
    Indexes: ImmutableArray.Create(
      // idx_events_stream_id_sequence (for event replay)
      // idx_events_global_sequence (for global ordering)
    ),
    UniqueConstraints: ImmutableArray.Create(
      new UniqueConstraintDefinition(
        Name: "uq_events_stream_sequence",
        Columns: ImmutableArray.Create("stream_id", "sequence_number")
      )
    )
  );
}
```

### PerspectiveCheckpointsSchema

```csharp
public static class PerspectiveCheckpointsSchema {
  public static readonly TableDefinition Table = new(
    Name: "perspective_checkpoints",
    Columns: ImmutableArray.Create(
      // stream_id (composite PK)
      // perspective_name (composite PK)
      // last_event_id
      // last_sequence_number
      // status
      // error_message
      // updated_at
    ),
    Indexes: ImmutableArray.Create(
      // idx_perspective_checkpoints_status
      // idx_perspective_checkpoints_updated_at
    )
  );
}
```

---

## Testing Schema Generation

### Unit Test Pattern

```csharp
using TUnit.Assertions;
using TUnit.Core;
using Whizbang.Data.Schema;
using Whizbang.Data.Postgres.Schema;

public class PostgresSchemaBuilderTests {
  [Test]
  public async Task BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test_table",
      Columns: ImmutableArray.Create(
        new ColumnDefinition("id", WhizbangDataType.Uuid, PrimaryKey: true),
        new ColumnDefinition("name", WhizbangDataType.String, MaxLength: 100)
      )
    );

    var builder = new PostgresSchemaBuilder();

    // Act
    var sql = builder.BuildCreateTable(table, "wh_");

    // Assert
    await Assert.That(sql).Contains("CREATE TABLE IF NOT EXISTS wh_test_table");
    await Assert.That(sql).Contains("id UUID");
    await Assert.That(sql).Contains("name VARCHAR(100)");
    await Assert.That(sql).Contains("PRIMARY KEY");
  }

  [Test]
  public async Task BuildInfrastructureSchema_GeneratesAllTablesAsync() {
    // Arrange
    var builder = new PostgresSchemaBuilder();
    var config = new SchemaConfiguration {
      InfrastructurePrefix = "wh_",
      PerspectivePrefix = "wh_per_"
    };

    // Act
    var ddl = builder.BuildInfrastructureSchema(config);

    // Assert - all infrastructure tables present
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_inbox");
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_outbox");
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_events");
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_perspective_checkpoints");
  }
}
```

---

## Implementing Custom Database Support

### Step 1: Create ISchemaBuilder Implementation

```csharp
using Whizbang.Data.Schema;

public class MySqlSchemaBuilder : ISchemaBuilder {
  public string DatabaseEngine => "MySQL";

  public string BuildCreateTable(TableDefinition table, string prefix) {
    // Implement MySQL-specific DDL syntax
    // - AUTO_INCREMENT instead of SERIAL
    // - Different JSON type name
    // - Different timestamp syntax
  }

  public string BuildCreateIndex(IndexDefinition index, string tableName, string prefix) {
    // MySQL: CREATE INDEX idx_name ON table_name (columns);
  }

  public string BuildInfrastructureSchema(SchemaConfiguration config) {
    // Same logic as Postgres, different SQL syntax
  }

  public string BuildPerspectiveTable(string tableName) {
    // MySQL perspective table DDL
  }
}
```

### Step 2: Implement Type Mapper

```csharp
internal static class MySqlTypeMapper {
  public static string MapDataType(WhizbangDataType type, int? maxLength) {
    return type switch {
      WhizbangDataType.Uuid => "CHAR(36)",  // MySQL doesn't have UUID type
      WhizbangDataType.String => maxLength.HasValue
        ? $"VARCHAR({maxLength.Value})"
        : "TEXT",
      WhizbangDataType.Integer => "INT",
      WhizbangDataType.BigInt => "BIGINT",
      WhizbangDataType.Boolean => "TINYINT(1)",  // MySQL bool
      WhizbangDataType.TimestampTz => "DATETIME",  // No TZ in MySQL < 8.0.19
      WhizbangDataType.Json => "JSON",  // MySQL 5.7+
      WhizbangDataType.Decimal => "DECIMAL(18,2)",
      _ => throw new ArgumentException($"Unsupported data type: {type}")
    };
  }
}
```

---

## Best Practices

### DO ✅

- ✅ Define schemas once in C# using `TableDefinition`
- ✅ Use `ImmutableArray` for collections (value equality)
- ✅ Implement `ISchemaBuilder` for each database engine
- ✅ Use `BuildInfrastructureSchema()` as authoritative source
- ✅ Test generated DDL compiles and executes
- ✅ Use sealed records for all schema types (caching!)
- ✅ Provide default values via `DefaultValue` types
- ✅ Use partial indexes (`WhereClause`) for performance

### DON'T ❌

- ❌ Manually write DDL strings
- ❌ Duplicate schema definitions per database
- ❌ Use database-specific types in schema definitions
- ❌ Forget to test generated DDL against real database
- ❌ Skip indexes on frequently queried columns
- ❌ Use reflection for schema generation (AOT incompatible)

---

## Further Reading

**Data Access**:
- [Event Store](event-store.md) - Event sourcing schema and storage
- [Perspective Storage](perspectives-storage.md) - Read model schema patterns

**Extensibility**:
- [Database Schema Framework](../extensibility/database-schema-framework.md) - Complete framework overview

**Source Generators**:
- [Perspective Schema Generator](../source-generators/perspective-schema-generator.md) - Auto-generate perspective tables

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Transactional messaging schema
- [Inbox Pattern](../messaging/inbox-pattern.md) - Deduplication schema

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-22*
