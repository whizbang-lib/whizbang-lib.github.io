---
title: Implementing IWorkCoordinator
order: 2
---

# Implementing `IWorkCoordinator`

`IWorkCoordinator` is the central contract between Whizbang's worker layer and your engine. 11 methods, each a thin wrapper around a SQL function.

## Method-by-method

| Method | Calls SQL function | Notes |
|---|---|---|
| `ClaimWorkAsync` | `claim_work` | Hot path — only the polling claim worker calls this. |
| `CommitHandlerResultAsync` | `commit_handler_result` | Atomic transactional bundle. |
| `CommitHandlerBatchAsync` | `commit_handler_batch` | SAVEPOINT-per-handler isolation. |
| `CompleteOutboxPublishedAsync` | `complete_outbox_published` | Coalesced batch flush. |
| `CompletePerspectiveAsync` | `complete_perspective` | Cursor advance + event-row deletion. |
| `ReportFailuresAsync` | `report_failures` | Category-aware. |
| `RenewLeasesAsync` | `renew_leases` | Per-category. |
| `RecordHeartbeatAsync` | `record_heartbeat` | Decoupled timer. |
| `FlushCompletionsAsync` | `flush_completions` | Composite multi-category. |
| `ResolveSyncInquiriesAsync` | `resolve_sync_inquiries` | Read-only. |
| `ProcessWorkBatchAsync` | `process_work_batch` (legacy) | Kept until callers migrate; can be left throwing once unreferenced. |

Plus a few existing operations carried over: `DeregisterInstanceAsync`, `GatherStatisticsAsync`, `StoreInboxMessagesAsync`, `RecomputePartitionNumbersAsync`, `ReportPerspectiveCompletionAsync`, `ReportPerspectiveFailureAsync`, `GetPerspectiveCursorAsync`, `GetPerspectiveCursorsBatchAsync`, `RecordLifecycleCompletionAsync`. These wrap pre-existing SQL functions and don't change in the decomposition.

## The default-throws pattern

Each new method has a default interface implementation that throws `NotImplementedException`. Existing implementations (test fakes, in-memory) opt-in only when they're ready. Pattern:

```csharp
Task<int> CompleteOutboxPublishedAsync(IReadOnlyList<Guid> ids, CancellationToken ct = default)
  => throw new NotImplementedException(
    $"{GetType().Name} does not implement CompleteOutboxPublishedAsync.");
```

Production implementations override; the default-throws keeps existing code that doesn't call the new methods working unchanged.

## Reference EF Core implementation

See `Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs` for the full Postgres reference. Each method follows the same shape:

```csharp
public async Task<int> CompleteOutboxPublishedAsync(IReadOnlyList<Guid> ids, CancellationToken ct = default) {
  ArgumentNullException.ThrowIfNull(ids);
  if (ids.Count == 0) return 0;

  var schema = GetSchemaWithFallback(/* from DbContext */);
  var functionName = BuildSchemaQualifiedName(schema, "complete_outbox_published");
  var idArray = ids is Guid[] arr ? arr : [.. ids];

  var conn = _dbContext.Database.GetDbConnection();
  if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
  await using var cmd = conn.CreateCommand();
  cmd.CommandText = $"SELECT {functionName}(@p_ids)";
  cmd.Parameters.Add(new NpgsqlParameter("p_ids",
    NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = idArray });
  var result = await cmd.ExecuteScalarAsync(ct);
  return Convert.ToInt32(result, CultureInfo.InvariantCulture);
}
```

Substitute your engine's connection / command / parameter types. Key points:

- **Always validate inputs** with `ArgumentNullException.ThrowIfNull`.
- **Short-circuit empty inputs** before opening a connection — saves a round-trip.
- **Use the engine's connection from the DbContext** (don't open new connections per call).
- **Honor cancellation** at every async boundary.

## JSON shape conventions

The SQL functions read PascalCase JSON keys (legacy choice — `MessageId`, `Destination`, `Status`, `EventWorkId`, `Envelope`, etc.). Build payloads accordingly:

```csharp
private string _buildHandlerCommitPayload(HandlerCommitRequest request) {
  var sb = new StringBuilder("{");
  sb.Append("\"handler_id\":\"").Append(request.HandlerId).Append('"');
  sb.Append(",\"instance_id\":\"").Append(request.InstanceId).Append('"');
  // ...
  sb.Append(",\"inbox_completion\":{")
    .Append("\"MessageId\":\"").Append(request.InboxCompletion.MessageId).Append("\",")
    .Append("\"Status\":").Append(request.InboxCompletion.Status)
    .Append('}');
  // ...
  return sb.ToString();
}
```

For new engines that don't share JSON shape with Postgres, you can either:
1. Match Whizbang's existing PascalCase convention (recommended — minimum friction).
2. Have your engine's SQL functions accept your engine's idiomatic shape, and translate in the C# binding layer.

## AOT compatibility

`Whizbang.Core` requires zero reflection / source-gen-only JSON. `JsonSerializer.Serialize<T>` is **not** AOT-safe for unknown `T`. For known shapes, generate a `JsonSerializerContext` per type. For ad-hoc values (the JsonElement metadata on records), use `JsonElement.GetRawText()` directly.

## Related

- [SQL function contracts](sql-function-contracts.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Testing a new engine](testing-a-new-engine.md)
