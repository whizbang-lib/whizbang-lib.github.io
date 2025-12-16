# Multi-Instance Coordination

## Overview

Multi-instance coordination ensures reliable, ordered message processing across multiple service instances. This document details the coordination mechanisms, decision points, and timing guarantees that enable distributed message processing.

## Core Coordination Mechanisms

### 1. Cross-Instance Stream Ordering {#cross-instance-stream-ordering}

**Rule**: When Instance A holds message M1 from stream S, Instance B cannot claim later messages (M2, M3, M4) from the same stream until Instance A completes or releases M1.

**Why This Matters**: Prevents out-of-order processing when messages from the same stream are distributed across multiple instances via partition assignment.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1
    participant DB as PostgreSQL
    participant I2 as Instance 2

    Note over DB: Stream S has messages M1, M2, M3, M4<br/>(temporal order by created_at)

    I1->>DB: ProcessWorkBatch()
    DB->>DB: Calculate partition ownership<br/>(partition % 2)
    DB->>DB: M1, M2 assigned to partition 0<br/>M3, M4 assigned to partition 5
    DB->>DB: Instance 1 owns partition 0<br/>Instance 2 owns partition 5
    DB-->>I1: Returns M1, M2
    Note over I1: I1 now holds lease on M1, M2<br/>lease_expiry = now + 5 min

    I2->>DB: ProcessWorkBatch()
    DB->>DB: Check partition ownership
    DB->>DB: Find M3, M4 in partition 5 (owned by I2)
    DB->>DB: NOT EXISTS check:<br/>SELECT 1 FROM wh_outbox earlier<br/>WHERE earlier.stream_id = M3.stream_id<br/>AND earlier.created_at < M3.created_at<br/>AND earlier.instance_id IS NOT NULL<br/>AND earlier.lease_expiry > now
    Note over DB: ❌ M3, M4 BLOCKED<br/>Earlier messages M1, M2 held by I1<br/>(active lease)
    DB-->>I2: Returns [] (empty)

    Note over I2: I2 cannot process M3, M4<br/>until I1 completes/releases M1, M2

    I1->>DB: ProcessWorkBatch(<br/>completions: [M1: Published, M2: Published])
    DB->>DB: Mark M1, M2 as Published
    DB->>DB: Delete M1, M2 (done)

    I2->>DB: ProcessWorkBatch()
    DB->>DB: NOT EXISTS check passes<br/>(no earlier messages with active leases)
    DB-->>I2: Returns M3, M4
    Note over I2: ✅ Stream ordering preserved<br/>M1, M2 completed before M3, M4 claimed
```

**Decision Matrix**:

| Earlier Message State | Later Messages Claimable? | Reason |
|---|---|---|
| No lease (`instance_id = NULL`) | ✅ Yes | Message not claimed |
| Expired lease (`lease_expiry < now`) | ✅ Yes | Message orphaned |
| Active lease (other instance) | ❌ No | Stream ordering protection |
| Completed/deleted | ✅ Yes | Message finished |
| Scheduled for retry | ❌ No | See [Scheduled Retry Blocking](#scheduled-retry-blocking) |

### 2. Stale Instance Cleanup {#stale-instance-cleanup}

**Rule**: Instances that stop heartbeating for longer than the stale threshold (default: 10 minutes) are automatically removed, releasing their partitions.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1
    participant DB as PostgreSQL
    participant I2 as Instance 2

    I1->>DB: ProcessWorkBatch()
    DB->>DB: UPDATE wh_service_instances<br/>SET last_heartbeat_at = now<br/>WHERE instance_id = I1
    DB->>DB: UPDATE wh_partition_assignments<br/>SET last_heartbeat = now<br/>WHERE instance_id = I1
    DB-->>I1: WorkBatch

    Note over I1: Instance 1 crashes<br/>(application stopped)

    Note over DB: Time passes...<br/>10+ minutes (stale threshold)

    I2->>DB: ProcessWorkBatch()
    DB->>DB: DELETE FROM wh_service_instances<br/>WHERE last_heartbeat_at < now - INTERVAL '10 minutes'<br/>AND instance_id != I2
    Note over DB: CASCADE DELETE triggers<br/>wh_partition_assignments rows deleted
    DB->>DB: Count active instances:<br/>1 (only I2)
    DB->>DB: Recalculate partition distribution<br/>(modulo 1 = all partitions to I2)
    DB->>DB: Claim orphaned partitions<br/>from deleted Instance 1
    DB-->>I2: WorkBatch (includes I1's former work)

    Note over I2: ✅ Instance 1 cleaned up<br/>Partitions reassigned<br/>Work processing continues
```

**Timing Diagram**:

```
Time →
0s         300s        600s        610s        620s
│          │           │           │           │
I1 ━━━━━━━━━━━━━━━━━━━━┃ Crash
                       │
                       ├──── Heartbeat valid (10 min window)
                       │
                       │                       I2 calls ProcessWorkBatch
                       │                       │
                       ├─ Stale threshold ────→│
                       │                       │
                       │                       ├→ I1 deleted (CASCADE)
                       │                       ├→ Partitions released
                       │                       └→ I2 claims partitions
```

**Decision Matrix**:

| Heartbeat Age | Instance State | Partitions | Action |
|---|---|---|---|
| < 10 minutes | Active | Retained | Normal operation |
| > 10 minutes (same instance) | Active | Retained | Self-exception (don't delete self) |
| > 10 minutes (other instance) | Stale | Released | DELETE instance, CASCADE partitions |

### 3. New Instance Joining {#new-instance-joining}

**Rule**: When a new instance joins, it claims only unassigned partitions or partitions from stale instances. Active instances retain their partition assignments.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1<br/>(Active)
    participant DB as PostgreSQL
    participant I2 as Instance 2<br/>(New)

    Note over I1: Instance 1 owns partitions 0, 2, 4, 6, 8<br/>(modulo 1, when alone)

    I1->>DB: ProcessWorkBatch()
    DB->>DB: Heartbeat update
    DB-->>I1: WorkBatch (from partitions 0,2,4,6,8)

    Note over I2: New Instance 2 starts

    I2->>DB: ProcessWorkBatch()
    DB->>DB: INSERT INTO wh_service_instances<br/>(I2, ServiceName, Host, PID, now)
    DB->>DB: Count active instances:<br/>SELECT COUNT(*) FROM wh_service_instances<br/>WHERE last_heartbeat_at >= stale_cutoff
    Note over DB: Result: 2 active instances

    DB->>DB: Calculate fair share:<br/>CEIL(10000 / 2) = 5000 partitions per instance
    DB->>DB: Modulo distribution:<br/>Partition % 2 = 0 → I1 (index 0)<br/>Partition % 2 = 1 → I2 (index 1)
    DB->>DB: Claim partitions for I2:<br/>Only claim partitions where:<br/>1. partition % 2 = 1 (I2's modulo)<br/>2. NOT already owned by active instance<br/>3. OR owned by stale instance
    DB->>DB: ON CONFLICT DO UPDATE<br/>WHERE current_owner = I2<br/>OR current_owner NOT IN (active_instances)
    Note over DB: ✅ Partitions 1, 3, 5, 7, 9 claimed by I2<br/>❌ Partitions 0, 2, 4, 6, 8 RETAINED by I1<br/>(I1 is active, not stale)
    DB-->>I2: WorkBatch (from partitions 1,3,5,7,9)

    Note over I1,I2: Both instances continue processing<br/>No partition stealing occurred
```

**Partition Ownership Table**:

| Partition | Before (1 instance) | After (2 instances) | Reassigned? |
|---|---|---|---|
| 0 | Instance 1 | Instance 1 | No (I1 active) |
| 1 | Instance 1 | Instance 2 | Yes (unassigned for I2) |
| 2 | Instance 1 | Instance 1 | No (I1 active) |
| 3 | Instance 1 | Instance 2 | Yes (unassigned for I2) |
| 4 | Instance 1 | Instance 1 | No (I1 active) |
| ... | ... | ... | ... |

### 4. Scheduled Retry Blocking {#scheduled-retry-blocking}

**Rule**: When message M1 fails and is scheduled for retry (e.g., `scheduled_for = now + 5 minutes`), all later messages in the same stream are blocked until the scheduled time passes.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1
    participant DB as PostgreSQL

    Note over DB: Stream S has messages M1, M2, M3<br/>(temporal order by created_at)

    I1->>DB: ProcessWorkBatch()
    DB-->>I1: M1, M2, M3

    I1->>I1: Process M1 → Fails
    I1->>DB: ProcessWorkBatch(<br/>failures: [M1: error="Network timeout"]<br/>completions: [M2: Status=0, M3: Status=0])
    DB->>DB: UPDATE wh_outbox<br/>SET status = status | Failed,<br/>scheduled_for = now + INTERVAL '1 minute',<br/>instance_id = NULL, lease_expiry = NULL<br/>WHERE message_id = M1
    DB->>DB: Release M2, M3 leases<br/>(instance_id = NULL, lease_expiry = NULL)
    Note over DB: M1: scheduled_for = now + 1 min<br/>M2, M3: leases cleared

    I1->>DB: ProcessWorkBatch()
    DB->>DB: Find claimable messages in owned partitions
    DB->>DB: Check M2:<br/>NOT EXISTS (<br/>  SELECT 1 FROM wh_outbox earlier<br/>  WHERE earlier.stream_id = M2.stream_id<br/>  AND earlier.created_at < M2.created_at<br/>  AND earlier.scheduled_for > now<br/>)
    Note over DB: ❌ M2 BLOCKED<br/>M1 scheduled_for = now + 1 min > now<br/>(M1 is earlier in stream)
    DB->>DB: Check M3: Same result (blocked)
    DB-->>I1: Returns [] (empty)

    Note over I1: Cannot process M2, M3<br/>until M1's scheduled time arrives

    Note over DB: Time passes (1+ minute)

    I1->>DB: ProcessWorkBatch()
    DB->>DB: Check M1:<br/>scheduled_for <= now? ✅ Yes<br/>NOT EXISTS check passes
    DB->>DB: Check M2, M3:<br/>NOT EXISTS check passes<br/>(M1.scheduled_for <= now)
    DB-->>I1: Returns M1, M2, M3

    Note over I1: ✅ All messages now claimable<br/>Retry M1 + process M2, M3
```

**Timing Diagram**:

```
Time →
0s              60s             120s
│               │               │
M1 ━━━━━━━━━┃ Fail
           │
           ├→ scheduled_for = now + 60s
           │
M2, M3     ├→ Leases cleared (Status=0)
blocked    │
           │
           ├──── M2, M3 cannot be claimed
           │
           │               ProcessWorkBatch
           │               │
           └─ Scheduled ──→│
                           │
                           ├→ M1 claimable (scheduled_for <= now)
                           └→ M2, M3 claimable (no blocking)
```

**Decision Matrix**:

| Earlier Message State | scheduled_for | Later Messages Claimable? | Reason |
|---|---|---|---|
| Failed | now + 5 min (future) | ❌ No | Scheduled retry blocks stream |
| Failed | now - 1 min (past) | ✅ Yes | Scheduled time passed |
| Failed | NULL | ✅ Yes | No schedule (poison message?) |
| Processing | N/A | ❌ No | Active lease blocks |
| Completed | N/A | ✅ Yes | Message done |

### 5. Partition Reassignment {#partition-reassignment}

**Rule**: Partition ownership only changes when assigned to a stale instance or when unassigned. Active instances retain partitions.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1<br/>(Goes Stale)
    participant DB as PostgreSQL
    participant I2 as Instance 2

    Note over I1: Instance 1 owns partition 5

    I1->>DB: ProcessWorkBatch()
    DB->>DB: UPDATE wh_partition_assignments<br/>SET last_heartbeat = now<br/>WHERE instance_id = I1 AND partition_number = 5

    Note over I1: Instance 1 stops heartbeating<br/>(crash, network issue, etc.)

    Note over DB: Time passes (10+ minutes)

    I2->>DB: ProcessWorkBatch()
    DB->>DB: DELETE stale instances<br/>WHERE last_heartbeat_at < stale_cutoff
    Note over DB: Instance 1 deleted<br/>CASCADE removes partition assignments

    DB->>DB: Find orphaned work in partition 5
    DB->>DB: INSERT INTO wh_partition_assignments<br/>(partition_number=5, instance_id=I2, ...)<br/>ON CONFLICT (partition_number) DO UPDATE<br/>SET instance_id = I2, ...<br/>WHERE current_owner = I2<br/>OR current_owner NOT IN (active_instances)
    Note over DB: ✅ Partition 5 reassigned to I2<br/>(I1 was stale, not active)
    DB-->>I2: WorkBatch (includes partition 5 work)

    Note over I2: Instance 2 now owns partition 5
```

**ON CONFLICT Decision Logic**:

```sql
INSERT INTO wh_partition_assignments (...)
ON CONFLICT (partition_number) DO UPDATE
SET instance_id = EXCLUDED.instance_id
WHERE
  -- Allow update if:
  wh_partition_assignments.instance_id = p_instance_id  -- Already own it (self)
  OR wh_partition_assignments.instance_id NOT IN (      -- Or owner is stale
    SELECT instance_id FROM wh_service_instances
    WHERE last_heartbeat_at >= v_stale_cutoff
  );
```

| Current Owner | New Claimant | Heartbeat Status | Reassignment | Reason |
|---|---|---|---|---|
| Instance 1 | Instance 1 | Active | ✅ Allow | Self-update (heartbeat) |
| Instance 1 | Instance 2 | Active (I1) | ❌ Block | I1 is active (no stealing) |
| Instance 1 | Instance 2 | Stale (I1) | ✅ Allow | I1 is stale (reassignment) |
| NULL | Instance 2 | N/A | ✅ Allow | Unassigned partition |

### 6. Lease Expiry and Orphaned Work {#lease-expiry}

**Rule**: Messages with expired leases (`lease_expiry < now`) can be claimed by any instance, enabling automatic recovery from instance failures.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant I1 as Instance 1<br/>(Crashes)
    participant DB as PostgreSQL
    participant I2 as Instance 2

    I1->>DB: ProcessWorkBatch()
    DB-->>I1: M1, M2 (lease_expiry = now + 5 min)

    Note over I1: Instance 1 crashes mid-processing<br/>(still heartbeating, lease still valid)

    Note over DB: Time passes (5+ minutes)<br/>Lease expires

    I2->>DB: ProcessWorkBatch()
    DB->>DB: Find orphaned work:<br/>SELECT * FROM wh_outbox<br/>WHERE partition_number IN (owned_partitions)<br/>AND (instance_id IS NULL<br/>     OR lease_expiry IS NULL<br/>     OR lease_expiry < now)
    DB->>DB: UPDATE wh_outbox<br/>SET instance_id = I2,<br/>lease_expiry = now + 5 min<br/>WHERE message_id IN (M1, M2)
    DB-->>I2: WorkBatch: M1, M2 (reclaimed)

    Note over I2: ✅ Orphaned work recovered<br/>Processing continues
```

**Lease State Machine**:

```
No Lease                Active Lease              Expired Lease
(instance_id = NULL) →  (lease_expiry > now)  →  (lease_expiry < now)
                        ↓                         ↓
                        Processing                Orphaned (reclaimable)
                        ↓
                        Completed/Failed
                        (lease cleared)
```

### 7. Idempotency - Inbox Deduplication {#idempotency-inbox}

**Rule**: The `wh_message_deduplication` table permanently tracks all inbox message IDs. Duplicate messages are rejected via `ON CONFLICT DO NOTHING`.

#### Sequence Diagram

```mermaid
sequenceDiagram
    participant T as Transport<br/>(Azure Service Bus)
    participant I1 as Instance 1
    participant DB as PostgreSQL

    T->>I1: Deliver message M1 (messageId: abc-123)
    I1->>DB: ProcessWorkBatch(<br/>newInboxMessages: [M1])
    DB->>DB: INSERT INTO wh_message_deduplication<br/>(message_id='abc-123', first_seen_at=now)<br/>ON CONFLICT (message_id) DO NOTHING<br/>RETURNING message_id
    Note over DB: ✅ Returns 'abc-123'<br/>(first time seeing this message)
    DB->>DB: INSERT INTO wh_inbox (message_id='abc-123', ...)
    DB-->>I1: WorkBatch: [M1]

    Note over T: Network blip causes duplicate delivery

    T->>I1: Deliver message M1 again (messageId: abc-123)
    I1->>DB: ProcessWorkBatch(<br/>newInboxMessages: [M1])
    DB->>DB: INSERT INTO wh_message_deduplication<br/>(message_id='abc-123', first_seen_at=now)<br/>ON CONFLICT (message_id) DO NOTHING<br/>RETURNING message_id
    Note over DB: ❌ Returns nothing<br/>(conflict on message_id, DO NOTHING)
    DB->>DB: v_new_inbox_ids = [] (empty array)
    DB->>DB: Skip INSERT INTO wh_inbox<br/>(message not in v_new_inbox_ids)
    DB-->>I1: WorkBatch: [] (empty, duplicate rejected)

    Note over I1: ✅ Duplicate prevented<br/>Exactly-once processing guaranteed
```

**Deduplication Table**:

```sql
CREATE TABLE wh_message_deduplication (
  message_id UUID PRIMARY KEY,  -- Idempotency key
  first_seen_at TIMESTAMPTZ NOT NULL
);

-- Permanent record (never deleted)
-- Enables exactly-once inbox processing
```

### 8. Idempotency - Outbox Transactional Boundary {#idempotency-outbox}

**Rule**: Outbox does NOT use the deduplication table. Duplicate prevention is the caller's responsibility (transactional outbox pattern).

#### Diagram

```mermaid
graph TD
    A[Application Transaction] -->|BEGIN| B[Business Logic]
    B --> C[INSERT INTO application_table]
    C --> D[INSERT INTO wh_outbox]
    D -->|COMMIT| E[Transaction Committed]

    E --> F[Background Worker: ProcessWorkBatch]
    F --> G[Publish to Transport]
    G --> H[Mark as Published, DELETE from wh_outbox]

    style A fill:#e1f5ff
    style D fill:#ffe1e1
    style E fill:#e1ffe1

    Note1[Outbox is part of application transaction]
    Note2[If transaction fails, outbox INSERT rolls back]
    Note3[No deduplication table needed]
```

**Why No Deduplication?**:
- Outbox is part of the application's transaction boundary
- If the same message is inserted twice, it's because the application logic called it twice
- The application should handle deduplication (e.g., idempotent commands, unique constraints)
- Whizbang's responsibility: Ensure at-least-once delivery (once in outbox → delivered to transport)

## Testing Scenarios

Each coordination mechanism has corresponding integration tests that validate the behavior under various conditions:

### Instance Lifecycle Tests
- **Stale instance cleanup** - `ProcessWorkBatch_StaleInstance_CleanedUpAndPartitionsReleasedAsync`
- **Lease expiry recovery** - `ProcessWorkBatch_InstanceCrashes_MessagesReclaimedAfterLeaseExpiryAsync`
- **Active instance counting** - `ProcessWorkBatch_MultipleActiveInstances_AllCountedInDistributionAsync`

### Partition Stability Tests
- **New instance joining** - `ProcessWorkBatch_NewInstanceJoins_DoesNotStealActivePartitionsAsync`
- **Partition reassignment rules** - `ProcessWorkBatch_PartitionReassignment_OnlyFromStaleInstancesAsync`
- **Lease-based ownership** - `ProcessWorkBatch_ActiveLease_PreventsCrossInstanceStealingAsync`

### Stream Ordering Tests
- **Cross-instance blocking** - `ProcessWorkBatch_CrossInstanceStreamOrdering_PreventsClaimingWhenEarlierMessagesHeldAsync`
- **Scheduled retry blocking** - `ProcessWorkBatch_ScheduledRetry_BlocksLaterMessagesInStreamAsync`
- **Scheduled retry expiry** - `ProcessWorkBatch_ScheduledRetryExpires_UnblocksStreamAsync`

### Idempotency Tests
- **Inbox deduplication** - `ProcessWorkBatch_DuplicateInboxMessage_DeduplicationPreventsAsync`
- **Outbox transactional** - `ProcessWorkBatch_OutboxNoDuplication_TransactionalBoundaryAsync`

## Configuration Guidelines

### Lease Duration

Choose based on maximum expected processing time:

| Processing Time | Recommended Lease | Rationale |
|---|---|---|
| < 30 seconds | 2 minutes | Quick recovery, minimal orphaning risk |
| 30s - 2 minutes | 5 minutes (default) | Balanced recovery and stability |
| 2 - 5 minutes | 10 minutes | Long-running tasks, prioritize stability |
| > 5 minutes | Use lease renewal | Extend lease for long-running operations |

### Stale Threshold

Set to accommodate temporary network issues:

| Environment | Recommended Threshold | Rationale |
|---|---|---|
| Development/Testing | 10 seconds | Fast feedback, quick recovery |
| Production (stable network) | 10 minutes (default) | Handles brief network issues |
| Production (unreliable network) | 20 minutes | Prevents false stale detection |

**Rule of Thumb**: Stale threshold should be ≥ 2x lease duration

### Partition Count

Higher counts enable finer-grained distribution:

| Instance Count | Recommended Partitions | Distribution Granularity |
|---|---|---|
| 1-5 instances | 1,000 | 200-1000 partitions per instance |
| 5-20 instances | 10,000 (default) | 500-2000 partitions per instance |
| 20-100 instances | 50,000 | 500-2500 partitions per instance |
| 100+ instances | 100,000 | 1000+ partitions per instance |

## Troubleshooting Guide

### Problem: Messages Stuck (Not Being Claimed)

**Diagnostic Steps**:

1. **Check instance heartbeat**:
   ```sql
   SELECT instance_id, last_heartbeat_at,
          now() - last_heartbeat_at AS age
   FROM wh_service_instances;
   ```

2. **Check partition ownership**:
   ```sql
   SELECT partition_number, instance_id, last_heartbeat
   FROM wh_partition_assignments
   WHERE partition_number = <stuck_message_partition>;
   ```

3. **Check stream ordering**:
   ```sql
   SELECT message_id, created_at, instance_id, lease_expiry,
          scheduled_for, status
   FROM wh_outbox
   WHERE stream_id = <stream_id>
   ORDER BY created_at;
   ```

4. **Check lease status**:
   ```sql
   SELECT message_id, instance_id,
          lease_expiry,
          lease_expiry < now() AS is_expired
   FROM wh_outbox
   WHERE message_id = <stuck_message_id>;
   ```

**Common Causes**:
- Earlier message in stream has active lease (other instance)
- Earlier message in stream is scheduled for future retry
- Message not in partition owned by any active instance
- All instances stopped heartbeating (all stale)

### Problem: Out-of-Order Processing

**Diagnostic Steps**:

1. **Verify stream IDs are set correctly**:
   ```sql
   SELECT message_id, stream_id, created_at
   FROM wh_outbox
   ORDER BY stream_id, created_at;
   ```

2. **Check for lease bypass (should not happen)**:
   ```sql
   -- Find messages processed out of order
   SELECT later.message_id AS later_msg,
          later.processed_at AS later_processed,
          earlier.message_id AS earlier_msg,
          earlier.processed_at AS earlier_processed
   FROM wh_outbox later
   JOIN wh_outbox earlier
     ON later.stream_id = earlier.stream_id
     AND later.created_at > earlier.created_at
   WHERE later.processed_at < earlier.processed_at;
   ```

**Common Causes**:
- Stream IDs not set (NULL) → no ordering constraint
- Temporal order incorrect (created_at not sequential)
- Bug in NOT EXISTS logic (report if found!)

## Related Documentation

- [Work Coordination](work-coordination.md) - Overview and architecture
- [Idempotency Patterns](idempotency-patterns.md) - Deduplication strategies
- [Failure Handling](failure-handling.md) - Retry scheduling and cascades
- [Outbox Pattern](outbox-pattern.md) - Transactional outbox implementation
- [Inbox Pattern](inbox-pattern.md) - Deduplication and handler invocation

## Implementation

### PostgreSQL Function (Core Logic)

See: `014_CreateProcessWorkBatchFunction.sql`

**Key Sections**:
- Lines 114-128: Instance heartbeat and stale cleanup
- Lines 130-149: Dynamic partition calculation
- Lines 151-154: Partition heartbeat update
- Lines 406-484: Partition claiming with modulo distribution
- Lines 614-788: Orphaned work claiming with stream ordering protection

### C# Coordinator

See: `Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs`

**Responsibilities**:
- Serialize work batch parameters to JSON
- Call PostgreSQL `process_work_batch` function
- Deserialize returned work batch
- Map database columns to C# types

### Integration Tests

See: `Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorTests.cs`

**Test Categories**:
- Instance lifecycle (heartbeat, stale cleanup)
- Partition stability (scaling, reassignment)
- Stream ordering (cross-instance, scheduled retry)
- Idempotency (inbox deduplication, outbox transactional)
- Failure recovery (lease expiry, orphaned work)
