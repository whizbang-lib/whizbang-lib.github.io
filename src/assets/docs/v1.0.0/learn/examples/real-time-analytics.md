---
title: Real-Time Analytics
version: 1.0.0
category: Customization Examples
order: 4
description: >-
  Build real-time analytics dashboards - streaming metrics, SignalR updates, and
  live KPIs
tags: 'real-time, analytics, signalr, streaming, dashboards, websockets'
---

# Real-Time Analytics

Build **real-time analytics dashboards** with Whizbang featuring streaming metrics, SignalR updates, live KPIs, and event-driven data aggregation.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Real-Time Analytics Architecture                          │
│                                                             │
│  ┌─────────────┐                                           │
│  │Azure Service│  Domain Events (OrderCreated, etc.)       │
│  │     Bus     │──────────────────┐                        │
│  └─────────────┘                  │                        │
│                                    ▼                        │
│              ┌────────────────────────────────┐            │
│              │ Analytics Worker               │            │
│              │  - DailySalesPerspective       │            │
│              │  - RealtimeMetricsPerspective  │            │
│              └──────────┬─────────────────────┘            │
│                         │                                   │
│                         ▼                                   │
│              ┌────────────────────────────────┐            │
│              │ PostgreSQL + Redis Cache       │            │
│              └──────────┬─────────────────────┘            │
│                         │                                   │
│                         ▼                                   │
│              ┌────────────────────────────────┐            │
│              │ SignalR Hub                    │            │
│              │  - Broadcast metrics to clients│            │
│              └──────────┬─────────────────────┘            │
│                         │                                   │
│                         ▼                                   │
│              ┌────────────────────────────────┐            │
│              │  Web Clients (Dashboards)      │            │
│              │  - Live KPI updates            │            │
│              │  - Charts auto-refresh         │            │
│              └────────────────────────────────┘            │
└────────────────────────────────────────────────────────────┘
```

---

## SignalR Hub

**MetricsHub.cs**:

```csharp
using Microsoft.AspNetCore.SignalR;

public class MetricsHub : Hub {
  private readonly ILogger<MetricsHub> _logger;

  public MetricsHub(ILogger<MetricsHub> logger) {
    _logger = logger;
  }

  public override async Task OnConnectedAsync() {
    _logger.LogInformation(
      "Client {ConnectionId} connected to MetricsHub",
      Context.ConnectionId
    );

    // Send current metrics on connect
    await Clients.Caller.SendAsync(
      "ReceiveCurrentMetrics",
      await GetCurrentMetricsAsync()
    );

    await base.OnConnectedAsync();
  }

  public override Task OnDisconnectedAsync(Exception? exception) {
    _logger.LogInformation(
      "Client {ConnectionId} disconnected from MetricsHub",
      Context.ConnectionId
    );

    return base.OnDisconnectedAsync(exception);
  }

  private async Task<object> GetCurrentMetricsAsync() {
    // Fetch current metrics from cache or database
    return new {
      TotalOrders = 1234,
      TotalRevenue = 45678.90m,
      AverageOrderValue = 37.02m,
      Timestamp = DateTime.UtcNow
    };
  }
}
```

**Program.cs registration**:

```csharp
builder.Services.AddSignalR();

app.MapHub<MetricsHub>("/hubs/metrics");
```

---

## Real-Time Metrics Perspective

**RealtimeMetricsPerspective.cs**:

```csharp
public class RealtimeMetricsPerspective :
  IPerspectiveOf<OrderCreated>,
  IPerspectiveOf<PaymentProcessed> {

  private readonly IHubContext<MetricsHub> _hubContext;
  private readonly IDistributedCache _cache;
  private readonly ILogger<RealtimeMetricsPerspective> _logger;

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    // 1. Update metrics in cache (Redis)
    var metrics = await GetCurrentMetricsAsync(ct);

    metrics = metrics with {
      TotalOrders = metrics.TotalOrders + 1,
      TotalRevenue = metrics.TotalRevenue + @event.TotalAmount,
      AverageOrderValue = (metrics.TotalRevenue + @event.TotalAmount) / (metrics.TotalOrders + 1),
      LastUpdated = DateTime.UtcNow
    };

    await SaveMetricsAsync(metrics, ct);

    // 2. Broadcast to all connected clients
    await _hubContext.Clients.All.SendAsync(
      "ReceiveMetricsUpdate",
      new {
        metrics.TotalOrders,
        metrics.TotalRevenue,
        metrics.AverageOrderValue,
        Timestamp = DateTime.UtcNow
      },
      ct
    );

    _logger.LogInformation(
      "Broadcasted metrics update: {TotalOrders} orders, ${TotalRevenue}",
      metrics.TotalOrders,
      metrics.TotalRevenue
    );
  }

  public async Task HandleAsync(
    PaymentProcessed @event,
    CancellationToken ct = default
  ) {
    // Update payment-specific metrics
    var metrics = await GetCurrentMetricsAsync(ct);

    metrics = metrics with {
      TotalPaymentsProcessed = metrics.TotalPaymentsProcessed + 1,
      LastUpdated = DateTime.UtcNow
    };

    await SaveMetricsAsync(metrics, ct);

    await _hubContext.Clients.All.SendAsync(
      "ReceivePaymentMetricsUpdate",
      new {
        metrics.TotalPaymentsProcessed,
        Timestamp = DateTime.UtcNow
      },
      ct
    );
  }

  private async Task<RealtimeMetrics> GetCurrentMetricsAsync(CancellationToken ct) {
    var cached = await _cache.GetStringAsync("realtime-metrics", ct);
    if (cached != null) {
      return JsonSerializer.Deserialize<RealtimeMetrics>(cached)!;
    }

    // Initialize if not exists
    return new RealtimeMetrics {
      TotalOrders = 0,
      TotalRevenue = 0,
      AverageOrderValue = 0,
      TotalPaymentsProcessed = 0,
      LastUpdated = DateTime.UtcNow
    };
  }

  private async Task SaveMetricsAsync(RealtimeMetrics metrics, CancellationToken ct) {
    var json = JsonSerializer.Serialize(metrics);
    await _cache.SetStringAsync(
      "realtime-metrics",
      json,
      new DistributedCacheEntryOptions {
        AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(1)
      },
      ct
    );
  }
}

public record RealtimeMetrics {
  public long TotalOrders { get; init; }
  public decimal TotalRevenue { get; init; }
  public decimal AverageOrderValue { get; init; }
  public long TotalPaymentsProcessed { get; init; }
  public DateTime LastUpdated { get; init; }
}
```

---

## Client-Side (TypeScript)

**metrics-dashboard.ts**:

```typescript
import * as signalR from "@microsoft/signalr";

class MetricsDashboard {
  private connection: signalR.HubConnection;

  constructor() {
    // Connect to SignalR hub
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl("/hubs/metrics")
      .withAutomaticReconnect()
      .build();

    this.setupEventHandlers();
    this.connect();
  }

  private setupEventHandlers() {
    // Receive current metrics on connect
    this.connection.on("ReceiveCurrentMetrics", (metrics: any) => {
      console.log("Current metrics:", metrics);
      this.updateDashboard(metrics);
    });

    // Receive live updates
    this.connection.on("ReceiveMetricsUpdate", (metrics: any) => {
      console.log("Metrics update:", metrics);
      this.updateDashboard(metrics);
      this.showNotification(`New order: $${metrics.TotalRevenue}`);
    });

    // Receive payment updates
    this.connection.on("ReceivePaymentMetricsUpdate", (metrics: any) => {
      console.log("Payment metrics update:", metrics);
      this.updatePaymentMetrics(metrics);
    });
  }

  private async connect() {
    try {
      await this.connection.start();
      console.log("Connected to MetricsHub");
    } catch (err) {
      console.error("Error connecting to MetricsHub:", err);
      setTimeout(() => this.connect(), 5000);
    }
  }

  private updateDashboard(metrics: any) {
    document.getElementById("total-orders")!.textContent = metrics.TotalOrders;
    document.getElementById("total-revenue")!.textContent = `$${metrics.TotalRevenue.toFixed(2)}`;
    document.getElementById("avg-order-value")!.textContent = `$${metrics.AverageOrderValue.toFixed(2)}`;
    document.getElementById("last-updated")!.textContent = new Date(metrics.Timestamp).toLocaleTimeString();
  }

  private updatePaymentMetrics(metrics: any) {
    document.getElementById("total-payments")!.textContent = metrics.TotalPaymentsProcessed;
  }

  private showNotification(message: string) {
    // Show toast notification
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
}

// Initialize dashboard
new MetricsDashboard();
```

**HTML**:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Real-Time Analytics Dashboard</title>
  <style>
    .metric-card {
      display: inline-block;
      padding: 20px;
      margin: 10px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    .metric-value {
      font-size: 36px;
      font-weight: bold;
    }
    .metric-label {
      font-size: 14px;
      color: #666;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 15px;
      background: #28a745;
      color: white;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>Real-Time Analytics Dashboard</h1>

  <div class="metric-card">
    <div class="metric-value" id="total-orders">0</div>
    <div class="metric-label">Total Orders</div>
  </div>

  <div class="metric-card">
    <div class="metric-value" id="total-revenue">$0.00</div>
    <div class="metric-label">Total Revenue</div>
  </div>

  <div class="metric-card">
    <div class="metric-value" id="avg-order-value">$0.00</div>
    <div class="metric-label">Avg Order Value</div>
  </div>

  <div class="metric-card">
    <div class="metric-value" id="total-payments">0</div>
    <div class="metric-label">Total Payments</div>
  </div>

  <div>
    <small>Last updated: <span id="last-updated">-</span></small>
  </div>

  <script src="/dist/metrics-dashboard.js"></script>
</body>
</html>
```

---

## Streaming Aggregations

**Sliding Window Analytics**:

```csharp
public class SlidingWindowAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IDistributedCache _cache;
  private readonly IHubContext<MetricsHub> _hubContext;

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    // Add event to sliding window (last 5 minutes)
    var windowKey = "orders:last5min";
    var events = await GetWindowEventsAsync(windowKey, ct);

    events.Add(new OrderEventData {
      OrderId = @event.OrderId,
      Amount = @event.TotalAmount,
      Timestamp = DateTime.UtcNow
    });

    // Remove events older than 5 minutes
    var cutoff = DateTime.UtcNow.AddMinutes(-5);
    events = events.Where(e => e.Timestamp >= cutoff).ToList();

    await SaveWindowEventsAsync(windowKey, events, ct);

    // Calculate metrics for last 5 minutes
    var metrics = new {
      OrderCount = events.Count,
      TotalRevenue = events.Sum(e => e.Amount),
      AverageOrderValue = events.Any() ? events.Average(e => e.Amount) : 0,
      WindowStart = cutoff,
      WindowEnd = DateTime.UtcNow
    };

    // Broadcast sliding window metrics
    await _hubContext.Clients.All.SendAsync(
      "ReceiveSlidingWindowUpdate",
      metrics,
      ct
    );
  }

  private async Task<List<OrderEventData>> GetWindowEventsAsync(
    string key,
    CancellationToken ct
  ) {
    var cached = await _cache.GetStringAsync(key, ct);
    return cached != null
      ? JsonSerializer.Deserialize<List<OrderEventData>>(cached)!
      : new List<OrderEventData>();
  }

  private async Task SaveWindowEventsAsync(
    string key,
    List<OrderEventData> events,
    CancellationToken ct
  ) {
    var json = JsonSerializer.Serialize(events);
    await _cache.SetStringAsync(
      key,
      json,
      new DistributedCacheEntryOptions {
        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
      },
      ct
    );
  }
}

public record OrderEventData {
  public required string OrderId { get; init; }
  public required decimal Amount { get; init; }
  public required DateTime Timestamp { get; init; }
}
```

---

## Performance Optimizations

### 1. Throttling

Limit broadcast frequency to avoid overwhelming clients:

```csharp
public class ThrottledMetricsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IHubContext<MetricsHub> _hubContext;
  private readonly SemaphoreSlim _semaphore = new(1, 1);
  private DateTime _lastBroadcast = DateTime.MinValue;
  private static readonly TimeSpan BroadcastInterval = TimeSpan.FromSeconds(1);

  public async Task HandleAsync(OrderCreated @event, CancellationToken ct) {
    // Update metrics immediately
    await UpdateMetricsAsync(@event, ct);

    // Throttle broadcasts (max once per second)
    await _semaphore.WaitAsync(ct);
    try {
      if (DateTime.UtcNow - _lastBroadcast >= BroadcastInterval) {
        await BroadcastMetricsAsync(ct);
        _lastBroadcast = DateTime.UtcNow;
      }
    } finally {
      _semaphore.Release();
    }
  }
}
```

### 2. Batching

Batch multiple updates before broadcasting:

```csharp
public class BatchedMetricsPerspective {
  private readonly Channel<OrderCreated> _channel = Channel.CreateUnbounded<OrderCreated>();

  public BatchedMetricsPerspective(IHubContext<MetricsHub> hubContext) {
    _ = Task.Run(async () => await ProcessBatchesAsync(hubContext));
  }

  public async Task HandleAsync(OrderCreated @event, CancellationToken ct) {
    await _channel.Writer.WriteAsync(@event, ct);
  }

  private async Task ProcessBatchesAsync(IHubContext<MetricsHub> hubContext) {
    await foreach (var batch in _channel.Reader.ReadAllAsync().Buffer(TimeSpan.FromSeconds(1), 100)) {
      var metrics = new {
        OrderCount = batch.Count,
        TotalRevenue = batch.Sum(e => e.TotalAmount),
        Timestamp = DateTime.UtcNow
      };

      await hubContext.Clients.All.SendAsync("ReceiveBatchUpdate", metrics);
    }
  }
}
```

---

## Key Takeaways

✅ **SignalR** - Real-time WebSocket communication
✅ **Event-Driven Updates** - Perspectives broadcast to clients
✅ **Redis Caching** - Fast metric aggregation
✅ **Sliding Windows** - Last N minutes/hours analytics
✅ **Throttling** - Prevent client overload
✅ **Batching** - Reduce broadcast frequency

---

## Alternative Architectures

### Server-Sent Events (SSE)

Simpler than SignalR for one-way updates:

```csharp
app.MapGet("/sse/metrics", async (HttpContext context) => {
  context.Response.Headers.Add("Content-Type", "text/event-stream");
  context.Response.Headers.Add("Cache-Control", "no-cache");

  while (!context.RequestAborted.IsCancellationRequested) {
    var metrics = await GetCurrentMetricsAsync();
    await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(metrics)}\n\n");
    await context.Response.Body.FlushAsync();

    await Task.Delay(TimeSpan.FromSeconds(1));
  }
});
```

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
