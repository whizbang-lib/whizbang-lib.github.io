---
title: Whizbang Dashboard
category: Observability
order: 1
tags: dashboard, observability, tracing, visualization, monitoring
---

# Whizbang Dashboard

The **Whizbang Dashboard** is a separate web application (package: `Whizbang.Dashboard`) that provides real-time visualization of your event-sourced, message-driven system.

## Overview

The dashboard offers:

- **Message Journey Visualization** - See the complete lifecycle of commands and events
- **Distributed Tracing** - Track messages across microservices
- **Projection Health** - Monitor projection lag and errors
- **Event Stream Explorer** - Browse aggregate event streams
- **Performance Metrics** - Throughput, latency, error rates
- **Control Plane** - Send control commands to services

## Installation

### NuGet Package

```bash
dotnet add package Whizbang.Dashboard
```

### Standalone Dashboard Application

Or run as a separate service:

```bash
dotnet tool install --global Whizbang.Dashboard
whizbang-dashboard --port 5050
```

### Embedded in Application

Add to your ASP.NET Core application:

```csharp{
title: "Embed Dashboard in Application"
description: "Add dashboard to existing ASP.NET Core app"
framework: "NET8"
category: "Observability"
difficulty: "BEGINNER"
tags: ["Dashboard", "Setup"]
nugetPackages: ["Whizbang.Dashboard", "Microsoft.AspNetCore"]
filename: "Program.cs"
usingStatements: ["Microsoft.AspNetCore.Builder", "Whizbang.Dashboard"]
showLineNumbers: true
}
using Microsoft.AspNetCore.Builder;
using Whizbang.Dashboard;

var builder = WebApplication.CreateBuilder(args);

// Add Whizbang Dashboard
builder.Services.AddWhizbangDashboard(options => {
    options.EnableRealTimeUpdates = true;
    options.RetentionPeriod = TimeSpan.FromHours(24);  // Keep traces for 24 hours
    options.RequireAuthentication = true;              // Protect dashboard
});

var app = builder.Build();

// Mount dashboard at /whizbang
app.MapWhizbangDashboard("/whizbang");

app.Run();
```

Access at: `http://localhost:5000/whizbang`

## Message Journey Visualization

### End-to-End Flow

See the complete journey of a command through your system:

```
PlaceOrder (Command)
  ↓
OrderCommandHandler
  ↓
OrderPlaced (Event)
  ├─→ OrderHistoryProjection (updated)
  ├─→ InventoryReservationSaga (triggered)
  │   ↓
  │   ReserveInventory (Command) → InventoryService
  │   ↓
  │   InventoryReserved (Event)
  │   ↓
  │   ProcessPayment (Command) → PaymentService
  │   ↓
  │   PaymentProcessed (Event)
  └─→ CustomerNotificationHandler (email sent)
```

**Dashboard Visualization**:

```
┌────────────────────────────────────────────────────────────┐
│  Message Journey: PlaceOrder                               │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  [PlaceOrder] ──→ [OrderHandler] ──→ [OrderPlaced]         │
│      ↓ 42ms          ↓ 120ms           ↓                   │
│      │               │                 ├─→ [OrderHistory]  │
│      │               │                 │    ↓ 15ms         │
│      │               │                 │                   │
│      │               │                 ├─→ [ReserveSaga]   │
│      │               │                 │    ↓ 200ms        │
│      │               │                 │    └─→ [Inventory]│
│      │               │                 │         ↓ 350ms   │
│      │               │                 │         └─→ [Pay] │
│      │               │                 │              ↓    │
│      │               │                 └─→ [Notify] ✓      │
│                                                             │
│  Total Duration: 727ms                                      │
│  Status: ✓ Success                                          │
└────────────────────────────────────────────────────────────┘
```

### Interactive Trace Explorer

Click on any message to drill down:

```
┌────────────────────────────────────────────────────────────┐
│  OrderPlaced Event Details                                 │
├────────────────────────────────────────────────────────────┤
│  Event ID: evt_01J7G3KZ9P...                               │
│  Timestamp: 2025-10-18 14:32:15.234 UTC                    │
│  Correlation ID: cmd_01J7G3KZ8N...                         │
│  Causation ID: cmd_01J7G3KZ8N...                           │
│                                                             │
│  Payload:                                                   │
│  {                                                          │
│    "orderId": "ord_123",                                    │
│    "customerId": "cust_456",                                │
│    "total": 99.99,                                          │
│    "items": [ /* ... */ ]                                   │
│  }                                                          │
│                                                             │
│  Metadata:                                                  │
│  - Tenant: acme-corp                                        │
│  - User: john.doe@acme.com                                  │
│  - Source: orders-service-pod-3                             │
│  - Trace ID: 4bf92f3577b34da6a3ce929d0e0e4736              │
│                                                             │
│  Subscribers (3):                                           │
│  ✓ OrderHistoryProjection (15ms)                           │
│  ✓ InventoryReservationSaga (200ms)                        │
│  ✓ CustomerNotificationHandler (42ms)                      │
└────────────────────────────────────────────────────────────┘
```

## Distributed Tracing

### Cross-Service Traces

Visualize messages flowing across microservices:

```
API Gateway         Orders Service      Inventory Service    Payment Service
    │                     │                     │                   │
    ├─ PlaceOrder ──────→ │                     │                   │
    │                     ├─ OrderPlaced ──────→│                   │
    │                     │                     ├─ ReserveInventory │
    │                     │                     │                   │
    │                     │ ←── InventoryReserved                   │
    │                     ├─ ProcessPayment ────────────────────→  │
    │                     │                     │                   │
    │                     │ ←─────────────────── PaymentProcessed ─┤
    │ ←── OrderConfirmed ─┤                     │                   │
    │                     │                     │                   │
```

**OpenTelemetry Integration**:

The dashboard integrates with OpenTelemetry traces:

```csharp{
title: "OpenTelemetry Integration"
description: "Dashboard reads OpenTelemetry traces"
framework: "NET8"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["OpenTelemetry", "Tracing", "Dashboard"]
nugetPackages: ["Whizbang.Dashboard", "Whizbang.OpenTelemetry"]
usingStatements: ["Whizbang.Dashboard", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang.Dashboard;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbangDashboard(options => {
    // Read traces from OpenTelemetry collector
    options.UseOpenTelemetry(otel => {
        otel.Endpoint = "http://otel-collector:4317";
        otel.Protocol = OpenTelemetryProtocol.Grpc;
    });

    // Or from Jaeger
    options.UseJaeger(jaeger => {
        jaeger.Endpoint = "http://jaeger:16686";
    });

    // Or from Zipkin
    options.UseZipkin(zipkin => {
        zipkin.Endpoint = "http://zipkin:9411";
    });
});
```

### Trace Timeline View

Waterfall chart showing message timing:

```
Time ──────────────────────────────────────────────────→
0ms   100ms  200ms  300ms  400ms  500ms  600ms  700ms

PlaceOrder
│────────────│ (120ms)
             OrderPlaced
             │──────────────────│ (200ms - saga processing)
                                ReserveInventory
                                │──────────────│ (150ms)
                                               InventoryReserved
                                               │────────────│ (100ms)
                                                           ProcessPayment
                                                           │──────────────│ (150ms)
                                                                         PaymentProcessed
                                                                         │─│ (5ms - notification)
═══════════════════════════════════════════════════════════════════════════
Total: 727ms
```

## Projection Health Monitoring

### Projection Dashboard

Real-time view of all projections:

```
┌──────────────────────────────────────────────────────────────────┐
│  Projections                                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Name                   Status    Lag      Throughput    Errors  │
│  ────────────────────   ──────    ────     ──────────    ──────  │
│  OrderHistory           🟢 OK     2ms      450 evt/sec   0       │
│  CustomerStats          🟢 OK     5ms      320 evt/sec   0       │
│  InventorySummary       🟡 WARN   2.5s     180 evt/sec   0       │
│  ProductRecommendations 🔴 ERROR  45s      0 evt/sec     15      │
│                                                                   │
│  [Rebuild] [Pause] [Reset Checkpoint]                            │
└──────────────────────────────────────────────────────────────────┘
```

**Lag Alert**: Visual indicator when projection falls behind event stream.

### Projection Details

Drill into individual projection:

```
┌──────────────────────────────────────────────────────────────────┐
│  Projection: ProductRecommendations                               │
├──────────────────────────────────────────────────────────────────┤
│  Status: 🔴 ERROR                                                 │
│  Last Processed Event: evt_01J7G3KZ9P... (45 seconds ago)        │
│  Current Checkpoint: 123,456                                      │
│  Latest Event Position: 125,890                                   │
│  Lag: 2,434 events (~45 seconds)                                  │
│                                                                   │
│  Recent Errors (15):                                              │
│  - NullReferenceException at UpdateRecommendations:42            │
│  - NullReferenceException at UpdateRecommendations:42            │
│  - NullReferenceException at UpdateRecommendations:42            │
│  [View Stack Trace]                                               │
│                                                                   │
│  Actions:                                                         │
│  [Rebuild from Start] [Rebuild from Checkpoint] [Skip Failed]    │
└──────────────────────────────────────────────────────────────────┘
```

**Actions**:
- **Rebuild**: Clear projection and replay all events
- **Skip**: Skip the failing event and continue
- **Pause**: Stop projection processing

## Event Stream Explorer

Browse aggregate event streams:

```
┌──────────────────────────────────────────────────────────────────┐
│  Event Stream: Order-ord_123                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [0] OrderPlaced              2025-10-18 14:32:15 UTC            │
│      Customer: cust_456       Total: $99.99                       │
│                                                                   │
│  [1] OrderItemAdded           2025-10-18 14:33:02 UTC            │
│      Product: Widget          Quantity: 2                         │
│                                                                   │
│  [2] OrderShipped             2025-10-18 14:45:10 UTC            │
│      Carrier: UPS             Tracking: 1Z999AA10123456789        │
│                                                                   │
│  [3] OrderDelivered           2025-10-20 10:15:33 UTC            │
│      Signature: J. Doe        Location: Front door                │
│                                                                   │
│  Total Events: 4              Aggregate Version: 3                │
│                                                                   │
│  [Replay] [Download JSON] [View Snapshots]                        │
└──────────────────────────────────────────────────────────────────┘
```

**Features**:
- View full event stream for any aggregate
- Download events as JSON
- Replay events (time-travel debugging)
- View snapshots (if enabled)

## Performance Metrics

### Throughput Dashboard

Real-time metrics:

```
┌──────────────────────────────────────────────────────────────────┐
│  Throughput (Last 5 Minutes)                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Commands/sec:  ████████████████░░░░  120/sec                    │
│  Events/sec:    ██████████████████░░  450/sec                    │
│  Queries/sec:   ████████████░░░░░░░░  80/sec                     │
│                                                                   │
│  Avg Latency:                                                     │
│  - Commands:    42ms   (p50: 35ms, p95: 120ms, p99: 250ms)       │
│  - Events:      15ms   (p50: 12ms, p95: 45ms, p99: 80ms)         │
│  - Queries:     8ms    (p50: 5ms, p95: 25ms, p99: 50ms)          │
│                                                                   │
│  Error Rate:    0.02%  (3 errors in 15,000 messages)             │
└──────────────────────────────────────────────────────────────────┘
```

### Service Health

Monitor individual services:

```
┌──────────────────────────────────────────────────────────────────┐
│  Services                                                         │
├──────────────────────────────────────────────────────────────────┤
│  Name              Status    CPU    Memory   Replicas   Requests │
│  ──────────────    ──────    ───    ──────   ────────   ──────── │
│  orders-service    🟢 OK     23%    1.2 GB   3/3        450/sec  │
│  inventory-service 🟢 OK     45%    800 MB   2/2        320/sec  │
│  payment-service   🟡 WARN   78%    1.8 GB   2/2        180/sec  │
│  shipping-service  🟢 OK     12%    600 MB   1/1        80/sec   │
└──────────────────────────────────────────────────────────────────┘
```

## Control Plane UI

### Send Control Commands

From the dashboard UI:

```
┌──────────────────────────────────────────────────────────────────┐
│  Control Commands                                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Command: [Rebuild Projection ▼]                                 │
│                                                                   │
│  Projection Name: [OrderHistory_____________]                     │
│  Target Service:  [All Services ▼]                                │
│  Start From:      [Beginning of Time ▼]                           │
│                                                                   │
│  ⚠️  Warning: This will clear and rebuild the projection.         │
│      Queries may return incomplete data during rebuild.           │
│                                                                   │
│  [Cancel]  [Execute Command]                                      │
└──────────────────────────────────────────────────────────────────┘
```

**Available Commands**:
- Rebuild Projection
- Set Log Level
- Clear Caches
- Run Health Check
- Toggle Feature Flags
- Pause/Resume Message Processing

### Command History

Track what control commands were executed:

```
┌──────────────────────────────────────────────────────────────────┐
│  Command History                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Time                Command                   User      Status  │
│  ──────────────────  ────────────────────────  ────────  ──────  │
│  14:52:10 UTC        Rebuild OrderHistory      admin     ✓ Done  │
│  14:45:33 UTC        Set Log Level=Debug       john.doe  ✓ Done  │
│  14:32:15 UTC        Clear Cache               admin     ✗ Failed│
│  14:18:02 UTC        Pause Projection          jane.doe  ✓ Done  │
└──────────────────────────────────────────────────────────────────┘
```

## Search and Filtering

### Search Messages

Find specific messages:

```
┌──────────────────────────────────────────────────────────────────┐
│  Search Messages                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Query: [customer_id:cust_456 AND status:shipped_____________]   │
│  Time Range: [Last 24 Hours ▼]                                   │
│  [Search]                                                         │
│                                                                   │
│  Results (42):                                                    │
│  ────────────────────────────────────────────────────────────────│
│  OrderShipped - ord_123 - 2025-10-18 14:45:10                    │
│  OrderShipped - ord_789 - 2025-10-18 12:15:33                    │
│  OrderShipped - ord_456 - 2025-10-17 16:32:45                    │
│  ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

**Query Syntax**:
- `event_type:OrderPlaced`
- `tenant_id:acme-corp`
- `timestamp > 2025-10-18`
- `status:error AND service:payment`

## Real-Time Updates

Dashboard updates in real-time via SignalR:

```csharp{
title: "Real-Time Dashboard Updates"
description: "Dashboard receives live updates via SignalR"
framework: "NET8"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["Dashboard", "SignalR", "Real-Time"]
nugetPackages: ["Whizbang.Dashboard", "Microsoft.AspNetCore.SignalR"]
usingStatements: ["Whizbang.Dashboard", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang.Dashboard;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbangDashboard(options => {
    // Real-time updates via SignalR
    options.EnableRealTimeUpdates = true;

    // Push notifications for important events
    options.PushNotifications(notify => {
        notify.OnProjectionError = true;
        notify.OnHighLatency = true;
        notify.OnErrorRateThreshold = 0.05;  // Alert if error rate > 5%
    });
});
```

**Features**:
- Live message journey updates
- Real-time projection lag updates
- Instant error notifications
- Throughput graphs update every second

## Security

### Authentication

Protect the dashboard:

```csharp{
title: "Dashboard Authentication"
description: "Secure dashboard with authentication"
framework: "NET8"
category: "Security"
difficulty: "INTERMEDIATE"
tags: ["Dashboard", "Authentication", "Security"]
nugetPackages: ["Whizbang.Dashboard", "Microsoft.AspNetCore.Authentication"]
usingStatements: ["Whizbang.Dashboard", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang.Dashboard;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbangDashboard(options => {
    // Require authentication
    options.RequireAuthentication = true;

    // Role-based access
    options.RequireRole("WhizbangAdmin");

    // Or custom authorization policy
    options.RequirePolicy("WhizbangDashboardAccess");
});
```

### Audit Log

Track who accessed the dashboard:

```
┌──────────────────────────────────────────────────────────────────┐
│  Audit Log                                                        │
├──────────────────────────────────────────────────────────────────┤
│  Timestamp           User         Action                          │
│  ──────────────────  ───────────  ─────────────────────────────  │
│  14:52:10 UTC        admin        Rebuilt projection OrderHistory│
│  14:45:33 UTC        john.doe     Viewed order stream ord_123    │
│  14:32:15 UTC        admin        Set log level to Debug         │
│  14:18:02 UTC        jane.doe     Paused projection              │
└──────────────────────────────────────────────────────────────────┘
```

## Next Steps

- [**Observability**](./observability.md) - OpenTelemetry integration
- [**Advanced Scenarios**](./advanced-scenarios.md) - Control plane commands
- [**Distributed Messaging**](./Roadmap/distributed-messaging.md) - Cross-service tracing
