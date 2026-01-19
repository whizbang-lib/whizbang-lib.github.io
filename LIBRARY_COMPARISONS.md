# .NET CQRS / Event Sourcing / Messaging Libraries - Comprehensive Comparison

**Last Updated**: 2025-10-18
**Whizbang Target Version**: 1.0.0

This document provides versioned comparisons of Whizbang against competing .NET libraries for CQRS, event sourcing, and messaging.

---

## Quick Reference: Library Categories

### Event Sourcing Focused
- **Marten** (v8.0, 2025) - PostgreSQL document DB + event store
- **EventStoreDB** (v21.10+, 2025) - Purpose-built event store database
- **Equinox** (v4.1.0, 2024) - F#-first, multi-backend event sourcing library
- **Eventuous** (v0.15+, 2025) - Event sourcing library for .NET
- **SqlStreamStore** (v1.2.0, 2020) - SQL-based stream store (unmaintained)

### Messaging Focused
- **Wolverine** (v4.0, 2025) - Messaging + mediator framework
- **MassTransit** (v8.0+, 2025) - Distributed messaging framework
- **NServiceBus** (v9.0+, 2025) - Enterprise service bus (commercial)
- **Rebus** (v8.0+, 2025) - Lightweight service bus
- **Brighter** (v10.0.1, 2025) - Command processor + messaging
- **CAP** (v8.3.5, 2025) - Event bus + outbox pattern

### Mediator Focused
- **MediatR** (v12.0+, 2024) - In-process mediator

### Actor-Based
- **Akka.NET** (v1.5+, 2025) - Actor model with persistence
- **Akkatecture** (v1.0+, 2024) - CQRS/ES framework on Akka.NET

### Whizbang Focus
- **All-in-one**: Event Sourcing + Projections + Messaging + Mediator

---

## Feature Comparison Matrix

| Feature | Whizbang<br/>v1.0 | Marten + Wolverine<br/>v8.0 + v4.0 | MediatR<br/>v12.0 | MassTransit<br/>v8.0 | NServiceBus<br/>v9.0 | Equinox<br/>v4.1.0 | EventStoreDB<br/>v21.10 | CAP<br/>v8.3.5 | Rebus<br/>v8.0 | Brighter<br/>v10.0 | Akka.NET<br/>v1.5 | Eventuous<br/>v0.15 |
|---------|-----------|-------------|---------|-------------|-------------|---------|--------------|-------|--------|---------|---------|----------|
| **Event Sourcing** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ✅ Library | ✅ Database | ❌ | ❌ | ❌ | ✅ Persistence | ✅ Library |
| **Projections** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ⚠️ Propulsion | ✅ Built-in | ❌ | ❌ | ❌ | ✅ Akka.Query | ✅ Built-in |
| **Messaging** | ✅ Built-in | ✅ Wolverine | ❌ | ✅ Core | ✅ Core | ❌ | ❌ | ✅ Core | ✅ Core | ✅ Core | ✅ Built-in | ⚠️ External |
| **Mediator** | ✅ Built-in | ✅ Wolverine | ✅ Core | ⚠️ Via broker | ❌ | ❌ | ❌ | ❌ | ⚠️ Via broker | ✅ Core | ✅ Tell/Ask | ❌ |
| **Multi-DB** | ✅ Drivers | ❌ Postgres only | N/A | N/A | N/A | ✅ Multiple | ❌ Own DB | ⚠️ Via DB | ⚠️ Via DB | ⚠️ Via DB | ✅ Plugins | ✅ Multiple |
| **Dashboard** | ✅ Included | ❌ | ❌ | ❌ | 🔴 Paid | ❌ | ✅ UI | ✅ Basic | ❌ | ❌ | ✅ Petabridge | ❌ |
| **Multi-Tenancy** | ✅ First-class | ⚠️ Manual | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Manual | ❌ |
| **Aspire** | ✅ First-class | ⚠️ Community | ❌ | ⚠️ Community | ❌ | ❌ | ⚠️ Community | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Lakehouse** | ✅ Planned | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Snapshots** | ✅ Planned | ✅ Yes | ❌ | ❌ | ❌ | ✅ Yes | ✅ Yes | ❌ | ❌ | ❌ | ✅ Yes | ✅ Yes |
| **Sagas** | ✅ Built-in | ✅ Wolverine | ❌ | ✅ Yes | ✅ Yes | ❌ | ❌ | ❌ | ✅ Yes | ❌ | ✅ Yes | ⚠️ External |
| **Outbox/Inbox** | ✅ Built-in | ✅ Wolverine | ❌ | ✅ Yes | ✅ Yes | ❌ | ❌ | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Manual | ⚠️ Manual |
| **AOT Support** | ✅ Yes | ⚠️ Partial | ✅ Yes | ⚠️ Partial | ❌ | ⚠️ Partial | ✅ Yes | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial | ❌ | ⚠️ Partial |
| **License** | 🟢 OSS | 🟢 OSS | 🟢 OSS | 🟢 Apache 2.0 | 🔴 Commercial | 🟢 Apache 2.0 | 🟡 Free/Paid | 🟢 MIT | 🟢 MIT | 🟢 MIT | 🟢 Apache 2.0 | 🟢 Apache 2.0 |
| **Language** | C#-first | C#-first | C#-first | C#-first | C#-first | F#-first | Any | C#-first | C#-first | C#-first | C#-first | C#-first |
| **Maturity** | 🆕 New | 🟢 Mature | 🟢 Mature | 🟢 Mature | 🟢 Mature | 🟡 Stable | 🟢 Mature | 🟡 Active | 🟢 Mature | 🟡 Active | 🟢 Mature | 🟡 Active |

**Legend**:
- ✅ Full support
- ⚠️ Partial/Manual/External
- ❌ Not supported
- 🔴 Paid feature
- 🟢 Free/Open source
- 🟡 Freemium or Active
- 🆕 New library

---

## Detailed Comparisons

### 1. Marten + Wolverine (The "Critter Stack")

**Versions**: Marten v8.0, Wolverine v4.0 (2025)
**GitHub**: https://github.com/JasperFx/marten, https://github.com/JasperFx/wolverine
**NuGet**: 10M+ downloads (combined)
**License**: MIT

**What it is**: Marten is a PostgreSQL document database and event store. Wolverine is a messaging and mediator framework. Together they form the most mature CQRS/ES stack in .NET as of 2025.

**Strengths**:
- Battle-tested in production since 2016
- Excellent PostgreSQL integration (partitioning, "Quick Append", NOTIFY/LISTEN)
- Full OpenTelemetry and metrics support
- Aggregate handler workflow for clean CQRS
- Snapshotting support
- Active development and community

**Limitations**:
- **PostgreSQL only** - No multi-database support
- **Two libraries** - Need to integrate Marten + Wolverine
- **No multi-tenancy** - Manual implementation required
- **No dashboard** - Need external tools
- **No lakehouse streaming** - Not supported

**When to choose**: You're committed to PostgreSQL and want the most proven .NET CQRS/ES stack.

**When to choose Whizbang instead**: Multi-database support, integrated dashboard, built-in multi-tenancy, Aspire integration, lakehouse streaming.

---

### 2. MediatR

**Version**: v12.0 (2024)
**GitHub**: https://github.com/jbogard/MediatR
**NuGet**: 150M+ downloads
**License**: Apache 2.0

**What it is**: Simple, unambitious in-process mediator for implementing CQRS in monolithic applications.

**Strengths**:
- Extremely simple and lightweight
- Minimal dependencies
- Perfect for small apps
- Huge community and ecosystem
- AOT-safe

**Limitations**:
- **No event sourcing** - Just a mediator
- **No projections** - No read model support
- **No messaging** - In-process only
- **No growth path** - Scaling to distributed requires complete rewrite

**When to choose**: You're building a simple monolith and will never need event sourcing or microservices.

**When to choose Whizbang instead**: You want a growth path from simple to complex without rewrites.

---

### 3. MassTransit

**Version**: v8.0+ (2025)
**GitHub**: https://github.com/MassTransit/MassTransit
**NuGet**: 50M+ downloads
**License**: Apache 2.0

**What it is**: Mature distributed messaging framework for .NET. Supports RabbitMQ, Azure Service Bus, Amazon SQS, Kafka, and more.

**Strengths**:
- Mature message routing, retries, error handling
- Excellent transport abstraction
- Saga support (orchestration and choreography)
- Free for production use
- Active community

**Limitations**:
- **No event sourcing** - Messaging only
- **No projections** - No read model engine
- **No mediator** - Requires broker even for in-process
- **Complex configuration** - Steep learning curve

**When to choose**: You only need messaging and have event sourcing/projections handled separately.

**When to choose Whizbang instead**: You want unified CQRS/ES platform with messaging built-in.

---

### 4. NServiceBus

**Version**: v9.0+ (2025)
**GitHub**: https://github.com/Particular/NServiceBus
**License**: Commercial (free for evaluation)

**What it is**: Enterprise-grade service bus from Particular Software. Most feature-rich messaging framework.

**Strengths**:
- Comprehensive tooling (ServicePulse, ServiceInsight)
- Enterprise support and training
- Battle-tested in large-scale systems
- Advanced error handling and sagas
- Professional documentation

**Limitations**:
- **Commercial license** - Production use requires payment
- **No event sourcing** - Messaging only
- **No projections** - No read model engine
- **Expensive** - Not viable for small teams

**When to choose**: You need enterprise support and budget allows.

**When to choose Whizbang instead**: You want open-source, all-in-one CQRS/ES without licensing costs.

---

### 5. Equinox

**Version**: v4.1.0 (2024)
**GitHub**: https://github.com/jet/equinox
**License**: Apache 2.0

**What it is**: Event sourcing library from Jet.com (Walmart). Supports CosmosDB, DynamoDB, EventStoreDB, SqlStreamStore. F#-first design.

**Strengths**:
- Polyglot storage (multiple backends)
- Sophisticated caching strategies
- Functional programming approach
- Library, not framework (lightweight)
- Production-proven at Walmart

**Limitations**:
- **F#-first** - Not idiomatic for C# developers
- **No messaging** - Requires separate library (Propulsion)
- **No dashboard** - No visualization tools
- **Steep learning curve** - Functional programming paradigm

**When to choose**: You're building in F# and want lightweight event sourcing.

**When to choose Whizbang instead**: You're building in C# and want integrated framework with dashboard.

---

### 6. EventStoreDB

**Version**: v21.10+ (2025)
**GitHub**: https://github.com/EventStore/EventStore
**License**: Free (Community), Paid (Commercial with support)

**What it is**: Purpose-built event store database. The gold standard for event sourcing since 2012.

**Strengths**:
- Purpose-built for event sourcing
- Projections built into database
- Catchup and persistent subscriptions
- Mature and battle-tested
- Excellent web UI

**Limitations**:
- **Separate database** - Another system to run and manage
- **No CQRS framework** - Just storage layer
- **No mediator** - Additional libraries needed
- **Infrastructure overhead** - Requires dedicated DB

**When to choose**: You want the absolute best event store and are willing to run dedicated infrastructure.

**When to choose Whizbang instead**: You want all-in-one framework using databases you already have.

---

### 7. CAP (DotNetCore.CAP)

**Version**: v8.3.5 (2025)
**GitHub**: https://github.com/dotnetcore/CAP
**NuGet**: 10.9M+ downloads
**License**: MIT

**What it is**: Event bus + outbox pattern implementation for .NET microservices. Integrates with RabbitMQ, Kafka, Azure Service Bus, Amazon SQS, etc.

**Strengths**:
- Excellent outbox/inbox pattern implementation
- Supports many message brokers (RabbitMQ, Kafka, Azure Service Bus, SQS, NATS, Redis, Pulsar)
- Built-in monitoring dashboard
- EF Core integration
- Lightweight and easy to use

**Limitations**:
- **No event sourcing** - Event bus only
- **No projections** - No read model support
- **No mediator** - Messaging-focused
- **Basic dashboard** - Limited compared to full observability

**When to choose**: You need reliable event bus with outbox pattern and already have event sourcing separately.

**When to choose Whizbang instead**: You want integrated event sourcing + projections + messaging + dashboard.

---

### 8. Rebus

**Version**: v8.0+ (2025)
**GitHub**: https://github.com/rebus-org/Rebus
**License**: MIT

**What it is**: Lean service bus implementation for .NET. "Message bus without smarts" following "smart endpoints, dumb pipes" principle.

**Strengths**:
- Lightweight and simple
- Supports many transports (RabbitMQ, Azure Service Bus, MSMQ, SQL Server, PostgreSQL)
- Free forever
- Good documentation
- Saga support

**Limitations**:
- **No event sourcing** - Messaging only
- **No projections** - No read model engine
- **No dashboard** - No visualization tools
- **Manual configuration** - More code than MassTransit

**When to choose**: You want lightweight service bus and prefer simplicity over features.

**When to choose Whizbang instead**: You need event sourcing, projections, and integrated dashboard.

---

### 9. Brighter (Paramore.Brighter)

**Version**: v10.0.1 (2025)
**GitHub**: https://github.com/BrighterCommand/Brighter
**License**: MIT

**What it is**: Command processor + messaging framework implementing Command Dispatcher pattern with middleware pipeline.

**Strengths**:
- Command Processor pattern with middleware
- Polly integration (retry, circuit breaker)
- Supports in-process and out-of-process messaging
- Good for Ports & Adapters architecture
- Active development

**Limitations**:
- **No event sourcing** - Command processing only
- **No projections** - No read model support
- **Smaller community** - Less adoption than MassTransit
- **Complexity** - Can be hard to grasp initially

**When to choose**: You want command processor pattern with middleware pipeline.

**When to choose Whizbang instead**: You need full CQRS/ES with event sourcing and projections.

---

### 10. Akka.NET / Akkatecture

**Version**: Akka.NET v1.5+, Akkatecture v1.0+ (2025)
**GitHub**: https://github.com/akkadotnet/akka.net, https://github.com/Lutando/Akkatecture
**License**: Apache 2.0

**What it is**: Actor model framework with event sourcing via Akka.Persistence. Akkatecture adds CQRS/ES on top.

**Strengths**:
- Actor model for concurrency
- Event sourcing via Akka.Persistence
- Isolated failure boundaries
- Cluster support for distributed systems
- Petabridge Cmd dashboard (commercial)

**Limitations**:
- **Actor model learning curve** - Different paradigm
- **No AOT support** - Relies on reflection
- **Complex for simple apps** - Overkill for monoliths
- **Dashboard is paid** - Petabridge Cmd requires license

**When to choose**: You need actor model concurrency and are comfortable with the paradigm.

**When to choose Whizbang instead**: You want traditional CQRS/ES without actor model complexity.

---

### 11. Eventuous

**Version**: v0.15+ (2025)
**GitHub**: https://github.com/Eventuous/eventuous
**License**: Apache 2.0

**What it is**: Event sourcing library for .NET supporting EventStoreDB, PostgreSQL, and SQL Server.

**Strengths**:
- Clean, minimalistic API
- EventStoreDB integration
- Real-time subscriptions
- Good documentation
- Active development

**Limitations**:
- **Relatively new** - Less mature than Marten or EventStoreDB
- **No messaging** - Requires external library
- **No dashboard** - No visualization tools
- **Smaller community** - Less adoption

**When to choose**: You want modern, minimalistic event sourcing library.

**When to choose Whizbang instead**: You need integrated messaging, projections, multi-tenancy, and dashboard.

---

### 12. SqlStreamStore

**Version**: v1.2.0 (2020)
**GitHub**: https://github.com/SQLStreamStore/SQLStreamStore
**Status**: ⚠️ Unmaintained
**License**: MIT

**What it is**: Stream store library targeting SQL databases (SQL Server, PostgreSQL, MySQL).

**Strengths**:
- Works with existing SQL databases
- No separate infrastructure
- Proven in production

**Limitations**:
- **Unmaintained** - No active development since 2020
- **No projections** - Event store only
- **No messaging** - Requires separate library
- **Security concerns** - Outdated dependencies

**When to choose**: Legacy systems already using SqlStreamStore.

**When to choose Whizbang instead**: You need actively maintained library with integrated features.

---

## Summary Comparison Table

| Library | Primary Focus | Best For | Avoid If |
|---------|--------------|----------|----------|
| **Whizbang** | All-in-one CQRS/ES | Multi-tenant microservices with analytics | Committed to single vendor (e.g., EventStoreDB) |
| **Marten + Wolverine** | Postgres-based CQRS/ES | PostgreSQL shops, mature stack | Need multi-database support |
| **MediatR** | In-process mediator | Simple monoliths | Need event sourcing or distributed |
| **MassTransit** | Distributed messaging | Messaging-first architecture | Need integrated event sourcing |
| **NServiceBus** | Enterprise messaging | Large enterprises with budget | Budget-conscious or open-source required |
| **Equinox** | F# event sourcing | F# projects, multi-backend needs | C#-first projects |
| **EventStoreDB** | Purpose-built event store | Event sourcing purists | Want to use existing DBs |
| **CAP** | Event bus + outbox | Microservices with existing ES | Need full CQRS/ES framework |
| **Rebus** | Lightweight service bus | Simple messaging needs | Need feature-rich framework |
| **Brighter** | Command processor | Ports & Adapters pattern | Need event sourcing |
| **Akka.NET** | Actor model + ES | Actor-based concurrency | Traditional CQRS/ES |
| **Eventuous** | Minimalist ES | Modern, clean ES library | Need messaging/dashboard |

---

## Version History

| Date | Changes |
|------|---------|
| 2025-10-18 | Initial comparison matrix created |
| 2025-10-18 | Added CAP, Rebus, Brighter, Akka.NET, Eventuous, SqlStreamStore |
| 2025-10-18 | Updated versions for all libraries (2025 latest) |

---

## Maintenance Notes

This comparison table should be updated:
- **Quarterly** - Check for new major versions
- **When Whizbang releases** - Update Whizbang features
- **When competitors release** - Update competitor features
- **When new libraries emerge** - Add new competitors

---

**Key Takeaway**: Whizbang is the only library combining event sourcing, projections, messaging, mediator, multi-tenancy, Aspire integration, lakehouse streaming, and integrated dashboard into a single, cohesive runtime with multi-database support.
