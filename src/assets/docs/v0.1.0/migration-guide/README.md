---
title: "Migration Guide Overview"
version: 0.1.0
category: Migration Guide
order: 1
description: "Overview of migrating from Marten/Wolverine and other frameworks to Whizbang"
tags: migration, marten, wolverine, upgrade, conversion
codeReferences:
  - tools/Whizbang.Migrate/Core/MigrationEngine.cs
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
---

# Migration Guide Overview

This guide helps you migrate from **Marten/Wolverine** (the "Critter Stack") and other CQRS/event-sourcing frameworks to Whizbang.

## Why Migrate to Whizbang?

| Feature | Marten/Wolverine | Whizbang |
|---------|------------------|----------|
| **Reflection** | Runtime reflection | Zero reflection (source generators) |
| **AOT Support** | Partial | Full Native AOT from day one |
| **Database Support** | PostgreSQL only | PostgreSQL, SQLite, extensible |
| **Multi-Tenancy** | Manual | First-class support |
| **Projections** | Async (side effects allowed) | Pure functions (deterministic) |
| **Dashboard** | Not included | Integrated (planned) |

## Migration Paths

### From Marten/Wolverine

The most common migration path. Covers:

1. **[Concept Mapping](01-concept-mapping.md)** - Understand how Marten/Wolverine concepts translate to Whizbang
2. **[Project Setup](02-project-setup.md)** - NuGet packages and initial configuration
3. **[Handler Migration](03-handler-migration.md)** - Convert Wolverine handlers to Whizbang Receptors
4. **[Projection Migration](04-projection-migration.md)** - Convert Marten projections to Whizbang Perspectives
5. **[Event Store Migration](05-event-store-migration.md)** - Adapt event store patterns
6. **[Transport Configuration](06-transport-configuration.md)** - Configure RabbitMQ/Azure Service Bus
7. **[Outbox Migration](07-outbox-migration.md)** - Migrate durable outbox patterns
8. **[Testing Migration](08-testing-migration.md)** - Update test infrastructure

### Migration Checklist

See the **[Migration Checklist](appendix-checklist.md)** for a complete step-by-step checklist.

## Automated Migration Tool

Whizbang provides a CLI migration tool to automate common transformations:

```bash
# Install the migration tool
dotnet tool install -g whizbang-migrate

# Analyze your project
whizbang migrate analyze --project ./MyApp.sln

# Create a migration plan
whizbang migrate plan --project ./MyApp.sln --output migration-plan.json

# Apply migrations (guided mode with human review)
whizbang migrate apply --mode guided

# Apply migrations (full automation)
whizbang migrate apply --mode auto
```

The tool uses **git worktrees** for safe, isolated migrations with automatic rollback on failure.

See the [Migration Tool Documentation](../tools/whizbang-migrate.md) for details.

## Key Architectural Differences

### Zero Reflection

Whizbang uses Roslyn source generators for all discovery:

```csharp
// Wolverine - Runtime discovery via attributes
[WolverineHandler]
public class OrderHandler {
    public OrderCreated Handle(CreateOrder cmd) { ... }
}

// Whizbang - Compile-time discovery via interface
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct) { ... }
}
```

### Pure Function Perspectives

Marten projections can have side effects. Whizbang Perspectives are **pure functions**:

```csharp
// Marten - Mutation allowed
public void Apply(OrderSummary model, OrderCreated @event) {
    model.Total += @event.Total;  // Mutates model
}

// Whizbang - Pure function, returns new model
public OrderSummary Apply(OrderSummary current, OrderCreated @event) {
    return current with { Total = current.Total + @event.Total };  // Returns new
}
```

### Three Dispatch Patterns

Whizbang's `IDispatcher` provides three distinct patterns:

| Pattern | Use Case | Wire Support |
|---------|----------|--------------|
| `SendAsync` | Command dispatch with delivery receipt | Yes |
| `LocalInvokeAsync` | In-process RPC (< 20ns, zero allocation) | No |
| `PublishAsync` | Event broadcasting (fire-and-forget) | Yes |

## Getting Help

- **[Troubleshooting](appendix-troubleshooting.md)** - Common migration issues
- **[GitHub Issues](https://github.com/whizbang/whizbang/issues)** - Report problems
- **[Discussions](https://github.com/whizbang/whizbang/discussions)** - Ask questions

---

*Last Updated: 2026-01-19 | Whizbang v0.1.0*
