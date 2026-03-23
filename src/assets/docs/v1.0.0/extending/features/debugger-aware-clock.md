---
title: Debugger-Aware Clock
version: 1.0.0
category: Features
order: 1
description: Timeout handling that respects debugging sessions and breakpoints
tags: 'debugger, clock, timeout, stopwatch, diagnostics'
---

# Debugger-Aware Clock

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Overview

The Debugger-Aware Clock solves a common frustration during development: false timeout errors when debugging. When you hit a breakpoint, wall-clock time continues but execution is paused, causing timeouts across your system - perspective sync, transport layers, health checks, and more.

Whizbang provides a central clock service that tracks "active" time - time when code is actually executing - enabling timeouts that ignore time spent paused at breakpoints.

## The Problem

```csharp{title="The Problem" description="Demonstrates the Problem" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Problem"]}
// Traditional timeout - triggers during debugging!
var stopwatch = Stopwatch.StartNew();
await DoWorkAsync();  // You hit a breakpoint here, examine variables for 30 seconds...
if (stopwatch.Elapsed > TimeSpan.FromSeconds(5)) {
  throw new TimeoutException();  // False timeout!
}
```

## The Solution

```csharp{title="The Solution" description="Demonstrates the Solution" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Solution"]}
// Debugger-aware timeout - ignores breakpoint time
using var clock = new DebuggerAwareClock();
var stopwatch = clock.StartNew();
await DoWorkAsync();  // You hit a breakpoint here, examine variables for 30 seconds...
if (stopwatch.HasTimedOut(TimeSpan.FromSeconds(5))) {
  // Only triggers based on actual execution time
}
```

## Core Types

### IDebuggerAwareClock {#idebugger-aware-clock}

The main clock service interface that creates stopwatches and tracks pause state.

```csharp{title="IDebuggerAwareClock" description="The main clock service interface that creates stopwatches and tracks pause state." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "IDebuggerAwareClock", "Idebugger-aware-clock"]}
public interface IDebuggerAwareClock : IDisposable {
  // Current detection mode
  DebuggerDetectionMode Mode { get; }

  // True when execution is paused (breakpoint, external pause)
  bool IsPaused { get; }

  // Create a new stopwatch tracking active time
  IActiveStopwatch StartNew();

  // Subscribe to pause state changes
  IDisposable OnPauseStateChanged(Action<bool> handler);

  // Get current timestamp adjusted for debugger pauses
  long GetCurrentTimestamp();
}
```

### IActiveStopwatch {#iactive-stopwatch}

A stopwatch that distinguishes between active execution time and frozen/paused time.

```csharp{title="IActiveStopwatch" description="A stopwatch that distinguishes between active execution time and frozen/paused time." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "IActiveStopwatch", "Iactive-stopwatch"]}
public interface IActiveStopwatch {
  // Time spent actually executing (excludes frozen periods)
  TimeSpan ActiveElapsed { get; }

  // Total wall clock time since start
  TimeSpan WallElapsed { get; }

  // Time spent paused/frozen (WallElapsed - ActiveElapsed)
  TimeSpan FrozenTime { get; }

  // Check if active time exceeds timeout
  bool HasTimedOut(TimeSpan timeout);

  // Stop the stopwatch, freezing all values
  void Halt();
}
```

### DebuggerDetectionMode {#debugger-detection-mode}

Configurable detection modes that trade off between accuracy and performance.

```csharp{title="DebuggerDetectionMode" description="Configurable detection modes that trade off between accuracy and performance." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "DebuggerDetectionMode", "Debugger-detection-mode"]}
public enum DebuggerDetectionMode {
  // Always use wall clock time (fastest, no detection)
  Disabled,

  // Detect only when System.Diagnostics.Debugger.IsAttached
  DebuggerAttached,

  // Use CPU time sampling to detect frozen periods
  CpuTimeSampling,

  // Wait for VS Code extension signals
  ExternalHook,

  // Auto-select best method based on environment (default)
  Auto
}
```

| Mode | Best For | Detection Quality | Performance |
|------|----------|-------------------|-------------|
| `Disabled` | Production | None | Fastest |
| `DebuggerAttached` | Normal debugging | Good | Fast |
| `CpuTimeSampling` | External pauses | Better | Some overhead |
| `ExternalHook` | VS Code extension | Best | Requires extension |
| `Auto` | Default | Adaptive | Balanced |

### DebuggerAwareClockOptions {#debugger-aware-clock-options}

Configuration for the clock service.

```csharp{title="DebuggerAwareClockOptions" description="Configuration for the clock service." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "DebuggerAwareClockOptions", "Debugger-aware-clock-options"]}
public class DebuggerAwareClockOptions {
  // Detection mode (default: Auto)
  public DebuggerDetectionMode Mode { get; set; } = DebuggerDetectionMode.Auto;

  // CPU sampling interval for CpuTimeSampling mode (default: 100ms)
  public TimeSpan SamplingInterval { get; set; } = TimeSpan.FromMilliseconds(100);

  // Ratio threshold to consider execution frozen (default: 10.0)
  // If wall time / CPU time > threshold, considered frozen
  public double FrozenThreshold { get; set; } = 10.0;
}
```

### DebuggerAwareClock {#debugger-aware-clock}

The default implementation of `IDebuggerAwareClock`.

```csharp{title="DebuggerAwareClock" description="The default implementation of IDebuggerAwareClock." category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "DebuggerAwareClock", "Debugger-aware-clock"]}
// Default options (Auto mode)
using var clock = new DebuggerAwareClock();

// Custom options
using var clock = new DebuggerAwareClock(new DebuggerAwareClockOptions {
  Mode = DebuggerDetectionMode.CpuTimeSampling,
  SamplingInterval = TimeSpan.FromMilliseconds(50),
  FrozenThreshold = 5.0
});
```

## Usage Patterns

### Basic Timeout Check

```csharp{title="Basic Timeout Check" description="Demonstrates basic Timeout Check" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Basic", "Timeout"]}
public class WorkCoordinator {
  private readonly IDebuggerAwareClock _clock;

  public WorkCoordinator(IDebuggerAwareClock clock) {
    _clock = clock;
  }

  public async Task<Result> ProcessWithTimeoutAsync(TimeSpan timeout) {
    var stopwatch = _clock.StartNew();

    while (!stopwatch.HasTimedOut(timeout)) {
      var result = await TryProcessAsync();
      if (result.IsComplete) {
        return result;
      }
      await Task.Delay(100);
    }

    throw new TimeoutException($"Operation timed out after {stopwatch.ActiveElapsed}");
  }
}
```

### Monitoring Pause State

```csharp{title="Monitoring Pause State" description="Demonstrates monitoring Pause State" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Monitoring", "Pause"]}
// Subscribe to pause/resume events (useful for VS Code extension)
using var subscription = clock.OnPauseStateChanged(isPaused => {
  if (isPaused) {
    Console.WriteLine("Execution paused - likely at breakpoint");
  } else {
    Console.WriteLine("Execution resumed");
  }
});
```

### Performance Metrics

```csharp{title="Performance Metrics" description="Demonstrates performance Metrics" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "Performance", "Metrics"]}
var stopwatch = clock.StartNew();
await DoWorkAsync();
stopwatch.Halt();

Console.WriteLine($"Wall time: {stopwatch.WallElapsed}");
Console.WriteLine($"Active time: {stopwatch.ActiveElapsed}");
Console.WriteLine($"Frozen time: {stopwatch.FrozenTime}");

// Example output when debugging:
// Wall time: 00:00:35.123
// Active time: 00:00:05.123
// Frozen time: 00:00:30.000  (30 seconds at breakpoint)
```

## Dependency Injection

Whizbang registers `IDebuggerAwareClock` as a singleton:

```csharp{title="Dependency Injection" description="Whizbang registers IDebuggerAwareClock as a singleton:" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Dependency", "Injection"]}
builder.Services.AddWhizbang();

// Inject where needed
public class MyService {
  private readonly IDebuggerAwareClock _clock;

  public MyService(IDebuggerAwareClock clock) {
    _clock = clock;
  }
}
```

### Custom Configuration

```csharp{title="Custom Configuration" description="Demonstrates custom Configuration" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "Custom", "Configuration"]}
builder.Services.AddWhizbang(options => {
  options.ConfigureDebuggerAwareClock(clockOptions => {
    clockOptions.Mode = DebuggerDetectionMode.CpuTimeSampling;
    clockOptions.SamplingInterval = TimeSpan.FromMilliseconds(50);
  });
});
```

## How Detection Works

### Auto Mode (Default)

1. Check if `Debugger.IsAttached`
2. If attached, enable CPU time sampling
3. Compare wall time to CPU time each sampling interval
4. If ratio exceeds threshold, mark as paused

### CPU Time Sampling

The clock periodically samples `Process.TotalProcessorTime` and compares it to wall clock time:

- **Wall time >> CPU time**: Execution is frozen (breakpoint, sleep, etc.)
- **Wall time ~ CPU time**: Normal execution

This works even when the debugger is not attached, detecting external pauses.

### External Hook

For VS Code extension integration, the clock can wait for external signals:

```csharp{title="External Hook" description="For VS Code extension integration, the clock can wait for external signals:" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Features", "External", "Hook"]}
// VS Code extension signals pause via IPC
clock.SignalPause();  // When breakpoint hit
clock.SignalResume(); // When continuing
```

## Integration Points

The debugger-aware clock is used throughout Whizbang:

| Component | Usage |
|-----------|-------|
| Perspective Sync | Prevent false sync timeouts |
| Work Coordinator | Debugger-safe work batching |
| Transport Layer | Message timeout handling |
| Health Checks | Accurate timeout reporting |
| Retry Policies | Don't count breakpoint time |

## Best Practices

1. **Use Auto mode in development** - It adapts to your debugging style
2. **Use Disabled in production** - Zero overhead when not debugging
3. **Inject via DI** - Use the singleton `IDebuggerAwareClock`
4. **Always dispose** - The clock uses timers that need cleanup
5. **Halt stopwatches** - Call `Halt()` when done to freeze values

## Testing

For unit tests, you can control the clock behavior:

```csharp{title="Testing" description="For unit tests, you can control the clock behavior:" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Features", "Testing"]}
[Test]
public async Task WorkCoordinator_Timeout_UsesActiveTimeAsync() {
  // Arrange
  var options = new DebuggerAwareClockOptions {
    Mode = DebuggerDetectionMode.Disabled  // Predictable behavior
  };
  using var clock = new DebuggerAwareClock(options);

  // Act & Assert
  var stopwatch = clock.StartNew();
  await Task.Delay(100);
  Assert.That(stopwatch.HasTimedOut(TimeSpan.FromSeconds(1)), Is.False);
}
```

## See Also

- [Observability](../../fundamentals/persistence/observability.md) - OpenTelemetry integration
- [Work Coordination](../../messaging/work-coordination.md) - Batch processing
- [Health Checks](../../operations/infrastructure/health-checks.md) - System health monitoring
