---
title: Custom Serializers
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 7
description: >-
  Implement custom message serializers for MessagePack or custom binary
  formats via IMessageSerializer - AOT-compatible patterns
tags: 'serialization, imessageserializer, messagepack, aot, json'
codeReferences:
  - src/Whizbang.Core/Transports/IMessageSerializer.cs
  - src/Whizbang.Core/Transports/JsonMessageSerializer.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
testReferences:
  - tests/Whizbang.Transports.Tests/IMessageSerializerTests.cs
  - tests/Whizbang.Transports.Tests/JsonMessageSerializerTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Serializers

**Custom serializers** enable alternative wire formats beyond JSON. Whizbang's extension point is `IMessageSerializer` (namespace `Whizbang.Core.Transports`), which serializes **entire message envelopes** - payload plus tracing metadata - for network transport.

:::note
Whizbang uses JSON by default via `JsonMessageSerializer`, backed by source-generated `JsonSerializerContext`s combined through `JsonContextRegistry` for AOT support. Custom serializers are for specialized scenarios requiring different formats.
:::

---

## The Extension Point: IMessageSerializer

```csharp{title="IMessageSerializer Interface" description="Envelope serialization extension point" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "IMessageSerializer", "Interface"]}
namespace Whizbang.Core.Transports;

public interface IMessageSerializer {
  // Serialize an envelope (payload + hops + IDs + metadata) to wire bytes
  Task<byte[]> SerializeAsync(IMessageEnvelope envelope);

  // Restore the envelope with a typed payload
  Task<IMessageEnvelope> DeserializeAsync<TMessage>(byte[] bytes) where TMessage : notnull;
}
```

**Contract**: implementations must preserve ALL envelope metadata, not just the payload:

- `MessageId`, `CorrelationId`, `CausationId`
- All `MessageHop`s (type, metadata, routing info, timestamps)
- Policy decision trails
- Security contexts
- Caller information

Built-in implementations:

| Implementation | Purpose |
|----------------|---------|
| `JsonMessageSerializer` | Default - System.Text.Json with a `JsonSerializerContext` or `JsonSerializerOptions` (AOT, zero reflection) |
| `InMemorySerializer` | In-process transport - skips real byte serialization |

---

## Why Custom Serializers?

| Scenario | JSON (Default) | Custom Serializer |
|----------|---------------|-------------------|
| **Human-Readable** | ✅ Perfect | No need |
| **Compact Binary** | ❌ Text overhead | ✅ Protobuf/MessagePack |
| **Schema Evolution** | ❌ Manual | ✅ Protobuf/Avro |
| **Cross-Language** | ✅ Universal | ✅ Protobuf |
| **Performance** | ✅ Fast enough | ✅ MessagePack faster |

**When to use custom serializers**:
- ✅ Extreme performance requirements
- ✅ Bandwidth constraints (IoT, mobile)
- ✅ Schema evolution needs
- ✅ Cross-language interop (gRPC)

---

## The Default: AOT-Compatible JSON

Before writing a custom serializer, note that the default is already pluggable. `JsonMessageSerializer` takes either a `JsonSerializerContext` or a `JsonSerializerOptions` with a `TypeInfoResolver`:

```csharp{title="Configuring JsonMessageSerializer" description="AOT-compatible JSON with combined contexts" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "JSON", "AOT"]}
using Whizbang.Core.Serialization;
using Whizbang.Core.Transports;

// JsonContextRegistry combines every registered JsonSerializerContext
// (framework packages + your generated message contexts register
// themselves via [ModuleInitializer])
JsonSerializerOptions options = JsonContextRegistry.CreateCombinedOptions();

var serializer = new JsonMessageSerializer(options);
```

If your goal is only to make new payload types serializable, register their generated context with `JsonContextRegistry.RegisterContext(...)` - no custom serializer needed.

---

## MessagePack Envelope Serializer

### Pattern: Custom Binary Format

A custom serializer owns the full envelope round-trip. The simplest robust approach is to define a wire DTO carrying the envelope fields your transport needs, and let MessagePack handle the bytes:

```csharp{title="MessagePack Envelope Serializer" description="Custom binary IMessageSerializer implementation" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "MessagePack"]}
using MessagePack;
using Whizbang.Core.Observability;
using Whizbang.Core.Transports;

public class MessagePackMessageSerializer : IMessageSerializer {
  private static readonly MessagePackSerializerOptions Options =
    MessagePackSerializerOptions.Standard
      .WithResolver(MessagePack.Resolvers.ContractlessStandardResolver.Instance);

  public Task<byte[]> SerializeAsync(IMessageEnvelope envelope) {
    // Map the envelope (MessageId, payload, hops, correlation/causation,
    // security context, ...) onto your wire DTO, then serialize.
    var wireDto = EnvelopeWireDto.FromEnvelope(envelope);
    var bytes = MessagePackSerializer.Serialize(wireDto, Options);
    return Task.FromResult(bytes);
  }

  public Task<IMessageEnvelope> DeserializeAsync<TMessage>(byte[] bytes) where TMessage : notnull {
    var wireDto = MessagePackSerializer.Deserialize<EnvelopeWireDto>(bytes, Options);
    // Rebuild MessageEnvelope<TMessage> from the DTO - every hop,
    // ID, and metadata entry must survive the round-trip.
    return Task.FromResult(wireDto.ToEnvelope<TMessage>());
  }
}
```

:::warning
The hard part of a custom serializer is not the payload - it is faithfully round-tripping the envelope: hops, policy trails, and security contexts. Run your implementation against the same contract tests the built-in serializers use (`IMessageSerializerTests` covers MessageId, payload, hops, correlation/causation, metadata, topic/stream/partition, sequence number, and timestamp preservation).
:::

:::note
For AOT deployments, MessagePack's `ContractlessStandardResolver` uses runtime reflection - use MessagePack's source generator (`[MessagePackObject]` attributes + `GeneratedMessagePackResolver`) instead when compiling with Native AOT.
:::

---

## Protobuf for Payloads

Protobuf shines for **cross-language payload contracts** (gRPC-style). Protobuf messages (`IMessage<T>`) serialize AOT-safely:

```csharp{title="Protobuf Payload Helpers" description="Protobuf payload serialization building blocks" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Protobuf"]}
using Google.Protobuf;

public static class ProtobufPayload {
  public static byte[] Serialize<T>(T message) where T : IMessage<T> {
    return message.ToByteArray();  // AOT-safe
  }

  public static T Deserialize<T>(byte[] data) where T : IMessage<T>, new() {
    var parser = new MessageParser<T>(() => new T());
    return parser.ParseFrom(data);  // AOT-safe
  }
}
```

To use Protobuf on the wire end-to-end, embed these helpers inside an `IMessageSerializer` implementation as shown in the MessagePack pattern - the envelope structure itself still needs to be encoded (e.g., as a Protobuf message with a `bytes payload` field).

---

## Registering a Custom Serializer

Transports resolve `IMessageSerializer` from DI. Register your implementation before the transport packages add their default:

```csharp{title="Serializer Registration" description="Swap the message serializer in DI" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Registration", "DI"]}
builder.Services.AddSingleton<IMessageSerializer, MessagePackMessageSerializer>();
```

:::warning
Every service exchanging messages must use a compatible serializer - a MessagePack producer cannot talk to a JSON consumer. Roll out format changes with a compatibility window or a separate topic.
:::

---

## Further Reading

**Source Generators**:
- [JSON Contexts](../source-generators/json-contexts.md) - AOT-compatible JSON

**Extensibility**:
- [Custom Transports](custom-transports.md) - Where serializers plug in

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
