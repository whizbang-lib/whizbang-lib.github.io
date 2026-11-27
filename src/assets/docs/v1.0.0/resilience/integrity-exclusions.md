---
title: Integrity Exclusions
pageType: guide
version: 1.0.0
category: Resilience
order: 5
description: Exclude received events from integrity checks with a reason, an author and a time, and reverse it. An escape hatch for events a defect made unresolvable, never a repair.
tags: 'stream-integrity, exclusions, escape-hatch, operator, audit, eligibility-rule, rolling-upgrade'
codeReferences:
  - src/Whizbang.Core/Messaging/IntegrityExclusions.cs
  - src/Whizbang.Core/Messaging/EventFlags.cs
  - src/Whizbang.Core/Messaging/OriginPositions.cs
  - src/Whizbang.Data.Postgres/PostgresIntegrityExclusions.cs
  - src/Whizbang.Data.Postgres/IntegrityExclusionStep.cs
  - src/Whizbang.Data.Postgres/IntegrityExclusionStore.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityExclusionAdjustment.cs
  - src/Whizbang.Hosting.AspNet/IntegrityExclusionEndpoints.cs
  - src/Whizbang.Rules/EligibilitySql.cs
  - src/Whizbang.Rules/RuleSemantics.cs
  - src/Whizbang.Data.Postgres/Migrations/662_TheEligibilityRuleLeavesOutExcludedEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/663_AnOperatorCanExcludeReceivedEventsFromIntegrity.sql
---

# Integrity exclusions

An operator can mark received events so the [stream integrity](/v1.0.0/resilience/stream-integrity) engine stops
resolving them: no comparison, no origin-position request, no hold, no heal, no "unknown" answer. Each mark records a
reason, who asked and when, is written to an audit log, and can be reversed.

## An escape hatch, not a fix {#an-escape-hatch-not-a-fix}

An exclusion repairs nothing. It stops the engine from working on, holding or alarming about events it cannot resolve,
so that what is left on the dashboards is news. Use it:

- **to fence off a defect until its fix ships**, when a bug makes a set of events unresolvable and the engine would
  otherwise keep asking, holding and healing around them;
- **to draw a line under old history**, recorded under earlier rules, that has no value worth resolving.

Never use it when a fix is possible. When a release can repair the events (as the one-off restoration of
[events written here](/v1.0.0/resilience/stream-integrity#events-written-here-returned) does), let it: the API refuses
to mark an event whose first hop names this service, which that restoration returns to the local lane.

## What can be excluded {#what-can-be-excluded}

Only **received history this service stores**. A mark is refused, with its reason in the outcome, for:

| Outcome | Why |
| --- | --- |
| `own_event` | The event is this service's own (no origin, or this service's id). Its consumers compare against what it answers, so excluding it here would show as a mismatch at every consumer. A selection naming this service as its origin is refused outright. |
| `written_here` | The event is recorded under another origin, but its first hop names this service: it was written here. |
| `not_stored` | This service does not store the event. Excluding events a service is missing is an open question, [#2616](https://github.com/whizbang-lib/whizbang/issues/2616); until it is decided, a missing event stays counted. |
| `superseding` | A superseding event's digest counts its key, not the event, so the event alone cannot be removed from its origin's answer. |
| `already_excluded` | Nothing to do. |

A mark is local to the service that made it. An envelope's flags are not part of what goes on the wire, so a mark
never reaches another service, and nothing another service sends can mark an event here.

## How both sides agree {#cross-service-agreement}

Both sides of a comparison fold the same events by identity: an event's digest lanes depend on its id only. An
exclusion is made on the receiving side and the origin is told nothing, so the receiver removes the event from **both**
sides of every comparison itself:

- **Its own side.** The row carries `EventFlags.IntegrityExcluded` (256), and the one
  [eligibility rule](/v1.0.0/resilience/stream-integrity#one-eligibility-rule) every fold reads leaves it out: stream
  digests, sealed epochs, the held fold and checkpoint counts. Marking refolds exactly what it changed.
- **The origin's side.** The mark records where the origin holds the event, and every origin answer has the event's
  lanes and count removed before it is compared. This happens in one place,
  `IntegrityExclusionAdjustment`, which every comparison goes through (a source guard test fails one that does not):
  type roll-ups, windowed answers (only the marks the origin holds inside the window), the stream drill-down, the
  full-history compare, re-checks, heals, and checkpoint counts.

### Where the origin holds it {#where-the-origin-holds-it}

Where the origin holds the event is one of three states:

| State | Meaning | What the comparison does |
| --- | --- | --- |
| held | The row carries the origin's commit sequence. | Removes the event from the origin's answer. |
| unknown | The origin answered that it never wrote the event, or no longer holds it (the shape of #2573). | Nothing to remove: the event is out of this side's folds and absent from the origin's. |
| pending | Neither yet. The mark is asked of the origin through the [origin-position exchange](/v1.0.0/resilience/stream-integrity#filling-missing-origin-positions), and the answer settles it. | The bucket is undecided: compared, never repaired, never sealed. |

An origin's answer names the bucket it counts each event in (`OriginPosition`'s optional `TenantScope`, `EventType` and
`StreamId`), so a mark is removed from the bucket the origin actually counts it in. An origin on a release before
these fields leaves them out, and the mark takes the bucket of the stored row. An excluded event's own position is not
filled by the answer, because a fill can reorder a stream and rewind its perspectives.

### Marking and unmarking {#marking-and-unmarking}

Marking sets the flag, takes the event out of its stream digest (an emptied bucket is removed), refolds the sealed
epochs of its origin lane that counted it, records where the origin holds it, and removes its recorded unknown answer
(the event is resolved by decision). Unmarking is the exact inverse. Both run under the streams' append locks.

Marking also removes the repair-ledger rows of the buckets it touched, so the repair drain never asks again for an
excluded event; the next comparison records a divergence only if one remains after the adjustment.

## The API {#the-api}

`IIntegrityExclusions` is registered by both Postgres drivers.

```csharp{title="Exclude, reverse and summarize" description="A dry run of everything unresolved before a time, reversing one request, and the summary" category="Operations" difficulty="INTERMEDIATE" tags=["Stream Integrity", "Exclusions", "Operations"]}
var result = await exclusions.ExcludeAsync(new IntegrityExclusionRequest {
  Reason = "pre-1.0 history recorded under older rules",
  RequestedBy = "operator-a",
  Selection = new IntegrityExclusionSelection {
    Unresolved = IntegrityUnresolved.All,
    Until = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero),
  },
  DryRun = true,
});

await exclusions.UnexcludeAsync(new IntegrityUnexclusionRequest {
  Reason = "the fix shipped",
  RequestedBy = "operator-a",
  RequestId = earlierRequestId,
});

var summary = await exclusions.SummarizeAsync();
```

- **By ids or by selection, never both.** A reason and who asked are required.
- **Up to `InlineLimit` ids are marked at once** and the outcomes returned. More ids, and every selection, are queued;
  the call returns the request id and the maintenance step applies it.
- **A dry run** counts what would be marked and refused, per origin, and marks nothing (see
  [a dry run first](#a-dry-run-first)).
- **Unexclude** by ids, by the request that made the marks, or by origin (optionally narrowed to types). It is the
  exact inverse of a mark: the flag goes, the events are folded back, the marks and their ledger rows go, and the
  engine resolves the events again from scratch.

### Selections {#selections}

A selection names an origin, stored event types and a `From`/`Until` range of when the events were stored. Every
condition given must hold. Selections never pick this service's own events.

### The past: everything unresolved before a time {#the-past-everything-unresolved-before-a-time}

`Unresolved` selects what the engine currently cannot resolve, before `Until`:

| Flag | Selects |
| --- | --- |
| `UnknownAnswers` | Events whose origin answered that it does not know them, recorded before `Until`. |
| `Undecided` | Events held without their origin's commit sequence, stored before `Until`. |
| `Unhealed` | The stored events of repair-ledger stream buckets marked unhealable or exhausted, first seen before `Until`. The events such a bucket is missing are not stored here and stay counted ([#2616](https://github.com/whizbang-lib/whizbang/issues/2616)). |
| `All` | All three. |

### A dry run first {#a-dry-run-first}

Run a selection as a dry run first, read the counts per origin and outcome, then repeat it without `DryRun`. A dry run
reads the selection (bounded windows of the store, as the step does) and stops at 100,000 events, saying so with
`Capped`.

### The summary {#the-summary}

`SummarizeAsync` (and `GET {prefix}`) answers, per origin with any mark, how many events are excluded, how many are
pending an answer from the origin, how many the origin does not know, when the last mark was made, and how many
requests are still queued.

## The operator endpoints {#the-operator-endpoints}

Opt-in, beside the [dead-letter](/v1.0.0/operations/dead-letter-queue/operator-api) and
[redelivery](/v1.0.0/resilience/stream-integrity#operator-redelivery) endpoints, and like them unauthenticated until the
host requires authorization on the returned group:

```csharp{title="Mapping the operator endpoints" description="The opt-in exclusion endpoints, behind the host's authorization" category="Operations" difficulty="BEGINNER" tags=["Stream Integrity", "Exclusions", "ASP.NET Core"]}
app.MapWhizbangIntegrityExclusionEndpoints()          // "/whizbang/integrity/exclusions"
   .RequireAuthorization("operators");
```

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /whizbang/integrity/exclusions` | `{ "reason", "requestedBy", "eventIds"?, "selection"?, "dryRun"? }` | `200` with the outcomes (applied at once, or a dry run), `202` with the request id (queued), `400` with the reason |
| `POST /whizbang/integrity/exclusions/unmark` | `{ "reason", "requestedBy", "eventIds"?, "requestId"?, "originServiceId"?, "eventTypes"? }` | the same |
| `GET /whizbang/integrity/exclusions?origin={id}` | | the summary |

```json{title="A dry run over HTTP" description="The body that counts everything unresolved before a time, marking nothing" category="Operations" difficulty="BEGINNER" tags=["Stream Integrity", "Exclusions", "HTTP"]}
{ "selection": { "unresolved": "All", "until": "2026-11-01T00:00:00Z" },
  "reason": "pre-1.0 history recorded under older rules", "requestedBy": "operator-a", "dryRun": true }
```

### Requests and the maintenance step {#requests-and-the-maintenance-step}

Queued requests are applied by `IntegrityExclusionStep`, as archive restore requests are: in the maintenance cycle,
under the maintainer duty, idle-gated, oldest request first, at most ten batches of `BatchSize` events a cycle. A
request whose batch fails is marked `Failed` with the error and the others go on. Marking is never on a receive path.

## The audit log {#the-audit-log}

Every mark and unmark writes `wh_integrity_exclusion_log`: the action, the origin, the request, how many events, the
reason and who asked, per origin and batch. It is append-only; rows older than `LogRetention` are removed by the step.
Each batch also logs a **Warning** per origin naming the count, the reason and who asked; refusals are logged with
their reasons. Exclusions are not emitted as audited system events.

## Metrics {#metrics}

| Instrument | Kind | Meaning |
| --- | --- | --- |
| `whizbang.stream_integrity.excluded_events` | Gauge, per `origin_service_id` | Received events excluded, from the per-origin counts |
| `whizbang.stream_integrity.exclusions_pending` | Gauge, per `origin_service_id` | Marks whose place at the origin is not known yet; their buckets are undecided |
| `whizbang.stream_integrity.exclusions_marked` | Counter, per `origin` | Events marked |
| `whizbang.stream_integrity.exclusions_unmarked` | Counter, per `origin` | Marks reversed |

## Cost {#cost}

- **Folds** pay one more bit test inside the eligibility expression they already evaluate. No index changed, no join.
- **Comparisons** issue one indexed read of the marks per origin answer; for an origin with no marks it is one index
  probe that returns nothing.
- **Marking** is batched, bounded and idle-gated.

## The pause while services run different rules versions {#the-mixed-version-pause}

Testing the flag changes the eligibility rule, so `RuleSemantics.ELIGIBILITY_SQL_VERSION` moved from 1 to 2 and the
rules library's own version track (`src/Whizbang.Rules/rules-version.txt`) moved to `4.0.0`. The
[pair guard](/v1.0.0/resilience/stream-integrity#the-pair-guard) compares what the rules mean (the rules versions and
each shared type's rule hash), never the package version, so an ordinary upgrade pauses nothing. Only a real change in
the rules, like this one, does.

All instances of one service deploy together; different services may not. So while one service of a pair runs a
release before this one and the other runs this one or later, **the pair is paused**: nothing is compared, verified,
repaired or redelivered, so nothing is falsely repaired, and it resumes on its own with the first message after both
sides run the same rules version. This is an expected state between services that upgrade separately, not a fault, so
it is reported apart from a real halt:

- one **Warning** per paused pair, "Integrity paused for the pair with '...'", naming both sides' rules versions;
- `whizbang.stream_integrity.pair_rules_version_pauses` counting the pause (tagged by side), and
  `whizbang.stream_integrity.pair_state` reporting the pair `paused` (a real halt reports `halted`);
- once the pause outlasts `PairGuard:HaltedAlertAfter` (two hours by default), one more **Warning**, "still paused", and
  `whizbang.stream_integrity.pair_rules_version_pause_alerts`. **Never** the Critical pair-halt alert or
  `pair_halt_alerts`, which stay for pairs that disagree on a type's rules or send no rules at all.

It lasts until both services of the pair run version 2. Shipping the rules library on its own version, so a rules
change can be rolled out ahead of everything else, is the remaining packaging step:
[#2378](https://github.com/whizbang-lib/whizbang/issues/2378). Comparing a mixed pair under the older rule instead of
pausing is open question [#2615](https://github.com/whizbang-lib/whizbang/issues/2615); every version's rule text is
kept in `Whizbang.Rules` so that option can be added.

## Configuration {#configuration}

`Whizbang:StreamIntegrity:Exclusions`:

| Key | Default | Meaning |
| --- | --- | --- |
| `BatchSize` | `1000` | Events one maintenance batch marks or unmarks. At least 1. |
| `InlineLimit` | `100` | The most ids a call marks at once; more are queued. `0` queues every call. |
| `LogRetention` | `365.00:00:00` | How long the audit log and finished requests are kept. Must be positive. |

See the [configuration reference](/v1.0.0/operations/configuration/configuration-reference).
