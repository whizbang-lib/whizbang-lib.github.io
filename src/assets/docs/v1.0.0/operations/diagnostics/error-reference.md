---
title: "Runtime Error Reference"
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
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
}
services.Configure<AzureBlobOffloadOptions>("azure-blob", opts => {
  opts.ConnectionString = configuration["Storage:ConnectionString"]!;
  opts.ContainerName = "whizbang-bodies";
});
```

---

## Build-time diagnostics (WHIZ###)

Compile-time errors and warnings from Whizbang's source generators and analyzers use `WHIZ###` IDs and surface in build output and the IDE, not at runtime. The IDs with dedicated pages in this section:

| ID | Severity | Page |
|---|---|---|
| WHIZ030 | Error | [Perspective Event Missing StreamId](whiz030.md) |
| WHIZ031 | Error | [Multiple StreamId Attributes](whiz031.md) |
| WHIZ058 | Info | [GUID Call Intercepted](whiz058.md) |
| WHIZ059 | Info | [GUID Interception Suppressed](whiz059.md) |
| WHIZ060–WHIZ063 | Error | [Serializable Property Analyzer](serializable-property-analyzer.md) (WHIZ062 also has [its own page](whiz062.md)) |
| WHIZ070 | Error | [Missing Pgvector.EntityFrameworkCore Package](whiz070.md) |
| WHIZ071 | Error | [Missing Pgvector Package](whiz071.md) — the same ID is also an Info diagnostic ("Polymorphic Base Type Discovered") in `Whizbang.Generators` |
| WHIZ080 | Warning (disabled by default) | [Multiple Handlers for RPC Message](whiz080.md) |
| WHIZ090 | Error | [MessageTag Parameter Naming](whiz090.md) |
| WHIZ120 | Error | [Pinned Type Renamed Without Ledger Acknowledgment](whiz120.md) |
| WHIZ121 | Warning | [Pinned-Type Ledger Entry Has No Living Type](whiz121.md) |
| WHIZ300 | Error | [Inconsistent Perspective Model Types](whiz300.md) |
| WHIZ400 | Error | [Invalid Type Argument for ILensQuery](whiz400.md) — the same ID is also a Warning ("[InheritScope] on a non-perspective type") in `Whizbang.Generators` |
| WHIZ802 | Error | [VectorField Invalid Dimensions](whiz802.md) |
| WHIZ807 | Info | [Physical Fields Discovered](whiz807.md) |

Many more diagnostics ship without dedicated pages — discovery/registration notices (WHIZ001–WHIZ028), StreamId and WhizbangId validation (WHIZ005/WHIZ006/WHIZ009/WHIZ013/WHIZ021/WHIZ024), service registration (WHIZ040–WHIZ042), test linking (WHIZ050–WHIZ054), Guid usage warnings (WHIZ055–WHIZ057), perspective purity and model checks (WHIZ100–WHIZ106, WHIZ200), pinned identity (WHIZ110–WHIZ112), InheritScope usage (WHIZ400/WHIZ401 in `Whizbang.Generators`), EF Core generation (WHIZ401/WHIZ402, WHIZ701–WHIZ703, WHIZ810–WHIZ822), physical/vector fields (WHIZ801–WHIZ807), and receptor safety (WHIZ900). Their build-output messages are self-describing; browse the Diagnostics section index for pages as they are added.

---

## Contributing an entry

When you add a new user-facing error to the library, add it here in the same commit (documentation-first). Each entry needs: the exact message template in a `text` block, the source component, the trigger condition, what the framework does next (retry, DLQ, fallback, no-op), and the remedy.
