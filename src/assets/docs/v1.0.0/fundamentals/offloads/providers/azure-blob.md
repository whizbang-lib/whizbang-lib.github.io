---
title: Azure Blob Body Store
version: 1.0.0
category: Fundamentals
order: 2
description: >-
  Production body-store provider backed by Azure Blob Storage. Works
  identically against the Azurite emulator and live Azure Blob via
  standard connection-string conventions.
tags: 'offload, providers, azure-blob, azurite, production'
codeReferences:
  - src/Whizbang.Offloads.AzureBlob/AzureBlobMessageBodyStore.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadOptions.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
---

# Azure Blob Body Store

`Whizbang.Offloads.AzureBlob` is the production body-store provider for body offload. Wraps `Azure.Storage.Blobs`. Behaves identically against the Azurite emulator and live Azure Blob — the connection string distinguishes them via standard Azure SDK conventions.

## Registration

```csharp{
title: "Register the Azure Blob body-offload provider"
description: "Wires the Azure Blob store as a named body-offload provider and points MessageBodyOffloadOptions at it so envelopes over the size threshold auto-offload."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "claim-check", "dependency-injection", "configuration"]
}
services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => {
  opts.ConnectionString = builder.Configuration.GetConnectionString("Storage");
  opts.ContainerName    = "whizbang-offload-bodies";
  // Optional: opts.DefaultAccessTier = AccessTier.Cool;
  // Optional: opts.MaxDownloadBytes  = 100 * 1024 * 1024;  // refuse claims > 100 MB
});

services.AddWhizbangBodyOffload();
services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName       = "azure-blob-prod";
  opts.SizeThresholdBytes = 64 * 1024;   // 25% of ASB Standard 256 KB
});
```

Multiple Azure Blob providers can coexist (e.g., `"azure-blob-prod"` + `"azure-blob-archive"`) with different connection strings, containers, or access tiers.

## Emulator (Azurite) vs live

The SDK's connection-string convention does the work:

```csharp{
title: "Switch between Azurite emulator and live Azure Blob"
description: "Shows how the Azure SDK connection-string convention alone selects the Azurite emulator or a live Azure Blob account without any code change."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["azure-blob", "azurite", "connection-string", "body-offload", "emulator"]
}
// Azurite (local dev / CI integration tests)
opts.ConnectionString = "UseDevelopmentStorage=true";

// Live Azure Blob
opts.ConnectionString = "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...";
```

Behavior is identical against either backend — same upload/download/delete semantics, same hash verification, same metadata. The integration test suite (`Whizbang.Offloads.AzureBlob.Integration.Tests`) runs against a real Azurite container via Testcontainers; the same code path runs against live Azure in production.

## Options

| Option | Default | Notes |
|---|---|---|
| `ConnectionString` | (required) | Azure Storage connection string. |
| `ContainerName` | `"whizbang-offload-bodies"` | Lazily created on first upload via `CreateIfNotExistsAsync`. |
| `DefaultAccessTier` | `null` (account default) | `Hot` / `Cool` / `Cold` / `Archive`. Archive bodies are NOT downloadable without rehydration — only set for cold-storage use cases that don't need receive-time rehydrate. |
| `MaxDownloadBytes` | `null` (no cap) | Defensive cap. When non-null and a claim reports a larger body, the provider refuses to download. Protects receivers from tampered claim tickets that would otherwise pull a multi-GB blob. |

## Behavior

- **Upload**: lazily creates the container; computes SHA-256 of the body; uploads via `BlobClient.UploadAsync` with `ContentType` set; stores `whizbang_content_hash` in blob metadata for forensic recovery. Returns a `MessageBodyClaim` with `StorageKey = "yyyy/MM/dd/<guid>.bin"`.
- **Download**: pulls the blob via `BlobClient.DownloadContentAsync`. 404 → `InvalidOperationException` with a TTL-removal-hint message. Honors `MessageBodyDownloadOptions.MaxBytes` and the provider's own `MaxDownloadBytes` cap.
- **Delete**: `BlobClient.DeleteIfExistsAsync` with snapshot inclusion. Default `IgnoreMissing = true` makes double-deletes silent (fan-out safe); strict mode throws on missing blobs.

## Lifecycle / cleanup

Two cleanup paths, both supported:

**TTL (recommended)**: configure a blob lifecycle rule on the storage account, e.g. "delete after 7 days." `DeleteAsync` becomes a backstop; the lifecycle rule does the actual reaping. Simplest in fan-out subscriber topologies where multiple consumers read the same body.

**Active**: set `MessageBodyOffloadOptions.ActiveCleanup = true`. The consumer worker fires `IMessageBodyStore.DeleteAsync(claim)` after the inbox row commits, in a fresh DI scope, fire-and-forget. Failed inbox INSERT never deletes a body still needed for redelivery. Provider's `IgnoreMissing` absorbs fan-out double-delete races. The TTL rule is still the backstop on transient delete failures.

## Production deployment recipe

```csharp{
title: "Production Azure Blob body-offload deployment recipe"
description: "A hardened production wire-up with a required connection string, a defensive MaxDownloadBytes cap, and TTL-based cleanup instead of active deletion."
framework: "NET10"
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "azure-blob", "production", "claim-check", "cleanup", "max-download-bytes"]
}
services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => {
  opts.ConnectionString = builder.Configuration.GetConnectionString("Storage")
      ?? throw new InvalidOperationException("Storage connection string is required");
  opts.ContainerName     = "whizbang-offload-bodies";
  opts.MaxDownloadBytes  = 100 * 1024 * 1024;   // defensive cap
});

services.AddWhizbangBodyOffload();
services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName       = "azure-blob-prod";
  opts.SizeThresholdBytes = 64 * 1024;
  opts.ActiveCleanup      = false;   // rely on blob lifecycle rule
});
```

Configure a blob lifecycle policy in Azure Storage for the `whizbang-offload-bodies` container — typical: delete blobs older than 7 days. That's the production cleanup path.

## Integration tests

The provider's integration test suite (`tests/Whizbang.Offloads.AzureBlob.Integration.Tests/`) uses `Testcontainers.Azurite` to spin up a real Azurite container per test class. Four round-trip tests cover the upload/download/delete contract, hash verification, MaxBytes cap behavior, and idempotent delete semantics. The same code paths run against live Azure in production deployments.
