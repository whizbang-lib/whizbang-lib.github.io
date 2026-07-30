# Whizbang Documentation MCP Server

MCP server providing programmatic access to Whizbang .NET library documentation for AI assistants and developers.

## Features

- 📚 Access all documentation via MCP resources (a versioned snapshot is bundled in the npm package — works offline, no repo checkout needed)
- 🔍 Full-text and semantic search
- 💻 Browse C# code examples
- ✅ **Live test status** — `get-test-status` fetches real CI pass/fail results from the docs site (never bundled, never stale)
- 🔗 Code↔docs↔tests navigation (`get-code-location`, `get-tests-for-code`, …)
- 🚀 Discover roadmap/planned features
- 🤖 Reusable prompts for common tasks

## Two modes

| Mode | Who | Docs content source |
|---|---|---|
| **Consumer** (default when installed from npm) | Developers using the library | `bundled-assets/` snapshot baked at publish time (see `bundle-info.json` for the source commit) |
| **Contributor** | Working in the docs repo | Live repo files — automatic when running from a checkout, or set `DOCS_PATH=/path/to/whizbang-lib.github.io/src/assets/docs` |

Live test-status is always fetched from https://whizba.ng regardless of mode.

## Installation

### Consumers (Recommended)

No install step needed — reference it with `npx` in your MCP client config (below), or install globally:

```bash
npm install -g @whizbang/docs-mcp-server
```

### Contributors (from the docs repo)

```bash
cd mcp-docs-server
npm install
npm run build
```

## Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "npx",
      "args": ["@whizbang/docs-mcp-server"]
    }
  }
}
```

### Claude Code (VSCode Extension)

#### Using the CLI Command (Recommended)

The easiest way to add the server is using the `claude mcp add` CLI:

**For global installation (after publishing to npm):**

```bash
claude mcp add whizbang-docs -- npx @whizbang/docs-mcp-server
```

**For local development (with environment variables):**

```bash
claude mcp add whizbang-docs \
  -e DOCS_SOURCE=local \
  -e DOCS_PATH=/absolute/path/to/whizbang-lib.github.io/src/assets/docs \
  -- node /absolute/path/to/whizbang-lib.github.io/mcp-docs-server/build/index.js
```

**Note:** The `--` separates Claude CLI flags from the actual command to execute.

#### Manual Configuration

You can also edit the MCP settings JSON directly in VSCode settings.

For global installation:

```json
{
  "whizbang-docs": {
    "command": "npx",
    "args": ["@whizbang/docs-mcp-server"]
  }
}
```

For local development (use absolute paths):

```json
{
  "whizbang-docs": {
    "command": "node",
    "args": ["/Users/philcarbone/src/whizbang-lib.github.io/mcp-docs-server/build/index.js"],
    "env": {
      "DOCS_SOURCE": "local",
      "DOCS_PATH": "/Users/philcarbone/src/whizbang-lib.github.io/src/assets/docs"
    }
  }
}
```

**Note**: Make sure to use absolute paths, not relative paths like `~/` or `./`. The MCP server needs the full path to work correctly.

### Local Development Mode (Claude Desktop)

```json
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "node",
      "args": ["/path/to/whizbang-lib.github.io/mcp-docs-server/build/index.js"],
      "env": {
        "DOCS_SOURCE": "local",
        "DOCS_PATH": "/path/to/whizbang-lib.github.io/src/assets/docs"
      }
    }
  }
}
```

## Environment Variables

- `DOCS_SOURCE`: `local` or `remote` (default: `local`)
- `DOCS_PATH`: Path to documentation directory (default: `../src/assets/docs`)
- `DOCS_BASE_URL`: Base URL for remote docs (default: `https://whizbang-lib.github.io`)
- `SEARCH_INDEX_PATH`: Path to search indices (default: `../src/assets`)
- `ENABLE_SEMANTIC_SEARCH`: Enable AI-enhanced search (default: `true`)

## Available Resources

### Documentation (`doc://`)

Access all documentation pages including embedded code examples with enhanced metadata.

- `doc://getting-started` - Getting started guide
- `doc://tutorials/...` - Tutorials
- `doc://advanced/...` - Advanced topics
- `doc://api` - API reference
- `doc://enhanced-csharp-examples` - C# code examples with metadata

**Code Examples**: C# code samples are embedded within documentation pages using enhanced code block syntax. Each example includes:
- Title and description
- Framework version (NET6, NET8, etc.)
- Difficulty level (BEGINNER, INTERMEDIATE, ADVANCED)
- Tags and categories
- Test file references (`testFile`, `testMethod`)
- NuGet package dependencies
- Syntax highlighting and line numbers

### Roadmap (`roadmap://`)

Access documentation for planned/unreleased features with warning banners.

- `roadmap://...` - Future features marked with status
- Status indicators: `planned`, `in-development`, `experimental`
- Includes warning that API may change before release

### Code Scheme (Reserved for Future Use)

The `code://` URI scheme is reserved for potential future enhancement where code blocks could be extracted from documentation and served as standalone resources. Currently, all code examples are accessed through `doc://` URIs within their documentation context.

## Available Tools

### search-docs

Full-text or semantic search across all documentation.

**Parameters**:
- `query` (required): Search query
- `limit` (optional): Maximum results (default: 10)
- `category` (optional): Filter by category
- `semantic` (optional): Use semantic/fuzzy search instead of keyword search

**Output**: Array of search results with title, preview, category, URI, and relevance score

### find-examples

Find C# code examples with enhanced metadata from documentation.

**Parameters**:
- `query` (optional): Search query for examples
- `framework` (optional): Filter by framework (e.g., "NET8")
- `difficulty` (optional): BEGINNER, INTERMEDIATE, or ADVANCED
- `category` (optional): Filter by category (e.g., "API", "Domain Logic")
- `tags` (optional): Array of tags to filter by
- `limit` (optional): Maximum results (default: 20)

**Output**: Code examples with title, description, framework, test references, and code snippet

### list-categories

List all available documentation categories.

**Parameters**: None

**Output**: Array of category names

### list-docs-by-category

List all documentation grouped by category.

**Parameters**:
- `category` (optional): Filter to specific category

**Output**: Object with categories as keys and document arrays as values

### get-code-location

Find the library code implementing a documentation concept (code↔docs mapping).

**Parameters**:
- `concept` (required): Documentation concept or URL (e.g., `"dispatcher"` or `"core-concepts/dispatcher"`)

**Output**: Code location(s) implementing the concept

### get-related-docs

Get the documentation URL for a code symbol (reverse of `get-code-location`).

**Parameters**:
- `symbol` (required): Code symbol name (e.g., `"IDispatcher"`)

**Output**: Documentation page(s) covering the symbol

### get-tests-for-code

Find the tests exercising a code symbol (code↔tests mapping).

**Parameters**:
- `symbol` (required): Code symbol name (e.g., `"IDispatcher"`, `"Dispatcher"`)

**Output**: Test classes/methods covering the symbol

### get-code-for-test

Find the code a test method exercises (reverse of `get-tests-for-code`).

**Parameters**:
- `testKey` (required): Test key in the form `"TestClassName.TestMethodName"`

**Output**: Code symbol(s) the test covers

### get-test-status

Get **live** pass/fail status for a test class or method from the latest library CI run — fetched from the docs site, never bundled, never stale.

**Parameters**:
- `test` (required): Short test class name (e.g., `"DispatcherTests"`) or full key `"TestClassName.TestMethodName"`

**Output**: Pass/fail status with run metadata

### get-coverage-stats

Get test-coverage statistics showing how many code symbols have tests.

**Parameters**: None

**Output**: Coverage summary across the code↔tests mapping

### validate-doc-links

Validate that all code→docs links point to existing documentation.

**Parameters**: None

**Output**: Validation report listing any broken links

### validate-test-links

Validate that all code→test links resolve.

**Parameters**: None

**Output**: Validation report listing any broken links

## Available Prompts

Prompts are reusable templates that guide Claude in using the tools effectively.

### explain-concept

Get a detailed explanation of a Whizbang .NET library concept with examples and best practices.

**Parameters**:
- `concept` (required): Name of the concept to explain
- `includeExamples` (optional): Include code examples (default: true)
- `difficulty` (optional): beginner, intermediate, or advanced

**Example**: Explain aggregates for a beginner-level developer

### show-example

Find and display code examples for a specific topic with test references and context.

**Parameters**:
- `topic` (required): Topic to find examples for
- `framework` (optional): Filter by framework version
- `difficulty` (optional): beginner, intermediate, or advanced
- `withTests` (optional): Include test file references (default: true)

**Example**: Show intermediate examples for order processing in NET8

### compare-approaches

Compare different implementation approaches for a topic with pros/cons analysis.

**Parameters**:
- `topic` (required): Topic to compare approaches for
- `approaches` (optional): Comma-separated list of specific approaches to compare
- `criteria` (optional): Comma-separated comparison criteria

**Example**: Compare repository pattern approaches for data access

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Testing with MCP Inspector

```bash
npm run inspector
```

Opens a web UI at `http://localhost:5173` to test resources, tools, and prompts.

### Clean Build

```bash
npm run clean
npm run build
```

## Project Structure

```
mcp-docs-server/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server configuration
│   ├── resources/            # Resource handlers (doc://, roadmap://)
│   ├── tools/                # Tool implementations
│   ├── prompts/              # Prompt templates
│   └── utils/                # Utilities
├── build/                    # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Status

Feature-complete: all planned phases (foundation, resources, tools, prompts) are implemented and published. Three items from the original plan were superseded by design decisions rather than built as specified:

- **`code://` resources** — reserved; code examples are served inside their `doc://` pages (see "Code Scheme" above)
- **A separate `semantic-search` tool** — folded into `search-docs` as the `semantic` parameter
- **An `api-reference` prompt** — replaced by `compare-approaches`

## License

MIT
