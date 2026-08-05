---
title: Migration Guide Overview
version: 1.0.0
category: Migration Guide
order: 1
description: Overview of migrating from Marten/Wolverine and other frameworks to Whizbang
tags: 'migration, marten, wolverine, upgrade, conversion'
codeReferences:
  - tools/Whizbang.Migrate/Program.cs
  - tools/Whizbang.Migrate/Whizbang.Migrate.csproj
  - tools/Whizbang.Migrate/Commands/AnalyzeCommand.cs
  - tools/Whizbang.Migrate/Commands/ApplyCommand.cs
  - tools/Whizbang.Migrate/Wizard/DecisionFile.cs
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/IDispatcher.cs
testReferences:
  - tests/Whizbang.Migrate.Tests/Commands/AnalyzeCommandTests.cs
  - tests/Whizbang.Migrate.Tests/Commands/ApplyCommandTests.cs
  - tests/Whizbang.Migrate.Tests/Commands/StatusCommandTests.cs
  - tests/Whizbang.Migrate.Tests/Commands/RevertCommandTests.cs
  - tests/Whizbang.Migrate.Tests/Analysis/WolverineAnalyzerTests.cs
  - tests/Whizbang.Migrate.Tests/Analysis/MartenAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveForTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
verifiedAgainstCommit: a64ba9a0
verifiedDate: 2026-08-04
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

```bash{title="Automated Migration Tool" description="Whizbang provides a CLI migration tool to automate common transformations:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Bash", "Automated", "Migration", "Tool"]}
# Install the migration tool (command name: whizbang-migrate)
dotnet tool install -g SoftwareExtravaganza.Whizbang.Migrate

# Analyze your project (Wolverine + Marten detection)
whizbang-migrate analyze --project ./MyApp

# Preview what apply would change, without touching files
whizbang-migrate apply --project ./MyApp --dry-run

# Generate a decision file, review/edit it, then apply with your decisions
whizbang-migrate apply --project ./MyApp --generate-decision-file decisions.json
whizbang-migrate apply --project ./MyApp --decision-file decisions.json

# Scope the transformation set, or leave package refs alone
whizbang-migrate apply --project ./MyApp --include "**/Handlers/**" --exclude "**/obj/**"
whizbang-migrate apply --project ./MyApp --no-manage-packages

# Check migration status
whizbang-migrate status --project ./MyApp
```

`analyze` runs the Wolverine and Marten analyzers; `apply` runs the transformer suite
(handlers→receptors, projections→perspectives, message-bus→dispatcher, serialization, DI
registrations, and more) and manages package references unless `--no-manage-packages` is set.
Guided-vs-automatic control is the **decision file**: generate it, review each decision, then
apply. Use `--dry-run` first on any real codebase.

## Key Architectural Differences

### Zero Reflection

Whizbang uses Roslyn source generators for all discovery:

```csharp{title="Zero Reflection" description="Whizbang uses Roslyn source generators for all discovery:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Zero", "Reflection"] unverified="framework comparison — interface shape, no behavior to assert"}
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

```csharp{title="Pure Function Perspectives" description="Marten projections can have side effects." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pure", "Function", "Perspectives"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync", "IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_HasApplyMethodAsync"]}
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
| `LocalInvokeAsync` | In-process RPC (target < 20ns, zero allocation) | No |
| `PublishAsync` | Event broadcasting (fire-and-forget) | Yes |

## Getting Help

- **Troubleshooting** - Common migration issues
- **[GitHub Issues](https://github.com/whizbang-lib/whizbang/issues)** - Report problems
- **[Discussions](https://github.com/whizbang-lib/whizbang/discussions)** - Ask questions

---

*Last Updated: 2026-01-19 | Whizbang v1.0.0*
