---
title: Closing the Books
pageType: concept
version: 1.0.0
category: Core Concepts
order: 18
description: >-
  Closing a stream's books ends a period: the closing summary is appended, the stream is sealed, and a successor stream
  opens with the opening balance, linked back to the stream it continues, all in one transaction. By hand with
  IBookCloser, or by an end-of-life policy whose action is CloseBooks.
tags: 'closing-the-books, period-close, carry-forward, opening-balance, successor-stream, stream-end-of-life, sealing, archive'
codeReferences:
  - src/Whizbang.Core/Lifecycle/IBookCloser.cs
  - src/Whizbang.Core/Lifecycle/OpeningBalance.cs
  - src/Whizbang.Core/Lifecycle/IBookClosingHandler.cs
  - src/Whizbang.Core/Lifecycle/StreamDispositionStep.cs
  - src/Whizbang.Core/Archival/StreamLifecycleAction.cs
  - src/Whizbang.Core/Archival/ArchiveOptionsBinder.cs
  - src/Whizbang.Data.Postgres/PostgresBookCloser.cs
  - src/Whizbang.Data.Postgres/Migrations/315_CloseTheBooks.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreDirectAppendRowBuilder.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresEventStore.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CloseBooksSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperCloseBooksTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/BookCloserTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamDispositionStepTests.cs
  - tests/Whizbang.Core.Tests/Archival/StreamLifecycleOptionsBinderTests.cs
---

# Closing the Books

An account, a ledger or a subscription runs in periods. At a period boundary the domain knows what carries forward (a
balance, an open position) and the detail before it is history. **Closing the books** ends the period: the closing
summary is the stream's last event, the stream is [sealed](stream-end-of-life.md#sealing-a-stream), and a **successor
stream** opens with the opening balance as its first event, linked back to the stream it continues. The sealed
predecessor stays readable and is later [disposed of](stream-end-of-life.md#scheduled-disposition) like any sealed stream
(archived, by default), so the hot store keeps only the current period.

```mermaid{caption="Closing the books: one transaction appends the summary, seals the predecessor and opens the successor." tests=["CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync", "CloseBooksSqlTests.ThePredecessor_IsArchivedOnceItsGraceHasPassed_AndStaysReadableThroughTheArchiveAsync"]}
flowchart LR
  P[Predecessor: deposits 1..n] -->|1. append| S[Closing summary, version n+1]
  S -->|2. seal| X[Predecessor sealed]
  X -->|3. open| O[Successor: opening balance, version 1]
  O -.->|PredecessorStreamId, PredecessorFinalVersion| P
  X -->|FinalizeGrace later| A[Predecessor archived, still readable]
```

## Closing the books {#closing-the-books}

Derive the opening event from `OpeningBalance`, and call `IBookCloser.CloseBooksAsync`. Both Postgres drivers register
the closer with no configuration.

```csharp{title="Close a ledger's month" description="The month's closing summary ends the ledger stream; the next month's stream opens with the carried balance." category="Core Concepts" difficulty="INTERMEDIATE" tags=["closing-the-books", "period-close", "opening-balance"] tests=["CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync"]}
public sealed record MonthClosed([property: StreamId] Guid LedgerId, decimal Balance) : IEvent;

public sealed record MonthOpened : OpeningBalance {
  public decimal Balance { get; init; }
}

public sealed class MonthEnd(IBookCloser closer) {
  public async Task<Guid?> CloseAsync(Guid ledgerId, decimal balance, CancellationToken ct) {
    var result = await closer.CloseBooksAsync(ledgerId, new MonthClosed(ledgerId, balance), new MonthOpened { Balance = balance }, ct);
    return result.Status == BookCloseStatus.Closed ? result.SuccessorStreamId : null;
  }
}
```

| Status | Meaning |
|---|---|
| `Closed` | The summary was appended, the stream sealed and the successor opened; `SuccessorStreamId` and `PredecessorFinalVersion` say where. |
| `AlreadySealed` | The stream is sealed already; nothing changed. |
| `Archived` | The stream is archived whole; nothing changed. Restore it first. |
| `StreamChanged` | An event was appended to the stream while its books were closing; nothing changed, and a retry closes them. |
| `NothingToClose` | The empty stream id, or a stream with no Sourced event; nothing changed. |

| Choice | Reason | Verified |
|---|---|---|
| The books close onto a **successor stream**, not onto the same stream (owner decision, 2026-11-02). | A sealed predecessor ends cleanly: it refuses appends, is disposed of by the ordinary sealed-stream path, and its history is never rewritten; the new period starts at version 1 with nothing to carry but the opening balance. | {verified: CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync} |
| The summary, the seal and the successor commit together (`wh_close_books`, migration 315, which calls the direct append twice and the finalizer once). A failure opening the successor leaves the predecessor unsealed with no summary. | A closed book with no successor, or a successor whose predecessor is still open, would lose the carried balance or double it. | {verified: CloseBooksSqlTests.CloseBooks_AFailureOpeningTheSuccessor_LeavesThePredecessorUnsealed_AndStoresNothingAsync} |
| The opening event derives from `OpeningBalance`, and the framework sets its `SuccessorStreamId`, `PredecessorStreamId` and `PredecessorFinalVersion`, replacing what the caller set. | The link is a fact of the close, not domain data; a caller could not know the successor's id or the summary's version in advance. | {verified: CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync, BookCloserTests.AnOpeningBalance_StartsWithNoLink_AndKeepsTheOneItIsGivenAsync} |
| The framework picks the successor's id (`TrackedGuid`, UUIDv7) and returns it. | The successor is new by definition; letting the caller name it would let two closes collide. | {verified: CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync} |
| The closer reads the stream's newest version first and the SQL checks it is unchanged, under the stream's append lock; otherwise nothing is written and the answer is `StreamChanged`. | The predecessor's final version is stored on the successor, so it must be exact; checking under the lock every append takes means no append slips between the check and the summary. | {verified: CloseBooksSqlTests.CloseBooks_ThroughTheCloser_ReportsEachRefusalItsCallerCanActOnAsync, CloseBooksSqlTests.CloseBooks_WaitsForTheStreamsAppendLockAsync, CloseBooksSqlTests.CloseBooks_RefusesEachStreamItCannotClose_AndChangesNothingAsync} |
| A sealed, archived, empty or event-less stream is refused with nothing changed. | Each is either closed already, gone from the hot store, or has no books. | {verified: CloseBooksSqlTests.CloseBooks_RefusesEachStreamItCannotClose_AndChangesNothingAsync} |
| The seal's reason names the successor (`Books closed; continued by stream <id>`), and a later append to the predecessor throws `StreamSealedException` with it. | A writer refused by a closed book learns where the stream continues. | {verified: CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync} |
| Both events are stored exactly as the driver's direct append stores them (the same envelope, metadata, persistence policies and kind bits). | A closed book's events must read back, rewind and rebuild like any other. | {verified: CloseBooksSqlTests.CloseBooks_AppendsTheSummary_SealsTheStream_AndOpensTheSuccessorLinkedToItAsync, DapperCloseBooksTests.AddWhizbangPostgres_RegistersTheCloser_WhichClosesTheBooks_AndTheSuccessorReadsBackLinkedAsync} |
| The sealed predecessor is disposed of after its grace like any sealed stream, and stays readable. | Closing the books changes no rule of a sealed stream; its type's action decides (archive by default). | {verified: CloseBooksSqlTests.ThePredecessor_IsArchivedOnceItsGraceHasPassed_AndStaysReadableThroughTheArchiveAsync} |

## By policy {#by-policy}

An [end-of-life policy](stream-end-of-life.md#policies) can close a stream's books when one of its triggers fires, with
`Action: CloseBooks`. Only the domain can write the closing summary and the opening balance, so the host registers an
`IBookClosingHandler` that supplies them.

```csharp{title="Close a ledger's books when it reaches 10,000 versions" description="The handler folds the ledger into its balance; the policy closes the books at the version cap." category="Core Concepts" difficulty="ADVANCED" tags=["closing-the-books", "policies", "version-cap"] tests=["StreamDispositionStepTests.CloseBooks_AsksTheHandlerForTheEvents_ThenTheCloserClosesTheBooks_WithNoHookNoGateAndNoTruncateAsync"]}
// appsettings: "Whizbang": { "StreamLifecycle": { "Enabled": true,
//   "Types": { "Shop.Ledger.LedgerOpened": { "KeepTailVersions": 10000, "Action": "CloseBooks" } } } }
public sealed class LedgerBooks(ILedgerBalances balances) : IBookClosingHandler {
  public async ValueTask<BooksToClose?> PrepareAsync(BookClosingContext context, CancellationToken ct) {
    var balance = await balances.GetAsync(context.StreamId, ct);
    return BooksToClose.Of(new MonthClosed(context.StreamId, balance), new MonthOpened { Balance = balance });
  }
}

// services.AddSingleton<IBookClosingHandler, LedgerBooks>();
```

| Choice | Reason | Verified |
|---|---|---|
| `CloseBooks` with no `IBookClosingHandler` registered fails the host's start, naming the stream types; a host whose types never use it needs none. | It could never run, and finding out at the first pick would be months too late. | {verified: StreamLifecycleOptionsBinderTests.Registration_CloseBooksWithNoBookClosingHandler_FailsTheStart_NamingTheTypes_AndWithOneStartsAsync} |
| The handler is told the stream, its type, the trigger's reason and the version the stream was picked at; `null` defers the stream for the retry backoff. | The domain decides what carries forward; a handler not ready yet (a balance still settling) leaves the stream open. | {verified: StreamDispositionStepTests.CloseBooks_AsksTheHandlerForTheEvents_ThenTheCloserClosesTheBooks_WithNoHookNoGateAndNoTruncateAsync, StreamDispositionStepTests.CloseBooks_AHandlerThatReturnsNothing_DefersTheStream_AndNothingIsClosedAsync} |
| `BooksToClose.Of` keeps each event's type, so the closer stores each as what it is. | A summary typed as `IEvent` would be stored, routed and read back as the wrong type. | {verified: BookCloserTests.BooksToClose_KeepsItsEvents_AndClosesWithThemAsTheirOwnTypesAsync} |
| Closing the books by policy runs no consumption gate, no destruction hold and no PreDestruction hook, and a version cap whose action closes the books closes them instead of cutting the prefix. | It destroys nothing: the predecessor is sealed whole, and its own disposition later runs the gates and the hook. | {verified: StreamDispositionStepTests.CloseBooks_AsksTheHandlerForTheEvents_ThenTheCloserClosesTheBooks_WithNoHookNoGateAndNoTruncateAsync} |
| A close the closer refuses (`StreamChanged`, sealed, archived) is logged and not deferred; with no handler or no closer the stream is deferred and logged. | A refused close is decided afresh next cycle if a trigger still holds; a missing service is a host problem to report. | {verified: StreamDispositionStepTests.CloseBooks_NoHandlerOrNoCloser_DefersAndLogs_AndARefusedClose_IsLoggedAndLeftForTheNextCycleAsync} |
| `CloseBooks` maps to the `Archive` disposition. | It is the disposition of the sealed predecessor a closed book leaves. | {verified: StreamLifecycleOptionsBinderTests.Action_CloseBooks_IsAnAction_AndItsSealedPredecessorIsArchivedAsync} |

## Tests {#tests}

| Test class | What it locks |
|---|---|
| `CloseBooksSqlTests` | the one-transaction close, the link, the rollback of a failed step 3, each refusal, the append lock, the predecessor's archive, the EF Core driver's registration |
| `DapperCloseBooksTests` | the Dapper driver's closer and its stored events |
| `BookCloserTests` | `OpeningBalance` and `BooksToClose` |
| `StreamDispositionStepTests` (closing the books) | the handler, the closer, deferrals and refusals by policy |
| `StreamLifecycleOptionsBinderTests` | `CloseBooks` as an action, and the start refused without a handler |

## Related

- [Stream End of Life](stream-end-of-life.md): sealing, scheduled disposition and policies
- [Archive Store](archive-store.md): where the sealed predecessor goes
- [Event Streams](event-streams.md): truncating a stream's prefix, which keeps one stream instead of opening a successor
