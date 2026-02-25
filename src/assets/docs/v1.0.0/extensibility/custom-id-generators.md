---
title: Custom ID Generators
version: 1.0.0
category: Extensibility
order: 8
description: >-
  Implement custom ID generation strategies - Snowflake IDs, ULID, CUID, or
  custom schemes
tags: 'id-generation, uuidv7, snowflake, ulid, cuid'
codeReferences:
  - src/Whizbang.Core/ValueObjects/MessageId.cs
---

# Custom ID Generators

**Custom ID generators** provide alternative ID schemes beyond UUIDv7. Implement Snowflake IDs, ULID, CUID, or custom distributed ID generation strategies.

:::note
Whizbang uses UUIDv7 by default for time-ordered, database-friendly IDs. Custom generators are for specialized scenarios.
:::

---

## Why Custom ID Generators?

| ID Scheme | Benefits | Trade-offs |
|-----------|----------|------------|
| **UUIDv7** (default) | Time-ordered, standard | 128-bit size |
| **Snowflake** | 64-bit, Twitter-scale | Requires clock sync |
| **ULID** | Lexicographically sortable | Custom parsing |
| **CUID** | Collision-resistant | Custom format |

**When to use custom IDs**:
- ✅ 64-bit ID requirements
- ✅ Specific ordering needs
- ✅ Custom collision resistance
- ✅ Legacy system compatibility

---

## Snowflake ID Generator

### Pattern 1: Twitter Snowflake

```csharp
public class SnowflakeIdGenerator {
  private readonly long _epoch = 1_640_995_200_000L;  // Jan 1, 2022
  private readonly long _machineId;
  private readonly object _lock = new();
  private long _sequence = 0L;
  private long _lastTimestamp = -1L;

  public SnowflakeIdGenerator(long machineId) {
    if (machineId < 0 || machineId > 1023) {
      throw new ArgumentException("Machine ID must be 0-1023");
    }
    _machineId = machineId;
  }

  public long NextId() {
    lock (_lock) {
      var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

      if (timestamp < _lastTimestamp) {
        throw new InvalidOperationException("Clock moved backwards");
      }

      if (timestamp == _lastTimestamp) {
        _sequence = (_sequence + 1) & 4095;  // 12-bit sequence
        if (_sequence == 0) {
          // Sequence overflow - wait for next millisecond
          timestamp = WaitNextMillis(_lastTimestamp);
        }
      } else {
        _sequence = 0;
      }

      _lastTimestamp = timestamp;

      // 41 bits: timestamp | 10 bits: machine | 12 bits: sequence
      return ((timestamp - _epoch) << 22) |
             (_machineId << 12) |
             _sequence;
    }
  }

  private long WaitNextMillis(long lastTimestamp) {
    var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    while (timestamp <= lastTimestamp) {
      timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
    return timestamp;
  }
}
```

**Usage**:
```csharp
var generator = new SnowflakeIdGenerator(machineId: 42);
var id = generator.NextId();  // 64-bit time-ordered ID
```

---

## ULID Generator

### Pattern 2: Universally Unique Lexicographically Sortable ID

```csharp
using Ulid;

public class UlidGenerator {
  public static string NewId() {
    return Ulid.NewUlid().ToString();  // 26-character string
  }

  public static Ulid Parse(string ulidString) {
    return Ulid.Parse(ulidString);
  }
}
```

**Usage**:
```csharp
var id = UlidGenerator.NewId();  // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

---

## Further Reading

**Core Concepts**:
- [Message Context](../core-concepts/message-context.md) - MessageId, CorrelationId

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
