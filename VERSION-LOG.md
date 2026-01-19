# Documentation Version Log

This log tracks which library commits each documentation version is based on, enabling incremental documentation updates and maintaining accuracy between code and docs.

## Purpose

- **Track code-to-docs alignment**: Know exactly which library commit each doc version describes
- **Enable incremental updates**: Use git diff to see code changes since last doc update
- **Maintain accuracy**: Ensure documentation reflects actual implementation
- **Support CODE-DOCS-MAP.json**: Provides commit context for bidirectional linking

## How to Use This Log

### When Updating Documentation

1. **Check the current commit hash** for the version you're updating
2. **Review code changes** since last doc update:
   ```bash
   cd /Users/philcarbone/src/whizbang
   git log <commit-from-log>..HEAD --name-only
   ```
3. **Review changed files** and identify documentation impacts
4. **Update corresponding documentation**
5. **Regenerate code-docs map**:
   ```bash
   npm run generate-map
   ```
6. **Rebuild MCP server**:
   ```bash
   cd mcp-docs-server && npm run build
   ```
7. **Update this log** with new commit hash and documentation changes

### When Code Changes Without Doc Updates

If you implement new features or make breaking changes:

1. **Add entry** to this log noting undocumented changes
2. **List changed files** and what documentation is needed
3. **Create tracking issue** or update docs immediately

## Version History

### v0.1.0 - Foundation Release

**Status**: Active Development - Documentation in Progress

**Repository**: `whizbang` (library)
**Baseline Commit**: `9ef9323e7adfd1b5bbb07af85def08d14e139187`
**Baseline Date**: 2024-12-12
**Branch**: `branch/initial`

**Documentation Coverage**:
- **Status**: Comprehensive revamp in progress
- **Files in Codebase**: 204 source files across 15 projects
- **Sample Coverage**: ECommerce sample (12 projects)
- **Documentation Files**: TBD (will be ~64 comprehensive files)
- **Code-Docs Links**: TBD (target: 150+ bidirectional links)

**Key Components Documented** (planned):
- ✅ Core interfaces (IDispatcher, IReceptor, IPerspectiveOf, ILensQuery)
- ✅ Messaging patterns (Outbox, Inbox, Work Coordination)
- ✅ Data access (Dapper, EF Core integrations)
- ✅ Source generators (Receptor, Perspective, MessageRegistry, AggregateId)
- ✅ Transports (Azure Service Bus, In-Memory)
- ✅ Infrastructure (Aspire, Health Checks, Pooling, Policies)
- ✅ Extensibility (Custom implementations for all components)
- ✅ ECommerce sample (Complete tutorial)

**Documentation Structure**:
```
v0.1.0/
├── getting-started/       (4 files)
├── core-concepts/         (6 files)
├── messaging/             (4 files)
├── data/                  (4 files)
├── generators/            (5 files)
├── transports/            (2 files)
├── infrastructure/        (4 files)
├── extensibility/         (12 files)
├── examples/
│   ├── ecommerce/        (10 files)
│   └── customization/    (4 files)
├── performance/           (3 files)
├── testing/               (4 files)
└── deployment/            (3 files)
```

**Last Updated**: 2024-12-12
**Updated By**: Claude Code (Initial VERSION-LOG.md creation)
**Changes**: Established baseline for v0.1.0 documentation revamp

---

### Future Versions

*Versions will be added here as they are released*

---

## Undocumented Changes

*Track code changes that need documentation updates here*

### Example Entry Format

```markdown
### v0.X.X - Undocumented Changes
- **Commit**: abc123def456
- **Date**: 2024-XX-XX
- **Changed Files**:
  - src/Whizbang.Core/INewFeature.cs (NEW - implements new pattern)
  - src/Whizbang.Core/IDispatcher.cs (MODIFIED - added BatchSend method)
  - samples/ECommerce/NewFeatureExample.cs (NEW - shows usage)
- **Documentation Needed**:
  - [ ] INewFeature API reference
  - [ ] IDispatcher.BatchSend documentation
  - [ ] Example showing new pattern
  - [ ] Update getting-started if it affects setup
  - [ ] Extensibility guide for custom implementations
- **Impact**: Breaking changes / Backward compatible / New feature
```

---

## Notes

- This log is referenced in both repository CLAUDE.md files
- Always update after significant documentation changes
- Commit hash should be from the library repository (whizbang)
- Documentation commits are in this repository (whizbang-lib.github.io)
- Use MCP tools to verify code-docs linkage after updates
