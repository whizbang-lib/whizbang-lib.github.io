---
title: Open Design Questions
category: Design
order: 1
tags: architecture, design-decisions, discussion, rfc
---

# Open Design Questions

This document captures open questions and architectural decisions that need to be resolved for Whizbang. These questions are organized by priority and domain area.

## 🔴 Critical Decisions (Blocking MVP)

### 1. Handler Discovery Mechanism

**Question**: How should Whizbang discover command/event handlers?

**Options**:

**A. Assembly Scanning (Runtime)**
```csharp
options.ScanAssembly(typeof(Program).Assembly);
```
- ✅ Simple, developer-friendly
- ✅ Works with any handler signature
- ❌ Breaks AOT compilation
- ❌ Slow startup time

**B. Source Generators (Compile-Time)**
```csharp
// Generated code creates handler registry
[WhizbangHandlers]  // Triggers source generator
public partial class HandlerRegistry { }
```
- ✅ AOT-safe
- ✅ Fast startup
- ✅ Compile-time errors for misconfigurations
- ❌ More complex implementation
- ❌ Less flexible

**C. Explicit Registration**
```csharp
options.RegisterHandler<PlaceOrder, PlaceOrderHandler>();
options.RegisterHandler<OrderPlaced, OrderHistoryProjection>();
```
- ✅ AOT-safe
- ✅ Explicit and clear
- ❌ Tedious for large applications
- ❌ Easy to forget handlers

**Hybrid Approach?**
- Source generators for AOT builds
- Assembly scanning for non-AOT builds
- Automatic detection based on publish settings

**Decision Needed**: Which approach for MVP? Can we support multiple modes?

---

### 2. Handler Method Signature Conventions

**Question**: What method signatures should handlers support?

**Option A: Explicit Interface**
```csharp
public class PlaceOrderHandler : ICommandHandler<PlaceOrder, OrderPlaced> {
    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        // ...
    }
}
```
- ✅ Type-safe
- ✅ Easy to discover via interfaces
- ❌ Verbose
- ❌ Couples to framework

**Option B: Convention-Based (Method Name)**
```csharp
public class PlaceOrderHandler {
    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        // Any method named 'Handle' with correct signature
    }
}
```
- ✅ Minimal framework coupling
- ✅ Flexible
- ❌ Harder to discover (needs scanning or source gen)
- ❌ Runtime errors if signature is wrong

**Option C: Attribute-Based**
```csharp
public class OrderHandlers {
    [CommandHandler]
    public async Task<OrderPlaced> PlaceOrder(PlaceOrder command) {
        // Any method name, attribute marks it as handler
    }
}
```
- ✅ Flexible naming
- ✅ Easy to discover via attributes
- ❌ Attribute noise

**Decision Needed**: Which convention? Should we support multiple conventions?

---

### 3. Event Store Schema Design

**Question**: How should events be stored in the database?

**Option A: Single Events Table (All Domains)**
```sql
CREATE TABLE events (
    event_id BIGSERIAL PRIMARY KEY,
    stream_id VARCHAR(255) NOT NULL,
    stream_version INT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(stream_id, stream_version)
);
CREATE INDEX idx_stream ON events(stream_id);
CREATE INDEX idx_type ON events(event_type);
```
- ✅ Simple
- ✅ Global event ordering
- ✅ Easy cross-aggregate queries
- ❌ Single table can become huge
- ❌ Harder to shard/partition

**Option B: Per-Aggregate-Type Tables**
```sql
CREATE TABLE order_events (
    event_id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL,
    version INT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(order_id, version)
);
```
- ✅ Better partitioning
- ✅ Aggregate-level isolation
- ❌ Complex global event queries
- ❌ Harder to implement projections across aggregates

**Option C: Hybrid (Events Table + Projection Tables)**
```sql
-- Single events table for event sourcing
CREATE TABLE events (...);

-- Separate projection tables for queries
CREATE TABLE order_history (...);
```
- ✅ Best of both worlds
- ✅ Optimized for both writes and reads
- ❌ More complex setup

**Decision Needed**: Which schema for MVP? Document migration path.

---

### 4. Optimistic Concurrency Strategy

**Question**: How should Whizbang handle concurrent updates to the same aggregate?

**Option A: Expected Version**
```csharp
await eventStore.AppendAsync(streamId, events, expectedVersion: 5);
// Throws if current version != 5
```
- ✅ Standard event sourcing pattern
- ✅ Detects all conflicts
- ❌ Requires aggregate to track version
- ❌ Developer must handle retry logic

**Option B: Timestamp-Based**
```csharp
await eventStore.AppendAsync(streamId, events, ifNotModifiedSince: lastRead);
```
- ✅ Familiar HTTP-style semantics
- ❌ Less precise than version numbers
- ❌ Clock skew issues

**Option C: Automatic Retry with Conflict Resolution**
```csharp
options.UseOptimisticConcurrency(opt => {
    opt.RetryAttempts = 3;
    opt.ConflictResolver<Order>((current, attempted) => {
        // Custom merge logic
    });
});
```
- ✅ Handles most conflicts automatically
- ✅ Better developer experience
- ❌ Complex to implement
- ❌ Not all conflicts can be auto-resolved

**Decision Needed**: Start with Option A (expected version), add Option C later?

---

### 5. Domain Ownership Declaration

**Question**: How should domain ownership be declared for commands and events?

**Option A: Attributes**
```csharp
[OwnedBy("Orders")]
public record PlaceOrder(...);

[OwnedBy("Orders")]
public record OrderPlaced(...);
```
- ✅ Clear and explicit
- ✅ Easy to find via reflection/source gen
- ❌ Can be forgotten

**Option B: Namespace Convention**
```csharp
namespace MyApp.Orders.Commands {
    public record PlaceOrder(...);  // Implicitly owned by "Orders"
}
```
- ✅ No attributes needed
- ✅ Convention-based
- ❌ Less flexible
- ❌ What if namespace doesn't match domain?

**Option C: Configuration**
```csharp
options.RegisterDomain("Orders", domain => {
    domain.OwnsCommand<PlaceOrder>();
    domain.OwnsEvent<OrderPlaced>();
});
```
- ✅ Centralized ownership declaration
- ✅ Can override conventions
- ❌ Tedious for large systems

**Hybrid Approach?**
- Attributes by default
- Namespace convention as fallback
- Configuration for overrides

**Decision Needed**: Which approach? Should we enforce domain ownership at compile-time (analyzer)?

---

## 🟡 Important (Nice to Have for MVP)

### 6. Projection Checkpoint Storage

**Question**: Where should projection checkpoint positions be stored?

**Option A: Same Database as Projection**
```csharp
// Checkpoint and projection data in same transaction
await tx.UpdateProjection(...);
await tx.UpdateCheckpoint(position);
await tx.CommitAsync();
```
- ✅ Transactional consistency
- ✅ Simple
- ❌ Tight coupling

**Option B: Separate Metadata Store**
```csharp
// Projection in Postgres, checkpoints in Redis/Cosmos
await projectionStore.UpdateAsync(...);
await checkpointStore.SaveAsync(position);
```
- ✅ Flexible
- ✅ Can optimize checkpoint storage separately
- ❌ Two-phase commit problem
- ❌ More complex

**Decision Needed**: Option A for MVP, support Option B later?

---

### 7. Snapshot Strategy

**Question**: Should Whizbang support aggregate snapshots to avoid replaying thousands of events?

**Current**: Always replay all events from stream start

**Option A: Automatic Snapshots**
```csharp
options.UseSnapshots(snap => {
    snap.SnapshotEvery = 100 events;  // Auto-snapshot every N events
});
```

**Option B: Manual Snapshots**
```csharp
public class Order : Aggregate {
    [Snapshot]  // Mark method as snapshot creator
    public OrderSnapshot CreateSnapshot() {
        return new OrderSnapshot(Id, Status, Items, Total);
    }
}
```

**Option C: No Snapshots (Events Only)**
- ✅ Simpler
- ✅ No snapshot versioning issues
- ❌ Poor performance for long-lived aggregates

**Decision Needed**: Defer snapshots until post-MVP? Or include basic support?

---

### 8. Projection Backfilling API

**Question**: What's the API for backfilling projections from historical events?

**Option A: Declarative (Start Position)**
```csharp
services.AddProjection<OrderHistoryProjection>(options => {
    options.BackfillFrom = DateTimeOffset.Parse("2024-01-01");
    // Or: options.BackfillFromBeginning = true;
});
```
- ✅ Simple
- ✅ Automatic
- ❌ No progress visibility

**Option B: Imperative (Manual Control)**
```csharp
var projection = provider.GetRequiredService<OrderHistoryProjection>();
await projection.RebuildAsync(from: DateTimeOffset.MinValue, onProgress: pos => {
    Console.WriteLine($"Rebuilt up to {pos}");
});
```
- ✅ Full control
- ✅ Progress reporting
- ❌ More complex

**Decision Needed**: Support both? Option A for common case, Option B for advanced scenarios?

---

### 9. Saga State Persistence

**Question**: How should saga state be persisted?

**Option A: Event-Sourced Sagas**
```csharp
public class OrderFulfillmentSaga : EventSourcedSaga {
    // Saga state rebuilt from events
}
```
- ✅ Consistent with aggregate pattern
- ✅ Audit trail of saga execution
- ❌ More complex

**Option B: State-Based Sagas**
```csharp
public class OrderFulfillmentSaga : StatefulSaga<OrderFulfillmentState> {
    // Saga state stored as document
}
```
- ✅ Simpler
- ✅ Direct state queries
- ❌ Less audit trail

**Decision Needed**: Support both? Which is primary pattern?

---

## 🟢 Future Considerations (Post-MVP)

### 10. Multi-Tenancy Support

**Question**: How should Whizbang support multi-tenant applications?

- Per-tenant databases?
- Tenant ID in event streams?
- Isolation at projection level?

### 11. Schema Evolution & Event Versioning

**Question**: How should we handle evolving event schemas over time?

```csharp
// V1
public record OrderPlaced(Guid OrderId, Guid CustomerId);

// V2 - Added field
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);
```

**Options**:
- Upcasting (convert old events to new schema on read)
- Multiple versions supported simultaneously
- Schema registry

### 12. Blue/Green Projection Deployments

**Question**: How can projections be updated without downtime?

**Scenario**: We want to change a projection's schema. How do we:
1. Deploy new projection version
2. Backfill it from events
3. Switch traffic to new version
4. Delete old version

**Needs**: Projection versioning, parallel execution, traffic switching

### 13. Cross-Aggregate Transactions

**Question**: Should Whizbang support transactions across multiple aggregates?

**Current Guidance**: Don't do it (sagas instead)

**But What If**: Use case demands it?

**Options**:
- Unit of Work pattern
- Distributed transactions (2PC)
- Just say no and enforce single-aggregate boundaries

### 14. Outbox/Inbox Table Schema

**Question**: What should outbox/inbox tables look like for distributed messaging?

**Outbox** (events waiting to be published):
```sql
CREATE TABLE outbox (
    message_id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    destination_topic VARCHAR(255)
);
```

**Inbox** (messages received from broker):
```sql
CREATE TABLE inbox (
    message_id UUID PRIMARY KEY,
    source_domain VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ
);
```

**Decision Needed**: Is this schema sufficient? What about dead-letter handling?

### 15. Distributed Tracing Context

**Question**: How should distributed traces propagate across services?

**W3C Trace Context Headers**:
```
traceparent: 00-{trace-id}-{parent-id}-01
tracestate: whizbang=correlation-id
```

**OpenTelemetry Automatic Instrumentation?**

### 16. Performance Budgets & SLOs

**Question**: Should Whizbang support performance budgets for handlers?

```csharp
[PerformanceBudget(MaxLatency = "100ms")]
public class PlaceOrderHandler {
    // Alert if handler takes > 100ms
}
```

Could integrate with OpenTelemetry to alert on violations.

### 17. Kubernetes Operator Features

**Question**: What should the Whizbang Kubernetes Operator do?

**Ideas**:
- Auto-scale projection workers based on lag
- Partition-aware pod placement
- Blue/green deployments for projections
- Automatic backfilling on projection updates

### 18. No-Code Projection Designer

**Question**: Can we build a visual tool for designing projections without writing code?

**Concept**: Drag-and-drop UI to:
1. Select event types to subscribe to
2. Map event fields to projection properties
3. Define aggregations/transformations
4. Generate C# code or config

**Feasibility**: Doable for simple projections, hard for complex logic.

---

## How to Use This Document

### For Contributors

Review open questions before starting major work. If your work intersects with an open question:
1. Comment with your perspective
2. Propose a concrete solution
3. Create a spike/POC if needed

### For Maintainers

Prioritize resolving 🔴 Critical questions before MVP release.

🟡 Important questions can be decided during MVP development.

🟢 Future questions are for post-MVP planning.

### Decision Process

1. **Discuss** in GitHub Issues or Discussions
2. **Prototype** if uncertain (spike branch)
3. **Document** decision in ADR (Architecture Decision Record)
4. **Update** documentation and code to match decision
5. **Remove** question from this file once resolved

---

## Related Resources

- [**Philosophy**](../philosophy.md) - Core principles that should guide decisions
- [**Architecture**](../architecture.md) - Current architecture overview
- [**Roadmap**](../Roadmap/) - Planned features and timeline

---

**Questions or Ideas?** Open a [GitHub Discussion](https://github.com/whizbang-lib/whizbang/discussions) or [Issue](https://github.com/whizbang-lib/whizbang/issues)!
