# Raw SQL and Connection Access

For advanced scenarios where LINQ extensions are insufficient, Whizbang provides escape hatches for raw SQL execution and direct database connection access.

## When to Use Raw SQL

- Complex queries not expressible in LINQ
- Stored procedure execution
- Database-specific features (PostgreSQL-specific functions, etc.)
- Bulk operations via native drivers (e.g., Npgsql binary import)
- Materialized view refresh

**Prefer LINQ when possible.** Raw SQL bypasses EF Core's change tracking and may be harder to maintain.

## ExecuteSqlAsync

Execute parameterized SQL queries with typed results:

```csharp{title="ExecuteSqlAsync" description="Execute parameterized SQL queries with typed results:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "ExecuteSqlAsync"]}
var category = "electronics";
var limit = 10;

var products = await lensQuery.ExecuteSqlAsync<Product, ProductSummary>(
    $"SELECT id, name, price FROM products WHERE category = {category} LIMIT {limit}");
```

### SQL Injection Protection

The `FormattableString` parameter ensures parameters are properly escaped:

```csharp{title="SQL Injection Protection" description="The FormattableString parameter ensures parameters are properly escaped:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "SQL", "Injection"]}
// SAFE: Parameters are extracted and passed separately
var results = await lensQuery.ExecuteSqlAsync<Order, OrderSummary>(
    $"SELECT id, total FROM orders WHERE status = {status}");

// The {status} becomes a SQL parameter (@p0), NOT string concatenation
// Generated SQL: SELECT id, total FROM orders WHERE status = @p0
```

## Direct Connection Access

### GetConnection (Synchronous)

Get the underlying connection without opening:

```csharp{title="GetConnection (Synchronous)" description="Get the underlying connection without opening:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "GetConnection", "Synchronous"]}
var connection = lensQuery.GetConnection<Order>();

// Use for synchronous operations
using var command = connection.CreateCommand();
command.CommandText = "SELECT version()";
var version = command.ExecuteScalar();
```

### GetConnectionAsync (Asynchronous)

Get the connection and ensure it's open:

```csharp{title="GetConnectionAsync (Asynchronous)" description="Get the connection and ensure it's open:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "GetConnectionAsync", "Asynchronous"]}
await using var connection = await lensQuery.GetConnectionAsync<Order>();

await using var command = connection.CreateCommand();
command.CommandText = "CALL refresh_materialized_view('product_stats')";
await command.ExecuteNonQueryAsync();
```

## Use Cases

### Stored Procedures

```csharp{title="Stored Procedures" description="Demonstrates stored Procedures" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Stored", "Procedures"]}
await using var connection = await lensQuery.GetConnectionAsync<Product>();
await using var command = connection.CreateCommand();
command.CommandText = "CALL update_inventory(@product_id, @quantity)";
command.Parameters.Add(new NpgsqlParameter("product_id", productId));
command.Parameters.Add(new NpgsqlParameter("quantity", quantity));
await command.ExecuteNonQueryAsync();
```

### Bulk Import (Npgsql Binary COPY)

```csharp{title="Bulk Import (Npgsql Binary COPY)" description="Demonstrates bulk Import (Npgsql Binary COPY)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Bulk", "Import"]}
await using var connection = await lensQuery.GetConnectionAsync<Product>();

await using var writer = await ((NpgsqlConnection)connection)
    .BeginBinaryImportAsync("COPY products (id, name, price) FROM STDIN (FORMAT BINARY)");

foreach (var product in products) {
  await writer.StartRowAsync();
  await writer.WriteAsync(product.Id, NpgsqlDbType.Uuid);
  await writer.WriteAsync(product.Name, NpgsqlDbType.Text);
  await writer.WriteAsync(product.Price, NpgsqlDbType.Numeric);
}

await writer.CompleteAsync();
```

### Materialized View Refresh

```csharp{title="Materialized View Refresh" description="Demonstrates materialized View Refresh" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Materialized", "View"]}
await using var connection = await lensQuery.GetConnectionAsync<Analytics>();
await using var command = connection.CreateCommand();
command.CommandText = "REFRESH MATERIALIZED VIEW CONCURRENTLY sales_summary";
await command.ExecuteNonQueryAsync();
```

### Database-Specific Functions

```csharp{title="Database-Specific Functions" description="Demonstrates database-Specific Functions" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Database-Specific", "Functions"]}
// PostgreSQL full-text search
var searchResults = await lensQuery.ExecuteSqlAsync<Document, SearchResult>(
    $@"SELECT id, title, ts_rank(search_vector, query) AS rank
       FROM documents, plainto_tsquery('english', {searchTerm}) query
       WHERE search_vector @@ query
       ORDER BY rank DESC
       LIMIT 20");
```

## Important Notes

1. **Connection Lifecycle**: The returned connection is managed by EF Core. Do NOT dispose it manually when using `GetConnection`.

2. **Transaction Scope**: Operations on the returned connection participate in the current EF Core transaction (if any).

3. **AOT Compatibility**: These methods are AOT-compatible when using Npgsql's source-generated JSON serialization.

4. **Type Safety**: `ExecuteSqlAsync<TModel, TResult>` requires `TResult` to be a class with properties matching the SQL projection.

## See Also

- [Lens Queries](/docs/lenses/overview)
- [PostgreSQL Extensions](/docs/data/postgres)
