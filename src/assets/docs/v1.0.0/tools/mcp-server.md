---
title: MCP Documentation Server
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
audience: [consumer, contributor]
order: 1
description: Give your AI assistant direct access to Whizbang docs, code examples, code↔test navigation, and live CI test status via the Model Context Protocol
tags: mcp, ai, tooling, claude, cursor, documentation-server
codeReferences:
  - mcp-docs-server/src/server.ts
  - mcp-docs-server/src/index.ts
  - mcp-docs-server/src/tools/get-test-status-tool.ts
---

# MCP Documentation Server

`@whizbang/docs-mcp-server` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants (Claude Code, Claude Desktop, Cursor, or any MCP client) direct, structured access to this documentation — search, code examples, code↔docs↔tests navigation, and **live CI test status**.

## Quick start

No install required — point your MCP client at `npx`:

```json{
title: "Claude Desktop / Claude Code configuration"
description: "Add to claude_desktop_config.json or use: claude mcp add whizbang-docs -- npx @whizbang/docs-mcp-server"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["MCP", "Setup"]
}
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "npx",
      "args": ["@whizbang/docs-mcp-server"]
    }
  }
}
```

Or with the Claude Code CLI:

```bash{
title: "Claude Code CLI"
description: "One-line MCP server registration"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["MCP", "Setup", "CLI"]
}
claude mcp add whizbang-docs -- npx @whizbang/docs-mcp-server
```

The npm package bundles a versioned snapshot of these docs (works offline; `bundle-info.json` records the source commit). Live test status is always fetched from the site so it can never go stale.

## What your assistant can do with it

| Tool | Purpose |
|---|---|
| `search-docs` | Full-text/semantic search across all pages |
| `find-examples` | Find C# examples by topic, framework, difficulty |
| `list-categories` / `list-docs-by-category` | Browse the docs structure |
| `get-code-location` | Where in the library a documented concept is implemented |
| `get-related-docs` | Which pages document a given code symbol |
| `get-tests-for-code` / `get-code-for-test` | Navigate the code↔tests map (thousands of linked test methods) |
| `get-test-status` | **Live pass/fail** for a test class or method from the latest library CI run |
| `validate-doc-links` / `validate-test-links` | Integrity checks over the linking system |
| `get-coverage-stats` | How much of the public API has linked tests |

Example: ask *"is the dispatcher's delivery-receipt behavior actually passing on develop?"* — the assistant calls `get-tests-for-code` on `Dispatcher`, then `get-test-status` on `DispatcherTests`, and answers from real CI data.

## Contributor mode

Running from a checkout of the docs repo uses the live files automatically (no bundled snapshot). Point it elsewhere explicitly with:

```bash{
title: "Contributor mode environment"
description: "Use a specific docs checkout instead of the bundled snapshot"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["MCP", "Contributing"]
}
DOCS_PATH=/path/to/whizbang-lib.github.io/src/assets/docs npx @whizbang/docs-mcp-server
```

See the [contributor documentation](/docs/contributors/overview) for the full development workflow, and `mcp-docs-server/README.md` in the repo for all environment variables.
