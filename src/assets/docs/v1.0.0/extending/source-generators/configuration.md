---
title: Configuration
version: 1.0.0
category: Source Generators
order: 8
description: >-
  MSBuild property configuration for source generators - table naming,
  suffix stripping, and other compile-time options
tags: >-
  source-generators, configuration, msbuild, table-naming, suffix-stripping,
  compile-time
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/ConfigurationUtilities.cs
  - src/Whizbang.Generators.Shared/Models/TableNameConfig.cs
lastMaintainedCommit: '01f07906'
---

# Configuration

Whizbang source generators read configuration from MSBuild properties, enabling compile-time customization without code changes. This approach ensures configuration is available during source generation while maintaining AOT compatibility.

## Overview

Configuration utilities provide a bridge between MSBuild project properties and the incremental source generator pipeline:

```
┌──────────────────────────────────────────────────┐
│  .csproj / Directory.Build.props                │
│                                                  │
│  <WhizbangStripTableNameSuffixes>true</...>     │
│  <WhizbangTableNameSuffixesToStrip>...</...>    │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  ConfigurationUtilities                          │
│                                                  │
│  Reads AnalyzerConfigOptions                    │
│  Returns TableNameConfig                         │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  Source Generators                               │
│                                                  │
│  Use config for table names, code generation    │
└──────────────────────────────────────────────────┘
```

---

## ConfigurationUtilities

The `ConfigurationUtilities` class provides static methods for reading MSBuild properties from the analyzer configuration:

### GetTableNameConfig

Reads table name configuration from MSBuild properties:

```csharp{title="GetTableNameConfig" description="Reads table name configuration from MSBuild properties:" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "GetTableNameConfig"]}
using Whizbang.Generators.Shared.Utilities;

public void Initialize(IncrementalGeneratorInitializationContext context) {
    // Create a value provider for table name configuration
    var tableNameConfig = context.AnalyzerConfigOptionsProvider.Select(
        ConfigurationUtilities.SelectTableNameConfig
    );

    // Use in generator pipeline
    var combined = perspectives.Combine(tableNameConfig);

    context.RegisterSourceOutput(combined, (ctx, data) => {
        var (perspectiveList, config) = data;
        GenerateCode(ctx, perspectiveList, config);
    });
}
```

### MSBuild Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `WhizbangStripTableNameSuffixes` | bool | `true` | Enable/disable suffix stripping |
| `WhizbangTableNameSuffixesToStrip` | string | `ReadModel,Model,Projection,Dto,View` | Comma-separated list of suffixes |

### Configuration in .csproj

```xml{title="Configuration in .csproj" description="Configuration in .csproj" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Configuration", ".csproj"]}
<PropertyGroup>
  <!-- Disable suffix stripping entirely -->
  <WhizbangStripTableNameSuffixes>false</WhizbangStripTableNameSuffixes>

  <!-- Or customize which suffixes to strip -->
  <WhizbangStripTableNameSuffixes>true</WhizbangStripTableNameSuffixes>
  <WhizbangTableNameSuffixesToStrip>ReadModel,Projection,View</WhizbangTableNameSuffixesToStrip>
</PropertyGroup>
```

---

## TableNameConfig

The `TableNameConfig` record holds the parsed configuration:

```csharp{title="TableNameConfig" description="The TableNameConfig record holds the parsed configuration:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "TableNameConfig"]}
public record TableNameConfig(
    bool StripSuffixes,
    string[] SuffixesToStrip
) {
    /// <summary>
    /// Default configuration: strip common suffixes.
    /// </summary>
    public static TableNameConfig Default => new(
        StripSuffixes: true,
        SuffixesToStrip: new[] { "ReadModel", "Model", "Projection", "Dto", "View" }
    );
}
```

### Table Name Suffix Stripping

When `StripSuffixes` is enabled, perspective class names are transformed for database table names:

| Class Name | Stripped Name | Table Name |
|------------|---------------|------------|
| `OrderReadModel` | `Order` | `orders` |
| `ProductProjection` | `Product` | `products` |
| `CustomerDto` | `Customer` | `customers` |
| `InventoryView` | `Inventory` | `inventory` |
| `UserModel` | `User` | `users` |
| `AccountDetails` | `AccountDetails` | `account_details` |

**Example**:
```csharp{title="Table Name Suffix Stripping" description="Table Name Suffix Stripping" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Table", "Name"]}
// Perspective class
public class OrderReadModel : IPerspectiveFor<Order, OrderCreated> {
    public Guid OrderId { get; set; }
    public string Status { get; set; }
}

// Generated table name (with suffix stripping):
// Table: "orders" (not "order_read_models")
```

---

## Usage in Generators

### Pipeline Integration

```csharp{title="Pipeline Integration" description="Pipeline Integration" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Pipeline", "Integration"]}
[Generator]
public class PerspectiveSchemaGenerator : IIncrementalGenerator {
    public void Initialize(IncrementalGeneratorInitializationContext context) {
        // 1. Discover perspectives
        var perspectives = context.SyntaxProvider.CreateSyntaxProvider(
            predicate: static (node, _) => node is ClassDeclarationSyntax,
            transform: static (ctx, ct) => ExtractPerspective(ctx, ct)
        ).Where(static p => p is not null);

        // 2. Get configuration
        var config = context.AnalyzerConfigOptionsProvider.Select(
            ConfigurationUtilities.SelectTableNameConfig
        );

        // 3. Combine and generate
        var combined = perspectives.Collect().Combine(config);

        context.RegisterSourceOutput(combined, static (ctx, data) => {
            var (perspectiveList, tableConfig) = data;
            GenerateSchema(ctx, perspectiveList!, tableConfig);
        });
    }

    private static void GenerateSchema(
        SourceProductionContext context,
        ImmutableArray<PerspectiveInfo> perspectives,
        TableNameConfig config) {

        foreach (var perspective in perspectives) {
            // Apply table name configuration
            var tableName = NamingConventionUtilities.GetTableName(
                perspective.ClassName,
                config
            );

            // Generate schema with configured table name...
        }
    }
}
```

### Direct Access

For simpler scenarios, access configuration directly:

```csharp{title="Direct Access" description="For simpler scenarios, access configuration directly:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Direct", "Access"]}
var config = ConfigurationUtilities.GetTableNameConfig(
    context.AnalyzerConfigOptionsProvider.GlobalOptions
);

if (config.StripSuffixes) {
    // Apply suffix stripping logic
}
```

---

## Suffix Parsing

The `ParseSuffixList` method handles comma-separated suffix lists:

```csharp{title="Suffix Parsing" description="The ParseSuffixList method handles comma-separated suffix lists:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Suffix", "Parsing"]}
// Parse from MSBuild property
var suffixes = ConfigurationUtilities.ParseSuffixList("ReadModel, Model, Dto");
// Result: ["ReadModel", "Model", "Dto"]

// Handles whitespace and empty entries
var suffixes = ConfigurationUtilities.ParseSuffixList("  Foo , , Bar , ");
// Result: ["Foo", "Bar"]

// Empty or null returns empty array
var suffixes = ConfigurationUtilities.ParseSuffixList("");
// Result: []
```

---

## Best Practices

### DO

- Use `Directory.Build.props` for solution-wide settings
- Provide sensible defaults (don't require configuration)
- Document available options in project README
- Use incremental pipeline with `Select` for optimal caching

### DON'T

- Require configuration for basic functionality
- Read configuration in predicates (performance impact)
- Ignore null/missing options (use defaults)

---

## Troubleshooting

### Configuration Not Applied

**Symptoms**: Generator ignores MSBuild property values.

**Causes**:
1. Property not available in analyzer config
2. Property name typo

**Solution**: Ensure property is in a `<PropertyGroup>` (not `<ItemGroup>`):

```xml{title="Configuration Not Applied" description="Solution: Ensure property is in a <PropertyGroup> (not <ItemGroup>):" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Configuration", "Not"]}
<!-- Correct -->
<PropertyGroup>
  <WhizbangStripTableNameSuffixes>false</WhizbangStripTableNameSuffixes>
</PropertyGroup>

<!-- Wrong - ItemGroup -->
<ItemGroup>
  <WhizbangStripTableNameSuffixes>false</WhizbangStripTableNameSuffixes>
</ItemGroup>
```

### Suffix Not Stripped

**Symptoms**: Class suffix appears in generated table name.

**Causes**:
1. Suffix not in list
2. Stripping disabled

**Solution**: Add suffix to list:

```xml{title="Suffix Not Stripped" description="Solution: Add suffix to list:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Suffix", "Not"]}
<WhizbangTableNameSuffixesToStrip>ReadModel,Model,Projection,Dto,View,ViewModel</WhizbangTableNameSuffixesToStrip>
```

---

## Related Topics

- [Perspective Discovery](perspective-discovery) - How perspectives are discovered
- [Table Naming](../../fundamentals/perspectives/table-naming) - Table naming conventions
- [JSON Contexts](json-contexts) - JSON serialization configuration

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
