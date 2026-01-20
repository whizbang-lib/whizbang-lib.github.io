# Migration Checklist

Use this checklist to track your Marten/Wolverine to Whizbang migration progress.

## Pre-Migration

- [ ] Review current Marten/Wolverine usage
- [ ] Document all handlers, projections, and transports in use
- [ ] Identify custom middleware and extensions
- [ ] Create migration branch in version control
- [ ] Set up parallel development environment
- [ ] Run `whizbang migrate analyze` to assess scope

## Project Setup

- [ ] Add `Whizbang.Core` package
- [ ] Add `Whizbang.Generators` package
- [ ] Add `Whizbang.Data.EFCore.Postgres` package
- [ ] Add transport package (RabbitMQ or Azure Service Bus)
- [ ] Update `TargetFramework` to `net10.0`
- [ ] Add global usings for Whizbang namespaces
- [ ] Configure separate schema (`options.SchemaName = "whizbang"`)
- [ ] Verify project builds successfully

## Handler Migration

- [ ] List all `IHandle<T>` implementations
- [ ] Create result types for each handler
- [ ] Convert handlers to `IReceptor<TMessage, TResult>`
- [ ] Update method signatures (`Handle` to `HandleAsync`)
- [ ] Replace `IDocumentSession` with `IEventStore`
- [ ] Replace `IMessageBus` with `IDispatcher`
- [ ] Update DI registrations
- [ ] Remove `[WolverineHandler]` attributes
- [ ] Verify all handlers have corresponding receptors

## Projection Migration

- [ ] List all `SingleStreamProjection<T>` classes
- [ ] List all `MultiStreamProjection<T>` classes
- [ ] Convert view classes to records
- [ ] Convert projections to `IPerspectiveFor<T, TEvent...>`
- [ ] Update `Apply` methods to return new instances
- [ ] Replace `Create` methods with `Apply(null, event)`
- [ ] Add `GetPartitionKey` methods for global perspectives
- [ ] Handle nullable `current` parameter
- [ ] Verify perspective output matches projection output

## Event Store Migration

- [ ] Replace `IDocumentStore` with `IEventStore`
- [ ] Update stream creation patterns
- [ ] Update event append patterns
- [ ] Update event reading patterns
- [ ] Configure optimistic concurrency if needed
- [ ] Plan data migration strategy
- [ ] Test event store operations

## Transport Configuration

- [ ] Identify current transport (RabbitMQ, Azure Service Bus)
- [ ] Configure Whizbang transport
- [ ] Map queue/topic names
- [ ] Configure subscriptions
- [ ] Configure publications
- [ ] Set up dead letter handling
- [ ] Configure retry policies
- [ ] Test message flow end-to-end

## Outbox Migration

- [ ] Replace `IMessageContext` with `IWorkCoordinator`
- [ ] Wrap transactional operations in work units
- [ ] Convert sagas to perspectives + receptors
- [ ] Configure retry and cleanup policies
- [ ] Set up outbox monitoring
- [ ] Test failure recovery scenarios

## Testing Migration

- [ ] Update test fixtures to `WhizbangTestFixture`
- [ ] Convert handler tests to receptor tests
- [ ] Convert projection tests to perspective tests
- [ ] Update mock patterns
- [ ] Configure test database isolation
- [ ] Verify all tests pass

## Parallel Running

- [ ] Configure both frameworks simultaneously
- [ ] Set up dual-write if needed
- [ ] Monitor both systems
- [ ] Compare outputs between old and new
- [ ] Document any behavioral differences
- [ ] Create rollback plan

## Validation

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing complete
- [ ] Performance benchmarks acceptable
- [ ] Error handling verified
- [ ] Logging and monitoring functional
- [ ] Documentation updated

## Cleanup

- [ ] Remove Marten package references
- [ ] Remove Wolverine package references
- [ ] Remove old handler classes
- [ ] Remove old projection classes
- [ ] Remove deprecated using statements
- [ ] Remove parallel running configuration
- [ ] Clean up temporary schemas
- [ ] Archive or remove migration bridge code

## Post-Migration

- [ ] Monitor production deployment
- [ ] Verify message processing rates
- [ ] Check error rates and alerts
- [ ] Update team documentation
- [ ] Conduct knowledge transfer
- [ ] Close migration tracking issues

---

## Quick Reference

### CLI Commands

```bash
# Analyze migration scope
whizbang migrate analyze --project ./src/MyService

# Generate migration plan
whizbang migrate plan --project ./src/MyService --output plan.json

# Apply migrations interactively
whizbang migrate apply --project ./src/MyService --guided

# Check migration status
whizbang migrate status

# Rollback to checkpoint
whizbang migrate rollback <checkpoint-id>
```

### Key Interface Mappings

| Marten/Wolverine | Whizbang |
|------------------|----------|
| `IDocumentStore` | `IEventStore` |
| `IHandle<T>` | `IReceptor<T, TResult>` |
| `SingleStreamProjection<T>` | `IPerspectiveFor<T, ...>` |
| `MultiStreamProjection<T>` | `IGlobalPerspectiveFor<T, ...>` |
| `IMessageBus` | `IDispatcher` |
| `IMessageContext` | `IWorkCoordinator` |

### Package References

```xml
<ItemGroup>
  <PackageReference Include="Whizbang.Core" Version="0.1.0" />
  <PackageReference Include="Whizbang.Generators" Version="0.1.0" />
  <PackageReference Include="Whizbang.Data.EFCore.Postgres" Version="0.1.0" />
  <PackageReference Include="Whizbang.Transports.RabbitMQ" Version="0.1.0" />
  <PackageReference Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />
</ItemGroup>
```

---

## Getting Help

- [Migration Guide Index](./README.md)
- [Whizbang Documentation](../v0.1.0/)
- [GitHub Issues](https://github.com/whizbang-lib/whizbang/issues)
- [Discord Community](https://discord.gg/whizbang)
