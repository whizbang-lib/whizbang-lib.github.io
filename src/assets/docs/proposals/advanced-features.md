---
title: Advanced Features
category: Architecture & Design
order: 10
tags: unit-of-work, performance-budgets, kubernetes-operator, tracing, debugging
---

# Advanced Features

Whizbang includes advanced features for enterprise scenarios, including cross-aggregate transactions, performance monitoring, Kubernetes operators, and debugging tools.

## Cross-Aggregate Transactions

### Unit of Work Pattern

**Coordinate transactions across multiple aggregates** while maintaining consistency:

```csharp{title="Unit of Work Configuration" description="Unit of work pattern configuration for cross-aggregate transactions" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Unit-of-Work", "Cross-Aggregate-Transactions"] framework="NET8"}
services.AddWhizbang(options => {
    options.UseUnitOfWork(uow => {
        uow.IsolationLevel = IsolationLevel.ReadCommitted;
        uow.Timeout = TimeSpan.FromSeconds(30);
        uow.EnableDistributedTransactions = true;
    });
});

```csharp{title="Multi-Aggregate Command Handler" description="Command handler using unit of work for coordinated multi-aggregate operations" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Unit-of-Work", "Command-Handlers"] framework="NET8"}
// Usage in handlers
public class PlaceOrderHandler : ICommandHandler<PlaceOrder> {
    private readonly IUnitOfWork _unitOfWork;
    private readonly IRepository<Order> _orderRepository;
    private readonly IRepository<Customer> _customerRepository;
    private readonly IRepository<Product> _productRepository;
    
    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        return await _unitOfWork.ExecuteAsync(async () => {
            // Load multiple aggregates
            var customer = await _customerRepository.Load(command.CustomerId);
            var products = await _productRepository.LoadMany(command.ProductIds);
            
            // Validate business rules across aggregates
            if (!customer.CanPlaceOrder(command.Total)) {
                throw new DomainException("Customer credit limit exceeded");
            }
            
            foreach (var product in products) {
                if (!product.IsAvailable(command.GetQuantity(product.Id))) {
                    throw new DomainException($"Product {product.Id} not available");
                }
            }
            
            // Create new aggregate
            var order = new Order(command.CustomerId, command.Items);
            
            // Update existing aggregates
            customer.ReserveCreditLimit(command.Total);
            foreach (var product in products) {
                product.ReserveStock(command.GetQuantity(product.Id));
            }
            
            // Save all changes in single transaction
            await _orderRepository.Save(order);
            await _customerRepository.Save(customer);
            await _productRepository.SaveMany(products);
            
            return new OrderPlaced(order.Id, command.CustomerId, DateTimeOffset.UtcNow);
        });
    }
}
```

### Distributed Transactions with Saga Fallback

```csharp{title="Distributed Transactions with Saga Fallback" description="Distributed transactions with saga fallback for complex operations" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Cross-Aggregate-Transactions", "Saga-Fallback"] framework="NET8"}
services.AddWhizbang(options => {
    options.CrossAggregateTransactions(transactions => {
        transactions.DefaultStrategy = TransactionStrategy.UnitOfWork;
        transactions.FallbackToSaga = true;
        transactions.SagaTimeoutMs = 30000;
        
        // Configure per-operation
        transactions.ForOperation<PlaceOrder>(op => {
            op.Strategy = TransactionStrategy.UnitOfWork;
            op.MaxAggregatesInTransaction = 5;
        });
        
        transactions.ForOperation<ComplexOrderWorkflow>(op => {
            op.Strategy = TransactionStrategy.Saga; // Force saga for complex operations
        });
    });
});
```

### Transaction Boundaries

```csharp{title="Transaction Boundary Implementation" description="Transaction boundary implementation with automatic rollback on failure" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "Transaction-Boundaries", "Error-Handling"] framework="NET8"}
public class TransactionBoundary : ITransactionBoundary {
    public async Task<T> ExecuteInTransaction<T>(Func<Task<T>> operation) {
        using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);
        
        try {
            var result = await operation();
            scope.Complete();
            return result;
        } catch (Exception ex) {
            // Transaction automatically rolled back
            _logger.LogError(ex, "Transaction failed and was rolled back");
            throw;
        }
    }
}
```

## Performance Budgets & Monitoring

> **📋 Detailed Coverage**: For comprehensive performance budgets, observability, and monitoring details, see [**Observability & Metrics**](./observability-metrics.md)

### Performance Budget Overview

**Performance budgets** provide automatic tracking and alerting for handler performance:

```csharp{title="Performance Budget Attributes" description="Performance budget attributes for automatic tracking and alerting" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "Performance-Budgets", "Monitoring"] framework="NET8"}
[PerformanceBudget(MaxLatencyMs = 100)]
public class PlaceOrderHandler : ICommandHandler<PlaceOrder> {
    // Automatic budget tracking and violation alerts
}
```

## OpenTelemetry Integration

> **📋 Detailed Coverage**: For complete OpenTelemetry setup, metrics, and distributed tracing, see [**Observability & Metrics**](./observability-metrics.md)

```csharp{title="OpenTelemetry Integration Configuration" description="OpenTelemetry integration configuration for comprehensive observability" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "OpenTelemetry", "Observability"] framework="NET8"}
services.AddWhizbang(options => {
    options.Observability(observability => {
        observability.UseOpenTelemetry(otel => {
            otel.TraceAllCommands = true;
            otel.TraceAllEvents = true;
            otel.TraceProjections = true;
            otel.TraceSagas = true;
            
            // Custom metrics
            otel.EmitCustomMetrics = true;
            otel.MetricsPrefix = "whizbang";
            
            // Performance budget violations
            otel.TracePerformanceBudgetViolations = true;
            otel.AlertOnBudgetViolation = true;
        });
    });
});

```csharp{title="Custom Performance Tracking Handler" description="Custom performance tracking handler with detailed metrics collection" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Performance-Tracking", "Custom-Metrics"] framework="NET8"}
// Custom performance tracking
public class PerformanceTrackingHandler<T> : ICommandHandler<T> where T : ICommand {
    private readonly ICommandHandler<T> _innerHandler;
    private readonly IMetrics _metrics;
    
    public async Task Handle(T command) {
        using var activity = Activity.StartActivity($"Command.{typeof(T).Name}");
        using var timer = _metrics.StartTimer($"command.{typeof(T).Name.ToLower()}.duration");
        
        var startMemory = GC.GetTotalMemory(false);
        var stopwatch = Stopwatch.StartNew();
        
        try {
            await _innerHandler.Handle(command);
            
            // Record success metrics
            _metrics.IncrementCounter($"command.{typeof(T).Name.ToLower()}.success");
        } catch (Exception ex) {
            // Record failure metrics
            _metrics.IncrementCounter($"command.{typeof(T).Name.ToLower()}.failure", 
                new[] { ("error_type", ex.GetType().Name) });
            
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        } finally {
            stopwatch.Stop();
            var endMemory = GC.GetTotalMemory(false);
            
            // Record performance metrics
            activity?.SetTag("duration_ms", stopwatch.ElapsedMilliseconds);
            activity?.SetTag("memory_allocated_bytes", endMemory - startMemory);
            
            _metrics.RecordValue($"command.{typeof(T).Name.ToLower()}.memory", endMemory - startMemory);
        }
    }
}
```

## Kubernetes Operator Features

> **📋 Detailed Coverage**: For production deployment patterns, health checks, and operational best practices, see [**Deployment & Operations**](./deployment-operations.md)

### Auto-Scaling Projection Workers

```yaml
---
category: Design
difficulty: ADVANCED
tags: [Design, Advanced-Features, Kubernetes-Operator, Auto-Scaling]
description: Kubernetes custom resource for auto-scaling projection workers
---
apiVersion: whizbang.io/v1
kind: ProjectionWorker
metadata:
  name: order-summary-projection
spec:
  projectionName: order-summary
  scaling:
    strategy: lag-based
    minReplicas: 2
    maxReplicas: 10
    lagThresholdSeconds: 30
    scaleUpCooldownMs: 300000   # 5 minutes
    scaleDownCooldownMs: 600000 # 10 minutes
  partitioning:
    enabled: true
    partitionCount: 8
    partitionBy: "streamId"
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

### Partition-Aware Pod Placement

```yaml
---
category: Design
difficulty: ADVANCED
tags: [Design, Advanced-Features, Kubernetes-Operator, Partition-Aware-Placement]
description: Partition-aware pod placement for distributed projection processing
---
apiVersion: whizbang.io/v1
kind: PartitionedProjection
metadata:
  name: analytics-projection
spec:
  projectionName: analytics
  partitions:
  - id: 0
    nodeSelector:
      whizbang.io/partition-group: "group-a"
  - id: 1
    nodeSelector:
      whizbang.io/partition-group: "group-a"
  - id: 2
    nodeSelector:
      whizbang.io/partition-group: "group-b"
  - id: 3
    nodeSelector:
      whizbang.io/partition-group: "group-b"
  antiAffinity:
    enabled: true
    topologyKey: kubernetes.io/hostname
```

### Blue/Green Projection Deployments

```yaml
---
category: Design
difficulty: ADVANCED
tags: [Design, Advanced-Features, Kubernetes-Operator, Blue-Green-Deployment]
description: Blue/green projection deployments with validation and automatic switchover
---
apiVersion: whizbang.io/v1
kind: ProjectionDeployment
metadata:
  name: order-summary-deployment
spec:
  strategy: blue-green
  validation:
    samplingRate: 0.1          # Validate 10% of data
    accuracyThreshold: 0.99    # 99% accuracy required
    validationTimeoutMinutes: 30
  switchover:
    automatic: false           # Manual approval required
    trafficSplitDurationMinutes: 10
  cleanup:
    retainBlueVersionHours: 24 # Keep blue for 24 hours after switchover
```

### Automatic Backfilling

```yaml
---
category: Design
difficulty: ADVANCED
tags: [Design, Advanced-Features, Kubernetes-Operator, Automatic-Backfilling]
description: Kubernetes job for automatic projection backfilling with resource management
---
apiVersion: whizbang.io/v1
kind: BackfillJob
metadata:
  name: customer-analytics-backfill
spec:
  projectionName: customer-analytics
  trigger: deployment-update  # Trigger on projection deployment
  source:
    fromDate: "2024-01-01T00:00:00Z"
    toDate: null              # Current time
  execution:
    batchSize: 1000
    parallelism: 4
    maxRetries: 3
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
```

### Kubernetes Operator Implementation

```csharp{title="Kubernetes Operator Implementation" description="Kubernetes operator implementation for Whizbang resource management" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Kubernetes-Operator", "Implementation"] framework="NET8"}
public class WhizbangOperator : IHostedService {
    private readonly IKubernetesClient _kubernetesClient;
    private readonly IProjectionManager _projectionManager;
    
    public async Task StartAsync(CancellationToken cancellationToken) {
        // Watch for ProjectionWorker resources
        await _kubernetesClient.WatchAsync<ProjectionWorker>(
            onEvent: async (eventType, resource) => {
                switch (eventType) {
                    case WatchEventType.Added:
                        await CreateProjectionWorker(resource);
                        break;
                    case WatchEventType.Modified:
                        await UpdateProjectionWorker(resource);
                        break;
                    case WatchEventType.Deleted:
                        await DeleteProjectionWorker(resource);
                        break;
                }
            },
            cancellationToken: cancellationToken
        );
        
        // Monitor projection lag and auto-scale
        _ = Task.Run(() => MonitorAndScale(cancellationToken), cancellationToken);
    }
    
    private async Task MonitorAndScale(CancellationToken cancellationToken) {
        while (!cancellationToken.IsCancellationRequested) {
            var projections = await _projectionManager.GetAllProjections();
            
            foreach (var projection in projections) {
                var lag = await _projectionManager.GetLag(projection.Name);
                var workerSpec = await GetProjectionWorkerSpec(projection.Name);
                
                if (ShouldScaleUp(lag, workerSpec)) {
                    await ScaleUpProjectionWorker(projection.Name, workerSpec);
                } else if (ShouldScaleDown(lag, workerSpec)) {
                    await ScaleDownProjectionWorker(projection.Name, workerSpec);
                }
            }
            
            await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
        }
    }
}
```

## Debugging and Development Tools

> **📋 Detailed Coverage**: For comprehensive testing framework, development tools, CLI, and IDE integration, see [**Testing & Development Tools**](./testing-development-tools.md) and [**Source Generation & IDE Integration**](./source-generation-ide.md)

### OpenTelemetry Journey Visualization

**Capture and visualize message journeys** for debugging:

```csharp{title="Message Journey Debugging Configuration" description="Debugging configuration for message journey capture and visualization" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "Debugging", "Message-Journeys"] framework="NET8"}
services.AddWhizbang(options => {
    options.Debugging(debugging => {
        debugging.CaptureMessageJourneys = true;
        debugging.JourneyRetentionDays = 7;
        debugging.EnableBreakpoints = true;
        debugging.EnableStateInspection = true;
    });
});

```csharp{title="Message Journey Tracking Interceptor" description="Message journey tracking interceptor for debugging and visualization" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Debugging", "Journey-Tracking"] framework="NET8"}
// Message journey tracking
public class MessageJourneyTracker : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message, 
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        var journeyId = context.CorrelationId ?? Guid.NewGuid().ToString();
        
        using var activity = Activity.StartActivity("MessageJourney");
        activity?.SetTag("journey_id", journeyId);
        activity?.SetTag("message_type", typeof(TRequest).Name);
        activity?.SetTag("handler_type", context.HandlerType?.Name);
        
        var stopwatch = Stopwatch.StartNew();
        
        try {
            var response = await next(message, context);
            
            await _journeyStore.RecordStep(new JourneyStep {
                JourneyId = journeyId,
                MessageType = typeof(TRequest).Name,
                HandlerType = context.HandlerType?.Name,
                Duration = stopwatch.Elapsed,
                Status = "Success",
                Input = JsonSerializer.Serialize(message),
                Output = JsonSerializer.Serialize(response)
            });
            
            return response;
        } catch (Exception ex) {
            await _journeyStore.RecordStep(new JourneyStep {
                JourneyId = journeyId,
                MessageType = typeof(TRequest).Name,
                HandlerType = context.HandlerType?.Name,
                Duration = stopwatch.Elapsed,
                Status = "Failed",
                Error = ex.ToString(),
                Input = JsonSerializer.Serialize(message)
            });
            
            throw;
        }
    }
}
```

### Replay and Simulation

**Replay events for debugging and testing**:

```csharp{title="Event Replay Service Interface" description="Event replay service interface for debugging and testing scenarios" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Event-Replay", "Simulation"] framework="NET8"}
public interface IEventReplayService {
    Task<ReplayResult> ReplayEvents(ReplayOptions options);
    Task<SimulationResult> SimulateEventStream(SimulationOptions options);
    IAsyncEnumerable<ReplayProgress> GetReplayProgress(string replayId);
}

public class EventReplayService : IEventReplayService {
    public async Task<ReplayResult> ReplayEvents(ReplayOptions options) {
        var replayId = Guid.NewGuid().ToString();
        
        // Create isolated replay environment
        var replayContext = await CreateReplayContext(replayId, options);
        
        try {
            // Load events to replay
            var events = await LoadEventsForReplay(options);
            
            // Replay events in isolated context
            foreach (var @event in events) {
                if (options.Breakpoints?.Contains(@event.EventNumber) == true) {
                    await PauseForBreakpoint(@event, replayContext);
                }
                
                await replayContext.ProcessEvent(@event);
                
                if (options.StepByStep) {
                    await WaitForContinueSignal(replayId);
                }
            }
            
            return new ReplayResult {
                ReplayId = replayId,
                EventsProcessed = events.Count(),
                Status = ReplayStatus.Completed
            };
        } catch (Exception ex) {
            return new ReplayResult {
                ReplayId = replayId,
                Status = ReplayStatus.Failed,
                Error = ex.Message
            };
        }
    }
}

```csharp{title="Event Replay Usage Example" description="Event replay configuration options and usage example" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "Event-Replay", "Usage-Example"] framework="NET8"}
// Usage
var replayOptions = new ReplayOptions {
    FromEventNumber = 1000,
    ToEventNumber = 2000,
    StreamFilter = streamId => streamId.StartsWith("Order-"),
    StepByStep = true,
    Breakpoints = new[] { 1500, 1750 },
    IsolatedEnvironment = true
};

var result = await _replayService.ReplayEvents(replayOptions);
```

### State Inspection and Breakpoints

**Inspect aggregate and projection state during debugging**:

```csharp{title="State Inspection Interface" description="State inspection interface for debugging aggregate and projection state" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "State-Inspection", "Debugging"] framework="NET8"}
public interface IStateInspector {
    Task<AggregateState> InspectAggregate(string streamId, long? version = null);
    Task<ProjectionState> InspectProjection(string projectionName, string documentId);
    Task<IEnumerable<EventInfo>> GetEventHistory(string streamId);
    Task SetBreakpoint(string streamId, long eventVersion);
    Task<BreakpointContext> WaitForBreakpoint(string breakpointId);
}

```csharp{title="Breakpoint Handler Implementation" description="Breakpoint handler implementation for debugging event processing" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Breakpoints", "Implementation"] framework="NET8"}
// Breakpoint implementation
public class BreakpointHandler : IEventHandler<object> {
    public async Task Handle(object @event, EventContext context) {
        var breakpoints = await _breakpointStore.GetActiveBreakpoints(context.StreamId);
        
        foreach (var breakpoint in breakpoints) {
            if (ShouldTriggerBreakpoint(breakpoint, @event, context)) {
                var breakpointContext = new BreakpointContext {
                    BreakpointId = breakpoint.Id,
                    Event = @event,
                    StreamId = context.StreamId,
                    EventVersion = context.EventVersion,
                    AggregateState = await LoadAggregateState(context.StreamId, context.EventVersion - 1),
                    Timestamp = DateTimeOffset.UtcNow
                };
                
                await _breakpointStore.RecordBreakpointHit(breakpointContext);
                await _notificationService.NotifyBreakpointHit(breakpointContext);
                
                // Pause execution until developer continues
                await WaitForContinueSignal(breakpoint.Id);
            }
        }
    }
}
```

### W3C Trace Context Integration

**Distributed tracing with W3C standards**:

```csharp{title="W3C Trace Context Configuration" description="W3C trace context integration configuration for distributed tracing" category="Design" difficulty="INTERMEDIATE" tags=["Design", "Advanced-Features", "Distributed-Tracing", "W3C-Standards"] framework="NET8"}
services.AddWhizbang(options => {
    options.DistributedTracing(tracing => {
        tracing.UseW3CTraceContext = true;
        tracing.PropagateTraceHeaders = true;
        tracing.SampleRate = 0.1; // Sample 10% of traces
        
        tracing.CustomTags.Add("service.name", "whizbang-orders");
        tracing.CustomTags.Add("service.version", "1.2.3");
    });
});

```csharp{title="W3C Trace Context Propagation" description="Automatic W3C trace context propagation implementation" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Trace-Propagation", "W3C-Implementation"] framework="NET8"}
// Automatic trace propagation
public class TraceContextPropagator : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        // Extract W3C trace context from headers
        var traceParent = context.Headers.GetValueOrDefault("traceparent");
        var traceState = context.Headers.GetValueOrDefault("tracestate");
        
        if (traceParent != null) {
            // Parse W3C trace context
            var traceContext = W3CTraceContext.Parse(traceParent, traceState);
            
            // Create child span
            using var activity = Activity.StartActivity($"Handle{typeof(TRequest).Name}");
            activity?.SetParentId(traceContext.TraceId, traceContext.SpanId);
            activity?.SetTag("whizbang.correlation_id", context.CorrelationId);
            activity?.SetTag("whizbang.message_type", typeof(TRequest).Name);
            
            // Add custom trace state
            var newTraceState = $"whizbang=correlation-id:{context.CorrelationId}";
            if (!string.IsNullOrEmpty(traceState)) {
                newTraceState = $"{traceState},{newTraceState}";
            }
            activity?.SetTag("tracestate", newTraceState);
            
            return await next(message, context);
        }
        
        // No parent trace - start new one
        using var rootActivity = Activity.StartActivity($"Handle{typeof(TRequest).Name}");
        return await next(message, context);
    }
}
```

## Configuration Examples

### Comprehensive Advanced Features Setup

```csharp{title="Comprehensive Advanced Features Setup" description="Comprehensive advanced features configuration combining all options" category="Design" difficulty="ADVANCED" tags=["Design", "Advanced-Features", "Comprehensive-Setup", "Configuration"] framework="NET8"}
services.AddWhizbang(options => {
    // Cross-aggregate transactions
    options.UseUnitOfWork(uow => {
        uow.IsolationLevel = IsolationLevel.ReadCommitted;
        uow.EnableDistributedTransactions = true;
        uow.FallbackToSaga = true;
    });
    
    // Performance budgets
    options.PerformanceBudgets(budgets => {
        budgets.DefaultCommandLatency = TimeSpan.FromMilliseconds(500);
        budgets.AlertOnViolation = true;
        budgets.UseOpenTelemetryMetrics = true;
    });
    
    // Observability
    options.Observability(observability => {
        observability.UseOpenTelemetry();
        observability.CaptureMessageJourneys = true;
        observability.EnableDistributedTracing = true;
    });
    
    // Debugging
    options.Debugging(debugging => {
        debugging.EnableBreakpoints = true;
        debugging.EnableStateInspection = true;
        debugging.EnableEventReplay = true;
        debugging.RetainDebugDataDays = 7;
    });
    
    // Kubernetes integration
    options.Kubernetes(k8s => {
        k8s.EnableOperator = true;
        k8s.AutoScaleProjections = true;
        k8s.EnableBlueGreenDeployments = true;
        k8s.PartitionAwarePlacement = true;
    });
});
```

## Best Practices

### Transaction Guidelines

1. **Keep transactions short** - Minimize time holding locks
2. **Limit aggregate count** - Avoid transactions with too many aggregates
3. **Use sagas for long processes** - Don't use transactions for workflows
4. **Test rollback scenarios** - Ensure proper cleanup on failure
5. **Monitor transaction metrics** - Track duration and failure rates

### Performance Monitoring

1. **Set realistic budgets** - Base on actual performance requirements
2. **Monitor trends** - Track performance over time
3. **Alert on violations** - Set up proper alerting for budget violations
4. **Use sampling** - Don't trace every request in production
5. **Correlate with business metrics** - Connect performance to business impact

### Debugging Best Practices

1. **Use structured logging** - Include correlation IDs and context
2. **Limit debug data retention** - Don't keep debug data indefinitely
3. **Secure sensitive data** - Mask PII in debug traces
4. **Test replay scenarios** - Ensure replay works correctly
5. **Document debugging procedures** - Help team members debug effectively

---

## Related Documentation

### Core Architecture
- [**Event Store & Projections**](./event-store-projections.md) - Core storage architecture
- [**Concurrency Control**](./concurrency-control.md) - Managing concurrent updates
- [**Policy Engine**](./policy-engine.md) - Universal configuration scoping mechanism
- [**Flags & Tags System**](./flags-tags-system.md) - Cross-service context propagation

### Implementation & Operations
- [**Source Generation & IDE Integration**](./source-generation-ide.md) - Development tooling and navigation
- [**Testing & Development Tools**](./testing-development-tools.md) - Testing framework and CLI tools  
- [**Observability & Metrics**](./observability-metrics.md) - Production monitoring and observability
- [**Deployment & Operations**](./deployment-operations.md) - Operational patterns and best practices