---
title: "Custom Storage"
version: 0.1.0
category: Extensibility
order: 10
description: "Implement custom storage backends - Redis, MongoDB, Elasticsearch, Cassandra, or custom databases"
tags: storage, iperspectivestore, custom-backends, redis, mongodb
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
---

# Custom Storage

**Custom storage backends** enable alternative data stores beyond PostgreSQL. Implement Redis, MongoDB, Elasticsearch, Cassandra, or custom databases for perspective read models.

:::note
Whizbang uses PostgreSQL by default. Custom storage is for specialized scenarios requiring different persistence strategies.
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

## IPerspectiveStore<TModel>

```csharp
public interface IPerspectiveStore<TModel> where TModel : class {
  Task UpsertAsync(
    string id,
    TModel model,
    CancellationToken ct = default
  );
}
```

---

## MongoDB Implementation

### Pattern 1: MongoDB Perspective Store

```csharp
using MongoDB.Driver;

public class MongoPerspectiveStore<TModel> : IPerspectiveStore<TModel>
  where TModel : class {

  private readonly IMongoCollection<TModel> _collection;

  public MongoPerspectiveStore(IMongoDatabase database, string collectionName) {
    _collection = database.GetCollection<TModel>(collectionName);
  }

  public async Task UpsertAsync(
    string id,
    TModel model,
    CancellationToken ct = default
  ) {
    var filter = Builders<TModel>.Filter.Eq("_id", id);
    await _collection.ReplaceOneAsync(
      filter,
      model,
      new ReplaceOptions { IsUpsert = true },
      ct
    );
  }
}
```

---

## Elasticsearch Implementation

### Pattern 2: Elasticsearch Perspective Store

```csharp
using Elastic.Clients.Elasticsearch;

public class ElasticsearchPerspectiveStore<TModel> : IPerspectiveStore<TModel>
  where TModel : class {

  private readonly ElasticsearchClient _client;
  private readonly string _indexName;

  public ElasticsearchPerspectiveStore(
    ElasticsearchClient client,
    string indexName
  ) {
    _client = client;
    _indexName = indexName;
  }

  public async Task UpsertAsync(
    string id,
    TModel model,
    CancellationToken ct = default
  ) {
    await _client.IndexAsync(
      model,
      idx => idx.Index(_indexName).Id(id),
      ct
    );
  }
}
```

---

## Further Reading

**Data Access**:
- [Perspectives Storage](../data-access/perspectives-storage.md) - PostgreSQL schema

**Extensibility**:
- [Custom Perspectives](custom-perspectives.md) - Advanced perspective patterns

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
