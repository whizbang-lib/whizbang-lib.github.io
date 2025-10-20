---
title: Source Generation & IDE Integration
category: Architecture & Design
order: 12
tags: source-generation, ide-integration, analyzers, navigation, debugging
---

# Source Generation & IDE Integration

Whizbang uses advanced source generation and IDE integration to provide a seamless developer experience with compile-time validation, intelligent navigation, and powerful debugging tools.

## Source Generator Architecture

### Single Pipeline Generator

**Incremental source generator** with orchestrated pipeline stages for optimal performance:

```csharp
[Generator]
public class WhizbangSourceGenerator : IIncrementalGenerator {
    public void Initialize(IncrementalGeneratorInitializationContext context) {
        // Stage 1: Handler Discovery Pipeline
        var handlersPipeline = context.SyntaxProvider.CreateSyntaxProvider(
            predicate: (node, _) => IsHandlerCandidate(node),
            transform: (ctx, _) => ExtractHandlerInfo(ctx)
        ).Where(info => info != null);
        
        // Stage 2: Domain Ownership Pipeline  
        var domainOwnershipPipeline = context.SyntaxProvider.CreateSyntaxProvider(
            predicate: (node, _) => IsDomainCandidate(node),
            transform: (ctx, _) => ExtractDomainInfo(ctx)
        );
        
        // Stage 3: Projection Pipeline
        var projectionsPipeline = context.SyntaxProvider.CreateSyntaxProvider(
            predicate: (node, _) => IsProjectionCandidate(node),
            transform: (ctx, _) => ExtractProjectionInfo(ctx)
        );
        
        // Stage 4: Policy Pipeline
        var policiesPipeline = context.SyntaxProvider.CreateSyntaxProvider(
            predicate: (node, _) => IsPolicyCandidate(node),
            transform: (ctx, _) => ExtractPolicyInfo(ctx)
        );
        
        // Combine all sources for cross-project aggregation
        var combinedPipeline = handlersPipeline
            .Combine(domainOwnershipPipeline)
            .Combine(projectionsPipeline)
            .Combine(policiesPipeline);
            
        // Generate code
        context.RegisterSourceOutput(combinedPipeline, GenerateWhizbangRegistry);
        
        // Generate metadata for IDE service
        context.RegisterSourceOutput(combinedPipeline, GenerateNavigationMetadata);
        
        // Generate analyzer data
        context.RegisterSourceOutput(combinedPipeline, GenerateAnalyzerData);
    }
}
```

### Build Performance & Logging

**Detailed timing and logging** for optimization:

```csharp
public class GenerationPerformanceTracker {
    private readonly Dictionary<string, Stopwatch> _stageTimers = new();
    
    public void StartStage(string stageName) {
        _stageTimers[stageName] = Stopwatch.StartNew();
        LogInformation($"Starting stage: {stageName}");
    }
    
    public void EndStage(string stageName) {
        if (_stageTimers.TryGetValue(stageName, out var timer)) {
            timer.Stop();
            LogInformation($"Completed stage: {stageName} in {timer.ElapsedMilliseconds}ms");
        }
    }
    
    public void LogSummary() {
        var totalTime = _stageTimers.Values.Sum(t => t.ElapsedMilliseconds);
        LogInformation($"Total generation time: {totalTime}ms");
        
        foreach (var (stage, timer) in _stageTimers) {
            var percentage = (timer.ElapsedMilliseconds / (double)totalTime) * 100;
            LogInformation($"  {stage}: {timer.ElapsedMilliseconds}ms ({percentage:F1}%)");
        }
    }
}
```

### Multi-Project Aggregation

**Cross-assembly handler discovery** and registration:

```csharp
// Generated registry aggregates across projects
[GeneratedCode("Whizbang.SourceGenerator")]
public static class WhizbangGeneratedRegistry {
    public static void RegisterAll(IServiceCollection services) {
        // Handlers from current project
        RegisterLocalHandlers(services);
        
        // Handlers from referenced projects
        RegisterReferencedHandlers(services);
        
        // Domain ownership from all projects
        RegisterDomainOwnership(services);
        
        // Policies from all projects
        RegisterPolicies(services);
    }
    
    private static void RegisterLocalHandlers(IServiceCollection services) {
        services.AddScoped<ICommandHandler<PlaceOrder>, PlaceOrderHandler>();
        services.AddScoped<IEventHandler<OrderPlaced>, OrderSummaryProjection>();
        // ... other local handlers
    }
    
    private static void RegisterReferencedHandlers(IServiceCollection services) {
        // Handlers discovered from referenced assemblies
        SharedLibrary.WhizbangRegistry.RegisterHandlers(services);
        CoreDomain.WhizbangRegistry.RegisterHandlers(services);
    }
}
```

## IDE Navigation Service

### Event Stream Navigation

**GitLens-style navigation** through event streams and handlers:

```csharp
public interface IWhizbangNavigationService {
    Task<EventStreamInfo> GetEventStreamAsync(string streamId);
    Task<IEnumerable<HandlerInfo>> GetHandlersForEventAsync(Type eventType);
    Task<IEnumerable<ProjectionInfo>> GetProjectionsForEventAsync(Type eventType);
    Task<EventFlowDiagram> GetEventFlowAsync(Type commandType);
    Task<DomainMap> GetDomainMapAsync();
}

// Event flow visualization
public class EventFlowDiagram {
    public CommandInfo Command { get; set; }
    public HandlerInfo CommandHandler { get; set; }
    public List<EventInfo> EmittedEvents { get; set; }
    public Dictionary<EventInfo, List<HandlerInfo>> EventHandlers { get; set; }
    public Dictionary<EventInfo, List<ProjectionInfo>> EventProjections { get; set; }
    public List<SagaInfo> TriggeredSagas { get; set; }
}

// Usage in IDE extension
public class WhizbangCodeLensProvider : CodeLensProvider {
    public override async Task<CodeLens[]> ProvideCodeLensesAsync(Document document) {
        var semanticModel = await document.GetSemanticModelAsync();
        var root = await document.GetSyntaxRootAsync();
        
        var codeLenses = new List<CodeLens>();
        
        // Find command handlers
        foreach (var handlerClass in root.DescendantNodes().OfType<ClassDeclarationSyntax>()) {
            if (IsCommandHandler(handlerClass, semanticModel)) {
                var commandType = GetCommandType(handlerClass, semanticModel);
                var eventFlow = await _navigationService.GetEventFlowAsync(commandType);
                
                codeLenses.Add(new CodeLens {
                    Range = GetRange(handlerClass),
                    Command = new Command {
                        Title = $"Emits {eventFlow.EmittedEvents.Count} events, triggers {eventFlow.EventHandlers.Count} handlers",
                        Arguments = new object[] { eventFlow }
                    }
                });
            }
        }
        
        return codeLenses.ToArray();
    }
}
```

### Generated Metadata

**Rich metadata** for IDE integration:

```csharp
// Generated metadata file: WhizbangMetadata.json
{
  "eventStreams": {
    "Order-{orderId}": {
      "aggregateType": "Order",
      "domain": "Orders",
      "events": ["OrderPlaced", "OrderUpdated", "OrderShipped"],
      "handlers": ["OrderSummaryProjection", "OrderHistoryProjection"],
      "sagas": ["OrderFulfillmentSaga"]
    }
  },
  "handlers": {
    "PlaceOrderHandler": {
      "handlerType": "Command",
      "inputType": "PlaceOrder",
      "outputTypes": ["OrderPlaced"],
      "domain": "Orders",
      "sourceLocation": "OrderService/Handlers/PlaceOrderHandler.cs:15"
    }
  },
  "projections": {
    "OrderSummaryProjection": {
      "projectionName": "order-summary",
      "subscribedEvents": ["OrderPlaced", "OrderUpdated", "OrderShipped"],
      "domain": "Orders",
      "sourceLocation": "OrderService/Projections/OrderSummaryProjection.cs:8"
    }
  },
  "domains": {
    "Orders": {
      "commands": ["PlaceOrder", "UpdateOrder", "ShipOrder"],
      "events": ["OrderPlaced", "OrderUpdated", "OrderShipped"],
      "handlers": ["PlaceOrderHandler", "UpdateOrderHandler"],
      "projections": ["OrderSummaryProjection", "OrderHistoryProjection"]
    }
  }
}
```

## Code Analyzers & Fixes

### Domain Ownership Validation

**Compile-time enforcement** of domain ownership rules:

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class DomainOwnershipAnalyzer : DiagnosticAnalyzer {
    public static readonly DiagnosticDescriptor CrossDomainHandlerRule = new(
        "WB001",
        "Handler cannot handle command/event from different domain",
        "Handler '{0}' in domain '{1}' cannot handle '{2}' from domain '{3}'",
        "Domain Ownership",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true
    );
    
    public override void Initialize(AnalysisContext context) {
        context.RegisterSyntaxNodeAction(AnalyzeHandlerClass, SyntaxKind.ClassDeclaration);
    }
    
    private void AnalyzeHandlerClass(SyntaxNodeAnalysisContext context) {
        var classDeclaration = (ClassDeclarationSyntax)context.Node;
        var semanticModel = context.SemanticModel;
        
        var handlerDomain = GetHandlerDomain(classDeclaration, semanticModel);
        var handledTypes = GetHandledTypes(classDeclaration, semanticModel);
        
        foreach (var handledType in handledTypes) {
            var messageDomain = GetMessageDomain(handledType, semanticModel);
            
            if (handlerDomain != messageDomain) {
                var diagnostic = Diagnostic.Create(
                    CrossDomainHandlerRule,
                    classDeclaration.GetLocation(),
                    classDeclaration.Identifier.ValueText,
                    handlerDomain,
                    handledType.Name,
                    messageDomain
                );
                
                context.ReportDiagnostic(diagnostic);
            }
        }
    }
}
```

### Code Fixes

**Automatic fixes** for common patterns:

```csharp
[ExportCodeFixProvider(LanguageNames.CSharp)]
public class AddDomainOwnershipCodeFixProvider : CodeFixProvider {
    public override async Task RegisterCodeFixesAsync(CodeFixContext context) {
        var diagnostic = context.Diagnostics.FirstOrDefault(d => d.Id == "WB002");
        if (diagnostic == null) return;
        
        var document = context.Document;
        var root = await document.GetSyntaxRootAsync(context.CancellationToken);
        var declaration = root.FindNode(diagnostic.Location.SourceSpan);
        
        // Offer to add [OwnedBy] attribute
        var codeAction = CodeAction.Create(
            title: "Add [OwnedBy] attribute",
            createChangedDocument: c => AddOwnedByAttribute(document, declaration, c),
            equivalenceKey: "AddOwnedBy"
        );
        
        context.RegisterCodeFix(codeAction, diagnostic);
    }
    
    private async Task<Document> AddOwnedByAttribute(Document document, SyntaxNode declaration, CancellationToken cancellationToken) {
        var root = await document.GetSyntaxRootAsync(cancellationToken);
        var inferredDomain = InferDomainFromNamespace(declaration);
        
        var attribute = SyntaxFactory.Attribute(
            SyntaxFactory.IdentifierName("OwnedBy"),
            SyntaxFactory.AttributeArgumentList(
                SyntaxFactory.SingletonSeparatedList(
                    SyntaxFactory.AttributeArgument(
                        SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression, 
                            SyntaxFactory.Literal(inferredDomain))
                    )
                )
            )
        );
        
        var newDeclaration = AddAttributeToDeclaration(declaration, attribute);
        var newRoot = root.ReplaceNode(declaration, newDeclaration);
        
        return document.WithSyntaxRoot(newRoot);
    }
}
```

## Debugging Integration

### Transparent Generated Code

**Clear, debuggable generated code** with source maps:

```csharp
// Generated handler registry with clear structure
[GeneratedCode("Whizbang.SourceGenerator", "1.0.0")]
public static partial class OrderServiceHandlerRegistry {
    // Source: OrderService/Handlers/PlaceOrderHandler.cs
    public static void RegisterPlaceOrderHandler(IServiceCollection services) {
        services.AddScoped<ICommandHandler<PlaceOrder>, PlaceOrderHandler>();
        
        // Generated metadata for debugging
        services.AddSingleton(new HandlerMetadata {
            HandlerType = typeof(PlaceOrderHandler),
            MessageType = typeof(PlaceOrder),
            SourceFile = "OrderService/Handlers/PlaceOrderHandler.cs",
            SourceLine = 15,
            Domain = "Orders",
            GeneratedAt = DateTimeOffset.Parse("2024-01-01T10:00:00Z")
        });
    }
    
    // Source: OrderService/Projections/OrderSummaryProjection.cs  
    public static void RegisterOrderSummaryProjection(IServiceCollection services) {
        services.AddScoped<IProjectionHandler<OrderPlaced>, OrderSummaryProjection>();
        services.AddScoped<IProjectionHandler<OrderUpdated>, OrderSummaryProjection>();
        services.AddScoped<IProjectionHandler<OrderShipped>, OrderSummaryProjection>();
        
        // Register projection metadata
        services.AddSingleton(new ProjectionMetadata {
            ProjectionType = typeof(OrderSummaryProjection),
            ProjectionName = "order-summary",
            SubscribedEvents = new[] { typeof(OrderPlaced), typeof(OrderUpdated), typeof(OrderShipped) },
            SourceFile = "OrderService/Projections/OrderSummaryProjection.cs",
            SourceLine = 8,
            Domain = "Orders"
        });
    }
}
```

### Debug Experience Enhancements

**No "magic" - clear understanding** of what's happening:

```csharp
// Debug-friendly service registration
public static class WhizbangServiceCollectionExtensions {
    public static IServiceCollection AddWhizbangGeneratedServices(this IServiceCollection services) {
        if (IsDebugMode()) {
            // In debug mode, show detailed registration logging
            services.AddSingleton<IHandlerRegistrationLogger, DetailedHandlerRegistrationLogger>();
        }
        
        // Call generated registration methods
        OrderServiceHandlerRegistry.RegisterAll(services);
        
        return services;
    }
}

public class DetailedHandlerRegistrationLogger : IHandlerRegistrationLogger {
    public void LogHandlerRegistration<TMessage, THandler>(string sourceFile, int sourceLine) {
        Console.WriteLine($"Registering handler {typeof(THandler).Name} for {typeof(TMessage).Name}");
        Console.WriteLine($"  Source: {sourceFile}:{sourceLine}");
        Console.WriteLine($"  Service lifetime: Scoped");
    }
}
```

## Performance Optimizations

### Incremental Generation

**Only regenerate what changed** for fast incremental builds:

```csharp
public class IncrementalGenerationContext {
    private readonly ConcurrentDictionary<string, string> _fileHashes = new();
    
    public bool HasFileChanged(string filePath, string content) {
        var currentHash = ComputeHash(content);
        var previousHash = _fileHashes.GetValueOrDefault(filePath);
        
        if (currentHash != previousHash) {
            _fileHashes[filePath] = currentHash;
            return true;
        }
        
        return false;
    }
    
    public void TrackGeneratedOutput(string outputKey, string content) {
        // Track what we generated so we can skip unchanged outputs
        _generatedOutputs[outputKey] = ComputeHash(content);
    }
}
```

### Compilation Performance

**Optimize for IDE experience**:

- **Syntax-only analysis** for most validations
- **Semantic analysis** only when necessary
- **Caching** of expensive operations
- **Parallel processing** of independent analysis
- **Early termination** when errors are found

## Best Practices

### Generator Design

1. **Keep generators focused** - Single responsibility per generator stage
2. **Minimize semantic model usage** - Use syntax analysis when possible
3. **Cache expensive operations** - Avoid redundant analysis
4. **Provide clear diagnostics** - Help developers understand issues
5. **Generate debuggable code** - Include source references and metadata

### IDE Integration

1. **Responsive navigation** - Fast lookups and searches
2. **Contextual information** - Show relevant details for current location
3. **Clear visualizations** - Easy to understand flow diagrams
4. **Helpful code lenses** - Actionable information overlays
5. **Intelligent suggestions** - Context-aware code completion

### Debug Experience

1. **No hidden magic** - Everything should be discoverable
2. **Clear error messages** - Point to exact problems and solutions
3. **Source mapping** - Connect generated code to source
4. **Metadata preservation** - Keep debug information through compilation
5. **Performance transparency** - Show timing and costs

---

## Related Documentation

- [**Domain Ownership**](./domain-ownership.md) - How ownership affects source generation
- [**Policy Engine**](./policy-engine.md) - Policy-based code generation
- [**Flags & Tags System**](./flags-tags-system.md) - Cross-service context propagation
- [**Testing & Development Tools**](./testing-development-tools.md) - Testing the generated code