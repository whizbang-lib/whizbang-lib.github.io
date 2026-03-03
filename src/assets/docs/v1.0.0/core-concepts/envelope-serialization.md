---
title: Envelope Serialization
version: 1.0.0
category: Core Concepts
order: 23
description: >-
  EnvelopeSerializer and SerializedEnvelope for AOT-compatible envelope serialization in Whizbang.
tags: 'envelope, serialization, aot, json'
codeReferences:
  - src/Whizbang.Core/Messaging/EnvelopeSerializer.cs
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

```csharp
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

```csharp
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

```csharp
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

```
1. Typed Envelope: MessageEnvelope<OrderCreated>
   └─> serializer.SerializeEnvelope(envelope)

2. Capture Type Metadata
   └─> EnvelopeType: "MessageEnvelope`1[[OrderCreated,...]], Whizbang.Core"
   └─> MessageType: "MyApp.Events.OrderCreated, MyApp"

3. Convert to JsonElement
   └─> Serialize envelope to JSON
   └─> Deserialize as MessageEnvelope<JsonElement>

4. Return SerializedEnvelope
   └─> Contains JsonEnvelope + type metadata
```

## Usage Examples

### Serializing for Storage

```csharp
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

```csharp
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

```csharp
public async Task WriteToOutboxAsync<TMessage>(
    MessageEnvelope<TMessage> envelope,
    CancellationToken ct = default) {

  var serialized = _serializer.SerializeEnvelope(envelope);

  await _coordinator.ProcessWorkBatchAsync(
      newOutboxMessages: [
        new OutboxMessage(
            MessageId: envelope.MessageId.Value,
            CorrelationId: envelope.CorrelationId.Value,
            MessageType: serialized.MessageType,
            Payload: JsonSerializer.Serialize(serialized.JsonEnvelope),
            EnvelopeType: serialized.EnvelopeType
        )
      ]);
}
```

## Double Serialization Prevention

The serializer detects and prevents double serialization:

```csharp
// ❌ This will throw InvalidOperationException
var alreadySerialized = new MessageEnvelope<JsonElement>(...);
serializer.SerializeEnvelope(alreadySerialized);
// Error: "DOUBLE SERIALIZATION DETECTED: Payload is JsonElement..."
```

This prevents bugs where envelopes are accidentally serialized twice.

## AOT Compatibility

The serializer uses `JsonContextRegistry` for AOT-safe type resolution:

```csharp
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

  return JsonSerializer.Deserialize(jsonElement, jsonTypeInfo)!;
}
```

Types are registered via `[ModuleInitializer]` in generated code.

## Error Handling

### Type Resolution Failure

```csharp
try {
  var message = serializer.DeserializeMessage(jsonEnvelope, messageTypeName);
} catch (InvalidOperationException ex) {
  // "Failed to resolve message type 'MyApp.Events.OldEvent'..."
  _logger.LogError(ex, "Cannot deserialize unknown message type");
}
```

### Serialization Failure

```csharp
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

- [Message Envelopes](../messaging/message-envelopes.md) - Envelope structure
- [Envelope Registry](envelope-registry.md) - Envelope lookup
- [AOT Requirements](/v1.0.0/advanced-topics/native-aot) - AOT compatibility

---

*Version 1.0.0 - Foundation Release*
