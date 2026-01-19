---
title: "EF Core Integration"
version: 0.1.0
category: Data Access
order: 2
description: "Full-featured ORM with EF Core 10 for complex domain models - JSONB support, UUIDv7, migrations, and advanced querying"
tags: ef-core, entity-framework, postgresql, orm, jsonb, uuidv7
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/WhizbangDbContext.cs
  - samples/ECommerce/ECommerce.Domain/Infrastructure/ECommerceDbContext.cs
---

# EF Core Integration

**EF Core** is a full-featured Object-Relational Mapper (ORM) for .NET, recommended for **complex domain models** and **write operations** in Whizbang applications. While Dapper excels at read models, EF Core provides rich modeling capabilities, change tracking, and migrations.

## EF Core vs Dapper

| Feature | EF Core | Dapper |
|---------|---------|--------|
| **Best for** | Write models, complex domain logic | Read models, simple queries |
| **Performance** | Slower (change tracking overhead) | ~20x faster for reads |
| **Learning curve** | Complex (LINQ, migrations, tracking) | Simple (just SQL) |
| **Features** | Migrations, change tracking, navigation properties | Direct SQL execution |
| **Type safety** | Full LINQ type safety | SQL string-based |
| **Use in Whizbang** | ✅ Domain aggregates, write operations | ✅ Perspectives, Lenses |

**Whizbang Philosophy**: Use **Dapper for reads** (perspectives, lenses), **EF Core for writes** (domain models, commands).

---

## Installation

```bash
dotnet add package Whizbang.Data.EFCore.Postgres
```

**Includes**:
- `WhizbangDbContext` - Base DbContext with conventions
- EF Core 10.x (latest version)
- Npgsql.EntityFrameworkCore.PostgreSQL (PostgreSQL provider)
- Migration utilities

**Additional Tools** (for migrations):
```bash
dotnet tool install --global dotnet-ef
```

---

## EF Core 10 Features

### JSONB Column Support

EF Core 10 has native **JSONB** support for PostgreSQL:

```csharp
public class Product {
    public Guid Id { get; set; }
    public string Name { get; set; } = default!;

    // Native JSONB column
    public ProductMetadata Metadata { get; set; } = default!;
}

public class ProductMetadata {
    public string Category { get; set; } = default!;
    public string[] Tags { get; set; } = Array.Empty<string>();
    public Dictionary<string, string> Attributes { get; set; } = new();
}

// DbContext configuration
protected override void OnModelCreating(ModelBuilder modelBuilder) {
    modelBuilder.Entity<Product>(entity => {
        entity.ToTable("products");

        // JSONB column (automatic in EF Core 10 for PostgreSQL)
        entity.OwnsOne(p => p.Metadata, owned => {
            owned.ToJson();  // Stores as JSONB
        });
    });
}
```

**Query JSONB**:
```csharp
// Query nested JSONB properties
var products = await context.Products
    .Where(p => p.Metadata.Category == "Electronics")
    .ToListAsync();

// Query JSONB array contains
var products = await context.Products
    .Where(p => p.Metadata.Tags.Contains("featured"))
    .ToListAsync();
```

### UUIDv7 Support

EF Core 10 with Npgsql supports **UUIDv7** (time-ordered GUIDs):

```csharp
public class Order {
    public Guid Id { get; set; }  // Will be UUIDv7
    public Guid CustomerId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

// DbContext configuration
protected override void OnModelCreating(ModelBuilder modelBuilder) {
    modelBuilder.Entity<Order>(entity => {
        entity.ToTable("orders");

        entity.Property(e => e.Id)
            .HasDefaultValueSql("uuid_generate_v7()")  // PostgreSQL function
            .ValueGeneratedOnAdd();

        entity.Property(e => e.CreatedAt)
            .HasDefaultValueSql("NOW()");
    });
}
```

**Benefits**:
- Time-ordered: Natural chronological sorting
- Database-friendly: Sequential inserts, no index fragmentation
- Timestamp embedded: Extract creation time from ID

### Complex Types

EF Core 10 supports **complex types** (value objects without separate tables):

```csharp
public class Order {
    public Guid Id { get; set; }
    public Money Total { get; set; }  // Complex type
    public Address ShippingAddress { get; set; }  // Complex type
}

[ComplexType]
public record Money(decimal Amount, string Currency);

[ComplexType]
public record Address(
    string Street,
    string City,
    string State,
    string PostalCode
);

// DbContext configuration
protected override void OnModelCreating(ModelBuilder modelBuilder) {
    modelBuilder.Entity<Order>(entity => {
        // Complex types map to columns: total_amount, total_currency
        entity.ComplexProperty(e => e.Total);

        // Maps to: address_street, address_city, address_state, address_postal_code
        entity.ComplexProperty(e => e.ShippingAddress);
    });
}
```

---

## DbContext Setup

### Basic Configuration

```csharp
public class ECommerceDbContext : DbContext {
    public ECommerceDbContext(DbContextOptions<ECommerceDbContext> options)
        : base(options) {
    }

    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Product> Products => Set<Product>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        base.OnModelCreating(modelBuilder);

        // Apply configurations
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ECommerceDbContext).Assembly);
    }
}
```

### Entity Type Configuration

```csharp
public class OrderConfiguration : IEntityTypeConfiguration<Order> {
    public void Configure(EntityTypeBuilder<Order> builder) {
        builder.ToTable("orders");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id)
            .HasDefaultValueSql("uuid_generate_v7()")
            .ValueGeneratedOnAdd();

        builder.Property(e => e.CustomerId)
            .IsRequired();

        builder.Property(e => e.Status)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(e => e.Total)
            .HasPrecision(18, 2)  // decimal(18,2)
            .IsRequired();

        builder.Property(e => e.CreatedAt)
            .HasDefaultValueSql("NOW()")
            .ValueGeneratedOnAdd();

        // Navigation properties
        builder.HasOne(e => e.Customer)
            .WithMany(c => c.Orders)
            .HasForeignKey(e => e.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(e => e.Items)
            .WithOne()
            .HasForeignKey("OrderId")
            .OnDelete(DeleteBehavior.Cascade);
    }
}
```

### Registration (Program.cs)

```csharp
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")!;

builder.Services.AddDbContext<ECommerceDbContext>(options => {
    options.UseNpgsql(connectionString, npgsqlOptions => {
        npgsqlOptions.MigrationsAssembly("ECommerce.Infrastructure");
        npgsqlOptions.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery);
    });

    // Development settings
    if (builder.Environment.IsDevelopment()) {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
});
```

---

## Migrations

### Creating Migrations

```bash
# Add new migration
dotnet ef migrations add InitialCreate --project src/ECommerce.Infrastructure --startup-project src/ECommerce.API

# Apply migrations to database
dotnet ef database update --project src/ECommerce.Infrastructure --startup-project src/ECommerce.API

# Remove last migration (if not applied)
dotnet ef migrations remove --project src/ECommerce.Infrastructure --startup-project src/ECommerce.API

# List all migrations
dotnet ef migrations list --project src/ECommerce.Infrastructure --startup-project src/ECommerce.API
```

### Migration Example

```csharp
public partial class InitialCreate : Migration {
    protected override void Up(MigrationBuilder migrationBuilder) {
        // Enable UUIDv7 extension
        migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";");

        migrationBuilder.CreateTable(
            name: "orders",
            columns: table => new {
                id = table.Column<Guid>(nullable: false, defaultValueSql: "uuid_generate_v7()"),
                customer_id = table.Column<Guid>(nullable: false),
                total = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                status = table.Column<string>(maxLength: 50, nullable: false),
                created_at = table.Column<DateTimeOffset>(nullable: false, defaultValueSql: "NOW()")
            },
            constraints: table => {
                table.PrimaryKey("pk_orders", x => x.id);
            }
        );

        migrationBuilder.CreateIndex(
            name: "ix_orders_customer_id",
            table: "orders",
            column: "customer_id"
        );

        migrationBuilder.CreateIndex(
            name: "ix_orders_created_at",
            table: "orders",
            column: "created_at"
        );
    }

    protected override void Down(MigrationBuilder migrationBuilder) {
        migrationBuilder.DropTable(name: "orders");
    }
}
```

### Apply Migrations at Startup

```csharp
// Program.cs - Apply migrations on startup (Development only)
if (app.Environment.IsDevelopment()) {
    using var scope = app.Services.CreateScope();
    var context = scope.ServiceProvider.GetRequiredService<ECommerceDbContext>();
    await context.Database.MigrateAsync();  // Apply pending migrations
}
```

---

## Basic Usage

### Insert

```csharp
public class OrderService {
    private readonly ECommerceDbContext _context;

    public async Task<Order> CreateOrderAsync(
        Guid customerId,
        OrderItem[] items,
        CancellationToken ct = default) {

        var order = new Order {
            CustomerId = customerId,
            Status = "Created",
            Total = items.Sum(i => i.UnitPrice * i.Quantity),
            CreatedAt = DateTimeOffset.UtcNow
        };

        // Add order items
        foreach (var item in items) {
            order.Items.Add(new OrderItem {
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                UnitPrice = item.UnitPrice
            });
        }

        _context.Orders.Add(order);
        await _context.SaveChangesAsync(ct);

        return order;
    }
}
```

### Query

```csharp
public async Task<Order?> GetOrderAsync(
    Guid orderId,
    CancellationToken ct = default) {

    return await _context.Orders
        .Include(o => o.Items)  // Eager load items
        .Include(o => o.Customer)  // Eager load customer
        .FirstOrDefaultAsync(o => o.Id == orderId, ct);
}

public async Task<Order[]> GetOrdersByCustomerAsync(
    Guid customerId,
    CancellationToken ct = default) {

    return await _context.Orders
        .Where(o => o.CustomerId == customerId)
        .OrderByDescending(o => o.CreatedAt)
        .ToArrayAsync(ct);
}
```

### Update

```csharp
public async Task UpdateOrderStatusAsync(
    Guid orderId,
    string newStatus,
    CancellationToken ct = default) {

    var order = await _context.Orders
        .FirstOrDefaultAsync(o => o.Id == orderId, ct);

    if (order is null) {
        throw new NotFoundException($"Order {orderId} not found");
    }

    order.Status = newStatus;
    order.UpdatedAt = DateTimeOffset.UtcNow;

    await _context.SaveChangesAsync(ct);
}
```

### Delete

```csharp
public async Task DeleteOrderAsync(
    Guid orderId,
    CancellationToken ct = default) {

    var order = await _context.Orders
        .FirstOrDefaultAsync(o => o.Id == orderId, ct);

    if (order is not null) {
        _context.Orders.Remove(order);
        await _context.SaveChangesAsync(ct);
    }
}
```

---

## Advanced Querying

### Pagination

```csharp
public async Task<PagedResult<Order>> GetOrdersPagedAsync(
    int pageNumber,
    int pageSize,
    CancellationToken ct = default) {

    var query = _context.Orders
        .OrderByDescending(o => o.CreatedAt);

    var total = await query.CountAsync(ct);

    var orders = await query
        .Skip((pageNumber - 1) * pageSize)
        .Take(pageSize)
        .ToArrayAsync(ct);

    return new PagedResult<Order> {
        Items = orders,
        TotalCount = total,
        PageNumber = pageNumber,
        PageSize = pageSize
    };
}
```

### Search

```csharp
public async Task<Order[]> SearchOrdersAsync(
    string searchTerm,
    CancellationToken ct = default) {

    return await _context.Orders
        .Include(o => o.Customer)
        .Where(o =>
            o.Id.ToString().Contains(searchTerm) ||
            o.Customer.Name.Contains(searchTerm) ||
            o.Customer.Email.Contains(searchTerm)
        )
        .OrderByDescending(o => o.CreatedAt)
        .Take(100)
        .ToArrayAsync(ct);
}
```

### Aggregations

```csharp
public async Task<OrderStatistics> GetOrderStatisticsAsync(
    Guid customerId,
    CancellationToken ct = default) {

    var stats = await _context.Orders
        .Where(o => o.CustomerId == customerId)
        .GroupBy(o => o.CustomerId)
        .Select(g => new OrderStatistics {
            TotalOrders = g.Count(),
            TotalSpent = g.Sum(o => o.Total),
            AverageOrderValue = g.Average(o => o.Total),
            LastOrderDate = g.Max(o => o.CreatedAt)
        })
        .FirstOrDefaultAsync(ct);

    return stats ?? new OrderStatistics();
}
```

### Raw SQL Queries

```csharp
public async Task<OrderSummary[]> GetTopCustomersAsync(
    int limit,
    CancellationToken ct = default) {

    return await _context.Database
        .SqlQuery<OrderSummary>($"""
            SELECT
                customer_id AS CustomerId,
                COUNT(*) AS TotalOrders,
                SUM(total) AS TotalSpent
            FROM orders
            GROUP BY customer_id
            ORDER BY SUM(total) DESC
            LIMIT {limit}
        """)
        .ToArrayAsync(ct);
}
```

---

## Transactions

### Explicit Transactions

```csharp
public async Task TransferInventoryAsync(
    Guid fromWarehouseId,
    Guid toWarehouseId,
    Guid productId,
    int quantity,
    CancellationToken ct = default) {

    await using var transaction = await _context.Database.BeginTransactionAsync(ct);

    try {
        // Deduct from source warehouse
        var fromInventory = await _context.Inventory
            .FirstAsync(i => i.WarehouseId == fromWarehouseId && i.ProductId == productId, ct);

        fromInventory.Available -= quantity;

        // Add to destination warehouse
        var toInventory = await _context.Inventory
            .FirstAsync(i => i.WarehouseId == toWarehouseId && i.ProductId == productId, ct);

        toInventory.Available += quantity;

        await _context.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

    } catch {
        await transaction.RollbackAsync(ct);
        throw;
    }
}
```

### Implicit Transactions

```csharp
// SaveChangesAsync wraps all changes in a transaction automatically
public async Task CreateOrderWithItemsAsync(
    Order order,
    OrderItem[] items,
    CancellationToken ct = default) {

    _context.Orders.Add(order);

    foreach (var item in items) {
        order.Items.Add(item);  // EF tracks relationship
    }

    await _context.SaveChangesAsync(ct);  // ← Atomic transaction
}
```

---

## Change Tracking

### No-Tracking Queries

Use `.AsNoTracking()` for read-only queries (better performance):

```csharp
// ✅ Read-only query (no change tracking overhead)
public async Task<Order[]> GetOrdersForDisplayAsync(CancellationToken ct = default) {
    return await _context.Orders
        .AsNoTracking()  // ← No change tracking!
        .Include(o => o.Items)
        .ToArrayAsync(ct);
}

// ❌ Change tracking enabled (slower)
public async Task<Order[]> GetOrdersAsync(CancellationToken ct = default) {
    return await _context.Orders
        .Include(o => o.Items)
        .ToArrayAsync(ct);  // EF tracks all entities for changes
}
```

### Tracking State

```csharp
public void DemoTrackingStates() {
    var order = new Order { /* ... */ };

    // EntityState.Detached (not tracked)
    Console.WriteLine(_context.Entry(order).State);  // Detached

    _context.Orders.Add(order);
    // EntityState.Added (will INSERT on SaveChanges)
    Console.WriteLine(_context.Entry(order).State);  // Added

    _context.SaveChanges();
    // EntityState.Unchanged (no pending changes)
    Console.WriteLine(_context.Entry(order).State);  // Unchanged

    order.Status = "Shipped";
    // EntityState.Modified (will UPDATE on SaveChanges)
    Console.WriteLine(_context.Entry(order).State);  // Modified

    _context.Orders.Remove(order);
    // EntityState.Deleted (will DELETE on SaveChanges)
    Console.WriteLine(_context.Entry(order).State);  // Deleted
}
```

---

## Performance Patterns

### Split Queries

```csharp
// ✅ Split query (multiple queries, better for large data)
var orders = await _context.Orders
    .Include(o => o.Items)
    .Include(o => o.Customer)
    .AsSplitQuery()  // ← Executes 3 queries (orders, items, customers)
    .ToListAsync();

// ❌ Single query (cartesian explosion for large data)
var orders = await _context.Orders
    .Include(o => o.Items)
    .Include(o => o.Customer)
    .AsSingleQuery()  // ← Executes 1 query with JOINs
    .ToListAsync();
```

**When to use**:
- **Split Query**: Multiple includes, large result sets
- **Single Query**: Few includes, small result sets

### Batch Operations

```csharp
// ✅ Batch insert (single SaveChanges)
public async Task BulkInsertOrdersAsync(Order[] orders, CancellationToken ct = default) {
    _context.Orders.AddRange(orders);
    await _context.SaveChangesAsync(ct);  // Single database roundtrip
}

// ❌ Loop insert (multiple SaveChanges)
public async Task SlowInsertOrdersAsync(Order[] orders, CancellationToken ct = default) {
    foreach (var order in orders) {
        _context.Orders.Add(order);
        await _context.SaveChangesAsync(ct);  // N database roundtrips!
    }
}
```

### Compiled Queries

```csharp
// Compiled query (cached expression tree)
private static readonly Func<ECommerceDbContext, Guid, Task<Order?>> GetOrderByIdQuery =
    EF.CompileAsyncQuery(
        (ECommerceDbContext context, Guid orderId) =>
            context.Orders
                .Include(o => o.Items)
                .FirstOrDefault(o => o.Id == orderId)
    );

public async Task<Order?> GetOrderFastAsync(Guid orderId) {
    return await GetOrderByIdQuery(_context, orderId);
}
```

**Benefit**: Expression tree compiled once, reused on every call.

---

## Testing

### In-Memory Provider

```csharp
public class OrderServiceTests {
    private ECommerceDbContext CreateInMemoryContext() {
        var options = new DbContextOptionsBuilder<ECommerceDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ECommerceDbContext(options);
    }

    [Test]
    public async Task CreateOrderAsync_ValidOrder_CreatesOrderAsync() {
        // Arrange
        await using var context = CreateInMemoryContext();
        var service = new OrderService(context);

        var items = new[] {
            new OrderItem { ProductId = Guid.NewGuid(), Quantity = 2, UnitPrice = 10.00m }
        };

        // Act
        var order = await service.CreateOrderAsync(Guid.NewGuid(), items);

        // Assert
        await Assert.That(order.Id).IsNotEqualTo(Guid.Empty);
        await Assert.That(order.Items).HasCount().EqualTo(1);
        await Assert.That(context.Orders).HasCount().EqualTo(1);
    }
}
```

### SQLite Provider (Better for Testing)

```csharp
public class OrderServiceTests {
    private ECommerceDbContext CreateSqliteContext() {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<ECommerceDbContext>()
            .UseSqlite(connection)
            .Options;

        var context = new ECommerceDbContext(options);
        context.Database.EnsureCreated();  // Create schema

        return context;
    }

    [Test]
    public async Task GetOrderAsync_ExistingOrder_ReturnsOrderAsync() {
        // Arrange
        await using var context = CreateSqliteContext();

        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = Guid.NewGuid(),
            Status = "Created",
            Total = 100.00m,
            CreatedAt = DateTimeOffset.UtcNow
        };

        context.Orders.Add(order);
        await context.SaveChangesAsync();

        var service = new OrderService(context);

        // Act
        var result = await service.GetOrderAsync(order.Id);

        // Assert
        await Assert.That(result).IsNotNull();
        await Assert.That(result!.Id).IsEqualTo(order.Id);
    }
}
```

**Why SQLite?** More accurate for testing (real SQL, constraints, indexes).

### Integration Tests with PostgreSQL

```csharp
public class OrderServiceIntegrationTests {
    private ECommerceDbContext _context = default!;

    [Before(Test)]
    public async Task SetupAsync() {
        var connectionString = "Host=localhost;Database=whizbang_test;Username=postgres;Password=test";

        var options = new DbContextOptionsBuilder<ECommerceDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        _context = new ECommerceDbContext(options);

        // Recreate database for clean slate
        await _context.Database.EnsureDeletedAsync();
        await _context.Database.EnsureCreatedAsync();
    }

    [After(Test)]
    public async Task TeardownAsync() {
        await _context.DisposeAsync();
    }

    [Test]
    public async Task CreateOrderAsync_WithRealDatabase_PersistsOrderAsync() {
        // Arrange
        var service = new OrderService(_context);

        var items = new[] {
            new OrderItem { ProductId = Guid.NewGuid(), Quantity = 2, UnitPrice = 10.00m }
        };

        // Act
        var order = await service.CreateOrderAsync(Guid.NewGuid(), items);

        // Assert
        await Assert.That(order.Id).IsNotEqualTo(Guid.Empty);

        // Verify in database
        var savedOrder = await _context.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == order.Id);

        await Assert.That(savedOrder).IsNotNull();
        await Assert.That(savedOrder!.Items).HasCount().EqualTo(1);
    }
}
```

---

## Native AOT Support

:::new
Whizbang's EF Core integration is **fully AOT-compatible** with zero reflection. The schema generation system uses source generators to pre-generate all SQL at build time.
:::

**Whizbang EF Core** is designed for Native AOT compilation from the ground up:
- ✅ **Zero Reflection**: All schema SQL pre-generated at build time
- ✅ **Embedded Resources**: Core infrastructure schema shipped as embedded SQL
- ✅ **Source Generators**: Perspective tables generated from discovered types
- ✅ **No IL3050 Warnings**: Fully compatible with `PublishAot=true`

### How It Works

When you build your application, the **EF Core source generator** runs automatically and:

1. **Embeds Core Infrastructure Schema** - Reads pre-generated SQL from embedded resources (9 core tables: service_instances, message_deduplication, inbox, outbox, event_store, receptor_processing, perspective_checkpoints, request_response, sequences)

2. **Discovers Perspective Tables** - Scans your DbContext for `PerspectiveRow<TModel>` properties and generates DDL at build time

3. **Bundles Migration Scripts** - Embeds all PostgreSQL functions and migration SQL as string constants

4. **Generates Extension Methods** - Creates `EnsureWhizbangDatabaseInitializedAsync()` that uses only `ExecuteSqlRawAsync()` (AOT-safe)

### Schema Initialization

Initialize your database schema with a single call:

```csharp
public class Program {
    public static async Task Main(string[] args) {
        var builder = WebApplication.CreateBuilder(args);

        // Register DbContext
        builder.Services.AddDbContext<OrderDbContext>(options => {
            options.UseNpgsql(connectionString);
        });

        var app = builder.Build();

        // Initialize Whizbang database schema (AOT-compatible!)
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<OrderDbContext>();
        await dbContext.EnsureWhizbangDatabaseInitializedAsync();

        await app.RunAsync();
    }
}
```

**What `EnsureWhizbangDatabaseInitializedAsync()` does**:
1. Creates core infrastructure tables (9 tables)
2. Creates perspective tables (one per `PerspectiveRow<TModel>` in your DbContext)
3. Applies PostgreSQL functions and migrations
4. All operations are **idempotent** (safe to call multiple times)

### Generated Code Example

When you build your project, the source generator creates this extension method:

```csharp
// Auto-generated: OrderDbContext_SchemaExtensions.g.cs
public static partial class OrderDbContextSchemaExtensions {
    public static async Task EnsureWhizbangDatabaseInitializedAsync(
        this OrderDbContext dbContext,
        ILogger? logger = null,
        CancellationToken cancellationToken = default) {

        // Step 1: Execute core infrastructure schema (embedded resource)
        await ExecuteCoreInfrastructureSchemaAsync(dbContext, logger, cancellationToken);

        // Step 2: Execute perspective tables (generated at build time)
        await ExecutePerspectiveTablesAsync(dbContext, logger, cancellationToken);

        // Step 3: Execute PostgreSQL functions (embedded migrations)
        await ExecuteMigrationsAsync(dbContext, logger, cancellationToken);
    }

    private static async Task ExecuteCoreInfrastructureSchemaAsync(...) {
        // Pre-generated SQL from PostgresSchemaBuilder (5,327 bytes)
        const string CoreInfrastructureSchema = @"
            CREATE TABLE IF NOT EXISTS wh_service_instances (...);
            CREATE TABLE IF NOT EXISTS wh_message_deduplication (...);
            -- ... all 9 tables
        ";

        await dbContext.Database.ExecuteSqlRawAsync(
            CoreInfrastructureSchema,
            cancellationToken
        );
    }

    private static async Task ExecutePerspectiveTablesAsync(...) {
        // Generated from discovered PerspectiveRow<TModel> types
        const string PerspectiveTablesSchema = @"
            CREATE TABLE IF NOT EXISTS wh_per_order (
                stream_id UUID NOT NULL PRIMARY KEY,
                data JSONB NOT NULL,
                version BIGINT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            -- ... one per perspective
        ";

        await dbContext.Database.ExecuteSqlRawAsync(
            PerspectiveTablesSchema,
            cancellationToken
        );
    }
}
```

### Publishing with AOT

Enable Native AOT in your `.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <PublishAot>true</PublishAot>
  </PropertyGroup>
</Project>
```

Build and publish:

```bash
dotnet publish -c Release -r linux-x64
```

**Result**: Self-contained executable with no reflection, fast startup, and minimal memory footprint.

### Benefits of AOT Schema Generation

| Benefit | Description |
|---------|-------------|
| **Zero Reflection** | No `GenerateCreateScript()` calls - all SQL pre-generated |
| **Fast Startup** | No runtime schema inspection or compilation |
| **Predictable** | Schema SQL version-controlled and visible in generated code |
| **Debuggable** | View exact SQL being executed in `*.g.cs` files |
| **Portable** | No .NET SDK required in production |

---

## EF Core vs Dapper: When to Use What

### Use EF Core When:

- ✅ **Write operations** (commands, domain logic)
- ✅ **Complex domain models** with rich relationships
- ✅ **Change tracking** needed (detecting modifications)
- ✅ **Navigation properties** simplify code
- ✅ **Migrations** for schema evolution
- ✅ **Type-safe queries** via LINQ

### Use Dapper When:

- ✅ **Read operations** (perspectives, lenses)
- ✅ **High performance** required (~20x faster than EF Core)
- ✅ **Simple queries** without complex relationships
- ✅ **SQL control** needed (optimization, PostgreSQL-specific features)
- ✅ **Denormalized read models** (no navigation properties)

### Hybrid Approach (Recommended)

```csharp
// ✅ EF Core for write model (domain aggregates)
public class OrderService {
    private readonly ECommerceDbContext _context;

    public async Task<Order> CreateOrderAsync(CreateOrderCommand cmd) {
        var order = new Order(cmd.CustomerId, cmd.Items);
        _context.Orders.Add(order);
        await _context.SaveChangesAsync();
        return order;
    }
}

// ✅ Dapper for read model (perspectives/lenses)
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public async Task<OrderSummary[]> GetRecentOrdersAsync(int limit) {
        await using var conn = _db.CreateConnection();

        var orders = await conn.QueryAsync<OrderSummary>(
            "SELECT * FROM order_summaries ORDER BY created_at DESC LIMIT @Limit",
            new { Limit = limit }
        );

        return orders.ToArray();
    }
}
```

---

## Best Practices

### DO ✅

- ✅ Use **DbContext per request** (scoped lifetime)
- ✅ Use **AsNoTracking()** for read-only queries
- ✅ Use **AsSplitQuery()** for multiple includes
- ✅ Use **migrations** for schema changes
- ✅ Use **IEntityTypeConfiguration** for entity config
- ✅ Use **UUIDv7** for primary keys
- ✅ Use **JSONB** for complex nested data
- ✅ Use **complex types** for value objects
- ✅ Use **compiled queries** for hot paths
- ✅ Use **batch operations** (AddRange, RemoveRange)

### DON'T ❌

- ❌ Reuse DbContext across requests (not thread-safe)
- ❌ Use change tracking for read-only queries
- ❌ Use EF Core for high-performance read models (use Dapper)
- ❌ Manually write SQL migrations (use `dotnet ef migrations add`)
- ❌ Use `Guid.NewGuid()` for primary keys (use UUIDv7)
- ❌ Call SaveChanges() in loops (batch instead)
- ❌ Use Include() for every query (consider projections)
- ❌ Ignore N+1 query problems (use Include or SplitQuery)

---

## Common Patterns

### Pattern 1: Command Handler with EF Core

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly ECommerceDbContext _context;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        var order = new Order {
            CustomerId = message.CustomerId,
            Status = "Created",
            Total = message.Items.Sum(i => i.UnitPrice * i.Quantity),
            CreatedAt = DateTimeOffset.UtcNow
        };

        foreach (var item in message.Items) {
            order.Items.Add(new OrderItem {
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                UnitPrice = item.UnitPrice
            });
        }

        _context.Orders.Add(order);
        await _context.SaveChangesAsync(ct);

        return new OrderCreated(
            OrderId: order.Id,
            CustomerId: order.CustomerId,
            Total: order.Total,
            CreatedAt: order.CreatedAt
        );
    }
}
```

### Pattern 2: Query with Projection

```csharp
public async Task<OrderListItem[]> GetOrderListAsync(
    Guid customerId,
    CancellationToken ct = default) {

    return await _context.Orders
        .Where(o => o.CustomerId == customerId)
        .OrderByDescending(o => o.CreatedAt)
        .Select(o => new OrderListItem {
            OrderId = o.Id,
            Total = o.Total,
            Status = o.Status,
            CreatedAt = o.CreatedAt,
            ItemCount = o.Items.Count
        })
        .ToArrayAsync(ct);
}
```

**Benefit**: Projection avoids loading full entities (faster, less memory).

### Pattern 3: Optimistic Concurrency

```csharp
public class Order {
    public Guid Id { get; set; }
    public string Status { get; set; } = default!;

    [Timestamp]
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();  // Concurrency token
}

public async Task UpdateOrderStatusAsync(Guid orderId, string newStatus) {
    var order = await _context.Orders.FirstAsync(o => o.Id == orderId);

    order.Status = newStatus;

    try {
        await _context.SaveChangesAsync();
    } catch (DbUpdateConcurrencyException) {
        // Row was modified by another process
        throw new ConcurrencyException("Order was modified by another user");
    }
}
```

---

## Further Reading

**Core Concepts**:
- [Perspectives](../core-concepts/perspectives.md) - Event-driven read models
- [Lenses](../core-concepts/lenses.md) - Query repositories
- [Receptors](../core-concepts/receptors.md) - Message handlers

**Data Access**:
- [Dapper Integration](dapper-integration.md) - Lightweight data access
- [Perspectives Storage](perspectives-storage.md) - Read model schema design
- [Event Store](event-store.md) - Event storage and replay

**Examples**:
- [ECommerce: Order Service](../examples/ecommerce/order-service.md) - EF Core in practice

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
