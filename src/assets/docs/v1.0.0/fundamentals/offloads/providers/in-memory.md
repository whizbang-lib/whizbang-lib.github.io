---
title: InMemory Body Store
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  Dev/test/fixture provider — bodies live in a process-local
  ConcurrentDictionary; disappears on restart.
tags: 'offload, providers, in-memory, testing'
codeReferences:
  - src/Whizbang.Offloads.InMemory/InMemoryMessageBodyStore.cs
  - src/Whizbang.Offloads.InMemory/InMemoryOffloadServiceCollectionExtensions.cs
---

# InMemory Body Store

`Whizbang.Offloads.InMemory` is the dev/test/fixture provider for body offload. Bodies live in a process-local `ConcurrentDictionary` and disappear on restart. Mirrors the role of `Whizbang.Transports.InMemory` in the transport pattern: fast, deterministic, isolated, lets the rest of the offload pipeline exercise end-to-end without an external blob service.

**Not suitable for production.** Bodies don't cross processes (producer and consumer MUST run in the same OS process); no durability; restart loses everything.

## Registration

```csharp
services.AddWhizbangInMemoryOffload("memory-dev");

services.AddWhizbangBodyOffload();
services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName       = "memory-dev";
  opts.SizeThresholdBytes = 64 * 1024;
});
```

Multiple in-memory providers can coexist under distinct names — useful for tests that exercise multi-provider scenarios without standing up real storage.

## Behavior

- **Upload**: copies the body into the dictionary (caller's memory may be pooled/recycled, so the store owns the bytes), computes SHA-256, returns a `MessageBodyClaim` with `StorageKey = "inmemory://<guid>"`.
- **Download**: returns the bytes for the supplied `claim.StorageKey`. Throws `InvalidOperationException` if not found — typically means a restart between upload and download, or producer/consumer running in different processes.
- **Download with `MessageBodyDownloadOptions.MaxBytes`**: refuses bodies above the cap.
- **Delete**: removes the entry. Default `MessageBodyDeleteOptions.IgnoreMissing = true` makes second deletes silent; strict mode (`IgnoreMissing = false`) throws on missing keys.

## When to use

- Unit and integration tests where you want to exercise the full offload round-trip without spinning up Azurite.
- Local development scenarios where the producer and consumer run in the same process (e.g., `LocalInvokeAsync` paths or sample apps with all services hosted in one process).
- Fixture/data-seeding code that produces a large composite event and immediately consumes it.

For multi-process / multi-service scenarios use [Whizbang.Offloads.AzureBlob](/docs/fundamentals/offloads/providers/azure-blob) with Azurite locally.
