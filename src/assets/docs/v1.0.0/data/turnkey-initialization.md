# Turnkey Database Initialization

Whizbang provides a simple one-line initialization method that ensures your database schema is ready before your application starts. This prevents race conditions where background services might try to query the database before tables or extensions (like pgvector) are created.

## Quick Start

```csharp
var app = builder.Build();

// Initialize Whizbang database BEFORE starting the app
await app.EnsureWhizbangInitializedAsync();

await app.RunAsync();
```

## What It Does

`EnsureWhizbangInitializedAsync()` performs the following for each registered `[WhizbangDbContext]`:

1. **Creates core infrastructure tables** - Inbox, Outbox, EventStore, and other Whizbang tables
2. **Creates perspective tables** - Tables for your `PerspectiveRow<TModel>` types
3. **Adds constraints and indexes** - Foreign keys, composite primary keys, GIN indexes on JSONB columns
4. **Installs PostgreSQL extensions** - Creates `vector` extension if any perspectives have `[VectorField]` columns
5. **Creates PostgreSQL functions** - `process_work_batch`, `register_message_associations`, etc.
6. **Registers perspective associations** - Populates routing metadata for event dispatching

## Why Use It

### Before (Manual Initialization)

```csharp
// Error-prone: Must remember to do this for each DbContext
// Risk: Code might run in the wrong order or be forgotten
{
  using var scope = app.Services.CreateScope();
  var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
  var dbContext = scope.ServiceProvider.GetRequiredService<MyDbContext>();
  await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}
await app.RunAsync();
```

### After (Turnkey Initialization)

```csharp
// Simple: One line initializes ALL registered DbContexts
// Safe: Runs before app starts, preventing race conditions
await app.EnsureWhizbangInitializedAsync();
await app.RunAsync();
```

## How It Works

The source generator automatically registers each `[WhizbangDbContext]`-annotated DbContext with `DbContextInitializationRegistry`. When you call `EnsureWhizbangInitializedAsync()`, it:

1. Iterates through all registered DbContexts
2. Resolves each DbContext from the service provider
3. Calls `EnsureWhizbangDatabaseInitializedAsync()` on each

This is AOT-compatible with no reflection - all registration happens via source-generated module initializers.

## Multiple DbContexts

If your application has multiple Whizbang DbContexts, they are all initialized automatically:

```csharp
// Both DbContexts are initialized with one call
builder.Services.AddWhizbang()
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres;

builder.Services.AddWhizbang()
    .WithEFCore<InventoryDbContext>()
    .WithDriver.Postgres;

var app = builder.Build();
await app.EnsureWhizbangInitializedAsync(); // Initializes both!
await app.RunAsync();
```

## Logging

Initialization progress is logged at `Information` level:

```
info: Whizbang.Initialization[0]
      Initializing 1 Whizbang DbContext(s)...
info: Whizbang.Initialization[0]
      Initializing ChatDbContext...
info: Whizbang.Initialization[0]
      All Whizbang DbContext(s) initialized successfully
```

## Idempotency

All initialization operations are idempotent. It's safe to call `EnsureWhizbangInitializedAsync()` multiple times - existing tables and functions are not recreated.

## See Also

- [EF Core JSON Configuration](./efcore-json-configuration.md)
- [Schema Migration](./schema-migration.md)
