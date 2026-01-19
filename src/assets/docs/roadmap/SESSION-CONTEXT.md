---
title: Session Context for Claude
category: Roadmap
order: 99
description: Essential context for starting new Claude sessions on the Whizbang implementation
tags: context, claude, development, session
---

# Session Context for Claude

## Quick Start for New Sessions

**Copy this to Claude when starting a new session:**

> I'm working on implementing the Whizbang .NET library. Please read the SESSION-CONTEXT.md file in src/assets/docs/roadmap/ for full context. We're building a zero-reflection, event-driven/event-sourced messaging runtime with source generators and comprehensive IDE support from day one.

## Project Overview

### What is Whizbang?
Whizbang is a unified event-sourced data and messaging runtime for .NET that combines the best aspects of MediatR, Wolverine, MassTransit, and NServiceBus into a single, cohesive platform with progressive enhancement.

### Current Status
- **Phase**: Implementation planning and documentation
- **Current Version**: v0.1.0 (Foundation) - Planning
- **Documentation**: Located in `src/assets/docs/`
- **Old Docs**: Previous versions prefixed with `old-` for reference

## Core Implementation Principles

### Non-Negotiable Rules
1. **ZERO REFLECTION** - Everything via source generators, no exceptions
2. **IDE-First** - CodeLens, traceability, and debugging from day one
3. **Test-Driven** - TUnit + Bogus for all components
4. **Breadth-First** - All components exist from v0.1.0, even if simple
5. **In-Memory First** - All components start with in-memory implementations

### Architecture Components (All in v0.1.0)
1. **Dispatcher** - Message routing coordination
2. **Receptors** - Command receivers (not handlers)
3. **Perspectives** - Event handlers (not projections initially)
4. **Lenses** - Read-only query interfaces
5. **Policy Engine** - Cross-cutting concerns
6. **Ledger** - Event store abstraction
7. **Drivers** - Storage abstraction
8. **Transports** - Message broker abstraction

### Unique Terminology
- **Receptors** instead of Handlers (emphasizes decision-making)
- **Perspectives** instead of Projections (more general, handles all writes)
- **Lenses** for queries (composable, functional)
- **Ledger** instead of Event Store (cleaner abstraction)

## Documentation Structure

```
src/assets/docs/
├── roadmap/                    # Implementation roadmap
│   ├── README.md              # Main roadmap navigation
│   ├── philosophy.md          # Core principles
│   ├── architecture.md        # Component relationships
│   ├── success-metrics.md     # How we measure success
│   └── SESSION-CONTEXT.md     # This file
├── v0.1.0/                    # Foundation release (current focus)
│   ├── components/            # Component specifications
│   ├── developer-experience/  # IDE, source generators, debugging
│   ├── testing/              # Testing strategy
│   └── examples/             # Code examples
├── v0.2.0/ through v0.5.0/    # Future versions
├── future/                    # Long-term vision (v0.6.0+)
└── old-*/                     # Previous documentation for reference
```

## Current Implementation Focus

### v0.1.0 Goals
- [ ] All 8 core components with interfaces
- [ ] Source generators for zero-reflection discovery
- [ ] IDE tools with CodeLens-style references
- [ ] Traceability and time-travel debugging foundation
- [ ] Complete testing framework (TUnit + Bogus)
- [ ] In-memory implementations (become test doubles)

### Key Files to Review
1. `/roadmap/philosophy.md` - Core principles and anti-patterns
2. `/roadmap/architecture.md` - Component relationships
3. `/v0.1.0/README.md` - Current version details
4. `/v0.1.0/components/dispatcher.md` - Example component spec

## Development Patterns

### Source Generator Pattern
```csharp
[WhizbangHandler]  // Source generator discovers this
public class OrderReceptor : IReceptor<CreateOrder> {
    public OrderCreated Receive(CreateOrder cmd) { }
}
```

### Policy Pattern
```csharp
[Retry(3)]
[Timeout(5000)]
[Cache(300)]
public class PaymentReceptor : IReceptor<ProcessPayment> { }
```

### Testing Pattern
```csharp
[Test]
[MethodDataSource(nameof(OrderScenarios))]  // Bogus generates scenarios
public async Task CreateOrder_ShouldEmitOrderCreated(OrderScenario scenario) { }
```

## Version Progression

1. **v0.1.0** - Foundation (all components, in-memory)
2. **v0.2.0** - Event-Driven Enhancement (validation, rich events)
3. **v0.3.0** - Event Sourcing (stateful receptors, aggregates)
4. **v0.4.0** - Real Persistence (PostgreSQL, SQL Server, SQLite)
5. **v0.5.0** - Distributed Systems (Kafka, RabbitMQ, Sagas)
6. **v0.6.0+** - Production, Performance, Cloud, Innovation

## Common Tasks

### Adding a New Component Spec
1. Create file in `/v0.1.0/components/[component].md`
2. Include: Interface, In-Memory Implementation, Source Generation, Testing, IDE Integration
3. Update `/v0.1.0/components/README.md` navigation

### Adding a New Version
1. Create folder `/v0.X.0/`
2. Add `_folder.md` with metadata
3. Create `README.md` with version overview
4. Add `migration-guide.md` from previous version

### Working on Specific Topics
- **Components**: Focus on `/v0.1.0/components/`
- **Testing**: Focus on `/v0.1.0/testing/`
- **IDE Features**: Focus on `/v0.1.0/developer-experience/`
- **Examples**: Focus on `/v0.1.0/examples/`

## Key Decisions Made

1. **No Reflection Ever** - Source generators from day one
2. **Breadth First** - All components in v0.1.0
3. **TUnit over xUnit/NUnit** - Modern, fast, better DX
4. **Bogus for Test Data** - Realistic scenario generation
5. **In-Memory as Test Doubles** - Not throwaway code
6. **Policies over Aspects** - Explicit, composable, testable

## Questions/Discussions in Progress

- [ ] Exact IDE overlay visualization format
- [ ] Specific OpenTelemetry integration points
- [ ] Dashboard technology (Blazor vs React)
- [ ] Package naming conventions
- [ ] CI/CD pipeline structure

## Working Conventions

### Code Examples
- Always show complete, compilable examples
- Include using statements
- Show both simple and advanced usage
- Include testing examples

### Documentation Style
- Use clear headings and sections
- Include code examples with syntax highlighting
- Provide "why" not just "what"
- Link between related documents

### File Naming
- Components: `[component-name].md`
- Guides: `[topic]-guide.md`
- Examples: `[scenario]-example.md`
- Always lowercase with hyphens

## Concepts & Patterns Documentation

### Pattern Documentation Standards

All pattern files in `/src/assets/patterns/` follow this proven structure (based on successful Receptor Pattern template):

#### Required Structure

1. **Front-matter** - Standard metadata (title, category, order, description, tags)
2. **Title & Tagline** - Pattern name with memorable quote  
3. **## Evolution** (Early in document - key placement!)
   - ### Pattern Roadmap
   - ### Version Timeline (Mermaid flowchart showing v0.1.0 → v0.5.0)
   - ### Capability Growth by Version
     - Code examples for each version with enhanced front-matter metadata
     - Progressive complexity from foundation to distributed
   - ### Evolution Benefits
   - ### Migration Path
   - ### Capability Matrix (Mermaid diagram showing evolution timeline)
4. **## Pattern Overview**
   - ### What is [Pattern]?
   - ### Key Characteristics  
   - **Industry Pattern Comparisons** (embedded, no separate header):
     - Traditional Pattern Name - **Similarity:** and **Difference:**
     - Multiple comparisons showing how this pattern relates to existing approaches
   - ### When to Use [Pattern]
5. **## Implementation** - Technical details and core concepts
6. **## Code Examples** - Progressive complexity with full metadata
7. **## When to Use This Pattern** - Clear guidance and anti-patterns
8. **## Common Misconceptions** - Address typical confusion points
9. **## Implementation Checklist** - Practical step-by-step guidance
10. **## Example: [Specific Scenario]** - Complete working implementation
11. **## Benefits** - For developers and systems
12. **## Next Steps** - Links to related patterns

#### Key Standards

- **Evolution section placement**: Position #3 (early), not late in document
- **Industry comparisons**: Use **Similarity:** and **Difference:** format (bold text renders automatically)
- **Code examples**: All must have enhanced front-matter with metadata including:
  - title, description, framework, category, difficulty
  - tags, nugetPackages, filename, testFile, testMethod, usingStatements
- **Mermaid diagrams**: Use consistent color schemes across all patterns
- **Version progression**: Always follows v0.1.0 → v0.2.0 → v0.3.0 → v0.4.0 → v0.5.0
- **Cross-references**: Use relative links between related patterns

#### Content Quality Requirements

- All code examples must be complete and compilable
- Progressive complexity from simple to distributed scenarios
- Clear explanations of "why" not just "what"
- Testable examples with accompanying test methods
- Consistent terminology aligned with Whizbang's unique vocabulary

## Session Handoff Notes

**For next session, current priorities are:**
1. Complete remaining v0.1.0 component specifications
2. Detail out testing foundation with TUnit/Bogus
3. Specify source generator implementation
4. Create developer experience documentation
5. Add concrete examples for each component

**Recent work completed:**
- Renamed old version folders to `old-*`
- Created complete roadmap documentation structure
- Established v0.1.0 through v0.5.0 version folders
- Documented philosophy and architecture
- Created success metrics framework

## Quick Commands

```bash
# Navigate to docs
cd /Users/philcarbone/src/whizbang-lib.github.io/src/assets/docs

# View structure
ls -la roadmap/ v0.1.0/

# Find all component docs
find . -name "*component*.md"

# Search for specific patterns
grep -r "IReceptor" --include="*.md"
```

## Contact/Questions

- GitHub: https://github.com/whizbang/whizbang
- Discussions: Use GitHub Discussions for design questions
- Documentation Site: This site (whizbang-lib.github.io)

---

**Remember**: We're building the future of .NET messaging - zero reflection, exceptional DX, progressive enhancement!