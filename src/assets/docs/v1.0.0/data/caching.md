---
title: Caching
version: 1.0.0
category: Components
order: 8
description: >-
  Distributed caching with cache invalidation commands and automatic
  coordination
tags: 'caching, distributed-cache, cache-invalidation, redis'
codeReferences:
  - src/Whizbang.Core/Commands/ClearCacheCommand.cs
  - src/Whizbang.Core/Caching/ICacheService.cs
lastMaintainedCommit: '01f07906'
---

# Caching

Whizbang provides distributed caching capabilities with automatic invalidation support through command-based cache clearing.

## Overview

Caching in Whizbang follows these principles:

- **Distributed First**: Built for multi-instance deployments
- **Command-Based Invalidation**: Cache clearing via messages
- **Coordinated**: Cache clears propagate across all instances
- **Type-Safe**: Generic cache keys and values

## Clear Cache Command {#clear-cache}

The `ClearCacheCommand` enables coordinated cache invalidation across distributed instances.

### Usage

```csharp{title="Usage" description="Usage" category="Implementation" difficulty="BEGINNER" tags=["Data", "Usage"]}
using Whizbang.Core.Commands;

// Clear specific cache keys
var command = new ClearCacheCommand {
  Keys = new[] { "product:123", "product:456" }
};

await dispatcher.PublishAsync(command);
// All instances receive command and clear their caches
```

### Command Structure

```csharp{title="Command Structure" description="Command Structure" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Command", "Structure"]}
namespace Whizbang.Core.Commands;

/// <summary>
/// Command to clear cache entries across all service instances.
/// </summary>
/// <remarks>
/// When published via the dispatcher, this command is routed to all
/// service instances (broadcast pattern), ensuring cache consistency
/// across distributed deployments.
/// </remarks>
public record ClearCacheCommand : ICommand {
  /// <summary>
  /// The cache keys to clear. If null or empty, clears all cache entries.
  /// </summary>
  public IReadOnlyList<string>? Keys { get; init; }

  /// <summary>
  /// Optional pattern for cache key matching (e.g., "product:*" for all product keys).
  /// </summary>
  public string? Pattern { get; init; }

  /// <summary>
  /// Optional cache region/namespace to target specific cache partitions.
  /// </summary>
  public string? Region { get; init; }
}
```

### Patterns

#### Clear Specific Keys

```csharp{title="Clear Specific Keys" description="Clear Specific Keys" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Clear", "Specific", "Keys"]}
// Clear exact keys
await dispatcher.PublishAsync(new ClearCacheCommand {
  Keys = new[] { "user:123", "user:456" }
});
```

#### Clear by Pattern

```csharp{title="Clear by Pattern" description="Clear by Pattern" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Clear", "Pattern"]}
// Clear all keys matching pattern
await dispatcher.PublishAsync(new ClearCacheCommand {
  Pattern = "product:*"
});
```

#### Clear by Region

```csharp{title="Clear by Region" description="Clear by Region" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Clear", "Region"]}
// Clear all keys in a region
await dispatcher.PublishAsync(new ClearCacheCommand {
  Region = "ProductCatalog"
});
```

#### Clear All

```csharp{title="Clear All" description="Clear All" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Clear", "All"]}
// Clear entire cache
await dispatcher.PublishAsync(new ClearCacheCommand());
```

## Implementing a Cache Receptor

Handle cache clearing in your service:

```csharp{title="Implementing a Cache Receptor" description="Handle cache clearing in your service:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Implementing", "Cache", "Receptor"]}
using Whizbang.Core;
using Whizbang.Core.Commands;

public class CacheClearReceptor : IReceptor<ClearCacheCommand, CacheCleared> {
  private readonly ICacheService _cache;
  private readonly ILogger<CacheClearReceptor> _logger;

  public CacheClearReceptor(ICacheService cache, ILogger<CacheClearReceptor> logger) {
    _cache = cache;
    _logger = logger;
  }

  public async ValueTask<CacheCleared> HandleAsync(
      ClearCacheCommand message,
      CancellationToken ct = default) {

    var clearedKeys = 0;

    if (message.Keys?.Count > 0) {
      // Clear specific keys
      foreach (var key in message.Keys) {
        await _cache.RemoveAsync(key, ct);
        clearedKeys++;
      }
    } else if (!string.IsNullOrEmpty(message.Pattern)) {
      // Clear by pattern
      clearedKeys = await _cache.RemoveByPatternAsync(message.Pattern, ct);
    } else if (!string.IsNullOrEmpty(message.Region)) {
      // Clear region
      clearedKeys = await _cache.ClearRegionAsync(message.Region, ct);
    } else {
      // Clear all
      await _cache.ClearAsync(ct);
      clearedKeys = -1; // Unknown count
    }

    _logger.LogInformation(
      "Cache cleared: {KeyCount} keys removed",
      clearedKeys == -1 ? "all" : clearedKeys
    );

    return new CacheCleared {
      KeysCleared = clearedKeys,
      ClearedAt = DateTimeOffset.UtcNow
    };
  }
}

public record CacheCleared : IEvent {
  [StreamKey]
  public Guid EventId { get; init; } = Guid.CreateVersion7();
  public int KeysCleared { get; init; }
  public DateTimeOffset ClearedAt { get; init; }
}
```

## ICacheService Interface

Standard interface for cache implementations:

```csharp{title="ICacheService Interface" description="Standard interface for cache implementations:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "ICacheService", "Interface"]}
namespace Whizbang.Core.Caching;

public interface ICacheService {
  // Get/Set
  Task<T?> GetAsync<T>(string key, CancellationToken ct = default);
  Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken ct = default);

  // Remove
  Task RemoveAsync(string key, CancellationToken ct = default);
  Task<int> RemoveByPatternAsync(string pattern, CancellationToken ct = default);

  // Clear
  Task ClearAsync(CancellationToken ct = default);
  Task<int> ClearRegionAsync(string region, CancellationToken ct = default);

  // Exists
  Task<bool> ExistsAsync(string key, CancellationToken ct = default);
}
```

## Distributed Cache Example

Using Redis as distributed cache:

```csharp{title="Distributed Cache Example" description="Using Redis as distributed cache:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Distributed", "Cache"]}
using StackExchange.Redis;
using Whizbang.Core.Caching;

public class RedisCacheService : ICacheService {
  private readonly IConnectionMultiplexer _redis;
  private readonly ILogger<RedisCacheService> _logger;

  public RedisCacheService(IConnectionMultiplexer redis, ILogger<RedisCacheService> logger) {
    _redis = redis;
    _logger = logger;
  }

  public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default) {
    var db = _redis.GetDatabase();
    var value = await db.StringGetAsync(key);

    if (!value.HasValue) {
      return default;
    }

    return JsonSerializer.Deserialize<T>(value!);
  }

  public async Task SetAsync<T>(
      string key,
      T value,
      TimeSpan? expiration = null,
      CancellationToken ct = default) {

    var db = _redis.GetDatabase();
    var serialized = JsonSerializer.Serialize(value);

    await db.StringSetAsync(key, serialized, expiration);
  }

  public async Task RemoveAsync(string key, CancellationToken ct = default) {
    var db = _redis.GetDatabase();
    await db.KeyDeleteAsync(key);
  }

  public async Task<int> RemoveByPatternAsync(string pattern, CancellationToken ct = default) {
    var server = _redis.GetServer(_redis.GetEndPoints().First());
    var keys = server.Keys(pattern: pattern).ToArray();

    var db = _redis.GetDatabase();
    await db.KeyDeleteAsync(keys);

    return keys.Length;
  }

  public async Task ClearAsync(CancellationToken ct = default) {
    var endpoints = _redis.GetEndPoints();
    foreach (var endpoint in endpoints) {
      var server = _redis.GetServer(endpoint);
      await server.FlushDatabaseAsync();
    }
  }

  public async Task<int> ClearRegionAsync(string region, CancellationToken ct = default) {
    return await RemoveByPatternAsync($"{region}:*", ct);
  }

  public async Task<bool> ExistsAsync(string key, CancellationToken ct = default) {
    var db = _redis.GetDatabase();
    return await db.KeyExistsAsync(key);
  }
}
```

## Registration

```csharp{title="Registration" description="Registration" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Registration"]}
// Program.cs
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Register Redis
var redisConnection = await ConnectionMultiplexer.ConnectAsync(
  builder.Configuration.GetConnectionString("Redis")!
);
builder.Services.AddSingleton<IConnectionMultiplexer>(redisConnection);

// Register cache service
builder.Services.AddSingleton<ICacheService, RedisCacheService>();

// Register cache receptor
builder.Services.AddTransient<IReceptor<ClearCacheCommand, CacheCleared>, CacheClearReceptor>();

var app = builder.Build();
```

## Cache Patterns

### Write-Through Cache

Update cache when data changes:

```csharp{title="Write-Through Cache" description="Update cache when data changes:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Write-Through", "Cache"]}
public class UpdateProductReceptor : IReceptor<UpdateProduct, (ProductUpdated, ClearCacheCommand)> {
  private readonly IProductRepository _repository;

  public async ValueTask<(ProductUpdated, ClearCacheCommand)> HandleAsync(
      UpdateProduct message,
      CancellationToken ct = default) {

    // Update database
    await _repository.UpdateAsync(message.ProductId, message.Name, message.Price, ct);

    // Return event + cache clear command (auto-cascade)
    return (
      new ProductUpdated {
        ProductId = message.ProductId,
        Name = message.Name,
        Price = message.Price
      },
      new ClearCacheCommand {
        Keys = new[] { $"product:{message.ProductId}" }
      }
    );
  }
}
```

### Cache-Aside Pattern

```csharp{title="Cache-Aside Pattern" description="Cache-Aside Pattern" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Cache-Aside", "Pattern"]}
public class GetProductReceptor : IReceptor<GetProduct, ProductDto> {
  private readonly ICacheService _cache;
  private readonly IProductLens _lens;

  public async ValueTask<ProductDto> HandleAsync(
      GetProduct query,
      CancellationToken ct = default) {

    var cacheKey = $"product:{query.ProductId}";

    // Try cache first
    var cached = await _cache.GetAsync<ProductDto>(cacheKey, ct);
    if (cached != null) {
      return cached;
    }

    // Cache miss - query database
    var product = await _lens.GetProductAsync(query.ProductId, ct);

    // Store in cache
    await _cache.SetAsync(cacheKey, product, TimeSpan.FromMinutes(15), ct);

    return product;
  }
}
```

## Best Practices

### DO

- **Use distributed cache** for multi-instance deployments
- **Set expiration times** to prevent stale data
- **Clear cache proactively** when data changes
- **Use cache keys consistently** (e.g., `{entity}:{id}` pattern)
- **Handle cache misses gracefully** with fallback to database

### DON'T

- **Don't cache forever** without expiration
- **Don't ignore cache clear failures** (log and alert)
- **Don't cache sensitive data** without encryption
- **Don't over-cache** (cache only frequently accessed data)
- **Don't rely on cache alone** (always have database fallback)

## See Also

- Commands - Command fundamentals
- [Dispatcher](../fundamentals/dispatcher/dispatcher.md) - Message routing
- [Receptors](../fundamentals/receptors/receptors.md) - Command handlers
- [Auto-Cascade](../fundamentals/dispatcher/dispatcher.md#automatic-event-cascade) - Tuple return pattern

---

*Version 1.0.0 - Foundation Release*
