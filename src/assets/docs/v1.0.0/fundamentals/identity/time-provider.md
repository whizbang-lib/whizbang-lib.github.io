---
title: Time Provider
version: 1.0.0
category: Core Concepts
order: 30
description: >-
  ITimeProvider and SystemTimeProvider for testable time operations in Whizbang applications.
tags: 'time, testing, dependency-injection, aot'
codeReferences:
  - src/Whizbang.Core/ITimeProvider.cs
  - src/Whizbang.Core/SystemTimeProvider.cs
---

# Time Provider

Whizbang provides `ITimeProvider` as an abstraction over time-related operations, enabling testability and custom time sources.

## Overview

The time provider abstraction solves common challenges:

- **Testability**: Mock time in unit tests without waiting for real time to pass
- **Determinism**: Control time in integration tests for predictable behavior
- **Flexibility**: Inject custom time sources for specific scenarios

## ITimeProvider Interface {#itimeprovider}

```csharp{title="ITimeProvider Interface" description="Demonstrates iTimeProvider Interface" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "ITimeProvider", "Interface"]}
namespace Whizbang.Core;

/// <summary>
/// Provides an abstraction for time-related operations.
/// </summary>
public interface ITimeProvider {
  /// <summary>
  /// Gets the current UTC date and time.
  /// </summary>
  DateTimeOffset GetUtcNow();

  /// <summary>
  /// Gets the current local date and time.
  /// </summary>
  DateTimeOffset GetLocalNow();

  /// <summary>
  /// Gets a high-frequency timestamp for measuring elapsed time.
  /// </summary>
  long GetTimestamp();

  /// <summary>
  /// Gets the elapsed time since a starting timestamp.
  /// </summary>
  TimeSpan GetElapsedTime(long startingTimestamp);

  /// <summary>
  /// Gets the elapsed time between two timestamps.
  /// </summary>
  TimeSpan GetElapsedTime(long startingTimestamp, long endingTimestamp);

  /// <summary>
  /// Gets the frequency of the high-resolution timer (ticks per second).
  /// </summary>
  long TimestampFrequency { get; }
}
```

## SystemTimeProvider {#systemtimeprovider}

The default implementation delegates to .NET's `TimeProvider.System`:

```csharp{title="SystemTimeProvider" description="The default implementation delegates to ." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "SystemTimeProvider", "Systemtimeprovider"]}
namespace Whizbang.Core;

public sealed class SystemTimeProvider : ITimeProvider {
  private readonly TimeProvider _timeProvider;

  public SystemTimeProvider() : this(TimeProvider.System) { }

  public SystemTimeProvider(TimeProvider timeProvider) {
    _timeProvider = timeProvider;
  }

  public DateTimeOffset GetUtcNow() => _timeProvider.GetUtcNow();
  public DateTimeOffset GetLocalNow() => _timeProvider.GetLocalNow();
  public long GetTimestamp() => _timeProvider.GetTimestamp();
  public TimeSpan GetElapsedTime(long startingTimestamp) =>
      _timeProvider.GetElapsedTime(startingTimestamp);
  public TimeSpan GetElapsedTime(long startingTimestamp, long endingTimestamp) =>
      _timeProvider.GetElapsedTime(startingTimestamp, endingTimestamp);
  public long TimestampFrequency => _timeProvider.TimestampFrequency;
}
```

## Registration

`SystemTimeProvider` is registered as a singleton by default:

```csharp{title="Registration" description="SystemTimeProvider is registered as a singleton by default:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Registration"]}
services.AddWhizbang();
// ITimeProvider -> SystemTimeProvider (singleton)
```

## Usage Examples

### Basic Usage

```csharp{title="Basic Usage" description="Demonstrates basic Usage" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Basic", "Usage"]}
public class OrderService {
  private readonly ITimeProvider _timeProvider;

  public OrderService(ITimeProvider timeProvider) {
    _timeProvider = timeProvider;
  }

  public Order CreateOrder(CreateOrderRequest request) {
    return new Order {
      Id = Guid.CreateVersion7(),
      CustomerId = request.CustomerId,
      CreatedAt = _timeProvider.GetUtcNow(),  // Testable!
      Items = request.Items
    };
  }
}
```

### Measuring Elapsed Time

```csharp{title="Measuring Elapsed Time" description="Demonstrates measuring Elapsed Time" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Measuring", "Elapsed"]}
public async Task ProcessBatchAsync(IEnumerable<Order> orders) {
  var startTimestamp = _timeProvider.GetTimestamp();

  foreach (var order in orders) {
    await ProcessOrderAsync(order);
  }

  var elapsed = _timeProvider.GetElapsedTime(startTimestamp);
  _logger.LogInformation("Processed batch in {Elapsed}", elapsed);
}
```

### Testing with Mock Time

```csharp{title="Testing with Mock Time" description="Demonstrates testing with Mock Time" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Testing", "Mock"]}
public class FakeTimeProvider : ITimeProvider {
  private DateTimeOffset _currentTime = DateTimeOffset.UtcNow;

  public DateTimeOffset GetUtcNow() => _currentTime;
  public DateTimeOffset GetLocalNow() => _currentTime.ToLocalTime();

  public void Advance(TimeSpan duration) {
    _currentTime = _currentTime.Add(duration);
  }

  public void SetTime(DateTimeOffset time) {
    _currentTime = time;
  }

  // Simplified for testing - uses Stopwatch internally
  public long GetTimestamp() => Stopwatch.GetTimestamp();
  public TimeSpan GetElapsedTime(long start) => Stopwatch.GetElapsedTime(start);
  public TimeSpan GetElapsedTime(long start, long end) =>
      Stopwatch.GetElapsedTime(start, end);
  public long TimestampFrequency => Stopwatch.Frequency;
}

// Test usage
[Test]
public async Task Order_ExpiresAfter30Minutes_ReturnsExpiredAsync() {
  // Arrange
  var fakeTime = new FakeTimeProvider();
  var service = new OrderService(fakeTime);
  var order = service.CreateOrder(new CreateOrderRequest { ... });

  // Act - advance time by 31 minutes
  fakeTime.Advance(TimeSpan.FromMinutes(31));
  var isExpired = service.IsOrderExpired(order);

  // Assert
  await Assert.That(isExpired).IsTrue();
}
```

### Using Microsoft.Extensions.TimeProvider.Testing

For more sophisticated testing, use `FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing`:

```csharp{title="Using Microsoft.Extensions.TimeProvider.Testing" description="For more sophisticated testing, use FakeTimeProvider from `Microsoft." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Using", "Microsoft.Extensions.TimeProvider.Testing"]}
using Microsoft.Extensions.Time.Testing;

[Test]
public void Order_WithFakeTimeProvider_RespectsTimeAdvancementAsync() {
  // Arrange
  var fakeTimeProvider = new FakeTimeProvider();
  fakeTimeProvider.SetUtcNow(new DateTimeOffset(2024, 1, 15, 10, 0, 0, TimeSpan.Zero));

  var whizbangTimeProvider = new SystemTimeProvider(fakeTimeProvider);
  var service = new OrderService(whizbangTimeProvider);

  // Act
  var order = service.CreateOrder(new CreateOrderRequest { ... });

  // Assert
  await Assert.That(order.CreatedAt).IsEqualTo(
      new DateTimeOffset(2024, 1, 15, 10, 0, 0, TimeSpan.Zero));
}
```

## Best Practices

### DO

- **Inject ITimeProvider** instead of using `DateTime.UtcNow` or `DateTimeOffset.UtcNow` directly
- **Use GetUtcNow()** for timestamps stored in databases or events
- **Use GetTimestamp()** for high-precision elapsed time measurements
- **Create FakeTimeProvider** for deterministic tests

### DON'T

- **Don't use DateTime.Now** - always use UTC for consistency
- **Don't mix DateTime and DateTimeOffset** - prefer DateTimeOffset
- **Don't create new SystemTimeProvider instances** - use DI

## High-Precision Timing

For performance-critical code, use the timestamp methods:

```csharp{title="High-Precision Timing" description="For performance-critical code, use the timestamp methods:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "High-Precision", "Timing"]}
// ✅ GOOD: High-precision timing
var start = _timeProvider.GetTimestamp();
DoWork();
var elapsed = _timeProvider.GetElapsedTime(start);
// Resolution: nanoseconds (via Stopwatch)

// ❌ BAD: Lower precision
var start = _timeProvider.GetUtcNow();
DoWork();
var elapsed = _timeProvider.GetUtcNow() - start;
// Resolution: milliseconds (via system clock)
```

## Related Documentation

- [Message Context](message-context.md) - Timestamps in message envelopes
- [Observability](observability.md) - Timing metrics and tracing
- [Testing Strategy](/v1.0.0/testing/testing-strategy) - Testing with time providers

---

*Version 1.0.0 - Foundation Release*
