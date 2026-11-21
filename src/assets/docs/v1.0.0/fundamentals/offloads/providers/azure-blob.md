---
title: Azure Blob Body Store
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 2
description: >-
  Production body-store provider backed by Azure Blob Storage, shipped in
  Whizbang.Storage.AzureBlob. Works identically against the Azurite emulator
  and live Azure Blob. Active with no registration call when
  Whizbang:Storage:AzureBlob names an account and its Offloads section is set.
tags: 'offload, providers, azure-blob, azurite, production, configuration'
codeReferences:
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageServiceCollectionExtensions.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageConfiguration.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobMessageBodyStore.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobOffloadOptions.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Offloads/MessageBodyOffloadOptions.cs
  - src/Whizbang.Core/Offloads/OffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Offloads/BodyClaimRehydrator.cs
testReferences:
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobStorageConfigurationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobStorageTurnkeyTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobOffloadFromConfigurationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobOffloadDIRegistrationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobMessageBodyStoreValidationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobMessageBodyStoreUploadGuardTests.cs
  - tests/Whizbang.Storage.AzureBlob.Integration.Tests/AzureBlobStoreRoundTripTests.cs
  - tests/Whizbang.Storage.AzureBlob.Integration.Tests/AzureBlobStoreUploadTests.cs
  - tests/Whizbang.Storage.AzureBlob.Integration.Tests/AzureBlobStoreDownloadDeleteTests.cs
---

# Azure Blob Body Store

`AzureBlobMessageBodyStore`, in the package `Whizbang.Storage.AzureBlob`, is the production body-store provider for
[body offload](/v1.0.0/fundamentals/offloads/message-body-store). It wraps `Azure.Storage.Blobs` and behaves identically
against the Azurite emulator and live Azure Blob. The same package holds the event archive's object store; see
[Azure Blob Storage](../../storage/azure-blob) for the account, turnkey activation and migration.

## Activation from configuration (recommended)

{verified: AzureBlobStorageTurnkeyTests.Turnkey_APackageThatIsReferencedAndConfigured_ArchivesAndOffloadsThroughBlob_WithoutACallAsync, AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync}

Reference `Whizbang.Storage.AzureBlob`, name an account under `Whizbang:Storage:AzureBlob`, and set the `Offloads`
section. `AddWhizbang()` registers the store under its provider name (`azure-blob` unless `ProviderName` says otherwise),
enables the send-side hook, and makes that store the offload target. Nothing else to call.

```json{
title: "Azure Blob body offload from configuration"
description: "The account and the Offloads section; with the package referenced, this turns body offload on with no registration call."
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "appsettings", "turnkey"]
tests: ["AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync"]
}
{
  "Whizbang": {
    "Storage": {
      "AzureBlob": {
        "ConnectionString": "DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;EndpointSuffix=core.windows.net",
        "Offloads": {
          "ProviderName": "azure-blob",
          "ContainerName": "whizbang-offload-bodies",
          "DefaultAccessTier": "Cool",
          "MaxDownloadBytes": 104857600
        }
      }
    },
    "BodyOffload": {
      "SizeThresholdBytes": 65536,
      "ActiveCleanup": false
    }
  }
}
```

Env-var form (what you paste into Helm / Kubernetes, `:` becomes `__`):

```bash{
title: "Azure Blob body offload as environment variables"
description: "The same configuration as double-underscore environment variables for Helm / Kubernetes."
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "configuration", "environment-variables", "kubernetes"]
}
Whizbang__Storage__AzureBlob__ConnectionString="…"
Whizbang__Storage__AzureBlob__Offloads__ContainerName="whizbang-offload-bodies"
Whizbang__Storage__AzureBlob__Offloads__DefaultAccessTier="Cool"
Whizbang__Storage__AzureBlob__Offloads__MaxDownloadBytes="104857600"
Whizbang__BodyOffload__SizeThresholdBytes="65536"
Whizbang__BodyOffload__ActiveCleanup="false"
```

`ServiceUri` in place of `ConnectionString` authenticates with the `Azure.Core.TokenCredential` the host registers, so no
secret is in configuration. The size threshold, cleanup, sealing and the cipher stay under Core's `Whizbang:BodyOffload`,
whatever the provider ([why](../../storage/azure-blob#why-bodyoffload-stays)); a cipher named there is registered from
configuration, with no call.

> Keep `ProviderName` stable. Every claim records it, and a receiver finds the store by the name the sender recorded.
> When moving from the earlier package's keys, set it to the name the earlier store used.

The binder reads each option explicitly (no reflection binder), so the Azure SDK extensible enum `DefaultAccessTier` is
built from its string form (e.g. `"Cool"`). Blank values keep the defaults.

## Registering in code

```csharp{
title: "Register the Azure Blob body store in code"
description: "Turns body offload on in code; configuration is read first, so a value set here wins."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "azure-blob", "claim-check", "dependency-injection"]
tests: ["AzureBlobStorageTurnkeyTests.ExplicitRegistration_WinsOverConfiguration_BeforeOrAfterAddWhizbangAsync"]
}
services.AddWhizbangAzureBlobStorage(storage => {
  storage.ConnectionString = builder.Configuration.GetConnectionString("Storage");
  storage.Offloads = new AzureBlobOffloadOptions {
    ProviderName = "azure-blob",
    ContainerName = "whizbang-offload-bodies",
    MaxDownloadBytes = 100 * 1024 * 1024,   // refuse claims > 100 MB
  };
});
```

## The earlier package's calls

{verified: AzureBlobOffloadFromConfigurationTests.FromConfiguration_RegistersProvider_BindsOptions_AndSelectorAsync, AzureBlobOffloadDIRegistrationTests.AddWhizbangAzureBlobOffload_RegistersStoreUnderProviderNameAsync}

`Whizbang.Offloads.AzureBlob` ships this release as a shim over `Whizbang.Storage.AzureBlob`. Its calls compile and work,
marked `[Obsolete]`:

- `AddWhizbangAzureBlobOffloadsFromConfiguration(configuration)` registers a store for every
  `Whizbang:Offloads:AzureBlob:<name>` subsection under its name, binds the selector from `Whizbang:BodyOffload`, and
  registers the cipher it names, as before.
- `AddWhizbangAzureBlobOffload(name, opts => ...)` registers one store under `name`, configured in code.

Without either call, the turnkey package still reads `Whizbang:Offloads:AzureBlob:<name>`: each store keeps its name,
so claims already sent resolve, and a startup warning names the new keys. `Whizbang:BodyOffload:ProviderName` still
chooses among those stores; with the new `Offloads` section set, that section's store wins. See
[migrating from the earlier packages](../../storage/azure-blob#migrating-from-the-earlier-packages).

## Emulator (Azurite) vs live

The SDK's connection-string convention does the work:

```csharp{
title: "Switch between Azurite emulator and live Azure Blob"
description: "Shows how the Azure SDK connection-string convention alone selects the Azurite emulator or a live Azure Blob account without any code change."
framework: "NET10"
category: "Offloads"
difficulty: "BEGINNER"
tags: ["azure-blob", "azurite", "connection-string", "body-offload", "emulator"]
unverified: "connection-string configuration illustration — the Azure SDK selects emulator vs live from the string; the round-trip behavior is verified by AzureBlobStoreRoundTripTests, which is outside the current coverage map"
}
// Azurite (local dev / CI integration tests)
opts.ConnectionString = "UseDevelopmentStorage=true";

// Live Azure Blob
opts.ConnectionString = "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...";
```

Behavior is identical against either backend — same upload/download/delete semantics, same hash verification, same metadata. The integration test suite (`Whizbang.Storage.AzureBlob.Integration.Tests`) runs against a real Azurite container via Testcontainers; the same code path runs against live Azure in production.

## Options

**Provider: `AzureBlobOffloadOptions`** (`Whizbang:Storage:AzureBlob:Offloads`; the earlier `Whizbang:Offloads:AzureBlob:<name>` is still read):

| Option | Default | Notes |
|---|---|---|
| `ProviderName` | `"azure-blob"` | The name the store registers under and claims record. Read from the new section only. |
| `ServiceUri` | the shared account | The Blob service endpoint, authenticated with the registered `TokenCredential`. Read from the new section only. |
| `ConnectionString` | the shared account | Azure Storage connection string. Account key / SAS / `UseDevelopmentStorage=true` (Azurite). With no account at all, the offload stays off and a startup warning says so; an earlier named store without one throws on first resolution, naming the key. |
| `ContainerName` | `"whizbang-offload-bodies"` | Lazily created on first upload via `CreateIfNotExistsAsync`. Give each slot its own container when slots share an account. |
| `DefaultAccessTier` | `null` (account default) | `Hot` / `Cool` / `Cold` / `Archive`. Archive bodies are NOT downloadable without an out-of-band rehydration — only set for cold-storage use cases that don't need receive-time rehydrate. |
| `MaxDownloadBytes` | `null` (no cap) | Defensive cap. When non-null and a claim reports a larger body, the provider refuses to download. Protects receivers from tampered claim tickets that would otherwise pull a multi-GB blob. |

**Selector — `MessageBodyOffloadOptions`** (`Whizbang:BodyOffload`; every key binds, including the passive-sweep keys in the [configuration reference](../../../operations/configuration/configuration-reference#whizbangbodyoffload--messagebodyoffloadoptions)):

| Key | Default | Notes |
|---|---|---|
| `ProviderName` | `null` | The active send-side provider. `null` ⇒ offload disabled (publish inline). |
| `SizeThresholdBytes` | `65536` (64 KB) | Bodies at/above this offload. Set below the transport ceiling to leave envelope headroom. |
| `ActiveCleanup` | `false` | `false` ⇒ rely on a blob lifecycle rule to delete old bodies (recommended). `true` ⇒ the consumer worker deletes the body (fire-and-forget) after the inbox row commits. |
| `DownloadTimeout` | `100s` (`TimeSpan.FromSeconds(100)`) | Bounds a single receive-side body-store download during rehydration; exceeding it aborts and surfaces a **retryable** failure (the transport redelivers) rather than stalling the consumer on a hung blob call. Binds from `Whizbang:BodyOffload:DownloadTimeout`, like every other key in the section. |

## Behavior

- **Upload**: lazily creates the container; computes SHA-256 of the body; uploads via `BlobClient.UploadAsync` with `ContentType` set; stores `whizbang_content_hash` in blob metadata for forensic recovery. Returns a `MessageBodyClaim` (provider name, storage key, size, content hash) with `StorageKey = "yyyy/MM/dd/<guid>.bin"`.
- **Download**: pulls the blob via `BlobClient.DownloadContentAsync`. 404 → `InvalidOperationException` with a TTL-removal hint. Honors `MessageBodyDownloadOptions.MaxBytes` (per-call, takes precedence) and the provider's own `MaxDownloadBytes` cap; a claim reporting a larger body is refused before download.
- **Delete**: `BlobClient.DeleteIfExistsAsync` with snapshot inclusion. Default `IgnoreMissing = true` makes double-deletes silent (fan-out safe); strict mode throws on missing blobs.

> At the rehydrator level (shared by every provider), a download failure — a transient store/network error, this store's 404 `InvalidOperationException`, or a breach of the receive-side `DownloadTimeout` — is wrapped in `BodyClaimDownloadException` and **retried via transport redelivery**, not dead-lettered. Only after the transport's max-delivery count is exhausted does the message hit the DLQ. Terminal failures (content-hash mismatch, unknown provider, deserialization error) dead-letter immediately. See [Body Offload (Claim-Check Pattern)](/v1.0.0/fundamentals/offloads/message-body-store) for the full failure-semantics table.

## Lifecycle / cleanup

Two cleanup paths, both supported:

**TTL (recommended)**: configure a blob lifecycle rule on the storage account, e.g. "delete after 7 days." `DeleteAsync` becomes a backstop; the lifecycle rule does the actual reaping. Simplest in fan-out subscriber topologies where multiple consumers read the same body.

**Active**: set `MessageBodyOffloadOptions.ActiveCleanup = true`. The consumer worker fires `IMessageBodyStore.DeleteAsync(claim)` after the inbox row commits, in a fresh DI scope, fire-and-forget. A failed inbox INSERT never deletes a body still needed for redelivery. The provider's `IgnoreMissing` absorbs fan-out double-delete races. The TTL rule is still the backstop on transient delete failures.

## Production deployment recipe

```json{
title: "Production Azure Blob body-offload configuration"
description: "A managed identity for the account, a defensive MaxDownloadBytes cap, and TTL-based cleanup instead of active deletion."
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "azure-blob", "production", "cleanup", "max-download-bytes"]
}
{
  "Whizbang": {
    "Storage": {
      "AzureBlob": {
        "ServiceUri": "https://account.blob.core.windows.net",
        "Offloads": { "ContainerName": "whizbang-offload-bodies", "MaxDownloadBytes": 104857600 }
      }
    },
    "BodyOffload": { "SizeThresholdBytes": 65536, "ActiveCleanup": false }
  }
}
```

Register the identity (`builder.Services.AddSingleton<TokenCredential>(new ManagedIdentityCredential())`) and call
`AddWhizbang()`.

Configure a blob lifecycle policy in Azure Storage for the `whizbang-offload-bodies` container — typical: delete blobs older than 7 days. That's the production cleanup path.

> The receive side must register the **same provider name** so the rehydrator can find the store. Configuration satisfies this uniformly: every service supplies the same `Whizbang:Storage:AzureBlob:Offloads:ProviderName` (or keeps the default) with zero per-service code.

## Verifying it took

- **Metrics** — the send-side counters `whizbang.transport.body_offload.count` / `whizbang.transport.body_offload.bytes` appear once a body offloads; the receive-side `whizbang.transport.body_claim.rehydrated.count` / `whizbang.transport.body_claim.rehydrated.bytes` appear once a claim rehydrates. Both are tagged by `message.type` + `message.namespace`.
- **Startup log** — `Body offload store: provider 'azure-blob', AzureBlobMessageBodyStore (…)` names the store and the key that named its account ([startup report](../../storage/azure-blob#startup-report)).
- **Missing account** — an `Offloads` section with no account leaves offload off and logs a warning at start naming the keys to set.
- **Receiver missing the provider** — a claim whose `whizbang.body-store` provider isn't registered on the receiver dead-letters with `MessageFailureReason.BodyClaimProviderUnknown` and a message pointing at `AddWhizbang*Offload(name)`.

See [Body Offload (Claim-Check Pattern)](/v1.0.0/fundamentals/offloads/message-body-store) for the full send/receive pipeline, wire headers, and failure semantics that apply to every provider.

## Integration tests

The provider's integration test suite (`tests/Whizbang.Storage.AzureBlob.Integration.Tests/`) uses `Testcontainers.Azurite` to spin up a real Azurite container per test class. Round-trip tests cover the upload/download/delete contract, hash verification, MaxBytes cap behavior, and idempotent delete semantics. Activation from configuration is locked by `AzureBlobStorageConfigurationTests` and `AzureBlobStorageTurnkeyTests`, and the earlier package's calls by `AzureBlobOffloadFromConfigurationTests` and `AzureBlobOffloadDIRegistrationTests`. The same code paths run against live Azure in production deployments.

## Related

- [Archive Store: the Azure Blob store](../../events/archive-store#the-azure-blob-store): archived event streams in the same kind of storage account, with their own container (`whizbang-archive`) and settings (`Whizbang:Storage:AzureBlob:Archive`), from the same package and account.
- [Azure Blob Storage](../../storage/azure-blob): the package, the account, turnkey activation and migration.
