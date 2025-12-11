# Project Vision & Goals

## Site Purpose
This is a documentation website for the **Whizbang .NET library** - a comprehensive .NET/C# library. The site provides:
- Complete API documentation and reference guides
- C# code examples demonstrating library usage
- Getting started tutorials and advanced configuration guides
- Interactive code samples and demonstrations

## Content Focus
- **Primary Language**: C# (.NET)
- **Documentation Types**: API references, tutorials, philosophy, getting started guides
- **Code Examples**: C# snippets with syntax highlighting and metadata
- **Sample Code**: Located in `src/assets/code-samples/` (note: some TypeScript/Angular samples exist for the documentation site itself)

## Target Experience
- **Clean, Mobile-First UI**: Optimized for viewing documentation on any device
- **Excellent Search**: Full-text search with MiniSearch + Fuse.js, with AI enhancements in progress
- **Code Display Excellence**: Enhanced code blocks optimized for C# examples with special handling
- **Progressive Disclosure**: Show essential information first, hide secondary details on mobile

## Tech Stack
- **Frontend**: Angular 20 application (this documentation site)
- **Documented Library**: .NET/C# (Whizbang library)
- **Rendering**: ngx-markdown for documentation, multiple syntax highlighters for code

## Documentation as Specification

This documentation serves a **dual purpose**: it is both user-facing documentation AND the living specification for the Whizbang library development.

### Core Principles

#### Documentation-First Development

- Write documentation BEFORE or DURING implementation, not after
- Documentation drives API design discussions
- If you can't explain it clearly in docs, the API needs work
- Examples written during design phase reveal usability issues early

#### Living Specifications

- Documentation must stay synchronized with library code at all times
- Every API change requires corresponding documentation update
- Breaking changes require migration guides
- Documentation is never "done" - it evolves with the library

#### Example-Driven Development

- Every concept MUST have complete, runnable C# examples
- Examples are not optional - they're part of the specification
- Code examples should be validated against actual library behavior
- Examples demonstrate best practices, not just syntax

#### Documentation as Tests

- Documentation examples serve as integration tests (conceptually)
- If an example doesn't work, either the docs or the library is wrong
- Examples validate that the API is actually usable
- Breaking example code is a regression

#### Source of Truth

- When in doubt about API design, refer to the documentation
- Documentation reflects intended behavior
- Implementation should match documented behavior
- Discrepancies are bugs to be fixed

### Why This Matters

#### For Users

- High-quality, accurate documentation they can trust
- Complete examples that actually work
- Clear guidance on best practices

#### For Developers

- Documentation guides implementation
- Catches design issues before code is written
- Provides clear acceptance criteria
- Reduces rework and refactoring

#### For AI Assistants

- Clear specifications to reference during development
- Examples demonstrate intended usage patterns
- Vibe-code-guide for implementing library features
- Roadmap shows planned direction

### Definition of Done

A feature is not complete until:

- [ ] Public APIs are documented
- [ ] Complete C# examples are provided
- [ ] Examples have been validated
- [ ] Best practices are explained
- [ ] Error scenarios are covered
- [ ] Migration guide exists (if breaking change)