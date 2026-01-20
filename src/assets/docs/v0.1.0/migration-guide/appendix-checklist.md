---
title: "Migration Checklist"
version: 0.1.0
category: Migration Guide
order: 10
description: "Complete checklist for migrating from Marten/Wolverine to Whizbang"
tags: migration, checklist, verification, validation
---

# Migration Checklist

Use this checklist to track your migration progress from Marten/Wolverine to Whizbang.

## Phase 1: Project Setup

### Package Changes

- [ ] Remove Marten packages:
  - [ ] `Marten`
  - [ ] `Marten.AspNetCore`
  - [ ] `Marten.Events.Projections`

- [ ] Remove Wolverine packages:
  - [ ] `Wolverine`
  - [ ] `Wolverine.Marten`
  - [ ] `WolverineFx.RabbitMQ`
  - [ ] `WolverineFx.AzureServiceBus`
  - [ ] `WolverineFx.Kafka`

- [ ] Add Whizbang packages:
  - [ ] `Whizbang.Core`
  - [ ] `Whizbang.Generators` (as Analyzer)
  - [ ] `Whizbang.Data.EFCore.Postgres` or `Whizbang.Data.Dapper.Postgres`
  - [ ] `Whizbang.Transports.RabbitMQ`
  - [ ] `Whizbang.Transports.AzureServiceBus`
  - [ ] `Whizbang.Testing` (test projects)

### Configuration

- [ ] Update `Program.cs`:
  - [ ] Replace `AddMarten()` with `AddWhizbang()`
  - [ ] Remove `UseWolverine()`
  - [ ] Configure transport (RabbitMQ/Azure Service Bus)
  - [ ] Add work coordinator

- [ ] Update configuration files:
  - [ ] `appsettings.Development.json` (RabbitMQ)
  - [ ] `appsettings.Production.json` (Azure Service Bus)
  - [ ] Add `UseRabbitMQ` toggle

- [ ] Initialize database schema:
  - [ ] Add schema initialization on startup
  - [ ] Verify Whizbang tables created

---

## Phase 2: Handler Migration

### Convert Wolverine Handlers to Receptors

For each handler:

- [ ] Remove `[WolverineHandler]` attribute
- [ ] Implement `IReceptor<TMessage, TResult>` or `IReceptor<TMessage>`
- [ ] Rename method to `HandleAsync`
- [ ] Change return type to `ValueTask<TResult>` or `ValueTask`
- [ ] Add `CancellationToken` parameter
- [ ] Convert method injection to constructor injection
- [ ] Split multi-handler classes into separate receptors
- [ ] Update namespace usings

### Handler Checklist Template

| Handler | Status | Receptor Name | Notes |
|---------|--------|---------------|-------|
| `OrderHandler.Handle(CreateOrder)` | ☐ | `CreateOrderReceptor` | |
| `OrderHandler.Handle(ShipOrder)` | ☐ | `ShipOrderReceptor` | |
| `NotificationHandler.Handle(SendEmail)` | ☐ | `SendEmailReceptor` | Void receptor |

---

## Phase 3: Projection Migration

### Convert Marten Projections to Perspectives

For each projection:

- [ ] Replace `SingleStreamProjection<T>` with `IPerspectiveFor<T, TEvent...>`
- [ ] Replace `MultiStreamProjection<T, TKey>` with `IGlobalPerspectiveFor<...>`
- [ ] Convert mutation to immutable (`model.X = y` → `current with { X = y }`)
- [ ] Move async operations to receptors
- [ ] Use `sealed record` for model types
- [ ] Add variadic event types to interface
- [ ] Implement `GetPartitionKey` for global perspectives

### Projection Checklist Template

| Projection | Status | Perspective Name | Events |
|------------|--------|------------------|--------|
| `OrderSummaryProjection` | ☐ | `OrderSummaryPerspective` | Created, Shipped, Cancelled |
| `CustomerStatsProjection` | ☐ | `CustomerStatsPerspective` | OrderCreated, OrderCompleted |

---

## Phase 4: Event Store Migration

### Update Event Store Usage

- [ ] Replace `IDocumentStore` with `IEventStore`
- [ ] Replace `IDocumentSession` with direct `IEventStore` injection
- [ ] Replace `session.Events.Append()` with `eventStore.AppendAsync<T>()`
- [ ] Create `MessageEnvelope<T>` for each event
- [ ] Use `Guid.CreateVersion7()` for new stream IDs
- [ ] Remove `session.SaveChangesAsync()` calls
- [ ] Update concurrency handling to sequence-based
- [ ] Update event queries to use `IEventStore` methods

---

## Phase 5: Messaging Migration

### Transport Configuration

- [ ] Configure RabbitMQ for local development
- [ ] Configure Azure Service Bus for production
- [ ] Set up environment-based switching
- [ ] Add health checks for transport
- [ ] Update Aspire integration (if using)

### Outbox/Inbox

- [ ] Remove `UseDurableOutbox()` configuration
- [ ] Remove `UseDurableInbox()` configuration
- [ ] Configure `IWorkCoordinatorStrategy`
- [ ] Add `WorkCoordinatorPublisherWorker` hosted service
- [ ] Update retry policies

---

## Phase 6: Testing Migration

### Test Framework

- [ ] Replace xUnit/NUnit with TUnit
- [ ] Replace Moq/NSubstitute with Rocks
- [ ] Replace FluentAssertions with TUnit.Assertions
- [ ] Add `Async` suffix to all async test methods

### Test Updates

- [ ] Update assertion syntax to `await Assert.That(...)`
- [ ] Update mock syntax to Rocks patterns
- [ ] Add Whizbang.Testing package
- [ ] Configure in-memory event store for unit tests
- [ ] Set up TestContainers for integration tests

### Test Coverage

- [ ] Update receptor tests
- [ ] Create perspective tests (pure function tests)
- [ ] Update integration tests
- [ ] Update CI pipeline

---

## Phase 7: Verification

### Build Verification

- [ ] Solution builds without errors
- [ ] No Marten/Wolverine namespace warnings
- [ ] Source generators produce expected output
- [ ] `dotnet format` passes

### Runtime Verification

- [ ] Application starts successfully
- [ ] Database schema initialized
- [ ] Receptors discovered (check logs)
- [ ] Perspectives registered
- [ ] Transport connected

### Functional Verification

- [ ] Events persist to database
- [ ] Perspectives update correctly
- [ ] Messages published to transport
- [ ] Outbox processes messages
- [ ] Inbox deduplicates messages

### Test Verification

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Test coverage maintained or improved

---

## Phase 8: Cleanup

### Code Cleanup

- [ ] Remove unused Marten/Wolverine files
- [ ] Remove old configuration classes
- [ ] Update XML documentation
- [ ] Run `dotnet format`

### Documentation

- [ ] Update README
- [ ] Update architecture diagrams
- [ ] Update deployment documentation
- [ ] Update onboarding guides

### Deployment

- [ ] Update CI/CD pipeline
- [ ] Update environment variables
- [ ] Update secrets management
- [ ] Plan production rollout

---

## Quick Reference

### Namespace Changes

```csharp
// Remove
using Marten;
using Marten.Events;
using Marten.Events.Projections;
using Wolverine;
using Wolverine.Attributes;

// Add
using Whizbang.Core;
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives;
```

### Key Pattern Changes

| Before | After |
|--------|-------|
| `IDocumentStore` | `IEventStore` |
| `IDocumentSession` | Direct injection |
| `[WolverineHandler]` | `IReceptor<T>` interface |
| `SingleStreamProjection<T>` | `IPerspectiveFor<T, TEvent...>` |
| `session.Events.Append()` | `eventStore.AppendAsync<T>()` |
| `model.X = y` | `current with { X = y }` |

---

## Automated Migration Tool

Use `whizbang-migrate` to automate common transformations:

```bash
# Install
dotnet tool install -g whizbang-migrate

# Analyze
whizbang migrate analyze --project ./MyApp.sln

# Plan
whizbang migrate plan --project ./MyApp.sln

# Apply (guided)
whizbang migrate apply --mode guided

# Check status
whizbang migrate status
```

---

*Need help? See [Troubleshooting](appendix-troubleshooting.md) or open an issue on GitHub.*
