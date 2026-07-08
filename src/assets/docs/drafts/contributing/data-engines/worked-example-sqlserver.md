---
title: Worked example - SQL Server (high-capability)
order: 7
---

# Worked example: SQL Server engine

A walk-through of adding SQL Server as a Whizbang engine. SQL Server is the **high-capability** test case — it has equivalents for nearly all of Postgres's features, just expressed differently.

## Capability declaration

```csharp
public sealed class SqlServerCapabilities : IWorkCoordinatorCapabilities {
  public string EngineName => "sqlserver";
  public bool SupportsServerSideNotifications => true;   // Service Broker
  public bool SupportsBulkCopy => true;                   // BULK INSERT / SqlBulkCopy
  public bool SupportsAdvisoryLocks => true;              // sp_getapplock
  public bool SupportsNativeArrayParameters => false;     // No array type — TVPs instead
  public bool SupportsListenOverPooler => true;            // Service Broker has its own session model
  public bool SupportsSavepoints => true;                  // SAVE TRANSACTION
}
```

## Engine equivalents

| Postgres | SQL Server | Notes |
|---|---|---|
| `NOTIFY` / `LISTEN` | Service Broker `CREATE QUEUE` + `WAITFOR (RECEIVE …)` | More setup but reliable in-DB pub/sub. |
| `pg_notify(channel, payload)` | `BEGIN DIALOG ... SEND ON CONVERSATION ...` | Heavier per-message but supports persistence. |
| `UUID[]` parameter | TVP (Table-Valued Parameter) | Pass `IEnumerable<SqlDataRecord>` from C#. |
| `JSONB` | `NVARCHAR(MAX)` with `OPENJSON` | Json functions ship in 2016+. |
| `FOR UPDATE SKIP LOCKED` | `WITH (READPAST, UPDLOCK, ROWLOCK)` | Same lock-and-skip semantics. |
| `pg_advisory_lock` | `sp_getapplock` | Both are cooperative; both block until acquired. |
| `RETURNING` clause | `OUTPUT` clause | Equivalent. |
| `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` | `SAVE TRANSACTION` / `ROLLBACK TRANSACTION sp` | Same semantics; different keywords. |
| `gen_random_uuid()` | `NEWSEQUENTIALID()` (UUIDv1-ish) or compute UUIDv7 in C# | UUIDv7 isn't native; generate client-side. |
| `EXISTS (SELECT 1 ... LIMIT 1)` | `IF EXISTS (SELECT 1 ... )` | Same idea; SQL Server doesn't need `LIMIT 1` inside `EXISTS`. |

## SQL function differences

The 9 Whizbang SQL functions need rewriting in T-SQL. The Postgres reference (`Whizbang.Data.Postgres/Migrations/`) is the source contract.

### `claim_work` example

```sql
-- claim_work in T-SQL
CREATE PROCEDURE claim_work
  @p_instance_id UNIQUEIDENTIFIER,
  @p_service_name NVARCHAR(200),
  @p_host_name NVARCHAR(200),
  @p_process_id INT,
  @p_max_streams INT = 1000,
  @p_partition_count INT = 10000,
  @p_lease_seconds INT = 300
AS
BEGIN
  SET NOCOUNT ON;

  -- Empty-call short-circuit: same pattern, IF EXISTS instead of EXISTS LIMIT 1.
  IF NOT EXISTS (SELECT TOP 1 1 FROM wh_outbox WHERE processed_at IS NULL)
     AND NOT EXISTS (SELECT TOP 1 1 FROM wh_inbox WHERE processed_at IS NULL)
     AND NOT EXISTS (SELECT TOP 1 1 FROM wh_perspective_events WHERE processed_at IS NULL)
     AND NOT EXISTS (SELECT TOP 1 1 FROM wh_receptor_processing WHERE completed_at IS NULL)
  BEGIN
    RETURN;
  END

  -- ... claim_orphaned_outbox / inbox / perspective_events / receptor (T-SQL versions)
  -- ... return work via SELECT INTO / OUTPUT clauses
END
```

### `commit_handler_batch` with SAVE TRANSACTION

```sql
CREATE PROCEDURE commit_handler_batch
  @p_results NVARCHAR(MAX)  -- JSON array of handler bundles
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @results TABLE (handler_id UNIQUEIDENTIFIER, success BIT, error_message NVARCHAR(MAX));

  DECLARE @ord INT, @count INT;
  SELECT @count = JSON_QUERY(@p_results, '$').count;
  SET @ord = 0;

  WHILE @ord < @count
  BEGIN
    DECLARE @handler_id UNIQUEIDENTIFIER = JSON_VALUE(@p_results, FORMATMESSAGE('$[%d].handler_id', @ord));
    SAVE TRANSACTION sp_handler;
    BEGIN TRY
      EXEC commit_handler_result @bundle = @p_results;  -- pass element JSON
      INSERT INTO @results VALUES (@handler_id, 1, NULL);
    END TRY
    BEGIN CATCH
      ROLLBACK TRANSACTION sp_handler;  -- rolls back ONLY this handler's effects
      INSERT INTO @results VALUES (@handler_id, 0, ERROR_MESSAGE());
    END CATCH
    SET @ord = @ord + 1;
  END

  SELECT handler_id, success, error_message FROM @results;
END
```

## Service Broker listener

The C# notification listener uses a `WAITFOR (RECEIVE ...)` against a Service Broker queue:

```csharp
public sealed class SqlServerWorkNotificationListener : BackgroundService, IWorkNotificationListener {
  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    await using var conn = new SqlConnection(_options.DirectConnectionString);
    await conn.OpenAsync(stoppingToken);

    while (!stoppingToken.IsCancellationRequested) {
      try {
        await using var cmd = new SqlCommand(
          "WAITFOR (RECEIVE TOP(1) message_body FROM dbo.wh_work_queue), TIMEOUT 30000",
          conn);
        var payload = await cmd.ExecuteScalarAsync(stoppingToken) as string;
        if (payload is not null) {
          var category = payload switch {
            "outbox" => WorkSignalCategory.Outbox,
            "inbox" => WorkSignalCategory.Inbox,
            "perspective" => WorkSignalCategory.Perspective,
            _ => (WorkSignalCategory?)null
          };
          if (category is { } cat) OnSignal?.Invoke(cat);
        }
      } catch (Exception ex) when (ex is not OperationCanceledException) {
        _setHealthy(false);
        // ... reconnect with exponential backoff
      }
    }
  }
}
```

The "send" side is in the SQL functions:
```sql
DECLARE @dialog_handle UNIQUEIDENTIFIER;
BEGIN DIALOG CONVERSATION @dialog_handle
  FROM SERVICE [//whizbang/notify-service]
  TO SERVICE '//whizbang/notify-service'
  ON CONTRACT [//whizbang/notify-contract]
  WITH ENCRYPTION = OFF;
SEND ON CONVERSATION @dialog_handle MESSAGE TYPE [//whizbang/work-notification] (N'outbox');
END CONVERSATION @dialog_handle;
```

(Service Broker setup is non-trivial — requires `CREATE MESSAGE TYPE`, `CREATE CONTRACT`, `CREATE SERVICE`, `CREATE QUEUE` ahead of time. Documented in the SQL Server engine's migration scripts.)

## TVPs replace native arrays

Where Postgres takes `UUID[]`, SQL Server takes a TVP:

```sql
CREATE TYPE dbo.uuid_array AS TABLE (id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY);

CREATE PROCEDURE complete_outbox_published
  @p_ids dbo.uuid_array READONLY
AS
BEGIN
  UPDATE wh_outbox SET processed_at = SYSUTCDATETIME(), status = status | 4
  WHERE message_id IN (SELECT id FROM @p_ids) AND processed_at IS NULL;
  RETURN @@ROWCOUNT;
END
```

C# binding:

```csharp
public async Task<int> CompleteOutboxPublishedAsync(IReadOnlyList<Guid> ids, CancellationToken ct = default) {
  var dt = new DataTable();
  dt.Columns.Add("id", typeof(Guid));
  foreach (var id in ids) dt.Rows.Add(id);

  await using var cmd = new SqlCommand("complete_outbox_published", conn) {
    CommandType = CommandType.StoredProcedure
  };
  var p = cmd.Parameters.AddWithValue("@p_ids", dt);
  p.SqlDbType = SqlDbType.Structured;
  p.TypeName = "dbo.uuid_array";

  return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
}
```

## Workers don't change

`ClaimWorker`, `HeartbeatWorker`, `BatchFlusher<T>`, `OutboxCompletionFlushWorker`, etc. all consume `IWorkCoordinator` polymorphically. They work on SQL Server through the SqlServer impl with no changes.

## DI registration

```csharp
services.AddWhizbang().WithEFCore<MyDbContext>().WithDriver.SqlServer(opts => {
  opts.PooledConnectionString = "Server=...;Database=...;...";
  opts.Notifications.DirectConnectionString = "Server=...;Database=...;ApplicationIntent=ReadWrite;...";
});
services.AddWhizbangSqlServerNotifications();  // registers SqlServerWorkNotificationListener
services.AddWhizbangWorkers();  // registers HeartbeatWorker, ClaimWorker, flush workers, etc.
```

## Conformance tests

Run the standard Whizbang test suite against your SQL Server implementation. The contract is engine-agnostic — same SQL function behaviors, same `IWorkCoordinator` semantics. Differences:

- TVP marshalling (vs Postgres native arrays).
- Service Broker setup overhead in test fixtures.
- UUIDv7 generation client-side (no native server-side equivalent).
- Smaller integer max sizes (Postgres `INT8` vs SQL Server `BIGINT`) — usually a no-op.

## Related

- [Overview](overview.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Implementing notifications](implementing-notifications.md)
- [Worked example - SQLite (polling-only)](worked-example-sqlite.md)
