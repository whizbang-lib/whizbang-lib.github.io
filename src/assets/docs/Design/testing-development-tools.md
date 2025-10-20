---
title: Testing & Development Tools
category: Architecture & Design
order: 13
tags: testing, development-tools, cli, ide-extensions, dashboard
---

# Testing & Development Tools

Whizbang provides comprehensive testing utilities and development tools to ensure a productive developer experience from local development to production deployment.

## Testing Framework

### Whizbang.Testing Package

**Comprehensive testing library** with fluent APIs for all Whizbang scenarios:

```csharp
// Install the testing package
dotnet add package Whizbang.Testing

// Test fixture setup
public class OrderServiceTests {
    private readonly WhizbangTestFixture _fixture;
    
    public OrderServiceTests() {
        _fixture = new WhizbangTestFixture()
            .UseInMemoryEventStore()
            .UseInMemoryProjections()
            .UseInMemoryMessageBroker()
            .ConfigureServices(services => {
                services.AddScoped<IOrderService, OrderService>();
                services.AddScoped<ICustomerService, MockCustomerService>();
            });
    }
}
```

### Event Sourcing Test Helpers

**Given/When/Then fluent API** for event sourcing scenarios:

```csharp
[Test]
public async Task PlaceOrder_WithValidCustomer_ShouldEmitOrderPlaced() {
    // Arrange & Act & Assert in fluent chain
    await _fixture
        .Given(
            new CustomerRegistered(customerId, "John Doe", "john@example.com"),
            new ProductCreated(productId, "Widget", 10.00m)
        )
        .When(new PlaceOrder(orderId, customerId, new[] { 
            new OrderItem(productId, 2, 10.00m) 
        }))
        .Then()
        .ShouldEmitEvent<OrderPlaced>()
        .WithProperty(e => e.OrderId, orderId)
        .WithProperty(e => e.CustomerId, customerId)
        .WithProperty(e => e.Total, 20.00m)
        .And()
        .ShouldNotEmitEvent<OrderRejected>();
}

[Test]
public async Task PlaceOrder_WithInvalidCustomer_ShouldEmitOrderRejected() {
    await _fixture
        .Given() // No customer registered
        .When(new PlaceOrder(orderId, customerId, items))
        .Then()
        .ShouldEmitEvent<OrderRejected>()
        .WithProperty(e => e.Reason, "Customer not found")
        .And()
        .ShouldNotEmitEvent<OrderPlaced>();
}
```

### Projection Testing

**Feed events and assert projection state**:

```csharp
[Test]
public async Task OrderSummaryProjection_ShouldTrackOrderLifecycle() {
    await _fixture
        .ForProjection<OrderSummaryProjection>()
        .GivenEvents(
            new OrderPlaced(orderId, customerId, 100.00m, DateTimeOffset.UtcNow),
            new OrderShipped(orderId, "TRACK123", DateTimeOffset.UtcNow.AddDays(1))
        )
        .WhenProjectionRuns()
        .ThenProjection<OrderSummary>(orderId.ToString())
        .ShouldExist()
        .ShouldHaveProperty(s => s.Status, OrderStatus.Shipped)
        .ShouldHaveProperty(s => s.Total, 100.00m)
        .ShouldHaveProperty(s => s.TrackingNumber, "TRACK123");
}

[Test]
public async Task OrderSummaryProjection_WithMissingEvents_ShouldHandleGracefully() {
    await _fixture
        .ForProjection<OrderSummaryProjection>()
        .GivenEvents(
            new OrderShipped(orderId, "TRACK123", DateTimeOffset.UtcNow) // No OrderPlaced
        )
        .WhenProjectionRuns()
        .ThenProjection<OrderSummary>(orderId.ToString())
        .ShouldNotExist(); // Projection should handle missing OrderPlaced gracefully
}
```

### Policy Testing

**Test policy rules and combinations**:

```csharp
[Test]
public async Task LoadTestingPolicy_ShouldSkipProjections() {
    await _fixture
        .ForPolicy("LoadTestingPolicy")
        .GivenContext(ctx => ctx.WithFlag(WhizbangFlags.LoadTesting))
        .GivenMessage(new OrderPlaced(orderId, customerId, 100.00m))
        .WhenPolicyEvaluates()
        .ThenActions()
        .ShouldContain<SkipProjectionsAction>()
        .ShouldContain<AddTagAction>(action => action.Tag == "load-test-processed");
}

[Test]
public async Task VIPCustomerPolicy_ShouldRouteToSpecialHandler() {
    await _fixture
        .ForPolicy("VIPCustomerPolicy")
        .GivenContext(ctx => ctx.WithTag("customer-vip"))
        .GivenMessage(new PlaceOrder(orderId, customerId, items))
        .WhenPolicyEvaluates()
        .ThenActions()
        .ShouldContain<RouteToHandlerAction<VIPOrderHandler>>();
}
```

### Saga Testing

**Test long-running process coordination**:

```csharp
[Test]
public async Task OrderFulfillmentSaga_ShouldCoordinateFullWorkflow() {
    await _fixture
        .ForSaga<OrderFulfillmentSaga>()
        .GivenEvents(
            new OrderPlaced(orderId, customerId, items)
        )
        .WhenSagaRuns()
        .ThenCommands()
        .ShouldContain<ReserveInventory>(cmd => cmd.OrderId == orderId)
        .And()
        .WhenEvent(new InventoryReserved(orderId, items))
        .ThenCommands()
        .ShouldContain<ChargePayment>(cmd => cmd.OrderId == orderId)
        .And()
        .WhenEvent(new PaymentCharged(orderId, 100.00m))
        .ThenCommands()
        .ShouldContain<ShipOrder>(cmd => cmd.OrderId == orderId);
}
```

### Integration Testing

**Real drivers with test containers**:

```csharp
[Test]
public async Task OrderService_IntegrationTest_WithRealDatabase() {
    // Uses TestContainers for real PostgreSQL
    await using var fixture = new WhizbangIntegrationTestFixture()
        .UseTestContainerPostgres()
        .UseTestContainerKafka()
        .ConfigureServices(services => {
            services.AddOrderService();
            services.AddInventoryService();
        });
    
    await fixture.StartAsync();
    
    // Test with real infrastructure
    var result = await fixture
        .Given(/* setup data in real database */)
        .When(new PlaceOrder(orderId, customerId, items))
        .Then()
        .ShouldEmitEvent<OrderPlaced>()
        .And()
        .ShouldHaveProjection<OrderSummary>(orderId.ToString())
        .InDatabase(); // Verify in real database
}
```

## Development Tools Suite

### CLI Tool (whizbang-cli)

**Comprehensive command-line interface** for project management:

```bash
# Project scaffolding
whizbang new --template microservice --name OrderService
whizbang new --template monolith --name ECommerceApp
whizbang new --template projection-worker --name AnalyticsWorker

# Code generation
whizbang add command --name PlaceOrder --domain Orders
whizbang add event --name OrderPlaced --domain Orders  
whizbang add projection --name OrderSummary --events OrderPlaced,OrderShipped
whizbang add saga --name OrderFulfillment --triggers OrderPlaced

# Development utilities
whizbang validate --project ./OrderService --check-ownership
whizbang generate --project ./OrderService --watch
whizbang dashboard --port 5000 --project ./OrderService

# Event store utilities
whizbang events list --stream "Order-*" --from 2024-01-01
whizbang events replay --stream "Order-123" --to-projection OrderSummary
whizbang events export --stream "Order-*" --format json --output orders.json

# Migration utilities
whizbang migrate --from 1.0 --to 2.0 --dry-run
whizbang migrate --apply --backup
```

### CLI Implementation Architecture

```csharp
// CLI command structure
[Command("whizbang")]
public class WhizbangCliCommand {
    [Command("new")]
    public class NewCommand {
        [Option("--template", Description = "Project template")]
        public string Template { get; set; } = "microservice";
        
        [Option("--name", Description = "Project name")]
        public string Name { get; set; }
        
        public async Task<int> ExecuteAsync() {
            var templateEngine = new ProjectTemplateEngine();
            await templateEngine.CreateProjectAsync(Template, Name);
            return 0;
        }
    }
    
    [Command("add")]
    public class AddCommand {
        [Command("command")]
        public class AddCommandCommand {
            [Option("--name")] public string Name { get; set; }
            [Option("--domain")] public string Domain { get; set; }
            
            public async Task<int> ExecuteAsync() {
                var generator = new CodeGenerator();
                await generator.GenerateCommandAsync(Name, Domain);
                return 0;
            }
        }
    }
}
```

### Visual Studio Integration

**Templates and extensions** for rapid development:

```xml
<!-- dotnet new templates -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <PackageType>Template</PackageType>
    <PackageVersion>1.0.0</PackageVersion>
    <PackageId>Whizbang.Templates</PackageId>
    <Title>Whizbang Project Templates</Title>
    <Description>Templates for Whizbang applications</Description>
    <IncludeContentInPack>true</IncludeContentInPack>
    <IncludeBuildOutput>false</IncludeBuildOutput>
    <ContentTargetFolders>content</ContentTargetFolders>
  </PropertyGroup>
</Project>
```

**Live Templates for common patterns**:

```csharp
// Command template
public record $COMMAND_NAME$(
    $PARAMETERS$
) : ICommand;

// Event template  
public record $EVENT_NAME$(
    $PARAMETERS$
) : IEvent;

// Handler template
public class $HANDLER_NAME$ : ICommandHandler<$COMMAND_TYPE$> {
    public async Task<IEvent[]> Handle($COMMAND_TYPE$ command) {
        $HANDLER_LOGIC$
        
        return new IEvent[] {
            new $EVENT_TYPE$($EVENT_PARAMETERS$)
        };
    }
}

// Projection template
public class $PROJECTION_NAME$ : IProjectionHandler<$EVENT_TYPE$> {
    public async Task Handle($EVENT_TYPE$ @event, ProjectionContext context) {
        var projection = await context.Load<$PROJECTION_MODEL$>(@event.$KEY_FIELD$.ToString())
                        ?? new $PROJECTION_MODEL$ { $KEY_FIELD$ = @event.$KEY_FIELD$ };
        
        $PROJECTION_LOGIC$
        
        await context.Store(@event.$KEY_FIELD$.ToString(), projection);
    }
}
```

### Web Dashboard

**Real-time monitoring and debugging interface**:

```csharp
// Dashboard startup
public class WhizbangDashboard {
    public static void ConfigureDashboard(WebApplicationBuilder builder) {
        builder.Services.AddWhizbangDashboard(options => {
            options.EnableRealTimeUpdates = true;
            options.EventRetentionHours = 24;
            options.ProjectionLagAlertThreshold = TimeSpan.FromMinutes(5);
        });
    }
    
    public static void MapDashboardEndpoints(WebApplication app) {
        app.MapWhizbangDashboard("/dashboard");
        
        // API endpoints for dashboard
        app.MapGet("/api/whizbang/projections", GetProjectionStatus);
        app.MapGet("/api/whizbang/events/{streamId}", GetEventStream);
        app.MapPost("/api/whizbang/replay", TriggerReplay);
        app.MapGet("/api/whizbang/policies", GetActivePolicies);
        app.MapPost("/api/whizbang/policies/test", TestPolicy);
    }
}
```

**Dashboard Features**:

1. **Real-time Projection Monitoring**
   - Projection lag visualization
   - Event processing rates
   - Error rates and alerts
   - Checkpoint status

2. **Event Stream Visualization**
   - Stream browsing and filtering
   - Event details and metadata
   - Cross-stream correlation
   - Flow diagrams

3. **Policy Rule Testing**
   - Policy condition testing
   - Action preview
   - Rule combination visualization
   - Performance impact analysis

4. **Performance Metrics**
   - Handler execution times
   - Throughput measurements
   - Resource utilization
   - Bottleneck identification

### IDE Extensions

**Visual Studio Code Extension** with advanced features:

```typescript
// VSCode extension main functionality
export function activate(context: vscode.ExtensionContext) {
    // Register command for event stream navigation
    const navigateCommand = vscode.commands.registerCommand(
        'whizbang.navigateEventStream',
        async () => {
            const streamId = await vscode.window.showInputBox({
                prompt: 'Enter stream ID or pattern'
            });
            
            if (streamId) {
                const events = await whizbangService.getEventStream(streamId);
                showEventStreamPanel(events);
            }
        }
    );
    
    // Register hover provider for command/event info
    const hoverProvider = vscode.languages.registerHoverProvider(
        'csharp',
        new WhizbangHoverProvider()
    );
    
    // Register code lens provider for handler flow
    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        'csharp',
        new WhizbangCodeLensProvider()
    );
    
    context.subscriptions.push(navigateCommand, hoverProvider, codeLensProvider);
}

class WhizbangHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const word = document.getWordRangeAtPosition(position);
        if (!word) return;
        
        const wordText = document.getText(word);
        
        // Check if it's a Whizbang command/event
        const metadata = await whizbangService.getTypeMetadata(wordText);
        if (metadata) {
            const contents = new vscode.MarkdownString();
            contents.appendMarkdown(`**${metadata.type}**: ${metadata.name}\n\n`);
            contents.appendMarkdown(`Domain: ${metadata.domain}\n\n`);
            
            if (metadata.handlers) {
                contents.appendMarkdown(`**Handlers:**\n`);
                metadata.handlers.forEach(h => {
                    contents.appendMarkdown(`- ${h.name} (${h.domain})\n`);
                });
            }
            
            return new vscode.Hover(contents, word);
        }
    }
}
```

## In-Memory Drivers for Testing

### Fast Unit Test Infrastructure

**Optimized in-memory implementations** for rapid testing:

```csharp
// In-memory event store
public class InMemoryEventStore : IEventStoreDriver {
    private readonly ConcurrentDictionary<string, List<StoredEvent>> _streams = new();
    
    public async Task AppendEventsAsync(string streamId, IEnumerable<IEvent> events, int expectedVersion) {
        var streamEvents = _streams.GetOrAdd(streamId, _ => new List<StoredEvent>());
        
        lock (streamEvents) {
            if (streamEvents.Count != expectedVersion) {
                throw new ConcurrencyException(streamId, expectedVersion, streamEvents.Count);
            }
            
            foreach (var @event in events) {
                streamEvents.Add(new StoredEvent {
                    StreamId = streamId,
                    EventId = Guid.NewGuid(),
                    EventType = @event.GetType().Name,
                    EventData = JsonSerializer.Serialize(@event),
                    Version = streamEvents.Count + 1,
                    Timestamp = DateTimeOffset.UtcNow
                });
            }
        }
    }
    
    public async Task<IEnumerable<StoredEvent>> ReadEventsAsync(string streamId, int fromVersion = 0) {
        var streamEvents = _streams.GetOrAdd(streamId, _ => new List<StoredEvent>());
        return streamEvents.Where(e => e.Version > fromVersion).ToList();
    }
}

// In-memory projection store
public class InMemoryProjectionStore : IProjectionDriver {
    private readonly ConcurrentDictionary<string, Dictionary<string, object>> _projections = new();
    
    public async Task Store<T>(string projectionName, string documentId, T document, string? tenantId = null) {
        var key = tenantId != null ? $"{projectionName}_{tenantId}" : projectionName;
        var projectionData = _projections.GetOrAdd(key, _ => new Dictionary<string, object>());
        
        lock (projectionData) {
            projectionData[documentId] = document;
        }
    }
    
    public async Task<T?> Load<T>(string projectionName, string documentId, string? tenantId = null) {
        var key = tenantId != null ? $"{projectionName}_{tenantId}" : projectionName;
        if (_projections.TryGetValue(key, out var projectionData)) {
            lock (projectionData) {
                if (projectionData.TryGetValue(documentId, out var document)) {
                    return (T)document;
                }
            }
        }
        return default(T);
    }
}
```

## Testing Best Practices

### Test Organization

1. **Separate test categories**:
   - **Unit tests** - Fast, isolated, use in-memory drivers
   - **Integration tests** - Real infrastructure with test containers
   - **End-to-end tests** - Full system testing
   - **Performance tests** - Load and stress testing

2. **Test data management**:
   - **Builders** for complex test data construction
   - **Fixtures** for reusable test scenarios
   - **Cleanup** strategies for integration tests

3. **Assertion patterns**:
   - **Fluent assertions** for readability
   - **Custom matchers** for domain concepts
   - **Error scenarios** testing

### Development Workflow

1. **TDD-friendly** - Tests before implementation
2. **Fast feedback** - Sub-second unit test execution
3. **IDE integration** - Run tests from code editor
4. **Continuous testing** - Watch mode for automatic test runs
5. **Coverage tracking** - Identify untested code paths

---

## Related Documentation

- [**Source Generation & IDE Integration**](./source-generation-ide.md) - How testing integrates with generated code
- [**Policy Engine**](./policy-engine.md) - Testing policy rules and combinations
- [**Flags & Tags System**](./flags-tags-system.md) - Cross-service context propagation
- [**Observability & Metrics**](./observability-metrics.md) - Testing observability features