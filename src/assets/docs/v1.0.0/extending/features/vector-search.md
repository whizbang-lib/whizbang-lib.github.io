---
title: Vector Search
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Features
order: 2
description: pgvector similarity search with automatic configuration
tags: 'vector, pgvector, embeddings, similarity, AI, ML'
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/VectorSearchExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/DbContextRegistrationRegistry.cs
  - src/Whizbang.Data.EFCore.Custom/WhizbangDbContextAttribute.cs
  - src/Whizbang.Core/Perspectives/VectorFieldAttribute.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/VectorFieldPackageReferenceAnalyzer.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorSearchExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorSearchIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorFieldPackageReferenceAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/VectorFieldAttributeTests.cs
lastMaintainedCommit: '01f07906'
---

# Vector Search

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Overview

Whizbang provides built-in support for pgvector similarity searches, enabling semantic search, embeddings, and AI/ML workloads with PostgreSQL. The integration is designed for zero-friction setup with automatic configuration.

For comprehensive usage patterns, query methods, and examples, see the [Lens Vector Search Guide](../../fundamentals/lenses/vector-search.md).

## Turnkey Setup {#turnkey-setup}

Whizbang provides a **turnkey experience** for pgvector. When your perspective models use `[VectorField]` attributes, the source generator automatically creates an `Add{YourDbContext}()` extension method that handles all pgvector configuration:

```csharp{title="Turnkey Setup" description="Whizbang provides a turnkey experience for pgvector." category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Turnkey", "Setup"] unverified="Consumer usage of the source-generated AddMyAppDbContext() extension; the turnkey wiring is exercised only by VectorSearchIntegrationTests, which is absent from the test map."}
// Single call configures everything:
// - NpgsqlDataSource with UseVector() (connection string resolved from configuration)
// - DbContext with UseVector()
// - HasPostgresExtension("vector") via generated ConfigureWhizbang()
// - CREATE EXTENSION vector pre-created at data-source build (if missing)
builder.Services.AddMyAppDbContext();

// Or override the configuration key to read the connection string from:
builder.Services.AddMyAppDbContext(connectionStringName: "my-service-db");
```

The `DbContextRegistrationRegistry` tracks which DbContexts have vector fields and ensures proper initialization order with all required pgvector setup.

## Auto-Configuration {#auto-config}

The `VectorConfigurationRegistry` is the source generator's internal registry that automatically detects and configures vector fields across your perspective models. When the source generator analyzes your code, it populates this registry with all detected `[VectorField]` attributes and uses it to generate the appropriate configuration code.

### VectorConfigurationRegistry

This static class is **generated into your consumer assembly** by `EFCoreServiceRegistrationGenerator` and tracks:
- **Which DbContexts** have vector fields
- **Which perspective models** use `[VectorField]` attributes
- **Vector dimensions** for each field
- **Required pgvector packages** to verify

The registry ensures:
- All necessary pgvector setup is included in generated code
- DbContext initialization order is correct
- Proper error diagnostics if packages are missing

### DbContextRegistrationRegistry

This companion registry (a runtime static class in `Whizbang.Data.EFCore.Postgres`) tracks:
- **Which DbContexts** need registration extension methods
- **Dependencies** between DbContexts and data sources
- **Configuration callbacks** for customization

Together, these registries enable the turnkey experience where a single `AddMyAppDbContext()` call handles everything.

### What Gets Configured Automatically

When Whizbang detects `[VectorField]` attributes in your perspective models:

1. **Creates the pgvector extension** - Generates `modelBuilder.HasPostgresExtension("vector")` in `ConfigureWhizbang()`
2. **Configures NpgsqlDataSource** - Calls `dataSourceBuilder.UseVector()` for Npgsql type mapping
3. **Configures EF Core** - Calls `npgsqlOptions.UseVector()` for EF Core query translation
4. **Maps vector columns** - Generates proper `HasColumnType("vector({dimensions})")` configuration

### Detection Flow

```
Your Code                    Source Generator
---------                    ----------------
[VectorField(1536)]    -->   VectorConfigurationRegistry
public float[]?              detects attribute
  Embedding { get; }
                        -->   Generates DbContext configuration
                        -->   Generates registration extension
                        -->   Adds UseVector() calls
```

### Generated Configuration

For a model like:

```csharp{title="Generated Configuration" description="For a model like:" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Generated", "Configuration"] tests=["VectorFieldAttributeTests.VectorFieldAttribute_Constructor_AcceptsValidDimensionsAsync", "VectorFieldAttributeTests.VectorFieldAttribute_AttributeUsage_PropertyOnly_NotMultiple_IsInheritedAsync"]}
public class DocumentModel {
  public Guid Id { get; init; }

  [VectorField(1536)]  // OpenAI ada-002 dimensions
  public float[]? ContentEmbedding { get; init; }
}
```

The generator produces:

```csharp{title="Generated Configuration (2)" description="The generator produces:" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "Generated", "Configuration"] unverified="Shows source-generator output (ConfigureWhizbang and AddMyAppDbContext); the emitted wiring is verified only by VectorSearchIntegrationTests, which is absent from the test map."}
// In generated DbContext configuration
public static void ConfigureWhizbang(ModelBuilder modelBuilder) {
  // Auto-configured: pgvector extension required for [VectorField] columns
  modelBuilder.HasPostgresExtension("vector");

  modelBuilder.Entity<DocumentPerspectiveRow>(entity => {
    entity.Property(e => e.ContentEmbedding)
          .HasColumnType("vector(1536)");
  });
}

// In generated registration extension (abridged)
public static IServiceCollection AddMyAppDbContext(
    this IServiceCollection services,
    string? connectionStringName = null) {

  var connectionStringKey = connectionStringName ?? "DefaultConnection";

  // NpgsqlDataSource singleton - IConfiguration resolved at provider-build time
  services.RemoveAll<NpgsqlDataSource>();
  services.AddSingleton<NpgsqlDataSource>(sp => {
    var config = sp.GetRequiredService<IConfiguration>();
    var connectionString = config.GetConnectionString(connectionStringKey)
        ?? throw new InvalidOperationException(
            $"Connection string '{connectionStringKey}' not found in configuration.");

    var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
    dataSourceBuilder.ConfigureJsonOptions(JsonContextRegistry.CreateCombinedOptions());
    dataSourceBuilder.EnableDynamicJson();

    // Auto-configured: pgvector support required for [VectorField] columns
    dataSourceBuilder.UseVector();

    // Pre-create the vector extension before Build() so Npgsql's pg_type
    // catalog scan finds it (skipped when infrastructure pre-created it)
    // ... CREATE EXTENSION vector (if missing) ...

    return dataSourceBuilder.Build();
  });

  // DbContext registration with UseVector() on the Npgsql options follows...
  return services;
}
```

## Prerequisites

When using `[VectorField]` attributes, you must add both pgvector packages:

```xml{title="Prerequisites" description="When using [VectorField] attributes, you must add both pgvector packages:" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Prerequisites"]}
<ItemGroup>
  <!-- Base package for NpgsqlDataSourceBuilder.UseVector() -->
  <PackageReference Include="Pgvector" Version="0.3.0" />

  <!-- EF Core integration for type mapping and queries -->
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

If you forget these packages, compiler diagnostics will guide you:

- **[WHIZ070](../../operations/diagnostics/whiz070.md)** - Missing `Pgvector.EntityFrameworkCore` package
- **[WHIZ071](../../operations/diagnostics/whiz071.md)** - Missing `Pgvector` package

## Customization

### Connection String Name

The generated extension reads the connection string from configuration. The default key comes from `[WhizbangDbContext(ConnectionStringName = "...")]`; override it per call:

```csharp{title="Connection String Name" description="Override the configuration key used to resolve the connection string." category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Configure", "Data"] unverified="Consumer usage of the generated AddMyAppDbContext(connectionStringName:) overload; covered only by VectorSearchIntegrationTests, which is absent from the test map."}
// Reads ConnectionStrings:chat-service-db from configuration
builder.Services.AddMyAppDbContext(connectionStringName: "chat-service-db");
```

### Connection Pool Settings

The generated data source factory applies pool settings from the `ConnectionPool` configuration section automatically:

```json{title="Connection Pool Settings" description="ConnectionPool configuration section." category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Configure", "DbContext"]}
{
  "ConnectionPool": {
    "MaxPoolSize": 100,
    "MinPoolSize": 5,
    "Timeout": 15,
    "CommandTimeout": 30
  }
}
```

For anything beyond these knobs (custom Npgsql options, DbContext options callbacks), use manual configuration below.

## Manual Configuration

If you prefer manual configuration over the turnkey approach:

```csharp{title="Manual Configuration" description="If you prefer manual configuration over the turnkey approach:" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "Manual", "Configuration"] unverified="Consumer wiring using third-party Npgsql and pgvector APIs plus the Whizbang builder; not exercised by any mapped vector-search test."}
// 1. Create data source with UseVector()
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
dataSourceBuilder.UseVector();
var dataSource = dataSourceBuilder.Build();
builder.Services.AddSingleton(dataSource);

// 2. Add DbContext with UseVector()
builder.Services.AddDbContext<MyAppDbContext>(options => {
  options.UseNpgsql(dataSource, npgsqlOptions => {
    npgsqlOptions.UseVector();
  });
});

// 3. Configure Whizbang normally
builder.Services
  .AddWhizbang()
  .WithEFCore<MyAppDbContext>()
  .WithDriver.Postgres;
```

Note: The generated `ConfigureWhizbang()` method automatically includes `HasPostgresExtension("vector")` when `[VectorField]` attributes are detected, so you don't need to add that manually.

## See Also

- [Lens Vector Search Guide](../../fundamentals/lenses/vector-search.md) - Complete usage patterns and query methods
- VectorFieldAttribute Reference - Attribute documentation
- [WHIZ070: Missing Pgvector.EntityFrameworkCore](../../operations/diagnostics/whiz070.md)
- [WHIZ071: Missing Pgvector Package](../../operations/diagnostics/whiz071.md)
- [EF Core Integration](../../data/efcore-integration.md) - Database setup
