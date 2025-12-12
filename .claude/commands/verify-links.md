---
description: Validate all <docs> tags point to valid documentation
---

Validate that all `<docs>` XML tags in the library source code point to valid documentation files:

**When to use**:
- After adding new `<docs>` tags to source code
- After moving or renaming documentation files
- Before committing changes
- As part of pre-release checklist

**What it does**:
1. Loads the code-docs-map.json mapping file
2. Loads all documentation from the search index
3. Validates each `<docs>` tag points to an existing doc
4. Reports broken links with symbol names

**How to validate**:

Use the MCP tool to validate all links:

```typescript
// Run validation via MCP tool
mcp__whizbang-docs__validate-doc-links()
```

**Expected output**:
```json
{
  "valid": 5,
  "broken": 0,
  "details": [
    {
      "symbol": "IDispatcher",
      "docs": "core-concepts/dispatcher",
      "status": "valid"
    },
    {
      "symbol": "IReceptor",
      "docs": "core-concepts/receptors",
      "status": "valid"
    }
  ]
}
```

**If broken links found**:
1. Check if documentation file exists at the specified path
2. Verify the path format matches `category/doc-name`
3. Update the `<docs>` tag or create missing documentation
4. Regenerate the mapping with `/rebuild-mcp`
5. Re-run validation

**Common issues**:
- Wrong path format (should be `category/doc-name`, not full path)
- Documentation file renamed but `<docs>` tag not updated
- Version-specific paths (use base path without version folder)
- Typos in tag paths
