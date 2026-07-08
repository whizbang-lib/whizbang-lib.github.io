# SAVEPOINT-batched handler commit

## Status
Accepted (2026-04-25)

## Context

Inbox handlers complete one message at a time today. Each handler invokes `process_work_batch` (now `commit_handler_result`) to atomically: mark the inbox message processed, store any emitted outbox messages, write to the event store, and auto-create perspective events.

That's an fsync per handler. Under load the per-handler fsync floor caps single-instance throughput at ~200 handler/s on commodity hardware. The dispatch loop is otherwise trivial — fsync is the bottleneck.

Naive batching ("commit N handlers in one transaction") trades that for an all-or-nothing failure mode: one handler throwing rolls back N successful handlers. Unacceptable — handler failures must be isolated and reported individually.

## Decision

`commit_handler_batch(p_results jsonb)` accepts an array of handler-completion bundles. For each bundle, the function wraps the work in a PL/pgSQL `BEGIN ... EXCEPTION` block (an implicit savepoint):

```sql
FOR r IN SELECT * FROM jsonb_array_elements(p_results) LOOP
  BEGIN
    -- savepoint implicit
    PERFORM commit_handler_result_inner(r);
    RETURN QUERY SELECT (r ->> 'handler_id')::uuid, true, NULL::text;
  EXCEPTION WHEN OTHERS THEN
    -- rolls back to this iteration's savepoint; siblings unaffected
    RETURN QUERY SELECT (r ->> 'handler_id')::uuid, false, SQLERRM;
  END;
END LOOP;
```

Successful iterations release their savepoints. Failing iterations roll back to their savepoint without affecting siblings. The outer transaction commits all successes with **a single fsync** at the end.

Per-handler results return as `(handler_id, success, error_message)` rows. The C# layer routes failures to `IFailureChannel` for retry tracking; successes get acked normally.

## Consequences

**Wins:**
- Single-instance throughput target: ≥ 2000 handler/s (10× the per-handler-fsync baseline).
- Per-handler isolation preserved — a failing handler can't poison its batch siblings.
- Composable with other batched flushers via `flush_completions` for mixed-category workloads.

**Costs:**
- SQL function complexity. Mitigated by the inner per-handler logic being shared with `commit_handler_result` (the single-handler API).
- Failure detail is reduced to `SQLERRM` in the SQL layer. C# logs the full exception per handler.

**Trade-offs deliberately accepted:**
- All handlers in a batch share the same outer transaction's snapshot. For our workload (independent message handlers writing to different streams) this is irrelevant. If a future handler needed cross-batch read-your-writes, it'd need to opt out of batching.
- A SAVEPOINT failure on one handler still incurs the cost of opening + rolling back its subtransaction. Postgres handles this cheaply (~µs) but it's not free.

## Alternatives considered

- **No batching, just async commit**: Postgres async commit reduces the fsync penalty but loses durability — unacceptable for committed message semantics.
- **Group commit at the application layer**: requires coordinating across handler tasks, harder to reason about partial failure.
- **Per-handler transaction with deferred fsync via `synchronous_commit = off`**: same durability concern as async commit, applies globally.

## Related

- [SQL function decomposition](./sql-function-decomposition.md) — `commit_handler_batch` is one of the 10 new functions
- `BatchFlusher<T>` Nagle pattern — batches handler results in C# before invoking `commit_handler_batch`
