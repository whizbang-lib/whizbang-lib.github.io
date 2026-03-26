---
title: Perspective Stream Locking
version: 1.0.0
category: Perspectives
order: 12
description: >-
  Stream-level locking for perspective rewind, bootstrap, and purge operations -
  prevents concurrent event application during destructive operations
tags: >-
  perspectives, stream-locking, concurrency, rewind, bootstrap, purge,
  distributed-locking, operational
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveStreamLocker.cs
  - src/Whizbang.Core/Perspectives/PerspectiveStreamLockOptions.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPerspectiveStreamLocker.cs
---

# Perspective Stream Locking

When a perspective needs to **rewind**, **bootstrap a snapshot**, or **purge** data for a specific stream, normal event application must be paused. The `IPerspectiveStreamLocker` provides stream-level locks that prevent concurrent processing during these destructive or rebuilding operations. New events continue to queue in `wh_perspective_events` and are processed after the lock is released.

## IPerspectiveStreamLocker

```csharp{title="IPerspectiveStreamLocker" description="Core interface for stream-level perspective locking" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveStreamLocker"]}
public interface IPerspectiveStreamLocker {
  Task<bool> TryAcquireLockAsync(Guid streamId, string perspectiveName,
    Guid instanceId, string reason, CancellationToken ct = default);

  Task RenewLockAsync(Guid streamId, string perspectiveName,
    Guid instanceId, CancellationToken ct = default);

  Task ReleaseLockAsync(Guid streamId, string perspectiveName,
    Guid instanceId, CancellationToken ct = default);
}
```

## Lock Semantics

### Acquire

`TryAcquireLockAsync` attempts to acquire a lock for a `(streamId, perspectiveName)` pair. The lock succeeds if:

- **Unlocked**: No lock currently exists
- **Expired**: A previous lock has timed out (its `stream_lock_expiry` has passed)
- **Same instance**: The requesting instance already holds the lock (idempotent re-acquisition)

Returns `false` if another active instance holds the lock. The caller (typically `PerspectiveWorker`) skips processing for that stream/perspective and moves on.

```csharp{title="TryAcquireLockAsync" description="Attempt to acquire a stream lock for rewind" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Stream Locking", "Acquire"]}
var lockAcquired = await streamLocker.TryAcquireLockAsync(
    streamId: orderId,
    perspectiveName: "OrderPerspective",
    instanceId: instanceProvider.InstanceId,
    reason: "rewind");

if (!lockAcquired) {
    // Another instance holds the lock -- skip this stream for now
    return;
}
```

### Renew

`RenewLockAsync` extends the lock expiry. This is called by a background keepalive task during long-running operations to prevent the lock from expiring while work is still in progress. No-op if the lock is not held by the specified instance.

```csharp{title="RenewLockAsync" description="Extend lock expiry during long operations" category="Usage" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Stream Locking", "Renew"]}
// Called periodically by the keepalive background task
await streamLocker.RenewLockAsync(orderId, "OrderPerspective", instanceId);
```

### Release

`ReleaseLockAsync` clears the lock fields. Only releases if the lock is held by the specified instance, preventing accidental release of another instance's lock.

```csharp{title="ReleaseLockAsync" description="Release a stream lock after operation completes" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Stream Locking", "Release"]}
await streamLocker.ReleaseLockAsync(orderId, "OrderPerspective", instanceId);
```

## Lock Lifecycle in PerspectiveWorker

The `PerspectiveWorker` uses stream locking during both **rewind** and **bootstrap** operations:

### Rewind Path

```csharp{title="Rewind Lock Lifecycle" description="How the PerspectiveWorker manages locks during rewind" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Stream Locking", "Rewind"]}
// 1. Acquire lock
var lockAcquired = await streamLocker.TryAcquireLockAsync(
    streamId, perspectiveName, instanceId, "rewind", ct);

if (!lockAcquired) {
    // Return sentinel -- caller skips this group
    return;
}

try {
    // 2. Start keepalive task (renews lock periodically)
    using var keepaliveCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    var keepaliveTask = StartLockKeepaliveAsync(streamId, perspectiveName, keepaliveCts.Token);

    // 3. Execute rewind: restore from snapshot, replay events
    var result = await runner.RewindAndRunAsync(
        streamId, perspectiveName, rewindTriggerEventId, ct);

    // 4. Stop keepalive
    await keepaliveCts.CancelAsync();
    try { await keepaliveTask; } catch (OperationCanceledException) { }
} finally {
    // 5. Always release lock
    await streamLocker.ReleaseLockAsync(streamId, perspectiveName, instanceId, ct);
}
```

### Bootstrap Path

During snapshot bootstrap, the lock is acquired with reason `"bootstrap"`. If the lock cannot be acquired, bootstrap proceeds anyway (graceful degradation) since the bootstrap operation is idempotent.

## PerspectiveStreamLockOptions

```csharp{title="PerspectiveStreamLockOptions" description="Configuration for lock duration and keepalive" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Stream Locking", "Configuration"]}
public class PerspectiveStreamLockOptions {
  // How long a lock is valid before expiring (default: 30 seconds)
  // Must be longer than KeepAliveInterval
  public TimeSpan LockTimeout { get; set; } = TimeSpan.FromSeconds(30);

  // How often the keepalive task renews the lock (default: 10 seconds)
  // Must be less than LockTimeout / 2
  public TimeSpan KeepAliveInterval { get; set; } = TimeSpan.FromSeconds(10);
}
```

Configure via dependency injection:

```csharp{title="Configure Stream Lock Options" description="Register stream lock options in DI" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Stream Locking", "DI"]}
services.Configure<PerspectiveStreamLockOptions>(options => {
    options.LockTimeout = TimeSpan.FromSeconds(60);      // Longer timeout for large rewinds
    options.KeepAliveInterval = TimeSpan.FromSeconds(20); // Renew every 20 seconds
});
```

**Important**: The `KeepAliveInterval` must be less than `LockTimeout / 2` to ensure the lock is renewed before it expires. If the keepalive fails to renew in time, the lock expires and another instance may acquire it.

## Storage Model

The Dapper implementation stores lock state directly on the `wh_perspective_cursors` table:

| Column | Type | Purpose |
|--------|------|---------|
| `stream_lock_instance_id` | `uuid` | Which instance holds the lock (NULL = unlocked) |
| `stream_lock_expiry` | `timestamptz` | When the lock expires (NULL = unlocked) |
| `stream_lock_reason` | `text` | Why the lock was acquired (observability) |

This avoids a separate lock table and uses atomic SQL `UPDATE ... WHERE` for lock acquisition, ensuring correctness without application-level distributed locking.

## Lock Reasons

The `reason` parameter is stored for observability. Standard reasons used by Whizbang:

| Reason | Operation |
|--------|-----------|
| `"rewind"` | Late-arriving event rewind ([Snapshots](snapshots.md)) |
| `"bootstrap"` | Initial snapshot creation for existing streams |
| `"purge"` | Stream data purge/cleanup |

## Implementation

Whizbang ships a Dapper/Npgsql implementation:

| Implementation | Package |
|----------------|---------|
| `DapperPerspectiveStreamLocker` | `Whizbang.Data.Dapper.Postgres` |

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| Lock holder crashes | Lock expires after `LockTimeout`, next instance acquires it |
| Keepalive fails | Lock eventually expires; operation may be interrupted |
| Lock not acquired | `PerspectiveWorker` skips the stream/perspective and retries on next batch |
| Database unreachable | Lock operations throw; `PerspectiveWorker` retries with backoff |
