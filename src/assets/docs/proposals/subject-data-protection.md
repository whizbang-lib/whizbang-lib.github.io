---
title: Subject-Scoped Data Protection (GDPR / Crypto-Shred)
category: Architecture & Design
order: 26
tags: gdpr, crypto-shredding, data-protection, right-to-erasure, subject-key, encryption, rebuild-on-erasure, data-subject, protected-data, key-store
---

# Subject-Scoped Data Protection (GDPR / Crypto-Shred)

An event-sourced log is **append-only and immutable** — which collides head-on with a legal *right to erasure*. You cannot honour "delete this person's data" by deleting the events: the log stops replaying, and the bytes survive anyway in WAL, PITR backups, and read replicas. The industry-universal answer is **crypto-shredding**: encrypt each subject's sensitive fields with a *subject-scoped key* (in this design, one per *(subject, data class)* — see below), keep the key *outside* the event store, and **destroy the key** to erase. The ciphertext stays in the log (replay still works structurally), but it can never be read again — the data is gone without ever mutating a single event.

Whizbang generalizes this one step further, at the user's direction: the mechanism is not PII-specific. A **subject** is any protected entity (a person, a company, an organization, or a class not yet imagined); **protected data** is any sensitive classification (PII, health, financial, or a custom class you define). The feature is **subject-scoped cryptographic data protection**; GDPR / personal-data is its flagship preset. Crypto-shredding is the engine underneath.

:::planned
G1 is a proposed capability (unreleased, the final phase of the ephemeral/retention initiative). Crypto-shred is **orthogonal** to the Sourced ↔ Ephemeral axis: it erases *any* subject-data — because every event persists (so its bytes reach WAL, replicas, and PITR backups) and only destroying the key reaches those retained bytes. [Ephemeral Events](ephemeral-events) *self-destruct* for storage economy, but a physical delete is **not** erasure (it can't reach WAL/backup/replica), so ephemeral subject-data is crypto-shredded too. G1 reuses foundations already built: the [Temporal Engine](temporal-engine) (scheduled erasure), the destruction reaper and retention limits from [Destruction Hooks & TTL](destruction-hooks-ttl), the system signal bus (cache invalidation), `PerspectiveScope` (subject-id propagation), the rebuild infrastructure (rebuild-on-erasure), and the [Type-Definition Fingerprint](type-definition-fingerprint) (locating protected-bearing events). The erasure *mechanism* — key destruction — stays distinct from ephemeral self-destruct, which is a storage-lifecycle concern, not an erasure one.
:::

## Why crypto-shred, not delete

Physical deletion of events is the wrong tool for privacy, for three independent reasons:

- **It breaks replay.** Deleting a subject's events from a stream that a projection rebuilds from silently corrupts that projection — the exact hazard every mature event store warns about. Crypto-shred leaves the event *structurally* intact; only the protected fields read back null.
- **It doesn't even erase.** WAL, point-in-time-recovery backups, and streaming replicas all retain deleted rows for their retention windows. "Immutable store + delete" is, as EventStoreDB's docs put it, *fire and water*. Destroying a key held in a separate store erases everywhere the ciphertext ever traveled at once — events, projections rebuilt from them, snapshots, backups.
- **It's coarse.** A subject's data is usually a few fields inside events that also carry non-subject facts. You want to forget the *person*, not void the *order*. Field-level encryption keyed by subject erases exactly the subject's slice.

This is the settled industry pattern (Axon's Data Protection Module, RailsEventStore, the Confluent/Kafka guidance): **crypto-shred + a separate key store**, with queryability preserved by decrypting into read models and rebuilding-then-redacting on erasure.

Crypto-shred is therefore the erasure mechanism for subject-data **whatever its consistency mode** — because every event persists to the store (and so to WAL, replicas, and PITR backups), and only key-destruction reaches those retained bytes. Ephemerality changes the *storage lifecycle* and the *projection-redaction path*, **not** whether erasure destroys a key:

| Concern | Sourced subject-data | Ephemeral subject-data |
|---|---|---|
| **Erase the persisted bytes** | crypto-shred — destroy the *(subject, class)* key → ciphertext in the log / WAL / backup / replica reads back unreadable | **crypto-shred, identically** — an ephemeral event persists too, so a physical `DELETE` can't reach WAL / backup / replica |
| **Live-storage lifecycle** | kept until archived or compacted | self-destructs — consumption-gated / TTL reaper ([E1](ephemeral-events)); storage *economy*, **not** erasure |
| **Projection redaction on erasure** | rebuild affected streams → re-project redacted (missing-key decrypt → `null`) | **direct purge** of the projection row — authoritative ephemeral state isn't rebuildable |

The reaper's physical `DELETE` is **not** an erasure mechanism — as *"it doesn't even erase"* above says, it leaves the bytes in WAL/backup/replica. Crypto-shred is. So an ephemeral event carrying `[Protected]` data is encrypted at rest exactly like a Sourced one, and its *(subject, class)* key **outlives the reaped event** — destroying it later renders even a long-gone ephemeral event's WAL/backup remnants unreadable. Ephemerality only means the event *also* self-destructs for economy, and its authoritative projection is purged directly rather than rebuilt-redacted (there is no log to replay).

## The model — subjects and protected data

Two attributes declare the contract at compile time (read by the source generator + analyzer; AOT-safe, zero reflection at runtime):

```csharp{title="Declaring a subject and its protected fields" description="[DataSubject]/[DataSubjectId] identify the protected entity; [Protected] marks fields to encrypt, with a classification" category="Core Concepts" difficulty="ADVANCED" tags=["gdpr","crypto-shred","data-protection"] framework="NET10"}
// A subject = any protected entity. The classification is open — PersonalData is the GDPR preset.
public sealed record CustomerRegistered(
    [DataSubjectId] Guid CustomerId,                   // WHO this event's protected data belongs to
    [Protected(DataClass.PersonalData)] string FullName,
    [Protected(DataClass.PersonalData)] string Email,
    [Protected(DataClass.Financial)]    string TaxId,
    string CountryCode                                 // NOT protected — a plain fact, stays readable
) : IEvent;
```

No `[property: …]` specifier is needed. These attributes are declared `AttributeTargets.Parameter | AttributeTargets.Property | AttributeTargets.Field`, and the generator reads the **union** of a member's parameter- *and* property-targeted attributes. On a positional record a bare attribute binds to the constructor parameter (C#'s default) — the generator finds it there; on a class with declared properties it binds to the property — found there too. `[property: Protected(…)]` stays valid (it's what `System.Text.Json` users reach for reflexively), just optional. Reading both targets is deliberate for a *security* attribute: a `[Protected]` field must never be silently left unencrypted because the attribute happened to land on the parameter rather than the property.

- **`[DataSubjectId]`** marks the member (record parameter or property) that identifies the subject the event's protected data belongs to. It is the erasure key: "find everything scoped to *this* subject." One event may reference more than one subject (e.g. a transfer between two parties) — multiple `[DataSubjectId]` members are allowed, and the event is tagged with each.
- **`[DataSubject]`** (type-level) marks a *type* as representing a subject entity — used for the subject registry and analyzer guidance.
- **`[Protected(classification)]`** marks a field whose value must be encrypted at rest. Variants mirror Axon's module: `Protected` (a scalar), `DeepProtected` (recurse into a nested object graph), `SerializedProtected` (encrypt the serialized blob of a complex value). `DataClass` is an **open** classification with turnkey members — `PersonalData`, `Health`, `Financial`, and a catch-all **`Other`** — plus any you define. It is more than an audit label: it is (part of) the **unit of the encryption key** — a field is encrypted under its subject's *(subject, class)* key (below), so a class can be erased or retained independently of the subject's other classes. `Other` is the escape hatch when no named class fits and you don't want to mint a custom one; pair it with a `Group` (next) to keep the arbitrary buckets it collects independently erasable.
- **`[ProtectionGroup]` — the optional third key axis.** It sub-partitions the key **within a class**, for data that shares a subject *and* class but must crypto-delete independently — the per-purpose / per-consent / per-relationship case (GDPR is fundamentally *purpose-of-processing* based). Two forms: a **value-sourced** marker on a member whose runtime value is the discriminator (`[ProtectionGroup] Guid ContractId` → key `(subject, PersonalData, contractId)`, so one contract is forgotten while the others are retained), and a **static literal** on the field for fixed compile-time groupings (`[Protected(DataClass.PersonalData, Group = "employment")]`). Precedence: a field's static `Group =` wins; else the event's `[ProtectionGroup]` value; else none — and with none, the key is simply `(subject, class)`, the common turnkey path. Keep the group a **bounded** discriminator (purpose, contract, tenant), *not* a per-record id: high cardinality explodes the key store and defeats key-caching (per-record crypto-delete is possible, just pay for it deliberately).

The generator emits, per protected-bearing type, the encrypt-on-serialize / decrypt-on-deserialize glue — no reflection, matching how every other Whizbang metadata facility is generated. A second, compact example — the same subject and class, but each contract independently erasable:

```csharp{title="Sub-partitioning a key within a class" description="[ProtectionGroup] gives each contract's PII its own (subject, class, group) key — erase one, keep the rest" category="Core Concepts" difficulty="ADVANCED" tags=["gdpr","crypto-shred","data-protection"] framework="NET10"}
public sealed record ContractSigned(
    [DataSubjectId]   Guid PersonId,                   // the subject
    [ProtectionGroup] Guid ContractId,                 // sub-partitions the key WITHIN the class
    [Protected(DataClass.PersonalData)] string SignatureRef
) : IEvent;
// key = (PersonId, PersonalData, ContractId) → forget one contract without touching the others.
```

## Where the key lives — `ISubjectKeyStore` + `wh_subjects`

The whole guarantee rests on the key being held **outside** the event store, so destroying it is meaningful:

```csharp{title="The subject key store abstraction" description="Independent per-(subject, class) keys held outside the event store; DB-table default, pluggable to KMS/Vault" category="Core Concepts" difficulty="ADVANCED" tags=["gdpr","key-store","crypto-shred"] framework="NET10"}
public interface ISubjectKeyStore {
  /// The key for this (subject, class, group), generating + persisting one on the first protected write.
  /// group defaults to null → the class's default (no-group) key. Keys are INDEPENDENT per
  /// (subject, class, group) — never derived from a shared master — so destroying one can never leave
  /// another re-derivable. Cached.
  ValueTask<SubjectKey> GetOrCreateAsync(SubjectId subject, DataClass dataClass, string? group = null, CancellationToken ct = default);

  /// The key if it still exists; null once that (subject, class, group) has been erased (→ redacted read).
  ValueTask<SubjectKey?> TryGetAsync(SubjectId subject, DataClass dataClass, string? group = null, CancellationToken ct = default);

  /// Group-scoped crypto-shred: destroy ONE (subject, class, group) key — e.g. forget one contract's PII.
  ValueTask DestroyGroupAsync(SubjectId subject, DataClass dataClass, string group, CancellationToken ct = default);

  /// Class-scoped: destroy every group key under (subject, class) — e.g. all PersonalData, keep Financial.
  ValueTask DestroyAsync(SubjectId subject, DataClass dataClass, CancellationToken ct = default);

  /// Full erasure: destroy EVERY key for the subject (all classes, all groups) — forget them entirely.
  ValueTask DestroyAllAsync(SubjectId subject, CancellationToken ct = default);
}
```

- The key identity is the **(subject, `DataClass`, group) composite** — with group optional (defaulting to none, so the everyday key is just `(subject, class)`). A **`wh_subjects`** table holds one row per triple — `(subject_id, data_class, group, key, created_at, erased_at)`, PK `(subject_id, data_class, group)` (group defaults to `''`). `key` is an **independent** data-encryption key (DEK); in production it is wrapped by a key-encryption-key in a KMS/Vault (envelope encryption).
- **Why the composite:** it makes `DataClass` (and, when needed, the group) the *unit of erasure and retention*, not just an audit label. That lets you **erase one slice while retaining another under a different legal basis** — destroy a subject's `PersonalData` on an erasure request while keeping their `Financial` records for a 7-year tax/audit retention obligation (GDPR Art. 17(3)(b)); or, within `PersonalData`, forget one contract's data while retaining another's. Each slice can also carry its own **retention schedule** and **key-management policy** (e.g. `Financial`/`Health` in an HSM-backed KMS, `PersonalData` in the DB-table default), and blast radius is isolated — a compromised key exposes only its slice.
- **Default provider = the DB table**; pluggable to HashiCorp Vault, AWS KMS, or Azure Key Vault via `ISubjectKeyStore`. The docs will carry a "move the key store off the DB for production" runbook — a DB-table key store next to the ciphertext is convenient but weaker than a dedicated KMS.
- **Erasure hierarchy — subject ⊃ class ⊃ group.** `DestroyGroupAsync` (one group), `DestroyAsync` (a whole class = every group under it), `DestroyAllAsync` (the whole subject). All flip `erased_at` and wipe/tombstone the key material. Idempotent.

## Encrypt on serialize, decrypt on deserialize

Protection is a **JSON-pipeline concern**, not a call-site concern — a `[Protected]`-aware converter encrypts on the way into `wh_event_store` and decrypts on the way out, so application code never sees ciphertext:

- **Write:** on serialize, each `[Protected]` field is encrypted with its **(subject, class, group) key** — the class from the field's `[Protected(class)]`, the subject from the event's `[DataSubjectId]`, the group from the field's `Group =` or the event's `[ProtectionGroup]` (or none); fetched via `GetOrCreateAsync`, cached. The field lands in the event body as ciphertext + a small envelope (**key id — which resolves the (subject, class, group)** — algorithm, nonce). A non-protected field is written as-is. A single event can carry fields under several different keys.
- **Read:** on deserialize, each `[Protected]` field is decrypted with its **(subject, class, group) key**. If that key is **gone** (that slice erased for the subject), the field reads back as a **redacted tombstone** — `null`, or a typed "[redacted]" marker — *not* an exception. Fields under other keys on the same event still decrypt normally. The event always materializes; only the forgotten fields are blank.

That graceful missing-key behavior is what makes rebuild-on-erasure correct-by-construction (below): a projection re-applying a post-erasure event naturally writes redacted values because the decrypt path handed it nulls.

## Finding a subject's data — subject-id in scope

Erasure must locate every stream carrying a subject's data. Whizbang already propagates a `PerspectiveScope` through events → perspectives; G1 rides it:

> Every event carrying `[Protected]` data **tags its `[DataSubjectId]`(s)** into scope/metadata. Erasure then queries "which streams contain an event scoped to subject S?" and has its rebuild work-list. The [Type-Definition Fingerprint](type-definition-fingerprint)'s optional per-event body-hash facility is the finer-grained locator when a subject must be found by *content* rather than scope.

An analyzer (band-mate of the ephemeral WHIZ1xx rules) **warns if a `[Protected]`-typed value is used as a stream-id or key** — PII must never be an identifier (identifiers are not erasable), a rule the industry states universally.

## The erasure cascade — event-store-only encryption + rebuild-on-erasure

The load-bearing decision (resolved): **encrypt in the event store only; keep projections in plaintext; rebuild affected streams on erasure.**

```mermaid
flowchart TD
  A[Erasure request: subject S<br/>full, OR scoped to a class or group] --> B[ISubjectKeyStore: destroy the<br/>target key&#40;s&#41; — irreversibly gone]
  B --> C[Signal bus: SubjectErased&#40;S&#41;<br/>every instance drops cached key + decrypted PII]
  B --> D[Find streams tagged with subject-id S]
  D --> E[Rebuild those streams]
  E --> F[Re-apply events → decrypt path returns null<br/>&#40;key gone&#41; → projections re-project REDACTED]
  F --> G[Audit tombstone: subject S erased at T]
```

Why plaintext projections + rebuild, rather than encrypting end-to-end into the read models:

- **Projections stay queryable and indexable.** Read models hold decrypted values, so lenses filter/sort/index on them normally — the whole point of CQRS read models. End-to-end ciphertext in `wh_per_*` rows would make them opaque to queries.
- **One key destruction still covers everything** — because erasure *rebuilds* the affected projections, and the rebuild re-projects redacted (the decrypt path hands the projector nulls once the key is gone). No projection can retain decrypted PII past an erasure, because it is re-derived after the key is destroyed.
- **It reuses the rebuild infrastructure** already built for schema evolution — no new "reach into every projection and scrub" machinery.

The considered alternative — **encrypt `[Protected]` end-to-end** so ciphertext flows into perspective rows and snapshots too — makes a single key-destroy cover events + projections + snapshots + backups *without* a rebuild, but sacrifices queryability of the protected fields (they're ciphertext everywhere). We take **rebuild-on-erasure** as the default (queryability wins; erasure is rare and can afford a rebuild), and leave end-to-end as a documented per-field opt-in for fields that are never queried.

**Ephemeral streams take the same cascade with a different last step.** An ephemeral stream is not rebuildable — its events self-destruct, and E1's rebuild guard refuses it — so its authoritative projection can't be rebuilt-redacted. The key-destroy and the `SubjectErased` signal are identical; only "rebuild → re-project redacted" becomes **direct purge of the affected ephemeral projection rows** (`ModelAction.Purge`), legitimate because ephemeral state is a directly-mutable read model we own, not a replay-derived cache. (An un-erased ephemeral row self-destructs on its own anyway; the purge just makes erasure immediate rather than waiting for the reaper.) The event bytes are still crypto-shredded by the same key-destroy, so their WAL/backup/replica remnants are erased regardless of whether the reaper has run.

## Erasure triggers

- **On-demand** — an erasure command/request at any level of the hierarchy: `EraseSubjectAsync(subjectId)` (full), `EraseSubjectClassAsync(subjectId, dataClass)` (one class), or `EraseSubjectGroupAsync(subjectId, dataClass, group)` (one group — e.g. one contract), e.g. a data-subject access-request handler.
- **Scheduled / retention-based** — via the [Temporal Engine](temporal-engine): "erase 30 days after account closure" is a one-shot schedule on the subject. Because keys are per class, **each class can carry its own retention clock** — `PersonalData` erased on request, `Financial` on a 7-year schedule — as independent scheduled erasures on the same subject. Recurring retention sweeps reuse the same engine. This is why G1 sequences *after* F2.
- Either trigger emits a **`SubjectErased` signal** on the system signal bus so every instance invalidates its cached key + any cached decrypted values (crypto on the critical path is mitigated by key caching; the cache must be dropped on erasure — the signal does that).

## Shared plumbing, separate mechanism

G1 is *"work in GDPR now since it shares code paths, but it's a separate mechanism"* — a second consumer of one foundation:

| Shared with the ephemeral/retention foundation | Distinct to G1 |
|---|---|
| Temporal engine (scheduled erasure / retention sweeps) | Per-subject key store + envelope encryption |
| Destruction retention limits (defense-in-depth) | `[DataSubject]` / `[Protected]` + generated crypto glue |
| System signal bus (cache invalidation) | Rebuild-**redact**-on-erasure cascade |
| `PerspectiveScope` (subject-id propagation) | Subject registry (`wh_subjects`) + audit-of-erasure |
| Rebuild infrastructure (rebuild-on-erasure) | Key destruction as the erasure act (vs physical delete) |

## Hard problems, and how G1 answers them

- **Derived data escapes shredding** (projections/snapshots that cached decrypted PII). → **Rebuild-on-erasure** re-derives them after the key is destroyed, so none can retain plaintext. Snapshots below the erasure point are invalidated and rebuilt from the (now-redacted) events.
- **Crypto on the critical path** (per-subject encrypt/decrypt latency). → **Key caching** (in-memory, TTL-bounded), invalidated on erasure via the signal bus. Encrypt/decrypt is amortized; the cache is the hot path.
- **"Encrypted PII is still PII"** (a legal, not technical, position). → Crypto-shred is the *mechanism*; legal sufficiency is the operator's determination. Pair it with **retention limits** (reusing the reaper) as defense-in-depth, and document the stance plainly.
- **PII must never be an identifier** (identifiers aren't erasable). → An **analyzer warning** when a `[Protected]` value is used as a stream-id or key.
- **Computed/aggregated non-PII** derived from PII can't be un-computed. → **Data-minimization guidance** in the docs; the framework can't retract a number it no longer has the inputs for.

## Build increments (docs-first → TDD each)

1. **Attributes + classification** — `[DataSubject]`, `[DataSubjectId]`, `[Protected(DataClass)]` (+ `DeepProtected`/`SerializedProtected`), `[ProtectionGroup]` + the `Group =` literal, `DataClass` open classification (turnkey `PersonalData`/`Health`/`Financial`/`Other` + custom). All target `Parameter | Property | Field`, read as the union of parameter- and property-targeted attributes (so `[property: …]` is optional on records and a protected field is never silently missed). Analyzer for "PII as identifier". Metadata-only, inert.
2. **`wh_subjects` + `ISubjectKeyStore`** — the registry table (PK `(subject_id, data_class, group)`) + the abstraction, DB-table default provider, envelope-encryption shape. **Independent** DEK per `(subject, class, group)` (never derived from a shared master, so a scoped destroy truly erases). `GetOrCreate`/`TryGet` (group optional) / `DestroyGroup` / `Destroy` (a class) / `DestroyAll` (a subject); key caching keyed by `(subject, class, group)`.
3. **Generated crypto glue** — source generator emits encrypt-on-serialize / decrypt-on-deserialize for protected-bearing types; missing-key → redacted tombstone. Wire into the JSON pipeline at the event-store boundary.
4. **Subject-id tagging + locator** — `[DataSubjectId]` tags scope/metadata at emit; a "streams for subject S" query (scope-based, with the fingerprint body-hash as the fine-grained locator).
5. **Erasure cascade** — `EraseSubjectAsync` (full) / `EraseSubjectClassAsync` (class) / `EraseSubjectGroupAsync` (group): destroy the target key(s) → `SubjectErased` signal (cache drop) → find streams → **Sourced:** rebuild → redacted re-projection; **Ephemeral:** purge the projection rows (not rebuildable) → audit tombstone. The correctness lock: inject an erasure and assert (a) Sourced projections rebuild-redacted and the log still replays structurally, (b) ephemeral projections are purged, (c) a protected field reads back unreadable after key-destroy in both — including a still-persisted-but-reaper-pending ephemeral event, and (d) **a scoped erasure leaves the subject's *other* slices still decryptable** — the tax-retention case (destroy `PersonalData`, keep `Financial`) *and* the per-group case (forget one contract, keep the rest).
6. **Scheduled erasure + retention** — retention-based erasure via the temporal engine, **per (subject, class, group)** so each slice carries an independent clock (PersonalData on request, Financial on a 7-year schedule, one contract's data on its own deadline); recurring retention sweeps; OTel meters (erasure requests by level, keys destroyed by class/group, streams rebuilt + duration, decrypt-fail/redaction counts, key-cache hit/miss).

## Relationship to the rest of the initiative

G1 is the last phase because it *composes* everything before it: it forgets subject-data of **any** consistency mode (crypto-shred reaches the persisted bytes — WAL, backups, replicas — that the [ephemeral](ephemeral-events) reaper's physical delete cannot), on a **schedule** (the temporal engine), with **cache coherence** (the signal bus), by **rebuilding** (the rebuild infra) and **redacting** (the generated decrypt path), **locating** subjects via scope and the [fingerprint](type-definition-fingerprint). Archival (A1) and carry-forward compaction (E3) are orthogonal siblings — crypto-shred applies to hot **or** archived data, and to **ephemeral** subject-data too (which self-destructs for economy but is still crypto-shredded to erase, since delete alone never reaches WAL/backup/replica). The result is a complete retention story: keep-forever (Sourced), keep-then-summarize (compaction), keep-then-archive (archival), self-destruct (ephemeral), and **keep-but-forget (crypto-shred)**.
