---
title: Turnkey Configuration Binding
category: Architecture & Design
order: 27
tags: configuration, options, binding, source-generator, aot, zero-reflection, turnkey, observability, effective-config, drift
---

# Turnkey Configuration Binding

Whizbang ships dozens of tuning knobs across its options classes — audit cadence, repair
budgets, batch sizes, backoffs, lock durations — but the framework never binds them to
`IConfiguration`. The zero-reflection convention rules out the classic
`services.Configure<T>(section)` reflection binder, so today every consumer hand-writes a
**manual key-bind list** mapping configuration keys onto options properties, one
`int.TryParse` at a time. This proposal makes configuration a **turnkey framework
responsibility**: a source generator derives an AOT-safe binder from each options class,
`AddWhizbang(IConfiguration)` wires every one of them by convention, the effective posture is
logged at startup, and unknown keys warn instead of vanishing.

:::planned
This is a proposed capability. It reuses the established cross-assembly registry pattern
(module-initializer fragments feeding a central registry) already proven by the JSON context
registry, the message-type catalog, and the canonical meter registry.
:::

## The incident shape this prevents

A live diagnosis surfaced the gap in its full three-layer form. A consumer service ran with a
large integrity-repair backlog; an operator raised the repair budget via an environment
override — the documented, intended tuning path. Nothing changed. The audit *interval*
override on the very same options class worked fine. The repair rate stayed pinned at the
framework default, diagnosable only by noticing that repair bursts matched the default cap
exactly.

Three independent silences stacked:

1. **Bind-list drift.** The consumer's manual binder covered the audit-cadence keys but not
   the repair-throughput keys. Nothing — no analyzer, no test, no runtime signal — reports
   "this options class has properties your binder does not map." Every knob the framework
   adds is born unbindable in every consumer until someone notices, and the noticing looks
   like production misbehavior.
2. **No unknown-key signal.** The environment variable was present, spelled correctly, and
   simply ignored. A typo'd key, or a key for a knob this framework version does not have,
   dies the same silent death.
3. **Silent-default fallback.** Deeper in the framework, at least one resolution seam reads
   options as `GetService<IOptions<T>>()?.Value ?? new T()` — if the registration is missing
   entirely, the framework invents defaults without a whisper.

And throughout, nothing logs the **effective** values. The only observable was behavioral.

## Design principles

- **Derive, don't enumerate.** Any glue a consumer must hand-enumerate will drift. The bind
  surface must be *derived from the options class itself* at compile time, exactly as the
  meter registry derives from the meter constants and locks with a drift test.
- **Zero reflection, AOT-first.** Binding code is generated, not reflected. (The BCL's
  configuration-binding source generator solves the same problem per-call-site; Whizbang
  generates its own binder so the registry, unknown-key detection, and posture log ride the
  same pass — and so the convention stays uniform with the rest of the generator suite.)
- **Turnkey.** `AddWhizbang(configuration)` binds everything. A consumer with no bespoke
  configuration code gets every documented knob working from `appsettings.json` and
  environment variables on day one.
- **Configuration is observable.** What the process is *actually* running with is a
  first-class, logged fact — not something inferred from behavior.

## The convention

Every Whizbang options class binds from a conventional section path:

```
Whizbang:<Name>        where <Name> = the options class name minus the "Options" suffix
```

`StreamIntegrityOptions` → `Whizbang:StreamIntegrity` — i.e.
`Whizbang__StreamIntegrity__MaxAutoRepairRequestsPerAudit=500` as an environment variable.
This matches the section naming consumers have already independently converged on, so
existing configuration keys keep working unchanged when the framework takes over the binding.

Standard `IConfiguration` precedence applies (appsettings < environment < later providers),
and the generated bind runs as an ordinary `Configure<T>` step — a consumer's own
`Configure`/`PostConfigure` registered afterwards still wins, so existing bespoke extensions
remain correct during migration and simply become deletable.

## The pieces

### 1. Generated options binder + cross-assembly registry

A generator pass walks each Whizbang options class (opt-in marker attribute on the class —
e.g. `[WhizbangOptions]` — so inclusion is explicit and greppable) and emits:

- an AOT-safe `Bind(IConfigurationSection, T options)` covering every public settable
  property of a supported type — `int`, `long`, `bool`, `string`, `double`, `enum`
  (case-insensitive), and `TimeSpan` in v1;
- a module-initializer fragment registering `(sectionName, binder, knownKeys)` into a central
  `OptionsBindingRegistry`, so optional packages (transports, drivers) contribute their
  options classes exactly as they contribute JSON contexts and meters today.

`AddWhizbang(IConfiguration)` iterates the registry and registers one `Configure<T>` per
entry. Malformed values follow the established posture: ignore-and-keep-default, never
silently zero a cadence — but *log* the ignored key (see §3), which the hand-written binders
never did.

Drift is structurally impossible: a new property on the options class is in the next build's
generated binder, in `knownKeys`, in the posture log. There is no list to forget.

### 2. Effective-posture startup log

Each options group logs one structured INF line when its owning feature starts, listing the
effective values of its scalar knobs:

```
StreamIntegrity posture: RepairMode=AutoRepairCapped AuditIntervalMinutes=15
  MaxAutoRepairRequestsPerAudit=500 MaxManifestPagesPerAudit=64 MaxDigestsPerManifest=500 …
```

The generated binder makes this nearly free — the same generated property walk renders the
line, so it can never drift from the class either. One line per group, INF, at startup only;
string-typed values that could carry secrets are excluded by supported-type construction
(connection strings and credentials do not live on Whizbang options classes; a `[Redact]`
escape hatch covers any future exception).

Had this existed, the incident above would have been a thirty-second log read:
`MaxAutoRepairRequestsPerAudit=25` while the environment said 500.

### 3. Unknown- and ignored-key warnings

After binding, the registry knows every valid key under every `Whizbang:*` section. A
startup pass enumerates the keys *actually present* in configuration under `Whizbang:` and
warns once per key that matched nothing:

```
WRN Whizbang configuration key 'Whizbang:StreamIntegrity:MaxAutoRepairPerAudit' matched no
    known option (nearest: MaxAutoRepairRequestsPerAudit) — the value is NOT applied.
```

This catches typos and version skew (a key for a knob this framework version lacks). The
same pass reports keys whose values failed to parse. Both are warnings, not failures —
configuration must never crash a healthy default — but they are *loud*.

### 4. No silent defaults at resolution seams

Framework code stops the `?? new TOptions()` pattern at options resolution seams. With
turnkey binding, `IOptions<T>` is always registered once `AddWhizbang` ran, so the fallback
only masks a wiring bug; where a seam must tolerate bare test harnesses, it logs a one-time
warning when the fallback engages. A framework inventing its own configuration must never be
inaudible.

## What this replaces

Consumer-side bespoke binding extensions (the manual `int.TryParse` lists) become redundant.
They keep working through the migration — their `Configure` runs after the generated bind and
wins where both set a value — and can then be deleted. No configuration keys change.

## Testing

- **Generator content tests**: binder emitted for a marked class; every supported-type
  property covered; unsupported types skipped with a diagnostic.
- **Drift lock**: a test asserts every public settable property of each registered options
  class appears in its generated `knownKeys` — the same shape as the meter registry's
  reflection drift-lock.
- **Binding integration**: in-memory configuration → `AddWhizbang` → resolved options carry
  the configured values; absent keys leave defaults; malformed values keep defaults and are
  reported.
- **Unknown-key warning**: a misspelled key under `Whizbang:` produces the warning with the
  nearest-match hint; an exact key produces none.
- **Posture log**: the startup line contains every knob and the effective (bound) values.

## Build increments

1. **Generator + registry + `AddWhizbang(IConfiguration)` wiring**, applied first to
   `StreamIntegrityOptions` end-to-end (the incident class — binder, registry entry, tests).
2. **Roll the marker across the remaining options classes** (workers, transports, temporal,
   ephemeral, snapshots) — mechanical once increment 1 lands; each package's fragment rides
   the existing registration-callback pattern.
3. **Effective-posture log** rendered from the generated walk, wired at each feature's
   startup seam.
4. **Unknown/ignored-key detection** over the union of registered sections.
5. **Silent-default sweep** of resolution seams (`?? new TOptions()` → registered-or-warn).

## Alternatives considered

- **BCL configuration-binding source generator** at each consumer call site: solves AOT
  binding but stays per-consumer opt-in — it cannot give the cross-assembly registry, the
  unknown-key detection, or the posture log, and it leaves "remember to bind" as consumer
  discipline. Rejected as the whole story; viable as an internal engine if the custom binder
  proves costly.
- **Reflection `section.Bind(options)`**: violates the zero-reflection constitution.
- **Status quo (consumer bind lists)**: the incident. Hand-enumerated glue drifts; this is
  the third instance of the pattern (meters, JSON contexts, now options) and the fix is the
  same each time — derive from the source of truth and lock it with a test.
