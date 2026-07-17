---
title: Functional Specification
pageType: overview
audience: [porter]
status: current
order: 1
description: Platform-neutral behavioral spec of Whizbang subsystems — what a port must implement, with the test suite as the executable contract
tags: specification, porting, behavioral-contracts, architecture
---

# Functional Specification

This section specifies Whizbang's behavior in platform-neutral terms: the contracts, invariants, and sequencing rules a port to another language or runtime must honor. Consumer docs explain *how to use* the library; these pages define *what the library guarantees*.

## The tests are the executable spec

Whizbang's test suite (~1,300 test methods across 34 projects, strict TDD) is the authoritative behavioral contract. Every spec page links the tests that lock its invariants via `testReferences` frontmatter — a port is conformant when equivalent tests pass. The [code↔tests map](../contributors/overview) makes the linkage navigable, and live test status on each page shows whether the contract currently holds on `develop`.

## Structure (in progress)

Spec pages are being seeded subsystem-by-subsystem, prioritized by the [2026-07 audit](https://github.com/whizbang-lib/whizbang-lib.github.io/blob/develop/audit-reports/REBASELINE-2026-07-16.md) — the work-coordinator, batch strategies, and stream-affinity internals that code `<docs>` tags already demand:

| Subsystem | Spec scope | Status |
|---|---|---|
| Work coordinator | claim loop, per-stream drain, lease semantics, commit sequencing, notifications/pgbouncer topology | planned |
| Outbox / inbox | batch strategies, publish-once guarantees, discard-unsubscribed rule | planned |
| Perspectives | checkpoint lifecycle, apply batching, cursor semantics, drain mode, dedup cache | planned |
| Event store | append contracts, sequencing, ephemeral streams, upcasting/versioning | planned |
| Lifecycle | stage ordering, PostAllPerspectives gating, WhenAll semantics | planned |
| Identity | UUIDv7 (TrackedGuid), pinned type identity, scope inheritance | planned |

## Invariants worth stating up front

Two examples of the level of precision this section targets:

- **Multi-fire impossibility**: the work pump's poller returns stream ids only; a per-stream drainer fetches bodies. Duplicate `Apply` is structurally impossible, not merely guarded.
- **Lifecycle completion**: `PostAllPerspectives`/`PostLifecycle` always fire at end of lifecycle; `WhenAll` configuration gates *timing*, never *whether* they fire. Cooldown/dedup short-circuits must still signal perspective completion.
