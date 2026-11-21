---
title: Azure Blob Storage
pageType: reference
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  Whizbang.Storage.AzureBlob is one package for message body offload and event archive objects in Azure Blob Storage.
  Reference it and name an account under Whizbang:Storage:AzureBlob: each feature whose section is set activates with
  no registration call, and the startup log says which provider each feature uses and why.
tags: 'azure-blob, storage, offload, archive, turnkey, configuration, migration, Whizbang:Storage:AzureBlob'
codeReferences:
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageOptions.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageConfiguration.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageServiceCollectionExtensions.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobStorageTurnkey.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobArchiveObjectStore.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobArchiveOptions.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobMessageBodyStore.cs
  - src/Whizbang.Storage.AzureBlob/AzureBlobOffloadOptions.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveServiceCollectionExtensions.cs
  - src/Whizbang.Core/ServiceRegistrationCallbacks.cs
  - src/Whizbang.Core/WhizbangTurnkeyPackageAttribute.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Configuration/StorageProviderStartupReport.cs
  - src/Whizbang.Core/Offloads/OffloadServiceCollectionExtensions.cs
  - src/Whizbang.Generators/ServiceAssemblyFactsGenerator.cs
testReferences:
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobStorageConfigurationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobStorageTurnkeyTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobArchiveRegistrationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobOffloadFromConfigurationTests.cs
  - tests/Whizbang.Storage.AzureBlob.Tests/AzureBlobOffloadDIRegistrationTests.cs
  - tests/Whizbang.Core.Component.Tests/Configuration/StorageProviderTurnkeyTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyCipherFromConfigurationTests.cs
  - tests/Whizbang.Generators.Tests/ServiceAssemblyFactsGeneratorTests.cs
---

# Azure Blob Storage

`Whizbang.Storage.AzureBlob` holds the Azure Blob providers for both
[message body offload](../offloads/providers/azure-blob) and the [event archive](../events/archive-store#the-azure-blob-store).
It holds no database code: the archive's transaction belongs to the database driver's
[archive coordinator](../events/archive-store#object-stores-and-the-coordinator), and the package only moves objects.

A host references the package and names an account. Each feature whose section is set activates when `AddWhizbang()`
runs, with no registration call.

```mermaid{caption="One package, one account, a container per feature: body offload resolves its store by provider name, the archive coordinator in the database driver writes through the archive object store." tests=["AzureBlobStorageTurnkeyTests.Turnkey_APackageThatIsReferencedAndConfigured_ArchivesAndOffloadsThroughBlob_WithoutACallAsync", "AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync"]}
flowchart LR
  C["Whizbang:Storage:AzureBlob<br/>(the account)"] --> O["Offloads section"]
  C --> A["Archive section"]
  O --> MS["AzureBlobMessageBodyStore<br/>(keyed by provider name)"]
  A --> AS["AzureBlobArchiveObjectStore"]
  AS --> CO["PostgresObjectArchiveStore<br/>(the driver's coordinator)"]
  MS --> B1[(Container: whizbang-offload-bodies)]
  AS --> B2[(Container: whizbang-archive)]
```

## Configuration {#configuration}

{verified: AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync, AzureBlobStorageConfigurationTests.AFeature_ItsOwnAccount_WinsOverTheShared_AndAServiceUriUsesTheRegisteredCredentialAsync}

```json{
title: "Body offload and the archive on one storage account"
description: "The account under Whizbang:Storage:AzureBlob, a section per feature; each feature takes the shared account unless it names its own."
category: "Configuration"
difficulty: "BEGINNER"
tags: ["azure-blob", "configuration", "offload", "archive"]
tests: ["AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync"]
}
{
  "Whizbang": {
    "Storage": {
      "AzureBlob": {
        "ServiceUri": "https://account.blob.core.windows.net",
        "Offloads": { "ContainerName": "whizbang-offload-bodies" },
        "Archive": { "ContainerName": "whizbang-archive", "AccessTier": "Cool" }
      }
    }
  }
}
```

### The account

| Key | Type | Default | Purpose |
|---|---|---|---|
| `Whizbang:Storage:AzureBlob:ServiceUri` | `Uri?` | `null` | The Blob service endpoint every feature uses unless it names its own; authenticates with the `Azure.Core.TokenCredential` the host registers, so no secret is in configuration. |
| `Whizbang:Storage:AzureBlob:ConnectionString` | `string?` | `null` | A storage connection string (the Azurite emulator, or an account key from the host's secret store). Redacted wherever settings are written out. |
| `Whizbang:Storage:AzureBlob:ConnectionName` | `string?` | `null` | A logical connection name. With neither of the above set, the account is the host's `ConnectionStrings:<ConnectionName>` entry: an absolute `https` or `http` address is the service endpoint, anything else a connection string. The archive records the name in every [archive location](../events/archive-store#archive-locations). A value with `;` or `=` is refused. |

### Offloads

| Key | Type | Default | Purpose |
|---|---|---|---|
| `Whizbang:Storage:AzureBlob:Offloads:ProviderName` | `string` | `azure-blob` | The name the body store registers under and every claim records. Keep it stable: a receiver finds the store by the name the sender recorded. |
| `Whizbang:Storage:AzureBlob:Offloads:ServiceUri` | `Uri?` | the shared account | The offload's own endpoint. |
| `Whizbang:Storage:AzureBlob:Offloads:ConnectionString` | `string?` | the shared account | The offload's own connection string. |
| `Whizbang:Storage:AzureBlob:Offloads:ContainerName` | `string` | `whizbang-offload-bodies` | The container bodies are uploaded to; created on the first upload. |
| `Whizbang:Storage:AzureBlob:Offloads:DefaultAccessTier` | `AccessTier?` | the account default | The tier bodies are uploaded at. |
| `Whizbang:Storage:AzureBlob:Offloads:MaxDownloadBytes` | `long?` | `null` (no cap) | The largest body a receiver downloads. |

With this section set, the body store it configures is the one bodies are offloaded to: it sets
`MessageBodyOffloadOptions.ProviderName`. The size threshold, cleanup, sealing and the cipher stay under
`Whizbang:BodyOffload` ([why](#why-bodyoffload-stays)).

### Archive

| Key | Type | Default | Purpose |
|---|---|---|---|
| `Whizbang:Storage:AzureBlob:Archive:ServiceUri` | `Uri?` | the shared account | The archive's own endpoint. |
| `Whizbang:Storage:AzureBlob:Archive:ConnectionString` | `string?` | the shared account | The archive's own connection string. |
| `Whizbang:Storage:AzureBlob:Archive:ConnectionName` | `string` | the shared `ConnectionName`, else `default` | The logical connection name recorded in every archive location. |
| `Whizbang:Storage:AzureBlob:Archive:ContainerName` | `string` | `whizbang-archive` | The container archive objects are written to. |
| `Whizbang:Storage:AzureBlob:Archive:AccessTier` | `AccessTier?` | the account default | `Hot`, `Cool` or `Cold` ([access tier](../events/archive-store#access-tier)); `Archive` is refused. |
| `Whizbang:Storage:AzureBlob:Archive:CompressionLevel` | `int` | `4` | The Brotli quality, 0 to 11. |
| `Whizbang:Storage:AzureBlob:Archive:MaxEventsPerChunk` | `int` | `10000` | The most events one object holds. |
| `Whizbang:Storage:AzureBlob:Archive:LocationMismatch` | `ArchiveLocationMismatchHandling` | `Error` | What a record whose location is not the configured one does ([location mismatch handling](../events/archive-store#location-mismatch)). |
| `Whizbang:Storage:AzureBlob:Archive:DeleteAfter` | `TimeSpan?` | `null` | The deletion delay for storage without soft delete ([a deletion delay](../../operations/deployment/restoring-an-environment-with-an-archive#a-deletion-delay)). |

| Choice | Reason | Verified |
|---|---|---|
| A feature's own account wins over the shared one. | Body offload and the archive can live in different accounts without a second package. | {verified: AzureBlobStorageConfigurationTests.AFeature_ItsOwnAccount_WinsOverTheShared_AndAServiceUriUsesTheRegisteredCredentialAsync} |
| A `ConnectionName` names the account through the host's `ConnectionStrings`. | A host that already keeps its connections there (for example under an orchestrator) names the account once. | {verified: AzureBlobStorageConfigurationTests.AConnectionName_NamesTheAccount_FromTheHostsConnectionStrings_AndIsTheArchivesLocationNameAsync} |
| A value that cannot be read fails the start naming the key, and never echoes a value that may be a secret. | A misread value would otherwise fall back to a default nobody chose. | {verified: AzureBlobStorageConfigurationTests.AValueThatCannotBeRead_FailsTheStart_NamingTheKey_NeverEchoingASecretAsync} |
| Configuration set in code wins over configuration from settings. | Code configures the options after settings do, in either order. | {verified: AzureBlobStorageTurnkeyTests.ExplicitRegistration_WinsOverConfiguration_BeforeOrAfterAddWhizbangAsync} |

## Turnkey activation {#turnkey-activation}

{verified: AzureBlobStorageTurnkeyTests.Turnkey_APackageThatIsReferencedAndConfigured_ArchivesAndOffloadsThroughBlob_WithoutACallAsync, StorageProviderTurnkeyTests.AddWhizbang_RunsEveryLoadedStorageProvider_UnlessTheHostOptsOutAsync}

The package registers itself with `ServiceRegistrationCallbacks.RegisterStorageProvider`, and `AddWhizbang()` runs
every registered storage provider. Each feature then activates, when the container is built, from its configuration:
it is on when its section is set and an account is named for it. A package that is referenced and not configured
changes nothing.

```csharp{
title: "Archive and offload to Azure Blob Storage with no registration call"
description: "With the package referenced and Whizbang:Storage:AzureBlob configured, AddWhizbang() is the whole setup; the identity is the host's TokenCredential."
framework: "NET10"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["azure-blob", "turnkey", "offload", "archive", "managed-identity"]
nugetPackages: ["SoftwareExtravaganza.Whizbang.Storage.AzureBlob", "Azure.Identity"]
tests: ["AzureBlobStorageTurnkeyTests.Turnkey_APackageThatIsReferencedAndConfigured_ArchivesAndOffloadsThroughBlob_WithoutACallAsync"]
}
builder.Services.AddSingleton<TokenCredential>(new ManagedIdentityCredential());
builder.Services.AddWhizbang();
```

To configure in code, or to register after opting out, call it yourself. It is safe to call more than once, before
or after `AddWhizbang()`; the package registers once.

```csharp{
title: "Register Azure Blob storage in code"
description: "Configuration is read first, then the callback, so a value set in code wins; setting Archive or Offloads turns that feature on."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["azure-blob", "registration", "archive", "offload"]
nugetPackages: ["SoftwareExtravaganza.Whizbang.Storage.AzureBlob"]
tests: ["AzureBlobStorageTurnkeyTests.ExplicitRegistration_InCode_TurnsAFeatureOn_WithNoConfigurationAsync", "AzureBlobStorageTurnkeyTests.ExplicitRegistration_WinsOverConfiguration_BeforeOrAfterAddWhizbangAsync"]
}
builder.Services.AddWhizbangAzureBlobStorage(storage => {
  storage.ConnectionString = "UseDevelopmentStorage=true";
  storage.Archive = new AzureBlobArchiveOptions { ContainerName = "archive" };
  storage.Offloads = new AzureBlobOffloadOptions { ContainerName = "bodies" };
});
```

`AddWhizbangAzureBlobStorage(IConfiguration)` reads a configuration the host builds itself, over the one in its
container. {verified: AzureBlobStorageConfigurationTests.AGivenConfiguration_IsReadOverTheHostsOwnAsync}

### Why a feature needs its section {#why-a-feature-needs-its-section}

{verified: AzureBlobStorageConfigurationTests.AConnectionName_WithNoConnectionStringsEntry_NamesNoAccount_AndTheFeatureStaysOff_WithAWarningAsync, AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync}

A feature activates when its section (`Offloads` or `Archive`) is set **and** an account is named for it, not when
an account alone is named. The account is shared: if naming it switched both features on, a host that configured an
account for body offload would also move its archive out of the database, a deployment decision nobody made. A
section set with no account leaves the feature off and warns at start, naming the keys to set.

### Why generated registration {#why-generated-registration}

{verified: ServiceAssemblyFactsGeneratorTests.AReferencedTurnkeyPackage_IsRegistered_FromTheModuleInitializerAsync, AzureBlobStorageTurnkeyTests.Turnkey_APackageThatIsReferencedAndConfigured_ArchivesAndOffloadsThroughBlob_WithoutACallAsync}

The .NET runtime loads an assembly only when code uses one of its types, and a package's own module initializer runs
only then. A host that references the package and calls nothing in it would never load it, so its configuration would
do nothing. The package therefore declares `[assembly: WhizbangTurnkeyPackage(typeof(AzureBlobStorageTurnkey))]`, and
the Whizbang generators emit, in every assembly compiled against it, a module initializer that calls
`AzureBlobStorageTurnkey.Register()`. The call is a plain static method call: no reflection, AOT-safe. Registering
twice keeps one registration.

## Opting out {#opting-out}

{verified: AzureBlobStorageTurnkeyTests.Turnkey_OptedOut_KeepsThePackageLoaded_AndTheDefaultsAsync}

`WhizbangCoreOptions.AutoRegisterStorageProviders = false` keeps the package loaded but inactive: no feature
activates, the archive stays in the driver's table store, and no body store is registered. Call
`AddWhizbangAzureBlobStorage(...)` yourself to register what you want.

```csharp{
title: "Keep the package loaded but inactive"
description: "The opt-out leaves the defaults in place; an explicit registration still works."
framework: "NET10"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["azure-blob", "turnkey", "opt-out"]
tests: ["AzureBlobStorageTurnkeyTests.Turnkey_OptedOut_KeepsThePackageLoaded_AndTheDefaultsAsync", "StorageProviderTurnkeyTests.AddWhizbang_RunsEveryLoadedStorageProvider_UnlessTheHostOptsOutAsync"]
}
builder.Services.AddWhizbang(options => options.AutoRegisterStorageProviders = false);
```

## Startup report {#startup-report}

{verified: StorageProviderTurnkeyTests.Report_NamesTheArchiveObjectStore_OrTheDriversStore_AndTheOffloadStore_EachWithWhyAsync, StorageProviderTurnkeyTests.Report_WarnsWhenConfigurationNamesAnAccount_ForAPackageThatIsNotLoaded_NamingItAsync, AzureBlobStorageStartupNoticesTests.TheStartupNotices_AreLoggedOnce_EachAsAWarningAsync}

At start the host logs which provider each storage feature uses, and why:

| Log line | When |
|---|---|
| `Archive store: azure-blob, endpoint …, connection 'default', container 'whizbang-archive' (azure-blob, account from Whizbang:Storage:AzureBlob:ServiceUri)` | An archive object store is selected; the reason names the key that named the account. |
| `Archive store: the database driver's built-in store (…)` | The driver has an archive store and no object store is selected. |
| `Body offload store: provider 'azure-blob', AzureBlobMessageBodyStore (azure-blob, account from …)` | Body offload names a provider. |
| `… names a storage account, but the package SoftwareExtravaganza.Whizbang.Storage.AzureBlob is not loaded, so the setting does nothing …` (warning) | Configuration names an account (any of the new or earlier account keys) and the package is not loaded. The warning names the key and the package, never the value. |
| `Azure Blob storage: …` (warning) | A key of an earlier package is read, or a feature's section is set with no account. Each is logged once. |

The archive line is read from the selection, never by building the driver's archive store, so an object store whose
configuration cannot work fails the start rather than the first archive.

## Migrating from the earlier packages {#migrating-from-the-earlier-packages}

{verified: AzureBlobStorageConfigurationTests.TheEarlierKeys_StillBind_WithAWarningNamingTheNewKey_AndTheNewKeyWinsAsync, AzureBlobArchiveRegistrationTests.Registration_TheDriverArchivesThroughBlob_WhetherItComesBeforeOrAfterTheDriverAsync, AzureBlobOffloadFromConfigurationTests.FromConfiguration_RegistersProvider_BindsOptions_AndSelectorAsync}

`Whizbang.Offloads.AzureBlob` and `Whizbang.Archive.AzureBlob` ship this release as shims that depend on
`Whizbang.Storage.AzureBlob`. Nothing is required to upgrade: the earlier calls and keys keep working.

| Earlier | Now | This release |
|---|---|---|
| `AddWhizbangAzureBlobOffload(name, ...)`, `AddWhizbangAzureBlobOffloadsFromConfiguration(config)`, `AddWhizbangAzureBlobArchive(...)` | No call; or `AddWhizbangAzureBlobStorage(...)` | Still compile and work, marked `[Obsolete]`. |
| `Whizbang:Archive:AzureBlob:*` | `Whizbang:Storage:AzureBlob` (account) and `Whizbang:Storage:AzureBlob:Archive:*` | Still bound, with a startup warning naming the new key. A key set in both takes the new value. |
| `Whizbang:Offloads:AzureBlob:<providerName>:*` | `Whizbang:Storage:AzureBlob` and `Whizbang:Storage:AzureBlob:Offloads:*` with `ProviderName` set to the same name | Still bound: each store keeps its name, so claims already sent still resolve. A startup warning names the new keys. |
| `Whizbang:BodyOffload:ProviderName` | `Whizbang:Storage:AzureBlob:Offloads:ProviderName` | Still chooses among the earlier named stores; with the new `Offloads` section set, the new name wins and a warning says so. |

To move:

1. Reference `Whizbang.Storage.AzureBlob` (or keep the old reference; it brings the new package).
2. Move the account to `Whizbang:Storage:AzureBlob` and the settings to the `Offloads` and `Archive` sections. Set
   `Offloads:ProviderName` to the name the earlier store used, so claims in flight resolve. Keep the archive's
   `ConnectionName` the one its records were written with.
3. Remove the registration calls, and the old package references.

What does **not** stay source compatible, because the type moved where the work now happens; each fails to compile
rather than changing behavior:

- `AzureBlobArchiveStore` is gone: the coordinator is the database driver's. To repoint a location, resolve
  `IArchiveStore` as `IArchiveObjectCoordinator` ([repointing](../events/archive-store#repointing-an-environment)).
- `ArchiveObjectCorruptedException` and `ArchiveObjectDeletionStep` are in `Whizbang.Core.Archival`;
  `ArchiveSweepMetrics` is in `Whizbang.Data.Postgres` (its meter name, `Whizbang.Archive.AzureBlob`, is unchanged). A
  storage failure surfaces as `ArchiveObjectStoreException`, with the Azure error inside.
- The options types (`AzureBlobArchiveOptions`, `AzureBlobOffloadOptions`) and `AzureBlobMessageBodyStore` are in the
  namespace `Whizbang.Storage.AzureBlob`: code that names them adds that `using`. A lambda passed to an earlier call
  compiles unchanged.

A rolling deploy beside the previous release works: nothing stored changes. Object names, blob paths, the archive
locator (`azure-blob://{stream}`), manifest and location rows and every SQL function are the ones the earlier
packages wrote. {verified: AzureBlobArchiveRegistrationTests.Locator_NamesTheStoreAndTheStream_NeverTheContainer_WithBrotliAndFormat1Async}

After the shims ship, once consumers have moved, both old package ids are deprecated on nuget.org with
`Whizbang.Storage.AzureBlob` as the alternative, and no further versions are published.

## Why one package {#why-one-package}

{verified: AzureBlobStorageConfigurationTests.TheNewKeys_NameOneAccount_AndEachFeatureTakesItAsync}

The two earlier packages both depended on Core and the Azure Blob SDK and both stored objects in blob storage; they
were split by when they were written, not by design. One package means one account setting, a container per feature,
one place to configure, and one reference. The body-offload provider already had the right shape (Core and the SDK,
no database); the archive provider now does too, since the database half moved to the driver
([why](../events/archive-store#object-stores-and-the-coordinator)).

## Why the archive keeps its connection name {#why-the-archive-keeps-its-connection-name}

{verified: AzureBlobStorageConfigurationTests.AConnectionName_AlongsideAnAccount_OnlyNamesTheLocation_AndNeverReplacesTheArchivesOwnAsync}

Every archive record names its location, and the location includes the connection name. If the shared
`ConnectionName` replaced the archive's own, an environment whose archive was written with one name would find every
record in a different location and refuse to read it. So the archive's own name (the new section's, then the earlier
section's) always wins, and the shared name applies only when the archive names none. A `ConnectionName` set beside an
account that is already named only names the location; it never replaces the account.

## Why Whizbang:BodyOffload stays {#why-bodyoffload-stays}

{verified: AzureBlobStorageConfigurationTests.TheEarlierKeys_StillBind_WithAWarningNamingTheNewKey_AndTheNewKeyWinsAsync, BodyCipherFromConfigurationTests.FromTheHostsConfiguration_ResolvesTheNamedCipher_AndNothingElseAsync}

`Whizbang:BodyOffload` is Core's section for body offload with any provider (the in-memory store, or one of your own):
the size threshold, active cleanup, sealing, passive expiry and the cipher. It is not Azure's, so it is not moved and
reads no warning. Only its `ProviderName` overlaps: with the new `Offloads` section set, that section's provider is
the one bodies go to, and a `Whizbang:BodyOffload:ProviderName` beside it gets a warning. The cipher named there is
registered from the host's configuration when the container is built, so a turnkey host seals bodies as an explicit
call did.

Two registrations of body offload (the package's and an explicit `AddWhizbangBodyOffload()`) add the offload hook
once. {verified: StorageProviderTurnkeyTests.AddWhizbangBodyOffload_Twice_RegistersTheOffloadHookOnceAsync}

## Related

- [Archive store](../events/archive-store)
- [Azure Blob body store](../offloads/providers/azure-blob)
- [Configuration reference](../../operations/configuration/configuration-reference)
