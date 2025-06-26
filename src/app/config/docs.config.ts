// Auto-generated docs configuration
// Last updated: 2025-06-07T00:00:00.000Z

export interface DocsItem {
  id: string;
  title: string;
  category: string;
  order: number;
  path: string;
}

export const DOCS_CONFIG: DocsItem[] = [
  {
    "id": "getting-started",
    "title": "Getting started",
    "category": "Introduction",
    "order": 1,
    "path": "/docs/getting-started"
  },
  {
    "id": "philosophy",
    "title": "Philosophy",
    "category": "Introduction",
    "order": 2,
    "path": "/docs/philosophy"
  },
  {
    "id": "aggregates",
    "title": "Aggregates",
    "category": "Core concepts",
    "order": 1,
    "path": "/docs/aggregates"
  },
  {
    "id": "projections",
    "title": "Projections",
    "category": "Core concepts",
    "order": 2,
    "path": "/docs/projections"
  },
  {
    "id": "api",
    "title": "API Reference",
    "category": "Reference",
    "order": 1,
    "path": "/docs/api"
  }
];

export const DOCS_CATEGORIES = Array.from(new Set(DOCS_CONFIG.map(item => item.category)));
