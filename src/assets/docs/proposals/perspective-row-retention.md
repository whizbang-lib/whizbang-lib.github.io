---
title: Perspective Row Retention (RowTtl)
category: Architecture & Design
order: 31
tags: perspectives, retention, row-ttl, reaper, rebuild, rewind, resurrection, read-models, storage-economy
---

# Perspective Row Retention (`[RowTtl]`)

[Ephemeral Events](ephemeral-events) gave the **event log** a retention policy, and its `TransientStorage.TtlRow` mode gave *ephemeral* perspectives a row expiry. This proposal generalizes the row half: **any perspective — including one fed entirely by durable Sourced events — can declare that its rows age out after a period of inactivity**, disappear from reads immediately at expiry, and are physically reaped by maintenance.

The motivating shape is high-cardinality UI read models: conversations, sessions/tabs, activity feeds. Their streams are minted constantly, their content stops being relevant after weeks, yet their rows accumulate forever unless the domain explicitly deletes each one. Event-driven deletion (a lifecycle event folded into an explicit delete action) remains the right tool when deletion is a *business fact*; `[RowTtl]` is the declarative, time-based backstop for everything that merely goes stale.

:::planned
Proposed capability (unreleased). It reuses the shipped TtlRow substrate — the `expires_at` shadow column, the lens logical-expiry filter, and the maintenance row reaper — and adds three things: a per-perspective declaration, a replay-safe expiry anchor, and a resurrection path that makes reaping *sourced* rows correct.
:::

## Why the existing TtlRow cannot simply be opened to Sourced perspectives

Two structural reasons, one superficial and one fundamental:

1. **Declaration surface.** Today the row TTL is derived *virally* from `[Ephemeral(TtlSeconds)]` on the events a perspective applies. A Sourced perspective has no ephemeral events, so it can never register a TTL. This is fixable with a new attribute — but fixing only this would ship a footgun, because of reason 2.

2. **The expiry anchor is apply-time.** The upsert stamps `expires_at = now + TTL` — a *wall-clock sliding window from the moment of application*. For ephemeral streams that is sound, because rebuild-from-zero is refused for them: no code path ever re-applies old history, so "apply time" and "event time" never diverge by more than the rewind grace window. For a Sourced stream the same stamp is incoherent: **any rebuild re-applies years of history *now*, re-stamping every dead row with a fresh full window.** Thousands of expired rows would resurrect on every rebuild and linger for another TTL. Row retention that a rebuild silently undoes is not retention.

The framework deliberately gates TtlRow behind `[Ephemeral]` today *because* of that anchor. This proposal removes the gate by fixing the anchor.

## Design

### 1. `[RowTtl]` — a per-perspective declaration

```csharp
[RowTtl(Days = 60)]
public class Projection : IPerspectiveFor<ConversationModel,
    UserMessageReceivedEvent, AssistantMessageSentEvent> { … }
```

Row lifecycle is a property of the **read model**, not of the events that feed it — so the declaration moves to the perspective class. The perspective-runner generator resolves it at compile time and emits a `[ModuleInitializer]` registration into the same `PerspectiveTtlRegistry` the ephemeral-derived path uses (AOT-safe, zero reflection — identical mechanism to the existing TtlRow and `[FullHistory]` registrations). The lens expiry filter and the maintenance row reaper key off registry membership and the `expires_at` column; **they require no changes**.

Precedence when both sources exist follows the uniform override ladder: framework default (no TTL) → derived from `[Ephemeral(TtlSeconds)]` events → explicit `[RowTtl]` on the perspective → runtime configuration override (§ Configuration). Most-specific wins.

### 2. Event-time anchoring — the replay-safety fix

The upsert stamp changes from wall-clock apply time to **event time**:

```
expires_at = created_at of the LAST event applied in this batch + TTL
```

`created_at` is the DB-authoritative emit timestamp already carried on every stored event — the same anchor the event-layer TTL was corrected to (`AfterTtl` expiry is `created_at + ttl`, never the app clock). One anchoring rule now holds at both layers.

Consequences:

- **Live behavior is unchanged.** For real-time applies, the last event's `created_at` is milliseconds from *now*; the sliding-window semantics ("active rows never expire") are preserved exactly.
- **Rebuild becomes deterministic.** Replaying an idle stream reproduces the same `expires_at` it had before: a conversation idle since March rebuilds with `expires_at = March + 60d` — *born expired*, invisible to every lens read from the first moment, physically reaped on the next maintenance pass. Rebuild converges to the same visible state instead of resurrecting zombies.
- **Rewind is deterministic** for the same reason: re-applying the same events reproduces the same anchor.
- **The ephemeral TtlRow path is retrofitted to the same anchor.** It is strictly better there too (a rewind inside the grace window no longer extends the row's life as a side effect), and it removes the special case.

Plumbing: the apply pipeline already materializes each batch's events (with `created_at`) before invoking the runner; the runner passes the batch's max `created_at` through to the upsert strategy alongside the model. This is a threaded parameter on an internal seam — no schema change, no reflection.

### 3. Resurrection-on-wake — what makes reaping *sourced* rows safe

The hole that must be closed: a row is physically reaped, and later the stream **wakes up** — a user reopens a conversation after 61 idle days. A Sourced row is the fold of *all* its events; applying the new event to a null model would silently build a corrupt partial row.

The event-sourced answer is that the row was never the authority — the log was, and the log is still there. So the writer path gains one detection and one response:

- **Detection:** the perspective's cursor shows history for this `(stream, perspective)` but `GetByStreamIdAsync` finds no row. (Cheap: both facts are already in hand on the apply path; the check only triggers on the row-miss branch.)
- **Response:** re-fold the stream **before** applying the incoming event — latest snapshot + tail replay, reusing the existing rewind machinery (`RewindAndRunAsync`), then apply the new event on the reconstructed model. The freshly-applied event re-stamps `expires_at` (event-time anchored), so the resurrected row starts a new honest window.

To make resurrection cheap, **the row reaper keeps the latest snapshot when it deletes a row** (older slots prune as usual). A reaped stream's residue is: its event log, one snapshot, its pointer rows — no `wh_per_*` row. Resurrection is snapshot-plus-tail, not replay-from-zero.

Ephemeral streams are explicitly excluded from this path: they keep today's semantics (rebuild refused; the snapshot floor governs; an out-of-grace straggler on a reaped ephemeral stream skips, accepting the reorder loss). The resurrection branch consults the stream's classification and only fires for Sourced streams — where it is always correct, because the bodies are durable.

### 4. What does NOT change

- **Two-phase expiry** stands: lens reads filter at the expiry instant (logical); maintenance deletes on its cycle (physical). The writer/replay path deliberately still loads expired-but-unreaped rows so late applies continue on real state.
- **Event-driven delete actions** (`IPerspectiveWithActionsFor` delete on a lifecycle event) remain the first-class path for business deletions and compose freely with `[RowTtl]`.
- **`debug_mode`** retains rows exactly as it retains everything else — the row reaper already skips under it.
- **The event log** is untouched. `[RowTtl]` governs read-model storage only; log retention remains the ephemeral/[archival](archival-compaction) axis.

## Rebuild, rewind, replay — the contract, stated plainly

| Operation | Behavior with `[RowTtl]` on a Sourced perspective |
|---|---|
| Live apply | Row upserted, `expires_at` slides from the applied event's `created_at` — identical UX to today |
| Rebuild (any mode) | Deterministic: active rows rebuild live; idle-past-TTL rows rebuild **born-expired** (never visible), reaped next cycle |
| Rewind / inversion | Deterministic: same events → same anchors → same expiry |
| Row expired (logical) | Invisible to all lens/GraphQL reads; writer path still sees it; any new event revives it (apply re-stamps) |
| Row reaped (physical) | Gone from `wh_per_*`; latest snapshot retained; cursor untouched |
| New event after reap | **Resurrection**: snapshot + tail re-fold, then apply — row returns complete and correct |

## Observability (OTel)

New meters on the existing `Whizbang` perspective/maintenance sources, all tagged by `perspective_name`:

- `whizbang.perspective.rows_reaped` (counter) — physical deletions per cycle; the primary "is retention working" signal.
- `whizbang.perspective.rows_resurrected` (counter) — wake-after-reap re-folds. A high rate means the TTL is shorter than real usage; tune upward.
- `whizbang.perspective.rows_born_expired` (counter) — rows rebuilt already past expiry. Non-zero outside rebuilds indicates clock/anchor bugs; a regression canary.
- `whizbang.perspective.resurrection_duration` (histogram) — snapshot+tail re-fold cost; watches whether snapshot retention is doing its job.
- `whizbang.maintenance.row_reap_duration` (histogram) — the reaper task's per-cycle cost as tables scale.
- Gauge opportunity (cheap, from the reaper's scan): `whizbang.perspective.rows_expired_unreaped` — the logical-vs-physical backlog; sustained growth means the maintenance cadence is losing to churn.

Traces: the resurrection re-fold joins the existing rewind span family (it *is* a rewind) with a `resurrection=true` tag — no new span source. High-churn perspectives inherit the established metrics-only default; per-type trace opt-in applies unchanged.

## Configuration

Declarative default with runtime override, on the uniform ladder:

```csharp
services.Configure<PerspectiveRowRetentionOptions>(o => {
  o.Enabled = true;                                  // global kill switch (reaper + stamping; filter stays)
  o.Overrides["…ConversationModel"] = TimeSpan.FromDays(90);  // operator TTL override, no redeploy
});
```

- **`Enabled`** — an operational kill switch resolved at the ONE consult point (the TTL registry), so stamping, the lens expiry filter, and the resurrection probe all stand down together: rows that were hidden become visible again immediately — the behavior an operator wants mid-incident. Rows whose stamps predate the switch may still physically reap until those stamps drain; Sourced rows remain recoverable via resurrection once re-enabled.
- **Per-model TTL overrides** — bridged from `IOptions`, they win over the attribute (config is the operator's rung of the ladder). Attribute remains the in-repo source of truth; overrides are for incident response and tenant-scale tuning.
- **Snapshot retention on reap is unconditional** (keep the latest — the resurrection anchor), locked by a regression test rather than exposed as an option; an opt-out ships only if a concrete high-cardinality need appears.
- Maintenance cadence reuses the existing `MaintenanceWorkerOptions.IntervalMinutes`; no new scheduler.

## AOT / zero-reflection statement

Every piece is source-generated or plain code: the `[RowTtl]` attribute is read by the perspective-runner generator (compile time), registration is a `[ModuleInitializer]` into a type-keyed registry, the anchor is a threaded parameter, the resurrection path calls the existing generated runner's rewind entry point, and configuration binds through standard options. No runtime attribute inspection, no `Type` scanning, nothing added to the reflection allowlist.

## Build increments (docs-first → TDD each)

1. **Anchor fix** — event-time `expires_at` in the upsert (both paths), + determinism regression: rebuild-after-expiry produces born-expired rows. RED first via a test pinning today's apply-time stamp divergence under replay.
2. **`[RowTtl]` attribute + generator registration** — content tests on the generated runner registration; ladder precedence tests.
3. **Snapshot-retaining row reap** — reaper keeps latest snapshot; SQL integration tests.
4. **Resurrection-on-wake** — detection + re-fold + apply; the wake-after-reap E2E (reap a row, publish a new event, assert the full fold), plus the ephemeral-exclusion lock.
5. **OTel + options** — meters/histograms, kill switch, overrides; unit + integration.
6. **Docs to v1.0.0** on release, `<docs>`/`<tests>` tags on the new public surface, regenerated code↔docs↔tests maps.

## Relationship to neighboring proposals

- [Ephemeral Events](ephemeral-events): supplies the substrate (`expires_at` column, lens filter, row reaper) and the contrast — event retention vs row retention are orthogonal axes that compose.
- [Destruction Hooks & TTL](destruction-hooks-ttl): the row reaper participates in the destruction-hook framework at `DestructionGranularity.PerspectiveRow`; `[RowTtl]` rows flow through the same Pre/PostDestruction stages.
- [Archival & Compaction](archival-compaction): solves the *log* side for Sourced streams; `[RowTtl]` solves the *read-model* side. A stream may use both.
