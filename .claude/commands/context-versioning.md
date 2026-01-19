Load documentation versioning system context.

Read these files to understand versioning:
- ai-docs/versioning-system.md - Comprehensive versioning system details
- ai-docs/roadmap-docs.md - How to document unreleased features

Version structure:
```
src/assets/docs/
├── v1.0.0/          # Released versions (folders with version numbers)
├── v1.1.0/
├── v1.2.0/
├── drafts/          # Draft documentation for unreleased features
├── proposals/       # Feature proposals and design documents
├── backlog/         # Future feature documentation
└── declined/        # Declined feature documentation
```

Key features:
1. **Version Dropdown**: Dynamic version selector in header
2. **Interactive Headers**: Auto-generated anchors with copy-to-clipboard
3. **Enhanced Callouts**: Five types (:::new, :::updated, :::deprecated, :::planned, :::breaking)
4. **Version-Aware Search**: Filter results by version
5. **State Navigation**: Browse drafts, proposals, backlog, declined

Services:
- **VersionService** - Core version management with Angular signals
- **HeaderProcessorService** - Automatic header processing
- **CalloutProcessorService** - Enhanced callout system

Use this command when:
- Adding new versions
- Moving documentation between states
- Working with version metadata
- Understanding version organization
