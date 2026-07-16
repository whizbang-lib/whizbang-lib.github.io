---
title: Type-Definition Fingerprint & Lineage
category: Architecture & Design
order: 23
tags: fingerprint, type-versioning, schema-hash, settings-hash, lineage, reclassification, upcasting, drift-detection
---

# Type-Definition Fingerprint & Lineage

When an event type's **definition** changes in code — its behavioral settings (Sourced ↔ Ephemeral, TTL, destruction) or its **payload schema** (properties added/removed/retyped) — the events already stored under the *old* definition become **drift**: rows the runtime must find and reconcile (reclassify their storage treatment, or upcast their payload). This proposal defines a single foundational mechanism — a **per-type fingerprint** (content hashes of a type's definition) plus a **lineage graph** (how one definition superseded another, and the migration that bridges them) — that detects that drift cheaply on startup and drives the right reconciliation.

:::planned
Unreleased design proposal. It generalizes the detection layer behind **[Ephemeral Events](ephemeral-events)** reclassification (#13c) and is the substrate the future **event-versioning / upcasting** and **GDPR** phases consume. The reclassification *primitive* and coordinator capability already exist; this proposal covers the *detection + automation* layer that supersedes the interim row-scan detector.
:::

## Motivation

Three separate features all need the same underlying question answered — *"which stored events were written under a definition that no longer matches the code, and how do I bring them current?"*:

- **Ephemeral reclassification** — a type gains `[Ephemeral]`; its historical Sourced rows must be stamped ephemeral + offloaded so the reaper can reclaim them.
- **Event versioning / upcasting** — a type's payload schema evolves; older events must be transformed to the current shape (eagerly or lazily on read).
- **GDPR / crypto-shred targeting** — find the specific events whose *content* carries a given subject's data.

Building three bespoke detectors would triplicate the hardest part (finding affected rows correctly and cheaply). One fingerprint substrate serves all three.

## The model

### Per-type fingerprint (small, in-memory)

The source generator computes, at compile time, a set of **canonical content hashes** describing each message type, and stamps them onto the generated `MessageTypeCatalogEntry` (alongside the existing `PinnedId`, `FormerNames`, and `Ephemeral` metadata). Each hash has a **kind**:

| Kind | Covers | Changes when… | Drives |
|---|---|---|---|
| **identity** | the logical type (≈ the `PinnedId` role) | never, for a pinned type (rename-stable) | matching across renames |
| **settings** | behavioral config: Sourced/Ephemeral, TTL, destruction, storage | you change how the type behaves | reclassification / lifecycle reconcile |
| **schema** | canonical, recursively-ordered property-name+type tree | you change the payload shape | versioning / upcasting |

These are **per type-version**, so the set is tiny — one row per distinct definition a type has ever had, never one per event. They are persisted in a `wh_type_definitions` table and **loaded into memory on startup** as a lookup.

### Lineage graph (how definitions evolve)

When the generator produces a settings/schema hash that isn't already in `wh_type_definitions`, startup inserts a new definition row and records a **lineage edge** from the superseded definition to the new one, labeled with a **relationship** and — critically — a reference to the **developer-authored migration** that bridges them:

```sql{title: "Fingerprint + lineage tables (sketch)" description: "One row per distinct type-definition-version, plus edges describing how one superseded another and the migration that bridges them." category: "Design" difficulty: "ADVANCED" tags: ["fingerprint", "lineage", "type-versioning", "schema-hash"]}
CREATE TABLE wh_type_definitions (
  definition_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      VARCHAR(500) NOT NULL,   -- normalized CLR full name (migration 063 encoding)
  identity_hash   BYTEA NOT NULL,
  settings_hash   BYTEA NOT NULL,
  schema_hash     BYTEA NOT NULL,
  schema_version  INT NOT NULL,            -- developer-declared [SchemaVersion]
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wh_definition_lineage (
  from_definition_id INT NOT NULL REFERENCES wh_type_definitions(definition_id),
  to_definition_id   INT NOT NULL REFERENCES wh_type_definitions(definition_id),
  relationship       SMALLINT NOT NULL,    -- SchemaUpgradedTo | ReclassifiedTo | MetadataChangedTo | ...
  migration_ref      VARCHAR(500),         -- upcaster / reclassify action bound to this edge
  PRIMARY KEY (from_definition_id, to_definition_id)
);
```

The graph is what makes the diff *actionable*: a stale definition doesn't just flag "something changed," it points at its successor and names the migration to run.

## The load-bearing decision: what does each *event* carry?

The naive version stores hash-id foreign keys on every `wh_event_store` row. `wh_event_store` is the largest, hottest table in the system, so this proposal **rejects per-event hash-id FKs** in favor of markers that are already present or nearly free — because the per-event state each feature needs is recoverable without them:

- **Reclassification** keys off the `flags` **ephemeral bit**, which every event already carries. "Stale rows for a now-ephemeral type" is `WHERE event_type = T AND (flags & 8) = 0` — an indexed query on existing columns. A per-event settings hash-id would be redundant with `flags`.
- **Upcasting** keys off a small **`schema_version` int** per event (needed regardless for lazy upcast-on-read). "Rows needing upcast" is `WHERE event_type = T AND schema_version < current`.
- **Content addressing** (dedup / GDPR) is the *only* genuinely per-event hash, and it is large (≈one per event, no sharing) — so it lives in a **separate optional body-hash facility**, never in the fingerprint path and never loaded into memory.

So an event carries at most one new small column (`schema_version`); everything else reuses `event_type` + `flags`. The per-type fingerprint stays uniform and content-addressed; the hot table does not pay for it.

> **Open fork (recorded for the reviewer):** the alternative is full uniformity — a single small `definition_id` FK per event pointing at its `wh_type_definitions` row, so *every* axis (settings, schema, future) is one content-addressed lookup and "affected events" is always `WHERE definition_id = <stale>`. It is conceptually cleaner and future-proof against new per-event axes, at the cost of one indexed int column on the hot table and stamping it in the emit chain. **Recommendation: reuse `flags` + `schema_version`** (no new FK) unless a third per-event axis appears that `flags`/`version` can't express — the hot-path cost of `wh_event_store` outweighs the uniformity.

## Startup flow

1. **Load** `wh_type_definitions` into an in-memory map (`(kind, hash) → definition`). Small.
2. **Diff** — for each catalog entry, compare the generator's current settings/schema hashes to the stored definition. A stored definition whose hashes no longer match any current one is **stale**.
3. **Guard** — if the schema hash changed but no `[SchemaVersion]` bump / no registered upcaster exists for the edge, fail loudly (a forgotten-bump is a bug, not a silent drift). This is the analyzer/runtime guard the fingerprint uniquely enables.
4. **Reconcile** — follow the stale definition's lineage edge and run its bound migration over the affected events, found by the cheap markers:
   - `ReclassifiedTo` → `reclassify_events_ephemeral(name-set)` over `(event_type, flags)`.
   - `SchemaUpgradedTo` → the registered upcaster over `(event_type, schema_version)`, eagerly (batch) or lazily (on read).
   Reconciliation is **detect-by-default, act-by-opt-in** (consistent with [Ephemeral Events](ephemeral-events)): drift is always logged + metered; destructive/rewriting migrations run on startup only when explicitly enabled, or via a deliberate command.

## Cross-cutting concerns

- **Determinism (non-negotiable).** The per-type hashes must be canonical and stable — ordered members, the migration-063 CLR-name encoding — or they false-fire on every build. The *inputs* to each hash are themselves a versioned contract; changing what a hash covers is itself a migration.
- **Existing-row backfill.** Historical events predate `schema_version`; a one-time backfill stamps them from the current definition (cheap pre-1.0). `flags` is already backfilled by reclassification.
- **Hot path.** Even the minimal `schema_version` stamp must be resolved in-memory at emit from the type→definition map — no per-write DB lookup. ([[feedback_sql_performance]])
- **Relationship to the interim detector.** The row-scan `CountSourcedEventsForTypesAsync` (already shipped for reclassification) is the *authoritative* drift check and remains correct; the fingerprint adds a cheap "only scan types whose settings hash changed" trigger + the lineage/audit + the forgotten-bump guard on top. The fingerprint supersedes the row-scan as the *entry point*, not as the source of truth.

## Consumers

| Feature | Hash used | Per-event marker | Action bound to lineage edge |
|---|---|---|---|
| Ephemeral reclassification (#13c) | settings | `flags` ephemeral bit | `reclassify_events_ephemeral` |
| Event versioning / upcasting | schema | `schema_version` | registered upcaster |
| GDPR crypto-shred targeting | body (separate facility) | per-event body hash | subject-scoped erasure |

## Scope

**This proposal:** the fingerprint tables, the generator-stamped per-type hashes, the in-memory startup diff, the lineage graph + relationship enum, and the reconcile entry point. **Not this proposal:** the upcaster contract and lazy/eager migration runner (event-versioning phase), the body-hash facility (dedup/GDPR phase), and the reclassification primitive itself (already shipped).
