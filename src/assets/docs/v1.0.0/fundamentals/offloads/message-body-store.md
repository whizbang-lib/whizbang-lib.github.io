---
title: Body Offload (Claim-Check Pattern)
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  Transparent claim-check pattern for messages that exceed transport
  wire-size ceilings — upload the body to a registered IMessageBodyStore,
  send a small claim envelope on the wire, rehydrate on receive.
tags: 'offload, claim-check, messaging, transports, body-size, encryption, envelope-encryption'
codeReferences:
  - src/Whizbang.Core/Offloads/IMessageBodyStore.cs
  - src/Whizbang.Core/Offloads/MessageBodyClaim.cs
  - src/Whizbang.Core/Offloads/BodyClaimEnvelopePayload.cs
  - src/Whizbang.Core/Offloads/MessageBodyOffloadOptions.cs
  - src/Whizbang.Core/Offloads/IMessageBodyCipher.cs
  - src/Whizbang.Core/Offloads/AesGcmEnvelopeCipher.cs
  - src/Whizbang.Core/Offloads/IMessageBodyKeyWrapper.cs
  - src/Whizbang.Core/Offloads/RotatingAesKeyWrapper.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobOffloadServiceCollectionExtensions.cs
  - src/Whizbang.Core/Offloads/IPostSerializeHook.cs
  - src/Whizbang.Core/Offloads/PostSerializeHookChain.cs
  - src/Whizbang.Core/Offloads/BodyOffloadPostSerializeHook.cs
  - src/Whizbang.Core/Offloads/BodyClaimWireHelper.cs
  - src/Whizbang.Core/Offloads/BodyClaimRehydrator.cs
  - src/Whizbang.Core/Offloads/BodyClaimDownloadException.cs
  - src/Whizbang.Core/Offloads/OffloadServiceCollectionExtensions.cs
  - src/Whizbang.Offloads.InMemory/InMemoryMessageBodyStore.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobMessageBodyStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Offloads/BodyOffloadPostSerializeHookTests.cs
  - tests/Whizbang.Core.Tests/Offloads/PostSerializeHookChainTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyClaimRehydratorTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyClaimWireHelperTests.cs
  - tests/Whizbang.Core.Tests/Offloads/MessageBodyStoreContractTests.cs
  - tests/Whizbang.Core.Tests/Offloads/AddWhizbangMessageBodyStoreTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerBodyOffloadTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyOffloadCipherTests.cs
  - tests/Whizbang.Core.Tests/Offloads/AesGcmEnvelopeCipherTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyCipherFromConfigurationTests.cs
  - tests/Whizbang.Core.Tests/Offloads/RotatingAesKeyWrapperTests.cs
  - tests/Whizbang.Offloads.AzureBlob.Tests/AzureBlobOffloadFromConfigurationTests.cs
---

# Body Offload (Claim-Check Pattern)

When a message body exceeds the wire-size ceiling of the destination transport, sending it inline either fails outright (Azure Service Bus Standard rejects anything over 256 KB) or wastes broker resources (RabbitMQ accepts huge messages but they bog down dispatch). Whizbang's **body offload** feature solves this transparently:

1. **Producer**: detects pre-flight that the serialized envelope exceeds either the transport's `MaxMessageSizeBytes` or the configured threshold; uploads the body to a registered `IMessageBodyStore`; substitutes the wire payload with a small `BodyClaimEnvelopePayload` carrying the claim ticket.
2. **Wire**: the on-wire message is small (claim envelope) and carries a `whizbang.is-claim` header plus a `whizbang.body-store` provider name and `whizbang.original-type` so receivers know how to find and rehydrate the original.
3. **Receiver**: detects the `whizbang.is-claim` header pre-deserialization, deserializes the wire bytes as the claim envelope, downloads the body via the matching `IMessageBodyStore`, verifies SHA-256 integrity, deserializes the bytes as the original envelope type, and proceeds as if no claim ever existed.

The receiver-side experience is transparent: receptors and perspectives see the original message; the claim handling is invisible.

## End-to-end DI

```csharp{
title: "End-to-end body-offload DI wire-up"
description: "Registers a transport, an Azure Blob body store, and the body-offload post-serialize hook so any envelope over the threshold or transport ceiling auto-offloads via claim-check."
framework: "NET10"
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "claim-check", "azure-blob", "dependency-injection", "size-threshold", "post-serialize-hook"]
unverified: "end-to-end DI wire-up — composes transport, Azure Blob offload, and hook registration across packages; no single behavior under test"
}
services.AddWhizbangRabbitMQ(opts => { /* … */ });   // or AddWhizbangAzureServiceBus

services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => {
  opts.ConnectionString = builder.Configuration.GetConnectionString("Storage");
  opts.ContainerName    = "whizbang-offload-bodies";
});

services.AddWhizbangBodyOffload();   // registers the body-offload post-serialize hook

services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName       = "azure-blob-prod";
  opts.SizeThresholdBytes = 64 * 1024;   // 25% of ASB Standard 256 KB
  opts.ActiveCleanup      = false;       // default — rely on the provider's TTL rule
});
```

That's the complete wire-up. From this point, any envelope that exceeds 64 KB OR the transport's `MaxMessageSizeBytes` (whichever is smaller) auto-offloads. Below threshold, the inline path runs with zero overhead.

## The post-serialize hook chain

Body offload is implemented as a **post-serialize hook** on the publish strategy. The chain runs after the envelope serializes to bytes but before the transport's wire-send, so the offload hook sees the actual byte size — no estimation, no guessing.

```csharp{
title: "The IPostSerializeHook contract"
description: "Defines the post-serialize hook interface whose ordered chain runs on the serialized bytes before wire-send, letting body offload (Order 1000) measure and substitute the actual payload."
framework: "NET10"
category: "Offloads"
difficulty: "ADVANCED"
tags: ["post-serialize-hook", "body-offload", "claim-check", "hook-chain", "extensibility"]
unverified: "interface declaration — no behavior to assert; the ordered hook chain that runs these is exercised by PostSerializeHookChainTests"
}
public interface IPostSerializeHook {
  /// Lower runs first. Conventions:
  ///   100 = observability / size measurement
  ///   500 = compression / encoding
  ///   1000 = body offload / claim-check
  ///   2000 = encryption / signing
  int Order { get; }

  Task<PostSerializeResult> RunAsync(PostSerializeContext context, CancellationToken cancellationToken);
}
```

Each hook receives the current `(envelope, bytes, content-type, transport-max-size, JsonSerializerOptions, destination)` and may return a `PostSerializeResult` that replaces any of them and/or merges additional headers into the destination metadata.

`BodyOffloadPostSerializeHook` (Order 1000) is the built-in body-offload implementation. Custom hooks can compose alongside it.

Order is about the wire, not the store. A hook at 2000 runs after the offload hook, so what it sees and can protect is the small claim envelope that goes on the wire. It cannot protect the body: by the time it runs, the body has already left the process for the store. A body that must not reach the store in the clear is sealed inside the offload path, before the upload call, not in a later hook slot. See [Sealing bodies before they reach the store](#sealing-bodies).

## Wire headers

When the offload hook substitutes the body, it stamps three headers on the destination metadata that the receiver uses to rehydrate:

| Header | Value | Purpose |
|---|---|---|
| `whizbang.is-claim` | `true` | Receiver-side switch: deserialize as `MessageEnvelope<BodyClaimEnvelopePayload>` instead of the type the `ENVELOPE_TYPE_HEADER` claims. |
| `whizbang.body-store` | provider name | Receiver looks up the matching `IMessageBodyStore` via `GetKeyedService<IMessageBodyStore>(name)`. |
| `whizbang.original-type` | assembly-qualified envelope type | What to deserialize the downloaded bytes as after rehydrate. |

`ENVELOPE_TYPE_HEADER` (RabbitMQ) / `EnvelopeType` (ASB ApplicationProperties) stays set to the **original** type so SqlFilters and routing-key matchers continue to work — the wire bytes are different, but the routing-visible properties are unchanged.

## Receive-side rehydrate

`BodyClaimRehydrator.MaybeRehydrateAsync` is the receive-side counterpart. The `TransportConsumerWorker` calls it inline before serializing to inbox:

1. If `envelope.Payload is not BodyClaimEnvelopePayload`, pass through unchanged (the common case — cost is one type-check).
2. Otherwise: resolve the matching `IMessageBodyStore` by claim provider name. Unknown provider → terminal failure with `MessageFailureReason.BodyClaimProviderUnknown`.
3. Download the bytes, bounded by `MessageBodyOffloadOptions.DownloadTimeout` (default 100 s). A transient download failure or timeout throws `BodyClaimDownloadException` — a **retryable** failure: the transport redelivers, and only after the max-delivery count is exhausted does the message dead-letter.
4. Compute SHA-256; compare against `claim.ContentHash`. Mismatch → terminal failure with `MessageFailureReason.BodyClaimIntegrityFailure`.
5. If the claim carries a `Cipher` descriptor, resolve the `IMessageBodyCipher` registered under the descriptor's cipher name and open the verified bytes. No cipher under that name → terminal failure with `MessageFailureReason.BodyClaimCipherUnknown`. The bytes do not authenticate under the described key → terminal failure with `MessageFailureReason.BodyClaimIntegrityFailure` (the stored bytes matched the hash, so the key or the descriptor is wrong, not the storage). See [Sealing bodies before they reach the store](#sealing-bodies).
6. Deserialize the downloaded (and, if sealed, opened) bytes as the original envelope type from `claim.OriginalTypeName`. No JsonTypeInfo → terminal failure with `MessageFailureReason.SerializationError`.
7. Return the rehydrated envelope. The worker treats it as if no claim ever existed.

Terminal rehydrate failures (steps 2, 4, 5, 6) are logged with their `MessageFailureReason` and the message is **discarded**: the worker ACKs it without inserting an inbox row, so at this commit it is not redelivered and not written to `wh_dead_letters`.

## Sealing bodies before they reach the store {#sealing-bodies}
{verified: BodyOffloadCipherTests.Hook_WithACipher_UploadsSealedBytes_NeverThePlaintextAsync, BodyOffloadCipherTests.Rehydrate_SealedBody_VerifiesTheHashThenOpens_AndReturnsTheOriginalAsync}

The body store is pluggable, provider-backed, and long-lived, and it is frequently a different trust domain from the broker. The bodies that reach it are by definition the largest messages a system produces. With a cipher configured (`MessageBodyOffloadOptions.CipherName`), the upload call receives sealed bytes. The store cannot receive plaintext, because sealing happens inside the offload path before the upload is made, not in a hook slot that ordering may or may not place first. A sender that names a `CipherName` with no cipher registered under it fails loudly before any upload.

### Two checks, in the safe order

`MessageBodyClaim.ContentHash` stays a hash of the **stored** bytes. The receiver verifies the download against the hash first, and only then hands the bytes to the cipher, so nothing unverified reaches the cipher. The authenticated cipher then covers the plaintext. A tampered blob dead-letters on the hash before the cipher runs, and the existing dead-letter path is unchanged. {verified: BodyOffloadCipherTests.Rehydrate_TamperedStoredBytes_DeadLettersOnTheHash_BeforeTheCipherRunsAsync}

### The built-in cipher
{verified: AesGcmEnvelopeCipherTests.Seal_ThenOpen_ReturnsTheOriginalBodyAsync, AesGcmEnvelopeCipherTests.Open_UnderADifferentKeyEncryptionKey_ThrowsAsync}

`AesGcmEnvelopeCipher` is AES-256-GCM with envelope encryption:

- Every body gets a fresh 32-byte data key and a fresh 12-byte nonce.
- The data key is wrapped by an `IMessageBodyKeyWrapper` holding a key encryption key the store never holds, and it travels on the claim only in wrapped form.
- The stored bytes are the ciphertext followed by the 16-byte authentication tag. The per-body size overhead is that tag.
- The cipher name and the key identifier are bound into the tag as associated data, so a sealed body cannot be replayed under a different cipher registration or key label.

What travels on the claim is a `MessageBodyCipherDescriptor` in `MessageBodyClaim.Cipher`: the cipher name, the algorithm (`AES-256-GCM`), the key id (a vault key URI or a rotation label), the nonce, and the wrapped data key. Never a key. An operator with read access to the container, a snapshot, or the account key sees ciphertext and a wrapped key they cannot unwrap. Destroying or rotating the key encryption key makes every body sealed under it unreadable, whether or not the blob was ever deleted. A claim without a descriptor downloads exactly as before, so existing bodies and stores are unaffected. {verified: AesGcmEnvelopeCipherTests.Descriptor_NamesTheCipherAlgorithmAndKey_AndNeverHoldsTheKeyAsync, BodyOffloadCipherTests.Claim_WithoutADescriptor_DeserializesFromTheOldShapeAsync}

### Registering the cipher on both sides

The cipher is resolved by name on both sides, the same way the body store is resolved by provider name. The sender names it in `MessageBodyOffloadOptions.CipherName`. Every receiver that rehydrates its claims registers the same cipher name over the same key encryption key, or it dead-letters the claim with `MessageFailureReason.BodyClaimCipherUnknown`. A wrong or rotated key fails to open, and the receiver dead-letters as an integrity failure with a description that names the cipher and the key id. {verified: BodyOffloadCipherTests.Rehydrate_CipherNotRegisteredOnTheReceiver_DeadLettersAsCipherUnknownAsync, BodyOffloadCipherTests.Rehydrate_WrongKeyOnTheReceiver_DeadLettersAsIntegrityFailure_NamingTheKeyAsync}

Three registrations exist:

- `AddWhizbangMessageBodyCipher<TCipher>(name)` registers any `IMessageBodyCipher` implementation as a keyed singleton.
- `AddWhizbangAesGcmBodyCipher(name, keyId, keyEncryptionKey)` registers the built-in cipher over a 32-byte key encryption key the host supplies (`LocalAesKeyWrapper`). Suitable for development and for hosts that manage their own key material.
- `AddWhizbangAesGcmBodyCipher(name, sp => wrapper)` registers the built-in cipher over a key wrapper built from the container. This is how a vault-backed wrapper keeps the key encryption key out of the process entirely.

The key never comes from source. Read it from the host's secret store:

```csharp{
title: "Register the AES-256-GCM body cipher on the sender and the receiver"
description: "Both sides register the same cipher name over the same key encryption key, read from the host's secret store; the sender additionally names the cipher in MessageBodyOffloadOptions so every offloaded body is sealed before upload."
framework: "NET10"
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "claim-check", "encryption", "aes-gcm", "envelope-encryption", "dependency-injection"]
tests: ["BodyOffloadCipherTests.AddWhizbangAesGcmBodyCipher_ResolvesByName_WithTheContainerBuiltWrapperAsync", "BodyOffloadCipherTests.Hook_WithACipher_UploadsSealedBytes_NeverThePlaintextAsync", "BodyOffloadCipherTests.Rehydrate_SealedBody_VerifiesTheHashThenOpens_AndReturnsTheOriginalAsync"]
}
// The key encryption key is 32 bytes, base64 in the host's secret store; never a literal in source.
var keyEncryptionKey = Convert.FromBase64String(
  builder.Configuration["Offload:BodyKeyEncryptionKey"]
    ?? throw new InvalidOperationException("Offload:BodyKeyEncryptionKey is not configured"));

// Sender: seal every offloaded body before it is uploaded.
services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => { /* … */ });
services.AddWhizbangAesGcmBodyCipher("body-aes-v1", keyId: "kek-v1", keyEncryptionKey);
services.AddWhizbangBodyOffload();

services.Configure<MessageBodyOffloadOptions>(opts => {
  opts.ProviderName = "azure-blob-prod";
  opts.CipherName   = "body-aes-v1";   // null (the default) stores bodies as serialized
});

// Receiver: the same provider name and the same cipher name, over the same key.
services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => { /* … */ });
services.AddWhizbangAesGcmBodyCipher("body-aes-v1", keyId: "kek-v1", keyEncryptionKey);
```

A vault-backed wrapper implements `IMessageBodyKeyWrapper`. The key encryption key never leaves the vault; the process only ever sees per-body data keys, and it zeroes those after use:

```csharp{
title: "A vault-backed IMessageBodyKeyWrapper"
description: "Wraps and unwraps per-body data keys through the host's key service so the key encryption key never enters the process; an unknown or retired key surfaces as a CryptographicException, which the receiver dead-letters as an integrity failure."
framework: "NET10"
category: "Offloads"
difficulty: "ADVANCED"
tags: ["body-offload", "encryption", "envelope-encryption", "key-wrapper", "key-vault"]
unverified: "illustrative vault-backed wrapper over a host-specific key client; the IMessageBodyKeyWrapper contract is exercised through LocalAesKeyWrapper in AesGcmEnvelopeCipherTests"
}
public sealed class VaultKeyWrapper : IMessageBodyKeyWrapper {
  private readonly IKeyVaultClient _vault;   // the host's key service client

  public VaultKeyWrapper(IKeyVaultClient vault, string keyId) {
    _vault = vault;
    KeyId = keyId;   // a key URI or a rotation label; recorded on the claim, never the key
  }

  public string KeyId { get; }

  public async ValueTask<ReadOnlyMemory<byte>> WrapAsync(
      ReadOnlyMemory<byte> dataKey, CancellationToken cancellationToken = default) =>
    await _vault.WrapKeyAsync(KeyId, dataKey, cancellationToken);

  public async ValueTask<ReadOnlyMemory<byte>> UnwrapAsync(
      ReadOnlyMemory<byte> wrappedDataKey, string keyId, CancellationToken cancellationToken = default) {
    // Unwrap under the key the CLAIM names, so a body sealed before a rotation still opens
    // while the old key exists, and fails as CryptographicException once it is destroyed.
    try {
      return await _vault.UnwrapKeyAsync(keyId, wrappedDataKey, cancellationToken);
    } catch (KeyNotFoundException ex) {
      throw new CryptographicException($"Key '{keyId}' is unknown or retired.", ex);
    }
  }
}

services.AddWhizbangAesGcmBodyCipher("body-aes-v1",
  sp => new VaultKeyWrapper(sp.GetRequiredService<IKeyVaultClient>(), "https://vault.example/keys/body-kek"));
```

### Configuring the cipher from settings {#cipher-from-settings}
{verified: BodyCipherFromConfigurationTests.WithANameAndAKey_RegistersTheAesGcmCipherByName_AndNamesItOnTheOptionsAsync, BodyCipherFromConfigurationTests.WithoutACipherName_RegistersNoCipher_AndLeavesTheOptionsAloneAsync, AzureBlobOffloadFromConfigurationTests.FromConfiguration_WithACipherInSettings_BindsTheCipherName_AndRegistersTheCipherAsync}

Hosts that register offloads from configuration (`AddWhizbangAzureBlobOffloadsFromConfiguration`) get the built-in cipher from the same settings, with no consumer code. `AddWhizbangBodyCipherFromConfiguration` reads the `Whizbang:BodyOffload` section, registers `AesGcmEnvelopeCipher` under the configured name, and names it on `MessageBodyOffloadOptions` so the send side seals. Without a cipher name, nothing is registered and bodies are stored as serialized, exactly as before.

| Setting | Environment variable form | Value |
|---|---|---|
| `Whizbang:BodyOffload:CipherName` | `Whizbang__BodyOffload__CipherName` | The cipher's name, recorded on every claim; for example `body-aes-v1`. Not a secret. |
| `Whizbang:BodyOffload:Cipher:KeyId` | `Whizbang__BodyOffload__Cipher__KeyId` | The rotation label of the current key encryption key, recorded on every claim; for example `kek-2026-09`. Not a secret. |
| `Whizbang:BodyOffload:Cipher:KeyEncryptionKey` | `Whizbang__BodyOffload__Cipher__KeyEncryptionKey` | The current key encryption key: 32 bytes, base64 (44 characters). A secret. |
| `Whizbang:BodyOffload:Cipher:PreviousKeyId` | `Whizbang__BodyOffload__Cipher__PreviousKeyId` | During a rotation window, the label of the key being retired. Not a secret. |
| `Whizbang:BodyOffload:Cipher:PreviousKeyEncryptionKey` | `Whizbang__BodyOffload__Cipher__PreviousKeyEncryptionKey` | During a rotation window, the key being retired, same form as the current one. A secret. |

Misconfiguration fails at startup and names the setting, because a cipher that silently did not engage would store plaintext under a sealed label:

- A cipher name without a key, or without a key id, throws. {verified: BodyCipherFromConfigurationTests.WithANameButNoKey_ThrowsAtStartup_NamingTheSettingAsync, BodyCipherFromConfigurationTests.WithANameAndAKeyButNoKeyId_ThrowsAtStartup_NamingTheSettingAsync}
- A key that is not base64, or not 32 bytes once decoded, throws. {verified: BodyCipherFromConfigurationTests.WithAKeyThatIsNotBase64OrNot32Bytes_ThrowsAtStartup_NamingTheSettingAsync}
- A previous key id without the previous key, or the reverse, throws. {verified: BodyCipherFromConfigurationTests.WithAPreviousKeyId_ButNoPreviousKey_ThrowsAtStartupAsync, RotatingAesKeyWrapperTests.Constructor_RejectsHalfAWindow_AndTheSameIdForBothKeysAsync}

#### Rotating the key
{verified: BodyCipherFromConfigurationTests.WithAPreviousKey_OpensABodySealedUnderThePreviousKeyId_AndSealsUnderTheCurrentAsync, BodyCipherFromConfigurationTests.AfterTheWindow_ABodySealedUnderTheRetiredKey_FailsToOpenAsync, RotatingAesKeyWrapperTests.KeyId_IsTheCurrentKeyId_AndWrap_UsesTheCurrentKeyAsync, RotatingAesKeyWrapperTests.Unwrap_UnderThePreviousKeyId_UsesThePreviousKeyAsync, RotatingAesKeyWrapperTests.Unwrap_UnderAnUnknownKeyId_ThrowsCryptographicAsync}

The key id is bound into every sealed body, so a body sealed under one label opens only under that label. `RotatingAesKeyWrapper` seals under the current key and opens under either the current or the previous key, chosen by the key id the claim names. A rotation is three settings changes, in this order:

1. Move the current key and its label to `PreviousKeyId` and `PreviousKeyEncryptionKey`, and put the new key and its new label in `KeyId` and `KeyEncryptionKey`. Roll every sending and receiving service. New bodies seal under the new label; bodies already sealed still open.
2. Wait until no body sealed under the old label remains: the passive expiry (`PassiveExpiry`, 30 days by default) is the upper bound, and active cleanup shortens it.
3. Remove the two previous-key settings and roll again. A body sealed under the retired label now fails to open and dead-letters as an integrity failure, which is the intended outcome for anything that outlived the window.

#### Operations checklist {#cipher-operations}

For the team that owns secrets and deployments. Nothing here requires a code change on the consumer.

1. Generate the key encryption key once: `openssl rand -base64 32`. Store it in the secret store the services already read from.
2. Provide the three settings to every service that sends or receives offloaded bodies, using the same value of each on all of them. A service without the key, or with a different one, dead-letters the claim instead of reading it; a service with a different cipher name dead-letters it as `BodyClaimCipherUnknown`.
3. Keep the two labels stable. They are recorded on every claim; changing a label without changing the key is a rotation with no new key and breaks bodies already sealed.
4. Plan the rotation window above before the first rotation, and keep the previous key available until the window has drained.
5. The blob container needs nothing new. The store keeps receiving bytes; they are ciphertext now. An operator with read access to the container, a snapshot, or the account key sees ciphertext and a wrapped key they cannot unwrap.

```json{
title: "The five cipher settings, as environment variables"
description: "The complete operator-side configuration for the built-in cipher during a rotation window; outside a window the two previous-key entries are absent."
category: "Offloads"
difficulty: "BEGINNER"
tags: ["body-offload", "encryption", "configuration", "key-rotation", "operations"]
}
{
  "Whizbang__BodyOffload__CipherName": "body-aes-v1",
  "Whizbang__BodyOffload__Cipher__KeyId": "kek-2026-09",
  "Whizbang__BodyOffload__Cipher__KeyEncryptionKey": "<44 base64 characters from the secret store>",
  "Whizbang__BodyOffload__Cipher__PreviousKeyId": "kek-2026-08",
  "Whizbang__BodyOffload__Cipher__PreviousKeyEncryptionKey": "<the key being retired>"
}
```

What is tested and working: the built-in AES-256-GCM cipher (seal, open, tamper detection, wrong key, wrong key id, wrong cipher name, wrong algorithm), the local key wrapper, the rotating key wrapper, registration by name from code and from settings, every startup validation above, and the end-to-end path through the offload hook and the rehydrator. What is not in the library: a vault-backed key wrapper; the example above is illustrative, and a host that needs the key encryption key to stay in a vault writes that wrapper against `IMessageBodyKeyWrapper`.

## Active cleanup

By default (`ActiveCleanup = false`), Whizbang relies on the provider's storage-level TTL (e.g., Azure blob lifecycle rules) to remove offloaded bodies. Simplest, safest in fan-out subscriber topologies.

When `ActiveCleanup = true`, the consumer worker fires `IMessageBodyStore.DeleteAsync(claim)` **after the inbox row commits**, in a fresh DI scope, fire-and-forget. A failed inbox INSERT never deletes a body that's still needed for redelivery. The provider's `MessageBodyDeleteOptions.IgnoreMissing` (default `true`) absorbs fan-out double-delete races; provider TTL is the backstop on transient delete failures.

## Built-in providers

- **`Whizbang.Offloads.InMemory`** — dev/test/fixture provider. Bodies live in a process-local `ConcurrentDictionary`. Not suitable for production: bodies don't cross processes, no durability. Mirrors the in-process transport (`InProcessTransport`) in role: a process-local stand-in for dev/test.
- **`Whizbang.Offloads.AzureBlob`** — production provider. Wraps `Azure.Storage.Blobs`. Works identically against the Azurite emulator and live Azure Blob; the connection string distinguishes them via standard Azure SDK conventions. Supports optional Hot/Cool/Cold/Archive access tiers and a defensive `MaxDownloadBytes` cap.

Custom providers implement `IMessageBodyStore` and register via `AddWhizbangMessageBodyStore<TStore>(name)`. The interface is three storage methods (`UploadAsync`, `DownloadAsync`, `DeleteAsync`), each accepting an optional per-call options record so providers can expose features like custom metadata, container overrides, or per-blob TTL without bloating the core contract, plus a default-implemented `CheckConnectivityAsync` reachability probe (returns `true` unless a remote provider overrides it) used by the managed-resource health model.

## Failure semantics

| Failure mode | Reason code | Behavior |
|---|---|---|
| Body exceeds transport ceiling AND no offload hook configured | `MessageFailureReason.MessageBodyTooLarge` | `TransportPublishStrategy` returns `Success=false` pre-flight; outbox row stays put. |
| Receiver doesn't have the sender's `whizbang.body-store` provider registered | `MessageFailureReason.BodyClaimProviderUnknown` | Terminal — logged (with remediation pointer at `AddWhizbang*Offload(name)`) and discarded. |
| Body download fails transiently or exceeds `DownloadTimeout` | — (`BodyClaimDownloadException`) | **Retryable** — transport redelivery, not immediate dead-letter; DLQ only after the transport's max-delivery count is exhausted. |
| Downloaded body's SHA-256 doesn't match `claim.ContentHash` | `MessageFailureReason.BodyClaimIntegrityFailure` | Terminal — refuses to process potentially-tampered payload; logged and discarded. |
| Sender names a `MessageBodyOffloadOptions.CipherName` with no cipher registered under it | (`InvalidOperationException` from the offload hook) | Publish-side: fails loudly before any upload, so nothing reaches the store in the clear. {verified: BodyOffloadCipherTests.Hook_CipherNamedButNotRegistered_FailsLoudlyBeforeUploadingAsync} |
| Receiver doesn't have the claim's cipher name registered | `MessageFailureReason.BodyClaimCipherUnknown` | Terminal, logged (with remediation pointer at `AddWhizbangMessageBodyCipher` / `AddWhizbangAesGcmBodyCipher`) and discarded. {verified: BodyOffloadCipherTests.Rehydrate_CipherNotRegisteredOnTheReceiver_DeadLettersAsCipherUnknownAsync} |
| Sealed body doesn't authenticate under the descriptor's key (wrong or rotated key encryption key, altered descriptor) | `MessageFailureReason.BodyClaimIntegrityFailure` | Terminal; the description names the cipher and key id and states that the storage matched the hash; logged and discarded. {verified: BodyOffloadCipherTests.Rehydrate_WrongKeyOnTheReceiver_DeadLettersAsIntegrityFailure_NamingTheKeyAsync} |
| No `JsonTypeInfo` registered for `claim.OriginalTypeName` | `MessageFailureReason.SerializationError` | Terminal — logged and discarded; consumer needs the type registered in a `JsonSerializerContext`. |

## Composite events + body offload

The body-offload pattern pairs particularly well with [composite events](/docs/fundamentals/messaging/composite-events): a 5,000-inner-event composite easily exceeds the 256 KB Azure Service Bus Standard ceiling. With body offload configured, the composite envelope's serialized form auto-uploads to blob storage and a small claim envelope flows on the wire. The receiver rehydrates, expands the composite into N inner events, and proceeds normally — fan-out + claim-check working transparently together.
