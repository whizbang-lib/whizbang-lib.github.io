# Whizbang Internal Documentation Index

## Quick Navigation

### 🏗️ [Architecture](architecture/)
Core architectural patterns and system design decisions.

**Key Documents:**
- [Sequence Leasing](architecture/sequence-leasing.md) - Revolutionary approach to maintaining event ordering
- [Where Clause Explosion](architecture/where-clause-explosion.md) - Converting LINQ to concrete operations
- [Lease Expiration Handling](architecture/lease-expiration-handling.md) - Comprehensive failure recovery

### 🔧 [Implementation](implementation/)
Detailed implementation guides and technical specifics.

**Key Areas:**
- Source generation and performance optimization
- Memory management and threading patterns
- Storage abstraction and query processing

### 🎯 [Decisions](decisions/)
Architectural Decision Records (ADRs) documenting key design choices.

**Major Decisions:**
- [Stream ID vs Where Clause](decisions/stream-id-vs-where-clause.md) - Why Whizbang chose innovation over tradition

### 🐛 [Debugging](debugging/)
Comprehensive troubleshooting and debugging guides.

**Essential Tools:**
- Performance profiling and monitoring
- Common issues and their solutions
- Production troubleshooting workflows

## For Different Audiences

### New Contributors
Start here to understand Whizbang's unique approach:
1. Read [Stream ID vs Where Clause](decisions/stream-id-vs-where-clause.md) to understand the core innovation
2. Study [Sequence Leasing](architecture/sequence-leasing.md) to grasp the ordering solution
3. Review [Implementation README](implementation/) for development guidelines

### Architecture Reviewers
Focus on these high-level design documents:
1. [Architecture Overview](architecture/) - Core patterns and design decisions
2. [Decision Records](decisions/) - Rationale behind major choices
3. Performance characteristics and trade-offs in each pattern

### Library Maintainers
Essential references for ongoing maintenance:
1. [Debugging Guide](debugging/) - Troubleshooting production issues
2. [Implementation Details](implementation/) - How components work internally
3. [Lease Expiration Handling](architecture/lease-expiration-handling.md) - Critical failure scenarios

### Performance Engineers
Key documents for optimization work:
1. [Where Clause Explosion](architecture/where-clause-explosion.md) - Query performance patterns
2. [Performance Optimization](implementation/performance-optimization.md) - System-wide optimization
3. [Memory Management](implementation/memory-management.md) - Memory usage patterns

## Key Concepts

### Innovative Patterns
- **Sequence Leasing**: Reserve ordering numbers for long-running operations
- **Where Clause Explosion**: Convert LINQ expressions to concrete entity lists
- **ProjectionResult Framework**: Declarative operations without storage dependencies

### Core Differentiators
- **Zero Reflection**: Everything is source-generated for performance
- **Natural LINQ**: Developers write familiar query expressions
- **Deterministic Replay**: Perfect reproducibility through concrete entity tracking
- **Fault Tolerance**: Comprehensive failure recovery strategies

## Implementation Status

### ✅ Completed
- Architecture documentation for core patterns
- Decision records for major design choices
- Comprehensive lease expiration handling strategy

### 🚧 In Progress
- Detailed implementation guides
- Complete debugging and troubleshooting documentation
- Performance optimization strategies

### 📋 Planned
- Detailed source generation implementation
- Storage backend integration guides
- Production deployment patterns

## Contributing to Internal Docs

### Adding New Documentation
1. **Choose the right folder** based on document purpose:
   - `architecture/` - System design and patterns
   - `implementation/` - Technical implementation details
   - `decisions/` - Architectural decision records
   - `debugging/` - Troubleshooting and diagnostics

2. **Follow naming conventions**:
   - Use `kebab-case.md` for file names
   - Include descriptive titles in front matter
   - Add appropriate tags and categories

3. **Include comprehensive examples**:
   - Code samples with explanations
   - Performance characteristics
   - Trade-offs and alternatives
   - Real-world scenarios

### Documentation Standards
- **Clarity**: Write for developers who weren't involved in the original decisions
- **Completeness**: Include context, rationale, and implications
- **Currency**: Keep documentation up-to-date with code changes
- **Examples**: Provide concrete, runnable examples

### Review Process
1. Technical accuracy review by library maintainers
2. Clarity review by someone unfamiliar with the topic
3. Integration review to ensure consistency across documents

## Getting Help

### Internal Questions
- Check existing documentation first
- Search decision records for rationale
- Review implementation guides for technical details

### External Questions
- Remember this documentation is for internal use only
- Refer external questions to user-facing documentation
- Consider if internal concepts need external explanation

---

**Remember**: This documentation is for library developers and maintainers only. User-facing documentation should remain focused on practical usage patterns and APIs.