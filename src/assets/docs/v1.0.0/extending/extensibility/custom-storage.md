---
title: Custom Storage
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 10
description: >-
  Implement custom storage backends - Redis, MongoDB, Elasticsearch, Cassandra,
  or custom databases
tags: 'storage, iperspectivestore, custom-backends, redis, mongodb'
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveStoreTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveStoreDefaultsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCorePostgresPerspectiveStoreTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/DapperPostgresPerspectiveStoreTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Storage

**Custom storage backends** enable alternative data stores beyond PostgreSQL. Implement Redis, MongoDB, Elasticsearch, Cassandra, or custom databases for perspective read models.

:::note
Whizbang ships PostgreSQL-backed stores (EF Core and Dapper implementations). Custom storage is for specialized scenarios requiring different persistence strategies.
:::

---

## Why Custom Storage?

| Backend | Use Case | Benefits |
|---------|----------|----------|
| **PostgreSQL** (default) | Relational data | ACID, SQL queries |
| **Redis** | High-speed cache | In-memory, fast reads |
| **MongoDB** | Document store | Schema flexibility |
| **Elasticsearch** | Search/analytics | Full-text search |
| **Cassandra** | Time-series | Horizontal scaling |

**When to use custom storage**:
- ✅ Specialized query patterns
- ✅ Extreme performance needs
- ✅ Existing infrastructure
- ✅ Multi-region replication

---

## IPerspectiveStore&lt;TModel&gt;

The storage abstraction is keyed by **`Guid` stream IDs** for single-stream perspectives and generic **partition keys** for multi-stream (global) perspectives. The core members:

```csharp{title="IPerspectiveStore<TModel>" description="The perspective storage abstraction (core members)" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "IPerspectiveStore"]}
namespace Whizbang.Core.Perspectives;

public interface IPerspectiveStore<TModel> where TModel : class {
  // Single-stream perspectives (keyed by stream ID)
  Task<TModel?> GetByStreamIdAsync(Guid streamId, CancellationToken cancellationToken = default);
  Task UpsertAsync(Guid streamId, TModel model, CancellationToken cancellationToken = default);

  // [PhysicalField]/[VectorField] split-column support
  Task UpsertWithPhysicalFieldsAsync(
      Guid streamId, TModel model,
      IDictionary<string, object?> physicalFieldValues,
      PerspectiveScope? scope = null,
      CancellationToken cancellationToken = default);

  // Multi-stream (global) perspectives (keyed by partition key)
  Task<TModel?> GetByPartitionKeyAsync<TPartitionKey>(TPartitionKey partitionKey, CancellationToken cancellationToken = default)
    where TPartitionKey : notnull;
  Task UpsertByPartitionKeyAsync<TPartitionKey>(TPartitionKey partitionKey, TModel model, CancellationToken cancellationToken = default)
    where TPartitionKey : notnull;

  // Commit pending changes (SaveChangesAsync for EF Core; no-op if auto-committed)
  Task FlushAsync(CancellationToken cancellationToken = default);

  // Hard deletes (ModelAction.Purge) - idempotent
  Task PurgeAsync(Guid streamId, CancellationToken cancellationToken = default);
  Task PurgeByPartitionKeyAsync<TPartitionKey>(TPartitionKey partitionKey, CancellationToken cancellationToken = default)
    where TPartitionKey : notnull;

  // Plus default-implemented overloads: scope-aware upserts (PerspectiveScope,
  // forceUpdateScope), metadata-persisting upserts (PerspectiveMetadata - used by
  // generated runners for crash-safe idempotency), and GetMetadataByStreamIdAsync.
}
```

Key behavioral contracts (locked by the built-in stores' tests):

- **Upsert semantics**: create the row when missing, update when present, increment a version for optimistic concurrency
- **Purge is idempotent**: purging a non-existent model does not throw
- **`FlushAsync`** guarantees data is queryable before `PostPerspectiveInline` receptors fire
- **Metadata overloads** record the last-applied `EventId` per row so re-runs after a crash skip already-applied events

---

## MongoDB Implementation

### Pattern 1: MongoDB Perspective Store

```csharp{title="Pattern 1: MongoDB Perspective Store" description="Pattern 1: MongoDB Perspective Store" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "MongoDB"]}
using MongoDB.Driver;
using Whizbang.Core.Perspectives;

public class MongoPerspectiveStore<TModel> : IPerspectiveStore<TModel>
  where TModel : class {

  private readonly IMongoCollection<TModel> _collection;

  public MongoPerspectiveStore(IMongoDatabase database, string collectionName) {
    _collection = database.GetCollection<TModel>(collectionName);
  }

  public async Task<TModel?> GetByStreamIdAsync(Guid streamId, CancellationToken cancellationToken = default) {
    var filter = Builders<TModel>.Filter.Eq("_id", streamId);
    return await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
  }

  public async Task UpsertAsync(Guid streamId, TModel model, CancellationToken cancellationToken = default) {
    var filter = Builders<TModel>.Filter.Eq("_id", streamId);
    await _collection.ReplaceOneAsync(
      filter,
      model,
      new ReplaceOptions { IsUpsert = true },
      cancellationToken
    );
  }

  public Task UpsertWithPhysicalFieldsAsync(
      Guid streamId, TModel model,
      IDictionary<string, object?> physicalFieldValues,
      PerspectiveScope? scope = null,
      CancellationToken cancellationToken = default) =>
    UpsertAsync(streamId, model, cancellationToken);  // documents have no split columns

  public async Task<TModel?> GetByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull {
    var filter = Builders<TModel>.Filter.Eq("_id", partitionKey.ToString());
    return await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
  }

  public async Task UpsertByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, TModel model, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull {
    var filter = Builders<TModel>.Filter.Eq("_id", partitionKey.ToString());
    await _collection.ReplaceOneAsync(
      filter, model, new ReplaceOptions { IsUpsert = true }, cancellationToken);
  }

  public Task FlushAsync(CancellationToken cancellationToken = default) =>
    Task.CompletedTask;  // MongoDB writes are committed per operation

  public async Task PurgeAsync(Guid streamId, CancellationToken cancellationToken = default) {
    var filter = Builders<TModel>.Filter.Eq("_id", streamId);
    await _collection.DeleteOneAsync(filter, cancellationToken);  // idempotent
  }

  public async Task PurgeByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull {
    var filter = Builders<TModel>.Filter.Eq("_id", partitionKey.ToString());
    await _collection.DeleteOneAsync(filter, cancellationToken);
  }
}
```

---

## Elasticsearch Implementation

### Pattern 2: Elasticsearch Perspective Store (Excerpt)

The same member set applies; here are the stream-keyed members with the Elasticsearch client:

```csharp{title="Pattern 2: Elasticsearch Perspective Store" description="Pattern 2: Elasticsearch Perspective Store" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Elasticsearch"]}
using Elastic.Clients.Elasticsearch;
using Whizbang.Core.Perspectives;

public class ElasticsearchPerspectiveStore<TModel> : IPerspectiveStore<TModel>
  where TModel : class {

  private readonly ElasticsearchClient _client;
  private readonly string _indexName;

  public ElasticsearchPerspectiveStore(ElasticsearchClient client, string indexName) {
    _client = client;
    _indexName = indexName;
  }

  public async Task<TModel?> GetByStreamIdAsync(Guid streamId, CancellationToken cancellationToken = default) {
    var response = await _client.GetAsync<TModel>(
      streamId.ToString(), idx => idx.Index(_indexName), cancellationToken);
    return response.Found ? response.Source : null;
  }

  public async Task UpsertAsync(Guid streamId, TModel model, CancellationToken cancellationToken = default) {
    await _client.IndexAsync(
      model,
      idx => idx.Index(_indexName).Id(streamId.ToString()),
      cancellationToken
    );
  }

  public async Task PurgeAsync(Guid streamId, CancellationToken cancellationToken = default) {
    await _client.DeleteAsync<TModel>(
      streamId.ToString(), idx => idx.Index(_indexName), cancellationToken);
  }

  // ... implement the partition-key members, UpsertWithPhysicalFieldsAsync,
  // FlushAsync, and PurgeByPartitionKeyAsync following the MongoDB pattern.
}
```

---

## Registration

```csharp{title="Custom Store Registration" description="Register the custom store for all models" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Registration", "DI"]}
// Open-generic registration covers every perspective model type
builder.Services.AddSingleton(typeof(IPerspectiveStore<>), typeof(MongoPerspectiveStore<>));
```

---

## Further Reading

**Data Access**:
- [Perspectives Storage](../../data/perspectives-storage.md) - PostgreSQL schema

**Extensibility**:
- [Custom Perspectives](custom-perspectives.md) - Advanced perspective patterns

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
