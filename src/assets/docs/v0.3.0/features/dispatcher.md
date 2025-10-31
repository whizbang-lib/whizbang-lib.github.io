---
title: Saga Orchestration & Workflows
version: 0.3.0
category: Features
order: 6
evolves-from: v0.2.0/enhancements/dispatcher.md
evolves-to: v0.5.0/production/dispatcher.md
description: Multi-step workflow orchestration with sagas, compensation, and process management
tags: dispatcher, saga, orchestration, workflow, compensation, state-machine, v0.3.0
---

# Saga Orchestration & Workflows

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Status](https://img.shields.io/badge/status-feature-orange)
![Next Update](https://img.shields.io/badge/next-v0.5.0-yellow)

## Version History

:::updated
**Enhanced in v0.3.0**: 
- Saga pattern implementation
- Multi-step workflow orchestration
- Automatic compensation and rollback
- Process state management
- Activity monitoring and visualization
:::

:::planned
**Coming in v0.5.0**: 
- Distributed saga coordination
- Multi-region orchestration
- Workflow versioning and migration

[See production features →](../../v0.5.0/production/dispatcher.md)
:::

## Saga Implementation

### Saga Definition

:::new
Define multi-step business processes with compensation:
:::

```csharp
public interface ISaga<TCommand> {
    Task<SagaResult> Execute(TCommand command, ISagaContext context);
}

public abstract class Saga<TCommand> : ISaga<TCommand> {
    private readonly List<ISagaStep> _steps = new();
    private readonly ISagaStateStore _stateStore;
    
    protected void AddStep<TStepCommand, TStepResult>(
        Func<TStepCommand, Task<TStepResult>> action,
        Func<TStepResult, Task> compensate = null) {
        
        _steps.Add(new SagaStep<TStepCommand, TStepResult>(action, compensate));
    }
    
    public async Task<SagaResult> Execute(TCommand command, ISagaContext context) {
        var sagaId = Guid.NewGuid();
        var state = new SagaState(sagaId, typeof(TCommand).Name);
        
        try {
            // Execute each step
            foreach (var step in _steps) {
                state.CurrentStep = step.Name;
                await _stateStore.SaveState(state);
                
                var stepResult = await ExecuteStep(step, context);
                state.CompletedSteps.Add(new CompletedStep(step.Name, stepResult));
            }
            
            state.Status = SagaStatus.Completed;
            await _stateStore.SaveState(state);
            
            return new SagaResult { Success = true, SagaId = sagaId };
        }
        catch (Exception ex) {
            // Compensate in reverse order
            await Compensate(state, ex);
            
            state.Status = SagaStatus.Compensated;
            await _stateStore.SaveState(state);
            
            return new SagaResult { 
                Success = false, 
                SagaId = sagaId,
                Error = ex.Message 
            };
        }
    }
    
    private async Task Compensate(SagaState state, Exception error) {
        // Execute compensation for completed steps in reverse
        foreach (var step in state.CompletedSteps.Reverse()) {
            try {
                await step.Compensate();
                state.CompensatedSteps.Add(step.Name);
            }
            catch (Exception compensationError) {
                _logger.LogError(compensationError, 
                    "Compensation failed for step {Step}", step.Name);
                state.CompensationErrors.Add(new CompensationError(
                    step.Name, compensationError.Message));
            }
        }
    }
}
```

### Order Processing Saga

:::new
Example saga for complex order processing:
:::

```csharp
[WhizbangSaga]
public class OrderProcessingSaga : Saga<CreateOrder> {
    private readonly IDispatcher _dispatcher;
    private readonly IInventoryService _inventory;
    private readonly IPaymentService _payment;
    private readonly IShippingService _shipping;
    
    public OrderProcessingSaga(
        IDispatcher dispatcher,
        IInventoryService inventory,
        IPaymentService payment,
        IShippingService shipping) {
        
        _dispatcher = dispatcher;
        _inventory = inventory;
        _payment = payment;
        _shipping = shipping;
        
        DefineSteps();
    }
    
    private void DefineSteps() {
        // Step 1: Reserve inventory
        AddStep<ReserveInventory, InventoryReservation>(
            action: async cmd => {
                var reservation = await _inventory.Reserve(cmd.Items);
                if (!reservation.Success) {
                    throw new InsufficientInventoryException();
                }
                return reservation;
            },
            compensate: async reservation => {
                await _inventory.Release(reservation.ReservationId);
            }
        );
        
        // Step 2: Process payment
        AddStep<ProcessPayment, PaymentConfirmation>(
            action: async cmd => {
                var payment = await _payment.Charge(cmd.CustomerId, cmd.Amount);
                if (!payment.Success) {
                    throw new PaymentFailedException(payment.Reason);
                }
                return payment;
            },
            compensate: async payment => {
                await _payment.Refund(payment.TransactionId);
            }
        );
        
        // Step 3: Create shipment
        AddStep<CreateShipment, ShipmentDetails>(
            action: async cmd => {
                var shipment = await _shipping.CreateShipment(cmd.Order);
                return shipment;
            },
            compensate: async shipment => {
                await _shipping.CancelShipment(shipment.ShipmentId);
            }
        );
        
        // Step 4: Send confirmation
        AddStep<SendConfirmation, ConfirmationResult>(
            action: async cmd => {
                await _dispatcher.Publish(new OrderConfirmed {
                    OrderId = cmd.OrderId,
                    CustomerId = cmd.CustomerId,
                    ConfirmationNumber = GenerateConfirmationNumber()
                });
                return new ConfirmationResult { Sent = true };
            }
            // No compensation for notification
        );
    }
}
```

## Workflow Orchestration

### Process Manager

:::new
Long-running process management:
:::

```csharp
public interface IProcessManager<TState> where TState : ProcessState {
    Task<ProcessResult> Handle(IMessage message);
    Task<TState> GetState();
    Task Timeout();
}

public class OrderFulfillmentProcess : IProcessManager<OrderFulfillmentState> {
    private readonly OrderFulfillmentState _state;
    private readonly IDispatcher _dispatcher;
    
    public async Task<ProcessResult> Handle(IMessage message) {
        return message switch {
            OrderCreated e => await HandleOrderCreated(e),
            PaymentReceived e => await HandlePaymentReceived(e),
            ItemsShipped e => await HandleItemsShipped(e),
            OrderCancelled e => await HandleOrderCancelled(e),
            _ => ProcessResult.NotHandled
        };
    }
    
    private async Task<ProcessResult> HandleOrderCreated(OrderCreated @event) {
        _state.OrderId = @event.OrderId;
        _state.Status = FulfillmentStatus.WaitingForPayment;
        
        // Set timeout for payment
        await ScheduleTimeout(TimeSpan.FromHours(24));
        
        // Request payment
        await _dispatcher.Send(new RequestPayment {
            OrderId = @event.OrderId,
            Amount = @event.Total
        });
        
        return ProcessResult.Continue;
    }
    
    private async Task<ProcessResult> HandlePaymentReceived(PaymentReceived @event) {
        if (_state.Status != FulfillmentStatus.WaitingForPayment) {
            return ProcessResult.InvalidState;
        }
        
        _state.Status = FulfillmentStatus.PreparingShipment;
        _state.PaymentId = @event.PaymentId;
        
        // Ship items
        await _dispatcher.Send(new ShipOrder {
            OrderId = _state.OrderId,
            ShippingAddress = _state.ShippingAddress
        });
        
        return ProcessResult.Continue;
    }
    
    private async Task<ProcessResult> HandleItemsShipped(ItemsShipped @event) {
        _state.Status = FulfillmentStatus.Completed;
        _state.CompletedAt = DateTimeOffset.UtcNow;
        
        // Notify customer
        await _dispatcher.Publish(new OrderFulfilled {
            OrderId = _state.OrderId,
            TrackingNumber = @event.TrackingNumber
        });
        
        return ProcessResult.Complete;
    }
    
    public async Task Timeout() {
        switch (_state.Status) {
            case FulfillmentStatus.WaitingForPayment:
                // Cancel order due to payment timeout
                await _dispatcher.Send(new CancelOrder {
                    OrderId = _state.OrderId,
                    Reason = "Payment timeout"
                });
                break;
        }
    }
}
```

### State Machine

:::new
Declarative state machine for workflows:
:::

```csharp
[StateMachine("OrderStateMachine")]
public class OrderStateMachine : StateMachine<OrderState> {
    public OrderStateMachine() {
        // Define states
        State(OrderState.New)
            .On<OrderConfirmed>().TransitionTo(OrderState.Confirmed)
            .On<OrderCancelled>().TransitionTo(OrderState.Cancelled);
        
        State(OrderState.Confirmed)
            .OnEntry(async ctx => await SendConfirmationEmail(ctx))
            .On<PaymentReceived>().TransitionTo(OrderState.Paid)
            .On<OrderCancelled>().TransitionTo(OrderState.Cancelled);
        
        State(OrderState.Paid)
            .On<OrderShipped>().TransitionTo(OrderState.Shipped)
            .On<RefundRequested>().TransitionTo(OrderState.Refunding);
        
        State(OrderState.Shipped)
            .On<OrderDelivered>().TransitionTo(OrderState.Delivered)
            .On<ReturnRequested>().TransitionTo(OrderState.Returning);
        
        State(OrderState.Delivered)
            .OnEntry(async ctx => await RequestFeedback(ctx))
            .IsFinal();
        
        State(OrderState.Cancelled)
            .OnEntry(async ctx => await ProcessCancellation(ctx))
            .IsFinal();
        
        // Global handlers
        AnyState()
            .On<OrderError>().TransitionTo(OrderState.Error);
    }
}

// Usage
public class OrderService {
    private readonly IStateMachineEngine _engine;
    
    public async Task ProcessOrder(Guid orderId, IMessage message) {
        var stateMachine = await _engine.Load<OrderStateMachine>(orderId);
        
        var result = await stateMachine.Process(message);
        
        if (result.TransitionOccurred) {
            await _engine.Save(stateMachine);
            
            // Publish state change event
            await _dispatcher.Publish(new OrderStateChanged {
                OrderId = orderId,
                FromState = result.FromState,
                ToState = result.ToState,
                Trigger = message.GetType().Name
            });
        }
    }
}
```

## Compensation Patterns

### Compensating Transactions

```csharp
public interface ICompensatable<TResult> {
    Task<TResult> Execute();
    Task Compensate(TResult result);
}

public class CompensatingTransaction<TResult> : ICompensatable<TResult> {
    private readonly Func<Task<TResult>> _action;
    private readonly Func<TResult, Task> _compensation;
    
    public CompensatingTransaction(
        Func<Task<TResult>> action,
        Func<TResult, Task> compensation) {
        _action = action;
        _compensation = compensation;
    }
    
    public Task<TResult> Execute() => _action();
    public Task Compensate(TResult result) => _compensation(result);
}

// Saga with compensating transactions
public class TransactionalSaga {
    private readonly List<ICompensatable<object>> _transactions = new();
    private readonly Stack<object> _results = new();
    
    public void AddTransaction<T>(ICompensatable<T> transaction) {
        _transactions.Add(new CompensatableWrapper<T>(transaction));
    }
    
    public async Task<bool> Execute() {
        try {
            foreach (var transaction in _transactions) {
                var result = await transaction.Execute();
                _results.Push(result);
            }
            return true;
        }
        catch {
            await Rollback();
            return false;
        }
    }
    
    private async Task Rollback() {
        while (_results.Count > 0) {
            var result = _results.Pop();
            var transaction = _transactions[_results.Count];
            
            try {
                await transaction.Compensate(result);
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Compensation failed");
                // Continue with other compensations
            }
        }
    }
}
```

## Activity Monitoring

### Saga Visualization

```csharp
public class SagaMonitor {
    private readonly ISagaStateStore _stateStore;
    
    public async Task<SagaVisualization> GetVisualization(Guid sagaId) {
        var state = await _stateStore.GetState(sagaId);
        
        return new SagaVisualization {
            SagaId = sagaId,
            Type = state.SagaType,
            Status = state.Status,
            Steps = state.Steps.Select(step => new StepVisualization {
                Name = step.Name,
                Status = GetStepStatus(step, state),
                StartTime = step.StartTime,
                EndTime = step.EndTime,
                Duration = step.EndTime - step.StartTime,
                Error = step.Error
            }),
            Timeline = GenerateTimeline(state),
            Diagram = GenerateMermaidDiagram(state)
        };
    }
    
    private string GenerateMermaidDiagram(SagaState state) {
        var mermaid = new StringBuilder();
        mermaid.AppendLine("graph LR");
        
        foreach (var step in state.Steps) {
            var status = GetStepStatus(step, state);
            var style = status switch {
                StepStatus.Completed => "fill:#4CAF50",
                StepStatus.Failed => "fill:#F44336",
                StepStatus.Compensated => "fill:#FF9800",
                StepStatus.Pending => "fill:#9E9E9E",
                _ => ""
            };
            
            mermaid.AppendLine($"    {step.Name}[{step.Name}]");
            if (!string.IsNullOrEmpty(style)) {
                mermaid.AppendLine($"    style {step.Name} {style}");
            }
        }
        
        return mermaid.ToString();
    }
}
```

## Testing Sagas

```csharp
[Test]
public class SagaTests {
    [Test]
    public async Task Saga_ShouldCompensateOnFailure() {
        // Arrange
        var saga = new TestSaga();
        var context = new SagaContext();
        
        // Force failure in third step
        saga.ConfigureStep(3, shouldFail: true);
        
        // Act
        var result = await saga.Execute(new TestCommand(), context);
        
        // Assert
        Assert.False(result.Success);
        Assert.That(saga.CompensatedSteps, Is.EqualTo(new[] { "Step2", "Step1" }));
    }
    
    [Test]
    public async Task ProcessManager_ShouldHandleTimeout() {
        // Test timeout behavior
    }
}
```

## Performance Characteristics

| Operation | Target | Notes |
|-----------|--------|-------|
| Saga step execution | < 10ms | Per step overhead |
| State persistence | < 5ms | Async write |
| Compensation | < 20ms | Per step |
| Process manager dispatch | < 2ms | Message routing |

## Migration from v0.2.0

### Adding Saga Support

```csharp
// v0.2.0 - Pipeline dispatcher
services.AddWhizbangDispatcher(options => {
    options.Pipeline(p => p.Use<LoggingMiddleware>());
});

// v0.3.0 - Add saga orchestration
services.AddWhizbangDispatcher(options => {
    options.Pipeline(p => p.Use<LoggingMiddleware>());
    
    options.EnableSagas(saga => {
        saga.UseStateStore<SqlSagaStateStore>();
        saga.RegisterSaga<OrderProcessingSaga>();
        saga.RegisterProcessManager<OrderFulfillmentProcess>();
    });
});
```

## Related Documentation

- [v0.2.0 Pipeline](../../v0.2.0/enhancements/dispatcher.md) - Middleware support
- [v0.5.0 Production](../../v0.5.0/production/dispatcher.md) - Distributed orchestration
- [Saga Patterns](../guides/saga-patterns.md) - Common saga implementations
- [Workflow Design](../guides/workflow-design.md) - Best practices