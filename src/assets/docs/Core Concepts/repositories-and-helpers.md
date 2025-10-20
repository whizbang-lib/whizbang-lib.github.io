---
title: Repositories and CQRS Helpers
category: Core Concepts
order: 2
tags: repositories, cqrs, helpers, patterns
---

# Repositories and CQRS Helpers

Whizbang provides rich framework support for implementing CQRS patterns through repositories, query handlers, and helper classes that separate concerns across the write and read sides of your application.

## Repository Patterns

### Write-Side Repository (Aggregates)

The **IRepository<TAggregate>** interface handles loading and saving event-sourced aggregates:

```csharp{
title: "Aggregate Repository Interface"
description: "Core interface for aggregate persistence"
framework: "NET8"
category: "Repositories"
difficulty: "INTERMEDIATE"
tags: ["Repositories", "Aggregates", "Event Sourcing"]
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;

namespace Whizbang.EventSourcing;

public interface IRepository<TAggregate> where TAggregate : Aggregate {
    /// <summary>
    /// Loads an aggregate by replaying its event stream.
    /// </summary>
    Task<TAggregate?> FindAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Loads an aggregate, throwing if not found.
    /// </summary>
    Task<TAggregate> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Saves uncommitted events from the aggregate to the event store.
    /// </summary>
    Task SaveAsync(TAggregate aggregate, CancellationToken ct = default);

    /// <summary>
    /// Loads aggregate as of a specific version (point-in-time query).
    /// </summary>
    Task<TAggregate?> GetAsOfAsync(Guid id, long version, CancellationToken ct = default);

    /// <summary>
    /// Loads aggregate as of a specific timestamp (time-travel debugging).
    /// </summary>
    Task<TAggregate?> GetAsOfAsync(Guid id, DateTimeOffset timestamp, CancellationToken ct = default);
}
```

**Usage**:

```csharp{
title: "Using Aggregate Repository"
description: "Load, modify, and save an aggregate"
framework: "NET8"
category: "Repositories"
difficulty: "BEGINNER"
tags: ["Repositories", "Aggregates", "Commands"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

public class PlaceOrderHandler {
    private readonly IRepository<Order> _orderRepository;

    public PlaceOrderHandler(IRepository<Order> orderRepository) {
        _orderRepository = orderRepository;
    }

    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        // Create new aggregate
        var order = new Order(command.CustomerId, command.Items);

        // Save (appends events to stream)
        await _orderRepository.SaveAsync(order);

        return new OrderPlaced(order.Id, command.CustomerId, order.Total);
    }
}
```

### Read-Side Repository (Projections)

The **IProjectionStore<TProjection>** interface handles querying denormalized read models:

```csharp{
title: "Projection Store Interface"
description: "Interface for querying read models"
framework: "NET8"
category: "Repositories"
difficulty: "INTERMEDIATE"
tags: ["Projections", "Queries", "CQRS"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic", "System.Linq.Expressions"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Linq.Expressions;
using System.Threading.Tasks;

namespace Whizbang.Projections;

public interface IProjectionStore<TProjection> where TProjection : class {
    /// <summary>
    /// Gets a projection by ID.
    /// </summary>
    Task<TProjection?> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Queries projections using a predicate.
    /// </summary>
    Task<List<TProjection>> QueryAsync(
        Expression<Func<TProjection, bool>> predicate,
        CancellationToken ct = default
    );

    /// <summary>
    /// Paged query for large result sets.
    /// </summary>
    Task<PagedResult<TProjection>> QueryPagedAsync(
        Expression<Func<TProjection, bool>> predicate,
        int page,
        int pageSize,
        CancellationToken ct = default
    );

    /// <summary>
    /// Inserts or updates a projection.
    /// </summary>
    Task UpsertAsync(Guid id, TProjection projection, CancellationToken ct = default);

    /// <summary>
    /// Updates an existing projection.
    /// </summary>
    Task UpdateAsync(Guid id, Action<TProjection> update, CancellationToken ct = default);

    /// <summary>
    /// Deletes a projection.
    /// </summary>
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
```

**Usage**:

```csharp{
title: "Querying Projection Store"
description: "Query read models for customer orders"
framework: "NET8"
category: "Repositories"
difficulty: "BEGINNER"
tags: ["Projections", "Queries", "CQRS"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic", "Whizbang.Projections"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Whizbang.Projections;

public class OrderQueryService {
    private readonly IProjectionStore<OrderHistoryItem> _store;

    public OrderQueryService(IProjectionStore<OrderHistoryItem> store) {
        _store = store;
    }

    public async Task<List<OrderHistoryItem>> GetCustomerOrdersAsync(Guid customerId) {
        return await _store.QueryAsync(order => order.CustomerId == customerId);
    }

    public async Task<PagedResult<OrderHistoryItem>> GetRecentOrdersAsync(int page, int pageSize) {
        return await _store.QueryPagedAsync(
            order => order.Status != "Cancelled",
            page,
            pageSize
        );
    }
}
```

## CQRS Helper Classes

### Command Bus

The **ICommandBus** sends commands to their handlers:

```csharp{
title: "Command Bus Interface"
description: "Send commands and receive results"
framework: "NET8"
category: "CQRS"
difficulty: "INTERMEDIATE"
tags: ["Commands", "CQRS", "Messaging"]
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;

namespace Whizbang;

public interface ICommandBus {
    /// <summary>
    /// Sends a command and waits for result.
    /// </summary>
    Task<TResult> SendAsync<TResult>(object command, CancellationToken ct = default);

    /// <summary>
    /// Sends a command without waiting for result (fire-and-forget).
    /// </summary>
    Task PublishAsync(object command, CancellationToken ct = default);

    /// <summary>
    /// Sends multiple commands in a batch.
    /// </summary>
    Task PublishBatchAsync(IEnumerable<object> commands, CancellationToken ct = default);
}
```

### Query Bus

The **IQueryBus** executes queries against projections:

```csharp{
title: "Query Bus Interface"
description: "Execute queries and return results"
framework: "NET8"
category: "CQRS"
difficulty: "INTERMEDIATE"
tags: ["Queries", "CQRS", "Projections"]
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;

namespace Whizbang;

public interface IQueryBus {
    /// <summary>
    /// Executes a query and returns result.
    /// </summary>
    Task<TResult> QueryAsync<TResult>(object query, CancellationToken ct = default);
}
```

**Usage**:

```csharp{
title: "Using Query Bus"
description: "Execute queries via query bus"
framework: "NET8"
category: "CQRS"
difficulty: "BEGINNER"
tags: ["Queries", "CQRS"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic", "Whizbang"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Whizbang;

// Define query
public record GetCustomerOrders(Guid CustomerId);

// Define query handler
public class GetCustomerOrdersHandler {
    private readonly IProjectionStore<OrderHistoryItem> _store;

    public GetCustomerOrdersHandler(IProjectionStore<OrderHistoryItem> store) {
        _store = store;
    }

    public async Task<List<OrderHistoryItem>> Handle(GetCustomerOrders query) {
        return await _store.QueryAsync(o => o.CustomerId == query.CustomerId);
    }
}

// Execute query
public class OrderController {
    private readonly IQueryBus _queryBus;

    public OrderController(IQueryBus queryBus) {
        _queryBus = queryBus;
    }

    public async Task<IActionResult> GetOrders(Guid customerId) {
        var orders = await _queryBus.QueryAsync<List<OrderHistoryItem>>(
            new GetCustomerOrders(customerId)
        );
        return Ok(orders);
    }
}
```

### Event Publisher

The **IEventPublisher** publishes domain events to subscribers:

```csharp{
title: "Event Publisher Interface"
description: "Publish events to subscribers"
framework: "NET8"
category: "CQRS"
difficulty: "INTERMEDIATE"
tags: ["Events", "Publishing", "Messaging"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Whizbang;

public interface IEventPublisher {
    /// <summary>
    /// Publishes a single event to all subscribers.
    /// </summary>
    Task PublishAsync(object @event, CancellationToken ct = default);

    /// <summary>
    /// Publishes multiple events in order.
    /// </summary>
    Task PublishBatchAsync(IEnumerable<object> events, CancellationToken ct = default);

    /// <summary>
    /// Publishes event to specific subscribers (filtered).
    /// </summary>
    Task PublishToAsync(object @event, string subscriberFilter, CancellationToken ct = default);
}
```

## Specialized Helpers

### Unit of Work Pattern

For scenarios requiring transactional consistency across multiple aggregates:

```csharp{
title: "Unit of Work Interface"
description: "Transactional boundary for multiple aggregates"
framework: "NET8"
category: "Patterns"
difficulty: "ADVANCED"
tags: ["Unit of Work", "Transactions", "Aggregates"]
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;

namespace Whizbang.EventSourcing;

public interface IUnitOfWork : IDisposable {
    /// <summary>
    /// Gets a repository for an aggregate type.
    /// </summary>
    IRepository<TAggregate> Repository<TAggregate>() where TAggregate : Aggregate;

    /// <summary>
    /// Commits all changes across all aggregates.
    /// </summary>
    Task CommitAsync(CancellationToken ct = default);

    /// <summary>
    /// Rolls back all changes.
    /// </summary>
    Task RollbackAsync(CancellationToken ct = default);
}
```

**Usage** (use sparingly - violates aggregate boundaries):

```csharp{
title: "Using Unit of Work"
description: "Transactional update across multiple aggregates"
framework: "NET8"
category: "Patterns"
difficulty: "ADVANCED"
tags: ["Unit of Work", "Transactions"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.EventSourcing"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.EventSourcing;

public class TransferInventoryHandler {
    private readonly IUnitOfWork _unitOfWork;

    public TransferInventoryHandler(IUnitOfWork unitOfWork) {
        _unitOfWork = unitOfWork;
    }

    public async Task Handle(TransferInventory command) {
        var sourceWarehouse = await _unitOfWork
            .Repository<Warehouse>()
            .GetAsync(command.SourceWarehouseId);

        var destWarehouse = await _unitOfWork
            .Repository<Warehouse>()
            .GetAsync(command.DestinationWarehouseId);

        // Both aggregates modified in same transaction
        sourceWarehouse.RemoveInventory(command.ProductId, command.Quantity);
        destWarehouse.AddInventory(command.ProductId, command.Quantity);

        await _unitOfWork.Repository<Warehouse>().SaveAsync(sourceWarehouse);
        await _unitOfWork.Repository<Warehouse>().SaveAsync(destWarehouse);

        // Atomic commit
        await _unitOfWork.CommitAsync();
    }
}
```

**Warning**: Use sagas instead when possible to maintain aggregate boundaries.

### Specification Pattern

For complex query logic:

```csharp{
title: "Specification Pattern"
description: "Reusable query specifications"
framework: "NET8"
category: "Patterns"
difficulty: "INTERMEDIATE"
tags: ["Specification", "Queries", "Patterns"]
usingStatements: ["System", "System.Linq.Expressions"]
showLineNumbers: true
}
using System;
using System.Linq.Expressions;

namespace Whizbang.Projections;

public interface ISpecification<TProjection> {
    Expression<Func<TProjection, bool>> Predicate { get; }
}

public class ActiveOrdersSpecification : ISpecification<OrderHistoryItem> {
    public Expression<Func<OrderHistoryItem, bool>> Predicate =>
        order => order.Status != "Cancelled" && order.Status != "Delivered";
}

public class CustomerOrdersSpecification : ISpecification<OrderHistoryItem> {
    private readonly Guid _customerId;

    public CustomerOrdersSpecification(Guid customerId) {
        _customerId = customerId;
    }

    public Expression<Func<OrderHistoryItem, bool>> Predicate =>
        order => order.CustomerId == _customerId;
}
```

**Usage**:

```csharp{
title: "Using Specifications"
description: "Compose reusable query specifications"
framework: "NET8"
category: "Patterns"
difficulty: "INTERMEDIATE"
tags: ["Specification", "Queries"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic", "Whizbang.Projections"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Whizbang.Projections;

public class OrderQueryService {
    private readonly IProjectionStore<OrderHistoryItem> _store;

    public OrderQueryService(IProjectionStore<OrderHistoryItem> store) {
        _store = store;
    }

    public async Task<List<OrderHistoryItem>> GetActiveCustomerOrdersAsync(Guid customerId) {
        var spec = new ActiveOrdersSpecification()
            .And(new CustomerOrdersSpecification(customerId));

        return await _store.QueryAsync(spec.Predicate);
    }
}
```

### Projection Builder

Helper for building complex projections:

```csharp{
title: "Projection Builder"
description: "Fluent API for building projections"
framework: "NET8"
category: "Projections"
difficulty: "ADVANCED"
tags: ["Projections", "Builder Pattern"]
usingStatements: ["System", "Whizbang.Projections"]
showLineNumbers: true
}
using System;
using Whizbang.Projections;

public class OrderSummaryProjectionBuilder : ProjectionBuilder<OrderSummary> {
    public OrderSummaryProjectionBuilder() {
        // Subscribe to events
        On<OrderPlaced>(@event => {
            Upsert(@event.OrderId, new OrderSummary {
                OrderId = @event.OrderId,
                CustomerId = @event.CustomerId,
                Total = @event.Total,
                Status = "Placed"
            });
        });

        On<OrderShipped>(@event => {
            Update(@event.OrderId, summary => {
                summary.Status = "Shipped";
                summary.ShippedAt = @event.ShippedAt;
            });
        });

        On<OrderCancelled>(@event => {
            Update(@event.OrderId, summary => summary.Status = "Cancelled");
        });
    }
}
```

## Multi-Tenant Repository Support

All repository interfaces support tenant scoping:

```csharp{
title: "Multi-Tenant Repository"
description: "Tenant-scoped aggregate repository"
framework: "NET8"
category: "Multi-Tenancy"
difficulty: "ADVANCED"
tags: ["Multi-Tenancy", "Repositories", "Security"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.EventSourcing"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.EventSourcing;

public interface ITenantRepository<TAggregate> where TAggregate : Aggregate {
    /// <summary>
    /// Loads aggregate for specific tenant.
    /// </summary>
    Task<TAggregate?> FindAsync(Guid tenantId, Guid aggregateId, CancellationToken ct = default);

    /// <summary>
    /// Saves aggregate with tenant isolation.
    /// Stream ID: "Tenant-{tenantId}-Order-{orderId}"
    /// </summary>
    Task SaveAsync(Guid tenantId, TAggregate aggregate, CancellationToken ct = default);
}

// Usage with tenant context
public class PlaceOrderHandler {
    private readonly ITenantRepository<Order> _repository;
    private readonly ITenantContext _tenantContext;

    public PlaceOrderHandler(ITenantRepository<Order> repository, ITenantContext tenantContext) {
        _repository = repository;
        _tenantContext = tenantContext;
    }

    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        var order = new Order(command.CustomerId, command.Items);

        // Tenant ID from context (claims, header, etc.)
        await _repository.SaveAsync(_tenantContext.TenantId, order);

        return new OrderPlaced(order.Id, command.CustomerId, order.Total);
    }
}
```

## Permission-Scoped Repositories

Repositories can enforce permissions:

```csharp{
title: "Permission-Scoped Repository"
description: "Repository with built-in authorization"
framework: "NET8"
category: "Security"
difficulty: "ADVANCED"
tags: ["Security", "Authorization", "Repositories"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.EventSourcing"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.EventSourcing;

public interface ISecureRepository<TAggregate> where TAggregate : Aggregate {
    /// <summary>
    /// Loads aggregate only if user has read permission.
    /// </summary>
    Task<TAggregate?> FindAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Saves aggregate only if user has write permission.
    /// Throws UnauthorizedAccessException if permission denied.
    /// </summary>
    Task SaveAsync(TAggregate aggregate, CancellationToken ct = default);
}

// Configuration
services.AddWhizbang(options => {
    options.UseRepositories(repos => {
        repos.EnforcePermissions = true;
        repos.RequirePermission<Order>("orders:read", "orders:write");
        repos.RequirePermission<Inventory>("inventory:read", "inventory:write");
    });
});
```

## Next Steps

- [**Testing**](./testing.md) - Test repositories and handlers
- [**Multi-Tenancy**](./multi-tenancy.md) - Deep dive into tenant isolation
- [**Security**](./security.md) - Authorization and authentication patterns
