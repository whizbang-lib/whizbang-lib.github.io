# Migrate from Marten/Wolverine

This guide provides step-by-step instructions for migrating applications from Marten/Wolverine to Whizbang.

## Overview

Whizbang is a modern, AOT-compatible event-driven framework that provides:
- Zero-reflection architecture via source generators
- Native AOT support from day one
- Type-safe message routing with compile-time validation
- Built-in observability and distributed tracing

## Migration Approach

We recommend a **gradual migration** strategy:

1. **Add Whizbang packages** alongside existing Marten/Wolverine
2. **Migrate handlers** one at a time using the automated tooling
3. **Run in parallel** to validate behavior
4. **Remove legacy dependencies** once migration is complete

## Quick Start

```bash
# Install the migration CLI tool
dotnet tool install -g whizbang-migrate

# Analyze your project for migration scope
whizbang migrate analyze --project ./src/MyService

# Create a migration plan
whizbang migrate plan --project ./src/MyService --output migration-plan.json

# Apply migrations (interactive mode recommended for first run)
whizbang migrate apply --project ./src/MyService --guided
```

## Guide Contents

1. **[Concept Mapping](./01-concept-mapping.md)** - Core concept translations between frameworks
2. **[Project Setup](./02-project-setup.md)** - NuGet packages and configuration
3. **[Handler Migration](./03-handler-migration.md)** - Wolverine handlers to Receptors
4. **[Projection Migration](./04-projection-migration.md)** - Marten projections to Perspectives
5. **[Event Store Migration](./05-event-store-migration.md)** - IDocumentStore to IEventStore
6. **[Transport Configuration](./06-transport-configuration.md)** - RabbitMQ/Azure Service Bus
7. **[Outbox Migration](./07-outbox-migration.md)** - Durable outbox patterns
8. **[Testing Migration](./08-testing-migration.md)** - Testing strategy changes
9. **[Migration Checklist](./appendix-checklist.md)** - Complete checklist

## Prerequisites

- .NET 10.0 or later
- Existing Marten/Wolverine application
- PostgreSQL database (for event store)

## CLI Tool Reference

The `whizbang migrate` CLI provides automated migration assistance:

| Command | Description |
|---------|-------------|
| `analyze` | Scan project and report migration scope |
| `plan` | Generate migration plan without applying changes |
| `apply` | Apply migrations (supports `--guided` for interactive mode) |
| `rollback` | Revert to a previous checkpoint |
| `status` | Show current migration status |

See each section for detailed migration instructions.
