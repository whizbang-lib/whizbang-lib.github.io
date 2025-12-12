---
description: Rebuild code-docs map and restart MCP server
---

Rebuild the code-docs mapping file and restart the MCP server to pick up changes:

1. Regenerate the code-docs-map.json file by running the mapping script
2. The MCP server will automatically reload the updated mapping on next request

**When to use**:
- After adding new `<docs>` tags to library source code
- After modifying existing `<docs>` tags
- After renaming or moving documentation files
- When you suspect the mapping is out of sync

**Steps**:
1. Run the generate-code-docs-map.mjs script
2. Verify the mapping was updated successfully
3. Test the MCP tools to ensure they reflect changes

**Usage**:
```bash
# Run the mapping script
node src/scripts/generate-code-docs-map.mjs

# Verify output
cat src/assets/code-docs-map.json | jq
```

**Note**: The MCP server reads the mapping file on startup and caches it, so you may need to restart Claude Code to pick up changes, or the server will reload on next tool invocation.
