---
title: EF Core 10 JSON Configuration
category: Data
order: 10
description: Configuring EF Core 10 with custom JSON converters for JSONB columns
tags: efcore, json, jsonb, postgresql, npgsql, converters
---

# EF Core 10 JSON Configuration with Custom Converters

## Overview

EF Core 10 has native JSONB support for PostgreSQL. When using custom JSON converters (like WhizbangId converters from source generators), you should configure EF Core through dependency injection, NOT through NpgsqlDataSource directly.

## ✅ Correct Approach

```csharp
// 1. Create JsonSerializerOptions with your custom converters
var jsonOptions = WhizbangJsonContext.CreateOptions();

// 2. Register in DI - EF Core will use this automatically for JSONB columns
builder.Services.AddSingleton(jsonOptions);

// 3. Configure DbContext with simple connection string
builder.Services.AddDbContext<MyDbContext>(options => {
  options.UseNpgsql(connectionString);
  // EF Core 10 automatically picks up JsonSerializerOptions from DI
});
```

## ❌ Incorrect Approach (Bypasses EF Core ORM)

```csharp
// DON'T DO THIS - it bypasses EF Core's ORM layer
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
dataSourceBuilder.ConfigureJsonOptions(jsonOptions);
var dataSource = dataSourceBuilder.Build();
builder.Services.AddSingleton(dataSource);

builder.Services.AddDbContext<MyDbContext>(options => {
  options.UseNpgsql(dataSource); // Bypasses EF Core's JSON handling
});
```

## Why This Matters

**Using NpgsqlDataSource directly**:
- Gives JSON configuration to Npgsql, not EF Core
- Bypasses EF Core's ORM layer and change tracking
- Breaks the abstraction - you're configuring the provider directly instead of the ORM

**Using DI registration**:
- EF Core picks up JsonSerializerOptions from DI automatically
- Stays within EF Core's ORM layer (proper separation of concerns)
- Follows the "use the ORM" principle
- Cleaner code, better integration

## When to Use This Pattern

Use this pattern when:
- You have custom JSON converters (like WhizbangId converters)
- You're storing complex objects in JSONB columns (like perspective lens DTOs)
- You want EF Core to handle JSON serialization for owned types or JSON columns

## Example: Perspective Row Storage

Perspective rows store lens DTOs in JSONB columns:

```csharp
public class PerspectiveRow<TLensDto> where TLensDto : class {
  public Guid Id { get; set; }
  public TLensDto Data { get; set; } // Stored as JSONB
}
```

EF Core 10 will automatically:
- Use JsonSerializerOptions from DI to serialize TLensDto to JSONB
- Apply your custom converters (like WhizbangId converters)
- Track changes properly through the ORM

## References

- [EF Core 10 JSON columns](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew#json-columns)
- [Npgsql EF Core provider](https://www.npgsql.org/efcore/)
