# Vector Similarity Search

Whizbang supports pgvector similarity queries for semantic search, embeddings, and AI/ML workloads.

## Turnkey Setup {#turnkey-setup}

Whizbang provides a **turnkey experience** for pgvector. When your perspective models use `[VectorField]` attributes, the source generator automatically creates an `Add{YourDbContext}()` extension method that handles all pgvector configuration:

```csharp
// Single call configures everything:
// - NpgsqlDataSource with UseVector()
// - DbContext with UseVector()
// - HasPostgresExtension("vector") in OnModelCreating
builder.Services.AddMyAppDbContext(connectionString);
```

### What Gets Configured Automatically

When Whizbang detects `[VectorField]` attributes in your perspective models, the generated code:

1. **Creates the pgvector extension** - Generates `modelBuilder.HasPostgresExtension("vector")` in `ConfigureWhizbang()`
2. **Configures NpgsqlDataSource** - Calls `dataSourceBuilder.UseVector()` for Npgsql type mapping
3. **Configures EF Core** - Calls `npgsqlOptions.UseVector()` for EF Core query translation
4. **Maps vector columns** - Generates proper `HasColumnType("vector({dimensions})")` configuration

### Customization

If you need to configure the data source (e.g., for JSON options), pass a callback:

```csharp
builder.Services.AddMyAppDbContext(connectionString, dataSourceBuilder => {
  dataSourceBuilder.ConfigureJsonOptions(jsonOptions);
  dataSourceBuilder.EnableDynamicJson();
});
```

Or configure DbContext options:

```csharp
builder.Services.AddMyAppDbContext(connectionString, configureDbContext: options => {
  options.EnableSensitiveDataLogging();
});
```

## Prerequisites

When using `[VectorField]` attributes on your perspective models, you must add both pgvector packages:

```xml
<ItemGroup>
  <!-- Base package for NpgsqlDataSourceBuilder.UseVector() -->
  <PackageReference Include="Pgvector" Version="0.3.0" />

  <!-- EF Core integration for type mapping and queries -->
  <PackageReference Include="Pgvector.EntityFrameworkCore" Version="0.3.0" />
</ItemGroup>
```

If you forget these packages, compiler diagnostics will guide you:

- **[WHIZ070](/docs/v0.1.0/diagnostics/whiz070)** - Missing `Pgvector.EntityFrameworkCore` package
- **[WHIZ071](/docs/v0.1.0/diagnostics/whiz071)** - Missing `Pgvector` package

## Defining Vector Fields

Add `[VectorField]` to properties in your perspective model:

```csharp
public class DocumentModel {
  public Guid Id { get; init; }
  public string Title { get; init; } = "";
  public string Content { get; init; } = "";

  [VectorField(1536)]  // OpenAI ada-002 dimensions
  public float[]? ContentEmbedding { get; init; }

  [VectorField(1536)]  // For comparison operations
  public float[]? SummaryEmbedding { get; init; }
}

public class UserPreferenceModel {
  public Guid UserId { get; init; }

  [VectorField(1536)]
  public float[]? PreferenceEmbedding { get; init; }
}
```

The generator creates pgvector shadow properties with appropriate indexes.

## Usage Patterns

All methods use **strongly-typed lambda selectors** for compile-time safety.

### Pattern 1: App-Side Vector (Search Query)

Use when the search vector comes from your application (e.g., embedding a user's search query):

```csharp
// Get embedding from your embedding service (OpenAI, etc.)
var searchEmbedding = await embeddingService.EmbedAsync(userSearchQuery);

// Find documents similar to the search query
var results = await documentLens.Query
    .OrderByCosineDistance(m => m.ContentEmbedding, searchEmbedding)
    .Take(10)
    .ToListAsync();
```

**SQL Generated:**
```sql
SELECT * FROM documents
ORDER BY content_embedding <=> @p0 ASC
LIMIT 10
```

### Pattern 2: Same-Table Column Comparison

Use when comparing two vector columns on the same row (100% SQL, no vector data round-trip):

```csharp
// Find documents where content differs significantly from summary
// (potential quality issue - summary doesn't match content)
var mismatchedDocs = await documentLens.Query
    .Where(m => m.ContentEmbedding != null && m.SummaryEmbedding != null)
    .OrderByCosineDistance(m => m.ContentEmbedding, m => m.SummaryEmbedding)
    .ThenByDescending(m => m.Data.CreatedAt)  // Most different first, then newest
    .Take(20)
    .ToListAsync();

// Find documents where content and summary are similar (well-summarized)
var wellSummarized = await documentLens.Query
    .WithinCosineDistance(m => m.ContentEmbedding, m => m.SummaryEmbedding, threshold: 0.2)
    .ToListAsync();
```

**SQL Generated:**
```sql
-- No vector data sent to/from C# - all computed in PostgreSQL!
SELECT * FROM documents
WHERE content_embedding IS NOT NULL AND summary_embedding IS NOT NULL
ORDER BY content_embedding <=> summary_embedding ASC
LIMIT 20
```

### Pattern 3: Cross-Table Comparison (Joins)

Use when comparing vectors from different tables:

```csharp
// Find documents that match a user's preferences
var userId = currentUserId;

var recommendations = await documentLens.Query
    .SelectMany(
        doc => userPreferenceLens.Query.Where(up => up.Data.UserId == userId),
        (doc, pref) => new { Document = doc, Preference = pref })
    .OrderByCosineDistance(
        x => x.Document.Data.ContentEmbedding,    // From documents table
        x => x.Preference.Data.PreferenceEmbedding)  // From user_preferences table
    .Select(x => x.Document)
    .Take(10)
    .ToListAsync();
```

**SQL Generated:**
```sql
SELECT d.* FROM documents d
JOIN user_preferences up ON up.user_id = @userId
ORDER BY d.content_embedding <=> up.preference_embedding ASC
LIMIT 10
```

### Pattern 4: Filtering by Distance Threshold

Use when you only want results within a certain similarity range:

```csharp
var searchEmbedding = await embeddingService.EmbedAsync(userQuery);

// Only return documents with cosine distance < 0.3 (very similar)
var closeMatches = await documentLens.Query
    .WithinCosineDistance(m => m.ContentEmbedding, searchEmbedding, threshold: 0.3)
    .OrderByCosineDistance(m => m.ContentEmbedding, searchEmbedding)
    .ToListAsync();
```

**SQL Generated:**
```sql
SELECT * FROM documents
WHERE content_embedding <=> @p0 < 0.3
ORDER BY content_embedding <=> @p0 ASC
```

### Pattern 5: Combined Filter + Sort + Project

Use when you need distance/similarity scores in your results:

:::updated
**Important**: `WithCosineDistance` must be used as the **final projection** before `ToListAsync()`.
You cannot chain `.OrderBy(r => r.Distance)` or `.Where(r => r.Distance < x)` after it - use
`OrderByCosineDistance` and `WithinCosineDistance` for SQL-side operations first.
:::

```csharp
var searchEmbedding = await embeddingService.EmbedAsync(userQuery);

// Filter -> Sort -> Project with scores
var results = await documentLens.Query
    .WithinCosineDistance(m => m.ContentEmbedding, searchEmbedding, threshold: 0.5)
    .OrderByCosineDistance(m => m.ContentEmbedding, searchEmbedding)
    .WithCosineDistance(m => m.ContentEmbedding, searchEmbedding)
    .Take(10)
    .ToListAsync();

foreach (var result in results) {
  Console.WriteLine($"{result.Row.Data.Title}: {result.Similarity:P0} match");
  // Output: "My Document: 95% match"
}
```

Returns `VectorSearchResult<TModel>` with:
- `Row` - The perspective row
- `Distance` - Cosine distance (0 = identical, 2 = opposite)
- `Similarity` - Similarity score (1 = identical, -1 = opposite)

## Query Extension Reference

### Ordering Methods

| Method | PostgreSQL Operator | Use Case |
|--------|---------------------|----------|
| `OrderByCosineDistance` | `<=>` | Semantic similarity (normalized vectors) |
| `OrderByL2Distance` | `<->` | Euclidean distance (spatial data) |
| `OrderByInnerProductDistance` | `<#>` | Dot product (normalized vectors) |

### Filtering Methods

| Method | PostgreSQL | Use Case |
|--------|------------|----------|
| `WithinCosineDistance` | `<=> < threshold` | Filter by cosine similarity |
| `WithinL2Distance` | `<-> < threshold` | Filter by Euclidean distance |

### Projection Methods

| Method | Returns | Use Case |
|--------|---------|----------|
| `WithCosineDistance` | `VectorSearchResult<T>` | Get distance/similarity scores |

## Distance Calculators

For testing or manual calculations, use the static helper methods:

```csharp
double cosine = VectorSearchExtensions.CalculateCosineDistance(vectorA, vectorB);
double l2 = VectorSearchExtensions.CalculateL2Distance(vectorA, vectorB);
double innerProduct = VectorSearchExtensions.CalculateInnerProductDistance(vectorA, vectorB);
```

## Complete Example: Semantic Search with Ranking

```csharp
public class SearchService {
  private readonly ILensQueryFactory<DocumentModel> _documentLens;
  private readonly IEmbeddingService _embeddingService;

  public async Task<List<SearchResult>> SearchAsync(string query, int limit = 10) {
    // 1. Embed the user's search query
    var queryEmbedding = await _embeddingService.EmbedAsync(query);

    // 2. Find similar documents with scores
    var results = await _documentLens.Query
        .WithinCosineDistance(m => m.ContentEmbedding, queryEmbedding, threshold: 0.5)
        .OrderByCosineDistance(m => m.ContentEmbedding, queryEmbedding)
        .WithCosineDistance(m => m.ContentEmbedding, queryEmbedding)
        .Take(limit)
        .ToListAsync();

    // 3. Map to search results
    return results.Select(r => new SearchResult {
      Id = r.Row.Data.Id,
      Title = r.Row.Data.Title,
      Snippet = r.Row.Data.Content[..200],
      RelevanceScore = r.Similarity
    }).ToList();
  }
}
```

## Manual Configuration {#manual-configuration}

If you prefer manual configuration over the turnkey approach, you can set up pgvector yourself:

```csharp
// 1. Create data source with UseVector()
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
dataSourceBuilder.UseVector();
var dataSource = dataSourceBuilder.Build();
builder.Services.AddSingleton(dataSource);

// 2. Add DbContext with UseVector()
builder.Services.AddDbContext<MyAppDbContext>(options => {
  options.UseNpgsql(dataSource, npgsqlOptions => {
    npgsqlOptions.UseVector();
  });
});

// 3. Configure Whizbang normally
builder.Services
  .AddWhizbang()
  .WithEFCore<MyAppDbContext>()
  .WithDriver.Postgres;
```

Note: The generated `ConfigureWhizbang()` method automatically includes `HasPostgresExtension("vector")` when `[VectorField]` attributes are detected, so you don't need to add that manually.

## See Also

- [Perspective Models](/docs/perspectives/overview)
- [VectorFieldAttribute Reference](/api/VectorFieldAttribute)
- [WHIZ070: Missing Pgvector.EntityFrameworkCore](/docs/v0.1.0/diagnostics/whiz070)
- [WHIZ071: Missing Pgvector Package](/docs/v0.1.0/diagnostics/whiz071)
