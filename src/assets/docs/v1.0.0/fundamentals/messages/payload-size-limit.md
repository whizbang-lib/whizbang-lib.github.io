---
title: Payload Size Limit
pageType: concept
version: 1.0.0
category: Core Concepts
order: 12
description: >-
  Whizbang refuses a message whose serialized payload is over a configurable limit (5 MiB by default)
  before it is stored or sent, with an exception carrying an error code, both sizes and guidance, and
  hooks for end-user feedback and validation.
tags: 'payload, size, limit, MaxPayloadSize, MessagePayloadTooLargeException, WHIZ-PAYLOAD-TOO-LARGE, hooks, fan-out, fan-in'
codeReferences:
  - src/Whizbang.Core/Messaging/MessagePayloadLimits.cs
  - src/Whizbang.Core/Messaging/MessagePayloadSize.cs
  - src/Whizbang.Core/Messaging/MessagePayloadTooLargeException.cs
  - src/Whizbang.Core/Messaging/MessagePayloadSizeServiceCollectionExtensions.cs
  - src/Whizbang.Core/Attributes/MaxPayloadSizeAttribute.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Dispatch/DispatchOptions.cs
---

# Payload Size Limit

Every service that receives a message holds its whole payload in memory, usually several times over: the
envelope, the deserialized object, and whatever read model is built from it. A single message of tens of
megabytes can therefore exhaust the memory of every consumer that receives it, and because a failed message
is retried, it does so again and again.

Whizbang measures each message where the dispatcher serializes it for the outbox and refuses one that is over
the limit. The message is never stored or sent, and the caller gets a
`MessagePayloadTooLargeException`.

## The default

The limit is **5 MiB** of serialized payload, measured in UTF-8 bytes (what is stored and transmitted), not
characters. It is set on the core options:

```csharp{title="Setting the limit" description="Changes the framework-wide limit" category="Configuration" difficulty="BEGINNER" tags=["payload", "limit"]}
services.AddWhizbang(options => {
  options.MaxMessagePayloadBytes = 2 * 1024 * 1024;   // 2 MiB
  options.MessagePayloadWarningRatio = 0.75;          // log at 75% of the limit
});
```

Null or zero turns the limit off. A payload at or above `MessagePayloadWarningRatio` of its limit (0.8 by
default) is logged as a warning without being rejected, so growth is visible before anything breaks.

## Overriding the limit

The limit that applies to a message is the first of these that is set:

1. **The call's own**: `DispatchOptions.WithMaxPayloadBytes(n)`.
2. **The message type's**: `[MaxPayloadSize(n)]` on the type or a base type.
3. **The framework default**: `WhizbangCoreOptions.MaxMessagePayloadBytes`.

Zero or less at any level turns the limit off at that level.

```csharp{title="Per-type and per-call limits" description="A type that is legitimately large, and one call that needs more room" category="Usage" difficulty="INTERMEDIATE" tags=["payload", "MaxPayloadSize", "DispatchOptions"]}
[MaxPayloadSize(20 * 1024 * 1024)]
public record DocumentImported([property: StreamId] Guid DocumentId, string Body) : IEvent;

await dispatcher.SendAsync(command, new DispatchOptions().WithMaxPayloadBytes(8 * 1024 * 1024));
```

`[MaxPayloadSize]` is read at compile time into the message-type catalog, so no reflection is involved. The
per-call limit applies where the message is produced; it does not travel with the message.

## The exception

`MessagePayloadTooLargeException` carries everything a caller, a log or a user interface needs:

| Property | Meaning |
|---|---|
| `ErrorCode` | `WHIZ-PAYLOAD-TOO-LARGE`, or the application's own code when a hook supplied one |
| `UserMessage` | A message for the end user, when a hook supplied one |
| `MessageType`, `MessageId`, `StreamId` | Which message |
| `PayloadBytes`, `LimitBytes` | Its size and the limit it broke |
| `LimitSource` | `Default`, `MessageType` or `Call` |

Its `Message` names the fix, because raising the limit is almost never it:

- **Fan out.** Split the work into one message per item, so each consumer handles a bounded amount at a time
  and the items spread across instances.
- **Fan in.** Batch items into [composite messages](../messaging/composite-events) of a bounded size, so
  transport overhead stays low without any one message growing with the data.
- **Send a reference.** Store the body elsewhere and send its identifier.

## Hooks {#hooks}

A hook sees every message whose payload crosses the warning threshold or the limit, before the framework
decides. Use one to turn the failure into feedback for the person who caused it, to validate earlier than the
limit does, or to record sizes.

```csharp{title="A payload-size hook" description="Rejects large imports with a message for the end user" category="Usage" difficulty="INTERMEDIATE" tags=["payload", "hooks", "validation"]}
public sealed class ImportSizeHook : IMessagePayloadSizeHook {
  public MessagePayloadSizeDecision Evaluate(MessagePayloadSizeContext context) =>
    context.MessageType.Contains("Import", StringComparison.Ordinal)
      ? MessagePayloadSizeDecision.Reject("Import fewer rows at a time.", "IMPORT-TOO-LARGE")
      : MessagePayloadSizeDecision.NoOpinion;
}

services.AddMessagePayloadSizeHook<ImportSizeHook>();
```

A hook returns one of three decisions:

- **`NoOpinion`**: the limit decides.
- **`Allow()`**: accept this message even though it is over the limit. The framework logs that it did.
- **`Reject(userMessage, errorCode)`**: refuse it, even under the limit, with a message for the end user and
  optionally the application's own error code.

Every registered hook sees the message. A rejection from any hook wins over an allowance from another.
`MessagePayloadSizeContext.OverLimit` tells a hook whether the payload is over the limit or only past the
warning threshold.

## When a handler produced the message

A handler that dispatches an oversized message fails with the same exception. The inbox row it was handling
is recorded with the failure reason `MessagePayloadTooLarge` and the `WHIZ-PAYLOAD-TOO-LARGE` code in its
error text, so the stored message says why it failed. If it reaches the dead-letter store, recovery holds it
for review rather than re-driving it: the same message produces the same bytes every time, and the fix is in
the handler.

## See also

- [Composite events](../messaging/composite-events): bounded batches for fan-in
- [Dead-letter recovery](../../operations/dead-letter-queue/recovery)
