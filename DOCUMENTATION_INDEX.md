# Whizbang Documentation Index

Quick reference guide to all documentation files.

## 📘 For End Users (Learning Whizbang)

### Introduction
- **[Philosophy & Design Principles](src/assets/docs/philosophy.md)**
  - Why Whizbang exists, core tenets, comparisons to other libraries

- **[Architecture Overview](src/assets/docs/architecture.md)**
  - System design, architectural layers, scaling patterns

- **[Getting Started](src/assets/docs/getting-started.md)**
  - Progressive tutorial: mediator → event sourcing → projections

### Core Concepts
- **[Core Concepts](src/assets/docs/core-concepts.md)**
  - Events, Commands, Aggregates, Projections (CQRS/ES fundamentals)

### Installation & Setup
- **[Package Structure](src/assets/docs/package-structure.md)**
  - NuGet packages, decision tree, typical configurations

### Roadmap (Unreleased Features)
- **[Distributed Messaging](src/assets/docs/Roadmap/distributed-messaging.md)**
  - Microservices, message brokers, outbox/inbox pattern (v1.0.0)

---

## 🔧 For Contributors (Building Whizbang)

### Getting Started
- **[Contributing Guide](src/assets/docs/Contributors/contributing.md)**
  - How to contribute, development setup, PR process

- **[Coding Standards](src/assets/docs/Contributors/coding-standards.md)**
  - C# conventions, brace style, naming, AOT requirements

### Design & Planning
- **[Open Design Questions](src/assets/docs/Design/open-questions.md)**
  - 18 unresolved architectural decisions for discussion

---

## 📋 Project Documentation

- **[ARCHITECTURE_SUMMARY.md](ARCHITECTURE_SUMMARY.md)**
  - Comprehensive overview of all created documentation
  - Documentation philosophy and principles
  - Suggested library structure
  - Next steps and gaps to fill

- **[CLAUDE.md](CLAUDE.md)**
  - Project instructions for AI assistants
  - Documentation-as-specification principle
  - Build process and development notes
  - MCP server integration details

- **[CODE_SAMPLES.editorconfig](CODE_SAMPLES.editorconfig)**
  - C# coding standards for documentation examples
  - K&R/Egyptian braces, naming conventions, etc.

- **[DOCUMENTATION-STANDARDS.md](DOCUMENTATION-STANDARDS.md)**
  - Standards for writing documentation
  - Code example requirements
  - Metadata field definitions

---

## 🗂️ Documentation Organization

```
src/assets/docs/
├── philosophy.md                    # Core philosophy and design principles
├── architecture.md                   # System architecture overview
├── core-concepts.md                  # Events, Commands, Aggregates, Projections
├── getting-started.md                # Progressive tutorial
├── package-structure.md              # NuGet package guide
│
├── Design/
│   └── open-questions.md             # Unresolved architectural decisions
│
├── Roadmap/
│   └── distributed-messaging.md      # Unreleased features (v1.0.0)
│
├── Contributors/
│   ├── contributing.md               # How to contribute
│   └── coding-standards.md           # C# conventions and standards
│
├── Advanced/
│   └── configuration.md              # (Existing stub)
│
└── Tutorials/
    └── getting-started-tutorial.md   # (Existing stub)
```

---

## 🎯 Quick Links by Task

### I want to...

**Learn what Whizbang is**
→ Start with [Philosophy](src/assets/docs/philosophy.md)

**Understand the architecture**
→ Read [Architecture Overview](src/assets/docs/architecture.md)

**Build my first app**
→ Follow [Getting Started](src/assets/docs/getting-started.md)

**Understand core concepts**
→ Study [Core Concepts](src/assets/docs/core-concepts.md)

**Choose which packages to install**
→ Use [Package Structure](src/assets/docs/package-structure.md) decision tree

**See what features are planned**
→ Browse [Roadmap](src/assets/docs/Roadmap/)

**Contribute code**
→ Read [Contributing Guide](src/assets/docs/Contributors/contributing.md)

**Follow coding standards**
→ Reference [Coding Standards](src/assets/docs/Contributors/coding-standards.md)

**Discuss architectural decisions**
→ Check [Open Design Questions](src/assets/docs/Design/open-questions.md)

**Understand the documentation philosophy**
→ Read [ARCHITECTURE_SUMMARY.md](ARCHITECTURE_SUMMARY.md)

---

## 📊 Documentation Statistics

**Total Files**: 9 core documentation files + 3 project files

**Word Count**: ~15,000+ words

**Code Examples**: 25+ complete, compilable examples

**Categories**:
- Introduction: 3 files
- Core Concepts: 1 file
- Getting Started: 2 files
- Design: 1 file
- Roadmap: 1 file
- Contributors: 2 files

---

## 🚀 Next Documentation Tasks

### High Priority
1. Expand `aggregates.md` (currently stub)
2. Expand `projections.md` (currently stub)
3. Create `api.md` API reference structure
4. Create `sagas.md` documentation
5. Create `testing.md` documentation
6. Create `drivers.md` documentation

### Medium Priority
7. Add more roadmap items (snapshots, multi-tenancy, kubernetes operator)
8. Create tutorial series
9. Add migration guides for breaking changes
10. Create troubleshooting guide

### Lower Priority
11. Add architectural decision records (ADRs)
12. Create video tutorial scripts
13. Add translated versions
14. Create interactive examples

---

## 🔄 Keeping Documentation Updated

### When Adding Features
1. Update relevant documentation
2. Add code examples
3. Create tests for examples
4. Update package-structure.md if adding packages
5. Move roadmap items to main docs when released

### When Making Breaking Changes
1. Document what changed and why
2. Provide before/after examples
3. Create migration guide
4. Update all affected documentation

### When Resolving Design Questions
1. Document decision in ADR
2. Remove from open-questions.md
3. Update relevant documentation
4. Update code examples to match decision

---

## 📚 Documentation Principles

1. **Complete Examples**: All code must be compilable
2. **Progressive Complexity**: Simple → Advanced
3. **Test-Driven**: Examples have tests
4. **Living Specification**: Docs drive implementation
5. **Multi-Audience**: End-users, contributors, maintainers
6. **AOT-First**: All examples AOT-safe
7. **Clear Ownership**: Domain ownership explicit
8. **Roadmap Transparency**: Unreleased features clearly marked

---

## ❓ Questions?

- **About the library**: Open a [GitHub Discussion](https://github.com/whizbang-lib/whizbang/discussions)
- **Found an error**: Open a [GitHub Issue](https://github.com/whizbang-lib/whizbang/issues)
- **Want to contribute**: See [Contributing Guide](src/assets/docs/Contributors/contributing.md)

---

**Last Updated**: 2025-10-18
