---
title: Domain Ownership
category: Architecture & Design
order: 6
tags: domain-ownership, commands, events, namespace-policies, attributes
---

# Domain Ownership

Whizbang enforces explicit domain ownership to prevent distributed system chaos. Every command and event has a clear owner, enabling proper routing, authorization, and system boundaries.

## Ownership Determination Order

Domain ownership is determined in **user-configurable order**, with this **default precedence**:

1. **Namespace Convention** (highest priority)
2. **Attributes** 
3. **Configuration-Driven** (lowest priority)

Each level can override previous levels, giving developers full control.

## 1. Namespace Convention (Default First)

**Automatic ownership** derived from namespace structure:

```csharp{title="Namespace-Based Domain Ownership" description="Automatic domain ownership derived from namespace structure" category="Design" difficulty="BEGINNER" tags=["domain-ownership", "namespace-convention", "commands", "events"] framework="NET8"}
// Orders domain
namespace MyApp.Orders.Commands {
    public record PlaceOrder(Guid OrderId, Guid CustomerId, List<OrderItem> Items);
    // Domain: "Orders" (extracted from namespace)
}

namespace MyApp.Orders.Events {
    public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);
    // Domain: "Orders"
}

// Inventory domain  
namespace MyApp.Inventory.Commands {
    public record ReserveStock(Guid ProductId, int Quantity);
    // Domain: "Inventory"
}
```

### Namespace Policy Configuration

```csharp{title="Namespace Policy Configuration" description="Configuring namespace extraction policies for domain ownership" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "configuration", "namespace-policy", "setup"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        // Configure namespace extraction policies
        ownership.NamespacePolicy(policy => {
            // Default: Extract domain from namespace segment
            policy.ExtractDomainFromNamespace = true;
            policy.DomainNamespacePosition = 1; // MyApp.[Domain].Commands
            
            // Custom extraction function
            policy.DomainExtractor = (type) => {
                var segments = type.Namespace.Split('.');
                if (segments.Length >= 3 && segments[1] == "Domains") {
                    return segments[2]; // MyApp.Domains.[Domain].Commands
                }
                return segments.Length >= 2 ? segments[1] : "Default";
            };
            
            // Namespace patterns
            policy.CommandNamespacePattern = "*.Commands";
            policy.EventNamespacePattern = "*.Events";
            policy.QueryNamespacePattern = "*.Queries";
        });
    });
});
```

## 2. Attribute-Based Ownership

**Explicit declaration** using attributes:

```csharp{title="Attribute-Based Domain Ownership" description="Explicit domain ownership declaration using attributes" category="Design" difficulty="BEGINNER" tags=["domain-ownership", "attributes", "explicit-declaration", "override"] framework="NET8"}
[OwnedBy("Orders")]
public record PlaceOrder(Guid OrderId, Guid CustomerId, List<OrderItem> Items);

[OwnedBy("Orders")]
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);

// Override namespace convention
namespace MyApp.Shared.Commands {
    [OwnedBy("Inventory")] // Overrides "Shared" from namespace
    public record ReserveStock(Guid ProductId, int Quantity);
}
```

### Attribute Policies

```csharp{title="Attribute Policy Configuration" description="Configuring attribute-based ownership policies" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "attribute-policy", "configuration", "custom-attributes"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.AttributePolicy(policy => {
            // Require explicit ownership for certain patterns
            policy.RequireExplicitOwnership<ICommand>();
            policy.RequireExplicitOwnership(type => type.Name.EndsWith("Command"));
            
            // Default ownership for unattributed types
            policy.DefaultDomain = "Shared";
            
            // Custom attribute types
            policy.RecognizeAttribute<DomainAttribute>();
            policy.RecognizeAttribute<BoundedContextAttribute>();
        });
    });
});
```

## 3. Configuration-Driven Ownership

**Centralized registration** in Program.cs:

```csharp{title="Configuration-Driven Ownership" description="Centralized domain registration with explicit ownership" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "configuration", "domain-registration", "centralized-config"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        // Register domains with explicit ownership
        ownership.RegisterDomain("Orders", domain => {
            domain.OwnsCommand<PlaceOrder>();
            domain.OwnsCommand<UpdateOrder>();
            domain.OwnsEvent<OrderPlaced>();
            domain.OwnsEvent<OrderUpdated>();
            
            // Override other declarations
            domain.OwnsCommand<SpecialSharedCommand>(); // Takes from "Shared"
        });
        
        ownership.RegisterDomain("Inventory", domain => {
            domain.OwnsCommand<ReserveStock>();
            domain.OwnsCommand<ReleaseStock>();
            domain.OwnsEvent<StockReserved>();
            domain.OwnsEvent<StockReleased>();
        });
    });
});
```

## Interface and Inheritance Policies

### Interface-Based Ownership

```csharp{title="Interface-Based Ownership" description="Interface-based domain ownership with marker interfaces" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "interface-based", "marker-interfaces", "configuration"] framework="NET8"}
// Domain marker interfaces
public interface IOrderCommand : ICommand { }
public interface IInventoryCommand : ICommand { }

public record PlaceOrder(...) : IOrderCommand;
public record ReserveStock(...) : IInventoryCommand;

// Configure interface-based ownership
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.InterfacePolicy(policy => {
            policy.RegisterInterface<IOrderCommand>("Orders");
            policy.RegisterInterface<IInventoryCommand>("Inventory");
            policy.RegisterInterface<ISharedCommand>("Shared");
        });
    });
});
```

### Inheritance-Based Ownership

```csharp{title="Inheritance-Based Ownership" description="Inheritance-based domain ownership with base command classes" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "inheritance-based", "base-classes", "configuration"] framework="NET8"}
// Base classes for domains
public abstract class OrderCommand : ICommand {
    // Common order command properties
}

public abstract class InventoryCommand : ICommand {
    // Common inventory command properties  
}

public class PlaceOrder : OrderCommand {
    // Inherits "Orders" domain
}

// Configure inheritance-based ownership
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.InheritancePolicy(policy => {
            policy.RegisterBaseClass<OrderCommand>("Orders");
            policy.RegisterBaseClass<InventoryCommand>("Inventory");
        });
    });
});
```

## Custom Ownership Precedence

**Developer controls the order** of ownership determination:

```csharp{title="Custom Ownership Precedence" description="Custom ownership precedence order configuration" category="Design" difficulty="ADVANCED" tags=["domain-ownership", "precedence-order", "configuration", "custom-rules"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        // Custom precedence order
        ownership.PrecedenceOrder(
            DomainOwnershipSource.Attributes,        // Check attributes first
            DomainOwnershipSource.Configuration,     // Then explicit config
            DomainOwnershipSource.Interfaces,        // Then interfaces
            DomainOwnershipSource.Inheritance,       // Then inheritance
            DomainOwnershipSource.Namespace          // Finally namespace
        );
        
        // Or use fluent API
        ownership.CheckAttributesFirst()
                 .ThenConfiguration()
                 .ThenInterfaces()
                 .ThenInheritance()
                 .FinallyNamespace();
    });
});
```

## Complex Policy Examples

### Multi-Level Namespace Extraction

```csharp{title="Multi-Level Namespace Extraction" description="Multi-level namespace extraction with complex custom logic" category="Design" difficulty="ADVANCED" tags=["domain-ownership", "namespace-extraction", "multi-level", "custom-logic"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.NamespacePolicy(policy => {
            policy.DomainExtractor = (type) => {
                var ns = type.Namespace;
                
                // MyApp.Domains.Orders.Commands -> "Orders"
                if (ns.Contains(".Domains.")) {
                    var segments = ns.Split('.');
                    var domainIndex = Array.IndexOf(segments, "Domains") + 1;
                    return domainIndex < segments.Length ? segments[domainIndex] : "Unknown";
                }
                
                // MyApp.Orders.V2.Commands -> "Orders"
                var parts = ns.Split('.');
                if (parts.Length >= 2) {
                    return parts[1]; // Second segment is domain
                }
                
                return "Default";
            };
        });
    });
});
```

### Conditional Ownership Rules

```csharp{title="Conditional Ownership Rules" description="Conditional ownership rules based on type patterns and assemblies" category="Design" difficulty="ADVANCED" tags=["domain-ownership", "conditional-rules", "assembly-based", "integration-events"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.ConditionalRules(rules => {
            // Integration events are always "Shared"
            rules.When(type => type.Name.EndsWith("IntegrationEvent"))
                 .AssignToDomain("Shared");
            
            // Commands from external assemblies go to "External"
            rules.When(type => !type.Assembly.GetName().Name.StartsWith("MyApp"))
                 .AssignToDomain("External");
                 
            // Saga commands inherit from the saga's domain
            rules.When(type => typeof(ISagaCommand).IsAssignableFrom(type))
                 .ExtractDomainFromProperty("SagaDomain");
        });
    });
});
```

### Assembly-Based Policies

```csharp{title="Assembly-Based Policies" description="Assembly-based domain ownership with naming conventions" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "assembly-based", "assembly-mapping", "naming-convention"] framework="NET8"}
services.AddWhizbang(options => {
    options.DomainOwnership(ownership => {
        ownership.AssemblyPolicy(policy => {
            // Each assembly represents a domain
            policy.MapAssemblyToDomain("MyApp.Orders", "Orders");
            policy.MapAssemblyToDomain("MyApp.Inventory", "Inventory");
            policy.MapAssemblyToDomain("MyApp.Shipping", "Shipping");
            
            // Assembly naming convention
            policy.ExtractDomainFromAssemblyName = true;
            policy.AssemblyNamePattern = "MyApp.{Domain}";
        });
    });
});
```

## Runtime Ownership Resolution

### Ownership Discovery API

```csharp{title="Domain Ownership Resolver API" description="Domain ownership resolver API for runtime discovery" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "runtime-resolution", "api", "interface"] framework="NET8"}
public interface IDomainOwnershipResolver {
    string ResolveDomain<T>();
    string ResolveDomain(Type type);
    bool IsDomainOwner<T>(string domain);
    IEnumerable<string> GetAllDomains();
    IEnumerable<Type> GetDomainTypes(string domain);
}

// Usage
```csharp{title="Using Domain Ownership Resolver" description="Example of using domain ownership resolver in a controller" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "controllers", "usage-example", "resolver"] framework="NET8"}
public class OrderController : ControllerBase {
    private readonly IDomainOwnershipResolver _ownership;
    
    public OrderController(IDomainOwnershipResolver ownership) {
        _ownership = ownership;
    }
    
    public async Task<IActionResult> PlaceOrder(PlaceOrderRequest request) {
        var domain = _ownership.ResolveDomain<PlaceOrder>();
        // domain = "Orders"
        
        var command = new PlaceOrder(request.OrderId, request.CustomerId, request.Items);
        await _mediator.Send(command);
        
        return Ok();
    }
}
```

### Compile-Time Validation

**Roslyn analyzer** enforces ownership rules:

```csharp{title="Compile-Time Validation" description="Compile-time validation of domain ownership rules with Roslyn analyzers" category="Design" difficulty="ADVANCED" tags=["domain-ownership", "compile-time-validation", "roslyn-analyzers", "source-generators"] framework="NET8"}
// This will generate a compile error
[OwnedBy("Orders")]
public record PlaceOrder(...);

// In different assembly/project
public class InventoryHandler : ICommandHandler<PlaceOrder> {
    // ERROR: InventoryHandler cannot handle PlaceOrder - different domains
    public async Task Handle(PlaceOrder command) { ... }
}
```

### Source Generator Support

```csharp{title="Auto-Generated Domain Registry" description="Auto-generated domain ownership registry for runtime lookups" category="Design" difficulty="ADVANCED" tags=["domain-ownership", "source-generation", "code-generation", "registry"] framework="NET8"}
// Generated at compile time
[GeneratedCode("Whizbang.SourceGenerator")]
public static class DomainOwnershipRegistry {
    public static readonly Dictionary<Type, string> TypeToDomain = new() {
        { typeof(PlaceOrder), "Orders" },
        { typeof(OrderPlaced), "Orders" },
        { typeof(ReserveStock), "Inventory" },
        { typeof(StockReserved), "Inventory" }
    };
    
    public static readonly Dictionary<string, HashSet<Type>> DomainToTypes = new() {
        { "Orders", new HashSet<Type> { typeof(PlaceOrder), typeof(OrderPlaced) } },
        { "Inventory", new HashSet<Type> { typeof(ReserveStock), typeof(StockReserved) } }
    };
}
```

## Command Routing Based on Ownership

### In-Process Routing

```csharp{title="In-Process Command Routing" description="Local command routing within the same domain service" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "routing", "in-process-communication", "local-handling"] framework="NET8"}
// Same domain - route locally
var command = new PlaceOrder(...);
var domain = _ownership.ResolveDomain<PlaceOrder>(); // "Orders"
var handler = _serviceProvider.GetRequiredService<ICommandHandler<PlaceOrder>>();
await handler.Handle(command);
```

### Cross-Service Routing

```csharp{title="Cross-Service Command Routing" description="Cross-service command routing based on domain ownership" category="Design" difficulty="INTERMEDIATE" tags=["domain-ownership", "routing", "cross-service-communication", "message-broker"] framework="NET8"}
// Different domain - route via message broker
var command = new ReserveStock(...);
var domain = _ownership.ResolveDomain<ReserveStock>(); // "Inventory"

if (domain != _currentDomain) {
    // Send to remote service
    await _messageBroker.SendToService(domain, command);
} else {
    // Handle locally
    await _localMediator.Send(command);
}
```

## Best Practices

### Ownership Guidelines

1. **Be explicit** - Prefer attributes over conventions for critical commands
2. **Consistent patterns** - Use the same ownership style within a domain
3. **Document policies** - Make namespace and interface conventions clear
4. **Validate early** - Use analyzers to catch ownership violations
5. **Monitor boundaries** - Track cross-domain communication patterns

### Policy Design

1. **Start simple** - Begin with namespace conventions
2. **Add specificity** - Use attributes for exceptions
3. **Centralize overrides** - Use configuration for edge cases
4. **Test policies** - Ensure ownership resolution works as expected
5. **Version carefully** - Changing ownership affects routing

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - Storage architecture
- [**Concurrency Control**](./concurrency-control.md) - Managing concurrent updates  
- [**Multi-Tenancy**](./multi-tenancy.md) - Tenant isolation with domain ownership