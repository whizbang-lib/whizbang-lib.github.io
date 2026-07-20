---
title: Schema Generation Pattern
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Data.Schema/Schemas/PerspectiveCursorsSchema.cs
  - src/Whizbang.Data.Schema/PostgresTypeMapper.cs
  - src/Whizbang.Data.Schema/SchemaConfiguration.cs
  - src/Whizbang.Data.Schema/WhizbangDataType.cs
  - src/Whizbang.Data.Schema/ColumnDefinition.cs
  - src/Whizbang.Data.Schema/IndexDefinition.cs
testReferences:
  - tests/Whizbang.Data.Schema.Tests/PostgresSchemaBuilderTests.cs
  - tests/Whizbang.Data.Schema.Tests/PostgresTypeMapperTests.cs
  - tests/Whizbang.Data.Schema.Tests/TableDefinitionTests.cs
  - tests/Whizbang.Data.Schema.Tests/ColumnDefinitionTests.cs
  - tests/Whizbang.Data.Schema.Tests/SchemaConfigurationTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/InboxSchemaTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/OutboxSchemaTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/EventStoreSchemaTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/PerspectiveCursorsSchemaTests.cs
lastMaintainedCommit: '01f07906'
---

# Schema Generation Pattern

Whizbang uses a **database-agnostic schema definition pattern** where infrastructure schemas are defined once in C# and transformed into database-specific DDL via the `ISchemaBuilder` interface.

## Core Concept

**Problem**: Different databases (Postgres, SQLite, MySQL) have different DDL syntax, but the logical schema structure is the same.

**Solution**: Define schema once using `TableDefinition`, `ColumnDefinition`, `IndexDefinition`, then transform to database-specific SQL via `ISchemaBuilder` implementations.

```mermaid{caption="Database-agnostic C# schema definitions flow through ISchemaBuilder implementations to produce database-specific DDL." tests=["PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
flowchart TD
    Definitions["C# Schema Definitions<br/>(Database-Agnostic)<br/>- InboxSchema<br/>- OutboxSchema<br/>- EventStoreSchema<br/>- PerspectiveCursors"]
    Builder["ISchemaBuilder"]
    PostgresBuilder["Postgres Builder"]
    SQLiteBuilder["SQLite Builder"]
    MySQLBuilder["MySQL Builder"]
    PostgresDDL["Postgres DDL"]
    SQLiteDDL["SQLite DDL"]
    MySQLDDL["MySQL DDL"]

    Definitions --> Builder
    Builder --> PostgresBuilder
    Builder --> SQLiteBuilder
    Builder --> MySQLBuilder
    PostgresBuilder --> PostgresDDL
    SQLiteBuilder --> SQLiteDDL
    MySQLBuilder --> MySQLDDL
```

---

## ISchemaBuilder Interface

```csharp{title="ISchemaBuilder Interface" description="ISchemaBuilder Interface" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "ISchemaBuilder", "Interface"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildCreateIndex_SimpleIndex_GeneratesCreateIndexAsync", "PostgresSchemaBuilderTests.BuildCreateSequence_SimpleSequence_GeneratesCreateSequenceAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
public interface ISchemaBuilder {
  /// <summary>
  /// Database engine name (e.g., "Postgres", "SQLite", "MySQL").
  /// </summary>
  string DatabaseEngine { get; }

  /// <summary>
  /// Builds CREATE TABLE DDL for a single table.
  /// The optional schema parameter qualifies the table name (e.g., "inventory", "bff").
  /// </summary>
  string BuildCreateTable(TableDefinition table, string prefix, string? schema = null);

  /// <summary>
  /// Builds CREATE INDEX DDL for a single index.
  /// </summary>
  string BuildCreateIndex(IndexDefinition index, string tableName, string prefix, string? schema = null);

  /// <summary>
  /// Builds CREATE SEQUENCE DDL for a single sequence.
  /// </summary>
  string BuildCreateSequence(SequenceDefinition sequence, string prefix, string? schema = null);

  /// <summary>
  /// Builds complete infrastructure schema DDL.
  /// AUTHORITATIVE method - all consumers MUST use this for consistency.
  /// </summary>
  string BuildInfrastructureSchema(SchemaConfiguration config);

  /// <summary>
  /// Builds perspective table DDL.
  /// Fixed schema: stream_id (PK), data (JSONB), version (BIGINT), updated_at (TIMESTAMPTZ).
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

```csharp{title="TableDefinition" description="TableDefinition" category="Implementation" difficulty="BEGINNER" tags=["Data", "TableDefinition"] tests=["TableDefinitionTests.TableDefinition_WithRequiredProperties_CreatesInstanceAsync", "TableDefinitionTests.TableDefinition_WithoutIndexes_UsesDefaultAsync", "TableDefinitionTests.TableDefinition_WithIndexes_StoresAllAsync"]}
public sealed record TableDefinition(
  string Name,                                              // Table name without prefix
  ImmutableArray<ColumnDefinition> Columns,                 // Column definitions
  ImmutableArray<IndexDefinition> Indexes = default,        // Index definitions (default: empty)
  ImmutableArray<UniqueConstraintDefinition> UniqueConstraints = default
);
```

**Example - Inbox Table** (abridged; the shipped `InboxSchema` has 18 columns):

```csharp{title="TableDefinition - InboxSchema" description="Example - Inbox Table (abridged):" category="Implementation" difficulty="ADVANCED" tags=["Data", "TableDefinition"] tests=["InboxSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "InboxSchemaTests.Table_ShouldHavePrimaryKeyAsync", "InboxSchemaTests.Table_ColumnDefaults_ShouldBeCorrectAsync", "InboxSchemaTests.Table_ShouldDefineCorrectIndexesAsync"]}
using System.Collections.Immutable;
using Whizbang.Data.Schema;
using Whizbang.Data.Schema.Schemas;

public static class InboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "inbox",
    Columns: ImmutableArray.Create(
      new ColumnDefinition(
        Name: "message_id",
        DataType: WhizbangDataType.UUID,
        Nullable: false,
        PrimaryKey: true
      ),
      new ColumnDefinition(
        Name: "handler_name",
        DataType: WhizbangDataType.STRING,
        Nullable: false,
        MaxLength: 500
      ),
      new ColumnDefinition(
        Name: "received_at",
        DataType: WhizbangDataType.TIMESTAMP_TZ,
        Nullable: false,
        DefaultValue: DefaultValue.Function(DefaultValueFunction.DATE_TIME__NOW)
      )
      // ... message_type, event_data, metadata, scope, stream_id, partition_number,
      // is_event, status, attempts, error, instance_id, lease_expiry, failure_reason,
      // scheduled_for, processed_at, flags
    ),
    Indexes: ImmutableArray.Create(
      new IndexDefinition(
        Name: "idx_inbox_received_at",
        Columns: ["received_at"]
      )
    )
  );
}
```

### ColumnDefinition

```csharp{title="ColumnDefinition" description="ColumnDefinition" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "ColumnDefinition"] tests=["ColumnDefinitionTests.ColumnDefinition_WithRequiredProperties_CreatesInstanceAsync", "ColumnDefinitionTests.ColumnDefinition_WithoutOptionalProperties_UsesDefaultsAsync", "ColumnDefinitionTests.ColumnDefinition_WithAllProperties_SetsAllAsync"]}
public sealed record ColumnDefinition(
  string Name,                     // Column name (snake_case by convention)
  WhizbangDataType DataType,       // Database-agnostic type
  bool Nullable = false,           // Can be null
  bool PrimaryKey = false,         // Is primary key
  bool Unique = false,             // Has unique constraint
  int? MaxLength = null,           // For strings
  DefaultValue? DefaultValue = null // Default value
);
```

**WhizbangDataType Enum**:
```csharp{title="ColumnDefinition - WhizbangDataType" description="WhizbangDataType Enum:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "ColumnDefinition"] tests=["WhizbangDataTypeTests.WhizbangDataType_HasExactlyEightTypesAsync", "WhizbangDataTypeTests.WhizbangDataType_ToStringReturnsCorrectNamesAsync"]}
public enum WhizbangDataType {
  UUID,           // UUID/GUID
  STRING,         // VARCHAR(n) / TEXT
  TIMESTAMP_TZ,   // TIMESTAMPTZ
  JSON,           // JSONB (Postgres)
  BIG_INT,        // BIGINT
  INTEGER,        // INTEGER
  SMALL_INT,      // SMALLINT (flags, small enums)
  BOOLEAN         // BOOLEAN
}
```

### IndexDefinition

```csharp{title="IndexDefinition" description="IndexDefinition" category="Implementation" difficulty="BEGINNER" tags=["Data", "IndexDefinition"] tests=["IndexDefinitionTests.IndexDefinition_WithRequiredProperties_CreatesInstanceAsync", "IndexDefinitionTests.IndexDefinition_WithoutOptionalProperties_UsesDefaultsAsync", "IndexDefinitionTests.IndexDefinition_WithUnique_SetsPropertyAsync"]}
public sealed record IndexDefinition(
  string Name,                            // Index name
  ImmutableArray<string> Columns,         // Indexed columns
  bool Unique = false,                    // Unique index
  string? WhereClause = null              // Partial index (Postgres)
);
```

**Example - Partial Index**:
```csharp{title="IndexDefinition (2)" description="Example - Partial Index:" category="Implementation" difficulty="BEGINNER" tags=["Data", "IndexDefinition"] tests=["SchemaDefinitionTests.PartialIndexes_ShouldExistForStatusQueriesAsync"]}
new IndexDefinition(
  Name: "idx_inbox_lease_expiry",
  Columns: ImmutableArray.Create("lease_expiry"),
  WhereClause: "lease_expiry IS NOT NULL"  // Only index non-null
)
```

---

## PostgreSQL Implementation

### PostgresSchemaBuilder

```csharp{title="PostgresSchemaBuilder" description="PostgresSchemaBuilder (simplified from the shipped implementation)" category="Implementation" difficulty="ADVANCED" tags=["Data", "PostgresSchemaBuilder"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildCreateTable_EmitsAlterTableAddColumnIfNotExistsPerColumnAsync", "PostgresSchemaBuilderTests.BuildCreateIndex_SimpleIndex_GeneratesCreateIndexAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
using Whizbang.Data.Schema;
using Whizbang.Data.Schema.Schemas;

namespace Whizbang.Data.Postgres.Schema;

public class PostgresSchemaBuilder : ISchemaBuilder {
  public string DatabaseEngine => "Postgres";

  public string BuildCreateTable(TableDefinition table, string prefix, string? schema = null) {
    var tableName = $"{prefix}{table.Name}";

    // Generate: CREATE TABLE IF NOT EXISTS {tableName} ( ... );
    // - Handle composite primary keys and unique constraints
    // - Handle default values
    // - Emit ALTER TABLE ADD COLUMN IF NOT EXISTS per column so existing
    //   tables are backfilled idempotently when the schema grows

    return sql;
  }

  public string BuildCreateIndex(IndexDefinition index, string tableName, string prefix, string? schema = null) {
    var fullTableName = $"{prefix}{tableName}";
    var unique = index.Unique ? "UNIQUE " : "";
    var columns = string.Join(", ", index.Columns);
    var whereClause = index.WhereClause != null ? $" WHERE {index.WhereClause}" : "";

    return $"CREATE {unique}INDEX IF NOT EXISTS {index.Name} ON {fullTableName} ({columns}){whereClause};";
  }

  public string BuildInfrastructureSchema(SchemaConfiguration config) {
    var sb = new StringBuilder();

    // Generate all infrastructure tables (shipped list also includes
    // ServiceInstances, ActiveStreams, PartitionAssignments, MessageDeduplication,
    // ReceptorProcessing, PerspectiveSnapshots, MessageAssociations,
    // PerspectiveRegistry, MessageTypeRegistry, RequestResponse, Sequences)
    var tables = new[] {
      InboxSchema.Table,
      OutboxSchema.Table,
      EventStoreSchema.Table,
      PerspectiveCursorsSchema.Table,
      // ... etc
    };

    foreach (var table in tables) {
      sb.AppendLine(BuildCreateTable(table, config.InfrastructurePrefix, config.SchemaName));

      foreach (var index in table.Indexes) {
        sb.AppendLine(BuildCreateIndex(index, table.Name, config.InfrastructurePrefix, config.SchemaName));
      }
    }

    return sb.ToString();
  }
}
```

**Type Mapping - Postgres**:
```csharp{title="PostgresSchemaBuilder - PostgresTypeMapper" description="Type Mapping - Postgres:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "PostgresSchemaBuilder"] tests=["PostgresTypeMapperTests.MapDataType_Uuid_ReturnsUuidAsync", "PostgresTypeMapperTests.MapDataType_String_ReturnsTextAsync", "PostgresTypeMapperTests.MapDataType_StringWithMaxLength_ReturnsVarcharAsync", "PostgresTypeMapperTests.MapDataType_TimestampTz_ReturnsTimestamptzAsync", "PostgresTypeMapperTests.MapDataType_Json_ReturnsJsonbAsync", "PostgresTypeMapperTests.MapDataType_BigInt_ReturnsBigintAsync", "PostgresTypeMapperTests.MapDataType_Integer_ReturnsIntegerAsync", "PostgresTypeMapperTests.MapDataType_Boolean_ReturnsBooleanAsync"]}
public static class PostgresTypeMapper {
  public static string MapDataType(WhizbangDataType dataType, int? maxLength = null) {
    return dataType switch {
      WhizbangDataType.UUID => "UUID",
      WhizbangDataType.STRING => maxLength.HasValue
        ? $"VARCHAR({maxLength.Value})"
        : "TEXT",
      WhizbangDataType.TIMESTAMP_TZ => "TIMESTAMPTZ",
      WhizbangDataType.JSON => "JSONB",  // Postgres-specific: JSONB not JSON
      WhizbangDataType.BIG_INT => "BIGINT",
      WhizbangDataType.INTEGER => "INTEGER",
      WhizbangDataType.SMALL_INT => "SMALLINT",
      WhizbangDataType.BOOLEAN => "BOOLEAN",
      _ => throw new ArgumentOutOfRangeException(nameof(dataType), dataType, "Unknown data type")
    };
  }
}
```

---

## Usage Patterns

### Pattern 1: EF Core Migration Generator

```csharp{title="Pattern 1: EF Core Migration Generator" description="Pattern 1: EF Core Migration Generator" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Pattern", "Core", "Migration"] tests=["PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
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

```csharp{title="Pattern 2: Dapper Embedded Schema" description="Pattern 2: Dapper Embedded Schema" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Dapper", "Embedded"] tests=["PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
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

```csharp{title="Pattern 3: Custom Perspective Tables" description="Pattern 3: Custom Perspective Tables" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Custom", "Perspective"]}
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

```csharp{title="SchemaConfiguration" description="SchemaConfiguration" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "SchemaConfiguration"] tests=["SchemaConfigurationTests.SchemaConfiguration_WithoutParameters_UsesDefaultsAsync", "SchemaConfigurationTests.SchemaConfiguration_WithAllCustom_SetsAllAsync"]}
public sealed record SchemaConfiguration(
  string InfrastructurePrefix = "wh_",   // Prefix for infrastructure tables
  string PerspectivePrefix = "wh_per_",  // Prefix for perspective tables (read models)
  string SchemaName = "public",          // Database schema name (service isolation)
  int Version = 1                        // Schema version for migrations
);
```

**Example Prefixes**:
```
Infrastructure Tables:
- wh_inbox
- wh_outbox
- wh_event_store
- wh_perspective_cursors

Perspective Tables:
- wh_per_product_catalog
- wh_per_order_summary
- wh_per_customer_statistics
```

---

## Infrastructure Schemas

Whizbang provides pre-defined schemas for core infrastructure:

### InboxSchema

```csharp{title="InboxSchema" description="InboxSchema" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "InboxSchema"] tests=["InboxSchemaTests.Table_ShouldHaveCorrectNameAsync", "InboxSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "InboxSchemaTests.Table_ShouldDefineCorrectIndexesAsync", "InboxSchemaTests.Table_ShouldHavePrimaryKeyAsync"]}
public static class InboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "inbox",
    Columns: ImmutableArray.Create(
      // message_id (PK)
      // handler_name, message_type
      // event_data (JSONB), metadata (JSONB), scope (JSONB)
      // stream_id, partition_number, is_event
      // status, attempts, error, failure_reason
      // instance_id, lease_expiry, scheduled_for
      // processed_at, received_at, flags
    ),
    Indexes: ImmutableArray.Create(
      // idx_inbox_processed_at, idx_inbox_received_at
      // idx_inbox_lease_expiry (partial: WHERE lease_expiry IS NOT NULL)
      // idx_inbox_status_lease (partial: for claiming work)
      // idx_inbox_failure_reason, idx_inbox_scheduled_for
      // idx_inbox_partition_claiming, idx_inbox_instance_lease
    )
  );
}
```

### OutboxSchema

```csharp{title="OutboxSchema" description="OutboxSchema" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "OutboxSchema"] tests=["OutboxSchemaTests.Table_ShouldHaveCorrectNameAsync", "OutboxSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "OutboxSchemaTests.Table_ShouldDefineCorrectIndexesAsync", "OutboxSchemaTests.Table_ShouldHavePrimaryKeyAsync"]}
public static class OutboxSchema {
  public static readonly TableDefinition Table = new(
    Name: "outbox",
    Columns: ImmutableArray.Create(
      // message_id (PK)
      // destination (nullable - events have no destination)
      // message_type, envelope_type
      // event_data (JSONB), metadata (JSONB), scope (JSONB)
      // stream_id, partition_number, is_event
      // status, attempts, error, failure_reason
      // instance_id, lease_expiry, scheduled_for
      // created_at, published_at, processed_at, flags
    ),
    Indexes: ImmutableArray.Create(
      // idx_outbox_status_created_at, idx_outbox_published_at
      // idx_outbox_lease_expiry (partial)
      // idx_outbox_status_lease (partial)
      // idx_outbox_failure_reason, idx_outbox_scheduled_for
      // idx_outbox_partition_claiming, idx_outbox_instance_lease
    )
  );
}
```

### EventStoreSchema

```csharp{title="EventStoreSchema" description="EventStoreSchema" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "EventStoreSchema"] tests=["EventStoreSchemaTests.Table_ShouldHaveCorrectNameAsync", "EventStoreSchemaTests.Table_ShouldDefineCorrectColumnsAsync", "EventStoreSchemaTests.Table_ShouldDefineCorrectIndexesAsync", "EventStoreSchemaTests.Table_ShouldHavePrimaryKeyAsync"]}
public static class EventStoreSchema {
  public static readonly TableDefinition Table = new(
    Name: "event_store",
    Columns: ImmutableArray.Create(
      // event_id (PK, UUIDv7)
      // stream_id (UUID), aggregate_id (UUID), aggregate_type
      // event_type
      // event_data (JSONB), metadata (JSONB), scope (JSONB)
      // version (per-stream sequence)
      // created_at, flags
    ),
    Indexes: ImmutableArray.Create(
      // idx_event_store_stream (UNIQUE: stream_id, version)
      // idx_event_store_aggregate (UNIQUE: aggregate_id, version)
      // idx_event_store_aggregate_type (aggregate_type, created_at)
    )
  );
}
```

### PerspectiveCursorsSchema

```csharp{title="PerspectiveCursorsSchema" description="PerspectiveCursorsSchema" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "PerspectiveCursorsSchema"] tests=["PerspectiveCursorsSchemaTests.Table_HasCorrectNameAsync", "PerspectiveCursorsSchemaTests.Table_HasCorrectColumnsAsync", "PerspectiveCursorsSchemaTests.Table_HasCorrectIndexesAsync", "PerspectiveCursorsSchemaTests.Table_StreamId_IsCompositePrimaryKeyAsync", "PerspectiveCursorsSchemaTests.Table_PerspectiveName_IsCompositePrimaryKeyAsync"]}
public static class PerspectiveCursorsSchema {
  public static readonly TableDefinition Table = new(
    Name: "perspective_cursors",
    Columns: ImmutableArray.Create(
      // stream_id (composite PK)
      // perspective_name (composite PK)
      // last_event_id (nullable - cursors start with no processed events)
      // status, processed_at, error
      // rewind_trigger_event_id, rewind_flagged_at, rewind_first_flagged_at
      // stream_lock_instance_id, stream_lock_expiry, stream_lock_reason
    ),
    Indexes: ImmutableArray.Create(
      // idx_perspective_cursors_perspective_name
      // idx_perspective_cursors_last_event_id
    )
  );
}
```

---

## Testing Schema Generation

### Unit Test Pattern

```csharp{title="Unit Test Pattern" description="Unit Test Pattern" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Unit", "Test", "Pattern"] tests=["PostgresSchemaBuilderTests.BuildCreateTable_SimpleTable_GeneratesCreateStatementAsync", "PostgresSchemaBuilderTests.BuildInfrastructureSchema_GeneratesAllTablesAsync"]}
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
        new ColumnDefinition("id", WhizbangDataType.UUID, PrimaryKey: true),
        new ColumnDefinition("name", WhizbangDataType.STRING, MaxLength: 100)
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
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_event_store");
    await Assert.That(ddl).Contains("CREATE TABLE IF NOT EXISTS wh_perspective_cursors");
  }
}
```

---

## Implementing Custom Database Support

### Step 1: Create ISchemaBuilder Implementation

```csharp{title="Step 1: Create ISchemaBuilder Implementation" description="Step 1: Create ISchemaBuilder Implementation" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Step", "Create", "ISchemaBuilder"] unverified="illustrative MySQL builder skeleton — custom-database-support template with unimplemented method bodies, not a shipped or tested implementation"}
using Whizbang.Data.Schema;

public class MySqlSchemaBuilder : ISchemaBuilder {
  public string DatabaseEngine => "MySQL";

  public string BuildCreateTable(TableDefinition table, string prefix, string? schema = null) {
    // Implement MySQL-specific DDL syntax
    // - AUTO_INCREMENT instead of SERIAL
    // - Different JSON type name
    // - Different timestamp syntax
  }

  public string BuildCreateIndex(IndexDefinition index, string tableName, string prefix, string? schema = null) {
    // MySQL: CREATE INDEX idx_name ON table_name (columns);
  }

  public string BuildCreateSequence(SequenceDefinition sequence, string prefix, string? schema = null) {
    // MySQL 8+: emulate sequences or use AUTO_INCREMENT tables
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

```csharp{title="Step 2: Implement Type Mapper" description="Step 2: Implement Type Mapper" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Step", "Implement", "Type"] unverified="illustrative MySQL type mapper skeleton — custom-database-support template, not a shipped or tested implementation"}
internal static class MySqlTypeMapper {
  public static string MapDataType(WhizbangDataType type, int? maxLength) {
    return type switch {
      WhizbangDataType.UUID => "CHAR(36)",  // MySQL doesn't have UUID type
      WhizbangDataType.STRING => maxLength.HasValue
        ? $"VARCHAR({maxLength.Value})"
        : "TEXT",
      WhizbangDataType.INTEGER => "INT",
      WhizbangDataType.BIG_INT => "BIGINT",
      WhizbangDataType.SMALL_INT => "SMALLINT",
      WhizbangDataType.BOOLEAN => "TINYINT(1)",  // MySQL bool
      WhizbangDataType.TIMESTAMP_TZ => "DATETIME",  // No TZ in MySQL < 8.0.19
      WhizbangDataType.JSON => "JSON",  // MySQL 5.7+
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
- [Database Schema Framework](../extending/extensibility/database-schema-framework.md) - Complete framework overview

**Source Generators**:
- Perspective Schema Generator - Auto-generate perspective tables

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Transactional messaging schema
- [Inbox Pattern](../messaging/inbox-pattern.md) - Deduplication schema

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-22*
