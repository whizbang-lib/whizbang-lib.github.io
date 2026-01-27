# Migrate from Marten/Wolverine: Project Setup

This guide covers NuGet package installation and project configuration for migrating to Whizbang.

## NuGet Packages

### Core Packages

Add the following packages to your project:

```xml
<ItemGroup>
  <!-- Core framework -->
  <PackageReference Include="Whizbang.Core" Version="0.1.0" />

  <!-- Source generators (required) -->
  <PackageReference Include="Whizbang.Generators" Version="0.1.0" />

  <!-- PostgreSQL event store -->
  <PackageReference Include="Whizbang.Data.EFCore.Postgres" Version="0.1.0" />
</ItemGroup>
```

### Transport Packages

Choose one or both transport packages based on your deployment environment:

```xml
<ItemGroup>
  <!-- For RabbitMQ (local development) -->
  <PackageReference Include="Whizbang.Transports.RabbitMQ" Version="0.1.0" />

  <!-- For Azure Service Bus (production) -->
  <PackageReference Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />
</ItemGroup>
```

### Testing Packages

```xml
<ItemGroup>
  <PackageReference Include="Whizbang.Testing" Version="0.1.0" />
</ItemGroup>
```

## Project Configuration

### Enable Source Generators

Ensure your project has the following settings in the `.csproj` file:

```xml
<PropertyGroup>
  <TargetFramework>net10.0</TargetFramework>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>

  <!-- Required for source generators -->
  <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
</PropertyGroup>
```

### Global Usings

Create or update `GlobalUsings.cs`:

```csharp
global using Whizbang.Core;
global using Whizbang.Core.Messaging;
global using Whizbang.Core.Perspectives;
global using Whizbang.Core.Receptors;
```

## Service Registration

### Basic Setup

```csharp
var builder = WebApplication.CreateBuilder(args);

// Add Whizbang core services
builder.Services.AddWhizbang(options => {
    options.UsePostgresEventStore(
        builder.Configuration.GetConnectionString("EventStore")!);
});

// Transport configuration (see 06-transport-configuration.md for details)
builder.Services.AddWhizbangTransport(builder.Configuration);

var app = builder.Build();
app.UseWhizbang();
app.Run();
```

### Parallel Installation with Marten/Wolverine

During migration, you can run both frameworks simultaneously:

```csharp
var builder = WebApplication.CreateBuilder(args);

// Existing Marten/Wolverine (keep during migration)
builder.Services.AddMarten(options => {
    options.Connection(builder.Configuration.GetConnectionString("Marten")!);
});
builder.Host.UseWolverine();

// New Whizbang (add alongside)
builder.Services.AddWhizbang(options => {
    options.UsePostgresEventStore(
        builder.Configuration.GetConnectionString("EventStore")!);
    options.SchemaName = "whizbang"; // Separate schema during migration
});
```

### Schema Isolation

During migration, use separate database schemas to avoid conflicts:

```csharp
builder.Services.AddWhizbang(options => {
    options.UsePostgresEventStore(connectionString);
    options.SchemaName = "whizbang"; // Keeps data separate from Marten
});
```

## Directory Structure

Recommended project structure after migration:

```
src/MyService/
├── Commands/
│   └── CreateOrderCommand.cs
├── Events/
│   └── OrderCreated.cs
├── Receptors/
│   └── CreateOrderReceptor.cs
├── Perspectives/
│   └── OrderPerspective.cs
├── Program.cs
└── GlobalUsings.cs
```

## Removing Marten/Wolverine

Once migration is complete and validated:

1. Remove package references:
```xml
<!-- Remove these -->
<PackageReference Include="Marten" Version="*" />
<PackageReference Include="WolverineFx" Version="*" />
```

2. Remove obsolete service registrations:
```csharp
// Remove these lines
builder.Services.AddMarten(...);
builder.Host.UseWolverine();
```

3. Delete migrated handler classes
4. Run `dotnet clean && dotnet build` to verify

## Next Steps

- [Handler Migration](./03-handler-migration.md) - Convert Wolverine handlers to Receptors
- [Projection Migration](./04-projection-migration.md) - Convert Marten projections to Perspectives
