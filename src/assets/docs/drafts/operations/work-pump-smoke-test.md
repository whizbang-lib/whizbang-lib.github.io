---
title: Work-pump decomposition smoke test
order: 90
---

# Work-pump decomposition smoke test (Phase F)

Runbook for verifying that a multi-service deployment is benefiting from the work-pump
decomposition (Phases A-E). Run this after upgrading services to a Whizbang version that
includes the new SQL function family + worker pipeline.

## Prerequisites

1. **All services upgraded** to the Whizbang version that ships the new SQL functions:
   `claim_work`, `commit_handler_result`, `commit_handler_batch`, `complete_outbox_published`,
   `record_heartbeat`, `complete_perspective`, `report_failures`, `renew_leases`,
   `flush_completions`, `resolve_sync_inquiries`, plus `_emit_event_store_chain`.
2. **Migrations applied** to each service database. Check by running `\df claim_work` in psql.
3. **`AddWhizbang()` called** in each service's `Program.cs` — the worker pipeline
   (HeartbeatWorker, ClaimWorker, BatchFlusher-based flushers, etc.) registers automatically
   via `AddWhizbangWorkers()` invoked from `AddWhizbang()`.

## Connection-string provisioning

Each service needs **one new connection string** named `<dbname>-direct` for the LISTEN
connection that bypasses pgbouncer. Existing pooled connection strings stay unchanged.

| Service | Existing (no change) | New (provision per environment) |
|---|---|---|
| BffService | `ConnectionStrings:bffservice-db` | `ConnectionStrings:bffservice-db-direct` |
| ChatService | `ConnectionStrings:chatservice-db` | `ConnectionStrings:chatservice-db-direct` |
| WorkflowService | `ConnectionStrings:workflowservice-db` | `ConnectionStrings:workflowservice-db-direct` |
| JobService | `ConnectionStrings:jobservice-db` | `ConnectionStrings:jobservice-db-direct` |
| UserService | `ConnectionStrings:userservice-db` | `ConnectionStrings:userservice-db-direct` |
| TaskService | `ConnectionStrings:taskservice-db` | `ConnectionStrings:taskservice-db-direct` |
| NotificationsService | `ConnectionStrings:notificationsservice-db` | `ConnectionStrings:notificationsservice-db-direct` |
| UploadService | `ConnectionStrings:uploadservice-db` | `ConnectionStrings:uploadservice-db-direct` |
| PdfService | `ConnectionStrings:pdfservice-db` | `ConnectionStrings:pdfservice-db-direct` |
| IntegrationsService | `ConnectionStrings:integrationsservice-db` | `ConnectionStrings:integrationsservice-db-direct` |

The direct string is **optional** — services without it run polling-only (still functional,
just higher idle baseline). Roll it out service-by-service if convenient.

The direct string targets the **same database** as the pooled string, but on the
**bypass-pool port** (typically `5432` rather than the pgbouncer port `6432`).

## Smoke-test sequence

### 1. Capture baseline (before deploying the new release)

```bash
# Snapshot pg_stat_statements per service DB.
docker exec jdx-postgres psql -U postgres -d bffservice-db -c "
  SELECT calls, total_exec_time, mean_exec_time, query
  FROM pg_stat_statements
  WHERE query LIKE '%process_work_batch%'
  ORDER BY total_exec_time DESC LIMIT 5;
"

# Container CPU.
docker stats jdx-postgres --no-stream
```

Expect (legacy): ~22 calls/sec/service of `process_work_batch`, ~17 ms mean, ~45% postgres CPU.

### 2. Deploy new release with direct connection strings

```bash
# Pull, apply migrations, restart all services.
git pull
dotnet ef database update  # per service, or via your migration runner
docker compose restart  # or your orchestration equivalent
```

### 3. Reset pg_stat_statements + wait 5 minutes idle

```bash
docker exec jdx-postgres psql -U postgres -c "SELECT pg_stat_statements_reset();"
sleep 300
```

### 4. Capture post-deploy metrics

```bash
docker exec jdx-postgres psql -U postgres -d bffservice-db -c "
  SELECT calls, total_exec_time, mean_exec_time, query
  FROM pg_stat_statements
  WHERE query !~ 'pg_stat'
  ORDER BY total_exec_time DESC LIMIT 20;
"
docker stats jdx-postgres --no-stream
```

### 5. Verify against acceptance criteria

| Metric | Expected | Why |
|---|---|---|
| `claim_work` calls/sec/svc | ≤ 0.5 | Empty-call short-circuit + adaptive backoff. |
| `claim_work` mean exec time | ≤ 1 ms | 4 partial-index `EXISTS LIMIT 1` lookups; sub-ms when buffer-cached. |
| `record_heartbeat` calls/sec/svc | ~0.2 (every 5 s) | Decoupled from polling. |
| `process_work_batch` calls/sec | 0 | Legacy path no longer invoked. |
| Postgres container CPU (idle) | ≤ 2% | Was ~45% on legacy idle stack. |
| Total backend connections per pod | ≤ 51 | 50 pooled + 1 LISTEN direct. |

### 6. Burst-latency check (optional)

```bash
# Emit an outbox message via your usual API path.
curl -X POST https://localhost/api/some-write-endpoint -d '{"...": "..."}'

# Check the stream — published latency should be ≤ 50 ms with direct connection,
# or ≤ 250 ms in polling-only mode. Use your normal observability path.
```

## Rollback

If metrics don't improve or workers crash-loop, the legacy `process_work_batch` SQL function
is still present. To revert C#:

1. Pin Whizbang to the previous version in `Directory.Packages.props`.
2. Restart services.
3. Optionally drop the `<dbname>-direct` connection strings — services run polling-only on
   the pooled string.

The new SQL functions stay in the database (they're additive); they're harmless when
unused.
