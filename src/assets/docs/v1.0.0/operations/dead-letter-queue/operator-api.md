---
title: Operator HTTP API
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Dead-Letter Queue
order: 3
description: >-
  HTTP endpoints in Whizbang.Hosting.AspNet for inspecting and acting on
  wh_dead_letters from operator tooling — list, retry, hold, give-up,
  manual generation sweep.
tags: >-
  dead-letter-queue, operator-api, MapWhizbangDeadLetterEndpoints, http
codeReferences:
  - src/Whizbang.Hosting.AspNet/DeadLetterOperatorEndpoints.cs
  - src/Whizbang.Core/Messaging/IDeadLetterRecoveryService.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Data.Postgres/Migrations/051_DeadLetterRecovery.sql
testReferences:
  - tests/Whizbang.Hosting.AspNet.Tests/DeadLetterOperatorEndpointsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDeadLetterRecoveryServiceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DeadLetterRecoverySqlTests.cs
---

# Operator HTTP API

`MapWhizbangDeadLetterEndpoints` mounts five routes that wrap the SQL
functions from migrations 050 + 051. Operators get a JSON surface for
inspecting `wh_dead_letters` and driving recovery — no psql / raw SQL
required.

## Mounting

```csharp{
title: "Mount the DLQ operator endpoints"
description: "Registers the five wh_dead_letters HTTP routes on the app, optionally under a custom path prefix, so operators can drive recovery over JSON."
framework: "NET10"
category: "Operations"
difficulty: "BEGINNER"
tags: ["dead-letter", "operator-api", "MapWhizbangDeadLetterEndpoints", "aspnet"]
}
using Whizbang.Hosting.AspNet;

var app = builder.Build();
// ...
app.MapWhizbangDeadLetterEndpoints();              // default path "/whizbang/dlq"
app.MapWhizbangDeadLetterEndpoints("/admin/dlq");  // custom prefix
```

The method returns the `RouteGroupBuilder` so you can chain authorization,
host filters, and rate limits — recommended before exposing publicly:

```csharp{
title: "Secure the DLQ endpoints with authorization and host filters"
description: "Chains RequireAuthorization and RequireHost onto the returned RouteGroupBuilder so the recovery surface is locked down before it is exposed publicly."
framework: "NET10"
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "operator-api", "authorization", "security", "aspnet"]
}
app.MapWhizbangDeadLetterEndpoints()
   .RequireAuthorization("WhizbangOperator")
   .RequireHost("admin.example.com");
```

## Endpoints

All responses are JSON; mutation endpoints return `204 No Content` on success.

### `GET /whizbang/dlq/due?max=200`

Returns up to `max` rows ready for recovery (skips terminal states
`Recovered`, `PermanentlyFailed`, `HoldForReview` and rows whose
`operator_disposition` is `HoldIndefinitely` / `MarkPermanentlyFailed`).
Default `max=200`.

Response shape (`DeadLetterEntry` array):

```json{
title: "DeadLetterEntry response from GET /whizbang/dlq/due"
description: "JSON shape returned by the due endpoint for each recoverable wh_dead_letters row, including failureReason, generation, and recovery bookkeeping fields."
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "operator-api", "DeadLetterEntry", "json-response"]
}
[
  {
    "deadLetterId": "019e8b1d-7e90-77cc-a3c7-ff3469de0f33",
    "sourceTable": "wh_inbox",
    "sourceId": "019e8b1d-7e90-77cc-a3d6-0a826384b4fd",
    "streamId": "019e8b1d-7e90-77cc-a3e1-1c5f2a7b9d02",
    "messageType": "MyApp.InventoryAdjustCommand",
    "failureReason": 5,
    "attemptsWhenDlq": 10,
    "deadLetteredAt": "2026-06-02T12:34:56Z",
    "recoveryStatus": 0,
    "recoveryAttempts": 0,
    "generation": "0.502.0-alpha.1"
  }
]
```

`failureReason` is the integer value of `MessageFailureReason`
(e.g. `5 = MaxAttemptsExceeded`, `8 = Throttled`). Consumers should
map the enum on the client side. Null-valued fields (e.g. `streamId`
for singleton-stream messages) are omitted from the JSON — the context
uses `JsonIgnoreCondition.WhenWritingNull`. Rows come back FIFO-ordered
by `dead_lettered_at`.

### `POST /whizbang/dlq/{id}/retry`

Schedules the row for immediate retry — `next_recovery_at = NOW()` and
`recovery_status` back to `Pending`, so it also resurrects a held row.
The `DeadLetterRecoveryWorker` picks it up on the next scan (within
milliseconds when the `DeadLetterReady` NOTIFY signal is wired — migration
056 — otherwise on the next backstop tick). Idempotent — re-issuing the
call just re-sets the timestamp.

### `POST /whizbang/dlq/{id}/hold`

Marks the row `HoldForReview` (terminal). The recovery worker skips it
until an operator explicitly re-issues `retry`. Use when you've identified
a bug that needs a code fix before the row can succeed.

### `POST /whizbang/dlq/{id}/give-up`

Marks the row `PermanentlyFailed` (terminal). Use when you've decided the
row is truly unrecoverable. Forensic snapshot stays in the table.

### `POST /whizbang/dlq/scan-now?generation=…`

Manual generation-replay sweep (`reset_dead_letters_for_generation`).
Schedules every DLQ row that hasn't yet been retried on the supplied
generation for immediate retry — excluding `PermanentlyFailed` rows and
rows whose operator disposition is `HoldIndefinitely`. `HoldForReview`
rows ARE included: the sweep returns them to `Pending`, so a new
generation gives held rows one fresh attempt. When the query parameter
is absent, the configured `IGenerationProvider.GetGeneration()` is used
— typically the running build's identity.

Response:

```json{
title: "Response from POST /whizbang/dlq/scan-now"
description: "Reports the generation swept and how many non-terminal DLQ rows were rescheduled for immediate retry by the manual generation-replay sweep."
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "operator-api", "generation-replay", "scan-now"]
}
{ "generation": "0.502.0-alpha.1", "scheduled": 42 }
```

`scheduled` is the number of rows whose `next_recovery_at` got
reset. Idempotent: rows already in `retried_on_generations` for this
generation are skipped.

## AOT compatibility

The endpoints use a source-generated `JsonSerializerContext`
(`DeadLetterOperatorJsonContext`) — no reflection-based JSON serialization,
so they're safe for Native AOT publication. Custom response types added to
the endpoint group need to be added to the context too.

## See also

- [Internal DLQ table](./internal-dlq)
- [Recovery worker + policy matrix](./recovery)
