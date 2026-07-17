---
title: Custom ID Generators
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 8
description: >-
  Implement custom ID generation strategies via IWhizbangIdProvider -
  Snowflake IDs, ULID, or custom schemes
tags: 'id-generation, uuidv7, trackedguid, whizbangid, snowflake, ulid'
codeReferences:
  - src/Whizbang.Core/IWhizbangIdProvider.cs
  - src/Whizbang.Core/IWhizbangIdProviderGeneric.cs
  - src/Whizbang.Core/Uuid7IdProvider.cs
  - src/Whizbang.Core/WhizbangIdProvider.cs
  - src/Whizbang.Core/WhizbangIdServiceCollectionExtensions.cs
  - src/Whizbang.Core/ValueObjects/TrackedGuid.cs
testReferences:
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdProviderTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/Uuid7IdProviderTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/IWhizbangIdProviderGenericTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/WhizbangIdServiceCollectionExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom ID Generators

**Custom ID generators** provide alternative ID schemes beyond the default UUIDv7. Whizbang's extension point is the `IWhizbangIdProvider` interface - implement it to plug Snowflake IDs, ULID, sequential test IDs, or any custom strategy into every WhizbangId type.

:::note
Whizbang uses UUIDv7 by default (via `Uuid7IdProvider`, which calls `TrackedGuid.NewMedo()`) for time-ordered, database-friendly IDs with sub-millisecond precision. Custom generators are for specialized scenarios.
:::

---

## The Extension Point: IWhizbangIdProvider

```csharp{title="IWhizbangIdProvider Interface" description="The ID generation extension point" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "IWhizbangIdProvider", "Interface"]}
namespace Whizbang.Core;

// Global provider - customizes ID generation for all WhizbangId types
public interface IWhizbangIdProvider {
  TrackedGuid NewGuid();
}

// Strongly-typed provider - resolve per WhizbangId type from DI
public interface IWhizbangIdProvider<TId> where TId : struct {
  TId NewId();
}
```

Key points:

- `NewGuid()` returns a **`TrackedGuid`** - a `Guid` wrapper carrying metadata about how the value was generated (source, precision). Wrap external values with `TrackedGuid.FromExternal(guid)`.
- The default implementation is **`Uuid7IdProvider`**, which returns `TrackedGuid.NewMedo()` (UUIDv7, time-ordered).
- Typed `IWhizbangIdProvider<TId>` implementations are **source-generated** for every `[WhizbangId]` type and delegate to the configured global provider.

---

## Configuring a Custom Provider

```csharp{title="Provider Registration" description="Configure the global WhizbangId provider" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Registration", "DI"]}
// Program.cs - set the global provider before any IDs are generated
services.ConfigureWhizbangIdProvider(new MyCustomIdProvider());

// Or without DI:
WhizbangIdProvider.SetProvider(new MyCustomIdProvider());

// Register the generated typed providers (IWhizbangIdProvider<TId>) in DI
services.AddWhizbangIdProviders();
```

```csharp{title="Typed Provider Usage" description="Resolve a strongly-typed ID provider from DI" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "WhizbangId", "DI"]}
public class OrderService {
  private readonly IWhizbangIdProvider<OrderId> _idProvider;

  public OrderService(IWhizbangIdProvider<OrderId> idProvider) {
    _idProvider = idProvider;
  }

  public Order CreateOrder() {
    var orderId = _idProvider.NewId();  // Type-safe, uses the configured strategy
    return new Order { Id = orderId };
  }
}
```

---

## Why Custom ID Generators?

| ID Scheme | Benefits | Trade-offs |
|-----------|----------|------------|
| **UUIDv7** (default) | Time-ordered, standard | 128-bit size |
| **Snowflake** | 64-bit, Twitter-scale | Requires clock sync |
| **ULID** | Lexicographically sortable | Custom parsing |
| **Sequential (testing)** | Deterministic tests | Not production-safe |

**When to use custom IDs**:
- ✅ Deterministic IDs in tests
- ✅ Specific ordering needs
- ✅ Legacy system compatibility
- ✅ Custom collision resistance

---

## Snowflake ID Generator

### Pattern 1: Twitter Snowflake

```csharp{title="Pattern 1: Twitter Snowflake" description="Pattern 1: Twitter Snowflake" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Twitter"]}
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

### Plugging It into Whizbang

Pack the 64-bit Snowflake value into a `Guid` and wrap it with `TrackedGuid.FromExternal`:

```csharp{title="Snowflake Whizbang Provider" description="Adapt Snowflake IDs to IWhizbangIdProvider" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Snowflake", "IWhizbangIdProvider"]}
public class SnowflakeWhizbangIdProvider : IWhizbangIdProvider {
  private readonly SnowflakeIdGenerator _generator;

  public SnowflakeWhizbangIdProvider(long machineId) {
    _generator = new SnowflakeIdGenerator(machineId);
  }

  public TrackedGuid NewGuid() {
    Span<byte> bytes = stackalloc byte[16];
    BitConverter.TryWriteBytes(bytes, _generator.NextId());
    return TrackedGuid.FromExternal(new Guid(bytes));
  }
}

// Registration
services.ConfigureWhizbangIdProvider(new SnowflakeWhizbangIdProvider(machineId: 42));
```

:::warning
Non-UUIDv7 schemes lose the time-ordering guarantees that Whizbang's event ordering and database indexing are tuned for. Ensure your custom scheme is still monotonically increasing per generator if events rely on ID ordering.
:::

---

## ULID Generator

### Pattern 2: Universally Unique Lexicographically Sortable ID

```csharp{title="Pattern 2: Universally Unique Lexicographically Sortable ID" description="Pattern 2: Universally Unique Lexicographically Sortable ID" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Universally"]}
// Ulid struct from the "Ulid" NuGet package (Cysharp)
public class UlidWhizbangIdProvider : IWhizbangIdProvider {
  public TrackedGuid NewGuid() {
    // ULID is 128-bit and time-ordered - converts cleanly to Guid
    return TrackedGuid.FromExternal(Ulid.NewUlid().ToGuid());
  }
}
```

**Usage**:
```csharp{title="ULID Provider Usage" description="ULID-backed WhizbangId generation" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "Universally"]}
services.ConfigureWhizbangIdProvider(new UlidWhizbangIdProvider());

var id = WhizbangIdProvider.NewGuid();  // TrackedGuid backed by a ULID
```

---

## Further Reading

**Core Concepts**:
- [Message Context](../../fundamentals/messages/message-context.md) - MessageId, CorrelationId
- [WhizbangIds](../../fundamentals/identity/whizbang-ids.md) - Strongly-typed ID types and the `[WhizbangId]` attribute

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
