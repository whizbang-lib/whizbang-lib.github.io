# Architecture Documentation

Core architectural patterns and design decisions for the Whizbang library.

## Documents

### Core Architecture
- [**sequence-leasing.md**](sequence-leasing.md) - Sequence reservation and lease management system
- [**where-clause-explosion.md**](where-clause-explosion.md) - Converting LINQ expressions to concrete entity operations
- [**projection-storage.md**](projection-storage.md) - How projection results are stored and replayed
- [**lease-expiration-handling.md**](lease-expiration-handling.md) - Recovery strategies for expired sequence leases

### System Design
- [**concurrency-patterns.md**](concurrency-patterns.md) - Thread safety and concurrent processing
- [**event-ordering.md**](event-ordering.md) - Maintaining event order across distributed operations
- [**storage-engines.md**](storage-engines.md) - Pluggable storage backend design

### Performance
- [**optimization-strategies.md**](optimization-strategies.md) - System-wide performance optimization
- [**memory-management.md**](memory-management.md) - Memory usage patterns and GC optimization
- [**scaling-patterns.md**](scaling-patterns.md) - Horizontal and vertical scaling approaches

## Key Concepts

### Sequence Leasing
The innovative approach to maintaining event ordering while allowing long-running operations to proceed without blocking sequence generation.

### Where Clause Explosion
Converting developer-friendly LINQ expressions into concrete entity ID lists for deterministic replay and optimal performance.

### Projection Result Framework
The declarative system that allows perspectives to specify operations without direct storage dependencies.

## Design Principles

1. **Performance First**: All decisions prioritize runtime performance
2. **Developer Experience**: Internal complexity should not leak to users
3. **Deterministic Replay**: All operations must be perfectly reproducible
4. **Zero Reflection**: Compile-time code generation for optimal performance
5. **Fault Tolerance**: Graceful handling of failures and edge cases