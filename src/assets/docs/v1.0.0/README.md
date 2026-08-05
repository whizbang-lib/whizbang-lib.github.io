---
title: Whizbang Documentation
pageType: overview
category: Overview
order: 1
version: 1.0.0
description: >-
  Landing page for the Whizbang v1.0.0 documentation set — core components,
  getting started, operations, and testing
tags: 'overview, documentation, components, getting-started'
verifiedAgainstCommit: a64ba9a0
verifiedDate: 2026-08-04
---

# Whizbang Documentation

Whizbang is a .NET event-sourcing and messaging framework built around
source-generated (zero-reflection) wiring: commands flow through the
**Dispatcher** to **Receptors**, events are recorded in the **Ledger** and
projected by **Perspectives**, and **Lenses** answer queries — with storage
**Drivers** and message **Transports** as pluggable infrastructure.

New here? Start with **[Installation](./getting-started/installation.md)**
and the **[Quick Start](./getting-started/quick-start.md)**.

## Core Components

- **[Dispatcher](./fundamentals/dispatcher/dispatcher.md)** - Message routing and coordination
- **[Receptors](./fundamentals/receptors/receptors.md)** - Command receivers (stateless)
- **[Perspectives](./fundamentals/perspectives/perspectives.md)** - Event projection into read models
- **[Lenses](./fundamentals/lenses/lenses.md)** - Query interfaces
- **[Policy Engine](./operations/infrastructure/policy-engine.md)** - Cross-cutting concerns
- **[Ledger](./fundamentals/events/ledger.md)** - Event store
- **[Drivers](./data/drivers.md)** - Storage abstraction
- **[Transports](./messaging/transports/transports.md)** - Message broker abstraction

## Going Deeper

- **[Learn](./learn/tutorial/tutorial-overview.md)** — the multi-service tutorial, plus
  worked examples: [event sourcing & CQRS](./learn/examples/event-sourcing-cqrs.md),
  [microservices orchestration](./learn/examples/microservices-orchestration.md),
  [multi-tenant SaaS](./learn/examples/multi-tenant-saas.md), and
  [real-time analytics](./learn/examples/real-time-analytics.md)
- **[Testing](./operations/testing/testing-receptors.md)** — receptor testing and
  [lifecycle synchronization](./operations/testing/lifecycle-synchronization.md)
- **[Resilience](./resilience/stream-integrity.md)** — stream integrity,
  [managed-resource health](./resilience/managed-resource-health.md), and
  [database-availability middleware](./resilience/database-availability-middleware.md)
- **[Extending](./extending/source-generators/receptor-discovery.md)** — source
  generators, analyzers, attributes, and extension points
- **[Migration Guide](./migration-guide/README.md)** — moving from
  Marten/Wolverine and other frameworks

## Support

- **Issues**: [github.com/whizbang-lib/whizbang/issues](https://github.com/whizbang-lib/whizbang/issues)
- **Discussions**: [github.com/whizbang-lib/whizbang/discussions](https://github.com/whizbang-lib/whizbang/discussions)
