# Whizbang Documentation MCP Server

MCP server providing programmatic access to Whizbang .NET library documentation for AI assistants and developers.

## Features

- 📚 Access all documentation via MCP resources
- 🔍 Full-text and semantic search
- 💻 Browse C# code examples
- 🚀 Discover roadmap/planned features
- 🤖 Reusable prompts for common tasks

## Installation

### Global Installation (Recommended)

```bash
npm install -g @whizbang/docs-mcp-server
```

### Local Development

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
│   ├── resources/            # Resource handlers (Phase 3)
│   ├── tools/                # Tool implementations (Phase 4)
│   ├── prompts/              # Prompt templates (Phase 5)
│   └── utils/                # Utilities
├── build/                    # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Implementation Status

### ✅ Phase 2 Complete: Foundation

- [x] Project structure
- [x] TypeScript configuration
- [x] Basic server with stdio transport
- [x] Placeholder handlers for resources, tools, prompts
- [x] Build system working

### 🔄 Phase 3: Resources (Next)

- [ ] Documentation resources (`doc://`)
- [ ] Roadmap resources (`roadmap://`)
- [ ] Code example resources (`code://`)
- [ ] File loader utilities
- [ ] Frontmatter parsing

### ⏳ Phase 4: Tools

- [ ] search-docs implementation
- [ ] semantic-search implementation
- [ ] find-examples implementation
- [ ] list-docs-by-category implementation
- [ ] list-roadmap implementation

### ⏳ Phase 5: Prompts

- [ ] explain-concept prompt
- [ ] show-example prompt
- [ ] api-reference prompt

## License

MIT
