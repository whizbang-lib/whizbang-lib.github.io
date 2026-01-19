Search Whizbang documentation using MCP server.

Use the MCP tools to search and retrieve documentation programmatically:

**Available MCP tools:**
- `mcp__whizbang-docs__search-docs` - Keyword or semantic search
- `mcp__whizbang-docs__find-examples` - Find code examples with metadata
- `mcp__whizbang-docs__list-categories` - List all categories
- `mcp__whizbang-docs__list-docs-by-category` - Browse docs by category

**Example searches:**

Keyword search:
```
mcp__whizbang-docs__search-docs
query: "receptors"
limit: 10
```

Semantic/fuzzy search:
```
mcp__whizbang-docs__search-docs
query: "how to handle messages"
semantic: true
```

Find examples:
```
mcp__whizbang-docs__find-examples
query: "receptor implementation"
difficulty: "BEGINNER"
```

Browse by category:
```
mcp__whizbang-docs__list-docs-by-category
category: "API"
```

Use this command when:
- Looking up specific documentation
- Finding code examples
- Need quick reference
- Searching across versions
