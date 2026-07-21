---
title: Database Schema Framework
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Data.Schema/UniqueConstraintDefinition.cs
  - src/Whizbang.Data.Schema/SequenceDefinition.cs
  - src/Whizbang.Data.Schema/WhizbangDataType.cs
  - src/Whizbang.Data.Schema/DefaultValue.cs
  - src/Whizbang.Data.Schema/DefaultValueFunction.cs
  - src/Whizbang.Data.Schema/SchemaConfiguration.cs
  - src/Whizbang.Data.Schema/ISchemaBuilder.cs
  - src/Whizbang.Data.Schema/PostgresSchemaBuilder.cs
  - src/Whizbang.Data.Schema/PostgresTypeMapper.cs
  - src/Whizbang.Data.Schema/Schemas/OutboxSchema.cs
  - src/Whizbang.Data.Schema/Schemas/MessageDeduplicationSchema.cs
  - src/Whizbang.Data.Dapper.Sqlite/Schema/SqliteSchemaBuilder.cs
testReferences:
  - tests/Whizbang.Data.Schema.Tests/TableDefinitionTests.cs
  - tests/Whizbang.Data.Schema.Tests/ColumnDefinitionTests.cs
  - tests/Whizbang.Data.Schema.Tests/IndexDefinitionTests.cs
  - tests/Whizbang.Data.Schema.Tests/WhizbangDataTypeTests.cs
  - tests/Whizbang.Data.Schema.Tests/DefaultValueTests.cs
  - tests/Whizbang.Data.Schema.Tests/SchemaConfigurationTests.cs
  - tests/Whizbang.Data.Schema.Tests/PostgresSchemaBuilderTests.cs
  - tests/Whizbang.Data.Schema.Tests/PostgresTypeMapperTests.cs
  - tests/Whizbang.Data.Schema.Tests/SqliteSchemaBuilderTests.cs
  - tests/Whizbang.Data.Schema.Tests/SqliteTypeMapperTests.cs
  - tests/Whizbang.Data.Schema.Tests/ISchemaBuilderContractTests.cs
lastMaintainedCommit: '01f07906'
---

# Database Schema Framework

**The Whizbang.Data.Schema framework** provides a database-agnostic abstraction layer for defining infrastructure tables. This enables library developers to implement database drivers for PostgreSQL, SQLite, SQL Server, and custom databases while maintaining a single canonical schema definition.

:::note
This documentation is for **library developers** implementing database drivers. For application developers using Whizbang, see PostgreSQL Data or SQLite Data.
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

```csharp{title="Core Types" description="Core Types" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Core", "Types"] tests=["ColumnDefinitionTests.ColumnDefinition_WithoutOptionalProperties_UsesDefaultsAsync", "ColumnDefinitionTests.ColumnDefinition_WithAllProperties_SetsAllAsync", "TableDefinitionTests.TableDefinition_WithRequiredProperties_CreatesInstanceAsync", "IndexDefinitionTests.IndexDefinition_WithoutOptionalProperties_UsesDefaultsAsync", "WhizbangDataTypeTests.WhizbangDataType_HasExactlyEightTypesAsync", "WhizbangDataTypeTests.WhizbangDataType_ToStringReturnsCorrectNamesAsync", "DefaultValueTests.DefaultValue_FunctionFactory_ReturnsFunctionDefaultAsync", "DefaultValueTests.DefaultValueFunction_HasExactlyFiveValuesAsync"]}
namespace Whizbang.Data.Schema;

// Complete table definition
public sealed record TableDefinition(
  string Name,
  ImmutableArray<ColumnDefinition> Columns,
  ImmutableArray<IndexDefinition> Indexes = default,
  ImmutableArray<UniqueConstraintDefinition> UniqueConstraints = default
);

// Column definition with type and constraints
// NOTE: Nullable defaults to FALSE (columns are NOT NULL unless opted in)
public sealed record ColumnDefinition(
  string Name,
  WhizbangDataType DataType,
  bool Nullable = false,
  bool PrimaryKey = false,
  bool Unique = false,
  int? MaxLength = null,
  DefaultValue? DefaultValue = null
);

// Index definition (simple or composite)
public sealed record IndexDefinition(
  string Name,
  ImmutableArray<string> Columns,
  bool Unique = false,
  string? WhereClause = null
);

// Multi-column unique constraint (emitted as CONSTRAINT ... UNIQUE (...))
public sealed record UniqueConstraintDefinition(
  string Name,
  ImmutableArray<string> Columns
);

// Database-agnostic type system
public enum WhizbangDataType {
  UUID,          // UUID (Postgres), BLOB (SQLite), UNIQUEIDENTIFIER (SQL Server)
  STRING,        // VARCHAR(n)/TEXT, TEXT, NVARCHAR(n)
  TIMESTAMP_TZ,  // TIMESTAMPTZ, TEXT (ISO8601), DATETIMEOFFSET
  JSON,          // JSONB, TEXT, NVARCHAR(MAX)
  BIG_INT,       // 64-bit integer
  INTEGER,       // 32-bit integer
  SMALL_INT,     // 16-bit integer
  BOOLEAN        // BOOLEAN, INTEGER 0/1, BIT
}

// Default value abstraction (sealed record variants for structural equality)
public abstract record DefaultValue {
  public static DefaultValue Function(DefaultValueFunction function) => new FunctionDefault(function);
  public static DefaultValue Integer(int value) => new IntegerDefault(value);
  public static DefaultValue String(string value) => new StringDefault(value);
  public static DefaultValue Boolean(bool value) => new BooleanDefault(value);
  public static DefaultValue Null => NullDefault.Instance;
}

// Database functions for defaults
public enum DefaultValueFunction {
  DATE_TIME__NOW,      // CURRENT_TIMESTAMP (Postgres/SQLite/SQL Server)
  DATE_TIME__UTC_NOW,  // (NOW() AT TIME ZONE 'UTC') / datetime('now','utc') / GETUTCDATE()
  UUID__GENERATE,      // gen_random_uuid() / randomblob(16) / NEWID()
  BOOLEAN__TRUE,       // TRUE / 1
  BOOLEAN__FALSE       // FALSE / 0
}
```

### ISchemaBuilder — the driver contract

Database drivers implement `ISchemaBuilder` to turn these definitions into DDL. Whizbang ships `PostgresSchemaBuilder` (in `Whizbang.Data.Schema`) and `SqliteSchemaBuilder` (in `Whizbang.Data.Dapper.Sqlite`).

```csharp{title="ISchemaBuilder Interface" description="ISchemaBuilder Interface" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "ISchemaBuilder", "Interface"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildCreateIndex_SimpleIndex_GeneratesCreateIndexAsync", "PostgresSchemaBuilderTests.BuildCreateSequence_SimpleSequence_GeneratesCreateSequenceAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
namespace Whizbang.Data.Schema;

public interface ISchemaBuilder {
  // Database engine name (e.g., "Postgres", "SQLite", "MySQL")
  string DatabaseEngine { get; }

  // CREATE TABLE for a single table (with optional schema qualification)
  string BuildCreateTable(TableDefinition table, string prefix, string? schema = null);

  // CREATE INDEX for a single index
  string BuildCreateIndex(IndexDefinition index, string tableName, string prefix, string? schema = null);

  // CREATE SEQUENCE for a single sequence
  string BuildCreateSequence(SequenceDefinition sequence, string prefix, string? schema = null);

  // Complete infrastructure schema DDL (all tables + indexes + sequences)
  // This is the AUTHORITATIVE method - all consumers MUST use this for consistency
  string BuildInfrastructureSchema(SchemaConfiguration config);

  // Perspective table DDL (fixed schema: id, data, metadata, scope, timestamps, version)
  string BuildPerspectiveTable(string tableName);
}
```

---

## Simple Table Example

### Pattern 1: Message Deduplication Table (2 Columns)

**Use Case**: Minimal table for permanent message deduplication tracking.

```csharp{title="Pattern 1: Message Deduplication Table (2 Columns)" description="Use Case: Minimal table for permanent message deduplication tracking." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Message"] tests=["MessageDeduplicationSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "MessageDeduplicationSchemaTests.Table_ShouldDefinePrimaryKeyAsync", "MessageDeduplicationSchemaTests.Table_ShouldDefineIndexesAsync", "MessageDeduplicationSchemaTests.Table_FirstSeenAtColumn_ShouldHaveDefaultValueAsync", "MessageDeduplicationSchemaTests.Columns_ShouldProvideTypeConstantsAsync"]}
using System.Collections.Immutable;
using Whizbang.Data.Schema;

public static class MessageDeduplicationSchema {
  public static readonly TableDefinition Table = new(
    Name: "message_deduplication",
    Columns: [
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.UUID,
        Nullable: false,
        PrimaryKey: true
      ),
      new ColumnDefinition(
        Name: "first_seen_at",
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DATE_TIME__NOW)
      )
    ],
    Indexes: [
      new IndexDefinition(
        Name: "idx_message_dedup_first_seen",
        Columns: ["first_seen_at"]
      )
    ]
  );

  public static class Columns {
    public const string MESSAGE_ID = "message_id";
    public const string FIRST_SEEN_AT = "first_seen_at";
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

### Pattern 2: Outbox Table (21 Columns, 8 Indexes)

**Use Case**: Complete transactional outbox with work coordination, partitioning, and leasing. This is the actual `OutboxSchema` shipped in `Whizbang.Data.Schema.Schemas`.

```csharp{title="Pattern 2: Outbox Table (21 Columns, 8 Indexes)" description="Use Case: Complete transactional outbox with work coordination, partitioning, and leasing." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Outbox"] tests=["OutboxSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "OutboxSchemaTests.Table_ShouldDefineCorrectIndexesAsync", "OutboxSchemaTests.Table_ShouldHavePrimaryKeyAsync", "OutboxSchemaTests.Table_ColumnDefaults_ShouldBeCorrectAsync", "OutboxSchemaTests.Columns_ShouldProvideAllConstantsAsync"]}
using System.Collections.Immutable;

namespace Whizbang.Data.Schema.Schemas;

public static class OutboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "outbox",
    Columns: ImmutableArray.Create(
      // Identity
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.UUID,
        Nullable: false,
        PrimaryKey: true
      ),
      // Routing
      new ColumnDefinition(
        Name: "destination",
        DataType: WhizbangDataType.STRING,
        Nullable: true,  // Events don't have destinations, only outbound commands/messages do
        MaxLength: 500
      ),
      // Message content / typing
      new ColumnDefinition(
        Name: "message_type",
        DataType: WhizbangDataType.STRING,
        Nullable: false,
        MaxLength: 500
      ),
      new ColumnDefinition(
        Name: "envelope_type",
        DataType: WhizbangDataType.STRING,
        Nullable: true,
        MaxLength: 500
      ),
      new ColumnDefinition(
        Name: "event_data",
        DataType: WhizbangDataType.JSON,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "metadata",
        DataType: WhizbangDataType.JSON,
        Nullable: false
      ),
      new ColumnDefinition(
        Name: "scope",
        DataType: WhizbangDataType.JSON,
        Nullable: true
      ),
      // Stream ordering / partitioning
      new ColumnDefinition(
        Name: "stream_id",
        DataType: WhizbangDataType.UUID,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: "partition_number",
        DataType: WhizbangDataType.INTEGER,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: "is_event",
        DataType: WhizbangDataType.BOOLEAN,
        Nullable: false,
        DefaultValue: DefaultValue.Boolean(false)
      ),
      // Work coordination
      new ColumnDefinition(
        Name: Columns.STATUS,
        DataType: WhizbangDataType.INTEGER,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(1)  // Stored = 1
      ),
      new ColumnDefinition(
        Name: Columns.ATTEMPTS,
        DataType: WhizbangDataType.INTEGER,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(0)
      ),
      new ColumnDefinition(
        Name: Columns.ERROR,
        DataType: WhizbangDataType.STRING,
        Nullable: true
      ),
      // Leasing
      new ColumnDefinition(
        Name: Columns.INSTANCE_ID,
        DataType: WhizbangDataType.UUID,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: Columns.LEASE_EXPIRY,
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: true
      ),
      // Failure tracking
      new ColumnDefinition(
        Name: Columns.FAILURE_REASON,
        DataType: WhizbangDataType.INTEGER,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(99)  // None = 99
      ),
      new ColumnDefinition(
        Name: Columns.SCHEDULED_FOR,
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: true
      ),
      // Timestamps
      new ColumnDefinition(
        Name: Columns.CREATED_AT,
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DATE_TIME__NOW)
      ),
      new ColumnDefinition(
        Name: "published_at",
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: true
      ),
      new ColumnDefinition(
        Name: "processed_at",
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: true
      ),
      // Event-categorization bitmask (EventFlags: Composite, Collective, ...)
      new ColumnDefinition(
        Name: Columns.FLAGS,
        DataType: WhizbangDataType.INTEGER,
        Nullable: false,
        DefaultValue: DefaultValue.Integer(0)
      )
    ),
    Indexes: ImmutableArray.Create(
      new IndexDefinition(
        Name: "idx_outbox_status_created_at",
        Columns: [Columns.STATUS, Columns.CREATED_AT]
      ),
      new IndexDefinition(
        Name: "idx_outbox_published_at",
        Columns: [Columns.PUBLISHED_AT]
      ),
      new IndexDefinition(
        Name: "idx_outbox_lease_expiry",
        Columns: [Columns.LEASE_EXPIRY],
        WhereClause: "lease_expiry IS NOT NULL"
      ),
      new IndexDefinition(
        Name: "idx_outbox_status_lease",
        Columns: [Columns.STATUS, Columns.LEASE_EXPIRY],
        WhereClause: "(status & 32768) = 0 AND (status & 4) != 4"  // Not terminal, not processed
      ),
      new IndexDefinition(
        Name: "idx_outbox_failure_reason",
        Columns: [Columns.FAILURE_REASON],
        WhereClause: "(status & 32768) = 32768"  // Terminal status
      ),
      new IndexDefinition(
        Name: "idx_outbox_scheduled_for",
        Columns: [Columns.STREAM_ID, Columns.SCHEDULED_FOR, Columns.CREATED_AT],
        WhereClause: "scheduled_for IS NOT NULL"
      ),
      new IndexDefinition(
        Name: "idx_outbox_partition_claiming",
        Columns: [Columns.PARTITION_NUMBER, Columns.SCHEDULED_FOR, Columns.CREATED_AT],
        WhereClause: "(status & 4) != 4 AND (status & 32768) = 0"
      ),
      new IndexDefinition(
        Name: "idx_outbox_instance_lease",
        Columns: [Columns.INSTANCE_ID, Columns.LEASE_EXPIRY],
        WhereClause: "instance_id IS NOT NULL AND lease_expiry IS NOT NULL"
      )
    )
  );

  public static class Columns {
    public const string MESSAGE_ID = "message_id";
    public const string DESTINATION = "destination";
    public const string MESSAGE_TYPE = "message_type";
    public const string ENVELOPE_TYPE = "envelope_type";
    public const string EVENT_DATA = "event_data";
    public const string METADATA = "metadata";
    public const string SCOPE = "scope";
    public const string STREAM_ID = "stream_id";
    public const string PARTITION_NUMBER = "partition_number";
    public const string IS_EVENT = "is_event";
    public const string STATUS = "status";
    public const string ATTEMPTS = "attempts";
    public const string ERROR = "error";
    public const string INSTANCE_ID = "instance_id";
    public const string LEASE_EXPIRY = "lease_expiry";
    public const string FAILURE_REASON = "failure_reason";
    public const string SCHEDULED_FOR = "scheduled_for";
    public const string CREATED_AT = "created_at";
    public const string PUBLISHED_AT = "published_at";
    public const string PROCESSED_AT = "processed_at";
    public const string FLAGS = "flags";
  }
}
```

**Key Patterns**:
- **Composite Indexes** - Multi-column indexes for complex queries
- **Partial Indexes** - `WhereClause` for filtered indexes (PostgreSQL only)
- **Integer Defaults** - Enums stored as integers (status flags, failure reasons)
- **Optional Columns** - `Nullable: true` for conditional data (stream_id, error, etc.)

---

## PostgreSQL Schema Builder

### Pattern 3: Generating CREATE TABLE for PostgreSQL

**Use Case**: Convert TableDefinition to PostgreSQL DDL using the shipped `PostgresSchemaBuilder`.

```csharp{title="Pattern 3: Generating CREATE TABLE for PostgreSQL" description="Use Case: Convert TableDefinition to PostgreSQL DDL." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Generating"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildCreateTable_WithDefaultValue_GeneratesDefaultClauseAsync", "PostgresSchemaBuilderTests.BuildCreateIndex_SimpleIndex_GeneratesCreateIndexAsync", "PostgresSchemaBuilderTests.BuildCreateTable_EmitsAlterTableAddColumnIfNotExistsPerColumnAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_OutboxTable_HasCorrectDefaultsAsync"]}
using Whizbang.Data.Schema;
using Whizbang.Data.Schema.Schemas;

ISchemaBuilder builder = new PostgresSchemaBuilder();

// Single table (with optional schema qualification for service isolation)
var createTableSql = builder.BuildCreateTable(OutboxSchema.Table, prefix: "wh_");

// Single index
var createIndexSql = builder.BuildCreateIndex(
  OutboxSchema.Table.Indexes[0],
  tableName: OutboxSchema.Table.Name,
  prefix: "wh_"
);

// Output (abridged):
// CREATE TABLE IF NOT EXISTS wh_outbox (
//   message_id UUID NOT NULL PRIMARY KEY,
//   destination VARCHAR(500) NULL,
//   message_type VARCHAR(500) NOT NULL,
//   ...
//   created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   published_at TIMESTAMPTZ NULL
// );
// ALTER TABLE wh_outbox ADD COLUMN IF NOT EXISTS ...;  -- idempotent column backfill
//
// CREATE INDEX IF NOT EXISTS idx_outbox_status_created_at ON wh_outbox (status, created_at);
```

**Postgres type/default mapping** lives in the static `PostgresTypeMapper`:

| WhizbangDataType | Postgres DDL |
|------------------|--------------|
| `UUID` | `UUID` |
| `STRING` | `VARCHAR(n)` with MaxLength, else `TEXT` |
| `TIMESTAMP_TZ` | `TIMESTAMPTZ` |
| `JSON` | `JSONB` |
| `BIG_INT` / `INTEGER` / `SMALL_INT` | `BIGINT` / `INTEGER` / `SMALLINT` |
| `BOOLEAN` | `BOOLEAN` |

| DefaultValueFunction | Postgres DDL |
|----------------------|--------------|
| `DATE_TIME__NOW` | `CURRENT_TIMESTAMP` |
| `DATE_TIME__UTC_NOW` | `(NOW() AT TIME ZONE 'UTC')` |
| `UUID__GENERATE` | `gen_random_uuid()` |
| `BOOLEAN__TRUE` / `BOOLEAN__FALSE` | `TRUE` / `FALSE` |

:::note
`BuildCreateTable` also emits `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every column after the `CREATE TABLE IF NOT EXISTS` statement. This keeps schema builds idempotent: fresh databases get columns from CREATE TABLE; existing databases get newly-added columns backfilled.
:::

---

## SQLite Schema Builder

### Pattern 4: Implementing ISchemaBuilder for Another Database

**Use Case**: Support a database with different type mappings. Whizbang ships `SqliteSchemaBuilder` (in `Whizbang.Data.Dapper.Sqlite`) — its type mapper shows the pattern to follow for a custom database:

```csharp{title="Pattern 4: Implementing ISchemaBuilder for Another Database" description="Type mapping pattern from the shipped SqliteTypeMapper." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Generating"] tests=["SqliteTypeMapperTests.MapDataType_Uuid_ReturnsTextAsync", "SqliteTypeMapperTests.MapDataType_TimestampTz_ReturnsTextAsync", "SqliteTypeMapperTests.MapDataType_Json_ReturnsTextAsync", "SqliteTypeMapperTests.MapDataType_Boolean_ReturnsIntegerAsync", "SqliteTypeMapperTests.MapDefaultValue_FunctionUuidGenerate_ReturnsLowerHexAsync", "SqliteTypeMapperTests.MapDefaultValue_FunctionDateTimeUtcNow_ReturnsDatetimeUtcAsync"]}
using Whizbang.Data.Schema;

public class SqliteSchemaBuilder : ISchemaBuilder {
  public string DatabaseEngine => "SQLite";

  // BuildCreateTable / BuildCreateIndex / BuildCreateSequence /
  // BuildInfrastructureSchema / BuildPerspectiveTable use a type mapper:

  private static string MapDataType(WhizbangDataType dataType) {
    return dataType switch {
      WhizbangDataType.UUID => "TEXT",          // Stored as lowercase hex string
      WhizbangDataType.STRING => "TEXT",        // SQLite ignores VARCHAR length
      WhizbangDataType.TIMESTAMP_TZ => "TEXT",  // ISO8601 string
      WhizbangDataType.JSON => "TEXT",          // JSON as text (JSON1 extension for querying)
      WhizbangDataType.BIG_INT => "INTEGER",    // SQLite uses INTEGER affinity for all ints
      WhizbangDataType.INTEGER => "INTEGER",
      WhizbangDataType.SMALL_INT => "INTEGER",
      WhizbangDataType.BOOLEAN => "INTEGER",    // 0/1
      _ => throw new ArgumentOutOfRangeException(nameof(dataType))
    };
  }

  private static string MapDefaultValue(DefaultValue defaultValue) {
    return defaultValue switch {
      FunctionDefault func => func.FunctionType switch {
        DefaultValueFunction.DATE_TIME__NOW => "CURRENT_TIMESTAMP",
        DefaultValueFunction.DATE_TIME__UTC_NOW => "(datetime('now', 'utc'))",
        DefaultValueFunction.UUID__GENERATE => "(lower(hex(randomblob(16))))",
        DefaultValueFunction.BOOLEAN__TRUE => "1",
        DefaultValueFunction.BOOLEAN__FALSE => "0",
        _ => throw new ArgumentOutOfRangeException(nameof(defaultValue))
      },
      IntegerDefault intVal => intVal.Value.ToString(),
      StringDefault strVal => $"'{strVal.Value.Replace("'", "''")}'",
      BooleanDefault boolVal => boolVal.Value ? "1" : "0",
      NullDefault => "NULL",
      _ => throw new ArgumentOutOfRangeException(nameof(defaultValue))
    };
  }

  // ... DDL assembly mirrors PostgresSchemaBuilder (CREATE TABLE IF NOT EXISTS + indexes)
}
```

**Key Differences from PostgreSQL**:
- **UUID** - `TEXT` (lowercase hex string) instead of native UUID type
- **TIMESTAMP_TZ** - `TEXT` (ISO8601 format) instead of TIMESTAMPTZ
- **JSON** - `TEXT` instead of JSONB
- **All Integer Types** - `INTEGER` (SQLite only has INTEGER affinity)
- **BOOLEAN** - `INTEGER` (0/1) instead of BOOLEAN
- **UUID__GENERATE** - `(lower(hex(randomblob(16))))` instead of `gen_random_uuid()`

---

## Schema Configuration

### Pattern 5: Using SchemaConfiguration

**Use Case**: Generate schemas for all infrastructure tables with custom prefixes and schema name.

`SchemaConfiguration` is a shipped sealed record with a dual-prefix system (infrastructure tables vs perspective tables):

```csharp{title="Pattern 5: Using SchemaConfiguration" description="Use Case: Generate schemas for all infrastructure tables with custom prefix." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Using"] tests=["SchemaConfigurationTests.SchemaConfiguration_WithoutParameters_UsesDefaultsAsync", "SchemaConfigurationTests.SchemaConfiguration_IsRecordAsync"]}
namespace Whizbang.Data.Schema;

public sealed record SchemaConfiguration(
  string InfrastructurePrefix = "wh_",   // wh_inbox, wh_outbox, ...
  string PerspectivePrefix = "wh_per_",  // wh_per_product_dto, ...
  string SchemaName = "public",          // Postgres schema (service isolation)
  int Version = 1                        // Schema version for migrations
);
```

**Usage**:
```csharp{title="Pattern 5: Using SchemaConfiguration (2)" description="Pattern 5: Using SchemaConfiguration" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "Using"] tests=["PostgresSchemaBuilderTests.BuildInfrastructureSchema_CustomPrefix_UsesCustomPrefixAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_WithNormalSchema_StillQuotesSchemaNameAsync"]}
var config = new SchemaConfiguration(
  InfrastructurePrefix: "prod_",
  SchemaName: "inventory"
);

ISchemaBuilder builder = new PostgresSchemaBuilder();
var fullSchemaSql = builder.BuildInfrastructureSchema(config);

// Generates CREATE SCHEMA IF NOT EXISTS "inventory"; followed by
// CREATE TABLE statements for all infrastructure tables
// (service_instances, active_streams, partition_assignments,
//  message_deduplication, inbox, outbox, event_store, receptor_processing,
//  perspective_cursors, perspective_snapshots, message_associations,
//  perspective_registry, message_type_registry, request_response, sequences)
// with the "prod_" prefix, plus all indexes and sequences.
```

---

## Testing Schema Builders

### Testing Table Generation

```csharp{title="Testing Table Generation" description="Testing Table Generation" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Testing", "Table"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildCreateIndex_SimpleIndex_GeneratesCreateIndexAsync", "PostgresSchemaBuilderTests.BuildCreateTable_WithDefaultValue_GeneratesDefaultClauseAsync"]}
using TUnit.Assertions;
using TUnit.Core;
using Whizbang.Data.Schema;

public class PostgresSchemaBuilderTests {
  private readonly PostgresSchemaBuilder _builder = new();

  [Test]
  public async Task BuildCreateTable_SimpleTable_GeneratesCorrectSqlAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test",
      Columns: ImmutableArray.Create(
        new ColumnDefinition(
          Name: "id",
          DataType: WhizbangDataType.UUID,
          Nullable: false,
          PrimaryKey: true
        ),
        new ColumnDefinition(
          Name: "name",
          DataType: WhizbangDataType.STRING,
          Nullable: false,
          MaxLength: 100
        )
      )
    );

    // Act
    var sql = _builder.BuildCreateTable(table, prefix: "test_");

    // Assert
    await Assert.That(sql).Contains("CREATE TABLE IF NOT EXISTS test_test");
    await Assert.That(sql).Contains("id UUID NOT NULL PRIMARY KEY");
    await Assert.That(sql).Contains("name VARCHAR(100) NOT NULL");
  }

  [Test]
  public async Task BuildCreateIndex_SimpleIndex_GeneratesIndexSqlAsync() {
    // Arrange
    var index = new IndexDefinition(
      Name: "idx_test_created_at",
      Columns: ImmutableArray.Create("created_at")
    );

    // Act
    var sql = _builder.BuildCreateIndex(index, tableName: "test", prefix: "test_");

    // Assert
    await Assert.That(sql).Contains("CREATE INDEX IF NOT EXISTS idx_test_created_at");
    await Assert.That(sql).Contains("ON test_test (created_at)");
  }

  [Test]
  public async Task BuildCreateTable_WithDefaults_GeneratesDefaultsAsync() {
    // Arrange
    var table = new TableDefinition(
      Name: "test",
      Columns: ImmutableArray.Create(
        new ColumnDefinition(Name: "id", DataType: WhizbangDataType.UUID, Nullable: false, PrimaryKey: true),
        new ColumnDefinition(
          Name: "created_at",
          DataType: WhizbangDataType.TIMESTAMP_TZ,
          Nullable: false,
          DefaultValue: DefaultValue.Function(DefaultValueFunction.DATE_TIME__NOW)
        ),
        new ColumnDefinition(
          Name: "status",
          DataType: WhizbangDataType.INTEGER,
          Nullable: false,
          DefaultValue: DefaultValue.Integer(1)
        )
      )
    );

    // Act
    var sql = _builder.BuildCreateTable(table, prefix: "test_");

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
- ✅ **Map database-agnostic types** correctly for each database (UUID → TEXT hex string in SQLite, UUID in Postgres)
- ✅ **Support partial indexes** via WhereClause (both PostgreSQL and SQLite emit them)
- ✅ **Test generated SQL** with real databases (Testcontainers)
- ✅ **Use default prefixes** ("wh_") but allow customization

### DON'T ❌

- ❌ Use class instead of sealed record (breaks structural equality)
- ❌ Use List or Array (reference equality, breaks incremental generators)
- ❌ Hardcode table names in queries (use Columns.ColumnName constants)
- ❌ Skip database-specific type mapping (VARCHAR(n) works in Postgres, not SQLite)
- ❌ Assume every database supports partial indexes (PostgreSQL and SQLite do; verify before targeting others)
- ❌ Mix schema definition and SQL generation (separate concerns)
- ❌ Use reflection for schema generation (breaks AOT)

---

## Further Reading

**Data Access**:
- PostgreSQL Data - PostgreSQL implementation
- SQLite Data - SQLite implementation
- [Event Store](../../data/event-store.md) - Event sourcing tables

**Extensibility**:
- [Custom Storage](custom-storage.md) - Custom perspective stores
- [Custom Work Coordinators](custom-work-coordinators.md) - Work coordination

**Infrastructure**:
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Transactional outbox
- [Work Coordination](../../messaging/work-coordination.md) - Lease-based processing

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-16*
