---
title: Whizbang Implementation Roadmap
category: Roadmap
order: 1
description: Complete implementation roadmap for building the Whizbang .NET library from foundation to production
tags: roadmap, implementation, planning, architecture
---

# Whizbang Implementation Roadmap

## Overview

This roadmap outlines the complete implementation plan for Whizbang, a unified event-sourced data and messaging runtime for .NET. We follow a **breadth-first approach**, establishing thin implementations of ALL major components early, then iteratively enhancing each component.

## Core Principles

- **Zero Reflection**: Everything discovered and wired at compile time via source generators
- **IDE-First Development**: Developer tools and traceability from day one
- **Test-Driven**: Comprehensive testing with TUnit and Bogus from the start
- **Progressive Enhancement**: Start simple, enhance iteratively
- **In-Memory First**: All components start with in-memory implementations that become test doubles

## Version Overview

### 🚀 [v0.1.0 - Foundation](../v0.1.0/README.md)
**Status**: Planning  
**Goal**: Minimal working implementation of EVERY major component
- All core interfaces and abstractions
- Source generators and analyzers
- IDE tools with CodeLens-style references
- Traceability and debugging foundation
- Complete testing framework with TUnit and Bogus
- In-memory implementations for all components

### 📈 [v0.2.0 - Event-Driven Enhancement](../v0.2.0/README.md)
**Status**: Planning  
**Goal**: Deepen event-driven capabilities
- Enhanced receptors with validation
- Rich event metadata and correlation
- Multiple perspectives per event
- Advanced lens query methods
- Policy engine enhancements

### 💾 [v0.3.0 - Event Sourcing](../v0.3.0/README.md)
**Status**: Planning  
**Goal**: Add stateful capabilities
- Stateful receptors
- Traditional aggregates
- Event store implementation
- Projections and snapshots
- Optimistic concurrency

### 🗄️ [v0.4.0 - Real Persistence](../v0.4.0/README.md)
**Status**: Planning  
**Goal**: Production-ready persistence
- PostgreSQL driver with JSONB
- SQL Server driver with JSON columns
- SQLite driver for edge scenarios
- Schema migrations
- Multi-tenancy support

### 📡 [v0.5.0 - Distributed Systems](../v0.5.0/README.md)
**Status**: Planning  
**Goal**: Enable distributed messaging
- Kafka transport
- RabbitMQ transport
- Outbox/Inbox patterns
- Saga orchestration
- Distributed tracing

### 🔮 [Future Versions](../future/README.md)
- **v0.6.0** - Production Hardening (Observability, Security, Compliance)
- **v0.7.0** - Performance & Scale (Zero allocation, AOT support)
- **v0.8.0** - Cloud Native (Kubernetes, Serverless)
- **v0.9.0** - Innovation (Effect system, AI integration)

## Component Architecture

### Core Components Present from v0.1.0

| Component | Purpose | Starting Implementation |
|-----------|---------|------------------------|
| **Dispatcher** | Message routing and coordination | In-memory routing with generated mappings |
| **Receptors** | Command receivers and decision makers | Stateless with parameter injection |
| **Perspectives** | Event handlers and write models | In-memory state updates |
| **Lenses** | Query interfaces and read models | In-memory LINQ queries |
| **Policy Engine** | Cross-cutting concerns | Retry, Timeout, Cache, CircuitBreaker |
| **Ledger** | Event store abstraction | In-memory event streams |
| **Drivers** | Storage abstraction | In-memory storage |
| **Transports** | Message broker abstraction | In-memory pub/sub |

### Developer Experience from Day One

| Feature | Purpose | Available From |
|---------|---------|----------------|
| **Source Generators** | Zero-reflection handler discovery | v0.1.0 |
| **Analyzers** | Compile-time validation | v0.1.0 |
| **IDE Tools** | CodeLens references, navigation | v0.1.0 |
| **Traceability** | Message flow visualization | v0.1.0 |
| **Time-Travel Debugging** | Step through message history | v0.1.0 |
| **Test Framework** | TUnit with Bogus scenarios | v0.1.0 |

## Success Metrics

### Technical Goals
- Zero reflection throughout the entire library
- Sub-millisecond in-memory operations
- <10ms p99 for database operations
- <100ms p99 for distributed operations
- 100% backward compatibility within major versions

### Quality Goals
- 100% test coverage of public APIs
- All code examples compile and run
- Complete documentation for every public API
- Analyzers catch common mistakes at compile time

### Developer Experience Goals
- IntelliSense for all configuration options
- One-click navigation between related components
- Visual debugging of message flow
- Comprehensive error messages with fixes

## Getting Started

1. **[Read the Philosophy](philosophy.md)** - Understand our core principles
2. **[Review the Architecture](architecture.md)** - See how components fit together
3. **[Start with v0.1.0](../v0.1.0/README.md)** - Begin with the foundation
4. **[Check Success Metrics](success-metrics.md)** - Understand how we measure progress

## Contributing

This roadmap is a living document. Each version's documentation contains:
- Detailed specifications for each component
- Code examples and patterns
- Testing requirements
- Migration guides from previous versions

## Navigation

### By Version
- [v0.1.0 - Foundation](../v0.1.0/README.md)
- [v0.2.0 - Event-Driven](../v0.2.0/README.md)
- [v0.3.0 - Event Sourcing](../v0.3.0/README.md)
- [v0.4.0 - Persistence](../v0.4.0/README.md)
- [v0.5.0 - Distributed](../v0.5.0/README.md)
- [Future Versions](../future/README.md)

### By Topic
- [Core Philosophy](philosophy.md)
- [Architecture Overview](architecture.md)
- [Success Metrics](success-metrics.md)
- [Testing Strategy](../v0.1.0/testing/README.md)
- [Developer Experience](../v0.1.0/developer-experience/README.md)