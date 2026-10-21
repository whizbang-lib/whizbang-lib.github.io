---
title: The Apply-Stack View
pageType: guide
verifiedAgainstCommit: 6357e43e
verifiedDate: 2026-10-21
version: 1.0.0
category: Observability
order: 9
description: >-
  See the shapes your streams take: the ordered event-type paths that built each stream, counted as
  path signatures, the anchored before-and-after flow view, the drill-in to the streams behind a path,
  and the opt-in minimal API, FastEndpoints and Hot Chocolate surfaces that serve them.
tags: >-
  apply-stacks, lineage, flow-view, path-signatures, observability, diagnostics, minimal-api,
  fastendpoints, hotchocolate, security, maintenance
codeReferences:
  - src/Whizbang.Core/Lineage/ApplyStackContracts.cs
  - src/Whizbang.Core/Lineage/ApplyStackFlowView.cs
  - src/Whizbang.Core/Lineage/ApplyStackReporter.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresApplyStackQuery.cs
  - src/Whizbang.Hosting.AspNet/ApplyStackEndpoints.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/WhizbangApplyStackEndpointBase.cs
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateApplyStackExtensions.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Lifecycle/StreamCloser.cs
  - src/Whizbang.Data.Postgres/Migrations/112_StreamGroupCascadeAndApplyPathFold.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ApplyStackQuerySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ApplyPathFoldSqlTests.cs
  - tests/Whizbang.Core.Tests/Lineage/ApplyStackFlowViewTests.cs
  - tests/Whizbang.Core.Tests/Lineage/ApplyStackReporterTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamCloserFoldOrderTests.cs
  - tests/Whizbang.Hosting.AspNet.Component.Tests/ApplyStackEndpointsTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/WhizbangApplyStackEndpointBaseTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/ApplyStackQueryTests.cs
---

# The Apply-Stack View

Every stream was built by applying its events in version order. That ordered list of event types is the
stream's **apply stack**, and it is already stored: each event-store pointer carries the stream, the
version and the event type. The apply-stack view counts those stacks, so you can see the shapes your
streams actually take, compare them, and find the ones that stalled halfway.

The view reads event-store pointers only, never event bodies, and runs only when someone asks. Nothing
on the message path changes.

## Path signatures {#signatures}

A stream's **path** is its event types in version order, **run-length collapsed**: a run of two or more
consecutive events of the same type appears once with a `+` suffix, and a single occurrence appears
plain. So `OrderPlaced, StatusUpdated, StatusUpdated, StatusUpdated, OrderShipped` becomes
`OrderPlaced → StatusUpdated+ → OrderShipped`.

Streams with the same path are counted together as one `ApplyPathSignature`:

| Member | Meaning |
|---|---|
| `Path` | The collapsed, version-ordered event types |
| `StreamCount` | How many streams took exactly this path |
| `FirstSeen` / `LastSeen` | The earliest and latest head-event time among those streams |

The result's size grows with the number of distinct shapes, not with the number of streams or events.
{verified: ApplyStackQuerySqlTests.GetPathSignatures_CollapsesRunsAndGroupsIdenticalShapesAsync, ApplyStackQuerySqlTests.GetPathSignatures_LimitKeepsTheHeaviestShapesAsync}

### The query {#query}

`IApplyStackQuery` is the one query contract every surface uses. The EF Core Postgres driver registers
it (`EFCorePostgresApplyStackQuery`) when you call its turnkey registration; registering it does not
publish anything.

```csharp{
title: "Querying the apply stacks of one perspective"
description: "Lists the heaviest path signatures for the event types that feed one perspective, restricted to one tenant's scope, then drills into the streams behind the heaviest path."
framework: "NET10"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["apply-stacks", "lineage", "path-signatures", "query"]
tests: ["ApplyStackQuerySqlTests.GetPathSignatures_PerspectiveFilter_ProjectsThePerspectivesViewOfTheStreamAsync", "ApplyStackQuerySqlTests.GetPathSignatures_ScopeFilter_KeepsOnlyContainedScopesAsync", "ApplyStackQuerySqlTests.GetStreamsForPath_ReturnsExactlyTheStreamsBehindASignatureAsync"]
}
var options = new ApplyStackQueryOptions {
  PerspectiveName = "MyApp.Orders.OrderSummaryPerspective",  // association registry filter
  ScopeJson = """{"t":"tenant-a"}""",                       // JSONB containment on each event's scope
  MaxSignatures = 50,                                        // heaviest first; default 200
};

var signatures = await query.GetPathSignaturesAsync(options, cancellationToken);
var streams = await query.GetStreamsForPathAsync(signatures[0].Path, options, limit: 100, cancellationToken);
```

The options narrow the events that form the paths:

- **`PerspectiveName`** keeps only the event types the association registry lists for that perspective,
  so you see the perspective's own view of each stream. Null means every event type.
- **`ScopeJson`** keeps only events whose scope contains the given JSON, so a tenant-scoped caller sees
  only its own shapes. Null means no scope filter.
- **`MaxSignatures`** caps the result, heaviest (most streams) first. Default 200.

A stream none of whose events pass the filters contributes no path. `GetStreamsForPathAsync` is the
drill-in: the stream ids whose collapsed path equals the given one exactly, under the same filters,
most recent first.

## The flow view {#flow-view}

`ApplyStackFlowView.Compute(signatures, anchorEventType, radius, maxBranchesPerColumn)` turns signatures
into the familiar before-and-after flow graph: pick an anchor event type and see the weighted paths
`radius` steps either side of it.

- **Nodes** (`ApplyStackFlowNode`) are an event type at a signed offset from the anchor (negative before,
  `0` the anchor, positive after), weighted by the streams that pass through it.
- **Edges** (`ApplyStackFlowEdge`) are the transitions between adjacent columns, weighted the same way.
- A signature counts from the **first** occurrence of the anchor in its path. The anchor also matches its
  collapsed form, so anchoring on `StatusUpdated` includes `StatusUpdated+`.
- Beyond `maxBranchesPerColumn` distinct types in one column (default 10), the heaviest keep their names
  and the rest merge into one `(others)` node; edges into merged nodes are summed onto it.

The flow view is a pure function of the signatures: no I/O, so it gives the same graph whether the
signatures came from a live query or a saved result.
{verified: ApplyStackFlowViewTests.Compute_SingleSignature_ProjectsNodesAndEdgesAroundTheAnchorAsync, ApplyStackFlowViewTests.Compute_AnchorsAtTheFirstOccurrenceOnlyAsync, ApplyStackFlowViewTests.Compute_AnchorMatchesTheRunLengthSuffixFormAsync, ApplyStackFlowViewTests.Compute_CollapsesTheLongTailPerColumnIntoOthersAsync, ApplyStackFlowViewTests.Compute_RadiusBoundsTheWindowAndPathEdgesTruncateAsync}

## Serving the view {#serving-the-view}

Publishing the shapes of your streams is a decision, so nothing serves them until the host mounts a
surface with one explicit call. Every surface builds its response through `ApplyStackReporter`, so the
three cannot differ in what they disclose: event-type names, counts and stream ids, never payloads.

### Minimal API

```csharp{
title: "Mounting the apply-stack endpoints"
description: "Maps the signatures endpoint and the drill-in under one route group and puts the host's authorization in front of both."
framework: "NET10"
category: "Observability"
difficulty: "BEGINNER"
tags: ["apply-stacks", "minimal-api", "endpoints", "security"]
tests: ["ApplyStackEndpointsTests.Signatures_ServesThePathSignaturesAsJsonAsync", "ApplyStackEndpointsTests.MapWhizbangApplyStacks_CustomPattern_MountsBothRoutesUnderItAsync"]
}
// GET /whizbang/apply-stacks and GET /whizbang/apply-stacks/streams
app.MapWhizbangApplyStacks().RequireAuthorization("operators");

// Or under a route of your own
app.MapWhizbangApplyStacks("/ops/apply-stacks").RequireAuthorization("operators");
```

`MapWhizbangApplyStacks` returns the route group's convention builder, so authorization and host
filters chain over both routes at once. The framework adds no authorization of its own.

| Route | Query parameters | Returns |
|---|---|---|
| `GET {pattern}` | `perspective`, `scope`, `max`, and for the flow view `anchor`, `radius` (default 3), `branches` (default 10) | `ApplyStackReport` |
| `GET {pattern}/streams` | `step` (repeated, one per path element, in order), `perspective`, `scope`, `limit` (default 100) | `ApplyStackStreamsReport` |

{verified: ApplyStackEndpointsTests.Signatures_WithAnchor_IncludesTheFlowViewAsync, ApplyStackEndpointsTests.Signatures_PassesFiltersThroughToTheQueryAsync, ApplyStackEndpointsTests.Streams_BindsRepeatedStepParametersAsTheExactPathAsync}

### FastEndpoints

Derive from `WhizbangApplyStackEndpointBase` (signatures and flow) and
`WhizbangApplyStackStreamsEndpointBase` (drill-in). Declaring the endpoint is the opt-in, and it sits
inside FastEndpoints' own security model like any endpoint you write.

```csharp{
title: "The apply-stack endpoint in FastEndpoints"
description: "Declares the signatures endpoint by deriving from the base class; the route and the roles are the host's choice."
framework: "NET10"
category: "Observability"
difficulty: "BEGINNER"
tags: ["apply-stacks", "fastendpoints", "endpoints", "security"]
tests: ["WhizbangApplyStackEndpointBaseTests.BuildReport_PassesFiltersThroughAndComputesTheFlowAsync", "WhizbangApplyStackEndpointBaseTests.BuildStreamsReport_PassesTheExactPathThroughAsync"]
}
public sealed class ApplyStackEndpoint : WhizbangApplyStackEndpointBase {
  public override void Configure() {
    Get("/whizbang/apply-stacks");
    Roles("ops");
  }
}
```

The request binds `Perspective`, `Scope`, `Max`, `Anchor`, `Radius` and `Branches`; the drill-in binds
`Step`, `Perspective`, `Scope` and `Limit`.

### Hot Chocolate

```csharp{
title: "Adding the apply-stack query fields"
description: "Registers the whizbangApplyStacks and whizbangApplyStackStreams query fields on the GraphQL schema."
framework: "NET10"
category: "Observability"
difficulty: "BEGINNER"
tags: ["apply-stacks", "hotchocolate", "graphql"]
tests: ["ApplyStackQueryTests.WhizbangApplyStacks_ServesSignaturesAndTheAnchoredFlowAsync", "ApplyStackQueryTests.WhizbangApplyStackStreams_PassesTheExactPathThroughAsync"]
}
builder.Services
  .AddGraphQLServer()
  .AddQueryType()
  .AddWhizbangApplyStacks();
```

The fields `whizbangApplyStacks(perspective, scope, max, anchor, radius, branches)` and
`whizbangApplyStackStreams(steps, perspective, scope, limit)` are added as a type extension, so
`[Authorize]` and the rest of your GraphQL security apply to them as to any field.

### When there is nothing to report {#unavailable}

Every surface returns an `ApplyStackReport` (or `ApplyStackStreamsReport`) with `Available` and
`Reason`. When no `IApplyStackQuery` is registered, or the query throws (a store mid-migration, a
missing table), the report says `Available: false` with the reason, instead of an empty list that looks
like an answer. Cancellation is not swallowed.
{verified: ApplyStackReporterTests.BuildAsync_NoQueryRegistered_ReportsUnavailableWithReasonAsync, ApplyStackReporterTests.BuildAsync_ThrowingQuery_ReportsUnavailableWithTheExceptionReasonAsync, ApplyStackReporterTests.BuildAsync_Cancellation_PropagatesRatherThanReportingUnavailableAsync, ApplyStackEndpointsTests.Signatures_NoQueryRegistered_ReportsUnavailableWithReasonAsync}

## Shapes that outlive their streams {#folding}

Retention and period closes destroy event-store pointers, and with them the paths. So a path is
**folded** into a persisted signature table, `wh_apply_paths`, before its stream's pointers can go:

- **On a period close.** `IStreamCloser.CloseAsync` folds the stream's path before it truncates. The
  stream's detail goes; its shape stays counted.
- **When a stream settles.** Each maintenance cycle may fold streams that have been idle for
  `SettledFoldIdleDays`, once each (a watermark records what was folded).

The unfiltered view (no `PerspectiveName`, no `ScopeJson`) adds the folded counts to the live ones.
Folded signatures carry no perspective or scope, so a filtered query reads live streams only.
{verified: ApplyPathFoldSqlTests.Fold_TheStreamDies_ItsShapeSurvives_AndTheUnfilteredViewUnionsItAsync, ApplyPathFoldSqlTests.Fold_IsWatermarked_RefoldingTheSameStreamCountsNothingAsync, ApplyPathFoldSqlTests.SettledFold_FoldsIdleStreamsOnly_AndOnlyOnceAsync, StreamCloserFoldOrderTests.Close_FoldsTheApplyPath_BeforeTheTruncateAsync}

The settled fold runs at most once per claim window across the whole service. Its settings sit on
`MaintenanceWorkerOptions`, bound from `Whizbang:Workers:Maintenance`:

| Option | Default | Meaning |
|---|---|---|
| `SettledFoldIdleDays` | 90 | Idle days before a stream counts as settled and folds |
| `SettledFoldBatchSize` | 1000 | Streams folded per sweep |
| `SettledFoldClaimWindowHours` | 24 | Minimum hours between settled folds service-wide |

{verified: ApplyPathFoldSqlTests.SettledFoldClaim_FirstInstanceWins_SiblingsSkipAsync}

## Drivers {#drivers}

The query and the fold are Postgres SQL in the EF Core driver. With another driver, no
`IApplyStackQuery` is registered and every surface reports itself unavailable.

## Related

- [Perspective Row Retention](../../fundamentals/perspectives/row-retention): the sweeps that remove read-model rows.
- [Closing a Stream's History](../../fundamentals/events/event-streams#closing-a-stream): the truncate a fold precedes.
- [The Startup Status Surface](../startup/startup-status): the same opt-in serving pattern.
