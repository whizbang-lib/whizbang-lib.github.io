---
title: Upgrade Guide
pageType: guide
audience: [consumer]
version: 1.0.0
category: Upgrading
order: 1
verifiedAgainstCommit: 078dc17d1
verifiedDate: 2026-11-20
description: >-
  The behavior changes an application meets when it upgrades Whizbang, from the 0.95x line through
  0.262x to 0.4521.0: for each one, the first release that carries it, what changed, who is affected
  and what to do. Read every section newer than the release you run.
tags: >-
  upgrading, upgrade guide, breaking changes, behavior changes, release notes, migration, 0.2626.0,
  0.4457.0, 0.4521.0
codeReferences:
  - CHANGELOG.md
  - src/Whizbang.Data.Postgres/Migrations/077_FullBodySplit.sql
  - src/Whizbang.Data.Postgres/Migrations/078_DropInlineBodyColumns.sql
  - src/Whizbang.Core/Messaging/IStreamPurger.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeySpellingPass.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Operations/StreamPurgeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamPurgeTests.cs
lastMaintainedCommit: '078dc17d1'
---

# Upgrade Guide

This page collects the changes an application meets when it upgrades Whizbang: anything that changes
what an existing application does, what it must change in code, configuration, SQL, alerts or
dashboards, or what happens to its data on the first start. Each entry names the first stable release
that carries it, what changed, who is affected and what to do, and links to the page that documents
the behavior in full, with the tests that verify it.

**How to read it.** Find the release you run now, then read every section for a newer release, oldest
first, which is the order you meet them in. A develop alpha carries a change from the first alpha
after its pull request merged; if you run an alpha, start at the newest stable release older than it.
Changes that need nothing from you (a fix that heals itself on the next start, a new opt-in feature)
are left to the [changelog](https://github.com/whizbang-lib/whizbang/blob/main/CHANGELOG.md), where the
changes up to 0.4457.0 are gathered under that release.

Moving the application from .NET 10 to .NET 11 is a separate step with its own page:
[Moving from .NET 10 to .NET 11](dotnet-10-to-11.md).

:::warning
Several changes below rewrite stored rows on the first start of the new release. Unless an entry says
otherwise, deploy such a release without a mixed fleet, or let a second start catch rows that an
older instance wrote meanwhile. [Rolling upgrades](../operations/startup/rolling-upgrades.md) explains
what one database shared by two versions allows.
:::

## 0.958.0

### Event payloads moved to `wh_event_body` {#event-body}

*Migrations 077 and 078.*

- **What changed:** every event's payload and metadata are stored in `wh_event_body`, keyed by
  `event_id`. `wh_event_store` is a narrow pointer table (`event_id`, `stream_id`, `version`,
  `commit_sequence`, `event_type`, `created_at`, `flags`, `scope`, origin columns), and its
  `event_data` and `metadata` columns are dropped. Existing bodies were moved by the migration.
- **Who is affected:** SQL that reads payloads from `wh_event_store` directly, and scripts that
  delete a stream's rows by hand.
- **What to do:** read events through the event store APIs. SQL that must read payloads joins
  `wh_event_body` on `event_id` (a `LEFT JOIN`, since a reaped ephemeral event has no body). Remove a
  stream with `IStreamPurger`, which deletes its events and bodies, every perspective's row,
  cursors, snapshots, outbox and inbox rows and integrity rows in one transaction per batch, records
  an audit entry, and marks the stream purged so a late event does not recreate a row. See
  [the event store](../data/event-store.md) and [purging streams](../operations/infrastructure/purging-streams.md).

## 0.2350.0

### Dates in perspective documents are stored as microseconds {#temporal-microseconds}

- **What changed:** every date, time and duration inside a perspective document is stored as a
  number of microseconds (an instant since 1970, a date at its midnight UTC, a time of day since
  midnight, a duration as is), on both storage paths, instead of an ISO string. Rows written by an
  earlier release are rewritten at startup (migration 153 records each table's conversion), and a
  row still holding a string reads as the value it renders. A date's index casts through `bigint`
  and is renamed for it.
- **Who is affected:** SQL or reports that read dates out of a perspective's `data` column, and
  indexes you created by hand over a date member.
- **What to do:** deploy without a mixed fleet. Change SQL that parses an ISO string out of a
  document to read the number; recreate hand-made date indexes over the `bigint` cast. See
  [dates, times and durations](../fundamentals/perspectives/jsonb-containment.md#dates-times-and-durations).

{verified: CanonicalTemporalFormatTests.ADateTimeIsMicrosecondsSinceTheEpochAsync, CanonicalTemporalFormatTests.ADateOnlyIsMicrosecondsAtMidnightUtcAsync, CanonicalTemporalRewriteIntegrationTests.OnePassConvertsEveryStoredFormAsync, CanonicalTemporalReaderToleranceTests.ARenderingIsReadAsTheValueItRendersAsync, OpaqueDocumentRoundTripTests.ARowHoldingRenderingsStillReadsAsync}

### Snapshots are versioned {#snapshot-versioning}

- **What changed:** perspective snapshots are stored as versioned envelopes. A snapshot written
  before, or one whose version does not match, is rebuilt from events on its first read
  (`SnapshotUpgradePolicy.RebuildFromEvents`, the default).
- **Who is affected:** services with many snapshotted streams; the first reads after the upgrade
  replay events instead of loading a snapshot.
- **What to do:** nothing, or choose another `SnapshotUpgradePolicy`. See
  [snapshots](../fundamentals/perspectives/snapshots.md).

## 0.2603.0

### Declared JSON names are honored on messages and events {#declared-json-names}

*[#920](https://github.com/whizbang-lib/whizbang/issues/920)*

- **What changed:** the generated message JSON context writes and reads the name in
  `[JsonPropertyName("...")]`. Before, it wrote the C# property name whatever the attribute said.
  A conditional `[JsonIgnore]` now skips the value only when writing, as System.Text.Json does.
- **Who is affected:** message and event types that carry `[JsonPropertyName]`: what they put on
  the wire and in new stored events changes to the declared name.
- **What to do:** upgrade every service that exchanges such a message together. Stored events are
  never rewritten; from 0.2626.0 they are read case-insensitively, so a name that differs only in
  case still reads (next section). A declared name that differs by more than case does not read old
  events: handle it with an upcaster or `[StoredForm(PreviousName = ...)]`. See
  [property names on the wire](../extending/source-generators/json-contexts.md#property-names).

## 0.2608.0

### Objects, lists and dictionaries promoted to a column are `jsonb` {#jsonb-physical-fields}

- **What changed:** a `[PhysicalField]` that holds an object, a record, a list, an array or a
  dictionary is a `jsonb` column, written under the persistence profile and kept out of the mapped
  document. Before, such a field with no `ColumnType` became a `TEXT` column holding the type's name,
  and a dictionary inside a model whose document is mapped as JSON was refused (WHIZ810). On the first
  start the schema pass renames each old text column to `<column>_text_legacy`, adds the `jsonb`
  column with its indexes and, on an Extracted model, fills it from the document.
- **Who is affected:** read models with such promoted fields, and models with dictionaries.
- **What to do:** on a Split model the document holds no copy, so the start logs a warning naming
  the column: rebuild the perspective to fill it. Drop each `_text_legacy` column yourself once
  satisfied. A dictionary that is not promoted still cannot live in a mapped document: promote it to
  a `[PhysicalField]` or replace it with a list of key/value records, as WHIZ810 says. See
  [jsonb columns](../fundamentals/perspectives/physical-fields.md#jsonb-columns) and
  [WHIZ810](../operations/diagnostics/whiz810.md). A later release stores every dictionary, promoted
  or not, as an array of key/value objects and retires WHIZ810; see
  [Dictionary Members](../fundamentals/perspectives/dictionary-members.md#upgrading).

{verified: PhysicalJsonbColumnGenerationTests.SchemaGenerator_NonScalarField_IsAJsonbColumnAsync, PhysicalJsonbColumnGenerationTests.EFCoreModel_JsonbField_IsLeftOutOfTheMappedDocumentAsync, PhysicalJsonbContainmentIntegrationTests.BothWritePaths_LeaveIdenticalRowsAsync}

## 0.2619.0

### Dapper driver: the schema is initialized at host start {#dapper-schema-at-start}

- **What changed:** `AddWhizbangPostgres` on the Dapper driver no longer initializes the schema
  while registering; it happens when the host starts.
- **Who is affected:** code that used the database between registration and host start.
- **What to do:** wait on `ISchemaReadyGate` first. With `initializeSchema: false` the gate opens at
  start. See [startup ordering](../fundamentals/work-coordinator/startup-ordering.md).

## 0.2622.0

### `[InheritScope]` is applied as documented {#inherit-scope}

- **What changed:** a model with `[InheritScope(Always = ...)]` and no `OnCreate` records every
  field at creation, and the attribute is read from the model, not the perspective class.
- **Who is affected:** read models that use `[InheritScope]`.
- **What to do:** add `OnCreate = ScopeFields.Tenant` to keep recording the tenant only; move an
  `[InheritScope]` from a perspective class to its model. See [scoping](../fundamentals/security/scoping.md).

### Four diagnostic IDs that meant two things now mean one {#diagnostic-ids-split}

- **What to do:** a `#pragma` or `.editorconfig` entry that suppressed one of the moved diagnostics
  names the new ID. See the [error reference](../operations/diagnostics/error-reference.md).

## 0.2624.0

### Every local receptor for a message runs {#all-local-receptors}

*[#1412](https://github.com/whizbang-lib/whizbang/issues/1412)*

- **What changed:** a local dispatch runs every receptor registered for the message, on every call.
- **Who is affected:** a command with more than one receptor, which used to run one of them.
- **What to do:** remove the receptor that should not run, or make both safe to run together. See
  [the dispatcher](../fundamentals/dispatcher/dispatcher.md).

### A returned value no receptor handles fails the call {#unhandled-returned-value}

*[#1418](https://github.com/whizbang-lib/whizbang/issues/1418)*

- **Who is affected:** receptors that return a message nothing handles, which used to be skipped.
- **What to do:** add a receptor for it, stop returning it, or set
  `WhizbangCoreOptions.RequireReceptorForReturnedResult = false` to keep skipping. See
  [message cascade](../fundamentals/dispatcher/message-cascade.md).

### The default local stage is `LocalImmediateInline` {#local-immediate-inline}

- **What changed:** `LocalImmediateInline` is the stage a receptor runs at by default, and a
  receptor at `LocalImmediateDetached` is a hook, not the message's handler.
- **Who is affected:** a receptor marked `[FireAt(LocalImmediateDetached)]` that is its message's
  only handler, and runtime registrations at that stage.
- **What to do:** remove the attribute or declare `LocalImmediateInline`. See
  [lifecycle stages](../fundamentals/lifecycle/lifecycle-stages.md).

### System events are stored by default {#system-events-default}

*[#1621](https://github.com/whizbang-lib/whizbang/issues/1621)*

- **What changed:** wherever an event store is registered, system events are stored.
- **What to do:** a service that wants none turns the kinds off in `SystemEventOptions` or registers
  `NullSystemEventEmitter`. See [system events](../fundamentals/events/system-events.md).

### No trace store is registered by default {#no-default-trace-store}

*[#1601](https://github.com/whizbang-lib/whizbang/issues/1601)*

- **What changed:** no `ITraceStore` is registered for you, and the in-memory store is bounded.
- **What to do:** a host that resolves `ITraceStore` registers one. See
  [persistence observability](../fundamentals/persistence/observability.md).

### System-event audit records are on the tenant's ledger {#system-audit-ledger}

*[#1555](https://github.com/whizbang-lib/whizbang/issues/1555)*

- **What to do:** a reader that looked for audit records on `$wb-system` reads the tenant's audit
  ledger instead. Perspectives that consume `EventAudited` by type are unaffected. See
  [audit logging](../fundamentals/security/audit-logging.md).

### The work-batch instruments are retired {#work-batch-instruments}

- **What to do:** move a dashboard or alert on a retired instrument to `flush.duration` (flush
  time), `perspective.claim.duration` (claim time) or `pg_stat_statements` (time per SQL function),
  and drop references to the removed properties. See [metrics](../operations/observability/metrics.md).

### Inbox batch settings moved {#inbox-batch-settings}

- **What changed:** `MessageProcessingOptions.InboxBatchSize` and its siblings are removed.
- **What to do:** set `Whizbang:Workers:InboxBatch:MaxSize`, `Whizbang:Workers:InboxBatch:SlidingWindow`
  and `Whizbang:Workers:InboxBatch:MaxWait` instead. The startup configuration check names these
  keys for a deployment that still sets the old ones. See the
  [configuration reference](../operations/configuration/configuration-reference.md).

### `TransientStorage.InMemory` is removed {#transient-storage-in-memory}

*[#1538](https://github.com/whizbang-lib/whizbang/issues/1538)*

- **What to do:** remove `Storage = TransientStorage.InMemory`; the default, `PersistedRow`, is what
  those types already got. See [ephemeral events](../fundamentals/events/ephemeral-events.md).

### No package depends on a non-open-source license {#packaging-licenses}

*[#1552](https://github.com/whizbang-lib/whizbang/issues/1552)*

- **What to do:** an application that serves GraphQL over HTTP (`AddGraphQLServer`, `MapGraphQL`)
  references `HotChocolate.AspNetCore` itself; one that used SQL Server through the transitive
  `Microsoft.Data.SqlClient` references it directly. See [GraphQL setup](../apis/graphql/setup.md).

### Ten never-reported diagnostic IDs are retired {#retired-diagnostics}

- **What to do:** remove suppressions of the retired IDs. See the
  [error reference](../operations/diagnostics/error-reference.md).

### The prefix truncate is named for what it does {#truncate-stream-prefix}

- **What changed:** `close_stream` is `wh_truncate_stream_prefix`, and the API, types and statuses
  were renamed with it.
- **What to do:** rename the calls and types; compare a result's `Status` with `"truncated"`
  instead of `"closed"`; change SQL that calls `close_stream(...)` or reads `close_status` to
  `wh_truncate_stream_prefix(...)` and `truncate_status`. A custom `IWorkCoordinator` overrides
  `TruncateStreamPrefixAsync` instead of `CloseStreamAsync`. See [event streams](../fundamentals/events/event-streams.md).

### The generators write nothing to disk by default {#generators-no-disk}

- **What changed:** the generators package writes no generated source to disk and embeds no
  message registry.
- **What to do:** for the VS Code extension's message registry, set
  `<WhizbangEmitMessageRegistry>true</WhizbangEmitMessageRegistry>`; to keep generated files on disk,
  set `<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>`. See
  [the message registry](../extending/source-generators/message-registry.md).

### Required capabilities are provisioned before the verdict {#capability-auto-provision}

*[#1750](https://github.com/whizbang-lib/whizbang/issues/1750)*

- **What changed:** at startup the `Capabilities` step creates every capability a requirement in
  force names, and upgrades a ready one when a newer version is available. On PostgreSQL that is
  `CREATE EXTENSION` or `ALTER EXTENSION ... UPDATE`, under the schema lock.
- **Who is affected:** databases where extensions are managed by an operator.
- **What to do:** to keep the library from creating or upgrading extensions, set
  `Whizbang:Capabilities:AutoProvision` to `false` (per provider or per capability as well);
  detection still uses an extension an operator created. See [capabilities](../operations/infrastructure/capabilities.md).

### Table statistics moved and widened {#table-statistics-moved}

*[#1488](https://github.com/whizbang-lib/whizbang/issues/1488)*

- **What to do:** a host that constructs `PostgresTableStatisticsProvider` itself takes it from
  `Whizbang.Data.Postgres.Observability`. Dashboards that sum `estimated_bytes` across tables now
  include every framework and perspective table. See [metrics](../operations/observability/metrics.md).

## 0.2626.0

### Stored keys that differ from a declared name only in case are rewritten {#declared-key-spelling}

*[#1874](https://github.com/whizbang-lib/whizbang/issues/1874)*

- **What changed:** perspective rows stored before 0.2603.0 hold a member under its C# name. Where
  that differs from the `[JsonPropertyName]` only in case, Entity Framework's mapped reader read the
  member's default with no error. The first start now moves such keys to the declared name, at any
  depth, on both drivers, and logs each table at Warning. Events are never rewritten; they are read
  case-insensitively.
- **Who is affected:** read models whose members carry `[JsonPropertyName]` and whose rows predate
  0.2603.0.
- **What to do:** deploy without a mixed fleet, or let a second start catch rows an older instance
  wrote meanwhile. A row holding both spellings with different values stops startup, naming the
  table, column, row and path, until one key is removed. A `required` non-nullable member missing
  from a stored row now fails that row's read: fill it with `[StoredForm(DefaultWhenMissing = ...)]`,
  rebuild, or drop `required`. Two members whose names differ only in case fail at first use; rename
  one. See [keys stored in another case](../fundamentals/perspectives/stored-form-migrations.md#declared-names).

{verified: DeclaredNameSpellingIntegrationTests.RowsStoredWithCSharpNames_AreRewrittenOnStartup_AndReadBackWithTheirValuesAsync, DapperDeclaredNameSpellingTests.RowsStoredWithCSharpNames_AreRewrittenAtHostStart_AndReadBackAsync, DeclaredNameSpellingIntegrationTests.ARowHoldingBothSpellings_StopsStartup_NamingItAsync, DeclaredNameReadTests.AnEventStoredWithCSharpNames_ReadsItsValues_UnderEitherProfileAsync}

### An array of records stores the model as one opaque document {#model-collections}

- **What changed:** on the Entity Framework driver, a read model holding an array of records (`T[]`
  of a non-primitive element, at any depth) failed to read back. Such a model is now stored as one
  opaque document, as a model holding a read-only collection interface of records or a recursive
  type already was: it reads and writes correctly, but nothing inside it is a mapped property, so its
  declared indexes are skipped and WHIZ200 and WHIZ304 say why. From 0.4457.0, an `ICollection<T>`,
  `IReadOnlyCollection<T>` or `IEnumerable<T>` of records on such a model can also be written (#2114).
- **Who is affected:** read models with arrays of records or collection interfaces, on the Entity
  Framework driver.
- **What to do:** for a mapped, indexable model, declare the member as `List<T>`, `IList<T>` or
  `ImmutableList<T>` of records. See
  [collections in read models](../fundamentals/perspectives/perspectives.md#model-collections).

{verified: MappedPathDiscoveryTests.AnArrayOfAComplexElementIsReportedAsync, MappedPathDiscoveryTests.ACollectionTheMappedPathCanFillIsNotReportedAsync, RecordArrayRoundTripTests.ArraysOfRecords_TopLevelAndNested_ReadBackAsWrittenAsync}

### A host with no broker starts {#no-broker}

*[#1876](https://github.com/whizbang-lib/whizbang/issues/1876)*

- **What changed:** with `AddTransportConsumer()` and no `ITransport` registered, the transport
  consumer is not started, readiness does not wait for subscriptions, and startup logs once that
  cross-service messaging is off. Startup used to fail validation.
- **Who is affected:** broker-less applications that registered `InProcessTransport` in production to
  get past validation.
- **What to do:** remove that registration. See [the transport consumer](../messaging/transports/transport-consumer.md).

{verified: TransportConsumerWithoutATransportTests.AddTransportConsumer_WithNoTransport_StartsNoConsumerAsync, TransportConsumerWithoutATransportTests.AddTransportConsumer_WithNoTransport_ReadinessDoesNotWaitForAConsumerAsync}

### A dispatch during the migration waits for it {#dispatch-during-migration}

*[#1877](https://github.com/whizbang-lib/whizbang/issues/1877)*

- **What changed:** a send, publish, local invoke or cascade made before the migration completes
  waits for it, instead of failing at once with `WhizbangNotReadyException`. The wait honors the
  caller's cancellation token and is bounded by `Whizbang:SchemaInitialization:DispatchMaxWait`
  (five minutes by default), after which it fails as before.
- **Who is affected:** startup seeds and requests served during the migration, and code that caught
  `WhizbangNotReadyException` to retry.
- **What to do:** remove such retry loops, or set `DispatchMaxWait` to `00:00:00` to keep the
  immediate refusal. See [dispatch waits for the migration](../operations/workers/database-readiness.md#dispatch-waits-for-the-migration).

{verified: DispatcherSchemaGateTests.Send_WithTheGateClosed_DefersUntilTheMigrationCompletesAsync, DispatcherSchemaGateTests.DeferredDispatch_ByDefault_WaitsAtMostFiveMinutesThenThrowsNotReadyAsync}

### First-event detection: `ApplyContext.Current.IsFirstEventInStream` {#first-event}

*[#1878](https://github.com/whizbang-lib/whizbang/issues/1878)*

- **What changed:** the runner never passes `Apply` a null model, so `current is null` never
  detected a stream's first event. The new fact is decided by the event's position in its stream, so
  a live apply, a rewind, a rebuild and a replay agree. The analyzer warning WHIZ107 reports an
  `Apply` that tests its current model for null.
- **Who is affected:** perspectives that test the current model for null to find a stream's first event.
- **What to do:** test `ApplyContext.Current.IsFirstEventInStream` instead. In a unit test that calls
  `Apply` directly, set it with `ApplyContext.Enter`. See [WHIZ107](../operations/diagnostics/whiz107.md).

{verified: PerspectiveCurrentModelAnalyzerTests.AnApplyThatTestsItsCurrentModelForNull_IsWarnedThatItNeverIsAsync, FirstEventInStreamReadTests.ReadPolymorphicAsync_MarksOnlyTheEventAtTheStreamsFirstPositionAsFirstAsync, ApplyContextTests.Enter_MakesTheFactCurrentUntilTheScopeIsDisposedAsync}

### A new stream starts at version 1 on every path {#stream-version-one}

*[#1913](https://github.com/whizbang-lib/whizbang/issues/1913)*

- **What changed:** a direct append (`IEventStore.AppendAsync`), and the in-memory and Sqlite stores,
  numbered a new stream from 0 while the outbox and inbox numbered from 1. Every path starts at 1.
  Existing streams keep their numbering.
- **Who is affected:** code that appends directly and reads by sequence: after three appends
  `GetLastSequenceAsync` returns 3, and `ReadAsync(fromSequence: 3)` returns the third event.
- **What to do:** adjust sequence arithmetic that assumed 0 for a new stream. See
  [event streams](../fundamentals/events/event-streams.md).

### Perspective tables follow their model's storage settings {#perspective-storage-parameters}

*[#1747](https://github.com/whizbang-lib/whizbang/issues/1747)*

- **What changed:** a perspective table's fillfactor and autovacuum settings are set from its model
  at every start.
- **Who is affected:** tables whose storage parameters were set by hand.
- **What to do:** list such a table in `perspective_storage_manual_tables` before upgrading, or its
  hand-set values are reset at the first start. See [physical fields](../fundamentals/perspectives/physical-fields.md).

## 0.4457.0

0.4457.0 gathers everything that merged after 0.2626.0. It is also the first release whose packages
carry both `net10.0` and `net11.0` builds; see [the .NET 11 page](dotnet-10-to-11.md).

### Dispatch, receptors and security

#### Receptor interceptors run before every receptor {#receptor-interceptors}

*[#1996](https://github.com/whizbang-lib/whizbang/issues/1996)*

- **What changed:** registered `IReceptorInterceptor`s are asked before every receptor invocation:
  local dispatch, cascades, runtime registrations, every lifecycle stage and inbox delivery.
- **Who is affected:** hosts that register `DefaultRequirePermissionInterceptor`, which now enforces
  every `[RequirePermission]` on every path where the attribute was inert before; interceptors that
  apply to an `ISyncReceptor`.
- **What to do:** grant the permissions those receptors declare before registering the interceptor;
  make an interceptor for a sync receptor complete synchronously. See [security](../fundamentals/security/security.md).

#### A repaired event runs a receptor only when it opts in {#run-on-repair}

*[#2273](https://github.com/whizbang-lib/whizbang/issues/2273)*

- **What changed:** an event delivered again by stream-integrity repair runs a receptor only when
  this service can prove it never handled the event.
- **What to do:** a receptor that should converge state from repaired events, and is idempotent,
  adds `[RunOnRepair]`. See [lifecycle receptors](../fundamentals/receptors/lifecycle-receptors.md).

#### The saga per-item stream namespace is first-registration-wins {#saga-namespace}

*[#2021](https://github.com/whizbang-lib/whizbang/issues/2021)*

- **What to do:** a process that relied on a later registration replacing the namespace injects
  `ISagaItemStreamIdDeriver` to derive under its own namespace. See [sagas](../fundamentals/sagas/whizbang-sagas.md).

#### Per-assembly registrations: the latest wins {#latest-registration-wins}

*[#2201](https://github.com/whizbang-lib/whizbang/issues/2201)*

- **What to do:** nothing unless a startup warning names a collision; then remove one of the two
  registrations, or keep the latest and set the mode to `Warn` explicitly.

#### A host gets only its own service's generated registrations {#own-registrations}

*[#2243](https://github.com/whizbang-lib/whizbang/issues/2243)*

- **What to do:** delete test helpers that removed other services' generated registrations; they are
  no longer needed. A second `AddWhizbang()` call no longer registers every generated callback again.

#### Collective apply handlers in several assemblies {#collective-handlers}

*[#2238](https://github.com/whizbang-lib/whizbang/issues/2238)*

- **What to do:** call `AddCollectiveEventsEFCore<TDbContext>()` or `AddCollectiveEventsDapper()` with
  no argument. The overloads that take `CollectiveApplyRegistry.Entries` are obsolete and fail a build
  under `TreatWarningsAsErrors`. See [collective events](../fundamentals/messaging/collective-events.md).

#### A composite's child gets one id on every path {#composite-child-ids}

*[#2266](https://github.com/whizbang-lib/whizbang/issues/2266)*

- **What changed:** a child named on the wire with a version derives a new id once this release runs.
- **Who is affected:** services that expand composites. A composite expanded before the upgrade and
  again after it stores its children a second time, and a publisher and a receiver on opposite sides
  of the upgrade derive different ids.
- **What to do:** roll the release out to publishers and receivers together where composites cross
  services. See [composite events](../fundamentals/messaging/composite-events.md).

#### Strong ids are GraphQL scalars {#graphql-strong-ids}

*[#2073](https://github.com/whizbang-lib/whizbang/issues/2073)*

- **What changed:** a strong-id field, argument or input field that was an object with a `value`
  field (`orderId { value }`) is the id's scalar (`orderId`), and the `OrderId` and `OrderIdInput`
  types are replaced by `scalar OrderId`. Filters compare the id itself.
- **Who is affected:** every GraphQL client of a strong-id field.
- **What to do:** update client queries, inputs and filters before or with the upgrade. See
  [GraphQL setup](../apis/graphql/setup.md).

### Perspectives and read models

#### An `Apply` outside its interface's shape fails the build {#apply-shapes}

*[#1936](https://github.com/whizbang-lib/whizbang/issues/1936)*

- **What changed:** an `Apply` that returns a shape its interface does not declare, or a second `Apply`
  for one event, is a build error.
- **What to do:** list each such event under `IPerspectiveWithActionsFor<TModel, ...>`, return
  `ApplyResult<TModel>` from its `Apply`, and delete the explicit implementation. `ApplyResult<TModel>`
  converts implicitly from the model, from `ModelAction` and from the tuple. See
  [perspectives with actions](../fundamentals/perspectives/perspectives-with-actions.md).

#### The perspective worker writes a batch set-based {#set-based-writes}

*[#2246](https://github.com/whizbang-lib/whizbang/issues/2246)*

- **What to do:** nothing by default. To keep the per-stream writes, set
  `PerspectiveWorkerOptions.WriteMode = PerspectiveWriteMode.PerStream`. Custom `IPerspectiveStore`,
  `IPerspectivePurgeMarkerStore` and `IEventStore` implementations keep compiling through default
  members. See [write modes](../fundamentals/perspectives/write-modes.md).

#### `updated_at` is indexed only with row retention {#updated-at-index}

*[#2087](https://github.com/whizbang-lib/whizbang/issues/2087)*

- **What to do:** a query that orders or filters on `UpdatedAt` against a table without row retention
  declares the index with `[PerspectiveIndex(PerspectiveRowColumns.UpdatedAt)]`, or pins it
  (`Whizbang:Schema:Reconcile:Pins`, or a `whizbang:pin` comment on the index). See
  [perspective indexes](../fundamentals/perspectives/perspective-indexes.md).

#### A read model of only ephemeral events takes no snapshots {#ephemeral-only-snapshots}

*[#2295](https://github.com/whizbang-lib/whizbang/issues/2295)*

- **What to do:** mark such a perspective `[KeepEphemeralRewindFloor]` if it needs rewinds after the
  rewind grace window. Snapshots taken before are left in place. See [snapshots](../fundamentals/perspectives/snapshots.md).

#### Recursive models keep every level; rebuild them {#recursive-models}

*[#2112](https://github.com/whizbang-lib/whizbang/issues/2112)*

- **What changed:** a recursive type in a perspective model is written whole. A row written earlier
  holds only the first level, and nothing in the database can restore the rest.
- **What to do:** rebuild every perspective whose model is recursive after upgrading. See
  [rebuild](../fundamentals/perspectives/rebuild.md).

#### A rebuild reads archived data only when it opts in {#rebuild-archived}

*[#1931](https://github.com/whizbang-lib/whizbang/issues/1931)*

- **What to do:** a rebuild that relied on reading an archived prefix sets
  `RebuildArchivedData.IncludeWhileLive`. See [rebuild](../fundamentals/perspectives/rebuild.md).

### Storage, archiving and stream end of life

#### Sealed streams are archived after their grace {#sealed-stream-archive}

*[#1734](https://github.com/whizbang-lib/whizbang/issues/1734), [#1740](https://github.com/whizbang-lib/whizbang/issues/1740)*

- **What changed:** every sealed stream is archived once its grace has passed after this release
  starts, after a final snapshot. A stream type that sets an end-of-life `Action` is disposed of by
  that action instead.
- **What to do:** set `FinalizeGrace` to keep streams hot longer, or return
  `DestructionResult.Defer` from a hook. See [stream end of life](../fundamentals/events/stream-end-of-life.md).

#### Superseding history is reclaimed by default {#superseding-reconcile}

*[#2110](https://github.com/whizbang-lib/whizbang/issues/2110)*

- **What changed:** a type already declared `[Superseding]` has the history stored before its
  declaration reclaimed down to the newest event of each key once consumed, and registers one new
  type definition on its first boot (logged as drift once).
- **What to do:** set `Whizbang:Superseding:ReconcileHistory` to `false` to keep that history. See
  [superseding events](../fundamentals/events/superseding-events.md).

#### Stored event metadata is slim {#slim-metadata}

*[#1725](https://github.com/whizbang-lib/whizbang/issues/1725), [#1727](https://github.com/whizbang-lib/whizbang/issues/1727)*

- **What changed:** stored events carry one slim hop and a route id. An envelope read back from the
  event store has no caller information, topic or service instance on its hops (the trace store has
  them), and `PerspectiveMetadata.Timestamp` is the first hop's time. Older rows are converted in the
  background, which leaves a dead tuple per converted row until vacuum.
- **Who is affected:** code that reads hop details from stored events.
- **What to do:** read them from the trace store; to keep a type's rows full, use
  `[StoredMetadata(StoredMetadataForm.Full)]`. See [stored metadata](../data/event-store.md#stored-metadata).

#### Audit changes {#audit}

*[#1724](https://github.com/whizbang-lib/whizbang/issues/1724), [#1730](https://github.com/whizbang-lib/whizbang/issues/1730), [#2040](https://github.com/whizbang-lib/whizbang/issues/2040)*

- Audit record ids are derived from the event, not random: a reader that treated two records of one
  event as two entries now sees one.
- An ephemeral event type is no longer audited by default; add `[AuditEvent(IncludeBody = true)]` to
  keep auditing it.
- An event type missing from the generated message-type catalog is audited under `OptOut`, whatever
  attribute it carries.

See [audit logging](../fundamentals/security/audit-logging.md).

#### The archive no longer bumps the origin generation {#archive-generation}

*[#2363](https://github.com/whizbang-lib/whizbang/issues/2363)*

- **What to do:** code that read the generation an archive returned as proof that something moved
  reads `ArchiveWriteResult.Archived`. See [the archive store](../fundamentals/events/archive-store.md).

#### Storage settings belong in configuration {#rewrite-settings}

*[#2319](https://github.com/whizbang-lib/whizbang/issues/2319)*

- **What to do:** a rewrite threshold or row floor set by hand in `wh_settings` is overwritten on the
  next start; set it in configuration. See the
  [configuration reference](../operations/configuration/configuration-reference.md).

#### Operational records roll off {#operational-retention}

*[#2354](https://github.com/whizbang-lib/whizbang/issues/2354)*

- **What changed:** rewrite-log generations older than 14 days are removed; a consumer that far
  behind resets its seal and re-verifies once. See
  [operational retention](../operations/infrastructure/operational-retention.md).

#### Pinned-type ledgers record the assembly {#pinned-ledger-assembly}

*[#2264](https://github.com/whizbang-lib/whizbang/issues/2264)*

- **What to do:** the next build adds `"assembly"` to every entry of each committed ledger; commit
  that change. When you move a pinned type to another assembly, move its ledger entry with it. See
  [the pinned type ledger](../fundamentals/identity/pinned-type-ledger.md).

#### Generic type names are stored version-free {#version-free-names}

*[#2267](https://github.com/whizbang-lib/whizbang/issues/2267)*

- **What changed:** a generic event type stored under a name carrying type-argument versions is
  stored under the version-free name from now on; the framework's comparisons match both.
- **Who is affected:** SQL that matches `event_type` text exactly. See
  [type formatting](../fundamentals/identity/type-formatting.md).

### Startup, migrations and process exit

#### Older instances stand down when a newer version is online {#newer-version-stand-down}

*[#2022](https://github.com/whizbang-lib/whizbang/issues/2022), [#2122](https://github.com/whizbang-lib/whizbang/issues/2122)*

- **What changed:** a newer instance that serves signals older running instances to stand down. An
  instance serves a database a newer version touched only when nothing was applied after its own
  version; an older version rolls back what can be reversed, needs
  `Whizbang:Startup:AllowLossyRollback=true` for a lossy reversal, and stands down for an
  irreversible one. A rollback with nothing migrated since now serves normally.
- **What to do:** plan rollbacks around it. See [rolling upgrades](../operations/startup/rolling-upgrades.md).

#### `StartupVerdict` has a fourth value {#startup-verdict-current}

- **What to do:** an exhaustive `switch` over `StartupVerdict` needs a `Current` arm, which behaves
  like `Serve` for readiness. See [rolling upgrades](../operations/startup/rolling-upgrades.md#current).

#### Workers are hosted through `AddWhizbangWorker` {#add-whizbang-worker}

- **What changed:** the `ISchemaReadyGate` constructor parameter is removed from every worker that had one.
- **What to do:** a host that registers `ServiceBusConsumerWorker`, `PerspectiveMigrationWorker` or its
  own worker with `AddHostedService` uses `AddWhizbangWorker` instead, or the worker starts before the
  schema is migrated. See [startup ordering](../fundamentals/work-coordinator/startup-ordering.md).

#### Every exit goes through one path, with defined exit codes {#exit-codes}

*[#2126](https://github.com/whizbang-lib/whizbang/issues/2126)*

- **What changed:** exits carry one code per cause: 0 for a host shutdown, an operator stop or an
  upgrade stand-down, 1 crash, 2 unknown, 3 cluster eviction, 4 startup failure, 5 schema
  incompatible. An evicted instance exits with 3 so its host restarts it. A capability that is not
  ready exits with 4 (it was 1), and a blocking schema initialization that fails exits with 4 (5 for
  a schema newer than the binary) instead of throwing out of host start.
- **What to do:** let the orchestrator restart on a non-zero exit, and update alerts keyed on the old
  codes. See [instance liveness](../fundamentals/workers/instance-liveness.md).

#### Settings with credentials are `SensitiveString` {#sensitive-strings}

*[#2251](https://github.com/whizbang-lib/whizbang/issues/2251)*

- **What changed:** `AzureBlobArchiveOptions.ConnectionString`, `AzureBlobOffloadOptions.ConnectionString`,
  `WhizbangNotificationOptions.DirectConnectionString` and `WhizbangPinnedPoolOptions.ConnectionString`
  are `SensitiveString?`.
- **What to do:** assigning a string still compiles; code that reads one as a string calls
  `.Reveal()`. See [sensitive settings](../operations/configuration/sensitive-settings.md).

#### Namespaces that moved {#moved-namespaces}

- `ScheduledPrefixTruncateReceptor` and `RebuildPerspectiveCommandReceptor` moved from
  `Whizbang.Data.EFCore.Postgres` to `Whizbang.Data.Postgres` (both now run on the Dapper driver as
  well). Hosts that only send the commands change nothing.
- The types of the unused tables are removed from the public API, with no replacement.

### Messaging and delivery

#### Outbox writes are coalesced across streams {#outbox-coalesced}

*[#2220](https://github.com/whizbang-lib/whizbang/issues/2220)*

- **What to do:** nothing by default. To keep the per-stream batcher, register
  `AddWhizbangOutboxStrategy<SlidingWindowOutboxBatchStrategy>()`. See
  [the outbox batch strategy](../extending/internals/outbox-batch-strategy.md).

#### App signals in a transaction are delivered on commit {#app-signals-commit}

*[#2076](https://github.com/whizbang-lib/whizbang/issues/2076)*

- **What to do:** a custom `ISignalTopicTransport` implements
  `PublishTopicAsync(topic, payload, DbTransaction? transaction, ...)`. A payload PostgreSQL rejects
  (over 8000 bytes) published inside a caller's DbContext transaction now fails that transaction.
  See [app signals](../fundamentals/work-coordinator/app-signals.md).

### Logging, alerts and dashboards

#### Log levels changed for retries, dead letters and database failures {#log-levels}

*[#1901](https://github.com/whizbang-lib/whizbang/issues/1901), [#1983](https://github.com/whizbang-lib/whizbang/issues/1983)*

- A failed attempt that will be retried logs at Warning on every path. Alerts keyed on those lines
  at Error, or on EventIds 5, 58 or 73 at Error, stop firing.
- A dead-lettered message is logged at Error, once, as EventId 1901 `MessageDeadLettered`, so an alert
  keyed on Error may start firing for dead letters. Set `Whizbang:DeadLetterLogging:Level` to
  `Warning` to keep the old severity; queries on the retired EventIds 5, 6 or 10 read 1901.
- A transient database failure in a worker loop logs at Warning. Alert on EventId 1986
  `DatabaseFailurePersisting`, logged once per worker when the database keeps failing, instead of
  EventIds 7, 53 or 67 at Error.
- Four failures that were retried with no bound now end in a dead letter.

See [logging categories](../operations/observability/logging-categories.md) and
[transient database failures](../fundamentals/workers/transient-database-failures.md).

#### A failing receptor's span records an `exception` event {#receptor-span-exception}

*[#1902](https://github.com/whizbang-lib/whizbang/issues/1902)*

- **What to do:** a trace query that read the error tags on a receptor span reads the event's
  attributes of the same names. See [tracing](../operations/observability/tracing.md).

#### The table-statistics probe reads every five minutes {#table-statistics-interval}

*[#2349](https://github.com/whizbang-lib/whizbang/issues/2349)*

- **What to do:** a dashboard that relied on 30-second freshness sets `CollectionInterval` back to
  `00:00:30`. See [metrics](../operations/observability/metrics.md).

### Stream integrity

These matter to services that run [stream integrity](../resilience/stream-integrity.md).

- **Dapper hosts:** every `Whizbang:StreamIntegrity` switch now defaults to off, and a configuration
  that turns one on, or sets `RepairMode` to `AutoRepairCapped`, fails at start naming the feature
  (#2051).
- **Seal re-check and full-history compare are off by default** (#2353). Set
  `Whizbang:StreamIntegrity:SealRecheck:Enabled` and `Whizbang:StreamIntegrity:FullHistoryCompare:Enabled`
  to `true` to keep them.
- **Mixed fleets pause integrity** (#2362): a service on an earlier release sends no rule
  fingerprint, so integrity between it and an upgraded service pauses until both run this release,
  and nothing is repaired across the pair meanwhile.
- **Idle origins send checkpoints as heartbeats** (#2348). During a mixed fleet an older consumer may
  log a stale-origin warning; set `CheckpointHeartbeatMinutes` to 0 to keep sending every interval.
- **Superseding types count their key** (#2364): the first start recounts digests once
  and bumps the origin generation once, so consumers re-verify once.
- **API changes:** `IsOwnedByAnother(type, origin)` is `IsNotAuthoritative(type, origin, ownedDomains)`
  (pass this service's owned domains; an empty list keeps the old answer), and a direct caller of
  `RedeliveryPump.BeginAnswer` passes `answersWholeType`.

## 0.4521.0

### Runtime async on the .NET 11 build {#runtime-async}

*[#2241](https://github.com/whizbang-lib/whizbang/issues/2241)*

- **What changed:** the `net11.0` build of every package is compiled with .NET 11's runtime async.
  Live stack traces show Whizbang's real call chain; exception stack traces look as before.
  Benchmarks showed no measurable difference in time or allocations. The `net10.0` build is unchanged.
- **Who is affected:** anyone who reads live stacks of Whizbang frames in a profiler or debugger on
  .NET 11.
- **What to do:** nothing. See [runtime async on .NET 11](../operations/performance/profiling.md#runtime-async).

## Unreleased

### One Azure Blob package; the driver owns the archive transaction {#storage-azure-blob}

*[#2502](https://github.com/whizbang-lib/whizbang/issues/2502), [#2503](https://github.com/whizbang-lib/whizbang/issues/2503)*

- **What changed:** `Whizbang.Storage.AzureBlob` replaces `Whizbang.Offloads.AzureBlob` and
  `Whizbang.Archive.AzureBlob`, which ship this release as shims over it. It activates from
  `Whizbang:Storage:AzureBlob` with no registration call. The archive's database transaction moved
  into the Postgres driver (`PostgresObjectArchiveStore`); nothing stored changed, so a rolling deploy
  beside the previous release works.
- **Who is affected:** hosts that archive or offload to Azure Blob Storage; code that resolved
  `AzureBlobArchiveStore`, caught `Whizbang.Archive.AzureBlob.ArchiveObjectCorruptedException`, or names
  the options types; hosts on SQLite whose lifecycle policies archive (the start now fails).
- **What to do:** nothing is required this release: the earlier calls (now `[Obsolete]`) and keys
  (now with a startup warning) keep working. To move, follow
  [migrating from the earlier packages](../fundamentals/storage/azure-blob.md#migrating-from-the-earlier-packages).

### Event and message ids that are not UUIDv7 are refused {#time-ordering-checks}

*[#2528](https://github.com/whizbang-lib/whizbang/issues/2528)*

- **What changed:** event and message ids are checked for UUIDv7 where they enter the framework: every
  work coordinator strategy, every outbox and inbox write (including dead letters), every event store
  append, and the ids a caller supplies to the dispatcher. A non-v7 id throws `GuidOrderingException`
  before any SQL runs, and nothing of its batch is written. `GuidOrderingViolationSeverity` now
  defaults to `Error` (it was `Warning`, and nothing called the check). `Guid.Empty` is refused at every
  severity. A stream id that is not UUIDv7 is logged once and counted, not refused; the new
  `StreamIdOrderingViolationSeverity` (default `Warning`) can raise it to `Error`.
- **Who is affected:** applications that build event or message ids from `new Guid(...)`, `Guid.Parse`,
  a v4 or v5 generator, or a value from another system. Ids minted with `TrackedGuid.New()`,
  `MessageId.New()` or a `[WhizbangId]` type's `New()` are UUIDv7 and are unaffected. The new warning
  [WHIZ037](../operations/diagnostics/whiz037.md) points at most of these flows at compile time.
- **What to do:** mint those ids with `TrackedGuid.New()` or a `[WhizbangId]` type. To find offenders
  without refusing them, set `Whizbang:GuidOrderingViolationSeverity` to `Warning`, watch
  `whizbang.guid_ordering.non_v7_message_ids` (meter `Whizbang.GuidOrdering`) until it stays at zero,
  then return to `Error`. See
  [Time-ordering checks](../fundamentals/identity/whizbang-ids.md#time-ordering-checks).

### Guid interception is on by default and returns UUIDv7 {#guid-interception-default}

*[#2528](https://github.com/whizbang-lib/whizbang/issues/2528)*

- **What changed:** the Guid interceptor is on by default, and an intercepted `Guid.NewGuid()` or
  `Guid.CreateVersion7()` now returns `TrackedGuid.New()`, a UUIDv7. Before, interception was opt-in
  and wrapped the original call. Calls into Marten, UUIDNext and Medo.Uuid7 are no longer intercepted.
- **Who is affected:** every project that references the generator. Code that relied on
  `Guid.NewGuid()` returning a random v4, for example to spread keys across a range, now gets
  time-ordered ids.
- **What to do:** nothing for a project that references the NuGet package; its props allows the
  interceptors namespace. A project that references the generator as a project adds
  `<InterceptorsNamespaces>$(InterceptorsNamespaces);Whizbang.Generators.Generated</InterceptorsNamespaces>`.
  Where a random v4 is genuinely needed, mark the code `[SuppressGuidInterception]`.
  `WhizbangGuidInterceptionEnabled=false` turns interception off, which is strongly advised against. See
  [Guid interception](../fundamentals/identity/whizbang-ids.md#guid-interception).

### A `[GenerateStreamId]` message keeps its stream when sent again {#generated-stream-per-instance}

*[#2539](https://github.com/whizbang-lib/whizbang/issues/2539)*

- **What changed:** sending the same message instance twice now keeps its generated stream instead of minting a
  second one.
- **What to do:** create a new message instance for each new stream. See
  [GenerateStreamId](../extending/attributes/generatestreamid.md#derived-stream-ids).

### Every dispatch inside a handling derives its message ids {#every-dispatch-derives}

*[#2543](https://github.com/whizbang-lib/whizbang/issues/2543)*

- **What changed:** inside a receptor's handling, `SendAsync`, every `LocalInvokeAsync` and
  `LocalInvokeWithReceiptAsync` overload, the batch methods (`SendManyAsync`, `LocalSendManyAsync`,
  `PublishManyAsync`, `LocalInvokeManyAsync`), a publish routed to local receptors only, and `CascadeMessageAsync`
  with no source envelope now derive their message ids from the handling, as explicit publishes already did. A
  redelivered handling sends the same messages under the same ids. Outside a handling every id is still a fresh
  UUIDv7.
- **Who is affected:** nobody needs to change code. A handling first run before the upgrade and redelivered after it
  sends once more under new ids, as before. A handling that publishes to its local receptors only, or cascades with no
  source envelope, now spends an emission ordinal on that call, so the events it emits afterwards derive different ids
  than on the previous version for a handling redelivered across the deploy.
- **What to do:** nothing. See
  [Every dispatch path inside a handling derives](../fundamentals/dispatcher/message-cascade.md#every-dispatch-path-derives).

### The partition map moves about 1/N of the partitions, after membership settles {#incremental-partition-map}

*[#2558](https://github.com/whizbang-lib/whizbang/issues/2558)*

- **What changed:** the published partition assignment carries an explicit map of the 10,000 partitions to its
  members, and every claim reads it. A join takes about 1/(N+1) of the partitions evenly from the others, a leave
  spreads its share evenly over the rest, and nothing else moves; before, every join or leave moved nearly all
  partitions. Membership changes are collected for a settle window
  (`Whizbang:Database:PartitionAssigner:SettleWindow`, default 5 seconds) before one map is published, and an instance
  is given partitions only once its startup reports ready. `AssignmentLease` and `RepublishInterval` now bind from the
  same section. Migrations 564 and 566.
- **Who is affected (breaking for implementers):** code that implements `IPartitionAssignmentStore`, or calls
  `PartitionAssigner.Evaluate` itself. Hosts on the drivers' registrations change nothing. During a rolling deploy,
  instances of the previous release publish without a map, and the claims then rank by modulo exactly as before.
- **What to do:** an `IPartitionAssignmentStore` takes a `PartitionMap` in `PublishAsync` where it took the member list
  (`map.Members` is that list), and implements `OpenOwnershipByMapAsync`. A call to `PartitionAssigner.Evaluate` passes
  how long the membership has been unsettled (`unsettledFor`) before the options. See
  [The incremental map](../fundamentals/work-coordinator/partition-assignment.md#incremental-map).

### The Dapper driver elects its duties and runs the partition assigner; `Enabled` is removed {#dapper-coordination}

*[#2559](https://github.com/whizbang-lib/whizbang/issues/2559)*

- **What changed:** both Postgres drivers register role assignment and the elected partition assigner through one
  shared registration. On Dapper, the maintainer (the maintenance sweep and its steps, and the table rewrite at
  startup), each perspective table's blue-green rebuild guard and the partition assigner now run on one elected
  instance instead of on every instance, and a claim presents the published partition map. When the holder dies, a
  survivor takes the duty over once its lease lapses. Schema migration on Dapper is unchanged: every instance migrates
  under the schema lock in turn, and no migrator is elected. `PartitionAssignerOptions.Enabled` is removed: the
  assigner always runs, in every driver.
- **Who is affected:** Dapper services that watched the maintainer's work on every instance now see it on the one
  instance holding the `maintainer` role (the `roles` health component names it). Code or configuration that set the
  assigner's `Enabled`.
- **What to do:** nothing in code for Dapper. Delete any `options.Enabled = ...` line from a
  `Configure<PartitionAssignerOptions>` call, and the `Whizbang:Database:PartitionAssigner:Enabled` key from
  configuration: it is reported once at startup as a removed key and changes nothing (it fails the start only when
  unknown keys are set to throw). See [Dapper coordination](../data/dapper-integration.md#coordination).

### The rollback gate judges by content, with one verdict for W! and one for the application {#two-verdicts}

*[#2553](https://github.com/whizbang-lib/whizbang/issues/2553)*

- **What changed:** a schema change the ledger records counts as applied since this version only when this build does
  not make the same change (the same name with the same content hash); a change this build defines identically is
  current, whatever version applied it. A database restored from another environment, whose ledger records a
  SemVer-higher application version, now migrates or serves instead of standing down forever. Stored-form and
  temporal-form conversions record a content hash too (migration 568); one recorded before that is identified by its
  name. The W! migrations and the application's schema are then judged apart, each with its own verdict, reason and log
  line: the W! migrations run first, an application stand-down never blocks them, and the instance serves only when
  both sides can. The incompatibility override and the lossy rollback switch can be scoped to one side with
  `Whizbang:Startup:Platform:OverrideIncompatibility`, `Whizbang:Startup:Application:OverrideIncompatibility`,
  `Whizbang:Startup:Platform:AllowLossyRollback` and `Whizbang:Startup:Application:AllowLossyRollback`; the shared keys
  keep meaning both sides.
- **Who is affected:** hosts that set the shared `Whizbang:Startup:OverrideIncompatibility` for an incompatibility that
  is the application's alone: the application's schema is now served as it is **and the W! migrations still run** (the
  verdict is `Serve` or `Migrate`, where it was `Current` with nothing applied). That is the per-side decision, not a
  regression. Code that calls `EnsureWhizbangInitializedAsync` on an instance whose application schema stood down: it
  now applies the W! migrations, then throws `SchemaStandDownException` naming the side and its reason. Code that builds
  an `EFCorePostgresStartupAssessor`, a `SchemaRollbackRequest`, or calls `UpgradeOrder.AppliedSince` itself.
- **What to do:** nothing, for a host on the drivers' registrations. Code that builds an
  `EFCorePostgresStartupAssessor` passes a `SchemaGateOverrides` (`UpgradeOrder.ReadOverrides(configuration)`) in
  place of the two booleans. Code that builds a `SchemaRollbackRequest` passes the `RollbackPlan` in place of
  `AllowLossy`, and what this build defines (an `IReadOnlyDictionary<string, string>` of ledger name to content hash).
  `UpgradeOrder.AppliedSince` takes that dictionary too (`null` judges by version alone). See
  [Two verdicts](../operations/startup/rolling-upgrades.md#two-verdicts) and
  [a restored database](../operations/startup/rolling-upgrades.md#restored-database).

### Ownership by map, opt-in and off by default {#ownership-by-map}

*[#2554](https://github.com/whizbang-lib/whizbang/issues/2554), [#2555](https://github.com/whizbang-lib/whizbang/issues/2555)*

- **What changed:** a partition ownership table (`wh_partition_ownership`, one row per partition) is written by the
  partition assigner with every map it publishes, and one predicate (`wh_i_own`) answers whether an instance may claim a
  partition. With a per-service switch on, every claim path decides through that table alone: a stream's first writer
  is no longer pinned as its owner, new perspective work is leased by partition, a live stored owner no longer keeps a
  stream the map has moved, and a claimer with no valid map claims nothing and waits instead of ranking itself. The
  wake-up notification goes to the instance the map names for each stream's partition, with the switch off as well.
  Every heartbeat records `partition_ownership_level` in the instance's registry metadata. Migrations 565 to 567.
- **Who is affected:** nobody by default. The switch turns on only when `PartitionAssignerOptions.OwnershipByMap` is
  set (default `false`) and every live instance of the service supports the mode, and it is one-way. It stays off by
  default until the handover and fencing that make moving a busy partition safe are released.
- **What to do:** nothing. Leave `OwnershipByMap` off unless you are trialling the mode. See
  [Ownership by map](../fundamentals/work-coordinator/partition-assignment.md#ownership-by-map).
