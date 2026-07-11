---
title: Azure Blob Body Store
version: 1.0.0
category: Fundamentals
order: 2
description: >-
  Production body-store provider backed by Azure Blob Storage. Works
  identically against the Azurite emulator and live Azure Blob via
  standard connection-string conventions. Wire it in one config-driven
  call or register providers by hand.
tags: 'offload, providers, azure-blob, azurite, production, configuration'
codeReferences:
  - src/Whizbang.Offloads.AzureBlob/AzureBlobMessageBodyStore.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadOptions.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Offloads/MessageBodyOffloadOptions.cs
  - src/Whizbang.Core/Offloads/OffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Offloads/BodyClaimRehydrator.cs
testReferences:
  - tests/Whizbang.Offloads.AzureBlob.Tests/AzureBlobOffloadFromConfigurationTests.cs
  - tests/Whizbang.Offloads.AzureBlob.Tests/AzureBlobOffloadDIRegistrationTests.cs
---

# Azure Blob Body Store

`Whizbang.Offloads.AzureBlob` is the production body-store provider for [body offload](/docs/fundamentals/offloads/message-body-store). Wraps `Azure.Storage.Blobs`. Behaves identically against the Azurite emulator and live Azure Blob — the connection string distinguishes them via standard Azure SDK conventions.

There are two ways to wire it: the **config-driven** one-call convention (recommended — the same code ships to every environment and a deployment turns offload on by supplying config), and **manual** DI for a single provider or non-config scenarios.

## Config-driven registration (recommended)

One call wires everything from configuration. Put it next to your other Whizbang registrations — it is a plain `IServiceCollection` extension, independent of the `AddWhizbang(...)` chain:

```csharp{
title: "One-call config-driven body-offload wire-up"
description: "Scans every configured Azure Blob provider, enables the send-side claim-check hook, and binds the offload selector from configuration — a no-op until the environment supplies keys."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "claim-check", "dependency-injection"]
}
using Whizbang.Offloads.AzureBlob;

services.AddWhizbangAzureBlobOffloadsFromConfiguration(configuration);
```

`AddWhizbangAzureBlobOffloadsFromConfiguration` scans every provider subsection under `Whizbang:Offloads:AzureBlob:<name>`, registers a blob store for each, enables the send-side hook (`AddWhizbangBodyOffload()`), and binds the selector (`MessageBodyOffloadOptions`) from `Whizbang:BodyOffload`. The provider whose name matches `Whizbang:BodyOffload:ProviderName` becomes the active offload target.

With **no providers configured it is a no-op** — no store, no hook chain, publish stays inline. So the same code is safe in every environment, and a deployment turns offload on simply by providing the config keys. Offload is opt-in by config presence, with nothing to wire per-service.

> The provider name (e.g. `jdx-offload`) is arbitrary; it just ties the provider registration to the selector. `Whizbang:BodyOffload:ProviderName` is what actually **turns offload on** on the send side — without it the hook is registered but selects no target (inline publish), while the receive side can still rehydrate claims because the store is registered.

### Configuration

`appsettings.json` form:

```json{
title: "Config-driven Azure Blob offload appsettings"
description: "The appsettings.json shape the convention reads — one provider subsection under Whizbang:Offloads:AzureBlob plus the Whizbang:BodyOffload selector that turns offload on."
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "appsettings", "claim-check"]
}
{
  "Whizbang": {
    "Offloads": {
      "AzureBlob": {
        "jdx-offload": {
          "ConnectionString": "DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;EndpointSuffix=core.windows.net",
          "ContainerName": "whizbang-offload-bodies",
          "DefaultAccessTier": "Cool",
          "MaxDownloadBytes": 104857600
        }
      }
    },
    "BodyOffload": {
      "ProviderName": "jdx-offload",
      "SizeThresholdBytes": 65536,
      "ActiveCleanup": false
    }
  }
}
```

Env-var form (what you paste into Helm / Kubernetes — `:` becomes `__`):

```bash{
title: "Config-driven Azure Blob offload as environment variables"
description: "The same offload configuration expressed as double-underscore environment variables for Helm / Kubernetes, where ':' becomes '__'."
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "environment-variables", "kubernetes"]
}
Whizbang__Offloads__AzureBlob__jdx-offload__ConnectionString="…"
Whizbang__Offloads__AzureBlob__jdx-offload__ContainerName="whizbang-offload-bodies"
Whizbang__Offloads__AzureBlob__jdx-offload__DefaultAccessTier="Cool"
Whizbang__Offloads__AzureBlob__jdx-offload__MaxDownloadBytes="104857600"
Whizbang__BodyOffload__ProviderName="jdx-offload"      # MUST match a provider name above
Whizbang__BodyOffload__SizeThresholdBytes="65536"
Whizbang__BodyOffload__ActiveCleanup="false"
```

The convention binds each option explicitly (not `configuration.Bind`) so the Azure SDK extensible-enum `DefaultAccessTier` can be constructed from its string form (e.g. `"Cool"`) — a conversion `ConfigurationBinder` cannot do. Blank strings and unparseable numeric/boolean values are ignored rather than bound, so a half-configured environment keeps the compiled option defaults and fails at the required-`ConnectionString` check rather than silently applying garbage.

Multiple providers coexist: name more than one subsection under `Whizbang:Offloads:AzureBlob` (e.g. `azure-blob-prod` + `azure-blob-archive`) and every one is registered; `Whizbang:BodyOffload:ProviderName` picks the active send-side target. A malformed sibling key (e.g. whitespace-only) is skipped without disabling the well-formed providers alongside it.

## Manual registration

For a single provider or non-config scenarios, the building blocks the convention method composes are public:

```csharp{
title: "Register the Azure Blob body-offload provider by hand"
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

services.AddWhizbangBodyOffload();   // registers the claim-check post-serialize hook
services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName       = "azure-blob-prod";
  opts.SizeThresholdBytes = 64 * 1024;   // 25% of ASB Standard 256 KB
});
```

`AddWhizbangAzureBlobOffload(name, opts)` registers the store, `AddWhizbangBodyOffload()` registers the claim-check post-serialize hook, and the selector points the hook at the named provider. Multiple Azure Blob providers can coexist (e.g., `"azure-blob-prod"` + `"azure-blob-archive"`) with different connection strings, containers, or access tiers.

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

**Provider — `AzureBlobOffloadOptions`** (`Whizbang:Offloads:AzureBlob:<name>`):

| Option | Default | Notes |
|---|---|---|
| `ConnectionString` | `null` (required) | Azure Storage connection string. Account key / SAS / `UseDevelopmentStorage=true` (Azurite). The store throws `InvalidOperationException` on first resolution if unset. |
| `ContainerName` | `"whizbang-offload-bodies"` | Lazily created on first upload via `CreateIfNotExistsAsync`. Give each slot its own container when slots share an account. |
| `DefaultAccessTier` | `null` (account default) | `Hot` / `Cool` / `Cold` / `Archive`. Archive bodies are NOT downloadable without an out-of-band rehydration — only set for cold-storage use cases that don't need receive-time rehydrate. |
| `MaxDownloadBytes` | `null` (no cap) | Defensive cap. When non-null and a claim reports a larger body, the provider refuses to download. Protects receivers from tampered claim tickets that would otherwise pull a multi-GB blob. |

**Selector — `MessageBodyOffloadOptions`** (`Whizbang:BodyOffload`):

| Key | Default | Notes |
|---|---|---|
| `ProviderName` | `null` | The active send-side provider. `null` ⇒ offload disabled (publish inline). |
| `SizeThresholdBytes` | `65536` (64 KB) | Bodies at/above this offload. Set below the transport ceiling to leave envelope headroom. |
| `ActiveCleanup` | `false` | `false` ⇒ rely on a blob lifecycle rule to delete old bodies (recommended). `true` ⇒ the PostInbox lifecycle hook deletes the body after the inbox row is acked. |
| `DownloadTimeout` | `100s` (`TimeSpan.FromSeconds(100)`) | Bounds a single receive-side body-store download during rehydration; exceeding it aborts and surfaces a **retryable** failure (the transport redelivers) rather than stalling the consumer on a hung blob call. **Code-only** — set it in code via `services.Configure<MessageBodyOffloadOptions>`; the config-driven convention does **not** bind it from `Whizbang:BodyOffload`. |

## Behavior

- **Upload**: lazily creates the container; computes SHA-256 of the body; uploads via `BlobClient.UploadAsync` with `ContentType` set; stores `whizbang_content_hash` in blob metadata for forensic recovery. Returns a `MessageBodyClaim` (provider name, storage key, size, content hash) with `StorageKey = "yyyy/MM/dd/<guid>.bin"`.
- **Download**: pulls the blob via `BlobClient.DownloadContentAsync`. 404 → `InvalidOperationException` with a TTL-removal hint. Honors `MessageBodyDownloadOptions.MaxBytes` (per-call, takes precedence) and the provider's own `MaxDownloadBytes` cap; a claim reporting a larger body is refused before download.
- **Delete**: `BlobClient.DeleteIfExistsAsync` with snapshot inclusion. Default `IgnoreMissing = true` makes double-deletes silent (fan-out safe); strict mode throws on missing blobs.

> At the rehydrator level (shared by every provider), a download failure — a transient store/network error, this store's 404 `InvalidOperationException`, or a breach of the receive-side `DownloadTimeout` — is wrapped in `BodyClaimDownloadException` and **retried via transport redelivery**, not dead-lettered. Only after the transport's max-delivery count is exhausted does the message hit the DLQ. Terminal failures (content-hash mismatch, unknown provider, deserialization error) dead-letter immediately. See [Body Offload (Claim-Check Pattern)](/docs/fundamentals/offloads/message-body-store) for the full failure-semantics table.

## Lifecycle / cleanup

Two cleanup paths, both supported:

**TTL (recommended)**: configure a blob lifecycle rule on the storage account, e.g. "delete after 7 days." `DeleteAsync` becomes a backstop; the lifecycle rule does the actual reaping. Simplest in fan-out subscriber topologies where multiple consumers read the same body.

**Active**: set `MessageBodyOffloadOptions.ActiveCleanup = true`. The consumer worker fires `IMessageBodyStore.DeleteAsync(claim)` after the inbox row commits, in a fresh DI scope, fire-and-forget. A failed inbox INSERT never deletes a body still needed for redelivery. The provider's `IgnoreMissing` absorbs fan-out double-delete races. The TTL rule is still the backstop on transient delete failures.

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

> The receive side must register the **same provider name** so the rehydrator can find the store. The config-driven call on every service satisfies this uniformly — every deployment slot supplies the same `Whizbang:Offloads:AzureBlob:<name>` keys and binds through it with zero per-service code.

## Verifying it took

- **Metrics** — the send-side counters `whizbang.transport.body_offload.count` / `whizbang.transport.body_offload.bytes` appear once a body offloads; the receive-side `whizbang.transport.body_claim.rehydrated.count` / `whizbang.transport.body_claim.rehydrated.bytes` appear once a claim rehydrates. Both are tagged by `message.type` + `message.namespace`.
- **Missing connection string** — resolving the store with no `ConnectionString` throws `InvalidOperationException: AzureBlobOffloadOptions.ConnectionString is required for provider '<name>'` on first resolution (i.e. on the first offload), followed by a `services.Configure<AzureBlobOffloadOptions>(...)` remediation hint.
- **Receiver missing the provider** — a claim whose `whizbang.body-store` provider isn't registered on the receiver dead-letters with `MessageFailureReason.BodyClaimProviderUnknown` and a message pointing at `AddWhizbang*Offload(name)`.

See [Body Offload (Claim-Check Pattern)](/docs/fundamentals/offloads/message-body-store) for the full send/receive pipeline, wire headers, and failure semantics that apply to every provider.

## Integration tests

The provider's integration test suite (`tests/Whizbang.Offloads.AzureBlob.Integration.Tests/`) uses `Testcontainers.Azurite` to spin up a real Azurite container per test class. Round-trip tests cover the upload/download/delete contract, hash verification, MaxBytes cap behavior, and idempotent delete semantics. The config-driven wiring is locked by `AzureBlobOffloadFromConfigurationTests` (provider discovery, `AccessTier`-from-string binding, no-op-when-empty, multi-provider, malformed-key skipping, and default fallbacks). The same code paths run against live Azure in production deployments.
</content>
</invoke>
