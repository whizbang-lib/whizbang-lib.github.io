---
title: Lakehouse Streaming
category: Roadmap
status: planned
target_version: 1.2.0
order: 3
unreleased: true
tags: analytics, data-lake, lakehouse, streaming, parquet
---

# Lakehouse Streaming

⚠️ **FUTURE FEATURE - NOT YET RELEASED**

This documentation describes lakehouse streaming support planned for v1.2.0.
This feature is not available in the current release.

**Status**: Planned
**Target Version**: 1.2.0

---

## Overview

Whizbang will provide **first-class integration with data lakehouses** (Delta Lake, Apache Iceberg, Apache Hudi), enabling real-time streaming of events for analytics, ML, and business intelligence.

## Why Lakehouse Streaming?

### Event Store as Operational Database

The event store is optimized for **transactional workloads** (fast writes, point queries):

- Write new events
- Load aggregate streams
- Support projections

### Lakehouse as Analytical Database

Lakehouses are optimized for **analytical workloads** (complex queries, aggregations):

- Ad-hoc SQL queries across all events
- Time-series analytics
- Machine learning feature extraction
- Business intelligence dashboards

**Stream events from Whizbang → Lakehouse for the best of both worlds.**

## Supported Lakehouses

- **Delta Lake** (Databricks, Azure Synapse, AWS EMR)
- **Apache Iceberg** (Snowflake, AWS Athena, Google BigQuery)
- **Apache Hudi** (AWS EMR, Google Dataproc)
- **Parquet files** (S3, Azure Data Lake, Google Cloud Storage)

## Configuration

### Delta Lake Streaming

```csharp{
title: "Delta Lake Streaming Configuration"
description: "Stream events to Delta Lake"
framework: "NET8"
category: "Analytics"
difficulty: "INTERMEDIATE"
tags: ["Delta Lake", "Streaming", "Analytics"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.UsePostgres(connectionString);

        // Stream events to Delta Lake
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => {
                delta.StoragePath = "s3://my-data-lake/whizbang/events";
                delta.PartitionBy = "event_date";  // Partition by date for performance
                delta.MergeSchema = true;          // Handle schema evolution
            });

            // Stream continuously
            lake.StreamingMode = StreamingMode.Continuous;

            // Batch events for efficiency
            lake.BatchSize = 1000;
            lake.FlushInterval = TimeSpan.FromSeconds(30);
        });
    });
});
```

**What happens**:

1. Events written to Postgres event store
2. Background worker batches events
3. Events written to Delta Lake as Parquet files
4. Partitioned by date for efficient queries
5. Schema automatically detected and evolved

### Apache Iceberg Streaming

```csharp{
title: "Apache Iceberg Streaming Configuration"
description: "Stream events to Apache Iceberg"
framework: "NET8"
category: "Analytics"
difficulty: "INTERMEDIATE"
tags: ["Iceberg", "Streaming", "Analytics"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseIceberg(iceberg => {
                iceberg.Catalog = "glue";  // AWS Glue catalog
                iceberg.Database = "whizbang";
                iceberg.TableName = "events";
                iceberg.WarehousePath = "s3://my-warehouse/whizbang";
            });
        });
    });
});
```

### Event Filtering

Stream only specific events to lakehouse:

```csharp{
title: "Event Filtering for Lakehouse"
description: "Stream only specific events"
framework: "NET8"
category: "Analytics"
difficulty: "INTERMEDIATE"
tags: ["Filtering", "Streaming", "Analytics"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => { /* ... */ });

            // Stream only certain event types
            lake.IncludeEvents(
                typeof(OrderPlaced),
                typeof(OrderShipped),
                typeof(PaymentProcessed)
            );

            // Exclude sensitive events
            lake.ExcludeEvents(typeof(PaymentMethodUpdated));

            // Custom filter
            lake.Filter = @event => {
                // Don't stream test tenant data
                return !@event.Metadata.TenantId.StartsWith("test-");
            };
        });
    });
});
```

## Event Schema Mapping

Map events to lakehouse schema:

```csharp{
title: "Event Schema Mapping"
description: "Map events to lakehouse table schema"
framework: "NET8"
category: "Analytics"
difficulty: "ADVANCED"
tags: ["Schema", "Mapping", "Analytics"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["System", "Whizbang.Lakehouse"]
showLineNumbers: true
}
using System;
using Whizbang.Lakehouse;

public class OrderPlacedEventMapper : IEventMapper<OrderPlaced> {
    public LakehouseRow Map(OrderPlaced @event) {
        return new LakehouseRow {
            // Standard fields
            ["event_id"] = @event.EventId,
            ["event_type"] = "OrderPlaced",
            ["event_timestamp"] = @event.Timestamp,
            ["aggregate_id"] = @event.OrderId,
            ["tenant_id"] = @event.TenantId,

            // Event-specific fields
            ["customer_id"] = @event.CustomerId,
            ["order_total"] = @event.Total,
            ["order_status"] = "Placed",
            ["item_count"] = @event.Items.Count,

            // Denormalized for analytics
            ["year"] = @event.PlacedAt.Year,
            ["month"] = @event.PlacedAt.Month,
            ["day"] = @event.PlacedAt.Day,
            ["hour"] = @event.PlacedAt.Hour
        };
    }
}
```

## Querying Lakehouse Data

### SQL Queries (Delta Lake)

Once events are in the lakehouse, query with SQL:

```sql
-- Total orders by day
SELECT
    event_date,
    COUNT(*) as order_count,
    SUM(order_total) as total_revenue
FROM whizbang.events
WHERE event_type = 'OrderPlaced'
GROUP BY event_date
ORDER BY event_date DESC;

-- Customer lifetime value
SELECT
    customer_id,
    COUNT(DISTINCT aggregate_id) as total_orders,
    SUM(order_total) as lifetime_value
FROM whizbang.events
WHERE event_type = 'OrderPlaced'
GROUP BY customer_id
ORDER BY lifetime_value DESC
LIMIT 100;

-- Hourly order trends
SELECT
    DATE_TRUNC('hour', event_timestamp) as hour,
    COUNT(*) as order_count
FROM whizbang.events
WHERE event_type = 'OrderPlaced'
  AND event_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY hour
ORDER BY hour;
```

### DataFrames (Spark/Databricks)

```python
# Load events from Delta Lake
events = spark.read.format("delta").load("s3://my-data-lake/whizbang/events")

# Filter to order events
orders = events.filter(events.event_type == "OrderPlaced")

# Aggregate by customer
customer_stats = orders.groupBy("customer_id").agg(
    count("*").alias("order_count"),
    sum("order_total").alias("total_spend"),
    avg("order_total").alias("avg_order_value")
)

# Write to feature store for ML
customer_stats.write.format("delta").mode("overwrite").save("s3://features/customers")
```

## Time Travel Queries

Lakehouse time travel enables querying historical data:

```sql
-- Query events as of yesterday
SELECT * FROM whizbang.events TIMESTAMP AS OF '2025-10-17 00:00:00';

-- Query events from specific version
SELECT * FROM whizbang.events VERSION AS OF 123;

-- See all changes between versions
SELECT * FROM whizbang.events VERSION AS OF 100
EXCEPT
SELECT * FROM whizbang.events VERSION AS OF 150;
```

## Schema Evolution

Lakehouses handle schema changes gracefully:

```csharp{
title: "Schema Evolution"
description: "Handle evolving event schemas in lakehouse"
framework: "NET8"
category: "Analytics"
difficulty: "ADVANCED"
tags: ["Schema", "Evolution", "Analytics"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => {
                // Automatically add new columns when event schema changes
                delta.MergeSchema = true;

                // Or use strict mode (fail on schema mismatch)
                delta.MergeSchema = false;
                delta.OnSchemaMismatch = SchemaMismatchPolicy.Fail;
            });
        });
    });
});
```

**Example**:

```csharp
// V1 event
public record OrderPlaced(Guid OrderId, Guid CustomerId, decimal Total);

// V2 event (added field)
public record OrderPlaced(Guid OrderId, Guid CustomerId, decimal Total, string Currency);
```

With `MergeSchema = true`:
- Old events have `Currency = null`
- New events have all fields
- No data migration needed

## Performance Optimization

### Partitioning Strategy

```csharp{
title: "Lakehouse Partitioning"
description: "Optimize queries with partitioning"
framework: "NET8"
category: "Performance"
difficulty: "ADVANCED"
tags: ["Partitioning", "Performance", "Analytics"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => {
                // Partition by date and tenant for fast queries
                delta.PartitionBy = new[] { "event_date", "tenant_id" };

                // Z-order for co-located data
                delta.ZOrderBy = new[] { "customer_id", "event_type" };

                // Optimize file sizes
                delta.TargetFileSize = 128 * 1024 * 1024;  // 128 MB
            });
        });
    });
});
```

**Query optimization**:

```sql
-- Fast (partition pruning)
SELECT * FROM events
WHERE event_date = '2025-10-18'
  AND tenant_id = 'acme-corp';

-- Slow (full table scan)
SELECT * FROM events
WHERE customer_id = '12345';
```

### Compaction

Periodically compact small files:

```csharp{
title: "Lakehouse Compaction"
description: "Compact small files for better performance"
framework: "NET8"
category: "Performance"
difficulty: "ADVANCED"
tags: ["Compaction", "Performance", "Analytics"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => {
                // Auto-compact small files
                delta.AutoCompact = true;
                delta.CompactInterval = TimeSpan.FromHours(6);
                delta.TargetFileSize = 128 * 1024 * 1024;  // 128 MB
            });
        });
    });
});
```

## Integration with BI Tools

### Databricks

Events in Delta Lake are queryable from Databricks notebooks:

```python
# Connect to lakehouse
events = spark.read.format("delta").load("s3://my-data-lake/whizbang/events")

# Create temp view for SQL
events.createOrReplaceTempView("events")

# Query with Spark SQL
results = spark.sql("""
    SELECT event_date, COUNT(*) as event_count
    FROM events
    GROUP BY event_date
    ORDER BY event_date DESC
""")

# Visualize in notebook
display(results)
```

### Power BI / Tableau

Connect via ODBC/JDBC:

```plaintext
Connection: Delta Lake (S3)
Path: s3://my-data-lake/whizbang/events
Table: events
```

### dbt (Data Build Tool)

Create analytics models from events:

```sql
-- models/orders_daily.sql
{{ config(materialized='table') }}

SELECT
    DATE(event_timestamp) as date,
    COUNT(DISTINCT aggregate_id) as order_count,
    SUM(order_total) as revenue,
    AVG(order_total) as avg_order_value
FROM {{ source('whizbang', 'events') }}
WHERE event_type = 'OrderPlaced'
GROUP BY date
```

## Streaming Guarantees

### At-Least-Once Delivery

Events are guaranteed to be delivered to the lakehouse **at least once**:

- Idempotent writes (duplicate events filtered by `event_id`)
- Checkpointing for crash recovery
- Transactional writes to lakehouse

### Exactly-Once Semantics

For critical analytics, enable exactly-once:

```csharp{
title: "Exactly-Once Lakehouse Streaming"
description: "Ensure no duplicate events in lakehouse"
framework: "NET8"
category: "Reliability"
difficulty: "ADVANCED"
tags: ["Exactly-Once", "Reliability", "Streaming"]
nugetPackages: ["Whizbang.Lakehouse"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.StreamToLakehouse(lake => {
            lake.UseDeltaLake(delta => { /* ... */ });

            // Exactly-once semantics
            lake.DeliveryGuarantee = DeliveryGuarantee.ExactlyOnce;

            // Deduplication by event ID
            lake.DeduplicateBy = "event_id";
        });
    });
});
```

## Next Steps

- [**Backups and Snapshots**](./backups-and-snapshots.md) - Backup strategies
- [**Observability**](../observability.md) - Monitor streaming health
- [**Analytics**](../analytics.md) - Query patterns and examples

## Feedback Welcome

What analytics use cases do you have for event data?

[Share your thoughts](https://github.com/whizbang-lib/whizbang/discussions)
