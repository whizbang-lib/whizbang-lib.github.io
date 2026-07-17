---
title: Project Setup
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 3
description: NuGet packages and initial configuration for migrating to Whizbang
tags: 'migration, nuget, packages, configuration, setup'
codeReferences:
  - samples/ECommerce/ECommerce.OrderService.API/Program.cs
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.RabbitMQ/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Core.Tests/ServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/ServiceCollectionExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# Project Setup for Migration

This guide covers the NuGet package changes and initial configuration needed when migrating from Marten/Wolverine to Whizbang.

## Package Changes

### Remove Marten/Wolverine Packages

Remove these packages from your `.csproj` files:

```xml{title="Remove Marten/Wolverine Packages" description="Remove these packages from your `." category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Remove", "Marten", "Wolverine"]}
<!-- REMOVE THESE -->
<PackageReference Include="Marten" Version="x.x.x" />
<PackageReference Include="Marten.AspNetCore" Version="x.x.x" />
<PackageReference Include="Marten.Events.Projections" Version="x.x.x" />
<PackageReference Include="Wolverine" Version="x.x.x" />
<PackageReference Include="Wolverine.Marten" Version="x.x.x" />
<PackageReference Include="WolverineFx.RabbitMQ" Version="x.x.x" />
<PackageReference Include="WolverineFx.AzureServiceBus" Version="x.x.x" />
<PackageReference Include="WolverineFx.Kafka" Version="x.x.x" />
```

### Add Whizbang Packages

Add the Whizbang packages from NuGet.org:

```xml{title="Add Whizbang Packages" description="Add the Whizbang packages from NuGet." category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Xml", "Add", "Whizbang", "Packages"]}
<ItemGroup>
  <!-- Core Whizbang -->
  <PackageReference Include="Whizbang.Core" Version="x.x.x" />
  <PackageReference Include="Whizbang.Generators" Version="x.x.x"
                    OutputItemType="Analyzer"
                    ReferenceOutputAssembly="false" />

  <!-- Data Layer (choose based on your preference) -->
  <!-- Option A: EF Core (recommended for complex queries) -->
  <PackageReference Include="Whizbang.Data.EFCore.Postgres" Version="x.x.x" />

  <!-- Option B: Dapper (recommended for performance) -->
  <PackageReference Include="Whizbang.Data.Dapper.Postgres" Version="x.x.x" />

  <!-- Transports (include both for environment switching) -->
  <PackageReference Include="Whizbang.Transports.RabbitMQ" Version="x.x.x" />
  <PackageReference Include="Whizbang.Transports.AzureServiceBus" Version="x.x.x" />

  <!-- Testing (for test projects) -->
  <PackageReference Include="Whizbang.Testing" Version="x.x.x" />
</ItemGroup>
```

## Configuration Changes

### Program.cs Migration

**Before (Marten/Wolverine)**:

```csharp{title="Program.cs Migration" description="Before (Marten/Wolverine):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Program.cs", "Migration"]}
var builder = WebApplication.CreateBuilder(args);

// Marten configuration
builder.Services.AddMarten(opts => {
    opts.Connection(builder.Configuration.GetConnectionString("postgres")!);
    opts.Events.TenancyStyle = TenancyStyle.Conjoined;
    opts.Events.AppendMode = EventAppendMode.Quick;
})
.IntegrateWithWolverine()
.AddAsyncDaemon(DaemonMode.HotCold);

// Wolverine configuration
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq(builder.Configuration.GetConnectionString("rabbitmq")!)
        .UseConventionalRouting()
        .UseDurableOutbox();
});

var app = builder.Build();
```

**After (Whizbang)**:

```csharp{title="Program.cs Migration (2)" description="After (Whizbang):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Program.cs", "Migration"]}
var builder = WebApplication.CreateBuilder(args);

// Register your EF Core DbContext (marked with [WhizbangDbContext])
builder.Services.AddDbContext<OrderDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("postgres")!));

// Whizbang configuration — fluent builder selects the storage provider + driver
builder.Services
    .AddWhizbang()
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres;

// Generated registrations (produced by Whizbang.Generators)
builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

// Transport configuration (environment-based switching)
var useRabbitMQ = builder.Configuration.GetValue<bool>("UseRabbitMQ");

if (useRabbitMQ) {
    // Local development with Aspire
    builder.Services.AddRabbitMQTransport(
        builder.Configuration.GetConnectionString("rabbitmq")!,
        options => {
            options.DefaultQueueName = "whizbang-events";
        });
    builder.Services.AddRabbitMQHealthChecks();
} else {
    // Production with Azure Service Bus
    builder.Services.AddAzureServiceBusTransport(
        builder.Configuration.GetConnectionString("servicebus")!,
        options => {
            options.DefaultSubscriptionName = "order-service";
        });
    builder.Services.AddAzureServiceBusHealthChecks();
}

var app = builder.Build();
```

### AppSettings Configuration

**appsettings.Development.json** (for local Aspire development):

```json{title="AppSettings Configuration" description="**appsettings." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Json", "AppSettings", "Configuration"]}
{
  "UseRabbitMQ": true,
  "ConnectionStrings": {
    "postgres": "Host=localhost;Database=myapp;Username=postgres;Password=postgres",
    "rabbitmq": "amqp://guest:guest@localhost:5672"
  }
}
```

**appsettings.Production.json** (for Azure deployment):

```json{title="AppSettings Configuration (2)" description="**appsettings." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Json", "AppSettings", "Configuration"]}
{
  "UseRabbitMQ": false,
  "ConnectionStrings": {
    "postgres": "Host=myapp.postgres.database.azure.com;Database=myapp;...",
    "servicebus": "Endpoint=sb://myapp.servicebus.windows.net/;..."
  }
}
```

## Database Schema

### Initialize Whizbang Schema

Whizbang uses a different database schema than Marten. Initialize it on startup.

**EF Core path** — the source generator emits an `EnsureWhizbangDatabaseInitializedAsync()` extension on your `[WhizbangDbContext]`-marked context:

```csharp{title="Initialize Whizbang Schema" description="Whizbang uses a different database schema than Marten." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Initialize", "Whizbang", "Schema"]}
var app = builder.Build();

// Initialize Whizbang schema (generated extension method —
// creates inbox/outbox/event-store tables + PostgreSQL functions)
using (var scope = app.Services.CreateScope()) {
    var dbContext = scope.ServiceProvider.GetRequiredService<OrderDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}

app.Run();
```

**Dapper path** — pass `initializeSchema: true` at registration and the schema is initialized by a hosted service on startup:

```csharp{title="Initialize Whizbang Schema (Dapper)" description="Dapper registration with automatic schema initialization on startup" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Initialize", "Dapper", "Schema"]}
builder.Services.AddWhizbangPostgres(
    connectionString,
    jsonOptions,
    initializeSchema: true);
```

### Schema Comparison

| Marten Table | Whizbang Table | Notes |
|--------------|----------------|-------|
| `mt_events` | `wh_event_store` | Event storage (stream_id + version per row) |
| `mt_streams` | `wh_active_streams` | Active stream ownership/lease metadata |
| `mt_doc_*` | `wh_per_*` | Read model storage (one table per perspective) |
| `mt_event_progression` | `wh_perspective_cursors` | Perspective (projection) progress |
| `wolverine_incoming_envelopes` | `wh_inbox` | Inbox messages |
| `wolverine_outgoing_envelopes` | `wh_outbox` | Outbox messages |

## Namespace Changes

Update your using statements:

```csharp{title="Namespace Changes" description="Update your using statements:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Namespace", "Changes"]}
// Remove
using Marten;
using Marten.Events;
using Marten.Events.Projections;
using Wolverine;
using Wolverine.Attributes;

// Add
using Whizbang.Core;
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives;
```

## Dependency Injection Changes

### Service Registration

**Before**:

```csharp{title="Service Registration" description="Service Registration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Service", "Registration"]}
// Marten session injection
public class OrderService {
    private readonly IDocumentSession _session;

    public OrderService(IDocumentSession session) {
        _session = session;
    }
}
```

**After**:

```csharp{title="Service Registration - OrderService" description="Service Registration - OrderService" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Service", "Registration", "OrderService"]}
// Whizbang direct injection
public class OrderService {
    private readonly IEventStore _eventStore;
    private readonly IDispatcher _dispatcher;

    public OrderService(IEventStore eventStore, IDispatcher dispatcher) {
        _eventStore = eventStore;
        _dispatcher = dispatcher;
    }
}
```

## Verification Steps

After updating packages and configuration:

1. **Build the solution**:
   ```bash
   dotnet build
   ```

2. **Check for source generator output**:
   Look for generated files in `obj/Debug/net10.0/generated/`

3. **Run the app once** — schema initialization happens on startup (the generated `EnsureWhizbangDatabaseInitializedAsync()` call, or the Dapper `initializeSchema: true` hosted service). Hash-based tracking makes re-runs cheap no-ops.

4. **Run tests**:
   ```bash
   dotnet test
   ```

## Common Issues

### Missing Receptors

If handlers aren't being discovered:
- Ensure `Whizbang.Generators` is referenced with `OutputItemType="Analyzer"`
- Verify classes implement `IReceptor<TMessage>` or `IReceptor<TMessage, TResult>`
- Check that receptor classes are `public`

### Database Connection

If database operations fail:
- Verify connection string format for Whizbang (same as Npgsql)
- Ensure schema initialization ran successfully
- Check that PostgreSQL extensions are installed (if using custom types)

---

*Previous: [Concept Mapping](01-concept-mapping.md) | Next: [Handler Migration](03-handler-migration.md)*
