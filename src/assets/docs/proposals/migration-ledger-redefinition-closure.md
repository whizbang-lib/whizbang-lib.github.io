---
title: Migration Ledger — Redefinition Closure
category: Architecture & Design
order: 27
tags: migrations, ledger, replay, idempotency, hash-bump, redefinition-closure, schema-init, sql-functions, drift-detection
---

# Migration Ledger — Redefinition Closure

Whizbang's numbered SQL migrations are **mutable before v1.0**: a file may be edited in place, its
content hash changes, and the schema-init ledger **re-runs** it on the next startup. That replay
model has a structural hazard this proposal eliminates:

> **Several migrations may define or redefine the same SQL object** (functions especially — the
> store procedures and the emit chain are each redefined by four or more files). When a
> hash-driven replay re-runs an *earlier* file that redefines object `X`, the database is left
> with the *earlier* definition of `X` — unless every **later** migration that also redefines `X`
> re-runs after it. Today nothing enforces that.

The failure mode is silent and severe: a database that took such a partial replay keeps working —
every statement succeeds — but one of its functions is quietly generations old. In the observed
production-shaped incident, the store procedures reverted to a pre-flags definition and **persisted
`flags = 0` for every row**, disabling collective routing, the ephemeral reaper's keying, and the
replay guards on that service *with no error anywhere*. The application code was provably correct
at every layer; the data contradicted it for days.

## Today's mitigation, and why it is not enough

The current convention (established while hardening replay idempotency) is a hand-maintained
**"Re-run note"**: the file that holds the *last word* on an object carries a comment declaring so,
and any in-place edit of an earlier same-object file must be accompanied by a **manual hash bump**
of the last-word file so the ledger replays it too.

This works only when a human remembers the chain. The incident above happened precisely because
one last-word file (the flags-aware store procedures) never received its note, so an earlier
replay left it un-rerun. A convention that fails silently on omission is documentation, not a
guarantee.

## Proposal: the ledger computes the redefinition closure itself

When the ledger determines the set of migrations to apply — today `{new files} ∪ {hash-drifted
files}` — it **expands that set to its redefinition closure** before running anything:

1. For every migration `M` in the set, look up the SQL objects `objects(M)` that `M` defines or
   redefines.
2. For every such object, add **every later migration** that also defines it.
3. Repeat until a fixed point (a pulled-in later file may itself define further objects).
4. Run the expanded set in ledger (numeric) order, as always.

Re-running an earlier definition is then *always* followed, in the same startup, by every
subsequent redefinition — the database ends on the last word by construction. The hand-maintained
re-run notes stop being load-bearing (they remain as useful documentation of the chains).

### Where `objects(M)` comes from: a compile-time manifest

Runtime SQL parsing is off the table (zero-reflection, AOT, and the migrations are embedded at
build time anyway). Instead, the **source generator that embeds the migrations** also extracts each
file's object list at compile time and emits a static manifest beside the embedded SQL:

- The extractor recognizes the authoring conventions the migration lint already enforces —
  schema-qualified `CREATE [OR REPLACE] FUNCTION | TABLE | VIEW | INDEX | TRIGGER` and
  `DROP FUNCTION | TABLE …` statements at top level.
- Constructs the extractor cannot see (dynamic SQL inside `DO` blocks, `EXECUTE format(...)`)
  are covered by an explicit header override the lint validates:
  `-- Objects: schema.fn_a, schema.table_b` (or `-- Objects: none` for purely data-manipulating
  files). A parsed migration that yields **zero** objects and carries **no** override fails the
  lint — silence is not an option.
- The manifest is a generated dictionary (`migration id → object names`), AOT-safe, versioned with
  the code, and identical for every provider that shares the numbered migrations.

### Defense in depth: ledger-order violation detection

The closure prevents *future* damage. For databases damaged **before** the fix ships (or damaged
by any path the closure cannot see), the ledger's own bookkeeping already contains the evidence:
each applied migration records its `applied_at` timestamp. A **startup detector** joins the
manifest against the ledger table:

> For any two same-object migrations `i < j`, if `applied_at(i) > applied_at(j)`, the earlier
> definition ran *after* the later one — object `i∩j` is suspect.

Phase one ships this as a **loud startup warning** naming the object and both migrations (the same
detect-by-default / act-by-opt-in posture as historical reclassification). Phase two may offer
self-healing: automatically re-run the newest same-object migration. Detection is a pure
ledger-table query plus the manifest — no live-definition diffing against `pg_get_functiondef`
(PostgreSQL reformats function bodies, making text comparison unreliable).

### Idempotency contract (unchanged, now enforced where it matters)

Closure expansion re-runs later migrations more often, so the existing replay-idempotency rules
carry more weight: every migration in a redefinition chain must be safe to re-execute
(`CREATE OR REPLACE` for functions, guarded `ALTER`s, `IF NOT EXISTS` DDL). The migration lint
gains one check: any file the manifest places in a multi-file chain must pass the replay-safety
patterns the hardening work established.

## Build increments

1. **Manifest extraction** — generator emits `migration → objects`; lint enforces
   parsed-or-declared coverage for every file. Inert at runtime.
2. **Closure expansion** — the ledger runner expands the re-run set to its fixed-point closure
   before applying. Unit tests over manifest fixtures; integration test that *recreates the
   incident*: force a hash change on an early store-procedure file alone, start up, and assert the
   final function is the last word because the closure pulled the later file in.
3. **Ledger-order violation detector** — startup warning from the `applied_at` join; regression
   test seeding an out-of-order ledger. Self-healing re-run behind an opt-in flag.
4. **Docs** — the migrations guide replaces the "manual hash bump of the last word" instruction
   with the automatic closure; re-run notes are re-documented as descriptive, not operative.

## Out of scope, with rationale

- **Live-definition verification** (diffing `pg_get_functiondef` output against migration source):
  PostgreSQL normalizes stored function bodies, so text equality is unreliable; the
  `applied_at`-order detector catches the same class of damage from the ledger's own records
  without false positives.
- **Cross-object dependency ordering** (function A calls function B): the ledger's numeric order
  already encodes authoring-time dependency order; the closure preserves it. Re-deriving a
  dependency graph from SQL adds parser complexity with no known failure it would prevent.
- **Automatic hash-bump generation**: unnecessary once the closure exists — the whole point is
  that no file needs a synthetic edit for the ledger to do the right thing.
