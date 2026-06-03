---
title: Operator HTTP API
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
---

# Operator HTTP API

`MapWhizbangDeadLetterEndpoints` mounts five routes that wrap the SQL
functions from migrations 050 + 051. Operators get a JSON surface for
inspecting `wh_dead_letters` and driving recovery — no psql / raw SQL
required.

## Mounting

```csharp
using Whizbang.Hosting.AspNet;

var app = builder.Build();
// ...
app.MapWhizbangDeadLetterEndpoints();              // default path "/whizbang/dlq"
app.MapWhizbangDeadLetterEndpoints("/admin/dlq");  // custom prefix
```

The method returns the `RouteGroupBuilder` so you can chain authorization,
host filters, and rate limits — recommended before exposing publicly:

```csharp
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

```json
[
  {
    "deadLetterId": "019e8b1d-7e90-77cc-a3c7-ff3469de0f33",
    "sourceTable": "wh_inbox",
    "sourceId": "019e8b1d-7e90-77cc-a3d6-0a826384b4fd",
    "streamId": null,
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
map the enum on the client side.

### `POST /whizbang/dlq/{id}/retry`

Schedules the row for immediate retry (`next_recovery_attempt_at = NOW()`).
The `DeadLetterRecoveryWorker` picks it up on the next tick. Idempotent —
re-issuing the call just re-sets the timestamp.

### `POST /whizbang/dlq/{id}/hold`

Marks the row `HoldForReview` (terminal). The recovery worker skips it
until an operator explicitly re-issues `retry`. Use when you've identified
a bug that needs a code fix before the row can succeed.

### `POST /whizbang/dlq/{id}/give-up`

Marks the row `PermanentlyFailed` (terminal). Use when you've decided the
row is truly unrecoverable. Forensic snapshot stays in the table.

### `POST /whizbang/dlq/scan-now?generation=…`

Manual generation-replay sweep. Schedules every non-terminal DLQ row whose
current generation hasn't seen the supplied generation for immediate
retry. When the query parameter is absent, the configured
`IGenerationProvider.GetGeneration()` is used — typically the running
build's identity.

Response:

```json
{ "generation": "0.502.0-alpha.1", "scheduled": 42 }
```

`scheduled` is the number of rows whose `next_recovery_attempt_at` got
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
