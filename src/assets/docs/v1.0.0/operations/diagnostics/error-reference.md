---
title: "Runtime Error Reference"
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
description: >-
  Alphabetical catalog of Whizbang runtime error messages — what triggers each
  one, what the framework does next, and how to fix it. Every entry has a
  stable heading anchor for deep-linking from incident notes and runbooks.
order: 1
tags: 'errors, error-reference, troubleshooting, runtime, logs, dead-letter-queue, transport, perspectives, rebuild, serialization'
codeReferences:
  - src/Whizbang.Core/ReceptorNotFoundException.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/TransportPublishStrategy.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Transports/JsonMessageSerializer.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Data.EFCore.Postgres/RebuildPerspectiveCommandReceptor.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobMessageBodyStore.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Dispatcher/DispatcherTests.cs
  - tests/Whizbang.Offloads.AzureBlob.Tests/AzureBlobMessageBodyStoreValidationTests.cs
---

# Runtime Error Reference

This page catalogs the **runtime** error messages Whizbang emits — in exceptions, log entries, and publish-result records — with the trigger condition, what the framework does next, and the remedy. Every error has its own heading, so you can deep-link directly to an entry (each heading gets a stable anchor with a copy-link icon).

Looking for **build-time** errors instead? Compile-time diagnostics (`WHIZ###`) have their own pages in this section — see [Build-time diagnostics](#build-time-diagnostics-whiz) at the bottom. For guided debugging workflows, see the [Troubleshooting Guide](../deployment/troubleshooting.md).

---

## Transport & Publishing

### exceeds maximum batch message size

```text
Message {MessageId} exceeds maximum batch message size
```

**Source**: `AzureServiceBusTransport.PublishBatchAsync`

**Trigger**: While filling a `ServiceBusMessageBatch`, a message failed `TryAddMessage` on a full batch, the batch was flushed, and the message failed again on a **fresh empty batch**. That means the single serialized message *by itself* exceeds the Azure Service Bus per-message size limit — 256 KB on Standard tier, 1 MB by default on Premium (raisable per entity via `MaxMessageSizeInKilobytes`). The limit includes system properties and Whizbang's envelope wrapper, so the effective payload budget is smaller than the raw tier number.

**What happens next**: The item is recorded as a failed `BulkPublishItemResult`; the outbox routes it to the failure channel and retries it on subsequent drain passes. On versions with dead-lettering (`MaxOutboxAttempts` configured, v0.645+), it is promoted to `wh_dead_letters` once the attempt cap is reached. On earlier versions it retries indefinitely — a poison outbox row.

**Fix**:
- Shrink the event payload — don't embed large blobs or documents in events. Use the claim-check pattern via body offload (see below).
- Or move to a Premium namespace and raise the entity's max message size.

```csharp{
title: "Enable body offload so oversized payloads claim-check to blob storage"
description: "Registers the Azure Blob body-offload provider and selects it as the active provider, so envelopes above the transport ceiling are stored in blob storage and replaced with a claim reference."
framework: "NET10"
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "claim-check", "azure-blob", "message-size"]
unverified: "illustrative DI registration — not exercised by a mapped test"
}
services.AddWhizbangBodyOffload();
services.AddWhizbangAzureBlobOffload("azure-blob");
services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName = "azure-blob";
});
```

### Serialized envelope is N bytes; transport ceiling is M bytes

```text
Serialized envelope is {N} bytes; transport ceiling is {M} bytes. Register a
body-offload provider (services.AddWhizbangBodyOffload() + AddWhizbang*Offload(name)
+ Configure<MessageBodyOffloadOptions>(opts => opts.ProviderName = name)), raise
the transport tier, or trim the payload.
```

**Source**: `TransportPublishStrategy`

**Trigger**: Whizbang's own pre-flight size gate — the serialized envelope exceeds the configured transport ceiling *before* the message is handed to the broker. This is the framework-level guard that fires ahead of the broker's own rejection.

**What happens next**: The message is marked failed and routed to the failure channel (same retry/DLQ semantics as above).

**Fix**: Exactly as the message says — register a body-offload provider, raise the transport tier, or trim the payload. The offload registration snippet above applies here too.

### Broker throttle on publish

```text
Broker throttle on publish ({Transport}) — message {MessageId} attempt
{Attempt}/{MaxAttempts}; sleeping {DelayMs}ms before retry
```

**Source**: `TransportPublishStrategy` (also emitted in a batch variant)

**Trigger**: The broker reported throttling (rate/quota exceeded). This is a **warning**, not a failure — Whizbang retries automatically with backoff.

**What happens next**: Retries up to the attempt budget. If it recovers, no action needed.

**Fix if frequent**: Reduce publish concurrency, spread bursts, or raise the broker tier/quota.

### Broker throttle budget exhausted

```text
Broker throttle budget exhausted ({Transport}) after {Attempts} attempts for
message {MessageId} — returning Throttled to failure channel
```

**Source**: `TransportPublishStrategy`

**Trigger**: Every retry in the throttle budget was itself throttled.

**What happens next**: The message returns to the failure channel with reason `Throttled` and will be retried on a later drain pass — it is not lost.

**Fix**: This signals sustained broker saturation, not a transient blip. Check broker metrics; raise the tier, lower `PublishMaxConcurrency`, or reduce throughput.

---

## Dispatch & Receptors

### No receptor found for message type

```text
No receptor found for message type '{Type.FullName}'.
```

**Source**: `ReceptorNotFoundException` (thrown by the generated dispatcher)

**Trigger**: A message was dispatched but no `IReceptor<TMessage, TResponse>` implementation exists in the compilation for that type. The full exception text includes a fix-it example.

**Fix**: Create a receptor implementing `IReceptor<TMessage, TResponse>` in a project that references `Whizbang.Generators` — it is auto-discovered at compile time; no attribute or manual registration needed. If the receptor exists but isn't found, confirm its project is referenced by the host and check the build output for the `WHIZ002` diagnostic.

### No IWorkCoordinatorStrategy registered

```text
No IWorkCoordinatorStrategy registered. Cannot route messages to outbox.
```

**Source**: `Dispatcher`

**Trigger**: A dispatch path needed to route messages through the outbox, but the work-coordinator infrastructure isn't wired into DI.

**Fix**: Register the work coordinator during startup (part of the standard `AddWhizbang*` data-driver setup). If you see this in a test host, the fixture is missing the driver registration.

### IClaimedEmissionStore is not registered

```text
IClaimedEmissionStore is not registered. Call AddWhizbangClaimedEmissionStore()
(Postgres driver) or register an implementation before using PublishOnceAsync.
```

**Source**: `Dispatcher.PublishOnceAsync`

**Trigger**: `PublishOnceAsync` (exactly-once claimed emission) was called without the claim store registered.

**Fix**: Exactly as stated — `AddWhizbangClaimedEmissionStore()` with the Postgres driver, or register a custom `IClaimedEmissionStore`.

---

## Perspectives & Rebuild

### No runner found for perspective

```text
No runner found for perspective '{name}'. Registered: {list}
```

**Source**: `PerspectiveRebuilder`

**Trigger**: A rebuild was requested for a perspective name that isn't in this service's runner registry. Perspective names must be the **full CLR type name** of the projection class (e.g. `MyApp.Projections.OrderPerspective`) — short names and typos don't match.

**What happens next**: The rebuild returns a failed `RebuildResult` with this text; nothing is modified.

**Fix**: Copy an exact name from the `Registered:` list in the message.

### Perspectives skipped (not locally owned by this service)

```text
Perspectives skipped (not locally owned by this service): [{Skipped}].
Locally registered: [{Registered}]
```

**Source**: `RebuildPerspectiveCommandReceptor`

**Trigger**: `RebuildPerspectiveCommand` is a system command that broadcasts to **every** service; each service intersects the requested names with its own registry and rebuilds only what it hosts. Services that don't own a requested perspective log this and skip it.

**Fix**: Usually nothing — this is expected fan-out behavior. It's only a problem if *every* service skipped a name (check for a matching "nothing to rebuild" entry, below), which means the name matched no registry anywhere — likely a typo or a short name instead of the full CLR type name.

### RebuildPerspectiveCommand has nothing to rebuild on this service

```text
RebuildPerspectiveCommand has nothing to rebuild on this service (fanout={FanOut}).
Locally registered perspectives: [{Registered}]
```

**Source**: `RebuildPerspectiveCommandReceptor`

**Trigger**: After intersecting the requested names with the local registry, nothing remained. With `fanout=True` (no names requested) this means the service hosts no perspectives at all; with explicit names it means none of them are hosted here.

**Fix**: Expected on services that don't own the target perspective. If the perspective's home service also logs this, fix the requested name.

### FromEventId is set but ignored

```text
RebuildPerspectiveCommand.FromEventId={FromEventId} is set but IPerspectiveRebuilder
has no partial-range replay API; the value is ignored and the rebuild replays from
event zero.
```

**Source**: `RebuildPerspectiveCommandReceptor`

**Trigger**: The command contract exposes `FromEventId`, but partial-range replay is not implemented. The rebuild always replays the full event history.

**Fix**: Drop `FromEventId` from the request; for targeted repair use `IncludeStreamIds` (per-stream replay) instead.

### Rebuild failed on stream

```text
Rebuild {Perspective}: failed on stream {StreamId} ({Processed}/{Total})
```

**Source**: `PerspectiveRebuilder`

**Trigger**: Replaying one stream threw an exception during a rebuild. The exception details are attached to this log entry.

**What happens next**: **The exception is swallowed per stream so one bad stream doesn't kill the whole rebuild** — the rebuild continues and can still report success. Count these entries after any rebuild: N occurrences means N streams whose rows are missing or stale.

**Fix**: Read the attached exception to find the root cause (deserialization, upcaster, or store failure), fix it, then re-run the rebuild — or re-run just the failed streams with `IncludeStreamIds`.

### No IPerspectiveRunner found for perspective

```text
No IPerspectiveRunner found for perspective '{PerspectiveName}' (stream: {StreamId}).
See startup log for registered perspectives.
```

**Source**: `PerspectiveWorker` (live event processing, not rebuild)

**Trigger**: Claimed perspective work references a perspective that has no generated runner in this service — typically after a perspective was renamed/removed while `wh_perspective_events` still holds rows for the old name, or when generated registrations are stale.

**Fix**: Rebuild the service so the source generators regenerate `PerspectiveRunnerRegistry`; verify the perspective class still exists under the recorded name. Stale rows for permanently removed perspectives can be cleaned from `wh_perspective_events`.

### Perspective sync timed out

**Source**: `PerspectiveSyncTimeoutException`

**Trigger**: A receptor marked `[AwaitPerspectiveSync]` (with `ThrowOnTimeout = true`) waited longer than the configured timeout for a perspective to catch up to an event.

**Fix**: Check whether the perspective worker is healthy and draining (look for claim/lease warnings); increase the sync timeout if the perspective is merely slow; or drop `ThrowOnTimeout` where eventual consistency is acceptable.

---

## Serialization

### No JsonTypeInfo found for type

```text
No JsonTypeInfo found for {Type}. Ensure the message type is registered in
WhizbangJsonContext.
```

**Source**: `JsonMessageSerializer`

**Trigger**: Whizbang is AOT-first — all serialization goes through source-generated `JsonSerializerContext`s, with no reflection fallback. This type wasn't found in any registered context.

**Fix**: Message types are auto-registered when they're visible to `Whizbang.Generators` at compile time (check the `WHIZ011` diagnostic). If the type lives in another assembly, that assembly must ship and register its own context — see the cross-assembly `JsonContextRegistry`. Rebuild after adding new message types; stale generated output is the most common cause in local dev.

---

## Body Offload (claim-check)

### Body not found at storage key

```text
Body not found at '{StorageKey}' in container '{ContainerName}'. TTL may have
removed it before the receiver downloaded.
```

**Source**: `AzureBlobMessageBodyStore`

**Trigger**: A receiver tried to download an offloaded message body but the blob is gone — most commonly the container's TTL/lifecycle policy deleted it before the consumer got to the message (e.g., a long outage backlog).

**What happens next**: Wrapped in `BodyClaimDownloadException` (transient) so the transport retries — but if the blob is truly gone, retries can't succeed and the message will eventually dead-letter.

**Fix**: Size the blob TTL to comfortably exceed your worst-case consumer lag (including outage recovery time). For already-lost bodies, the message must be re-published from the source.

### Claim size exceeds MaxBytes cap

```text
Claim '{StorageKey}' size {Size} exceeds MaxBytes cap {Max}; refusing download.
```

**Source**: `AzureBlobMessageBodyStore`

**Trigger**: The stored body is larger than the configured download cap — a safety guard against unbounded memory use on receivers.

**Fix**: Raise the provider's max-download setting if the size is legitimate; otherwise investigate why the payload grew beyond expectations.

### Offload provider configuration is missing

```text
AzureBlobOffloadOptions.ConnectionString is required for provider '{name}' ...
AzureBlobOffloadOptions.ContainerName is required for provider '{name}'.
```

**Source**: `AzureBlobMessageBodyStore` constructor

**Trigger**: The named offload provider was registered but its options weren't configured.

**Fix**: Configure the named options instance:

```csharp{
title: "Configure the named Azure Blob offload provider options"
description: "Supplies the connection string and container for a named offload provider registration — both are required at construction time."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "named-options"]
unverified: "config/registration — not exercised by a mapped test"
}
services.Configure<AzureBlobOffloadOptions>("azure-blob", opts => {
  opts.ConnectionString = configuration["Storage:ConnectionString"]!;
  opts.ContainerName = "whizbang-bodies";
});
```

---

## Build-time diagnostics (WHIZ###)

Compile-time errors, warnings and notices from Whizbang's source generators and analyzers use `WHIZ###` IDs and surface in build output and the IDE, not at runtime. Every ID has its own page; each ID means one thing. WHIZ060 to WHIZ063 are also covered together on the [Serializable Property Analyzer](serializable-property-analyzer.md) page. Ten IDs are **retired** (WHIZ003, WHIZ005, WHIZ020, WHIZ023, WHIZ042, WHIZ050, WHIZ051, WHIZ052, WHIZ057 and WHIZ803): they were declared but never reported, are no longer in the generator package, and are never reused. Their pages explain what each described; delete any suppression of them.

| ID | Severity | Page |
|---|---|---|
| WHIZ001 | Info | [Receptor Discovered](whiz001.md) |
| WHIZ002 | Info | [No Message Handlers Found](whiz002.md) |
| WHIZ003 | Retired | [Invalid Receptor Implementation](whiz003.md) (retired: never reported, ID never reused) |
| WHIZ004 | Info | [Command Stream ID Discovered](whiz004.md) |
| WHIZ005 | Retired | [Stream ID Must Be Guid](whiz005.md) (retired: never reported, ID never reused) |
| WHIZ006 | Warning | [Multiple Stream ID Attributes](whiz006.md) |
| WHIZ007 | Info | [Perspective Discovered](whiz007.md) |
| WHIZ008 | Warning | [Perspective Model Size Warning](whiz008.md) |
| WHIZ009 | Warning | [Missing StreamId Attribute](whiz009.md) |
| WHIZ010 | Info | [StreamId Discovered](whiz010.md) |
| WHIZ011 | Info | [JSON Serializable Type Discovered](whiz011.md) |
| WHIZ012 | Info | [Perspective Invoker Routing Generated](whiz012.md) |
| WHIZ013 | Error | [GenerateStreamId requires a settable StreamId](whiz013.md) |
| WHIZ014 | Warning | [Receptor May Not Be Constructible by Dependency Injection](whiz014.md) |
| WHIZ015 | Warning | [Generic Message Types Are Not Supported](whiz015.md) |
| WHIZ020 | Retired | [WhizbangId Discovered](whiz020.md) (retired: never reported, ID never reused) |
| WHIZ021 | Warning | [WhizbangId Must Be Partial](whiz021.md) |
| WHIZ022 | Info | [Topic Filter Discovered](whiz022.md) |
| WHIZ023 | Retired | [Enum Filter No Description](whiz023.md) (retired: never reported, ID never reused) |
| WHIZ024 | Warning | [Duplicate WhizbangId Type Name](whiz024.md) |
| WHIZ025 | Warning | [TopicFilter On Non-Command](whiz025.md) |
| WHIZ026 | Info | [No Topic Filters Found](whiz026.md) |
| WHIZ027 | Info | [Perspective Runner Generated](whiz027.md) |
| WHIZ028 | Info | [Perspective Runner Registry Generated](whiz028.md) |
| WHIZ030 | Error | [Perspective Event Missing StreamId](whiz030.md) |
| WHIZ031 | Error | [Multiple StreamId Attributes](whiz031.md) |
| WHIZ032 | Error | [Perspective Name Collision](whiz032.md) |
| WHIZ033 | Warning | [Perspective Model Missing StreamId](whiz033.md) |
| WHIZ040 | Info | [User Service Discovered](whiz040.md) |
| WHIZ041 | Info | [Abstract Class Skipped](whiz041.md) |
| WHIZ042 | Retired | [No User Services Found](whiz042.md) (retired: never reported, ID never reused) |
| WHIZ050 | Retired | [Public API Missing Tests](whiz050.md) (retired: never reported, ID never reused) |
| WHIZ051 | Retired | [Invalid Test Reference](whiz051.md) (retired: never reported, ID never reused) |
| WHIZ052 | Retired | [Test Link Discovered](whiz052.md) (retired: never reported, ID never reused) |
| WHIZ053 | Info | [Failed to Load Documentation Map](whiz053.md) |
| WHIZ054 | Info | [Failed to Load Tests Map](whiz054.md) |
| WHIZ055 | Warning | [Guid.NewGuid() Usage](whiz055.md) |
| WHIZ056 | Warning | [Guid.CreateVersion7() Usage](whiz056.md) |
| WHIZ057 | Retired | [Raw Guid Parameter](whiz057.md) (retired: never reported, ID never reused) |
| WHIZ058 | Info | [GUID Call Intercepted](whiz058.md) |
| WHIZ059 | Info | [GUID Interception Suppressed](whiz059.md) |
| WHIZ060 | Error | [Property uses non-serializable type 'object'](whiz060.md) |
| WHIZ061 | Error | [Property uses non-serializable type 'dynamic'](whiz061.md) |
| WHIZ062 | Error | [Property Uses Non-Serializable Interface Type](whiz062.md) |
| WHIZ063 | Error | [Nested type contains non-serializable property](whiz063.md) |
| WHIZ070 | Error | [Missing Pgvector.EntityFrameworkCore Package](whiz070.md) |
| WHIZ071 | Error | [Missing Pgvector Package](whiz071.md) |
| WHIZ072 | Info | [Polymorphic Base Type Discovered](whiz072.md) |
| WHIZ080 | Warning | [Multiple Handlers for RPC Message](whiz080.md) |
| WHIZ090 | Error | [MessageTag Parameter Naming](whiz090.md) |
| WHIZ099 | Info | [MessageJsonContextGenerator Running](whiz099.md) |
| WHIZ100 | Error | [Apply method must be synchronous](whiz100.md) |
| WHIZ101 | Error | [Apply method cannot use async/await](whiz101.md) |
| WHIZ102 | Error | [Apply method cannot call database I/O](whiz102.md) |
| WHIZ103 | Error | [Apply method cannot call HTTP/network operations](whiz103.md) |
| WHIZ104 | Warning | [Apply method should use event timestamps instead of reading the clock](whiz104.md) |
| WHIZ105 | Warning | [Perspective injects non-pure service](whiz105.md) |
| WHIZ106 | Error | [Collective apply must not query other perspectives at apply time](whiz106.md) |
| WHIZ110 | Warning | [Message Missing [PinnedId]](whiz110.md) |
| WHIZ111 | Warning | [Perspective Missing [PinnedId]](whiz111.md) |
| WHIZ112 | Error | [Invalid [PinnedId] GUID](whiz112.md) |
| WHIZ120 | Error | [Pinned Type Renamed Without Ledger Acknowledgment](whiz120.md) |
| WHIZ121 | Warning | [Pinned-Type Ledger Entry Has No Living Type](whiz121.md) |
| WHIZ122 | Warning | [Pinned-Type Ledger Could Not Be Parsed](whiz122.md) |
| WHIZ130 | Warning | [Perspective mixes ephemeral and Sourced Apply methods](whiz130.md) |
| WHIZ131 | Error | [Rebuild or rewind of an ephemeral-only perspective](whiz131.md) |
| WHIZ132 | Warning | [Receptor turns an ephemeral message into a Sourced event](whiz132.md) |
| WHIZ133 | Error (runtime) | [Stream mixes ephemeral and Sourced events](whiz133.md) |
| WHIZ134 | Error | [Ambiguous ephemeral composition](whiz134.md) |
| WHIZ140 | Warning | [Perspective shares stream event types with a group but joins none](whiz140.md) |
| WHIZ141 | Warning | [Stream group has no announcing member with a row evictor](whiz141.md) |
| WHIZ142 | Warning | [Bridge on a sole stream-group membership](whiz142.md) |
| WHIZ150 | Warning | [Minted composite constructed outside the mint](whiz150.md) |
| WHIZ151 | Error | [Command type has more than one inbox receptor](whiz151.md) |
| WHIZ160 | Warning | [Type Name Composed By Hand](whiz160.md) |
| WHIZ161 | Warning | [Type Name Dissected By Hand](whiz161.md) |
| WHIZ162 | Warning | [Type Names Compared Without The Matching Helper](whiz162.md) |
| WHIZ163 | Warning | [Type-Name Key Assigned From A Hand-Built String](whiz163.md) |
| WHIZ170 | Warning | [[InheritScope] on a Perspective Class Has No Effect](whiz170.md) |
| WHIZ171 | Info | [[InheritScope] With All-None Flags Gives Rows No Scope](whiz171.md) |
| WHIZ200 | Warning | [Perspective model should use List<T> instead of array](whiz200.md) |
| WHIZ300 | Error | [Inconsistent Perspective Model Types](whiz300.md) |
| WHIZ302 | Warning | [Filtered Perspective Field Has No Index](whiz302.md) |
| WHIZ303 | Warning | [Declared Index Cannot Be Built For This Field''s Type](whiz303.md) |
| WHIZ304 | Warning | [Declared Index Cannot Be Reached For This Model''s Storage](whiz304.md) |
| WHIZ305 | Warning | [Declared Index Capability Does Not Apply To This Field''s Type](whiz305.md) |
| WHIZ306 | Warning | [Fields reachable by request-time sorting have no index](whiz306.md) |
| WHIZ307 | Warning | [Whole-document match has no index](whiz307.md) |
| WHIZ308 | Warning | [Whole-document match has no index by default](whiz308.md) |
| WHIZ309 | Warning | [Collective predicate filters an unindexed field](whiz309.md) |
| WHIZ400 | Error | [Invalid Type Argument for ILensQuery](whiz400.md) |
| WHIZ401 | Warning | [Multi-Model ILensQuery References Unknown Perspective Model](whiz401.md) |
| WHIZ402 | Info | [Multi-Model ILensQuery Auto-Detected](whiz402.md) |
| WHIZ500 | Warning | [Hand-Constructed Service Omits a Dependency](whiz500.md) |
| WHIZ501 | Info | [Optional Injected Dependency](whiz501.md) |
| WHIZ701 | Info | [EF Core Perspective Discovery](whiz701.md) |
| WHIZ702 | Info | [EF Core Migration Files Discovery](whiz702.md) |
| WHIZ703 | Info | [No DbContext Found](whiz703.md) |
| WHIZ801 | Error | [VectorField Invalid Type](whiz801.md) |
| WHIZ802 | Error | [VectorField Invalid Dimensions](whiz802.md) |
| WHIZ803 | Retired | [PhysicalField Complex Type](whiz803.md) (retired: never reported, ID never reused) |
| WHIZ804 | Error | [Table Storage Value Out Of Range](whiz804.md) |
| WHIZ805 | Warning | [Split Mode No Physical Fields](whiz805.md) |
| WHIZ807 | Info | [Physical Fields Discovered](whiz807.md) |
| WHIZ808 | Error | [Split Class Model Cannot Be Copied](whiz808.md) |
| WHIZ810 | Warning | [Perspective Model Contains Dictionary Property](whiz810.md) |
| WHIZ811 | Info | [Perspective Model Contains Polymorphic Type](whiz811.md) |
| WHIZ812 | Warning | [Perspective Model Declares a JSON Converter That Is Never Consulted](whiz812.md) |
| WHIZ820 | Error | [Table Name Exceeds Database Limit](whiz820.md) |
| WHIZ821 | Error | [Column Name Exceeds Database Limit](whiz821.md) |
| WHIZ822 | Error | [Index Name Exceeds Database Limit](whiz822.md) |
| WHIZ823 | Error | [Perspective Table Name Exceeds the Database Limit](whiz823.md) |
| WHIZ824 | Error | [Invalid Perspective Table Name](whiz824.md) |
| WHIZ825 | Error | [Two Perspective Models Share One Table Name](whiz825.md) |
| WHIZ830 | Error | [Stored-Form Migration Cannot Be Generated](whiz830.md) |
| WHIZ831 | Warning | [Stored-Form Migration Never Runs](whiz831.md) |
| WHIZ832 | Warning | [Stored-Form Declaration Inside a Collection Element](whiz832.md) |
| WHIZ833 | Warning | [Stored-Form Migrations Share an Order](whiz833.md) |
| WHIZ900 | Error | [Perspective Sync in Inline Receptor](whiz900.md) |

---

## Contributing an entry

When you add a new user-facing error to the library, add it here in the same commit (documentation-first). Each entry needs: the exact message template in a `text` block, the source component, the trigger condition, what the framework does next (retry, DLQ, fallback, no-op), and the remedy.

A new build diagnostic gets an unused `WHIZ###` ID (the "Test · Pipeline scripts" job fails when one ID has two meanings), its own `whizNNN` page in this section, and a row in the table above, in the docs pull request that accompanies the library change.
