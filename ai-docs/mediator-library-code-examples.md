# Mediator Library Code Examples - Same Scenario

## Scenario: E-Commerce Order Processing

We'll implement the same use case across all libraries:
1. Create an order
2. Process payment
3. Send confirmation email
4. Handle errors with retry

## Shared Domain Objects

```csharp
// Domain objects used across all examples
public record OrderItem(string ProductId, string ProductName, int Quantity, decimal Price);

public record Order {
    public Guid Id { get; init; }
    public Guid CustomerId { get; init; }
    public List<OrderItem> Items { get; init; }
    public decimal Total { get; init; }
    public string Status { get; init; }
    public DateTime CreatedAt { get; init; }
}

// Commands/Messages
public record CreateOrder(
    Guid CustomerId, 
    List<OrderItem> Items, 
    string CustomerEmail
);

public record OrderCreated(
    Guid OrderId, 
    Guid CustomerId, 
    decimal Total, 
    DateTime CreatedAt
);

public record ProcessPayment(
    Guid OrderId, 
    decimal Amount, 
    string CustomerEmail
);

public record PaymentProcessed(
    Guid OrderId, 
    string TransactionId, 
    DateTime ProcessedAt
);

public record SendOrderConfirmation(
    Guid OrderId, 
    string CustomerEmail, 
    decimal Total
);
```

## 1. MediatR Implementation

```csharp
// Commands with MediatR
public record CreateOrderCommand(
    Guid CustomerId,
    List<OrderItem> Items,
    string CustomerEmail
) : IRequest<OrderCreatedResult>;

public record OrderCreatedResult(
    Guid OrderId,
    decimal Total,
    string Status
);

// Command Handler
public class CreateOrderHandler : IRequestHandler<CreateOrderCommand, OrderCreatedResult> {
    private readonly IOrderRepository _orderRepository;
    private readonly IMediator _mediator;
    
    public CreateOrderHandler(IOrderRepository orderRepository, IMediator mediator) {
        _orderRepository = orderRepository;
        _mediator = mediator;
    }
    
    public async Task<OrderCreatedResult> Handle(
        CreateOrderCommand request, 
        CancellationToken cancellationToken) {
        
        // Create order
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = request.CustomerId,
            Items = request.Items,
            Total = request.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        await _orderRepository.Save(order);
        
        // Publish notification for other handlers
        await _mediator.Publish(new OrderCreatedNotification {
            OrderId = order.Id,
            CustomerId = order.CustomerId,
            Total = order.Total,
            CustomerEmail = request.CustomerEmail
        }, cancellationToken);
        
        return new OrderCreatedResult(order.Id, order.Total, order.Status);
    }
}

// Notification for side effects
public record OrderCreatedNotification(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    string CustomerEmail
) : INotification;

// Payment processing handler
public class ProcessPaymentHandler : INotificationHandler<OrderCreatedNotification> {
    private readonly IPaymentService _paymentService;
    
    public async Task Handle(
        OrderCreatedNotification notification, 
        CancellationToken cancellationToken) {
        
        await _paymentService.ProcessPayment(
            notification.OrderId, 
            notification.Total
        );
    }
}

// Email handler
public class SendConfirmationHandler : INotificationHandler<OrderCreatedNotification> {
    private readonly IEmailService _emailService;
    
    public async Task Handle(
        OrderCreatedNotification notification, 
        CancellationToken cancellationToken) {
        
        await _emailService.SendOrderConfirmation(
            notification.CustomerEmail,
            notification.OrderId,
            notification.Total
        );
    }
}

// Pipeline behavior for retry
public class RetryBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse> 
    where TRequest : IRequest<TResponse> {
    
    public async Task<TResponse> Handle(
        TRequest request, 
        RequestHandlerDelegate<TResponse> next, 
        CancellationToken cancellationToken) {
        
        var retryCount = 3;
        var delay = TimeSpan.FromSeconds(1);
        
        for (int i = 0; i < retryCount; i++) {
            try {
                return await next();
            }
            catch (Exception ex) when (i < retryCount - 1) {
                await Task.Delay(delay, cancellationToken);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);
            }
        }
        
        return await next();
    }
}

// Registration
services.AddMediatR(cfg => {
    cfg.RegisterServicesFromAssembly(typeof(Program).Assembly);
    cfg.AddBehavior<IPipelineBehavior<,>, RetryBehavior<,>>();
});

// Usage
var result = await mediator.Send(new CreateOrderCommand(
    customerId,
    items,
    customerEmail
));
```

## 2. Wolverine Implementation

```csharp
// No interfaces needed - just classes and methods
public static class OrderHandlers {
    // Return type determines what happens next
    public static async Task<(OrderCreated, ProcessPayment, SendOrderConfirmation)> Handle(
        CreateOrder command,
        IOrderRepository repository) {
        
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = command.CustomerId,
            Items = command.Items,
            Total = command.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        await repository.Save(order);
        
        // Return tuple triggers cascading messages
        return (
            new OrderCreated(order.Id, order.CustomerId, order.Total, order.CreatedAt),
            new ProcessPayment(order.Id, order.Total, command.CustomerEmail),
            new SendOrderConfirmation(order.Id, command.CustomerEmail, order.Total)
        );
    }
    
    // Payment handler
    public static async Task<PaymentProcessed> Handle(
        ProcessPayment command,
        IPaymentService paymentService) {
        
        var transactionId = await paymentService.Charge(command.OrderId, command.Amount);
        
        return new PaymentProcessed(
            command.OrderId,
            transactionId,
            DateTime.UtcNow
        );
    }
    
    // Email handler - void means fire and forget
    public static async Task Handle(
        SendOrderConfirmation command,
        IEmailService emailService) {
        
        await emailService.Send(
            command.CustomerEmail,
            "Order Confirmation",
            $"Your order {command.OrderId} for ${command.Total} has been confirmed."
        );
    }
}

// Saga for orchestration
public class OrderSaga : Saga {
    public Guid Id { get; set; }
    public string Status { get; set; }
    public int RetryCount { get; set; }
    
    // Start the saga
    public void Start(OrderCreated @event) {
        Id = @event.OrderId;
        Status = "Created";
    }
    
    // Handle payment
    public void Handle(PaymentProcessed @event) {
        Status = "Paid";
    }
    
    // Handle failure with retry
    public object Handle(PaymentFailed @event) {
        RetryCount++;
        
        if (RetryCount < 3) {
            // Return a message to retry
            return new ProcessPayment(@event.OrderId, @event.Amount, @event.CustomerEmail)
                .DelayedFor(TimeSpan.FromSeconds(Math.Pow(2, RetryCount)));
        }
        
        Status = "Failed";
        return new CancelOrder(@event.OrderId);
    }
}

// Registration with error handling
var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWolverine(opts => {
    opts.Discovery.IncludeAssembly(typeof(Program).Assembly);
    
    // Durability for reliability
    opts.Durability.Mode = DurabilityMode.Solo;
    opts.Durability.UsePostgreSql(connectionString);
    
    // Error handling policies
    opts.Policies.OnException<PaymentException>()
        .RetryWithCooldown(
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(10)
        );
        
    opts.Policies.OnException<EmailException>()
        .MoveToErrorQueue();
});

// Usage
await bus.SendAsync(new CreateOrder(customerId, items, customerEmail));
```

## 3. MassTransit Implementation

```csharp
// Consumer for order creation
public class CreateOrderConsumer : IConsumer<CreateOrder> {
    private readonly IOrderRepository _orderRepository;
    
    public CreateOrderConsumer(IOrderRepository orderRepository) {
        _orderRepository = orderRepository;
    }
    
    public async Task Consume(ConsumeContext<CreateOrder> context) {
        var order = new Order {
            Id = NewId.NextGuid(),
            CustomerId = context.Message.CustomerId,
            Items = context.Message.Items,
            Total = context.Message.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        await _orderRepository.Save(order);
        
        // Publish event for other consumers
        await context.Publish(new OrderCreated(
            order.Id,
            order.CustomerId,
            order.Total,
            order.CreatedAt
        ));
        
        // Send command to specific endpoint
        await context.Send(new ProcessPayment(
            order.Id,
            order.Total,
            context.Message.CustomerEmail
        ));
    }
}

// Payment consumer with retry
public class ProcessPaymentConsumer : IConsumer<ProcessPayment> {
    private readonly IPaymentService _paymentService;
    
    public async Task Consume(ConsumeContext<ProcessPayment> context) {
        try {
            var transactionId = await _paymentService.Charge(
                context.Message.OrderId,
                context.Message.Amount
            );
            
            await context.Publish(new PaymentProcessed(
                context.Message.OrderId,
                transactionId,
                DateTime.UtcNow
            ));
        }
        catch (PaymentException) {
            // Retry will be handled by configuration
            throw;
        }
    }
}

// State machine saga
public class OrderStateMachine : MassTransitStateMachine<OrderState> {
    public State Created { get; private set; }
    public State PaymentPending { get; private set; }
    public State Paid { get; private set; }
    public State Shipped { get; private set; }
    
    public Event<OrderCreated> OrderCreatedEvent { get; private set; }
    public Event<PaymentProcessed> PaymentProcessedEvent { get; private set; }
    public Event<PaymentFailed> PaymentFailedEvent { get; private set; }
    
    public OrderStateMachine() {
        InstanceState(x => x.CurrentState);
        
        Event(() => OrderCreatedEvent, x => x.CorrelateById(context => context.Message.OrderId));
        Event(() => PaymentProcessedEvent, x => x.CorrelateById(context => context.Message.OrderId));
        Event(() => PaymentFailedEvent, x => x.CorrelateById(context => context.Message.OrderId));
        
        Initially(
            When(OrderCreatedEvent)
                .Then(context => {
                    context.Saga.OrderId = context.Message.OrderId;
                    context.Saga.CustomerId = context.Message.CustomerId;
                    context.Saga.Total = context.Message.Total;
                })
                .TransitionTo(PaymentPending)
                .Publish(context => new ProcessPayment(
                    context.Saga.OrderId,
                    context.Saga.Total,
                    context.Saga.CustomerEmail
                ))
        );
        
        During(PaymentPending,
            When(PaymentProcessedEvent)
                .TransitionTo(Paid)
                .Publish(context => new SendOrderConfirmation(
                    context.Saga.OrderId,
                    context.Saga.CustomerEmail,
                    context.Saga.Total
                )),
            
            When(PaymentFailedEvent)
                .Then(context => context.Saga.RetryCount++)
                .If(context => context.Saga.RetryCount < 3,
                    x => x.Schedule(RetryPayment,
                        context => context.Init<ProcessPayment>(new {
                            OrderId = context.Saga.OrderId,
                            Amount = context.Saga.Total
                        }),
                        context => TimeSpan.FromSeconds(Math.Pow(2, context.Saga.RetryCount))
                    )
                )
                .Otherwise(x => x.TransitionTo(Failed))
        );
    }
}

// Registration with retry policies
services.AddMassTransit(x => {
    x.AddConsumer<CreateOrderConsumer>();
    x.AddConsumer<ProcessPaymentConsumer>(typeof(ProcessPaymentConsumerDefinition));
    
    x.AddSagaStateMachine<OrderStateMachine, OrderState>()
        .InMemoryRepository();
    
    x.UsingInMemory((context, cfg) => {
        cfg.ConfigureEndpoints(context);
        
        cfg.UseMessageRetry(r => r.Exponential(3, 
            TimeSpan.FromSeconds(1), 
            TimeSpan.FromSeconds(30), 
            TimeSpan.FromSeconds(2)));
    });
});

// Consumer definition for retry policy
public class ProcessPaymentConsumerDefinition : ConsumerDefinition<ProcessPaymentConsumer> {
    protected override void ConfigureConsumer(
        IReceiveEndpointConfigurator endpointConfigurator,
        IConsumerConfigurator<ProcessPaymentConsumer> consumerConfigurator) {
        
        endpointConfigurator.UseMessageRetry(r => r.Interval(3, TimeSpan.FromSeconds(1)));
    }
}

// Usage
await bus.Send(new CreateOrder(customerId, items, customerEmail));
```

## 4. Brighter Implementation

```csharp
// Command with Brighter
public class CreateOrderCommand : Command {
    public Guid CustomerId { get; }
    public List<OrderItem> Items { get; }
    public string CustomerEmail { get; }
    
    public CreateOrderCommand(Guid customerId, List<OrderItem> items, string customerEmail) 
        : base(Guid.NewGuid()) {
        CustomerId = customerId;
        Items = items;
        CustomerEmail = customerEmail;
    }
}

// Command handler with policy attributes
public class CreateOrderHandler : RequestHandler<CreateOrderCommand> {
    private readonly IOrderRepository _orderRepository;
    private readonly IAmACommandProcessor _commandProcessor;
    
    public CreateOrderHandler(
        IOrderRepository orderRepository,
        IAmACommandProcessor commandProcessor) {
        _orderRepository = orderRepository;
        _commandProcessor = commandProcessor;
    }
    
    [UsePolicy(CommandProcessor.CIRCUITBREAKER, step: 1)]
    [UsePolicy(CommandProcessor.RETRYPOLICY, step: 2)]
    public override CreateOrderCommand Handle(CreateOrderCommand command) {
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = command.CustomerId,
            Items = command.Items,
            Total = command.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        _orderRepository.Save(order).GetAwaiter().GetResult();
        
        // Post new commands
        _commandProcessor.Post(new ProcessPaymentCommand(
            order.Id,
            order.Total,
            command.CustomerEmail
        ));
        
        _commandProcessor.Post(new SendOrderConfirmationCommand(
            order.Id,
            command.CustomerEmail,
            order.Total
        ));
        
        // Publish event
        _commandProcessor.Post(new OrderCreatedEvent(
            order.Id,
            order.CustomerId,
            order.Total,
            order.CreatedAt
        ));
        
        return base.Handle(command);
    }
}

// Payment handler with idempotency
[Idempotent(timeoutInMilliseconds: 60000)]
public class ProcessPaymentHandler : RequestHandler<ProcessPaymentCommand> {
    private readonly IPaymentService _paymentService;
    
    [UsePolicy(CommandProcessor.RETRYPOLICYWITHEXPONENTIALBACKOFF, step: 1)]
    public override ProcessPaymentCommand Handle(ProcessPaymentCommand command) {
        try {
            var transactionId = _paymentService.Charge(
                command.OrderId,
                command.Amount
            ).GetAwaiter().GetResult();
            
            // Success - publish event
            _commandProcessor.Post(new PaymentProcessedEvent(
                command.OrderId,
                transactionId,
                DateTime.UtcNow
            ));
        }
        catch (PaymentException ex) {
            // Will be retried due to policy
            throw new DeferMessageAction(TimeSpan.FromSeconds(5));
        }
        
        return base.Handle(command);
    }
}

// Pipeline with validation
public class ValidationPipelineHandler<T> : RequestHandler<T> 
    where T : class, IRequest {
    
    private readonly IValidator<T> _validator;
    
    public ValidationPipelineHandler(IValidator<T> validator) {
        _validator = validator;
    }
    
    public override T Handle(T command) {
        var validationResult = _validator.Validate(command);
        
        if (!validationResult.IsValid) {
            throw new ValidationException(validationResult.Errors);
        }
        
        return base.Handle(command);
    }
}

// Registration with policies
services.AddBrighter(options => {
    // Retry policy
    options.PolicyRegistry.Add(
        CommandProcessor.RETRYPOLICY,
        Policy.Handle<Exception>()
            .WaitAndRetryAsync(new[] {
                TimeSpan.FromSeconds(1),
                TimeSpan.FromSeconds(2),
                TimeSpan.FromSeconds(4)
            })
    );
    
    // Circuit breaker
    options.PolicyRegistry.Add(
        CommandProcessor.CIRCUITBREAKER,
        Policy.Handle<Exception>()
            .CircuitBreakerAsync(3, TimeSpan.FromMinutes(1))
    );
    
    // Register handlers
    options.HandlerLifetime = ServiceLifetime.Scoped;
    options.HandlerAssemblies = new[] { typeof(CreateOrderHandler).Assembly };
    
    // Add inbox for idempotency
    options.InboxConfiguration = new InboxConfiguration(
        new SqliteInboxSync(new SqliteConnectionProvider(connectionString)),
        scope: InboxScope.Commands,
        onceOnly: true
    );
})
.UseExternalBus(new RmqProducerRegistryFactory(
    new RmqMessagingGatewayConnection {
        AmpqUri = new AmqpUriSpecification(new Uri("amqp://guest:guest@localhost:5672")),
        Exchange = new Exchange("orders.exchange")
    }
).Create());

// Usage
await commandProcessor.SendAsync(new CreateOrderCommand(customerId, items, customerEmail));
```

## 5. Rebus Implementation

```csharp
// Message handlers with Rebus
public class CreateOrderHandler : IHandleMessages<CreateOrder> {
    private readonly IBus _bus;
    private readonly IOrderRepository _orderRepository;
    
    public CreateOrderHandler(IBus bus, IOrderRepository orderRepository) {
        _bus = bus;
        _orderRepository = orderRepository;
    }
    
    public async Task Handle(CreateOrder message) {
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = message.CustomerId,
            Items = message.Items,
            Total = message.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        await _orderRepository.Save(order);
        
        // Publish event
        await _bus.Publish(new OrderCreated(
            order.Id,
            order.CustomerId,
            order.Total,
            order.CreatedAt
        ));
        
        // Send command to specific queue
        await _bus.Send(new ProcessPayment(
            order.Id,
            order.Total,
            message.CustomerEmail
        ));
        
        // Defer email sending
        await _bus.Defer(TimeSpan.FromSeconds(5), new SendOrderConfirmation(
            order.Id,
            message.CustomerEmail,
            order.Total
        ));
    }
}

// Payment handler with saga
public class OrderSaga : Saga<OrderSagaData>,
    IAmInitiatedBy<OrderCreated>,
    IHandleMessages<PaymentProcessed>,
    IHandleMessages<PaymentFailed> {
    
    private readonly IBus _bus;
    
    public OrderSaga(IBus bus) {
        _bus = bus;
    }
    
    protected override void CorrelateMessages(ICorrelationConfig<OrderSagaData> config) {
        config.Correlate<OrderCreated>(m => m.OrderId, d => d.OrderId);
        config.Correlate<PaymentProcessed>(m => m.OrderId, d => d.OrderId);
        config.Correlate<PaymentFailed>(m => m.OrderId, d => d.OrderId);
    }
    
    public async Task Handle(OrderCreated message) {
        Data.OrderId = message.OrderId;
        Data.Total = message.Total;
        Data.Status = "Created";
        Data.RetryCount = 0;
    }
    
    public async Task Handle(PaymentProcessed message) {
        Data.Status = "Paid";
        MarkAsComplete();
    }
    
    public async Task Handle(PaymentFailed message) {
        Data.RetryCount++;
        
        if (Data.RetryCount < 3) {
            // Retry with exponential backoff
            var delay = TimeSpan.FromSeconds(Math.Pow(2, Data.RetryCount));
            await _bus.Defer(delay, new ProcessPayment(
                Data.OrderId,
                Data.Total,
                Data.CustomerEmail
            ));
        } else {
            Data.Status = "Failed";
            await _bus.Send(new CancelOrder(Data.OrderId));
            MarkAsComplete();
        }
    }
}

// Simple retry with IFailed
public class ProcessPaymentHandler : IHandleMessages<ProcessPayment>, IHandleMessages<IFailed<ProcessPayment>> {
    private readonly IPaymentService _paymentService;
    private readonly IBus _bus;
    
    public async Task Handle(ProcessPayment message) {
        var transactionId = await _paymentService.Charge(message.OrderId, message.Amount);
        
        await _bus.Publish(new PaymentProcessed(
            message.OrderId,
            transactionId,
            DateTime.UtcNow
        ));
    }
    
    public async Task Handle(IFailed<ProcessPayment> message) {
        // Rebus automatically wraps failed messages
        if (message.Exceptions.Count() < 3) {
            // Retry with delay
            await _bus.Defer(TimeSpan.FromSeconds(5), message.Message);
        } else {
            // Move to error queue (automatic)
            throw new FailFastException("Payment failed after 3 attempts");
        }
    }
}

// Registration with retry
services.AddRebus(configure => configure
    .Transport(t => t.UseInMemoryTransport(new InMemNetwork(), "orders-queue"))
    .Sagas(s => s.StoreInMemory())
    .Options(o => {
        o.SetNumberOfWorkers(1);
        o.SetMaxParallelism(10);
        o.RetryStrategy(
            secondLevelRetriesEnabled: true,
            errorQueueName: "errors",
            maxNumberOfRetries: 3
        );
    })
    .Logging(l => l.Serilog())
);

services.AddRebusHandler<CreateOrderHandler>();
services.AddRebusHandler<ProcessPaymentHandler>();
services.AddRebusHandler<OrderSaga>();

// Usage
await bus.Send(new CreateOrder(customerId, items, customerEmail));
```

## 6. NServiceBus Implementation

```csharp
// Command handler with NServiceBus
public class CreateOrderHandler : IHandleMessages<CreateOrder> {
    public async Task Handle(CreateOrder message, IMessageHandlerContext context) {
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = message.CustomerId,
            Items = message.Items,
            Total = message.Items.Sum(i => i.Quantity * i.Price),
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        
        // Store order (would use context.DataContext() with persistence)
        await StoreOrder(order);
        
        // Publish event
        await context.Publish(new OrderCreated {
            OrderId = order.Id,
            CustomerId = order.CustomerId,
            Total = order.Total,
            CreatedAt = order.CreatedAt
        });
        
        // Send command
        await context.Send(new ProcessPayment {
            OrderId = order.Id,
            Amount = order.Total,
            CustomerEmail = message.CustomerEmail
        });
        
        // Send delayed message
        var sendOptions = new SendOptions();
        sendOptions.DelayDeliveryWith(TimeSpan.FromMinutes(5));
        await context.Send(new SendOrderConfirmation {
            OrderId = order.Id,
            CustomerEmail = message.CustomerEmail,
            Total = order.Total
        }, sendOptions);
    }
}

// Saga implementation
public class OrderSaga : Saga<OrderSagaData>,
    IAmStartedByMessages<OrderCreated>,
    IHandleMessages<PaymentProcessed>,
    IHandleMessages<PaymentFailed>,
    IHandleTimeouts<PaymentTimeout> {
    
    protected override void ConfigureHowToFindSaga(SagaPropertyMapper<OrderSagaData> mapper) {
        mapper.ConfigureMapping<OrderCreated>(message => message.OrderId)
            .ToSaga(sagaData => sagaData.OrderId);
        mapper.ConfigureMapping<PaymentProcessed>(message => message.OrderId)
            .ToSaga(sagaData => sagaData.OrderId);
        mapper.ConfigureMapping<PaymentFailed>(message => message.OrderId)
            .ToSaga(sagaData => sagaData.OrderId);
    }
    
    public async Task Handle(OrderCreated message, IMessageHandlerContext context) {
        Data.OrderId = message.OrderId;
        Data.CustomerId = message.CustomerId;
        Data.Total = message.Total;
        Data.Status = "Created";
        
        // Set timeout for payment
        await RequestTimeout<PaymentTimeout>(context, TimeSpan.FromMinutes(10));
    }
    
    public async Task Handle(PaymentProcessed message, IMessageHandlerContext context) {
        Data.Status = "Paid";
        Data.TransactionId = message.TransactionId;
        
        await context.Send(new FulfillOrder {
            OrderId = Data.OrderId,
            CustomerId = Data.CustomerId
        });
        
        MarkAsComplete();
    }
    
    public async Task Handle(PaymentFailed message, IMessageHandlerContext context) {
        Data.RetryCount++;
        
        if (Data.RetryCount < 3) {
            // Retry with delay
            var retryOptions = new SendOptions();
            retryOptions.DelayDeliveryWith(TimeSpan.FromSeconds(Math.Pow(2, Data.RetryCount)));
            
            await context.Send(new ProcessPayment {
                OrderId = Data.OrderId,
                Amount = Data.Total,
                CustomerEmail = Data.CustomerEmail
            }, retryOptions);
        } else {
            Data.Status = "Failed";
            await context.Send(new CancelOrder { OrderId = Data.OrderId });
            MarkAsComplete();
        }
    }
    
    public async Task Timeout(PaymentTimeout state, IMessageHandlerContext context) {
        if (Data.Status != "Paid") {
            Data.Status = "TimedOut";
            await context.Send(new CancelOrder { OrderId = Data.OrderId });
            MarkAsComplete();
        }
    }
}

// Payment handler with recoverability
public class ProcessPaymentHandler : IHandleMessages<ProcessPayment> {
    private readonly IPaymentService _paymentService;
    
    public async Task Handle(ProcessPayment message, IMessageHandlerContext context) {
        try {
            var transactionId = await _paymentService.Charge(
                message.OrderId,
                message.Amount
            );
            
            await context.Publish(new PaymentProcessed {
                OrderId = message.OrderId,
                TransactionId = transactionId,
                ProcessedAt = DateTime.UtcNow
            });
        }
        catch (PaymentException) {
            // NServiceBus recoverability will handle this
            throw;
        }
    }
}

// Advanced configuration with policies
var endpointConfiguration = new EndpointConfiguration("Orders");

// Transport
var transport = endpointConfiguration.UseTransport<LearningTransport>();

// Persistence for sagas
var persistence = endpointConfiguration.UsePersistence<SqlPersistence>();
persistence.SqlDialect<SqlDialect.MsSqlServer>();
persistence.ConnectionBuilder(() => new SqlConnection(connectionString));

// Recoverability (retry) policy
var recoverability = endpointConfiguration.Recoverability();
recoverability.Delayed(delayed => {
    delayed.NumberOfRetries(3);
    delayed.TimeIncrease(TimeSpan.FromSeconds(2));
});

recoverability.Immediate(immediate => {
    immediate.NumberOfRetries(1);
});

recoverability.CustomPolicy((config, context) => {
    if (context.Exception is PaymentException) {
        return RecoverabilityAction.DelayedRetry(TimeSpan.FromSeconds(5));
    }
    return DefaultRecoverabilityPolicy.Invoke(config, context);
});

// Enable installers
endpointConfiguration.EnableInstallers();

// Start endpoint
var endpointInstance = await Endpoint.Start(endpointConfiguration);

// Usage
await endpointInstance.Send(new CreateOrder {
    CustomerId = customerId,
    Items = items,
    CustomerEmail = customerEmail
});
```

## Key Observations from Examples

### Complexity Progression
- **MediatR**: Most code, explicit wiring
- **Wolverine**: Least code, convention-based
- **MassTransit**: Configuration-heavy but powerful
- **Brighter**: Policy-focused with attributes
- **Rebus**: Balanced simplicity and features
- **NServiceBus**: Most enterprise features

### Error Handling Approaches
- **MediatR**: Manual via pipeline behaviors
- **Wolverine**: Return types and policies
- **MassTransit**: Consumer definitions and state machines
- **Brighter**: Declarative attributes
- **Rebus**: IFailed interface and defer
- **NServiceBus**: Comprehensive recoverability

### Saga/Orchestration
- **MediatR**: Not built-in (need external)
- **Wolverine**: Natural with return types
- **MassTransit**: State machine approach
- **Brighter**: Limited saga support
- **Rebus**: Simple saga base class
- **NServiceBus**: Full-featured sagas

### Testing Experience
```csharp
// MediatR - Mock mediator
var mediator = new Mock<IMediator>();
mediator.Setup(x => x.Send(It.IsAny<CreateOrderCommand>(), default))
    .ReturnsAsync(new OrderCreatedResult(...));

// Wolverine - Test message context
var context = new TestMessageContext();
var result = await OrderHandlers.Handle(command, repository);

// MassTransit - Test harness
var harness = new InMemoryTestHarness();
await harness.Start();
await harness.InputQueueSendEndpoint.Send(command);

// Brighter - Command processor substitute
var processor = Substitute.For<IAmACommandProcessor>();
processor.Send(command);

// Rebus - Fake bus
var bus = new FakeBus();
await handler.Handle(message);
bus.Events.ShouldContain<OrderCreated>();

// NServiceBus - Testing framework
var context = new TestableMessageHandlerContext();
await handler.Handle(message, context);
context.PublishedMessages.ShouldContain<OrderCreated>();
```

This comparison shows how the same business logic requires different patterns and varying amounts of code across libraries, highlighting their different philosophies and target use cases.