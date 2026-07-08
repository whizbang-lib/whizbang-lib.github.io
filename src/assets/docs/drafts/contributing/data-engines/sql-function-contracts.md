---
title: SQL function contracts
order: 4
---

# SQL function contracts

Each engine implements 11 SQL functions that Whizbang's C# layer calls. These are the contract — the test suite validates conformance.

## Function summary

| Function | Hot path? | Atomicity | Purpose |
|---|---|---|---|
| `claim_work` | yes (the only thing polled) | self-only | Returns work for caller. **Empty-call short-circuit** drops idle floor toward ≤ 1 ms. |
| `commit_handler_result` | yes (per-handler) | **all together** | Atomic bundle: inbox completion + emitted outbox/inbox messages. |
| `commit_handler_batch` | yes (per-flush tick) | each result in its own savepoint | SAVEPOINT-per-handler isolation. Throughput multiplier. |
| `complete_outbox_published` | warm (batched) | self-only | Mark outbox rows processed after transport publish. |
| `complete_perspective` | warm (batched) | self-only | Cursor advance + perspective_event row deletion. |
| `report_failures` | warm (batched) | self-only | Per-category failure recording with retry counter increment. |
| `renew_leases` | cold (batched) | self-only | Extend lease for in-flight ids. |
| `record_heartbeat` | cold (5 s timer) | self-only | Decoupled heartbeat UPSERT. ~10 µs. |
| `flush_completions` | warm (composite) | self-only | One round-trip wrapping outbox + perspective + per-category failures. |
| `resolve_sync_inquiries` | on-demand | n/a (read-only) | PerspectiveSyncAwaiter pending-vs-processed counts. |
| `perform_maintenance` (existing) | cold (6 h) | n/a | Bulk purges. Engine-implemented separately. |

## Function-by-function contracts

### `claim_work`

**Signature** (Postgres example):
```sql
claim_work(
  p_instance_id  UUID,
  p_service_name TEXT,
  p_host_name    TEXT,
  p_process_id   INTEGER,
  p_max_streams  INTEGER DEFAULT 1000,
  p_partition_count INTEGER DEFAULT 10000,
  p_lease_seconds   INTEGER DEFAULT 300
) RETURNS TABLE(
  source            VARCHAR(20),  -- 'outbox' | 'inbox' | 'perspective_stream' | 'receptor'
  work_id           UUID,
  work_stream_id    UUID,
  partition_number  INTEGER,
  destination       VARCHAR(200),
  message_type      VARCHAR(500),
  envelope_type     VARCHAR(500),
  message_data      TEXT,
  metadata          JSONB,
  status            INTEGER,
  attempts          INTEGER,
  is_newly_stored   BOOLEAN,
  is_orphaned       BOOLEAN,
  perspective_name  VARCHAR(200)
)
```

**Required behavior:**

- **Empty-call short-circuit**: if no rows have `processed_at IS NULL` (or `completed_at IS NULL` for receptors) in any of the work tables, return immediately without invoking orphan-claim sub-functions or running result CTEs. This is the load-bearing performance contract — the legacy `process_work_batch` had a ~17 ms floor on empty calls; conformant `claim_work` should be ≤ 1 ms.
- **Per-stream order**: outbox/inbox return must preserve ordering within a stream (oldest first).
- **Cap respected**: `LIMIT p_max_streams` on returned rows.
- **Lock to caller**: claimed rows have `instance_id = p_instance_id` and `lease_expiry > NOW()` after the call.
- **`RAISE NOTICE 'whizbang.has_more=true'`** (or equivalent in-band signal): when total eligible work for this instance exceeds `p_max_streams`, signal so the C# claim worker can skip its wait.
- **No NOTIFY**: claim_work consumes work; it doesn't produce any. Don't issue `pg_notify`.

**Empty-call short-circuit pattern (Postgres)**:
```sql
v_has_any_work := EXISTS (SELECT 1 FROM wh_outbox WHERE processed_at IS NULL LIMIT 1)
               OR EXISTS (SELECT 1 FROM wh_inbox  WHERE processed_at IS NULL LIMIT 1)
               OR EXISTS (SELECT 1 FROM wh_perspective_events WHERE processed_at IS NULL LIMIT 1)
               OR EXISTS (SELECT 1 FROM wh_receptor_processing WHERE completed_at IS NULL LIMIT 1);
IF NOT v_has_any_work THEN RETURN; END IF;
```

### `commit_handler_result`

The atomic transactional bundle. Combines:
- Mark inbox completion (call `process_inbox_completions` or equivalent).
- Store new outbox messages emitted by the handler.
- Store new inbox messages emitted by the handler (rare).
- Emit `pg_notify('wh_work', 'outbox')` / `pg_notify('wh_work', 'inbox')` after successful inserts in each category. **Required if your engine supports server-side notifications.**

All steps commit together; if any fails, the whole bundle rolls back.

### `commit_handler_batch`

**Signature**: takes `JSONB` array of handler-result bundles. Returns `(handler_id UUID, success BOOLEAN, error_message TEXT)` per result.

**Required behavior**: each handler's bundle in its own subtransaction (SAVEPOINT in Postgres, equivalent in other engines). A failing bundle rolls back ONLY its own effects; siblings unaffected.

```sql
FOR r IN SELECT elem FROM jsonb_array_elements(p_results) AS elem
LOOP
  v_handler_id := (r.elem ->> 'handler_id')::UUID;
  BEGIN
    PERFORM commit_handler_result(r.elem);
    RETURN QUERY SELECT v_handler_id, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT v_handler_id, FALSE, SQLERRM::TEXT;
  END;
END LOOP;
```

If your engine doesn't support savepoints (`SupportsSavepoints = false`), implement as all-or-nothing: any failure rolls back the entire batch.

### `complete_outbox_published`

Mark the supplied outbox ids as processed. Idempotent: unknown ids silently ignored.

```sql
UPDATE wh_outbox SET processed_at = NOW(), status = status | 4
WHERE message_id = ANY(p_ids) AND processed_at IS NULL;
```

### `complete_perspective`

Combine cursor advancement + perspective_event row deletion in one call.

Emit `pg_notify('wh_work', 'perspective')` after either branch fires.

### `report_failures`

Category-aware dispatcher: routes to `process_outbox_failures` / `process_inbox_failures` / `process_perspective_event_failures` based on `p_category`. Raises on unknown category.

### `renew_leases`

Per-category UPDATE extending `lease_expiry` for owned in-flight ids.

### `record_heartbeat`

UPSERT on `wh_service_instances`. Must be sub-millisecond — gets called from a 5 s timer per pod.

### `flush_completions`

Composite: takes ids+failures across categories, issues all per-category sub-functions in one transaction. Single fsync covers everything. Used when the C# flush worker has multiple categories buffered.

### `resolve_sync_inquiries`

Read-only LEFT JOIN of event store ↔ perspective_events. Returns pending/processed counts per inquiry, optionally with the event-id arrays.

## NOTIFY emission contract

If your engine supports server-side notifications, emit `pg_notify('wh_work', '<category>')` (or your engine's equivalent) after successful inserts in `commit_handler_result` and `complete_perspective`. The category is one of: `outbox`, `inbox`, `perspective`.

Postgres dedups `(channel, payload)` pairs at COMMIT — burst inserts collapse to one delivered notification per category. Free win.

## Indexes required

Each engine ships migrations that create the indexes used by the hot-path queries. At minimum:

- Partial index on `wh_outbox(processed_at)` WHERE `processed_at IS NULL`
- Partial index on `wh_inbox(processed_at)` WHERE `processed_at IS NULL`
- Partial index on `wh_perspective_events(processed_at)` WHERE `processed_at IS NULL`
- Index on `wh_outbox(instance_id, lease_expiry)`
- Index on `wh_inbox(instance_id, lease_expiry)`
- Index on `wh_perspective_events(instance_id, lease_expiry)`
- Per-stream index on `wh_outbox(stream_id, created_at)` for ordering

See the Postgres `031_ClaimingIndexes.sql` migration for the reference set.

## Related

- [Implementing IWorkCoordinator](implementing-iworkcoordinator.md)
- [Testing a new engine](testing-a-new-engine.md)
