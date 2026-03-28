---
title: Project Setup
version: 1.0.0
category: Migration Guide
order: 3
description: NuGet packages and initial configuration for migrating to Whizbang
tags: 'migration, nuget, packages, configuration, setup'
codeReferences:
  - samples/ECommerce/ECommerce.OrderService.API/Program.cs
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
  <PackageReference Include="Whizbang.Core" Version="0.1.0" />
  <PackageReference Include="Whizbang.Generators" Version="0.1.0"
                    OutputItemType="Analyzer"
                    ReferenceOutputAssembly="false" />

  <!-- Data Layer (choose based on your preference) -->
  <!-- Option A: EF Core (recommended for complex queries) -->
  <PackageReference Include="Whizbang.Data.EFCore.Postgres" Version="0.1.0" />

  <!-- Option B: Dapper (recommended for performance) -->
  <PackageReference Include="Whizbang.Data.Dapper.Postgres" Version="0.1.0" />

  <!-- Transports (include both for environment switching) -->
  <PackageReference Include="Whizbang.Transports.RabbitMQ" Version="0.1.0" />
  <PackageReference Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />

  <!-- Testing (for test projects) -->
  <PackageReference Include="Whizbang.Testing" Version="0.1.0" />
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

// Whizbang configuration
builder.Services.AddWhizbang(options => {
    // Database configuration
    options.UsePostgres(builder.Configuration.GetConnectionString("postgres")!);

    // Or for EF Core:
    // options.UseEFCore<AppDbContext>();
});

// Transport configuration (environment-based switching)
var useRabbitMQ = builder.Configuration.GetValue<bool>("UseRabbitMQ");

if (useRabbitMQ) {
    // Local development with Aspire
    builder.Services.AddRabbitMQTransport(
        builder.Configuration.GetConnectionString("rabbitmq")!,
        options => {
            options.DefaultExchange = "whizbang.events";
        });
} else {
    // Production with Azure Service Bus
    builder.Services.AddAzureServiceBusTransport(
        builder.Configuration.GetConnectionString("servicebus")!,
        options => {
            options.DefaultTopicName = "whizbang-events";
        });
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

Whizbang uses a different database schema than Marten. Initialize it on startup:

```csharp{title="Initialize Whizbang Schema" description="Whizbang uses a different database schema than Marten." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Initialize", "Whizbang", "Schema"]}
var app = builder.Build();

// Initialize Whizbang schema
using (var scope = app.Services.CreateScope()) {
    var schemaInitializer = scope.ServiceProvider.GetRequiredService<ISchemaInitializer>();
    await schemaInitializer.InitializeAsync();
}

app.Run();
```

### Schema Comparison

| Marten Table | Whizbang Table | Notes |
|--------------|----------------|-------|
| `mt_events` | `whizbang.events` | Event storage |
| `mt_streams` | `whizbang.streams` | Stream metadata |
| `mt_doc_*` | `whizbang.perspectives_*` | Read model storage |
| `mt_event_progression` | `whizbang.checkpoints` | Projection progress |
| `wolverine_incoming_envelopes` | `whizbang.inbox` | Inbox messages |
| `wolverine_outgoing_envelopes` | `whizbang.outbox` | Outbox messages |

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

3. **Run database migration**:
   ```bash
   dotnet run -- schema init
   ```

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
