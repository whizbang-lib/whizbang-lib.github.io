---
title: Event Store
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Data Access
order: 4
description: >-
  Event sourcing and stream storage - event streams, replay, checkpoints,
  snapshots, and temporal queries
tags: >-
  event-sourcing, event-store, streams, replay, checkpoints, snapshots,
  postgresql
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/IEventUpcaster.cs
  - src/Whizbang.Data.Schema/Schemas/EventStoreSchema.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
  - src/Whizbang.Data.Postgres/Migrations/077_FullBodySplit.sql
  - src/Whizbang.Data.Postgres/Migrations/078_DropInlineBodyColumns.sql
  - src/Whizbang.Data.Postgres/Migrations/285_StoredMetadataIsSlimAndStaged.sql
  - src/Whizbang.Data.Postgres/Migrations/286_RoutesAndTraces.sql
  - src/Whizbang.Core/Attributes/StoredMetadataAttribute.cs
  - src/Whizbang.Core/Messaging/EventStoreMetadataOptions.cs
  - src/Whizbang.Core/Messaging/EventStoreMetadataSettings.cs
  - src/Whizbang.Core/Messaging/StoredMetadataRegistry.cs
  - src/Whizbang.Core/Observability/RouteNormalizer.cs
  - src/Whizbang.Generators/StoredMetadataRegistryGenerator.cs
  - src/Whizbang.Data.Postgres/MetadataDistillationStep.cs
  - src/Whizbang.Data.Postgres/PostgresRouteTraceStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreEventStoreTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/EventStoreSchemaTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventUpcasterPipelineTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPostgresEventStore.RetryTests.cs
lastMaintainedCommit: '01f07906'
---

# Event Store

The **Event Store** is the append-only log of all domain events in your system. It provides event sourcing capabilities, stream-based processing, and time-travel queries for rebuilding read models from any point in history.

## Event Sourcing Fundamentals

**Event Sourcing** stores state changes as a sequence of events rather than current state:

```mermaid{caption="Event sourcing keeps the full event history (OrderCreated → OrderPaid → OrderShipped) rather than only the current-state row that traditional table storage keeps."}
flowchart RL
    subgraph EventSourcing["Event Sourcing"]
        Stream["Event Stream<br/>OrderCreated<br/>OrderPaid<br/>OrderShipped<br/>(full history)"]
    end

    subgraph Traditional["Traditional State Storage"]
        Table["Order Table<br/>order_id: abc<br/>status: Shipped<br/>total: $100<br/>(current state)"]
    end

    Stream --> Table
```

**Benefits**:
- **Complete Audit Trail**: Every state change recorded forever
- **Temporal Queries**: "What was the order status at 2PM yesterday?"
- **Replay**: Rebuild read models from events
- **Debugging**: Reproduce exact system state for troubleshooting
- **Analytics**: Mine event history for business insights

---

## Event Stream Schema

### Core Tables

```sql{title="Core Tables" description="Core Tables" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Core", "Tables"]}
-- Event stream (append-only). DDL is generated from the C# schema definition
-- (EventStoreSchema) by EnsureWhizbangDatabaseInitializedAsync().
CREATE TABLE IF NOT EXISTS wh_event_store (
    event_id UUID PRIMARY KEY,                -- UUIDv7 (time-ordered), assigned client-side
    stream_id UUID NOT NULL,                  -- Stream identifier
    aggregate_id UUID NOT NULL,               -- Aggregate/entity ID
    aggregate_type VARCHAR(500) NOT NULL,     -- 'Order', 'Customer', etc.

    event_type VARCHAR(500) NOT NULL,         -- 'OrderCreatedEvent', etc.
    event_data JSONB NOT NULL,                -- Event payload
    metadata JSONB NOT NULL,                  -- Envelope context (hops, correlation)
    scope JSONB,                              -- Security/tenant scope

    version INTEGER NOT NULL,                 -- Position in stream (1, 2, 3, ...)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    flags INTEGER NOT NULL DEFAULT 0          -- EventFlags bitmask (collective/composite)
);

-- Indexes (unique per-stream and per-aggregate versions)
CREATE UNIQUE INDEX idx_event_store_stream ON wh_event_store (stream_id, version);
CREATE UNIQUE INDEX idx_event_store_aggregate ON wh_event_store (aggregate_id, version);
CREATE INDEX idx_event_store_aggregate_type ON wh_event_store (aggregate_type, created_at);
```

:::updated
**Pointer/body split** (migrations `077_FullBodySplit` / `078_DropInlineBodyColumns`): the `event_data` and `metadata` columns above exist in the base CREATE for fresh databases, but the forward migrations move **every** event body into the uniform `wh_event_body` table and drop the inline columns. At HEAD, `wh_event_store` is a narrow append-only **pointer** table (`event_id`, `stream_id`, `version`, `commit_sequence`, `event_type`, `created_at`, `flags`, `scope`, origin columns); readers (`get_stream_events`, `fetch_events_by_ids`, and `EFCoreEventStore`) resolve bodies from `wh_event_body`. Use the framework read APIs rather than selecting `event_data` from `wh_event_store` directly.
:::

**Key Design Decisions**:
- **UUIDv7** for `event_id`: Time-ordered, insert-friendly - reads order by `event_id` directly
- **version**: Position within a single stream (1, 2, 3, ...), enforced by a unique index
- **commit_sequence** (added by migration `046_CommitSequenceSchema`): global commit ordering, stamped asynchronously after commit for deterministic cross-stream/cross-service ordering
- **JSONB** for `event_data`/`metadata`/`scope`: Flexible schema, queryable (bodies live in `wh_event_body` after the full body split)
- **aggregate_type**: Query/filter by aggregate type (Order, Customer, Product, etc.)

---

### Event Processing Tracking

```sql{title="Event Processing Tracking" description="Event Processing Tracking" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Event", "Processing", "Tracking"]}
-- Receptor processing (log-style tracking with lease-based claiming)
CREATE TABLE IF NOT EXISTS wh_receptor_processing (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    receptor_name VARCHAR(500) NOT NULL,
    stream_id UUID,
    partition_number INTEGER,
    status VARCHAR(50) NOT NULL,        -- 'Pending', 'Processing', 'Completed', 'Failed'
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    instance_id UUID,                   -- Claiming service instance
    lease_expiry TIMESTAMPTZ,           -- Lease-based work claiming
    started_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ
);

-- Perspective cursors (stream-based projection tracking)
CREATE TABLE IF NOT EXISTS wh_perspective_cursors (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(500) NOT NULL,
    last_event_id UUID NOT NULL,        -- Cursor: last processed event (UUIDv7-ordered)
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMPTZ,
    error TEXT,

    -- Rewind support (late-arriving events)
    rewind_trigger_event_id UUID,
    rewind_flagged_at TIMESTAMPTZ,
    rewind_first_flagged_at TIMESTAMPTZ,

    -- Per-stream lock (used during rebuild/rewind)
    stream_lock_instance_id UUID,
    stream_lock_expiry TIMESTAMPTZ,
    stream_lock_reason VARCHAR(100),

    PRIMARY KEY (stream_id, perspective_name)
);
```

**Design Differences**:

| Aspect | Receptors (wh_receptor_processing) | Perspectives (wh_perspective_cursors) |
|--------|-------------------------------------|------------------------------------------|
| **Tracking** | Per event + receptor (log-style) | Per stream + perspective (cursor-style) |
| **Ordering** | No ordering (parallel) | Ordered within stream (by UUIDv7 event_id) |
| **Use Case** | Side effects, notifications | Read model projections |
| **Replay** | Re-process individual events | Advance/rewind the stream cursor |

---

## Appending Events

### Simple Event Storage (Recommended)

The simplest way to append events is to pass just the stream ID and event. Whizbang automatically captures tracing context from the `IEnvelopeRegistry`:

```csharp{title="Simple Event Storage (Recommended)" description="The simplest way to append events is to pass just the stream ID and event." category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Event", "Storage", "Recommended"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenNoEnvelope_ShouldCreateMinimalEnvelopeAsync", "EFCoreEventStoreTests.AppendAsync_WithRawMessage_CreatesEnvelopeAndAppendsAsync"]}
public class OrderReceptor(IEventStore eventStore) : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        Guid orderId = TrackedGuid.New();  // time-ordered UUIDv7

        var @event = new OrderCreated(orderId, command.CustomerId, command.Total);

        // Simple pattern - just pass stream ID and event
        await eventStore.AppendAsync(orderId, @event, ct);

        return @event;
    }
}
```

**How it works**: When the Dispatcher invokes your receptor, it registers the `MessageEnvelope` in the `IEnvelopeRegistry`. When you call `AppendAsync(streamId, message)`, the event store looks up the envelope to preserve:
- **MessageId** - Correlation across systems
- **Hops** - Service-to-service tracing
- **CorrelationId/CausationId** - Request chain tracking

If no envelope is found (e.g., in tests without Dispatcher), a minimal envelope is created automatically.

### Full Control with Envelope

For advanced scenarios where you need full control over the envelope:

```csharp{title="Full Control with Envelope" description="For advanced scenarios where you need full control over the envelope:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Full", "Control", "Envelope"] tests=["EFCoreEventStoreTests.AppendAsync_WithValidEnvelope_AppendsEventToStreamAsync"]}
// Create explicit envelope with custom tracing
var envelope = new MessageEnvelope<OrderCreated> {
    MessageId = MessageId.New(),
    Payload = @event,
    Hops = [new MessageHop {
        ServiceInstance = serviceInstanceProvider.ToInfo(),
        Timestamp = DateTimeOffset.UtcNow
    }]
};

await eventStore.AppendAsync(orderId, envelope, ct);
```

### Batch Appends

When one wire message fans out into many inner events (composite events), use `AppendBatchAsync` so backends can bulk-insert in one round trip:

```csharp{title="Batch Appends" description="Append a batch of envelopes in a single operation:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Batch", "Appends"] unverified="AppendBatchAsync is verified by EventStoreAppendBatchTests, which is outside the current coverage map"}
await eventStore.AppendBatchAsync(
    [
        (orderId, envelope1),
        (orderId, envelope2),
        (otherStreamId, envelope3)
    ],
    ct
);
```

Entries land in the supplied order. The default implementation loops over `AppendAsync`; the EF Core Postgres backend can bulk-insert.

### The IEventStore Surface

```csharp{title="The IEventStore Surface" description="Key members of the IEventStore interface:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "IEventStore", "Interface"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "EFCoreEventStoreTests.ReadAsync_WithExistingEvents_ReturnsEventsInSequenceOrderAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_WithMixedEventTypes_ReturnsAllEventsAsync", "EFCoreEventStoreTests.GetLastSequenceAsync_WithExistingEvents_ReturnsHighestSequenceAsync"]}
public interface IEventStore {
    // Appending
    Task AppendAsync<TMessage>(Guid streamId, MessageEnvelope<TMessage> envelope, CancellationToken ct = default);
    Task AppendAsync<TMessage>(Guid streamId, TMessage message, CancellationToken ct = default) where TMessage : notnull;
    Task AppendBatchAsync<TMessage>(IReadOnlyList<(Guid streamId, MessageEnvelope<TMessage> envelope)> entries, CancellationToken ct = default);

    // Reading (async streams, ordered by sequence / UUIDv7 event id)
    IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId, long fromSequence, CancellationToken ct = default);
    IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId, Guid? fromEventId, CancellationToken ct = default);
    IAsyncEnumerable<MessageEnvelope<IEvent>> ReadPolymorphicAsync(Guid streamId, Guid? fromEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

    // Checkpoint-range reads (used by lifecycle receptors)
    Task<List<MessageEnvelope<TMessage>>> GetEventsBetweenAsync<TMessage>(Guid streamId, Guid? afterEventId, Guid upToEventId, CancellationToken ct = default);
    Task<List<MessageEnvelope<IEvent>>> GetEventsBetweenPolymorphicAsync(Guid streamId, Guid? afterEventId, Guid upToEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

    // Positions
    Task<long> GetLastSequenceAsync(Guid streamId, CancellationToken ct = default);      // -1 if empty
    Task<long?> GetCommitSequenceAsync(Guid eventId, CancellationToken ct = default);    // null until stamped

    // Synchronous verification (request-response over event sourcing)
    Task<SyncResult> AppendAndWaitAsync<TMessage, TPerspective>(Guid streamId, TMessage message, TimeSpan? timeout = null, /* callbacks */ CancellationToken ct = default) where TMessage : notnull where TPerspective : class;
    Task<SyncResult> AppendAndWaitAsync<TMessage>(Guid streamId, TMessage message, TimeSpan? timeout = null, /* callbacks */ CancellationToken ct = default) where TMessage : notnull;
}
```

### Concurrency and Sequencing

You never pass an expected version. Sequencing and conflict handling are built in:

- Each append gets the next `version` for the stream from the database: on PostgreSQL both drivers call `wh_append_event`, which takes the stream's advisory lock (the lock `_emit_event_store_chain` takes for the same stream) and then inserts at the next version
- Concurrent writers to one stream therefore wait their turn and get consecutive versions; neither driver fails with a version conflict or retries. A duplicate event id fails at once with an `InvalidOperationException` saying the event is already stored
- The **unique index on `(stream_id, version)`** remains as the backstop. See [Appending and concurrency](../fundamentals/events/event-store#appending-and-concurrency) for the details, including transaction behavior
- Use `GetLastSequenceAsync(streamId)` if you need the current stream position (for example, to detect concurrent modification at the application level)
- A new stream starts at version 1 on every write path (outbox, inbox, direct append, in-memory, Sqlite); a stream with no events reports `-1`. Streams created at version 0 by a direct append before migration 267 keep their numbering. See [Stream versions](../fundamentals/events/event-store#stream-versions)

---

## Stored metadata {#stored-metadata}

{verified: StoredMetadataWriteSqlTests.OutboxChain_DefaultForm_StoresTheSlimRow_AndStagesTheFullFormAsync, StoredMetadataWriteSqlTests.InboxChain_DefaultForm_StoresTheSlimRow_AndStagesTheFullFormAsync, StoredMetadataWriteSqlTests.DirectAppend_DefaultForm_StoresTheSlimRow_AndStagesTheFullFormAsync}

Every event row keeps a metadata document next to its payload (`wh_event_body.metadata`). The envelope's hops, the
record of every service, receptor and policy a message passed through, made it about 600 bytes per event, and almost
nothing reads them back from a stored event. So each write path stores a **slim** form in the row by default, stamps the
event's **route id**, and **stages** the full form for a short while in a separate table, from which maintenance
distills [routes and traces](#routes-and-traces).

The write paths are SQL: the outbox and inbox emit chains, and `wh_append_event`, which both drivers' direct appends
call. They decide each event in the same statement that stores it, from settings read once per call, with no extra
lookup per event.

### The three write forms {#write-forms}

| `WriteForm` | The row keeps | Staged full form | Routes and traces | Verified |
|---|---|---|---|---|
| `Linked` (default) | slim form + `rid` | yes, in `wh_event_metadata_staging` | distilled by maintenance | {verified: StoredMetadataWriteSqlTests.OutboxChain_DefaultForm_StoresTheSlimRow_AndStagesTheFullFormAsync} |
| `Slim` | slim form + `rid` | no | none | {verified: StoredMetadataWriteSqlTests.WriteFormSlim_StoresSlimRows_AndStagesNothingAsync} |
| `Full` | every hop as written + `rid` | no (the row holds it) | none | {verified: StoredMetadataWriteSqlTests.WriteFormFull_KeepsFullRows_AndStagesNothingAsync} |

`Linked` is the default because it is the only form that saves the bytes without losing anything: the full form lives
on in a trace for its retention window, and the route for much longer.

### What the slim form keeps {#slim-form}

{verified: StoredMetadataRouteCorpusTests.SlimForm_InSql_ReadsLikeToSlim_ForEveryCorpusEntryAsync, StoredMetadataWriteSqlTests.DirectAppend_KeysTheSlimFormDoesNotReduce_AreKeptAsWrittenAsync}

The slim form is [`EnvelopeMetadata.ToSlim()`](../messaging/message-envelopes#stored-form), written in SQL
(`_wh_slim_event_metadata`), plus the route id. Only the hop list is reduced, to one hop:

| Kept | Why |
|---|---|
| The message id, and every top-level key except `dc` and `rin` | Each store reads its own keys back: the EF Core store's `MessageId`, the Dapper store's `message_id`, `correlation_id`, `causation_id` and `pri`, the ephemeral expiry the TTL reapers and the retry midpoint read (`ephemeral_expires_at`), the ephemeral TTL (`ett`). |
| The first hop's timestamp, correlation id, causation id and stream id | Readers take the message time, correlation and causation from the first hop (`GetMessageTimestamp`, `GetCorrelationId`, `GetCausationId`). |
| The first hop's trace parent (`tp`) | Perspective spans and perspective-stage receptor spans keep joining the trace the event started in. It stays inside the hop, where those readers already look. |
| The scope, folded over every Current hop into one delta (`sc`) | Scope and security checks read it from the hops. One scoped hop (the usual case) is copied as it is; several are folded the way `ScopeDelta.ApplyTo` applies them. |
| `rid`, the route id | Says how the event got here for as long as its route is kept, with no rewrite of the row. |

Dropped: the dispatch context (`dc`), receptor invocations (`rin`), and from the hops every service instance, topic,
partition, sequence, execution strategy, caller, duration, policy trail, hop metadata dictionary and causation hop.
These matter while a message is delivered, and the outbox and inbox rows keep them for that. On a stored event, the
envelope accessors that read hop detail (`GetCallerInfo`, `GetCurrentTopic` and the like) return what the slim form
carries; the full picture comes from the [trace store](../fundamentals/persistence/observability#routes-and-traces).

The slim hop keeps its scope rather than rebuilding it from the row's `scope` column on read: that column holds only
the perspective scope (tenant, user, customer, organization, allowed principals, extensions), while the hop's delta
also carries roles, permissions, principals, claims, the actual and effective principal and the context type, and the
EF Core direct append writes no scope column at all. {verified: StoredMetadataRouteCorpusTests.SlimForm_InSql_ReadsLikeToSlim_ForEveryCorpusEntryAsync}

### Keeping an event type full {#keeping-an-event-type-full}

{verified: StoredMetadataWriteSqlTests.FullListedType_KeepsTheFullRow_ByTypeAndByNamespaceAsync, StoredMetadataWriteSqlTests.DebugMode_KeepsEveryRowFullAsync, StoredMetadataRegistryGeneratorTests.Generator_TheNearestDeclarationWins_AndAbstractOrInterfaceTypesAreNotListedAsync}

A row stays full, whatever the write form, in three cases. The first that applies wins:

1. **Debug mode** (`Whizbang:WorkCoordinator:DebugMode`): every row is full.
2. **Configuration**: the type, or a namespace or containing type of it, is listed in
   `Whizbang:EventStore:Metadata:FullFor`.
3. **The attribute**: the type, a base class or an interface carries `[StoredMetadata(StoredMetadataForm.Full)]`.

```csharp{title="Keep an event type's full metadata in its row" description="The attribute on an interface keeps every hop in the stored rows of its implementers; StoredMetadataForm.Default on a type takes it back to the write form." framework="NET10" category="Attributes" difficulty="INTERMEDIATE" tags=["event-store", "stored-metadata", "attributes", "source-generation"] tests=["StoredMetadataRegistryTests.TheGeneratedRegistration_ListsTheAttributedTestTypesAsync", "StoredMetadataRegistryGeneratorTests.Generator_ABaseOrInterfaceDeclaration_KeepsTheDerivedTypeFullAsync", "StoredMetadataRegistryGeneratorTests.Generator_TheNearestDeclarationWins_AndAbstractOrInterfaceTypesAreNotListedAsync"]}
[StoredMetadata(StoredMetadataForm.Full)]
public interface IPaymentEvent : IEvent;

public record PaymentCaptured(Guid PaymentId, decimal Amount) : IPaymentEvent;   // kept full

[StoredMetadata(StoredMetadataForm.Default)]
public record PaymentViewed(Guid PaymentId) : IPaymentEvent;                     // back to the write form
```

The nearest declaration wins: the type's own, then its base classes from the nearest, then its interfaces. A source
generator reads the attribute at build time and registers each kept type by name, so nothing is read by reflection and
a private nested type is kept as well as any other. An abstract type, an interface and an open generic are never a
stored event's type, so they are not listed themselves.

A list entry matches a type when it is the type's name, or when the type's name continues it with `.` (a namespace) or
`+` (a nested type): `MyApp.Payments` keeps `MyApp.Payments.Captured` and `MyApp.Payments.Refunds.Issued` full, but not
`MyApp.PaymentsArchive.Moved`. An entry is trimmed and cut at its first comma, so an assembly-qualified name means its
type.

The configured list and the attribute's types reach the SQL through `wh_settings` (below), so a type is kept full from
the first maintenance tick after a start. With maintenance disabled nothing is published, and the database defaults
apply: `Linked`, and no type kept full.

### How the settings reach the write paths {#metadata-settings}

{verified: MaintenanceWorkerEventStoreMetadataSyncTests.EveryTick_PublishesTheSettings_EvenWhenTheSweepIsDeferredAsync, StoredMetadataWriteSqlTests.MissingSettings_BehaveAsTheDefaultAsync, StoredMetadataWriteSqlTests.UnreadableSettings_BehaveAsTheDefault_AndNeverFailTheWriteAsync}

The maintenance worker publishes three `wh_settings` rows on every tick, ahead of its idle gate (a busy service still
gets them), on the instance holding the maintainer duty:

| Key | Value | Published | Verified |
|---|---|---|---|
| `metadata_write_form` | `Full`, `Slim` or `Linked` | always, so a form switched back takes effect | {verified: EventStoreMetadataSettingsTests.EachWriteForm_IsPublishedByNameAsync} |
| `metadata_full_for` | type names and namespaces, one per line, sorted, each once | always, so a type removed from the list stops being kept full | {verified: EventStoreMetadataSettingsTests.FullFor_JoinsConfigurationAndAttributes_SortedOnce_AndCutAtTheCommaAsync} |
| `metadata_staging_days` | whole days | only when `StagingDays` is set, so a window set in SQL stands | {verified: EventStoreMetadataSettingsTests.StagingDays_WhenSet_IsPublishedAsAnIntegerAsync} |

A write path never fails on a setting. A missing row reads as the default; the form is read without case or surrounding
spaces and anything else reads as `Linked`; a debug flag that is not a PostgreSQL boolean spelling reads as off. The list
is plain lines rather than JSON because splitting lines cannot fail, so a value an operator types by hand can never
fail an event's write.

### Routes and traces {#routes-and-traces}

{verified: RouteNormalizerTests.RouteId_IsStable_AcrossInstancesLinesAndPerMessageValuesAsync, RouteNormalizerTests.RouteId_Differs_WhenAServiceMemberTopicPolicyOrTypeDiffersAsync, StoredMetadataRouteCorpusTests.EveryCorpusEntry_HasTheSameRouteId_InSqlAndInCSharpAsync}

A **route** is the path events of one type take: which services, receptors, topics and policies they pass through,
stored once and counted. A **trace** is one event's trip along it, with only what varies per message. In a stable
system the set of routes stops growing; only traces and counters grow.

The **route id** is computed at write time from the event's type name (its name without the assembly) and its hops
reduced to their route form. Per hop, in order, the route form keeps:

| Kept | Never kept |
|---|---|
| the hop type (an event's own hop, or one carried from its cause) | instance ids, host names, process ids |
| the service name | timestamps and durations |
| the topic | partition and sequence |
| the execution strategy | trace parent, correlation and causation ids |
| the caller's class (its file's name, without folders or extension) and member | the caller's line and folder |
| each policy decision's policy, rule and whether it matched | a decision's reason, configuration and time; scope; the hop metadata dictionary |

So another pod, another release that moved a line, or another build folder is the same route, and another service,
receptor member, topic, policy outcome or event type is another. The caller's class is its file's name because a hop
records the member and the file, not the class.

The id is the first 16 bytes of the SHA-256 of the canonical text (the type and each hop joined by U+001E, a hop's
fields by U+001F, a decision's fields by U+001D, decisions by U+001C), read as a uuid. SHA-256 rather than PostgreSQL's
`hashtext`, which C# cannot reproduce, or MD5, a weak hash. The same function exists twice: `_wh_route_id` on every write
path, and `RouteNormalizer.RouteId` in C# (what the in-memory trace store answers `GetRouteIdAsync` with). One corpus of
real hops runs through both, and every entry must give the same id.

A row kept full carries its route id too, and under `Linked` it is still staged, so routes cover every event type.

### Distillation {#distillation}

{verified: MetadataDistillationSqlTests.Distill_WritesRoutesAndTraces_AndConsumesTheStagedRowsAsync, MetadataDistillationSqlTests.Distill_ARepeatedRoute_OnlyIncrementsItsCountersAsync, MetadataDistillationSqlTests.Distill_AddsDurationStatistics_InOneUpdatePerRouteAsync, MetadataDistillationSqlTests.Step_DistillsInBatches_UntilTheStagingIsEmptyAsync}

The `metadata-distillation` maintenance step (both drivers) runs in the maintenance cycle, so it waits for the service
to settle and runs only on the holder of the maintainer duty. It calls `wh_distill_event_metadata` in batches of 2,000
staged rows, each its own transaction, until a batch comes back short or 50 batches (100,000 events) have run; a larger
backlog drains over the next cycles. Each batch, in one statement:

1. takes the oldest staged rows by event id and removes them, so each staged row is distilled exactly once with no
   cursor to keep;
2. inserts each new route, building its normalized hops once;
3. adds the batch's occurrences, first and last seen, and duration statistics to each route with **one upsert per
   route**, never a write per event;
4. writes one trace per event.

No event row is touched: its route id was stamped when it was written. Under `Full` and `Slim` nothing is distilled, and
what was staged before ages out.

An occurrence's duration is the sum of its hops' durations; an occurrence with none counts as an occurrence but not as a
duration. The statistics are a count, sum, minimum and maximum, and six buckets: up to 1 ms, 10 ms, 100 ms, 1 s, 10 s,
and longer. A value that does not parse (a timestamp, an id, a duration) reads as nothing and never stops a batch.

A trace keeps each hop without what its route holds (the hop type, topic, execution strategy, caller member and service
name), the dispatch context and receptor invocations the slim row dropped, the event's occurrence time (its first
Current hop's), and its correlation and causation (its first hop's).

### Reconstruction {#reconstruction}

{verified: MetadataDistillationSqlTests.Reconstruct_WithinTheTraceWindow_IsLosslessAsync, MetadataDistillationSqlTests.Reconstruct_AfterTheTraceAgesOut_KeepsTheRouteAsync}

`wh_trace_metadata` rebuilds an event's full metadata from the first source it still has:

1. the staged form, before distillation;
2. the row, its trace and its route: **lossless**, the exact document that was written;
3. the row alone, once the trace has aged out: the slim form, whose route id still answers how the event got here.

The [Postgres trace store](../fundamentals/persistence/observability#the-postgres-stores) reads through it.

### Retention {#retention}

{verified: MetadataDistillationSqlTests.Retention_EachWindow_RemovesOnlyWhatIsPastItAsync, MetadataDistillationSqlTests.Retention_DebugMode_RemovesNothingAsync}

Each has its own window, read from `wh_settings` every cycle and skipped under debug mode:

| What | Setting (`wh_settings`) | Default | How it is removed |
|---|---|---|---|
| Staged full forms | `metadata_staging_days` (`Whizbang:EventStore:Metadata:StagingDays`) | 2 days | partition drop when [partitioning](../operations/infrastructure/partitioned-ledgers) is enabled, otherwise the row sweep |
| Traces | `trace_retention_days` (`Whizbang:Workers:Maintenance:Retention:TraceDays`) | 30 days | the same |
| Routes | `route_idle_days` (`Whizbang:Workers:Maintenance:Retention:RouteIdleDays`) | 365 days after last taken | row sweep |

Staging only has to outlast maintenance catching up. A route still taken is never removed, so only paths that left with
old code age out. Both partitioned tables are created partitioned by day on `recorded_at` with a default partition, so a
write never fails for want of a partition; the staging table's only index is its key, so the hot path writes one index
entry per event.

### Design choices {#metadata-design-choices}

Each choice below is locked by the test beside it, which fails if the behavior flips.

| Choice | Why | Verified |
|---|---|---|
| `Linked` is the default form | It saves the row's bytes and keeps the full form as a trace and a route | {verified: ProcessWideOptionsBindingTests.EventStoreMetadata_Unconfigured_IsLinkedWithNothingKeptFullAsync, StoredMetadataWriteSqlTests.MissingSettings_BehaveAsTheDefaultAsync} |
| Debug mode, then the configured list, then the attribute keep a row full | An operator's switch outranks a developer's declaration | {verified: StoredMetadataWriteSqlTests.DebugMode_KeepsEveryRowFullAsync, StoredMetadataWriteSqlTests.FullListedType_KeepsTheFullRow_ByTypeAndByNamespaceAsync} |
| The nearest `[StoredMetadata]` declaration wins; `Default` opts a derived type back | A type can leave a family that is kept full | {verified: StoredMetadataRegistryGeneratorTests.Generator_TheNearestDeclarationWins_AndAbstractOrInterfaceTypesAreNotListedAsync, StoredMetadataRegistryTests.TheGeneratedRegistration_ListsTheAttributedTestTypesAsync} |
| Kept types are registered by name, private nested types included | The SQL matches names, so nothing has to be named from generated code | {verified: StoredMetadataRegistryGeneratorTests.Generator_APrivateNestedType_IsRegisteredByNameAsync} |
| A list entry matches a type, a namespace (`.`) or a containing type (`+`), never a bare prefix | `MyApp.Payments` must not keep `MyApp.PaymentsArchive` full | {verified: StoredMetadataWriteSqlTests.FullListedType_KeepsTheFullRow_ByTypeAndByNamespaceAsync} |
| List entries are trimmed, cut at a comma, sorted and published once | An assembly-qualified name means its type; the published value is stable | {verified: EventStoreMetadataSettingsTests.FullFor_JoinsConfigurationAndAttributes_SortedOnce_AndCutAtTheCommaAsync, EventStoreMetadataSettingsTests.FullFor_BlankAndNullEntries_AreSkippedAsync} |
| The list is stored as lines, not JSON | Splitting lines cannot fail, so a hand-typed value never fails a write | {verified: StoredMetadataWriteSqlTests.FullListedType_KeepsTheFullRow_ByTypeAndByNamespaceAsync} |
| Missing or unreadable settings read as the defaults; the form ignores case | A setting must never fail an event's write | {verified: StoredMetadataWriteSqlTests.UnreadableSettings_BehaveAsTheDefault_AndNeverFailTheWriteAsync} |
| Form and list are published every tick, both directions, ahead of the idle gate | Every write depends on them, even on a service too busy for the sweep; a stale value would outlive its configuration | {verified: MaintenanceWorkerEventStoreMetadataSyncTests.EveryTick_PublishesTheSettings_EvenWhenTheSweepIsDeferredAsync, EventStoreMetadataSettingsTests.Defaults_PublishLinkedAndAnEmptyList_ButNoStagingWindowAsync} |
| `StagingDays`, `TraceDays` and `RouteIdleDays` are published only when set | A window set in SQL stands, as for every retention window | {verified: EventStoreMetadataSettingsTests.Defaults_PublishLinkedAndAnEmptyList_ButNoStagingWindowAsync, RetentionSettingsBridgeTests.UnsetOptions_AreNotWritten_SoAValueSetInSqlStandsAsync} |
| The route id is computed in SQL on every write path; C# mirrors it | Both direct appends call `wh_append_event`, so one SQL function serves all four paths; the in-memory trace store needs the same id | {verified: StoredMetadataRouteCorpusTests.EveryCorpusEntry_HasTheSameRouteId_InSqlAndInCSharpAsync, InMemoryTraceStoreTests.GetRouteIdAsync_HeldMessage_IsItsRouteId_AndAnUnknownOneIsNullAsync} |
| The route includes the event type's name, not its assembly | "The routes a type takes" is a lookup; a renamed assembly is the same route | {verified: RouteNormalizerTests.RouteId_IsStable_AcrossInstancesLinesAndPerMessageValuesAsync, RouteNormalizerTests.RouteId_Differs_WhenAServiceMemberTopicPolicyOrTypeDiffersAsync} |
| The id is 16 bytes of SHA-256, as a uuid | Reproducible in C#, not a weak hash | {verified: RouteNormalizerTests.RouteId_IsTheFirstSixteenBytesOfTheSha256_AsAUuidAsync} |
| The caller's class is its file's name | A hop records the member and the file, not the class; a moved line or folder is the same route | {verified: RouteNormalizerTests.CallerClass_IsTheFileNameWithoutFoldersOrExtensionAsync} |
| A decision's reason, configuration and time are not part of the route | They vary per message | {verified: RouteNormalizerTests.RouteId_IgnoresAPolicyDecisionsReasonConfigurationAndTimeAsync} |
| The slim form reduces only the hop list and drops `dc` and `rin` | Each store's reader still finds its own keys (the Dapper store's `message_id`, `pri`) | {verified: StoredMetadataWriteSqlTests.DirectAppend_KeysTheSlimFormDoesNotReduce_AreKeptAsWrittenAsync} |
| The trace parent stays in the slim hop | Perspective spans keep the event's trace, read where they already look | {verified: StoredMetadataWriteSqlTests.OutboxChain_DefaultForm_StoresTheSlimRow_AndStagesTheFullFormAsync} |
| The slim hop keeps the folded scope | The row's scope column holds less than the hop's delta, and EF Core direct appends write none | {verified: StoredMetadataRouteCorpusTests.SlimForm_InSql_ReadsLikeToSlim_ForEveryCorpusEntryAsync} |
| A full row carries `rid` and is still staged under `Linked` | Routes cover every type | {verified: StoredMetadataWriteSqlTests.FullListedType_KeepsTheFullRow_ByTypeAndByNamespaceAsync, StoredMetadataWriteSqlTests.DebugMode_KeepsEveryRowFullAsync} |
| Distillation removes what it distills, oldest event id first | Each staged row counts once with no cursor; the key index serves the order | {verified: MetadataDistillationSqlTests.Distill_TakesAtMostTheBatch_OldestFirstAsync} |
| 2,000 rows a batch, 50 batches a cycle | A transaction holds one batch; a backlog drains over cycles | {verified: MetadataDistillationSqlTests.Step_StopsAtTheCycleLimit_AndTheNextCycleGoesOnAsync} |
| Nothing is distilled under `Full` or `Slim` | `Slim` drops the staged form without distilling it | {verified: MetadataDistillationSqlTests.Distill_UnderSlimOrFull_ConsumesNothingAsync} |
| A duration is the sum of the hops'; none is not zero | An occurrence without timing must not pull the minimum to zero | {verified: MetadataDistillationSqlTests.Distill_AddsDurationStatistics_InOneUpdatePerRouteAsync} |
| A malformed value reads as nothing | One bad hop must never stop maintenance | {verified: MetadataDistillationSqlTests.Distill_MalformedValues_ReadAsNothing_AndNeverStopTheBatchAsync} |
| The trace store's `StoreAsync` does nothing | The write paths already stage every event | {verified: RouteTraceStoreTests.GetByMessageId_ReadsStaging_ThenTraceAndRoute_ThenTheRowAsync} |
| Staging has one index | The hot path pays one index entry; the trace store scans staging for its non-key queries | {verified: RouteTraceStoreTests.TraceStore_AnswersEveryQuery_LikeTheInMemoryStore_OnTheSameCorpusAsync} |
| Each store registers on its own | Use either without the other | {verified: RouteTraceStoreTests.Registration_EitherStoreAlone_NeedsNotTheOtherAsync} |

### What slim metadata costs {#what-slim-metadata-costs}

{verified: StoredMetadataEmitCostScenarioTests.EmitChain_FullAgainstLinked_ReportAsync}

Measured on the outbox emit chain, the hottest write path, with 500-event batches whose events carry two hops each
(about 1.5 KB of metadata, a dispatched event's usual shape), on one database, alternating the variants round by round:
the chain before this change (the full metadata in the row), this chain under `Full` (the row plus the route id: what
the settings read and the route hash cost alone), and this chain under `Linked` (the slim row plus the staged copy).
Medians of five rounds on a shared build server:

| Batch | Variant | Shared blocks | WAL bytes | Metadata in the row | Staged | Execution time |
|---|---|---|---|---|---|---|
| 50 existing streams, 10 events each | before | 34,061 | 2,475,376 | 1,476 B/event | none | 87 ms |
| | `Full` | 33,925 | 2,502,464 | 1,520 B/event | none | 138 ms |
| | `Linked` | 35,784 (+5%) | 2,831,320 (+14%) | 490 B/event (-67%) | 1,476 B/event | 177 ms |
| 500 new streams, one event each | before | 38,245 | 2,727,464 | 1,476 B/event | none | 98 ms |
| | `Full` | 38,275 | 2,743,600 | 1,520 B/event | none | 148 ms |
| | `Linked` | 40,007 (+5%) | 3,085,184 (+13%) | 490 B/event (-67%) | 1,476 B/event | 203 ms |

Blocks, WAL and sizes are stable from round to round; the times are not, because the build server's database is shared
with other test runs (the before chain ranged from 80 to 178 ms over the same five rounds). On a quiet database, 500
route ids take 3 ms and 500 slim forms 8 ms (about 6 and 17 microseconds an event). The staged copy is the write the
`Linked` form adds: one heap tuple and one index entry per event, which the 13 to 14% more WAL is, until maintenance
distills and removes it. The row keeps a third of what it kept, for good.

An earlier version computed the route id in SQL functions with subqueries, which PostgreSQL does not inline, so each
call ran the executor, and it computed the id twice per event: the chain cost about 0.6 ms more per event even under
`Full`. The helpers are now loops and assignments that run no statement, and each event's route id is computed once.


---


## Reading Event Streams

### Read Full Stream

```csharp{title="Read Full Stream" description="Read Full Stream" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Full", "Stream"] tests=["EFCoreEventStoreTests.ReadAsync_WithExistingEvents_ReturnsEventsInSequenceOrderAsync"]}
// Strongly-typed read of the whole stream, in order (a new stream starts at sequence 1)
await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(orderId, fromSequence: 0, ct)) {
    Console.WriteLine($"{envelope.MessageId}: {envelope.Payload}");
}
```

### Read Stream from a Checkpoint

```csharp{title="Read Stream from a Checkpoint" description="Read Stream from a Checkpoint" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Stream", "Checkpoint"] tests=["InMemoryEventStoreTests.ReadAsync_ByEventId_WithSpecificEventId_ShouldReturnEventsAfterItAsync", "EFCoreEventStoreTests.ReadAsync_ByEventId_WithFromEventId_ReturnsEventsAfterIdAsync"]}
// Events are UUIDv7-ordered - read everything after the last processed event id
Guid? lastProcessedEventId = /* from your cursor */;

await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(orderId, lastProcessedEventId, ct)) {
    // process...
}
```

### Read Mixed Event Types (Polymorphic)

```csharp{title="Read Mixed Event Types (Polymorphic)" description="Read Mixed Event Types (Polymorphic)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Polymorphic", "Events"] tests=["InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EFCoreEventStoreTests.ReadPolymorphicAsync_WithUnknownEventType_SkipsUnknownEventsAsync"]}
// Deserializes each row to its concrete type via the event_type column.
// All event types must be listed for AOT compatibility.
IReadOnlyList<Type> eventTypes = [typeof(OrderCreated), typeof(OrderShipped), typeof(OrderCancelled)];

await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, fromEventId: null, eventTypes, ct)) {
    switch (envelope.Payload) {
        case OrderCreated created: /* ... */ break;
        case OrderShipped shipped: /* ... */ break;
    }
}
```

### Read a Checkpoint Range

```csharp{title="Read a Checkpoint Range" description="Read events between two checkpoints (exclusive start, inclusive end):" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Range", "Events"] tests=["EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_WithMixedEventTypes_ReturnsAllEventsAsync", "InMemoryEventStoreTests.GetEventsBetweenPolymorphicAsync_WithAfterEventId_ShouldFilterEventsAsync", "EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_NullAfterEventId_ReturnsFromStartAsync"]}
// Used by lifecycle receptors at PostPerspective stages to load exactly
// the events a perspective just processed.
var events = await eventStore.GetEventsBetweenPolymorphicAsync(
    orderId,
    afterEventId: previousCheckpoint,   // exclusive; null = from beginning
    upToEventId: newCheckpoint,         // inclusive
    eventTypes,
    ct
);
```

---

## Rebuilding Perspectives from Events

Perspective replay is **built into the framework** — you do not write replay loops yourself. The `PerspectiveWorker` drives perspectives forward, and `wh_perspective_cursors` tracks progress per `(stream_id, perspective_name)`.

### How Cursor-Based Processing Works

1. Events land in `wh_event_store` (and matching rows in `wh_perspective_events` route work to perspectives)
2. The `PerspectiveWorker` claims a stream, reads events after the cursor's `last_event_id` (UUIDv7-ordered), and applies your pure `Apply` methods
3. The resulting model is upserted into the perspective's `wh_per_*` table and the cursor advances — atomically
4. **Late-arriving events** flag the cursor for rewind (`rewind_trigger_event_id`); the worker rewinds from the nearest snapshot and replays forward

### Rebuild Modes

Full and selective rebuilds (Blue-Green, In-Place, Selected Streams) are covered in [Perspective Rebuild](../fundamentals/perspectives/rebuild.md). Conceptually a rebuild:

1. Locks the affected streams (`stream_lock_*` columns on `wh_perspective_cursors`)
2. Resets the cursor(s) and clears or shadows the `wh_per_*` rows
3. Replays events through the same pure `Apply` functions the live path uses
4. Swaps/unlocks when the rebuilt model catches up

Because perspectives are **pure functions**, replaying the same events always produces the same model — there is no separate "rebuild codepath" to keep in sync.

---

## Snapshots (Performance Optimization)

**Problem**: Rewinding a perspective after a late-arriving event would mean replaying the stream from event zero.

**Solution**: Whizbang stores **perspective snapshots** — periodic captures of a perspective's model state — so rewinds replay only from the nearest snapshot.

### Snapshot Schema

```sql{title="Snapshot Schema" description="Snapshot Schema (generated from PerspectiveSnapshotsSchema)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Snapshot", "Schema"]}
CREATE TABLE IF NOT EXISTS wh_perspective_snapshots (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(500) NOT NULL,
    snapshot_event_id UUID NOT NULL,       -- Event this snapshot was taken at
    snapshot_data JSONB NOT NULL,          -- Full model state
    sequence_number BIGINT NOT NULL,       -- Stream position at snapshot time
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_commit_sequence BIGINT,       -- commit_sequence anchor (nullable)

    PRIMARY KEY (stream_id, perspective_name, snapshot_event_id)
);

CREATE INDEX idx_perspective_snapshots_lookup
    ON wh_perspective_snapshots (stream_id, perspective_name, sequence_number);
```

### How Snapshot-Based Rewind Works

1. Perspective runners periodically write a snapshot of the current model (with the event id and `commit_sequence` it corresponds to, resolved via `IEventStore.GetCommitSequenceAsync`)
2. When a late-arriving event flags a cursor for rewind, the worker locates the nearest snapshot **before** the late event
3. The model is restored from `snapshot_data` and events after the snapshot are replayed through the pure `Apply` functions
4. The cursor advances normally from there

**Snapshot Strategy**:
- Snapshots are per `(stream_id, perspective_name)` — each perspective rewinds independently
- More frequent snapshots = shorter rewinds, more storage
- Because `Apply` is pure, restoring a snapshot + replaying the tail is always equivalent to a full replay

---

## Temporal Queries (Time Travel)

### Query State at Specific Time

Because `event_id` is a UUIDv7, time-based cutoffs map naturally onto event ids. Read the stream and stop at the cutoff:

```csharp{title="Query State at Specific Time" description="Query State at Specific Time" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Query", "State", "Specific"] unverified="application-composed temporal query — the underlying ReadPolymorphicAsync read is verified above; the hop-timestamp cutoff and Apply loop are application logic"}
public async Task<OrderSummary> GetOrderAsOfAsync(
    IEventStore eventStore,
    Guid orderId,
    DateTimeOffset asOfTime,
    CancellationToken ct = default) {

    var perspective = new OrderSummaryPerspective();
    var model = new OrderSummary();

    IReadOnlyList<Type> eventTypes = [typeof(OrderCreated), typeof(OrderShipped)];

    await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, null, eventTypes, ct)) {
        // Stop once we pass the cutoff (hop timestamps carry wall-clock time)
        if (envelope.Hops[0].Timestamp > asOfTime) {
            break;
        }

        model = envelope.Payload switch {
            OrderCreated e => perspective.Apply(model, e),
            OrderShipped e => perspective.Apply(model, e),
            _ => model
        };
    }

    return model;
}
```

For ad-hoc analysis you can also query `wh_event_store` directly - `created_at` records when each event was stored, and `version` orders events within a stream.

**Use Cases**:
- **Debugging**: "What did the order look like when the bug occurred?"
- **Compliance**: "Show me customer data as of December 31st for audit"
- **Analytics**: "How many active customers did we have at the end of Q3?"

---

## Event Versioning

:::updated
**Read-path upcasting is now first-class**: implement `IEventUpcaster` (pure, deterministic transform applied after deserialization and before routing/`Apply` on every read path) and register it with `services.AddEventUpcaster<T>()`. Upcasters can change type (`FooV1` → `FooV2`), backfill new fields, or re-key the stream — the stored log is never rewritten. See [Event Upcasting](../fundamentals/events/event-upcasting.md). Version attributes and multi-version `Apply` support remain planned; the hand-rolled patterns below still work as application code.
:::

### Problem: Event Schema Changes

```csharp{title="Problem: Event Schema Changes" description="Problem: Event Schema Changes" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Problem:", "Event", "Schema"] unverified="illustrative event-version record shapes with no behavior to assert — event versioning is a planned framework feature"}
// Version 1
public record OrderCreatedV1(
    Guid OrderId,
    Guid CustomerId,
    decimal Total
);

// Version 2 (added new field)
public record OrderCreatedV2(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    string Currency  // ← New field!
);
```

### Strategy 1: Upcasting

```csharp{title="Strategy 1: Upcasting" description="Strategy 1: Upcasting" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Strategy", "Upcasting"] unverified="application-level upcasting pattern — event versioning is a planned framework feature, not yet verified by tests"}
public class EventUpcast {
    public object Upcast(StoredEvent storedEvent) {
        return storedEvent.EventType switch {
            "OrderCreatedV1" => UpcastV1ToV2(storedEvent),
            "OrderCreatedV2" => JsonSerializer.Deserialize<OrderCreatedV2>(storedEvent.EventData),
            _ => throw new UnknownEventTypeException(storedEvent.EventType)
        };
    }

    private OrderCreatedV2 UpcastV1ToV2(StoredEvent storedEvent) {
        var v1 = JsonSerializer.Deserialize<OrderCreatedV1>(storedEvent.EventData)!;

        return new OrderCreatedV2(
            OrderId: v1.OrderId,
            CustomerId: v1.CustomerId,
            Total: v1.Total,
            Currency: "USD"  // ← Default value for missing field
        );
    }
}
```

### Strategy 2: Copy-and-Transform (Migration)

```sql{title="Strategy 2: Transform-in-Place (Migration)" description="Strategy 2: Transform-in-Place (Migration)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Strategy", "Transform-in-Place", "Migration"]}
-- Rewrite stored payloads to the new shape (verify with a SELECT first!)
-- In-place UPDATE preserves event_id and the unique (stream_id, version) index.
-- Post-body-split (migrations 077/078): event_type lives on the wh_event_store
-- pointer; the payload lives in wh_event_body.
UPDATE wh_event_body b
SET event_data = jsonb_set(b.event_data, '{Currency}', '"USD"')  -- Add default Currency
FROM wh_event_store es
WHERE b.event_id = es.event_id
  AND es.event_type = 'OrderCreatedV1';

UPDATE wh_event_store
SET event_type = 'OrderCreatedV2'
WHERE event_type = 'OrderCreatedV1';
```

---

## Event Store Performance

The stock `wh_event_store` table is unpartitioned. For very large stores, standard PostgreSQL techniques apply (these are database-administration patterns, not framework features — validate them against your workload in isolation first):

### Partitioning by Aggregate Type

```sql{title="Partitioning by Aggregate Type" description="Partitioning by Aggregate Type" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Partitioning", "Aggregate", "Type"]}
CREATE TABLE event_store_partitioned (
    event_id UUID NOT NULL,
    stream_id UUID NOT NULL,
    aggregate_type VARCHAR(500) NOT NULL,
    -- ... remaining wh_event_store columns
) PARTITION BY LIST (aggregate_type);

CREATE TABLE event_store_orders PARTITION OF event_store_partitioned
FOR VALUES IN ('Order');

CREATE TABLE event_store_customers PARTITION OF event_store_partitioned
FOR VALUES IN ('Customer');
```

**Benefit**: Queries filtered by `aggregate_type` only scan the relevant partition.

### Partitioning by Time Range

```sql{title="Partitioning by Time Range" description="Partitioning by Time Range" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Partitioning", "Time", "Range"]}
CREATE TABLE event_store_partitioned (
    event_id UUID NOT NULL,
    stream_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    -- ... remaining wh_event_store columns
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE event_store_2026_06 PARTITION OF event_store_partitioned
FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE event_store_2026_07 PARTITION OF event_store_partitioned
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

**Benefit**: Time-based queries automatically prune old partitions.

### Archiving Old Events

```sql{title="Archiving Old Events" description="Archiving Old Events" category="Implementation" difficulty="BEGINNER" tags=["Data", "Sql", "Archiving", "Old", "Events"]}
-- Archive events older than 1 year (verify replay/rewind windows first -
-- archived events are no longer available for perspective rewind)
INSERT INTO event_store_archive
SELECT * FROM wh_event_store
WHERE created_at < NOW() - INTERVAL '1 year';

DELETE FROM wh_event_store
WHERE created_at < NOW() - INTERVAL '1 year';
```

---

## Best Practices

### DO ✅

- ✅ **Append-only** - Never update or delete events
- ✅ **Use UUIDv7** (`TrackedGuid.New()`) for stream IDs - event ids are UUIDv7 automatically
- ✅ **Trust the built-in versioning** - `version` per stream is assigned and uniqueness-enforced by the store
- ✅ **Use commit_sequence** for deterministic cross-stream ordering (stamped asynchronously)
- ✅ **JSONB** for event_data (flexible, queryable)
- ✅ **Snapshots** happen automatically per perspective - tune cadence for long streams
- ✅ **Upcasting** for event versioning
- ✅ **Partition** by aggregate_type or created_at for very large stores
- ✅ **Archive** old events (> 1 year) once rewind windows allow
- ✅ **Cursor-based processing** for perspectives (built in via `wh_perspective_cursors`)

### DON'T ❌

- ❌ Update events (immutable!)
- ❌ Delete events (append-only!)
- ❌ Use random UUIDs (index fragmentation) - prefer `TrackedGuid.New()`
- ❌ Write your own replay loops (the `PerspectiveWorker` owns replay/rewind)
- ❌ Store large BLOBs in events (use object storage, store URL)
- ❌ Break event schemas (upcast instead)
- ❌ Query events for current state (use perspectives/lenses)

---

## Common Patterns

### Pattern 1: Event-Sourced Aggregate

```csharp{title="Pattern 1: Event-Sourced Aggregate" description="Pattern 1: Event-Sourced Aggregate" category="Implementation" difficulty="ADVANCED" tags=["Data", "Pattern", "Event-Sourced", "Aggregate"] unverified="application-level event-sourced aggregate pattern — not a framework API surface"}
public class Order {
    public Guid Id { get; private set; }
    public string Status { get; private set; } = "Created";
    public decimal Total { get; private set; }

    private readonly List<object> _uncommittedEvents = new();

    public IReadOnlyList<object> GetUncommittedEvents() => _uncommittedEvents.AsReadOnly();

    public void ClearUncommittedEvents() => _uncommittedEvents.Clear();

    // Apply event to mutate state
    public void Apply(object @event) {
        switch (@event) {
            case OrderCreated e:
                Id = e.OrderId;
                Status = "Created";
                Total = e.Total;
                break;

            case OrderShipped e:
                Status = "Shipped";
                break;

            default:
                throw new UnknownEventException(@event.GetType().Name);
        }
    }

    // Business logic produces events
    public void Ship() {
        if (Status != "Created") {
            throw new InvalidOperationException("Can only ship created orders");
        }

        var @event = new OrderShipped(Id, DateTimeOffset.UtcNow);

        Apply(@event);  // Mutate state
        _uncommittedEvents.Add(@event);  // Track for persistence
    }
}
```

### Pattern 2: Repository with Event Store

```csharp{title="Pattern 2: Repository with Event Store" description="Pattern 2: Repository with Event Store" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Repository", "Event"] unverified="application-level repository pattern composing the verified ReadPolymorphicAsync + AppendAsync APIs"}
public class OrderRepository(IEventStore eventStore) {
    private static readonly IReadOnlyList<Type> EventTypes =
        [typeof(OrderCreated), typeof(OrderShipped)];

    public async Task<Order> GetByIdAsync(Guid orderId, CancellationToken ct = default) {
        var order = new Order();

        await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, null, EventTypes, ct)) {
            order.Apply(envelope.Payload);
        }

        return order;
    }

    public async Task SaveAsync(Order order, CancellationToken ct = default) {
        var uncommittedEvents = order.GetUncommittedEvents();

        foreach (var @event in uncommittedEvents) {
            // Simple pattern - stream ID and event only
            await eventStore.AppendAsync(order.Id, @event, ct);
        }

        order.ClearUncommittedEvents();
    }
}
```

---

## Further Reading

**Workers**:
- [Perspective Worker](../operations/workers/perspective-worker.md) - Checkpoint processing lifecycle and runtime behavior
- [Execution Lifecycle](../operations/workers/execution-lifecycle.md) - Startup/shutdown coordination

**Core Concepts**:
- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Observability](../fundamentals/persistence/observability.md) - Message hops and tracing

**Data Access**:
- [Dapper Integration](dapper-integration.md) - Lightweight data access
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Perspectives Storage](perspectives-storage.md) - Read model schema design

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Work Coordinator](../messaging/work-coordinator.md) - Atomic batch processing

**Examples**:
- ECommerce: Event Sourcing - Real-world event store usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
