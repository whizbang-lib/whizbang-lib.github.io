# MCP Server Integration

This project includes a Model Context Protocol (MCP) server for programmatic access to documentation.

## Two Separate MCP Servers

**IMPORTANT**: This project ecosystem includes TWO distinct MCP servers with different purposes:

### 1. Documentation MCP Server (This Repository)

**Location**: `mcp-docs-server/` directory in this repo
**Technology**: Node.js/TypeScript
**Package**: `@whizbang/docs-mcp-server` (npm)
**Installation**: `npm install -g @whizbang/docs-mcp-server`

**Purpose**: Read-only access to Whizbang library documentation

**Capabilities**:
- Access all documentation via resources (`doc://`, `roadmap://`, `code://`)
- Full-text search using MiniSearch
- AI-enhanced semantic search
- Find code examples by topic
- List documentation by category
- Browse roadmap/planned features

**Does NOT**:
- Execute library code
- Interact with Whizbang runtime
- Modify documentation
- Run C# code

**Target Audience**:
- Developers learning Whizbang
- AI assistants providing guidance on library usage
- Technical writers maintaining documentation
- Library maintainers searching docs

### 2. Runtime MCP Server (Future - Separate Repository)

**Technology**: C#/.NET
**Package**: `Whizbang.Runtime.McpServer` (NuGet)
**Installation**: `dotnet tool install -g Whizbang.Runtime.McpServer`

**Purpose**: Interact with actual Whizbang .NET library functions

**Capabilities**:
- Execute library methods
- Create and manage aggregates
- Run projections
- Query data through Whizbang API
- Test library functionality
- Demonstrate live examples

**Does**:
- Actually run Whizbang library code
- Provide runtime interaction
- Execute C# against the library

**Target Audience**:
- AI assistants building applications with Whizbang
- Developers prototyping with the library
- Testing and validation scenarios

## Why Two Separate Servers?

**Separation of Concerns**:
- **Documentation** (read-only data) vs **Execution** (active runtime)
- Different security models (docs are safe, code execution requires sandboxing)
- Different performance characteristics
- Different failure modes

**Technology Alignment**:
- **Docs server**: Node.js leverages existing search infrastructure
- **Runtime server**: Must be C#/.NET to interact with library

**Independent Evolution**:
- Update docs without affecting runtime
- Change runtime without breaking docs
- Version independently
- Deploy separately

## Documentation MCP Server - Usage Modes

**📖 For complete setup instructions**, see [CONTRIBUTING.md - MCP Server Setup](../CONTRIBUTING.md#mcp-server-setup-optional-for-ai-assisted-development) which includes build steps, configuration options, and activation instructions.

The docs MCP server supports multiple configurations:

### Mode 1: Local Development

For contributors working on documentation:

```json
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "node",
      "args": ["./mcp-docs-server/build/index.js"],
      "env": {
        "DOCS_SOURCE": "local",
        "DOCS_PATH": "./src/assets/docs"
      }
    }
  }
}
```

### Mode 2: Installed Package

For users with package installed globally:

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

### Mode 3: Remote Fetch (Future)

Fetch docs from published GitHub Pages:

```json
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "npx",
      "args": ["@whizbang/docs-mcp-server"],
      "env": {
        "DOCS_SOURCE": "remote",
        "DOCS_BASE_URL": "https://whizbang-lib.github.io"
      }
    }
  }
}
```

## URI Schemes

The documentation MCP server uses distinct URI schemes for different content types:

### Documentation Resources
- `doc://getting-started` - Getting Started guide
- `doc://tutorials/getting-started-tutorial` - Tutorial documents
- `doc://advanced/configuration` - Advanced configuration
- `doc://api` - API reference

### Roadmap Resources (Unreleased Features)
- `roadmap://event-sourcing` - Planned event sourcing feature
- `roadmap://advanced-querying` - Future query capabilities

**Important**: Separate `roadmap://` scheme prevents confusion about what's released.

### Code Example Resources
- `code://csharp/aggregates/order-aggregate` - Aggregate examples
- `code://csharp/projections/read-model` - Projection examples

## Available Tools

The docs MCP server provides these tools for searching and discovery:

### search-docs
Full-text search using existing MiniSearch index.

**Input**: Query string, optional limit
**Output**: Ranked search results with snippets
**Use case**: Find docs by keyword

### semantic-search
AI-enhanced search using pre-computed embeddings.

**Input**: Query string, optional limit
**Output**: Semantically similar results
**Use case**: Find conceptually related content

### find-examples
Search specifically for C# code examples.

**Input**: Topic/keyword, optional filters (language, framework, difficulty)
**Output**: Relevant code examples with metadata
**Use case**: Find examples demonstrating a concept

### list-docs-by-category
List all documentation in a category.

**Input**: Category name
**Output**: Array of documents with metadata
**Use case**: Browse documentation structure

### list-roadmap
List planned/unreleased features.

**Input**: Optional status filter (planned, in-development, experimental)
**Output**: Roadmap items with status and target version
**Use case**: Discover future features

## Available Prompts

Reusable templates for common tasks:

### explain-concept
Get detailed explanation of a Whizbang concept.

**Input**: Concept name (e.g., "aggregates", "projections")
**Process**: Searches docs, formats explanation
**Output**: Concept explanation + examples + API reference

### show-example
Find and display relevant code examples.

**Input**: What user wants to do (e.g., "create an aggregate")
**Process**: Searches examples, returns formatted code
**Output**: Code example with explanation and usage notes

### api-reference
Look up API documentation.

**Input**: Class/method name
**Process**: Searches API docs
**Output**: API signature, parameters, examples, links

## MCP Server Benefits

### User Benefits
- AI assistants can search and reference documentation
- No need to manually copy-paste docs into chat
- Always access latest documentation
- Discover related content through semantic search

### Maintainer Benefits
- Reduce context window usage in AI conversations
- Documentation accessible across sessions
- Easy to test documentation accessibility
- MCP Inspector for validation

### AI Assistant Benefits
- Direct programmatic access to docs
- Search capabilities (keyword + semantic)
- Clear distinction between released and planned features
- Persistent knowledge across conversation sessions

## MCP Server Development

See [`mcp-docs-server/README.md`](../mcp-docs-server/README.md) (to be created) for:

- Installation and setup
- Development workflow
- Testing with MCP Inspector
- Publishing to npm registry
- Configuration options

## MCP Server Integration with Roadmap

The documentation MCP server provides separate access to roadmap features:

### Separate URI Scheme
- Released docs: `doc://getting-started`
- Roadmap docs: `roadmap://event-sourcing`

This prevents confusion - AI assistants know roadmap items are unreleased.

### Roadmap Tools
- `list-roadmap`: List all planned/unreleased features
- Search results flagged: "Roadmap (Unreleased)"
- Metadata includes status and target version