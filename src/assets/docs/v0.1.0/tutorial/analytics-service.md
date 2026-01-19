---
title: "Analytics Service"
version: 0.1.0
category: Tutorial
order: 8
description: "Build the Analytics Worker - real-time analytics, time-series perspectives, and reporting dashboards"
tags: tutorial, analytics-service, perspectives, time-series, reporting, dashboards
---

# Analytics Service

Build the **Analytics Worker** - a background service that subscribes to all domain events, aggregates metrics in real-time, and provides analytics dashboards.

:::note
This is **Part 7** of the ECommerce Tutorial. Complete [Customer Service](customer-service.md) first.
:::

---

## What You'll Build

```
┌──────────────────────────────────────────────────────────────┐
│  Analytics Service Architecture                              │
│                                                               │
│  ┌─────────────┐                                             │
│  │Azure Service│  ALL domain events                          │
│  │     Bus     │  (OrderCreated, PaymentProcessed, etc.)     │
│  └──────┬──────┘                                             │
│         │                                                     │
│         ▼                                                     │
│  ┌────────────────────────────────────┐                      │
│  │  Time-Series Perspectives          │                      │
│  │  - DailySalesAnalyticsPerspective  │                      │
│  │  - HourlySalesAnalyticsPerspective │                      │
│  │  - ProductAnalyticsPerspective     │                      │
│  └──────────┬─────────────────────────┘                      │
│             │                                                 │
│             ▼                                                 │
│  ┌────────────────────────────────────┐                      │
│  │  PostgreSQL Time-Series Tables     │                      │
│  │  (Partitioned by date)             │                      │
│  └──────────┬─────────────────────────┘                      │
│             │                                                 │
│             ▼                                                 │
│  ┌────────────────────────────────────┐                      │
│  │  Analytics API (REST)              │                      │
│  │  GET /analytics/sales/daily        │                      │
│  │  GET /analytics/products/top       │                      │
│  └────────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ Real-time event aggregation
- ✅ Time-series perspectives (hourly, daily, monthly)
- ✅ Product performance analytics
- ✅ Customer cohort analysis
- ✅ Partitioned tables for performance
- ✅ Dashboard APIs

---

## Step 1: Database Schema (Time-Series Tables)

### Daily Sales Analytics

**ECommerce.AnalyticsWorker/Database/Migrations/001_CreateDailySalesAnalyticsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS daily_sales_analytics (
  date DATE NOT NULL,
  total_orders BIGINT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_items_sold BIGINT NOT NULL DEFAULT 0,
  avg_order_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unique_customers BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date)
) PARTITION BY RANGE (date);

-- Create partitions for current and next year
CREATE TABLE daily_sales_analytics_2024 PARTITION OF daily_sales_analytics
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE daily_sales_analytics_2025 PARTITION OF daily_sales_analytics
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE INDEX idx_daily_sales_date ON daily_sales_analytics(date DESC);
```

### Hourly Sales Analytics

**ECommerce.AnalyticsWorker/Database/Migrations/002_CreateHourlySalesAnalyticsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS hourly_sales_analytics (
  hour TIMESTAMP NOT NULL,  -- Truncated to hour (e.g., 2024-12-12 10:00:00)
  total_orders BIGINT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hour)
);

CREATE INDEX idx_hourly_sales_hour ON hourly_sales_analytics(hour DESC);
```

### Product Analytics

**ECommerce.AnalyticsWorker/Database/Migrations/003_CreateProductAnalyticsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS product_analytics (
  product_id TEXT NOT NULL,
  date DATE NOT NULL,
  times_ordered BIGINT NOT NULL DEFAULT 0,
  units_sold BIGINT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, date)
) PARTITION BY RANGE (date);

-- Create partitions
CREATE TABLE product_analytics_2024 PARTITION OF product_analytics
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE product_analytics_2025 PARTITION OF product_analytics
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE INDEX idx_product_analytics_product_date ON product_analytics(product_id, date DESC);
CREATE INDEX idx_product_analytics_revenue ON product_analytics(total_revenue DESC);
```

---

## Step 2: Perspectives

### Daily Sales Analytics Perspective

**ECommerce.AnalyticsWorker/Perspectives/DailySalesAnalyticsPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.AnalyticsWorker.Perspectives;

public class DailySalesAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<DailySalesAnalyticsPerspective> _logger;

  public DailySalesAnalyticsPerspective(
    NpgsqlConnection db,
    ILogger<DailySalesAnalyticsPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    var date = @event.CreatedAt.Date;

    await _db.ExecuteAsync(
      """
      INSERT INTO daily_sales_analytics (
        date, total_orders, total_revenue, total_items_sold, avg_order_value, unique_customers, updated_at
      )
      VALUES (@Date, 1, @TotalAmount, @ItemCount, @TotalAmount, 1, NOW())
      ON CONFLICT (date) DO UPDATE SET
        total_orders = daily_sales_analytics.total_orders + 1,
        total_revenue = daily_sales_analytics.total_revenue + @TotalAmount,
        total_items_sold = daily_sales_analytics.total_items_sold + @ItemCount,
        avg_order_value = (daily_sales_analytics.total_revenue + @TotalAmount) / (daily_sales_analytics.total_orders + 1),
        updated_at = NOW()
      """,
      new {
        Date = date,
        TotalAmount = @event.TotalAmount,
        ItemCount = @event.Items.Sum(i => i.Quantity)
      }
    );

    _logger.LogInformation(
      "Daily sales analytics updated for {Date}: +${Amount}",
      date,
      @event.TotalAmount
    );
  }
}
```

### Hourly Sales Analytics Perspective

**ECommerce.AnalyticsWorker/Perspectives/HourlySalesAnalyticsPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.AnalyticsWorker.Perspectives;

public class HourlySalesAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<HourlySalesAnalyticsPerspective> _logger;

  public HourlySalesAnalyticsPerspective(
    NpgsqlConnection db,
    ILogger<HourlySalesAnalyticsPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    // Truncate to hour (e.g., 2024-12-12 10:00:00)
    var hour = new DateTime(
      @event.CreatedAt.Year,
      @event.CreatedAt.Month,
      @event.CreatedAt.Day,
      @event.CreatedAt.Hour,
      0,
      0
    );

    await _db.ExecuteAsync(
      """
      INSERT INTO hourly_sales_analytics (hour, total_orders, total_revenue, updated_at)
      VALUES (@Hour, 1, @TotalAmount, NOW())
      ON CONFLICT (hour) DO UPDATE SET
        total_orders = hourly_sales_analytics.total_orders + 1,
        total_revenue = hourly_sales_analytics.total_revenue + @TotalAmount,
        updated_at = NOW()
      """,
      new {
        Hour = hour,
        TotalAmount = @event.TotalAmount
      }
    );

    _logger.LogInformation(
      "Hourly sales analytics updated for {Hour}: +${Amount}",
      hour,
      @event.TotalAmount
    );
  }
}
```

### Product Analytics Perspective

**ECommerce.AnalyticsWorker/Perspectives/ProductAnalyticsPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.AnalyticsWorker.Perspectives;

public class ProductAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<ProductAnalyticsPerspective> _logger;

  public ProductAnalyticsPerspective(
    NpgsqlConnection db,
    ILogger<ProductAnalyticsPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    var date = @event.CreatedAt.Date;

    // Update analytics for each product in the order
    foreach (var item in @event.Items) {
      await _db.ExecuteAsync(
        """
        INSERT INTO product_analytics (
          product_id, date, times_ordered, units_sold, total_revenue, updated_at
        )
        VALUES (@ProductId, @Date, 1, @Quantity, @LineTotal, NOW())
        ON CONFLICT (product_id, date) DO UPDATE SET
          times_ordered = product_analytics.times_ordered + 1,
          units_sold = product_analytics.units_sold + @Quantity,
          total_revenue = product_analytics.total_revenue + @LineTotal,
          updated_at = NOW()
        """,
        new {
          ProductId = item.ProductId,
          Date = date,
          Quantity = item.Quantity,
          LineTotal = item.LineTotal
        }
      );

      _logger.LogInformation(
        "Product analytics updated for {ProductId} on {Date}: +{Quantity} units, +${LineTotal}",
        item.ProductId,
        date,
        item.Quantity,
        item.LineTotal
      );
    }
  }
}
```

---

## Step 3: Analytics API

### DTOs

**ECommerce.AnalyticsWorker/Models/DailySalesDto.cs**:

```csharp
namespace ECommerce.AnalyticsWorker.Models;

public record DailySalesDto(
  DateTime Date,
  long TotalOrders,
  decimal TotalRevenue,
  long TotalItemsSold,
  decimal AvgOrderValue,
  long UniqueCustomers
);
```

**ECommerce.AnalyticsWorker/Models/ProductPerformanceDto.cs**:

```csharp
namespace ECommerce.AnalyticsWorker.Models;

public record ProductPerformanceDto(
  string ProductId,
  long TimesOrdered,
  long UnitsSold,
  decimal TotalRevenue,
  decimal AvgRevenuePerOrder
);
```

### Controllers

**ECommerce.AnalyticsWorker/Controllers/AnalyticsController.cs**:

```csharp
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Dapper;
using ECommerce.AnalyticsWorker.Models;

namespace ECommerce.AnalyticsWorker.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AnalyticsController : ControllerBase {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<AnalyticsController> _logger;

  public AnalyticsController(
    NpgsqlConnection db,
    ILogger<AnalyticsController> logger
  ) {
    _db = db;
    _logger = logger;
  }

  [HttpGet("sales/daily")]
  [ProducesResponseType(typeof(DailySalesDto[]), StatusCodes.Status200OK)]
  public async Task<IActionResult> GetDailySales(
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null
  ) {
    var start = startDate ?? DateTime.UtcNow.AddDays(-30).Date;
    var end = endDate ?? DateTime.UtcNow.Date;

    var sales = await _db.QueryAsync<DailySalesRow>(
      """
      SELECT date, total_orders, total_revenue, total_items_sold, avg_order_value, unique_customers
      FROM daily_sales_analytics
      WHERE date >= @StartDate AND date <= @EndDate
      ORDER BY date DESC
      """,
      new { StartDate = start, EndDate = end }
    );

    var dtos = sales.Select(s => new DailySalesDto(
      Date: s.Date,
      TotalOrders: s.TotalOrders,
      TotalRevenue: s.TotalRevenue,
      TotalItemsSold: s.TotalItemsSold,
      AvgOrderValue: s.AvgOrderValue,
      UniqueCustomers: s.UniqueCustomers
    )).ToArray();

    return Ok(dtos);
  }

  [HttpGet("sales/hourly")]
  [ProducesResponseType(typeof(HourlySalesDto[]), StatusCodes.Status200OK)]
  public async Task<IActionResult> GetHourlySales(
    [FromQuery] DateTime? date = null
  ) {
    var targetDate = date ?? DateTime.UtcNow.Date;
    var startHour = targetDate;
    var endHour = targetDate.AddDays(1);

    var sales = await _db.QueryAsync<HourlySalesRow>(
      """
      SELECT hour, total_orders, total_revenue
      FROM hourly_sales_analytics
      WHERE hour >= @StartHour AND hour < @EndHour
      ORDER BY hour ASC
      """,
      new { StartHour = startHour, EndHour = endHour }
    );

    var dtos = sales.Select(s => new HourlySalesDto(
      Hour: s.Hour,
      TotalOrders: s.TotalOrders,
      TotalRevenue: s.TotalRevenue
    )).ToArray();

    return Ok(dtos);
  }

  [HttpGet("products/top")]
  [ProducesResponseType(typeof(ProductPerformanceDto[]), StatusCodes.Status200OK)]
  public async Task<IActionResult> GetTopProducts(
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null,
    [FromQuery] int limit = 10
  ) {
    var start = startDate ?? DateTime.UtcNow.AddDays(-30).Date;
    var end = endDate ?? DateTime.UtcNow.Date;

    var products = await _db.QueryAsync<ProductAnalyticsRow>(
      """
      SELECT
        product_id,
        SUM(times_ordered) AS times_ordered,
        SUM(units_sold) AS units_sold,
        SUM(total_revenue) AS total_revenue
      FROM product_analytics
      WHERE date >= @StartDate AND date <= @EndDate
      GROUP BY product_id
      ORDER BY total_revenue DESC
      LIMIT @Limit
      """,
      new { StartDate = start, EndDate = end, Limit = limit }
    );

    var dtos = products.Select(p => new ProductPerformanceDto(
      ProductId: p.ProductId,
      TimesOrdered: p.TimesOrdered,
      UnitsSold: p.UnitsSold,
      TotalRevenue: p.TotalRevenue,
      AvgRevenuePerOrder: p.TimesOrdered > 0 ? p.TotalRevenue / p.TimesOrdered : 0
    )).ToArray();

    return Ok(dtos);
  }
}

public record DailySalesRow(
  DateTime Date,
  long TotalOrders,
  decimal TotalRevenue,
  long TotalItemsSold,
  decimal AvgOrderValue,
  long UniqueCustomers
);

public record HourlySalesDto(
  DateTime Hour,
  long TotalOrders,
  decimal TotalRevenue
);

public record HourlySalesRow(
  DateTime Hour,
  long TotalOrders,
  decimal TotalRevenue
);

public record ProductAnalyticsRow(
  string ProductId,
  long TimesOrdered,
  long UnitsSold,
  decimal TotalRevenue
);
```

---

## Step 4: Service Configuration

**ECommerce.AnalyticsWorker/Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "AnalyticsWorker";
  options.EnableInbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("AnalyticsDb");
  return new NpgsqlConnection(connectionString);
});

// 3. Add Azure Service Bus
builder.AddAzureServiceBus("messaging");

// 4. Add controllers
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment()) {
  app.UseSwagger();
  app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

await app.MigrateDatabaseAsync();
app.Run();
```

---

## Step 5: Test Analytics

### 1. Create Orders (Generate Data)

```bash
# Create 10 orders
for i in {1..10}; do
  curl -X POST http://localhost:5000/api/orders \
    -H "Content-Type: application/json" \
    -d '{ "customerId": "cust-'$i'", ... }'
  sleep 1
done
```

### 2. Query Daily Sales

```bash
curl "http://localhost:5002/api/analytics/sales/daily?startDate=2024-12-01&endDate=2024-12-31"
```

**Response**:

```json
[
  {
    "date": "2024-12-12",
    "totalOrders": 10,
    "totalRevenue": 399.80,
    "totalItemsSold": 20,
    "avgOrderValue": 39.98,
    "uniqueCustomers": 10
  }
]
```

### 3. Query Hourly Sales

```bash
curl "http://localhost:5002/api/analytics/sales/hourly?date=2024-12-12"
```

**Response**:

```json
[
  { "hour": "2024-12-12T10:00:00Z", "totalOrders": 3, "totalRevenue": 119.94 },
  { "hour": "2024-12-12T11:00:00Z", "totalOrders": 5, "totalRevenue": 199.90 },
  { "hour": "2024-12-12T12:00:00Z", "totalOrders": 2, "totalRevenue": 79.96 }
]
```

### 4. Query Top Products

```bash
curl "http://localhost:5002/api/analytics/products/top?limit=5"
```

**Response**:

```json
[
  {
    "productId": "prod-456",
    "timesOrdered": 8,
    "unitsSold": 16,
    "totalRevenue": 319.84,
    "avgRevenuePerOrder": 39.98
  },
  {
    "productId": "prod-789",
    "timesOrdered": 2,
    "unitsSold": 2,
    "totalRevenue": 99.98,
    "avgRevenuePerOrder": 49.99
  }
]
```

---

## Key Concepts

### Time-Series Perspectives

```csharp
// Truncate timestamp to hour for hourly aggregation
var hour = new DateTime(
  @event.CreatedAt.Year,
  @event.CreatedAt.Month,
  @event.CreatedAt.Day,
  @event.CreatedAt.Hour,
  0,
  0
);

// Upsert with aggregation
INSERT INTO hourly_sales_analytics (hour, total_orders, total_revenue)
VALUES (@Hour, 1, @TotalAmount)
ON CONFLICT (hour) DO UPDATE SET
  total_orders = hourly_sales_analytics.total_orders + 1,
  total_revenue = hourly_sales_analytics.total_revenue + @TotalAmount
```

**Result**: Real-time hourly metrics without batch processing.

### Partitioned Tables

```sql
CREATE TABLE daily_sales_analytics (...)
PARTITION BY RANGE (date);

-- Separate physical tables per year
CREATE TABLE daily_sales_analytics_2024 PARTITION OF daily_sales_analytics
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

**Benefits**:
- ✅ **Performance**: Queries only scan relevant partitions
- ✅ **Maintenance**: Drop old partitions easily (e.g., GDPR retention)
- ✅ **Scalability**: Add future partitions dynamically

---

## Advanced: Materialized Views

For complex aggregations, use materialized views:

**ECommerce.AnalyticsWorker/Database/Migrations/004_CreateMaterializedViews.sql**:

```sql
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT
  DATE_TRUNC('month', date) AS month,
  SUM(total_orders) AS total_orders,
  SUM(total_revenue) AS total_revenue,
  AVG(avg_order_value) AS avg_order_value
FROM daily_sales_analytics
GROUP BY DATE_TRUNC('month', date)
ORDER BY month DESC;

CREATE UNIQUE INDEX idx_monthly_sales_month ON monthly_sales_summary(month);

-- Refresh monthly (can be automated via background job)
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales_summary;
```

---

## Testing

### Unit Test - Daily Sales Perspective

```csharp
[Test]
public async Task DailySalesPerspective_OrderCreated_UpdatesDailySalesAsync() {
  // Arrange
  var db = new MockNpgsqlConnection();
  var perspective = new DailySalesAnalyticsPerspective(db, mockLogger);
  var @event = new OrderCreated(
    OrderId: "order-123",
    CustomerId: "cust-456",
    Items: [new OrderItem("prod-789", 2, 19.99m, 39.98m)],
    TotalAmount: 39.98m,
    CreatedAt: new DateTime(2024, 12, 12, 10, 30, 0)
    // ... other fields
  );

  // Act
  await perspective.HandleAsync(@event);

  // Assert
  var sales = db.GetDailySales(new DateTime(2024, 12, 12));
  await Assert.That(sales.TotalOrders).IsEqualTo(1);
  await Assert.That(sales.TotalRevenue).IsEqualTo(39.98m);
}
```

---

## Next Steps

Continue to **[Testing Strategy](testing-strategy.md)** to:
- Write unit tests for receptors and perspectives
- Implement integration tests for event flows
- Create end-to-end tests for full order lifecycle
- Set up test fixtures and mocks

---

## Key Takeaways

✅ **Time-Series Perspectives** - Real-time aggregation with hour/day truncation
✅ **Partitioned Tables** - Performance optimization for large datasets
✅ **Event Aggregation** - Single perspective handles all analytics
✅ **Dashboard APIs** - REST endpoints for frontend dashboards
✅ **Materialized Views** - Pre-computed complex aggregations

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
