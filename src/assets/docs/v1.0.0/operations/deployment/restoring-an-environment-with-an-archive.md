---
title: Restoring an Environment with an Archive
pageType: guide
version: 1.0.0
category: Advanced Topics
order: 8
description: >-
  Restore a service database to a point in time and bring its Azure Blob archive to the same point: why the two stay
  consistent (objects are never updated, the store never purges), how to restore in place or into another environment,
  and the deletion delay for storage without soft delete.
tags: 'archive, azure-blob, owner-marker, one-database-per-container, point-in-time-restore, pitr, soft-delete, disaster-recovery, restore, deletion-delay, delete-after, orphan-sweep, repoint, location-mismatch, failover'
codeReferences:
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveStore.cs
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveOptions.cs
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveServiceCollectionExtensions.cs
  - src/Whizbang.Archive.AzureBlob/ArchiveObjectDeletionStep.cs
  - src/Whizbang.Archive.AzureBlob/ArchiveSweepMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/465_ArchiveDatabaseIdentity.sql
  - src/Whizbang.Data.Postgres/Migrations/269_ArchiveObjectDeletionQueue.sql
  - src/Whizbang.Data.Postgres/Migrations/353_ArchiveLocations.sql
  - src/Whizbang.Data.Postgres/Migrations/553_ArchiveLocationPinIsNormalized.sql
  - src/Whizbang.Core/Archival/ArchiveLocationMismatchHandling.cs
testReferences:
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreImmutabilityTests.cs
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreDeleteAfterTests.cs
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreOwnerMarkerTests.cs
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreTests.cs
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreLocationMismatchTests.cs
  - tests/Whizbang.Archive.AzureBlob.Tests/AzureBlobArchiveRegistrationTests.cs
---

# Restoring an Environment with an Archive

A service that uses the [Azure Blob archive store](../../fundamentals/events/archive-store#the-azure-blob-store) keeps
its events in two places: the hot events and the archive manifest in its database, and the archived events as objects
in a blob container. Restoring the environment to an earlier moment means bringing **both** to that moment: the
database with its point-in-time restore, and the container with soft-delete replay (or blob point-in-time restore).

This page explains why that pairing is consistent, the steps for restoring in place and into another environment, and
the deletion delay for storage that keeps nothing after a delete.

## Why the two stay consistent {#why-it-is-consistent}

A storage restore can bring back an object that was deleted, and it can remove an object that was created later. It
cannot reconcile an object whose bytes changed under the same name. Two guarantees of the store mean it never has to.

```mermaid{caption="A database restored to T names only objects that existed at T; soft delete keeps every one of them, and none was ever changed." tests=["AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync","AzureBlobArchiveStoreTests.DeleteAfter_ADatabaseRestoredToAnEarlierCopy_ReadsEveryStream_OnlyWithTheDelayOnAsync"]}
flowchart LR
  T["Restore point T"] --> DB["Database at T: manifest names objects O1..On"]
  T --> ST["Container at T"]
  DB -->|"each Oi was created before T, never updated"| SAME["Same bytes as at T"]
  ST -->|"deleted after T: undeleted from soft delete"| SAME
  ST -->|"created after T: named by nothing, may stay"| ORPHAN["Orphan, ignored"]
```

### Archived objects are never updated {#never-updated}

{verified: AzureBlobArchiveStoreTests.Write_NeverReplacesAnObject_WithDifferentBytesUnderItsName_TheStreamStaysHotAsync, AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync}

An archived object is written once and is then only read or deleted. Its access tier is set when it is written and
never changed, and the store sets no metadata, properties or tags afterwards.

| Choice | Reason | Verified |
|---|---|---|
| Every object write is create-only (`If-None-Match: *`): storage refuses a write to a name an object already holds. | A database restored to a point in time names objects by their path and checks each against the length and SHA-256 its manifest row recorded. Only an object that never changes is guaranteed to match a manifest row from any earlier moment, so a database and its storage can be restored to the same point. | {verified: AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync} |
| A write that finds its name already taken keeps the object that is there and checks it like a read does: the same bytes let the write go on, anything else refuses it with `ArchiveObjectCorruptedException`, and the write rolls back. | The name carries the content hash, so the object already there is normally these same bytes: a retry after a crash between the upload and the commit, or the same events archived again before a restore's own delete ran. Nothing under a name is ever replaced, and an object that is not what its name says is reported rather than archived over. | {verified: AzureBlobArchiveStoreTests.Write_NeverReplacesAnObject_WithDifferentBytesUnderItsName_TheStreamStaysHotAsync, AzureBlobArchiveStoreTests.Write_ACrashAfterTheUploadBeforeTheCommit_IsRetriedWithoutADuplicateAsync, AzureBlobArchiveStoreTests.Restore_ThenArchiveTheSameEventsAgain_KeepsTheLiveObject_OutOfTheQueueAsync} |
| A test records every request the store sends across every operation and fails on any request that is not a create, a read, a list or a plain delete. | The guarantee is what a restore depends on, so a later change that rewrote an object, or changed its tier or metadata, must fail a test rather than silently break a restore. | {verified: AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync} |

### The store never purges {#never-purges}

{verified: AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync}

Every delete the store makes is the ordinary blob delete. With soft delete on, a deleted object stays recoverable for
the account's retention period. The store never permanently deletes an object, never deletes snapshots or versions,
never undeletes, and never deletes a container.

| Choice | Reason | Verified |
|---|---|---|
| The only delete is the plain blob delete: no `x-ms-delete-snapshots`, no permanent delete, never addressed to a snapshot or a version. | Retention of deleted objects belongs to the storage account alone. A store that purged would shorten the window in which the container can be brought back to match a restored database, behind the operator's back. | {verified: AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync} |
| The store never undeletes and never deletes a container. | Undeleting is part of a restore, which the operator runs to a chosen point; a container is the environment's, not the store's. | {verified: AzureBlobArchiveStoreTests.EveryStorageRequest_CreatesReadsListsOrPlainDeletes_NeverUpdatesOrPurgesAsync} |

## Restoring in place {#restoring-in-place}

{verified: AzureBlobArchiveStoreTests.DeleteAfter_ADatabaseRestoredToAnEarlierCopy_ReadsEveryStream_OnlyWithTheDelayOnAsync}

Set the container's **soft delete retention to at least the database's point-in-time restore window**. Then:

1. Restore the database to the point in time T.
2. Bring the container to T: undelete every object deleted after T (soft delete), or use blob point-in-time restore to
   T where the account has it. Restoring objects by their creation date alone is not enough: it misses the objects
   deleted after T, which are exactly the ones the restored database still names.
3. Objects created after T may be deleted or left. The restored database never names them, so nothing reads them; with a
   [deletion delay](#a-deletion-delay) the orphan sweep removes them.
4. Start the services. Deletions the restored database had queued but not yet run simply run again; a delete of an
   object that is already gone counts as done.

## Restoring into another environment {#restoring-into-another-environment}

To bring a database and its archive into another account or environment (a copy for testing, disaster recovery to
another region):

1. Restore or copy the database.
2. Copy the container's objects to the target container, after bringing the source to the same point as in
   [restoring in place](#restoring-in-place) if objects were deleted since.
3. Configure the services for the target container and call
   [`RepointLocationAsync`](../../fundamentals/events/archive-store#repointing-an-environment) with the location the
   first refused read names. No object is moved or rewritten; the one location row is updated.

Until the location is repointed, every read, restore and delete of a copied record is refused with
`ArchiveLocationMismatchException`, so a copy never reads or deletes the source environment's objects. That is the
default, `Whizbang:Archive:AzureBlob:LocationMismatch = Error`.

### When infrastructure decides the location {#when-infrastructure-decides}

{verified: AzureBlobArchiveStoreTests.Move_ARecordPinnedToTheOldLocation_IsHandledAsConfiguredAsync, AzureBlobArchiveStoreTests.Copy_QueuedDeletionsPinnedToTheSource_AreHandledAsConfiguredAsync}

Where restores, storage failovers and copies to other environments are run by infrastructure that always points the
service at the container holding the right objects, the repoint step can be left out by choosing another
[location mismatch handling](../../fundamentals/events/archive-store#location-mismatch):

| Move | `Error` (default) | `Warning` or `Info` | `Ignore` |
|---|---|---|---|
| Database and storage restored in place, configuration unchanged | No mismatch | No mismatch | No mismatch |
| Storage restored into another container | Stops until repointed | Goes ahead in the configured container, logged | Goes ahead, not logged |
| Storage failed over to another account endpoint | Stops until repointed | Goes ahead at the configured endpoint, logged | Goes ahead, not logged |
| Storage failed over with the account's endpoint unchanged | No mismatch | No mismatch | No mismatch |
| Database copied to another environment | Stops until repointed; its deletion queue deletes nothing | Goes ahead in the copy's container, logged; queued deletions run there | Goes ahead, not logged; queued deletions run there |

A location written only another way (case, surrounding whitespace, a trailing slash, the default port) is never a
mismatch ([normalized locations](../../fundamentals/events/archive-store#normalized-locations)). Repointing still
works under every setting and is what stops the log entries; afterwards the setting can go back to `Error`.

## A deletion delay {#a-deletion-delay}

{verified: AzureBlobArchiveStoreTests.DeleteAfter_ARestoreAndADelete_LeaveTheirObjects_UntilTheDelayHasPassedAsync, AzureBlobArchiveStoreTests.DeleteAfter_ADatabaseRestoredToAnEarlierCopy_ReadsEveryStream_OnlyWithTheDelayOnAsync, AzureBlobArchiveRegistrationTests.Configuration_DeleteAfter_IsOffByDefault_AndBindsATimeSpanAsync}

Storage without soft delete or versioning (another provider, a file share) cannot bring back an object once it is
deleted. For it, `DeleteAfter` delays every queued object deletion: an object a restore, a delete or a purge stopped
naming is deleted no sooner than that long after the deletion was queued. A database restored to any point within the
delay therefore still finds every object it names. Set it to **at least the database's point-in-time restore window**.

```json{
title: "Delay archive object deletions by 35 days"
description: "For storage that keeps nothing after a delete: every queued deletion waits 35 days, longer than the database's restore window."
tags: ["archive", "azure-blob", "delete-after", "configuration"]
tests: ["AzureBlobArchiveRegistrationTests.Configuration_DeleteAfter_IsOffByDefault_AndBindsATimeSpanAsync"]
}
{
  "Whizbang": {
    "Archive": {
      "AzureBlob": {
        "DeleteAfter": "35.00:00:00"
      }
    }
  }
}
```

| Choice | Reason | Verified |
|---|---|---|
| Off by default: a queued deletion runs at once, as before the option existed. | Azure Blob Storage with soft delete already keeps a deleted object for its retention period, which is the better place for that window; the delay is for storage that has none. | {verified: AzureBlobArchiveRegistrationTests.Configuration_DeleteAfter_IsOffByDefault_AndBindsATimeSpanAsync, AzureBlobArchiveStoreTests.DeleteAfter_ADatabaseRestoredToAnEarlierCopy_ReadsEveryStream_OnlyWithTheDelayOnAsync} |
| A deletion is due `DeleteAfter` after the database queued it (`queued_at`), and the store checks that when it drains the queue, not when it queues. | The queue is filled by a trigger inside the transaction that stopped naming the object, which knows nothing of a service's settings. Checking at the drain also means turning the delay on covers deletions already queued, and turning it off lets them all run at once. | {verified: AzureBlobArchiveStoreTests.DeleteAfter_ARestoreAndADelete_LeaveTheirObjects_UntilTheDelayHasPassedAsync} |
| A value of zero or less, or one that is not a time span, is refused when it is bound, when the host starts and when the store is built. | A zero delay would look like protection and give none. | {verified: AzureBlobArchiveRegistrationTests.Configuration_AValueThatCannotBeRead_IsRefused_NamingTheKeyAsync, AzureBlobArchiveRegistrationTests.Startup_ADeleteAfterOfZeroSetInCode_FailsTheHostAtStartAsync, AzureBlobArchiveRegistrationTests.Store_RefusesADeleteAfterThatIsNotAboveZeroAsync} |
| Ages are measured on the service's `TimeProvider`, against the time the database queued the deletion and the time storage created the object. | The delay is days long, so any skew between the service's, the database's and the storage's clocks is immaterial, and one injectable clock makes every age testable without waiting. | {verified: AzureBlobArchiveRegistrationTests.Registration_TheStoreMeasuresAgesOnTheRegisteredTimeProviderAsync} |

Data a [purge](../../fundamentals/events/archive-store#purging-a-stream-archived-to-blob) removed stays in storage
for the delay, just as it stays in the database's own backups for their retention. Crypto-shredding is the immediate
erasure: an object whose key is destroyed is unreadable wherever a copy of it remains.

### The orphan sweep {#the-orphan-sweep}

{verified: AzureBlobArchiveStoreTests.Sweep_DeletesOnlyObjectsNothingNames_OnceTheyAreOlderThanTheDelayAsync, AzureBlobArchiveStoreTests.Sweep_WithoutADelay_DoesNothing_AndNeverListsTheContainerAsync}

With a delay set, objects can be left that nothing will delete: those written after the point a database was restored
to (the restored database never queued their deletion), and an upload whose transaction never committed. Once a day,
the maintenance step sweeps the container and deletes every object that no manifest row and no queued deletion names
and that storage created at least `DeleteAfter` ago. Operators can also run a sweep with `SweepOrphanedObjectsAsync`.

| Choice | Reason | Verified |
|---|---|---|
| The sweep runs only with a delay set, and it is the only operation that lists the container. | Without a delay, deletions are immediate and driven by the queue alone, as before; every other operation finds objects through the manifest. | {verified: AzureBlobArchiveStoreTests.Sweep_WithoutADelay_DoesNothing_AndNeverListsTheContainerAsync} |
| Only objects at least `DeleteAfter` old are swept. | A write uploads its objects before its manifest rows commit, so a young unnamed object may be a write still in flight. The same age makes the sweep follow the delay: an object a restored database might still name is never swept within it. | {verified: AzureBlobArchiveStoreTests.Sweep_DeletesOnlyObjectsNothingNames_OnceTheyAreOlderThanTheDelayAsync} |
| Each object is deleted under its stream's lock, after checking again that nothing names it; a stream being written is left for the next sweep. | A write holds the stream's lock from before its upload until its manifest rows commit, so the sweep never deletes an object a write is about to name. | {verified: AzureBlobArchiveStoreTests.Sweep_AnObjectWhoseStreamIsBeingWritten_IsLeftForALaterSweepAsync} |
| A name is kept when any manifest row or queued deletion names it, in any location, and a name the store did not write is never touched. | The sweep removes only what is certainly this store's and certainly unnamed. | {verified: AzureBlobArchiveStoreTests.Sweep_DeletesOnlyObjectsNothingNames_OnceTheyAreOlderThanTheDelayAsync} |
| A database that has never written to the configured location sweeps nothing, whatever the [location mismatch handling](../../fundamentals/events/archive-store#location-mismatch). | Such a database (a copy not yet repointed) names nothing in the container, so a sweep would delete every object. Under `Warning`, `Info` or `Ignore` the copy's reads and writes go ahead, but it sweeps only once it has written to the configured location or the location is repointed. | {verified: AzureBlobArchiveStoreTests.Sweep_InADatabaseThatNeverWroteToTheLocation_DeletesNothingAsync} |
| A sweep runs only in a container whose owner marker names this database ([one database per container](#one-database-per-container)). | Two databases sharing a container would each delete the other's objects as orphans. | {verified: AzureBlobArchiveStoreTests.Sweep_ASecondDatabaseOnTheSameContainer_Refuses_AndBothEnvironmentsObjectsSurviveAsync} |
| The step sweeps at most once per day per process. | Listing a large container is the expensive part, and orphans only cost storage; a daily sweep bounds both. | {verified: AzureBlobArchiveStoreTests.Step_SweepsAtMostOncePerInterval_AndOnlyWithADelayAsync} |

### One database per container {#one-database-per-container}

{verified: AzureBlobArchiveStoreTests.Sweep_ASecondDatabaseOnTheSameContainer_Refuses_AndBothEnvironmentsObjectsSurviveAsync, AzureBlobArchiveStoreTests.Write_ClaimsTheContainer_WithAMarkerNamingTheDatabase_AndTheOwnerSweepsAsync}

The sweep deletes what the database does not name, so it is only safe in a container that holds one database's
archive. Two databases sharing a container would each see the other's objects as orphans. The store therefore claims
each container for one database, and **a sweep in a container another database claimed is refused**.

The first write to a container creates an owner marker object, `whizbang-archive-owner`, holding the database's
archive identity (`archive_database_id` in `wh_settings`, given to each database by migration 465). The marker is
created once, create-only like every archive object, and never updated. Before a sweep lists anything, it claims the
container the same way, or reads the marker that is there and compares it with its own database's id.

| Case | What happens | Verified |
|---|---|---|
| The marker names this database. | The sweep runs. | {verified: AzureBlobArchiveStoreTests.Write_ClaimsTheContainer_WithAMarkerNamingTheDatabase_AndTheOwnerSweepsAsync} |
| The marker names another database (`foreign_marker`). | The sweep is refused: it deletes nothing, logs a warning naming the reason and counts the refusal. A write into that container also logs a warning, because the owner's sweep cannot see this database's objects. | {verified: AzureBlobArchiveStoreTests.Sweep_ASecondDatabaseOnTheSameContainer_Refuses_AndBothEnvironmentsObjectsSurviveAsync, AzureBlobArchiveStoreTests.Sweep_AForeignMarkerPlacedFirst_Refuses_AndTheWriteStillSucceedsAsync} |
| There is no marker and none can be written, or the marker cannot be read (`marker_unclaimable`). | The sweep is refused the same way. | {verified: AzureBlobArchiveStoreTests.Sweep_AMarkerItCannotClaimOrRead_Refuses_AndTheWriteStillSucceedsAsync} |
| There is no marker (a container written before markers existed). | The sweep claims the container and runs. | {verified: AzureBlobArchiveStoreTests.Sweep_AContainerWithoutAMarker_IsClaimedByTheSweep_AndSweptAsync} |
| The database never wrote to the configured location (`unknown_location`). | The sweep is refused. | {verified: AzureBlobArchiveStoreTests.Sweep_InADatabaseThatNeverWroteToTheLocation_CountsTheRefusalAsync} |
| A database restored to its own container. | The restored database carries the same id, so the marker still names it and the sweep runs. | {verified: AzureBlobArchiveStoreTests.Sweep_ADatabaseRestoredToItsOwnContainer_StillMatchesItsMarkerAsync} |
| A copy [repointed](#restoring-into-another-environment) to a new container. | Its first write or sweep claims the new container. | {verified: AzureBlobArchiveStoreTests.Sweep_ARepointedCopy_ClaimsItsNewContainer_AndSweepsItAsync} |

Every refusal is counted by `whizbang.archive.orphan_sweep.refused` (meter `Whizbang.Archive.AzureBlob`), tagged
`reason`: `foreign_marker`, `marker_unclaimable` or `unknown_location`.

| Choice | Reason | Verified |
|---|---|---|
| Only the sweep depends on the marker. Writes, reads, restores, deletes and the deletion queue work whatever the marker says. | Nothing else lists the container or deletes what it does not name, so nothing else can harm another database's objects; gating writes on a marker would turn a storage permission or a misconfiguration into an outage. | {verified: AzureBlobArchiveStoreTests.Sweep_ASecondDatabaseOnTheSameContainer_Refuses_AndBothEnvironmentsObjectsSurviveAsync, AzureBlobArchiveStoreTests.Sweep_AMarkerItCannotClaimOrRead_Refuses_AndTheWriteStillSucceedsAsync} |
| The identity is a random id stored in the database, not a server or database name. | A restore by any method (point-in-time, a backup into a new server, a logical dump) carries the data, so the restored database matches its own container's marker. | {verified: AzureBlobArchiveStoreTests.Sweep_ADatabaseRestoredToItsOwnContainer_StillMatchesItsMarkerAsync} |
| The marker is never updated, and the store never deletes it. | A marker that could be rewritten would let a second database take over a container another still uses. An operator who moves a container to another database replaces the marker by hand. | {verified: AzureBlobArchiveStoreTests.Sweep_AForeignMarkerPlacedFirst_Refuses_AndTheWriteStillSucceedsAsync} |

A copy of a database carries its id, just as a restore does. A copy left pointing at its source's container (same
account, connection name and container) is therefore indistinguishable from a restore of the source, and its sweep runs
there. Repoint every copy to its own container before giving it a deletion delay.

## Related

- [Archive Store](../../fundamentals/events/archive-store): the Azure Blob store, its manifest, locations and repointing
- [Configuration reference](../configuration/configuration-reference): `Whizbang:Archive:AzureBlob`
