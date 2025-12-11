# Documentation Versioning System

This document provides comprehensive details about the documentation versioning system implemented for the Whizbang .NET library documentation website.

## Overview

The versioning system implements a filesystem-based approach to documentation organization, similar to HotChocolate's documentation structure. It supports released versions, development states, interactive features, and version-aware search.

## Architecture

### Filesystem Structure

```
src/assets/docs/
├── v1.0.0/                    # Released version directories
│   ├── _folder.md             # Version metadata
│   ├── getting-started.md
│   ├── installation.md
│   └── ...
├── v1.1.0/                    # Newer released version
├── v1.2.0/                    # Latest released version
├── drafts/                    # Draft documentation (unreleased)
│   ├── _folder.md             # State metadata
│   └── new-feature.md
├── proposals/                 # Feature proposals
├── backlog/                   # Future feature documentation
└── declined/                  # Declined feature documentation
```

### Core Services

#### VersionService (`src/app/services/version.service.ts`)

Central service for version management using Angular signals:

```typescript
@Injectable({ providedIn: 'root' })
export class VersionService {
  private readonly DEFAULT_VERSION = 'v1.2.0';
  private readonly _currentVersion = signal<string>(this.DEFAULT_VERSION);
  private readonly _availableVersions = signal<VersionInfo[]>([]);
  private readonly _documentationStates = signal<DocumentationState[]>([]);

  // Public reactive properties
  readonly currentVersion = this._currentVersion.asReadonly();
  readonly availableVersions = this._availableVersions.asReadonly();
  readonly documentationStates = this._documentationStates.asReadonly();

  setCurrentVersion(version: string): void {
    this._currentVersion.set(version);
    this.saveVersionPreference(version);
  }
}
```

**Key Features:**
- Reactive version state management with Angular signals
- Persistent version preferences in localStorage
- Categorized version types (released, development, planned)
- Documentation state management (drafts, proposals, etc.)
- Integration with routing for version-aware URLs

#### HeaderProcessorService (`src/app/services/header-processor.service.ts`)

Processes markdown headers to create interactive, linkable elements:

```typescript
processHeaders(content: string): { processedContent: string; headers: HeaderInfo[] } {
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const headers: HeaderInfo[] = [];
  
  const processedContent = content.replace(headerRegex, (match, hashes, text) => {
    const level = hashes.length;
    const cleanText = text.trim();
    const slug = this.generateSlug(cleanText);
    
    headers.push({ level, text: cleanText, slug });
    
    return `<h${level} id="${slug}" class="doc-header">
      <span class="header-text">${cleanText}</span>
      <button class="header-link-btn" onclick="copyHeaderLink('#${slug}')" 
              title="Copy link to this section">
        <i class="pi pi-link"></i>
      </button>
    </h${level}>`;
  });

  return { processedContent, headers };
}

private generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
```

**Features:**
- Automatic kebab-case slug generation
- Interactive hover link icons
- Copy-to-clipboard functionality
- Accessible button elements with proper ARIA attributes

#### CalloutProcessorService (`src/app/services/callout-processor.service.ts`)

Processes enhanced documentation callouts with version-aware features:

```typescript
processCallouts(content: string): { processedContent: string; callouts: CalloutInfo[] } {
  const calloutRegex = /:::(\w+)(\{[^}]*\})?\s*\n([\s\S]*?)(?=\n:::(?:\s|$)|\n\n|$)/g;
  const callouts: CalloutInfo[] = [];

  const processedContent = content.replace(calloutRegex, (match, type, attributesStr, content) => {
    const attributes = this.parseAttributes(attributesStr);
    const callout: CalloutInfo = {
      type: type,
      content: content.trim(),
      attributes: attributes
    };
    
    callouts.push(callout);
    return this.generateCalloutHTML(callout);
  });

  return { processedContent, callouts };
}
```

**Callout Types:**
- `:::new` - New features in current version
- `:::updated` - Updated functionality
- `:::deprecated` - Deprecated features with migration guidance
- `:::planned` - Planned features with cross-version links
- `:::new{type="breaking"}` - Breaking changes

### Components

#### VersionSelectorComponent (`src/app/components/version-selector.component.ts`)

Dynamic dropdown component for version selection:

```typescript
@Component({
  selector: 'wb-version-selector',
  template: `
    <p-dropdown 
      [options]="versionOptions()" 
      [ngModel]="versionService.currentVersion()"
      (ngModelChange)="onVersionChange($event)"
      placeholder="Select Version"
      [showClear]="false"
      styleClass="version-selector">
      
      <ng-template pTemplate="selectedItem" let-selectedOption>
        <div class="selected-version">
          <i [class]="getVersionIcon(selectedOption.value)" class="mr-2"></i>
          <span>{{selectedOption.label}}</span>
        </div>
      </ng-template>
      
      <ng-template pTemplate="item" let-option>
        <div class="version-option" [class]="'version-' + option.category">
          <i [class]="getVersionIcon(option.value)" class="mr-2"></i>
          <div class="version-info">
            <div class="version-name">{{option.label}}</div>
            <div class="version-description">{{option.description}}</div>
          </div>
        </div>
      </ng-template>
    </p-dropdown>
  `
})
export class VersionSelectorComponent {
  versionService = inject(VersionService);

  versionOptions = computed(() => {
    // Creates categorized options with released, development, and state versions
    return this.buildVersionOptions();
  });
}
```

### Version-Aware Search

#### Enhanced Search Integration

The search system integrates with the versioning system to provide filtered results:

```typescript
// In EnhancedSearchService
private filterResultsByVersion(results: EnhancedSearchResult[], options?: any): EnhancedSearchResult[] {
  if (options?.filterByCurrentVersion === false) {
    return results; // Show all versions
  }

  const currentVersion = this.versionService.currentVersion();
  const currentVersionDocs = this.versionService.getCurrentVersionDocs();
  const currentVersionSlugs = new Set(currentVersionDocs.map(doc => doc.slug));
  
  const filteredResults = results.filter(result => {
    return currentVersionSlugs.has(result.document.slug);
  });

  console.log(`Version-filtered search: ${results.length} -> ${filteredResults.length} results (version: ${currentVersion})`);
  
  return filteredResults;
}

searchAllVersions(query: string, options?: any): Observable<EnhancedSearchResult[]> {
  return this.search(query, { ...options, filterByCurrentVersion: false });
}
```

#### Search UI Features

```typescript
// In EnhancedSearchComponent template
<div class="search-controls">
  <p-checkbox 
    [(ngModel)]="searchAllVersions" 
    (ngModelChange)="onSearchAllVersionsChange()"
    binary="true" 
    inputId="searchAllVersions" />
  <label for="searchAllVersions" class="ml-2">All versions</label>
</div>

<div class="search-info" *ngIf="searchResults().length > 0">
  <span class="results-count">
    {{searchResults().length}} results ({{searchTime}}ms)
    <span *ngIf="!searchAllVersions" class="version-context">
      in {{versionService.currentVersion()}}
    </span>
  </span>
</div>
```

## Build Process

### Version-Aware Documentation Indexing

The build process includes version-aware documentation processing:

```javascript
// gen-docs-index-versioned.mjs
async function processVersionDirectory(versionDir, version) {
  const versionPath = path.join(DOCS_DIR, versionDir);
  const folderMetadataPath = path.join(versionPath, '_folder.md');
  
  // Read version metadata
  let versionMetadata = {};
  if (fs.existsSync(folderMetadataPath)) {
    const folderContent = fs.readFileSync(folderMetadataPath, 'utf-8');
    const { data: frontmatter } = matter(folderContent);
    versionMetadata = frontmatter;
  }

  // Process all markdown files in version directory
  const files = fs.readdirSync(versionPath)
    .filter(file => file.endsWith('.md') && file !== '_folder.md');

  const documents = [];
  for (const file of files) {
    const document = await processDocument(path.join(versionPath, file), version);
    if (document) {
      documents.push(document);
    }
  }

  return {
    version,
    metadata: versionMetadata,
    documents
  };
}
```

### Integration with Build Scripts

The build process automatically:
1. Processes all version directories and states
2. Generates version-aware search indices
3. Creates navigation structures
4. Validates cross-version links

## Configuration

### Version Metadata (`_folder.md`)

Each version/state directory contains metadata:

```yaml
---
title: "Version 1.2.0"
description: "Latest stable release with enhanced features"
releaseDate: "2024-03-15"
status: "released"
completionLevel: 100
estimatedRelease: null
breaking: false
---

# Version 1.2.0 Release Notes

This version introduces several new features and improvements...
```

### Global Configuration

Version-specific configuration in `src/app/services/version.service.ts`:

```typescript
private readonly VERSION_CONFIG = {
  DEFAULT_VERSION: 'v1.2.0',
  RELEASED_VERSIONS: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
  DEVELOPMENT_VERSIONS: ['v1.3.0-dev'],
  PLANNED_VERSIONS: ['v2.0.0-planned'],
  DOCUMENTATION_STATES: [
    { key: 'drafts', label: 'Drafts', icon: 'pi-file-edit' },
    { key: 'proposals', label: 'Proposals', icon: 'pi-lightbulb' },
    { key: 'backlog', label: 'Backlog', icon: 'pi-clock' },
    { key: 'declined', label: 'Declined', icon: 'pi-times-circle' }
  ]
};
```

## Styling and Visual Design

### CSS Custom Properties

```scss
// Version-specific styling
.version-selector {
  --primary-color: var(--blue-500);
  --surface-0: var(--surface-card);
  
  .version-option {
    &.version-released {
      border-left: 3px solid var(--green-500);
    }
    
    &.version-development {
      border-left: 3px solid var(--orange-500);
    }
    
    &.version-planned {
      border-left: 3px solid var(--blue-500);
    }
    
    &.version-state {
      border-left: 3px solid var(--purple-500);
    }
  }
}

// Interactive headers
.doc-header {
  position: relative;
  
  .header-link-btn {
    opacity: 0;
    transition: opacity 0.2s ease;
    position: absolute;
    right: -2rem;
    top: 50%;
    transform: translateY(-50%);
    
    &:hover {
      background: var(--primary-color);
      color: white;
    }
  }
  
  &:hover .header-link-btn {
    opacity: 1;
  }
}

// Enhanced callouts
.callout {
  &.callout-new {
    border-left: 4px solid var(--green-500);
    background: var(--green-50);
  }
  
  &.callout-updated {
    border-left: 4px solid var(--blue-500);
    background: var(--blue-50);
  }
  
  &.callout-deprecated {
    border-left: 4px solid var(--orange-500);
    background: var(--orange-50);
  }
  
  &.callout-planned {
    border-left: 4px solid var(--purple-500);
    background: var(--purple-50);
  }
  
  &.callout-breaking {
    border-left: 4px solid var(--red-500);
    background: var(--red-50);
  }
}
```

## Usage Patterns

### Creating Version-Specific Documentation

1. **New Released Version:**
   ```bash
   mkdir src/assets/docs/v1.3.0
   echo "---\ntitle: \"Version 1.3.0\"\ndescription: \"New features release\"\nreleaseDate: \"2024-04-01\"\nstatus: \"released\"\n---" > src/assets/docs/v1.3.0/_folder.md
   ```

2. **Adding Enhanced Callouts:**
   ```markdown
   :::new
   This feature is new in version 1.2.0!
   :::

   :::updated
   This functionality has been improved in this version.
   :::

   :::planned{version="v2.0.0"}
   This feature is planned for version 2.0.0. See [roadmap](/docs/v2.0.0-planned/new-feature).
   :::
   ```

3. **Interactive Headers:**
   ```markdown
   # Getting Started
   ## Installation Process
   ### Prerequisites
   ```
   
   Automatically generates:
   - `#getting-started` anchor
   - `#installation-process` anchor  
   - `#prerequisites` anchor
   - Hover link icons with copy functionality

### Cross-Version Navigation

The system supports seamless navigation between versions:

```typescript
// Automatic URL resolution
/docs/getting-started -> /docs/v1.2.0/getting-started (current version)
/docs/v1.0.0/getting-started -> specific version
/docs/drafts/new-feature -> development state
```

## Performance Considerations

### Caching Strategy

```typescript
// Version information cached in localStorage
private cacheVersionData(data: any): void {
  try {
    localStorage.setItem('whizbang-version-data', JSON.stringify(data));
    localStorage.setItem('whizbang-version-data-timestamp', Date.now().toString());
  } catch (error) {
    console.warn('Failed to cache version data:', error);
  }
}

private loadCachedVersionData(): any {
  try {
    const cached = localStorage.getItem('whizbang-version-data');
    const timestamp = localStorage.getItem('whizbang-version-data-timestamp');
    
    if (cached && timestamp) {
      const age = Date.now() - parseInt(timestamp);
      const maxAge = 1 * 60 * 60 * 1000; // 1 hour
      
      if (age < maxAge) {
        return JSON.parse(cached);
      }
    }
  } catch (error) {
    console.warn('Failed to load cached version data:', error);
  }
  return null;
}
```

### Search Index Optimization

- Version-specific search indices reduce memory usage
- Lazy loading of non-current version content
- Efficient filtering algorithms for large documentation sets

## Future Enhancements

### Planned Features

1. **Automatic Link Validation**: Build-time checking of cross-version links
2. **Version Comparison View**: Side-by-side documentation comparison
3. **Migration Guides**: Automated migration path generation
4. **API Versioning Integration**: Sync with actual library versioning
5. **Community Contributions**: Version-specific contribution workflows

### Extension Points

The system is designed for extensibility:

```typescript
// Plugin interface for custom version processors
interface VersionProcessor {
  processContent(content: string, version: string): Promise<ProcessedContent>;
  validateLinks(links: Link[], version: string): Promise<ValidationResult>;
  generateNavigation(documents: Document[], version: string): NavigationTree;
}
```

## Troubleshooting

### Common Issues

1. **Version Not Found**: Check version directory structure and `_folder.md` metadata
2. **Headers Not Interactive**: Verify HeaderProcessorService integration in markdown component
3. **Search Results Not Filtered**: Ensure VersionService is properly injected in search service
4. **Callouts Not Rendering**: Check CalloutProcessorService regex patterns and CSS styles

### Debugging Tools

```typescript
// Enable debug mode in VersionService
private readonly DEBUG_MODE = environment.production === false;

private debugLog(message: string, data?: any): void {
  if (this.DEBUG_MODE) {
    console.log(`[VersionService] ${message}`, data);
  }
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('VersionService', () => {
  it('should set current version correctly', () => {
    const service = TestBed.inject(VersionService);
    service.setCurrentVersion('v1.1.0');
    expect(service.currentVersion()).toBe('v1.1.0');
  });

  it('should filter documents by version', () => {
    const service = TestBed.inject(VersionService);
    const filteredDocs = service.getCurrentVersionDocs();
    expect(filteredDocs.every(doc => doc.version === service.currentVersion())).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('Version Integration', () => {
  it('should navigate to version-specific URLs', () => {
    // Test version-aware routing
  });

  it('should filter search results by version', () => {
    // Test version-aware search
  });
});
```

### End-to-End Tests

```typescript
// Playwright tests for version functionality
test('version selector changes search results', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="version-selector"]');
  await page.click('text=v1.0.0');
  
  const searchResults = await page.locator('[data-testid="search-results"]').count();
  expect(searchResults).toBeGreaterThan(0);
});
```

This comprehensive versioning system provides a robust foundation for managing complex documentation across multiple versions while maintaining excellent user experience and developer productivity.