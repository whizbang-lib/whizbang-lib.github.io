# Missing-tests plan — closing the coverage-map gaps

Companion to `plans/verified-coverage-burndown.md`. The coverage map is at **97% (2,607 / 2,682)**;
this plan turns the two remaining amber/excused categories green by **writing or exposing the tests in
the Whizbang library** (`../whizbang/`), then regenerating the map.

## CORRECTION (2026-07-21) — the badge renders from test-status, NOT the map

The original framing below assumed a block can only render green if its key is in
`code-tests-map.json`. **That is wrong.** `verified-badge.component.ts` → `TestStatusService`
resolves pass/fail from `src/assets/data/test-status/*.json` alone (a key in *any* shard renders);
`code-tests-map.json` is only authoring-validation/navigation. Consequence, measured by
`node src/scripts/test-status-report.mjs`:

- **~109 blocks excused as "outside the coverage map" cite a test that is actually passing in CI** —
  they render **⚪ excused** today but would render **🟢 green** if re-linked with `tests=[Class.Method]`.
  This is a **docs-only re-annotation** (the agents already named the method in their notes); it needs
  **no library change and no new release.** (109 is an upper bound — some are correct
  consumer-call-site excuses; confirm the method verifies the block before flipping.)
- **43 distinct linked keys render "no data"** (linked as verified but absent from the published run) —
  renames/typos or contract-test bases run under derived names. These need auditing, not new tests.
- The map regen is a red herring for coverage; it only matters for KEEPING the published test-status
  current — see "new W! release" below.

The revised tracks:

| Track | What it is | Count | Fix |
|---|---|--:|---|
| **A** | Excused, but the test passes in CI | ~109 blocks (upper bound) | **Re-link `unverified=` → `tests=[…]`** (docs-only). `--fixable` lists them. |
| **B** | Linked, but no CI result ("no data") | 43 distinct keys | Fix the key (rename/typo) or excuse honestly. `--missing` lists them. |
| **C** | Documented, genuinely no test | ~75 blocks + `ScopedQueryTests`/`QueryExecutionTests` | Write the test (see Track 2 below). |

"New W! release should have new test json" still matters — but for **freshness**, not coverage: the
published run is `0.951.52-alpha.15` @ 2026-07-18. Wire regen + test-status publish into the release so
newer tests (the 32 ephemeral/scheduling/signal classes a regen already finds) show up as they land.

---

## (Original framing — superseded by the correction above; kept for the Track 2 detail)

A regen dry-run (2026-07-21) added 222 keys / 32 new classes to the map but unlocked none of the
excused classes (they don't match `XxxTests → Xxx`). That led to the two-track split below — now
refined by the correction above (most of "Track 1" is really Track A: docs-only re-linking).

| Track | What it is | Count | Fix | Ships with |
|---|---|--:|---|---|
| **1** | Test **exists**, not in the map | ~50 classes / 76 blocks | Re-link in docs (Track A); library `<tests>` tags only needed to also index them in the *map* | Docs PR (+ optional release) |
| **2** | Behavior documented, **no test anywhere** | ~75 blocks | Write the test | Library PR + release |

---

## Track 1 — existing-but-unmapped (add `<tests>` tags)

These classes are cited in 76 doc blocks as verified-but-outside-the-map. Adding a
`/// <tests>Class.Method</tests>` tag (or making the class name convention-matchable) on the source
each covers makes the next regen pick them up. Highest-leverage first (block count = docs that flip):

- **5×** `ScopedQueryTests`, `BaseUpsertStrategyInPlaceUpdateTests`
- **4×** `PinnedPoolRegistrationTests`
- **3×** `DispatcherLocalInvokeAndSyncTimingTests`
- **2×** `GraphQLMutationLifecycleTests`, `GenerateStreamIdGeneratorTests`, `EventStoreAppendBatchTests`,
  `DispatcherOwnedDomainTests`, `AzureBlobOffloadDIRegistrationTests`
- **1× each** (the sync-mode dispatcher suite `DispatcherSyncModeContract/Behavior/Callback`,
  `DispatcherPublishOnceTests`, the DLQ SQL suite `MoveToDeadLettersSql/DeadLetterRecoverySql/
  CompleteOutboxPublishedSql/FetchOutboxBatchSql`, `EFCoreCommitHandler/ClaimHandler`,
  the `PerspectiveWorker{ChannelMode,Dedup,DrainMode,SecurityContext,PostLifecycle,DeadLetterFilter}`
  suite, `StuckRowSentinel*`, `RecordTypesConstructionTests`, `MessageProcessingStatusTests`,
  `IdentityValueObjectTests`, `MessageAssociationRegistryTests`, `MessageEnvelopeVersionTests`,
  `QueryExecutionTests`, `SqlFilterPatternMatchingTests`, `ISchemaBuilderContractTests`,
  `AzureServiceBus{BatchSubscribe,ProvisioningPath,TransportBatchPipeline}Tests`,
  `AzureBlob{StoreRoundTrip,OffloadFromConfiguration}Tests`, `PhysicalFieldDiscoveryTests`,
  `PerspectiveDiscoveryGeneratorTests`, `PostLifecyclePipeline/LocalImmediateLifecycleStage`,
  `LeaseRenewalWorkerCap`, `Coordinator/WorkCoordinatorDtoSurface`, `DapperWorkCoordinatorWithData`,
  `EFCoreFlusherMethods`, `SubscribeBatch`, `StoreInboxMessagesSql`, `DefaultDeadLetterRecoveryPolicy`)

The full per-block list is derivable from the docs:
`grep -rn "outside the current coverage map" src/assets/docs/v1.0.0`.

> A generator enhancement (index SQL/integration test classes by `[Trait]`/`<tests>` rather than only
> `XxxTests→Xxx`) would batch-fix most of Track 1 — worth considering over ~50 hand-added tags.

---

## Track 2 — genuinely missing tests (write them)

75 documented behaviors with no test. Grouped by theme, with the library test class to extend and a
rough priority (P0 = cheap unit test closing a real gap; P2 = sample/tutorial coverage).

### P0 — analyzer/diagnostic clean-path & wiring (≈19 blocks)
The diagnostic reference pages show valid "✅ fixed" patterns and edge scenarios that **no analyzer
test asserts produce no diagnostic**. Add no-diagnostic (and where noted, emit) cases:
- **WHIZ090** (`MessageTagParameterAnalyzerTests`): "Multiple Parameters" clean case, "Rename Parameter",
  "Add matching Property" (whiz090.md:91/123/139).
- **WHIZ080** (`ReceptorDiscoveryGeneratorTests`): single-handler RPC pattern + the three fix options
  (whiz080.md:53/98/112/132) — WHIZ080 is disabled-by-default, so assert no-diagnostic explicitly.
- **WHIZ031** (`PerspectiveDiscoveryGeneratorTests` diagnostics): property-choice, order-aggregate,
  multi-id + composite-key scenarios (whiz031.md:76/114/161/176).
- **WHIZ101/102/103** perspective diagnostics (perspectives.md:430/452/471) — no tests exist.
- **WHIZ802** (schema generator): the descriptor is **unwired** (no emit path). Decide: wire it +
  test (whiz802.md:68/101), or document as intentionally-inert and mark the blocks `unverified`.
- **WHIZ400** "Runtime Behavior" (whiz400.md:137): `MultiModelScopedAccess` runtime path — needs a
  runtime test, not the analyzer test.

### P0 — source-generator utilities (≈6 blocks)
`TypeSymbolExtensions` helpers are documented but untested — add `TypeSymbolExtensionsTests`:
- `FindMethodWithAttribute`, `GetAllMethodsByName`, event-handler discovery
  (type-symbol-extensions.md:185/194/211/220/270), and the record-parameter aggregate-id path
  (aggregate-ids.md:210).

### P0 — generated-registration assertions (≈4 blocks)
`ServiceRegistrationGeneratorTests` asserts method *names* but not the emitted **signature/body** or the
`IncludeSelfRegistration = false` output. Add:
- signature/body assertions for `AddPerspectiveServices`/`AddLensServices`/`AddAllWhizbangServices`
  (all-services.md:30/51, {lens,perspective}-services.md:30),
- the disabled-self-registration emission (service-registration-options.md:55).

### P1 — worker / transport / gate behaviors (≈8 blocks)
- **`InProcessTransport.InitializeAsync` / `IsInitialized`** (in-memory.md:107) — a genuine gap: the
  RabbitMQ/AzureSB init tests assert the *opposite* contract; InProcess needs its own
  (`InProcessTransportTests`).
- `PerspectiveWorker.RequestImmediatePoll()` and the `OnWorkProcessingIdle` hook
  (perspective-worker.md:152/615).
- `ISchemaReadyGate` consumer path, `WhizbangDatabaseInitializerService.StartAsync`, the ClaimWorker
  gate usage + "SQL fired against unmigrated DB" fix (database-readiness.md:57/97/125/176/324).

### P1 — dispatcher caller-info & perspective sync (≈4 blocks)
- Dispatcher bakes the call site into the first hop (caller-info-capture.md:90/105) — extend
  `MessageTracingTests`/dispatcher tests to cover the dispatch-path capture.
- `IncludeProcessedEventIds` option + cross-scope sync (perspective-sync.md:731, sync.md:212).

### P2 — tutorial / sample suite (≈8 blocks)
Tutorial service code with no ECommerce-sample test: `CustomerActivityReceptor`, `CustomerActivityDto`,
`Customers`/`Orders` controllers (customer-service.md), the shipping event receptor
(shipping-service.md:118), and the testing-strategy fixtures/mocks. Add sample tests under
`samples/ECommerce/tests/…`. (Lower priority — teaching code.)

### Review-before-writing (likely Track 1, not missing)
Several migration-guide and REST/GraphQL bare gaps document behaviors that **do** have tests
(cascading tuple returns, batched append, atomicity, `[RestLens]`/`[CommandEndpoint]` attributes) —
check for an existing test first; most belong in Track 1 (tag) or are generator-input/counter-example
excuses, not new tests.

---

## Execution order
1. **Track 1 first** (cheap, mechanical): add `<tests>` tags for the top-cited classes → regen →
   re-annotate. Biggest coverage jump per hour. Ship with the next W! release.
2. **Track 2 P0** (analyzer/generator/utility unit tests): highest value-density new tests.
3. **Track 2 P1/P2** as capacity allows.
4. **Wire the regen into the W! release pipeline** so every release publishes a current
   `code-tests-map.json` + `test-status/` data — then the docs never drift from the library.
