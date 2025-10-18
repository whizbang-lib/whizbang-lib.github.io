import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { FileLoader } from './utils/file-loader.js';
import { listDocsResources, readDocsResource } from './resources/docs-resources.js';
import { listRoadmapResources, readRoadmapResource } from './resources/roadmap-resources.js';
import { getUriScheme } from './utils/uri-parser.js';
import { SearchIndex } from './utils/search-index.js';
import { searchDocs, listDocsByCategory, getCategories } from './tools/search-tool.js';
import { findExamples } from './tools/find-examples-tool.js';
import path from 'path';

export interface McpDocsServerConfig {
  docsSource: 'local' | 'remote';
  docsPath?: string;
  docsBaseUrl?: string;
  searchIndexPath?: string;
  enableSemanticSearch?: boolean;
}

export class McpDocsServer {
  private server: Server;
  private config: McpDocsServerConfig;
  private fileLoader: FileLoader;
  private searchIndex: SearchIndex;

  constructor(config: McpDocsServerConfig) {
    this.config = config;

    // Initialize file loader
    this.fileLoader = new FileLoader({
      docsSource: config.docsSource,
      docsPath: config.docsPath || '',
      docsBaseUrl: config.docsBaseUrl
    });

    // Initialize search index
    const searchIndexPath = path.join(config.docsPath || '', '../');
    this.searchIndex = new SearchIndex(searchIndexPath);

    // Create server instance
    this.server = new Server(
      {
        name: '@whizbang/docs-mcp-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Resources: List all available documentation
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const [docs, roadmap] = await Promise.all([
          listDocsResources(this.fileLoader),
          listRoadmapResources(this.fileLoader)
        ]);

        return {
          resources: [...docs, ...roadmap]
        };
      } catch (error) {
        console.error('Failed to list resources:', error);
        return { resources: [] };
      }
    });

    // Resources: Read specific documentation
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      try {
        const scheme = getUriScheme(uri);
        let content: string;

        switch (scheme) {
          case 'doc':
            content = await readDocsResource(uri, this.fileLoader);
            break;
          case 'roadmap':
            content = await readRoadmapResource(uri, this.fileLoader);
            break;
          case 'code':
            // Reserved for future use: extracting code blocks from markdown
            throw new McpError(
              ErrorCode.InvalidRequest,
              'code:// URIs are reserved for future use. Code examples are embedded in documentation pages (doc:// URIs).'
            );
          default:
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Unsupported URI scheme: ${scheme}`
            );
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: content
            }
          ]
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to read resource ${uri}: ${error}`
        );
      }
    });

    // Tools: List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search-docs',
            description: 'Search through documentation using keyword or semantic search',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results',
                  default: 10
                },
                category: {
                  type: 'string',
                  description: 'Filter by category (optional)'
                },
                semantic: {
                  type: 'boolean',
                  description: 'Use semantic/fuzzy search instead of keyword search',
                  default: false
                }
              },
              required: ['query']
            }
          },
          {
            name: 'find-examples',
            description: 'Find code examples in documentation with enhanced metadata',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for code examples (optional)'
                },
                framework: {
                  type: 'string',
                  description: 'Filter by framework version (e.g., "NET8")'
                },
                difficulty: {
                  type: 'string',
                  description: 'Filter by difficulty: BEGINNER, INTERMEDIATE, or ADVANCED'
                },
                category: {
                  type: 'string',
                  description: 'Filter by category (e.g., "API", "Domain Logic")'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by tags'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results',
                  default: 20
                }
              }
            }
          },
          {
            name: 'list-categories',
            description: 'List all documentation categories',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'list-docs-by-category',
            description: 'List all documentation grouped by category',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Optional: filter to specific category'
                }
              }
            }
          }
        ]
      };
    });

    // Tools: Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'search-docs': {
            const results = await searchDocs(request.params.arguments as any, this.searchIndex);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(results, null, 2)
                }
              ]
            };
          }

          case 'find-examples': {
            const examples = await findExamples(request.params.arguments as any, this.fileLoader);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(examples, null, 2)
                }
              ]
            };
          }

          case 'list-categories': {
            const categories = await getCategories(this.searchIndex);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(categories, null, 2)
                }
              ]
            };
          }

          case 'list-docs-by-category': {
            const category = (request.params.arguments as any)?.category;
            const grouped = await listDocsByCategory(this.searchIndex, category);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(grouped, null, 2)
                }
              ]
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error}`
        );
      }
    });

    // Prompts: List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      // TODO: Implement in Phase 5
      return {
        prompts: [
          {
            name: 'explain-concept',
            description: 'Get detailed explanation of a Whizbang concept',
            arguments: [
              {
                name: 'concept',
                description: 'Name of the concept to explain',
                required: true
              }
            ]
          }
        ]
      };
    });

    // Prompts: Get specific prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      // TODO: Implement in Phase 5
      if (request.params.name === 'explain-concept') {
        const concept = request.params.arguments?.concept as string;
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Explain the concept of "${concept}" in Whizbang.`
              }
            }
          ]
        };
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown prompt: ${request.params.name}`
      );
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log to stderr (stdout is used for MCP protocol)
    console.error('Whizbang Documentation MCP Server started');
    console.error(`Mode: ${this.config.docsSource}`);
    if (this.config.docsPath) {
      console.error(`Docs path: ${this.config.docsPath}`);
    }
  }
}
