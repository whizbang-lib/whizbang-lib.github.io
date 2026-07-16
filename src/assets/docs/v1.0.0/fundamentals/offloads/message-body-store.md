---
title: Body Offload (Claim-Check Pattern)
pageType: concept
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  Transparent claim-check pattern for messages that exceed transport
  wire-size ceilings — upload the body to a registered IMessageBodyStore,
  send a small claim envelope on the wire, rehydrate on receive.
tags: 'offload, claim-check, messaging, transports, body-size'
codeReferences:
  - src/Whizbang.Core/Offloads/IMessageBodyStore.cs
  - src/Whizbang.Core/Offloads/MessageBodyClaim.cs
  - src/Whizbang.Core/Offloads/BodyClaimEnvelopePayload.cs
  - src/Whizbang.Core/Offloads/MessageBodyOffloadOptions.cs
  - src/Whizbang.Core/Offloads/IPostSerializeHook.cs
  - src/Whizbang.Core/Offloads/PostSerializeHookChain.cs
  - src/Whizbang.Core/Offloads/BodyOffloadPostSerializeHook.cs
  - src/Whizbang.Core/Offloads/BodyClaimWireHelper.cs
  - src/Whizbang.Core/Offloads/BodyClaimRehydrator.cs
  - src/Whizbang.Core/Offloads/OffloadServiceCollectionExtensions.cs
  - src/Whizbang.Offloads.InMemory/InMemoryMessageBodyStore.cs
  - src/Whizbang.Offloads.AzureBlob/AzureBlobMessageBodyStore.cs
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
2. Otherwise: resolve the matching `IMessageBodyStore` by claim provider name. Unknown provider → dead-letter with `MessageFailureReason.BodyClaimProviderUnknown`.
3. Download the bytes; compute SHA-256; compare against `claim.ContentHash`. Mismatch → dead-letter with `MessageFailureReason.BodyClaimIntegrityFailure`.
4. Deserialize the downloaded bytes as the original envelope type from `claim.OriginalTypeName`. No JsonTypeInfo → dead-letter with `MessageFailureReason.SerializationError`.
5. Return the rehydrated envelope. The worker treats it as if no claim ever existed.

## Active cleanup

By default (`ActiveCleanup = false`), Whizbang relies on the provider's storage-level TTL (e.g., Azure blob lifecycle rules) to remove offloaded bodies. Simplest, safest in fan-out subscriber topologies.

When `ActiveCleanup = true`, the consumer worker fires `IMessageBodyStore.DeleteAsync(claim)` **after the inbox row commits**, in a fresh DI scope, fire-and-forget. A failed inbox INSERT never deletes a body that's still needed for redelivery. The provider's `MessageBodyDeleteOptions.IgnoreMissing` (default `true`) absorbs fan-out double-delete races; provider TTL is the backstop on transient delete failures.

## Built-in providers

- **`Whizbang.Offloads.InMemory`** — dev/test/fixture provider. Bodies live in a process-local `ConcurrentDictionary`. Not suitable for production: bodies don't cross processes, no durability. Mirrors `Whizbang.Transports.InMemory` in role.
- **`Whizbang.Offloads.AzureBlob`** — production provider. Wraps `Azure.Storage.Blobs`. Works identically against the Azurite emulator and live Azure Blob; the connection string distinguishes them via standard Azure SDK conventions. Supports optional Hot/Cool/Cold/Archive access tiers and a defensive `MaxDownloadBytes` cap.

Custom providers implement `IMessageBodyStore` and register via `AddWhizbangMessageBodyStore<TStore>(name)`. The interface is three methods (`UploadAsync`, `DownloadAsync`, `DeleteAsync`), each accepting an optional per-call options record so providers can expose features like custom metadata, container overrides, or per-blob TTL without bloating the core contract.

## Failure semantics

| Failure mode | Reason code | Behavior |
|---|---|---|
| Body exceeds transport ceiling AND no offload hook configured | `MessageFailureReason.MessageBodyTooLarge` | `TransportPublishStrategy` returns `Success=false` pre-flight; outbox row stays put. |
| Receiver doesn't have the sender's `whizbang.body-store` provider registered | `MessageFailureReason.BodyClaimProviderUnknown` | Dead-letter with remediation pointer at `AddWhizbang*Offload(name)`. |
| Downloaded body's SHA-256 doesn't match `claim.ContentHash` | `MessageFailureReason.BodyClaimIntegrityFailure` | Dead-letter; refuses to process potentially-tampered payload. |
| No `JsonTypeInfo` registered for `claim.OriginalTypeName` | `MessageFailureReason.SerializationError` | Dead-letter; consumer needs the type registered in a `JsonSerializerContext`. |

## Composite events + body offload

The body-offload pattern pairs particularly well with [composite events](/docs/fundamentals/messaging/composite-events): a 5,000-inner-event composite easily exceeds the 256 KB Azure Service Bus Standard ceiling. With body offload configured, the composite envelope's serialized form auto-uploads to blob storage and a small claim envelope flows on the wire. The receiver rehydrates, expands the composite into N inner events, and proceeds normally — fan-out + claim-check working transparently together.
