---
title: "Custom Serializers"
version: 0.1.0
category: Extensibility
order: 7
description: "Implement custom serializers for Protobuf, MessagePack, or custom binary formats - AOT-compatible patterns"
tags: serialization, protobuf, messagepack, aot, json
codeReferences:
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
---

# Custom Serializers

**Custom serializers** enable alternative message formats beyond JSON. Implement Protobuf, MessagePack, Avro, or custom binary formats while maintaining AOT compatibility.

:::note
Whizbang uses JSON by default with `JsonContextRegistry` for AOT support. Custom serializers are for specialized scenarios requiring different formats.
:::

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

## Protobuf Serializer

### Pattern 1: Protobuf with AOT

```csharp
using Google.Protobuf;
using System.Text.Json;

public class ProtobufSerializer : IMessageSerializer {
  public byte[] Serialize<T>(T message) where T : IMessage<T> {
    return message.ToByteArray();  // AOT-safe
  }

  public T Deserialize<T>(byte[] data) where T : IMessage<T>, new() {
    var parser = new MessageParser<T>(() => new T());
    return parser.ParseFrom(data);  // AOT-safe
  }
}
```

**Usage**:
```csharp
// Define protobuf message
message OrderCreated {
  string order_id = 1;
  string customer_id = 2;
  double total = 3;
}

// Serialize
var serializer = new ProtobufSerializer();
var @event = new OrderCreated {
  OrderId = orderId.ToString(),
  CustomerId = customerId.ToString(),
  Total = 99.99
};

var bytes = serializer.Serialize(@event);

// Deserialize
var deserialized = serializer.Deserialize<OrderCreated>(bytes);
```

---

## MessagePack Serializer

### Pattern 2: MessagePack with AOT

```csharp
using MessagePack;

[MessagePackObject]
public record OrderCreated {
  [Key(0)] public Guid OrderId { get; init; }
  [Key(1)] public Guid CustomerId { get; init; }
  [Key(2)] public decimal Total { get; init; }
}

public class MessagePackSerializer : IMessageSerializer {
  private readonly MessagePackSerializerOptions _options;

  public MessagePackSerializer() {
    _options = MessagePackSerializerOptions.Standard
      .WithResolver(MessagePack.Resolvers.ContractlessStandardResolver.Instance);
  }

  public byte[] Serialize<T>(T message) {
    return MessagePackSerializer.Serialize(message, _options);
  }

  public T Deserialize<T>(byte[] data) {
    return MessagePackSerializer.Deserialize<T>(data, _options);
  }
}
```

---

## Further Reading

**Source Generators**:
- [JSON Contexts](../source-generators/json-contexts.md) - AOT-compatible JSON

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
