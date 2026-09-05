# Proposal: The System Management Surface

**Status: DRAFT — for review**

## The problem

Operating a Whizbang fleet day to day means answering questions and taking actions that today
require direct database access, per-service HTTP wiring, or kubectl: *"how many dead letters
are held, and in which cohorts?"* — *"release that cohort"* — *"is any service's frontier
stalled?"* — *"which failure shapes are trending this week?"* Every real incident in recent
operational history was worked at the psql prompt. The framework has the data and the
machinery; it lacks a first-class, turnkey management surface.

This proposal defines that surface end to end: **what data**, **what actions**, **how a
single service exposes them**, **how a BFF composes them across the fleet**, and **how each
host flavor turns them on**.

## Design principles

1. **Host-agnostic core.** Every query and action lives on a plain service interface
   (per-service, DI-resolved). HTTP/GraphQL/FastEndpoints are thin adapters over it.
2. **Actions are system commands** (the `RebuildPerspectiveCommand` precedent): PinnedId'd
   control-plane messages on the `whizbang.system.commands` namespace, handled by
   driver-shipped receptors. Any authorized service — including an admin BFF — triggers an
   action with a dispatch, not bespoke HTTP.
3. **Fleet composition is scatter-gather over the fabric**, not N HTTP calls: a broadcast
   query request, per-service responses correlated back to the asker.
4. **Opt-in and authorized.** Nothing is exposed unless the host turns it on, and turning it
   on requires naming an authorization policy. Management surfaces must never ship open.
5. **Read models are stable records** shared by every adapter, so the GraphQL type, the JSON
   endpoint, and the fleet-composed view are the same shape.

## Layer 1 — Per-service data (the queries)

One interface family, grouped by domain. Phase-1 shapes shown; each returns a versioned record.

| Domain | Query | Answers |
|---|---|---|
| **Dead letters** | `DeadLetterStatusSummary` | counts by recovery status, recovered total, held cohorts, recent canary campaigns (verdicts, probes, waves) |
| | `StackAnalytics` | top stacks by `total_occurrences`, first/last seen, daily trend (from `wh_stacks` / `wh_stack_daily`), blast radius by frame |
| | `DeadLetterSearch(filter)` | page of dead letters by fingerprint/stack/type/date — the drill-down behind every summary number |
| **Queues** | `QueueDepths` | inbox/outbox pending, claimable vs leased vs parked, oldest ages, per-stream hot spots (top-N streams by depth) |
| **Workers** | `WorkerPosture` | which workers are running, claim rate, drain-mode, repeat-cycle streak, poison-admission share, debounce watermark age |
| **Integrity** | `IntegrityPosture` | frontier lag per lane, stale origins (checkpoint liveness), ledger divergence count, repair budget state |
| **Perspectives** | `PerspectivePosture` | cursors and lag per perspective, rebuild in progress, **stall detection** (leased-valid rows with zero completions — issue #679's watchdog belongs here) |
| **Fleet (local view)** | `InstanceRoster` | `wh_service_instances`: instances, heartbeats, builds/generations, leases held |
| **Coalescing** | `CoalescePosture` | pending per group, oldest, fold rate |
| **Settings** | `EffectiveSettings` | `wh_settings` values + bound option values actually in effect (the #646 sections) — ends "is the flag really on?" forensics |
| **Schedules** | `TemporalPosture` | pending schedule occurrences, next fire, missed-fire count |

## Layer 2 — Per-service actions (the system commands)

Control-plane commands, driver-side receptors, all PinnedId'd. Existing: `RebuildPerspectiveCommand`,
`CancelPerspectiveRebuildCommand`, `ClearCacheCommand`, `DiagnosticsCommand`, `RequestRedeliveryCommand`.

New (Phase 1 already drafted in code):

| Command | Effect |
|---|---|
| `ReleaseHeldDeadLettersCommand(fingerprint?, staggerMinutes)` | release one held cohort (or all) into recovery with fresh attempts |
| `RequestDeadLetterScanCommand(generation?)` | schedule a recovery sweep now (generation replay, due immediately) |

Planned:

| Command | Effect |
|---|---|
| `PurgeDeadLettersCommand(filter, reason)` | terminal-purge matching dead letters (undeliverable/aged), stamped with operator reason |
| `ParkReleaseCommand(source, filter)` | release deliberately-parked inbox rows (the 30-day parks) or extend the park |
| `RequarantineCommand(fingerprint)` | operator pull-back: return a released cohort to Held |
| `UpdateSettingCommand(key, value)` | write a `wh_settings` key (audited: who/when/old value) — live-tunes the SQL-side knobs |
| `ResetAttemptsCommand(filter)` | clear churn-charged attempts/abandonment stamps (tonight's manual psql surgery, productized with guards: only `error IS NULL` or abandonment-stamped rows) |

Every action logs an audit line (who, what, scope) — daily operations must leave a trail.

## Layer 3 — Fleet scatter-gather (the BFF story)

The piece that makes a fleet-wide admin API one call instead of N:

```
FleetQueryRequest  (QueryKind, CorrelationId, ReplyTo, Filter?)   — broadcast, control-plane
FleetQueryResponse (CorrelationId, ServiceName, InstanceId, Generation, Payload) — directed reply
```

- The asker (BFF) resolves `IFleetStatusCollector.CollectAsync(kind, timeout)`: dispatches the
  broadcast, gathers correlated responses until the window closes, returns
  `FleetView<T> { Responses[], Missing[], Partial }`.
- **Roster problem** (open question below): responders are self-identifying; "who did NOT
  answer" needs an expected roster — configured list, or learned from prior responses with
  staleness marking. Silence must be visible, never folded into an empty success.
- Responses ride the normal fabric as control-plane messages (TTL'd, non-durable — a stale
  status answer has no value; this rides the existing control-class delivery semantics).
- The same mechanism carries **fleet actions**: broadcast `ReleaseHeldDeadLettersCommand` is
  already possible today via the system namespace; the collector adds *acknowledged* fleet
  actions (each service responds with what it did: released N rows).

## Layer 4 — Turning it on per host flavor

One registration per flavor, all requiring an auth policy name:

- **Minimal APIs / plain dotnet** (`Whizbang.Hosting.AspNet`):
  `app.MapWhizbangSystemApi(policy: "ops-admin")` → `/whizbang/system/*` JSON endpoints
  (extends the existing `/whizbang/dlq/*` operator endpoints into the full surface).
- **HotChocolate** (`Whizbang.Transports.HotChocolate`):
  `.AddWhizbangSystemGraph(policy)` → `whizbangSystem { deadLetters { ... } fleet(kind) { ... } }`
  query fields + mutations for the commands.
- **FastEndpoints** (`Whizbang.Transports.FastEndpoints`):
  `AddWhizbangSystemEndpoints(policy)` → same routes as minimal API, FE idioms.

All three bind to the SAME Layer-1 records and Layer-3 collector; a BFF exposes fleet views
by composing `IFleetStatusCollector` into its own API however it likes.

## Daily-operations walkthrough (the acceptance test)

The surface is done when this incident play needs zero psql:

1. Alert fires on `whizbang.dead_letters.held`. Operator opens the BFF admin page →
   fleet `DeadLetterStatusSummary`: which services, which cohorts, what verdicts.
2. Drill into a cohort → `StackAnalytics` + `DeadLetterSearch`: the failure shape, trend,
   sample errors.
3. Judgment call: fix deployed? → `ReleaseHeldDeadLettersCommand` fleet-wide for the cohort;
   watch `whizbang.dead_letters.recovered` climb. Junk? → `PurgeDeadLettersCommand` with reason.
4. Weekly review: `StackAnalytics` daily trend — did last week's fix actually end that shape?

## Phasing

- **P1 (in flight, branch `feat/dlq-system-commands`)**: Release + Scan commands, receptor +
  registrar, `DeadLetterStatusSummary` query, `GET /whizbang/dlq/status`. RED/GREEN, docs.
- **P2**: Fleet scatter-gather (`FleetQueryRequest/Response`, `IFleetStatusCollector`,
  roster + timeout semantics) + fleet DLQ view end to end.
- **P3**: Host adapters — `MapWhizbangSystemApi` full surface; HotChocolate + FastEndpoints
  packages.
- **P4**: Remaining data domains (queues, workers, integrity, perspectives incl. the #679
  watchdog, coalescing, settings, temporal) + remaining commands (purge, park-release,
  requarantine, update-setting, reset-attempts).
- **P5**: Docs site section "Operating Whizbang" + a sample admin BFF wiring.

## Open questions (need decisions)

1. **Roster source** for "who didn't answer": configured service list vs learned-with-staleness?
2. **Authorization model** for system COMMANDS on the fabric (not just the HTTP adapters):
   scope claim (e.g. a `sys-admin` scope on the envelope) vs allow-listed origin services?
   Today any service can dispatch a system command — fine for infra, not for `Purge`.
3. **UpdateSettingCommand blast radius**: settings are per-service DB; fleet-broadcast a
   setting write, or per-service only?
4. **Response transport for scatter-gather**: directed reply topic per asker vs the asker's
   normal inbox with correlation filtering?
5. Does the **lens** term want a literal perspective-backed read model for dead-letter status
   (queryable via ILensQuery like any projection), or is the service-query + adapters enough?
