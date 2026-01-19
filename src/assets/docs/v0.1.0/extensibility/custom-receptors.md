---
title: "Custom Receptors"
version: 0.1.0
category: Extensibility
order: 2
description: "Advanced receptor customization patterns - streaming, lifecycle hooks, base classes, and performance optimization"
tags: receptors, custom-handlers, streaming, lifecycle, base-classes
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
---

# Custom Receptors

**Custom receptors** extend the basic `IReceptor<TMessage, TResponse>` pattern with advanced capabilities like streaming, lifecycle management, custom base classes, and specialized execution patterns.

:::note
For basic receptor usage, see [Receptors Guide](../core-concepts/receptors.md). This guide focuses on **advanced customization patterns** for specialized scenarios.
:::

---

## Why Custom Receptor Patterns?

**Built-in `IReceptor<T, TResponse>` handles most cases**, but some scenarios benefit from custom patterns:

| Scenario | Standard Receptor | Custom Pattern |
|----------|------------------|----------------|
| **Request/Response** | ✅ Perfect fit | No customization needed |
| **Streaming Results** | ❌ Returns single response | ✅ IAsyncEnumerable streaming |
| **Shared Logic** | ❌ Copy-paste across receptors | ✅ Custom base class |
| **Resource Lifecycle** | ❌ Manual setup/teardown | ✅ Lifecycle hooks |
| **Complex Validation** | ❌ Repetitive code | ✅ Base class validation |
| **Multi-Tenancy** | ❌ Manual tenant resolution | ✅ Base class with tenant context |
| **Performance Critical** | ❌ Defensive allocations | ✅ Zero-allocation patterns |

**When to customize**:
- ✅ Shared behavior across many receptors
- ✅ Streaming/pagination scenarios
- ✅ Complex lifecycle management
- ✅ Domain-specific validation
- ✅ Multi-tenant applications

**When NOT to customize**:
- ❌ One-off requirements (use standard receptor)
- ❌ Simple request/response (over-engineering)
- ❌ Adding state (receptors must be stateless)

---

## Architecture

### Receptor Execution Pipeline

```
┌────────────────────────────────────────────────────────┐
│  Dispatcher.InvokeAsync<TMessage, TResponse>()         │
└────────────────────┬───────────────────────────────────┘
                     │
                     ↓
           ┌─────────────────────┐
           │  Resolve Receptor   │ ← DI Container
           │  IReceptor<T, R>    │
           └──────────┬──────────┘
                      │
                      ↓
         ┌────────────────────────┐
         │  Pipeline Behaviors    │ ← IPipelineBehavior<T, R>
         │  (Logging, Validation) │
         └──────────┬─────────────┘
                    │
                    ↓
    ┌───────────────────────────────────┐
    │  receptor.HandleAsync(message)    │ ← Your Custom Receptor
    │                                   │
    │  Lifecycle:                       │
    │  1. Constructor (DI)              │
    │  2. HandleAsync (business logic)  │
    │  3. Dispose (if IAsyncDisposable) │
    └───────────────┬───────────────────┘
                    │
                    ↓
           ┌────────────────┐
           │  Return TResponse │
           └────────────────┘
```

### Custom Receptor Base Class Pattern

```
┌────────────────────────────────────────────────┐
│  ReceptorBase<TMessage, TResponse>             │
│                                                │
│  + Constructor(IServiceProvider)               │
│  + abstract ValidateAsync(message)             │
│  + abstract ExecuteAsync(message)              │
│  + LogInformation(message)                     │
│  + GetService<T>()                             │
│  + HandleAsync(message) [sealed]               │
│    ├─ ValidateAsync(message)                   │
│    ├─ ExecuteAsync(message)                    │
│    └─ Log result                               │
└────────────────────────────────────────────────┘
                    ▲
                    │ Inherits
                    │
    ┌───────────────┴──────────────┐
    │  CreateOrderReceptor          │
    │                               │
    │  + ValidateAsync(message)     │ ← Override
    │  + ExecuteAsync(message)      │ ← Override
    └───────────────────────────────┘
```

---

## Custom Base Classes

### Pattern 1: Base Class with Shared Logic

**Use Case**: Multiple receptors sharing common validation, logging, or setup logic.

```csharp
using Whizbang.Core;

/// <summary>
/// Base class for receptors with shared validation and logging.
/// </summary>
public abstract class ReceptorBase<TMessage, TResponse> : IReceptor<TMessage, TResponse> {
  protected readonly ILogger<ReceptorBase<TMessage, TResponse>> Logger;
  protected readonly IServiceProvider Services;

  protected ReceptorBase(
    ILogger<ReceptorBase<TMessage, TResponse>> logger,
    IServiceProvider services
  ) {
    Logger = logger;
    Services = services;
  }

  /// <summary>
  /// Template method pattern: validates, executes, logs.
  /// </summary>
  public async ValueTask<TResponse> HandleAsync(
    TMessage message,
    CancellationToken ct = default
  ) {
    Logger.LogInformation(
      "Handling {MessageType}",
      typeof(TMessage).Name
    );

    // 1. Validate (can be overridden)
    await ValidateAsync(message, ct);

    // 2. Execute business logic (must be implemented)
    var response = await ExecuteAsync(message, ct);

    // 3. Log result
    Logger.LogInformation(
      "Handled {MessageType} successfully",
      typeof(TMessage).Name
    );

    return response;
  }

  /// <summary>
  /// Override to add message-specific validation.
  /// Default: no validation.
  /// </summary>
  protected virtual ValueTask ValidateAsync(
    TMessage message,
    CancellationToken ct
  ) {
    return ValueTask.CompletedTask;
  }

  /// <summary>
  /// Implement business logic here.
  /// </summary>
  protected abstract ValueTask<TResponse> ExecuteAsync(
    TMessage message,
    CancellationToken ct
  );

  /// <summary>
  /// Helper: Resolve service from DI container.
  /// </summary>
  protected T GetService<T>() where T : notnull {
    return Services.GetRequiredService<T>();
  }
}
```

**Usage**:
```csharp
public record CreateOrder(Guid CustomerId, OrderLineItem[] Items);
public record OrderCreated(Guid OrderId, Guid CustomerId, decimal Total);

public class CreateOrderReceptor : ReceptorBase<CreateOrder, OrderCreated> {
  private readonly IDbConnectionFactory _db;

  public CreateOrderReceptor(
    ILogger<ReceptorBase<CreateOrder, OrderCreated>> logger,
    IServiceProvider services,
    IDbConnectionFactory db
  ) : base(logger, services) {
    _db = db;
  }

  // Override: Add validation logic
  protected override ValueTask ValidateAsync(
    CreateOrder message,
    CancellationToken ct
  ) {
    if (message.Items.Length == 0) {
      throw new ValidationException("Order must contain at least one item");
    }

    if (message.Items.Any(i => i.Quantity <= 0)) {
      throw new ValidationException("All items must have quantity > 0");
    }

    return ValueTask.CompletedTask;
  }

  // Implement: Business logic
  protected override async ValueTask<OrderCreated> ExecuteAsync(
    CreateOrder message,
    CancellationToken ct
  ) {
    var orderId = Guid.CreateVersion7();
    var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "INSERT INTO orders (order_id, customer_id, total) VALUES (@OrderId, @CustomerId, @Total)",
      new { OrderId = orderId, message.CustomerId, Total = total },
      ct
    );

    return new OrderCreated(orderId, message.CustomerId, total);
  }
}
```

**Benefits**:
- **DRY**: Shared validation, logging, setup logic
- **Template Method Pattern**: Enforces consistent execution flow
- **Easy Testing**: Test base class once, focus on business logic in subclasses

---

### Pattern 2: Transactional Receptor Base

**Use Case**: Automatically wrap HandleAsync in a database transaction.

```csharp
using Whizbang.Core;
using System.Data;

public abstract class TransactionalReceptor<TMessage, TResponse> : IReceptor<TMessage, TResponse> {
  private readonly IDbConnectionFactory _db;
  protected readonly ILogger Logger;

  protected TransactionalReceptor(
    IDbConnectionFactory db,
    ILogger logger
  ) {
    _db = db;
    Logger = logger;
  }

  public async ValueTask<TResponse> HandleAsync(
    TMessage message,
    CancellationToken ct = default
  ) {
    await using var conn = _db.CreateConnection();
    await conn.OpenAsync(ct);

    await using var tx = await conn.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      ct
    );

    try {
      // Execute business logic within transaction
      var response = await ExecuteAsync(message, conn, tx, ct);

      // Commit on success
      await tx.CommitAsync(ct);

      Logger.LogInformation(
        "Transaction committed for {MessageType}",
        typeof(TMessage).Name
      );

      return response;

    } catch {
      // Rollback on failure
      await tx.RollbackAsync(ct);

      Logger.LogWarning(
        "Transaction rolled back for {MessageType}",
        typeof(TMessage).Name
      );

      throw;
    }
  }

  /// <summary>
  /// Execute business logic within transaction.
  /// </summary>
  protected abstract ValueTask<TResponse> ExecuteAsync(
    TMessage message,
    IDbConnection connection,
    IDbTransaction transaction,
    CancellationToken ct
  );
}
```

**Usage**:
```csharp
public record TransferFunds(Guid FromAccountId, Guid ToAccountId, decimal Amount);
public record FundsTransferred(Guid TransactionId, DateTimeOffset CompletedAt);

public class TransferFundsReceptor : TransactionalReceptor<TransferFunds, FundsTransferred> {
  public TransferFundsReceptor(
    IDbConnectionFactory db,
    ILogger<TransferFundsReceptor> logger
  ) : base(db, logger) { }

  protected override async ValueTask<FundsTransferred> ExecuteAsync(
    TransferFunds message,
    IDbConnection conn,
    IDbTransaction tx,
    CancellationToken ct
  ) {
    // Both operations in same transaction
    await conn.ExecuteAsync(
      "UPDATE accounts SET balance = balance - @Amount WHERE account_id = @AccountId",
      new { message.FromAccountId, message.Amount },
      transaction: tx,
      cancellationToken: ct
    );

    await conn.ExecuteAsync(
      "UPDATE accounts SET balance = balance + @Amount WHERE account_id = @AccountId",
      new { message.ToAccountId, message.Amount },
      transaction: tx,
      cancellationToken: ct
    );

    var transactionId = Guid.CreateVersion7();
    return new FundsTransferred(transactionId, DateTimeOffset.UtcNow);
  }
}
```

**Benefits**:
- **Atomic Operations**: All-or-nothing guarantees
- **Automatic Rollback**: No manual transaction management
- **Consistent Pattern**: Same transaction handling across receptors

---

### Pattern 3: Multi-Tenant Receptor Base

**Use Case**: Automatically resolve tenant context for all receptors.

```csharp
using Whizbang.Core;

public interface ITenantContext {
  Guid TenantId { get; }
  string TenantName { get; }
}

public abstract class TenantReceptor<TMessage, TResponse> : IReceptor<TMessage, TResponse> {
  protected readonly ITenantContext Tenant;
  protected readonly ILogger Logger;

  protected TenantReceptor(
    ITenantContext tenant,
    ILogger logger
  ) {
    Tenant = tenant;
    Logger = logger;
  }

  public async ValueTask<TResponse> HandleAsync(
    TMessage message,
    CancellationToken ct = default
  ) {
    Logger.LogInformation(
      "Processing {MessageType} for tenant {TenantId}",
      typeof(TMessage).Name,
      Tenant.TenantId
    );

    // Validate tenant access
    await ValidateTenantAccessAsync(message, ct);

    // Execute with tenant context
    var response = await ExecuteAsync(message, ct);

    return response;
  }

  /// <summary>
  /// Override to validate tenant-specific access rules.
  /// Default: allows all access.
  /// </summary>
  protected virtual ValueTask ValidateTenantAccessAsync(
    TMessage message,
    CancellationToken ct
  ) {
    return ValueTask.CompletedTask;
  }

  /// <summary>
  /// Execute business logic with tenant context.
  /// </summary>
  protected abstract ValueTask<TResponse> ExecuteAsync(
    TMessage message,
    CancellationToken ct
  );
}
```

**Usage**:
```csharp
public record CreateProduct(string Name, decimal Price);
public record ProductCreated(Guid ProductId, Guid TenantId);

public class CreateProductReceptor : TenantReceptor<CreateProduct, ProductCreated> {
  private readonly IDbConnectionFactory _db;

  public CreateProductReceptor(
    ITenantContext tenant,
    ILogger<CreateProductReceptor> logger,
    IDbConnectionFactory db
  ) : base(tenant, logger) {
    _db = db;
  }

  protected override async ValueTask<ProductCreated> ExecuteAsync(
    CreateProduct message,
    CancellationToken ct
  ) {
    var productId = Guid.CreateVersion7();

    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "INSERT INTO products (product_id, tenant_id, name, price) VALUES (@ProductId, @TenantId, @Name, @Price)",
      new {
        ProductId = productId,
        TenantId = Tenant.TenantId,  // ← Automatic tenant isolation
        message.Name,
        message.Price
      },
      ct
    );

    return new ProductCreated(productId, Tenant.TenantId);
  }
}
```

**Benefits**:
- **Automatic Tenant Isolation**: No manual tenant filtering
- **Tenant-Aware Logging**: All logs include tenant context
- **Security by Default**: Tenant validation enforced

---

## Streaming Receptors

### Pattern 4: IAsyncEnumerable Streaming

**Use Case**: Stream large result sets without loading everything into memory.

```csharp
using Whizbang.Core;

/// <summary>
/// Streaming receptor for paginated/large results.
/// </summary>
public interface IStreamingReceptor<in TMessage, out TResponse> {
  /// <summary>
  /// Streams results as they become available.
  /// </summary>
  IAsyncEnumerable<TResponse> StreamAsync(
    TMessage message,
    CancellationToken ct = default
  );
}
```

**Implementation**:
```csharp
public record GetOrderHistory(Guid CustomerId);
public record OrderSummary(Guid OrderId, decimal Total, DateTimeOffset CreatedAt);

public class GetOrderHistoryReceptor : IStreamingReceptor<GetOrderHistory, OrderSummary> {
  private readonly IDbConnectionFactory _db;
  private readonly ILogger<GetOrderHistoryReceptor> _logger;

  public GetOrderHistoryReceptor(
    IDbConnectionFactory db,
    ILogger<GetOrderHistoryReceptor> logger
  ) {
    _db = db;
    _logger = logger;
  }

  public async IAsyncEnumerable<OrderSummary> StreamAsync(
    GetOrderHistory query,
    [EnumeratorCancellation] CancellationToken ct = default
  ) {
    await using var conn = _db.CreateConnection();

    // Stream results without loading all into memory
    await using var reader = await conn.ExecuteReaderAsync(
      "SELECT order_id, total, created_at FROM orders WHERE customer_id = @CustomerId ORDER BY created_at DESC",
      new { query.CustomerId },
      ct
    );

    while (await reader.ReadAsync(ct)) {
      yield return new OrderSummary(
        OrderId: reader.GetGuid(0),
        Total: reader.GetDecimal(1),
        CreatedAt: reader.GetDateTime(2)
      );
    }

    _logger.LogInformation(
      "Streamed order history for customer {CustomerId}",
      query.CustomerId
    );
  }
}
```

**Usage**:
```csharp
public class OrderHistoryController : ControllerBase {
  private readonly GetOrderHistoryReceptor _receptor;

  [HttpGet("orders/history/{customerId}")]
  public async IAsyncEnumerable<OrderSummary> GetOrderHistory(
    Guid customerId,
    [EnumeratorCancellation] CancellationToken ct
  ) {
    var query = new GetOrderHistory(customerId);

    await foreach (var order in _receptor.StreamAsync(query, ct)) {
      yield return order;  // Stream to client
    }
  }
}
```

**Benefits**:
- **Memory Efficient**: No buffering of entire result set
- **Responsive**: First results arrive immediately
- **Cancellable**: Stop streaming mid-flight

---

## Lifecycle Management

### Pattern 5: IAsyncDisposable Receptor

**Use Case**: Receptor manages expensive resources (connections, file handles).

```csharp
using Whizbang.Core;

public record ImportCsv(string FilePath);
public record CsvImported(int RowsImported);

public class ImportCsvReceptor : IReceptor<ImportCsv, CsvImported>, IAsyncDisposable {
  private readonly ILogger<ImportCsvReceptor> _logger;
  private FileStream? _fileStream;
  private StreamReader? _reader;

  public ImportCsvReceptor(ILogger<ImportCsvReceptor> logger) {
    _logger = logger;
  }

  public async ValueTask<CsvImported> HandleAsync(
    ImportCsv message,
    CancellationToken ct = default
  ) {
    // Open file
    _fileStream = File.OpenRead(message.FilePath);
    _reader = new StreamReader(_fileStream);

    int rowsImported = 0;

    // Skip header
    await _reader.ReadLineAsync(ct);

    // Process rows
    while (!_reader.EndOfStream) {
      var line = await _reader.ReadLineAsync(ct);
      if (string.IsNullOrWhiteSpace(line)) continue;

      // Process row...
      rowsImported++;
    }

    _logger.LogInformation(
      "Imported {RowCount} rows from {FilePath}",
      rowsImported,
      message.FilePath
    );

    return new CsvImported(rowsImported);
  }

  // Automatic cleanup by dispatcher
  public async ValueTask DisposeAsync() {
    if (_reader is not null) {
      await _reader.DisposeAsync();
    }

    if (_fileStream is not null) {
      await _fileStream.DisposeAsync();
    }

    _logger.LogDebug("Disposed ImportCsvReceptor resources");
  }
}
```

**Registration**:
```csharp
// Transient lifetime ensures new instance per invocation
builder.Services.AddTransient<IReceptor<ImportCsv, CsvImported>, ImportCsvReceptor>();
```

**Benefits**:
- **Automatic Cleanup**: Dispatcher calls DisposeAsync after HandleAsync
- **Exception Safe**: Resources disposed even if HandleAsync throws
- **Clear Pattern**: Standard .NET async disposal

---

## Performance Optimization

### Pattern 6: Zero-Allocation Void Receptor

**Use Case**: High-throughput event processing with no response needed.

```csharp
using Whizbang.Core;

public record OrderShipped(Guid OrderId, string TrackingNumber);

/// <summary>
/// Zero-allocation receptor for void (no response) operations.
/// </summary>
public class OrderShippedReceptor : IReceptor<OrderShipped> {
  private readonly ILogger<OrderShippedReceptor> _logger;

  public OrderShippedReceptor(ILogger<OrderShippedReceptor> logger) {
    _logger = logger;
  }

  public ValueTask HandleAsync(
    OrderShipped message,
    CancellationToken ct = default
  ) {
    // Synchronous execution - return ValueTask.CompletedTask (zero allocation)
    _logger.LogInformation(
      "Order {OrderId} shipped with tracking {TrackingNumber}",
      message.OrderId,
      message.TrackingNumber
    );

    // If async work needed:
    // return new ValueTask(AsyncWork(message, ct));

    return ValueTask.CompletedTask;  // ← Zero allocation!
  }
}
```

**Performance**:
- **Zero Allocations**: `ValueTask.CompletedTask` is cached
- **Synchronous Path**: No async state machine overhead
- **High Throughput**: Ideal for 100K+ msg/sec scenarios

---

### Pattern 7: Pooled Resources

**Use Case**: Reuse expensive objects across receptor invocations.

```csharp
using Whizbang.Core;
using System.Buffers;

public record ProcessLargeFile(string FilePath);
public record FileProcessed(int BytesProcessed);

public class ProcessLargeFileReceptor : IReceptor<ProcessLargeFile, FileProcessed> {
  private readonly ILogger<ProcessLargeFileReceptor> _logger;
  private readonly ArrayPool<byte> _bufferPool;

  public ProcessLargeFileReceptor(ILogger<ProcessLargeFileReceptor> logger) {
    _logger = logger;
    _bufferPool = ArrayPool<byte>.Shared;
  }

  public async ValueTask<FileProcessed> HandleAsync(
    ProcessLargeFile message,
    CancellationToken ct = default
  ) {
    // Rent buffer from pool (no allocation)
    byte[] buffer = _bufferPool.Rent(8192);

    try {
      await using var fileStream = File.OpenRead(message.FilePath);
      int totalBytesRead = 0;

      int bytesRead;
      while ((bytesRead = await fileStream.ReadAsync(buffer, ct)) > 0) {
        // Process buffer...
        totalBytesRead += bytesRead;
      }

      _logger.LogInformation(
        "Processed {Bytes} bytes from {FilePath}",
        totalBytesRead,
        message.FilePath
      );

      return new FileProcessed(totalBytesRead);

    } finally {
      // Return buffer to pool
      _bufferPool.Return(buffer);
    }
  }
}
```

**Benefits**:
- **Reduced GC Pressure**: No repeated allocations
- **Better Performance**: ~10x faster than repeated allocations
- **Industry Standard**: `ArrayPool<T>` used throughout .NET

---

## Advanced Patterns

### Pattern 8: Resilient Receptor (Retry + Circuit Breaker)

**Use Case**: Automatically retry transient failures.

```csharp
using Whizbang.Core;
using Polly;
using Polly.CircuitBreaker;

public abstract class ResilientReceptor<TMessage, TResponse> : IReceptor<TMessage, TResponse> {
  protected readonly ILogger Logger;
  private readonly ResiliencePipeline _pipeline;

  protected ResilientReceptor(ILogger logger) {
    Logger = logger;

    // Configure retry + circuit breaker
    _pipeline = new ResiliencePipelineBuilder()
      .AddRetry(new RetryStrategyOptions {
        MaxRetryAttempts = 3,
        Delay = TimeSpan.FromSeconds(1),
        BackoffType = DelayBackoffType.Exponential,
        OnRetry = args => {
          Logger.LogWarning(
            "Retry attempt {Attempt} for {MessageType}",
            args.AttemptNumber,
            typeof(TMessage).Name
          );
          return ValueTask.CompletedTask;
        }
      })
      .AddCircuitBreaker(new CircuitBreakerStrategyOptions {
        FailureRatio = 0.5,
        MinimumThroughput = 10,
        SamplingDuration = TimeSpan.FromSeconds(30),
        BreakDuration = TimeSpan.FromSeconds(60),
        OnOpened = args => {
          Logger.LogError("Circuit breaker opened for {MessageType}", typeof(TMessage).Name);
          return ValueTask.CompletedTask;
        }
      })
      .Build();
  }

  public async ValueTask<TResponse> HandleAsync(
    TMessage message,
    CancellationToken ct = default
  ) {
    // Execute with resilience pipeline
    return await _pipeline.ExecuteAsync(
      async ct => await ExecuteAsync(message, ct),
      ct
    );
  }

  /// <summary>
  /// Implement business logic here - retries/circuit breaker applied automatically.
  /// </summary>
  protected abstract ValueTask<TResponse> ExecuteAsync(
    TMessage message,
    CancellationToken ct
  );
}
```

**Usage**:
```csharp
public record CallExternalApi(string Endpoint);
public record ApiResponse(string Data);

public class CallExternalApiReceptor : ResilientReceptor<CallExternalApi, ApiResponse> {
  private readonly HttpClient _http;

  public CallExternalApiReceptor(
    ILogger<CallExternalApiReceptor> logger,
    HttpClient http
  ) : base(logger) {
    _http = http;
  }

  protected override async ValueTask<ApiResponse> ExecuteAsync(
    CallExternalApi message,
    CancellationToken ct
  ) {
    // Automatically retried on transient failures
    var response = await _http.GetStringAsync(message.Endpoint, ct);
    return new ApiResponse(response);
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Use base classes for shared logic** across multiple receptors
- ✅ **Implement IAsyncDisposable** for resource cleanup
- ✅ **Use IAsyncEnumerable** for streaming large result sets
- ✅ **Pool expensive resources** (buffers, connections)
- ✅ **Return ValueTask.CompletedTask** for synchronous void receptors
- ✅ **Add resilience patterns** (retry, circuit breaker) for external calls
- ✅ **Test base classes independently** from concrete implementations

### DON'T ❌

- ❌ Add instance state (except injected dependencies)
- ❌ Use singleton lifetime for receptors with scoped dependencies
- ❌ Create deep inheritance hierarchies (max 2 levels)
- ❌ Mix business logic with framework concerns (use pipeline behaviors)
- ❌ Block async operations with `.Result` or `.Wait()`
- ❌ Forget to pass CancellationToken through call chain

---

## Testing Custom Receptors

### Testing Base Classes

```csharp
public class ReceptorBaseTests {
  [Test]
  public async Task HandleAsync_CallsValidateAndExecuteAsync() {
    // Arrange
    var logger = new NullLogger<ReceptorBase<TestMessage, TestResponse>>();
    var services = new ServiceCollection().BuildServiceProvider();

    var receptor = new TestReceptor(logger, services);
    var message = new TestMessage();

    // Act
    var response = await receptor.HandleAsync(message);

    // Assert
    await Assert.That(receptor.ValidateCalled).IsTrue();
    await Assert.That(receptor.ExecuteCalled).IsTrue();
    await Assert.That(response).IsNotNull();
  }
}

// Test receptor exposing internal state for testing
internal class TestReceptor : ReceptorBase<TestMessage, TestResponse> {
  public bool ValidateCalled { get; private set; }
  public bool ExecuteCalled { get; private set; }

  public TestReceptor(
    ILogger<ReceptorBase<TestMessage, TestResponse>> logger,
    IServiceProvider services
  ) : base(logger, services) { }

  protected override ValueTask ValidateAsync(TestMessage message, CancellationToken ct) {
    ValidateCalled = true;
    return ValueTask.CompletedTask;
  }

  protected override ValueTask<TestResponse> ExecuteAsync(TestMessage message, CancellationToken ct) {
    ExecuteCalled = true;
    return ValueTask.FromResult(new TestResponse());
  }
}
```

### Testing Streaming Receptors

```csharp
public class StreamingReceptorTests {
  [Test]
  public async Task StreamAsync_YieldsAllResultsAsync() {
    // Arrange
    var db = CreateMockDb();  // Returns 3 test orders
    var logger = new NullLogger<GetOrderHistoryReceptor>();
    var receptor = new GetOrderHistoryReceptor(db, logger);

    var query = new GetOrderHistory(CustomerId: Guid.NewGuid());

    // Act
    var results = new List<OrderSummary>();
    await foreach (var item in receptor.StreamAsync(query)) {
      results.Add(item);
    }

    // Assert
    await Assert.That(results).HasCount().EqualTo(3);
  }

  [Test]
  public async Task StreamAsync_SupportsEarlyCancellationAsync() {
    // Arrange
    var db = CreateMockDb();  // Returns 100 orders
    var logger = new NullLogger<GetOrderHistoryReceptor>();
    var receptor = new GetOrderHistoryReceptor(db, logger);

    var query = new GetOrderHistory(CustomerId: Guid.NewGuid());
    var cts = new CancellationTokenSource();

    // Act - cancel after first item
    var count = 0;
    await foreach (var item in receptor.StreamAsync(query, cts.Token)) {
      count++;
      if (count == 1) {
        cts.Cancel();
      }
    }

    // Assert - only 1 item processed
    await Assert.That(count).IsEqualTo(1);
  }
}
```

---

## Further Reading

**Core Concepts**:
- [Receptors Guide](../core-concepts/receptors.md) - Basic receptor usage
- [Dispatcher](../core-concepts/dispatcher.md) - Invoking receptors
- [Pipeline Behaviors](hooks-and-middleware.md) - Cross-cutting concerns

**Extensibility**:
- [Custom Perspectives](custom-perspectives.md) - Custom event listeners
- [Custom Transports](custom-transports.md) - Custom messaging implementations

**Advanced**:
- [Performance Tuning](../advanced/performance-tuning.md) - Optimization strategies
- [Testing Receptors](../advanced/testing-receptors.md) - Comprehensive testing guide

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
