---
title: Envelope Serialization
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 23
description: >-
  EnvelopeSerializer and SerializedEnvelope for AOT-compatible envelope serialization in Whizbang.
tags: 'envelope, serialization, aot, json'
codeReferences:
  - src/Whizbang.Core/Messaging/EnvelopeSerializer.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/EnvelopeSerializerTests.cs
lastMaintainedCommit: '01f07906'
---

# Envelope Serialization

The `EnvelopeSerializer` handles conversion between typed message envelopes and their serialized JSON form. It ensures AOT compatibility and proper type metadata preservation.

## Overview

When storing or transmitting envelopes, they need to be serialized to JSON. The serializer:

- **Preserves type metadata** before serialization
- **Converts to JsonElement** for storage
- **Restores typed messages** during deserialization
- **AOT compatible** - no runtime reflection

## EnvelopeSerializer {#envelopeserializer}

```csharp{title="EnvelopeSerializer" description="EnvelopeSerializer" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "EnvelopeSerializer", "Envelopeserializer"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync", "EnvelopeSerializerTests.SerializeEnvelope_CapturesCorrectTypeMetadataAsync"]}
namespace Whizbang.Core.Messaging;

/// <summary>
/// Centralizes envelope serialization/deserialization between typed and JsonElement forms.
/// Ensures envelope type metadata is correctly captured before serialization.
/// </summary>
public sealed class EnvelopeSerializer : IEnvelopeSerializer {
  private readonly JsonSerializerOptions _jsonOptions;

  public EnvelopeSerializer(JsonSerializerOptions? jsonOptions = null) {
    _jsonOptions = jsonOptions ?? new JsonSerializerOptions();
  }

  /// <summary>
  /// Serializes a typed envelope to JsonElement form for storage.
  /// Captures envelope and message type names before serialization.
  /// </summary>
  public SerializedEnvelope SerializeEnvelope<TMessage>(IMessageEnvelope<TMessage> envelope);

  /// <summary>
  /// Deserializes a message payload from a JsonElement envelope.
  /// </summary>
  public object DeserializeMessage(MessageEnvelope<JsonElement> jsonEnvelope, string messageTypeName);
}
```

## IEnvelopeSerializer Interface {#ienvelopeserializer}

```csharp{title="IEnvelopeSerializer Interface" description="IEnvelopeSerializer Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "IEnvelopeSerializer", "Interface"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync"]}
namespace Whizbang.Core.Messaging;

/// <summary>
/// Interface for envelope serialization/deserialization service.
/// </summary>
public interface IEnvelopeSerializer {
  /// <summary>
  /// Serializes a typed envelope to JsonElement form for storage.
  /// </summary>
  SerializedEnvelope SerializeEnvelope<TMessage>(IMessageEnvelope<TMessage> envelope);

  /// <summary>
  /// Deserializes a message payload from a JsonElement envelope.
  /// </summary>
  object DeserializeMessage(MessageEnvelope<JsonElement> jsonEnvelope, string messageTypeName);
}
```

## SerializedEnvelope {#serializedenvelope}

```csharp{title="SerializedEnvelope" description="SerializedEnvelope" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "SerializedEnvelope", "Serializedenvelope"] tests=["EnvelopeSerializerTests.SerializedEnvelope_RecordEquality_WorksCorrectlyAsync", "EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync"]}
namespace Whizbang.Core.Messaging;

/// <summary>
/// Result of envelope serialization containing JsonElement envelope and type metadata.
/// </summary>
/// <param name="JsonEnvelope">The serialized envelope with JsonElement payload</param>
/// <param name="EnvelopeType">Assembly-qualified name of the original typed envelope</param>
/// <param name="MessageType">Assembly-qualified name of the message payload type</param>
public sealed record SerializedEnvelope(
  MessageEnvelope<JsonElement> JsonEnvelope,
  string EnvelopeType,
  string MessageType
);
```

## Serialization Flow

```mermaid{caption="Envelope serialization flow — capture type metadata, serialize the payload to a JsonElement, then return a SerializedEnvelope." tests=["EnvelopeSerializerTests.SerializeEnvelope_CapturesCorrectTypeMetadataAsync", "EnvelopeSerializerTests.SerializeEnvelope_PayloadSerializesToValidJsonElementAsync", "EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync"]}
graph TB
    S1["1. Typed Envelope: MessageEnvelope&lt;OrderCreated&gt;<br/>serializer.SerializeEnvelope(envelope)"]
    S2["2. Capture Type Metadata<br/>EnvelopeType: &quot;MessageEnvelope&#96;1[[OrderCreated,...]], Whizbang.Core&quot;<br/>MessageType: &quot;MyApp.Events.OrderCreated, MyApp&quot;"]
    S3["3. Convert to JsonElement<br/>Serialize envelope to JSON<br/>Deserialize as MessageEnvelope&lt;JsonElement&gt;"]
    S4["4. Return SerializedEnvelope<br/>Contains JsonEnvelope + type metadata"]

    S1 --> S2 --> S3 --> S4

    style S1 fill:#fff3cd,stroke:#ffc107
    style S4 fill:#d4edda,stroke:#28a745
```

## Usage Examples

### Serializing for Storage

```csharp{title="Serializing for Storage" description="Serializing for Storage" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Serializing", "Storage"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync"]}
public class EventStore {
  private readonly IEnvelopeSerializer _serializer;

  public async Task StoreAsync<TMessage>(
      Guid streamId,
      MessageEnvelope<TMessage> envelope,
      CancellationToken ct = default) {

    // Serialize envelope to storage format
    var serialized = _serializer.SerializeEnvelope(envelope);

    // Store in database
    await _db.ExecuteAsync(
        """
        INSERT INTO events (stream_id, message_id, envelope_type, message_type, payload)
        VALUES (@StreamId, @MessageId, @EnvelopeType, @MessageType, @Payload::jsonb)
        """,
        new {
          StreamId = streamId,
          MessageId = envelope.MessageId.Value,
          EnvelopeType = serialized.EnvelopeType,
          MessageType = serialized.MessageType,
          Payload = JsonSerializer.Serialize(serialized.JsonEnvelope)
        },
        ct);
  }
}
```

### Deserializing from Storage

```csharp{title="Deserializing from Storage" description="Deserializing from Storage" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Deserializing", "Storage"]}
public async Task<object> LoadMessageAsync(Guid messageId) {
  var row = await _db.QuerySingleAsync<EventRow>(
      "SELECT * FROM events WHERE message_id = @MessageId",
      new { MessageId = messageId });

  // Parse stored JSON to JsonElement envelope
  var jsonEnvelope = JsonSerializer.Deserialize<MessageEnvelope<JsonElement>>(
      row.Payload,
      _jsonOptions);

  // Deserialize to original message type
  var message = _serializer.DeserializeMessage(
      jsonEnvelope!,
      row.MessageType);

  return message;
}
```

### Outbox Integration

```csharp{title="Outbox Integration" description="Outbox Integration" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Outbox", "Integration"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithValidEnvelope_ReturnsSerializedEnvelopeAsync"]}
public async Task WriteToOutboxAsync<TMessage>(
    MessageEnvelope<TMessage> envelope,
    CancellationToken ct = default) {

  var serialized = _serializer.SerializeEnvelope(envelope);

  await _coordinator.StoreOutboxMessagesAsync(
      [
        new OutboxMessage {
          MessageId = envelope.MessageId.Value,
          Envelope = serialized.JsonEnvelope,
          EnvelopeType = serialized.EnvelopeType,
          Metadata = new EnvelopeMetadata {
            MessageId = envelope.MessageId,
            Hops = envelope.Hops
          },
          IsEvent = true
        }
      ],
      partitionCount: 1,
      ct);
}
```

## Double Serialization Prevention

The serializer detects and prevents double serialization:

```csharp{title="Double Serialization Prevention" description="The serializer detects and prevents double serialization:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Double", "Serialization"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithJsonElementPayload_ThrowsInvalidOperationExceptionAsync"]}
// ❌ This will throw InvalidOperationException
var alreadySerialized = new MessageEnvelope<JsonElement>(...);
serializer.SerializeEnvelope(alreadySerialized);
// Error: "DOUBLE SERIALIZATION DETECTED: Payload is JsonElement..."
```

This prevents bugs where envelopes are accidentally serialized twice.

## AOT Compatibility

The serializer uses `JsonContextRegistry` for AOT-safe type resolution:

```csharp{title="AOT Compatibility" description="The serializer uses JsonContextRegistry for AOT-safe type resolution:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "AOT", "Compatibility"] tests=["EnvelopeSerializerTests.DeserializeMessage_WithUnknownTypeName_ThrowsInvalidOperationExceptionAsync"]}
public object DeserializeMessage(
    MessageEnvelope<JsonElement> jsonEnvelope,
    string messageTypeName) {

  var jsonElement = jsonEnvelope.Payload;

  // AOT-safe type resolution via registry (zero reflection)
  var jsonTypeInfo = JsonContextRegistry.GetTypeInfoByName(
      messageTypeName,
      _jsonOptions);

  if (jsonTypeInfo == null) {
    throw new InvalidOperationException(
        $"Failed to resolve message type '{messageTypeName}'. " +
        $"Ensure the assembly is loaded and registered.");
  }

  return jsonElement.Deserialize(jsonTypeInfo)!;
}
```

Types are registered via `[ModuleInitializer]` in generated code.

## Error Handling

### Type Resolution Failure

```csharp{title="Type Resolution Failure" description="Type Resolution Failure" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Type", "Resolution"] tests=["EnvelopeSerializerTests.DeserializeMessage_WithUnknownTypeName_ThrowsInvalidOperationExceptionAsync"]}
try {
  var message = serializer.DeserializeMessage(jsonEnvelope, messageTypeName);
} catch (InvalidOperationException ex) {
  // "Failed to resolve message type 'MyApp.Events.OldEvent'..."
  _logger.LogError(ex, "Cannot deserialize unknown message type");
}
```

### Serialization Failure

```csharp{title="Serialization Failure" description="Serialization Failure" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Serialization", "Failure"] tests=["EnvelopeSerializerTests.SerializeEnvelope_WithJsonElementPayload_ThrowsInvalidOperationExceptionAsync"]}
try {
  var serialized = serializer.SerializeEnvelope(envelope);
} catch (InvalidOperationException ex) {
  // "DOUBLE SERIALIZATION DETECTED..." or
  // "Envelope type must have an assembly-qualified name..."
  _logger.LogError(ex, "Envelope serialization failed");
}
```

## Best Practices

### DO

- **Use IEnvelopeSerializer** instead of direct JSON serialization
- **Store type metadata** alongside serialized payload
- **Register message types** via JsonContextRegistry
- **Handle deserialization failures** gracefully

### DON'T

- **Don't serialize envelopes twice** - causes data corruption
- **Don't use reflection for type resolution** - breaks AOT
- **Don't assume types exist** - handle missing type errors
- **Don't modify JsonElement payloads** - they're read-only

## Related Documentation

- [Message Envelopes](../../messaging/message-envelopes.md) - Envelope structure
- [Envelope Registry](envelope-registry.md) - Envelope lookup
- [AOT Requirements](../../operations/deployment/native-aot.md) - AOT compatibility

---

*Version 1.0.0 - Foundation Release*
