# Whizbang Internal Documentation

This folder contains implementation details and architectural documentation for Whizbang library developers and maintainers. This documentation is **not** included in the public website generation.

## Target Audience

- **Library Contributors**: Developers working on Whizbang itself
- **Architecture Reviewers**: Technical leads evaluating design decisions
- **Maintainers**: Long-term stewards of the codebase
- **Advanced Users**: Developers who need to understand internals for debugging or optimization

## Structure

### `/architecture/`
Core architectural patterns and system design decisions:
- Sequence leasing and ordering guarantees
- Where clause explosion algorithms
- Projection storage strategies
- Concurrency and performance patterns

### `/implementation/`
Implementation-specific details:
- Source generation implementation
- Performance optimization techniques
- Memory management strategies
- Threading and async patterns

### `/decisions/`
Architectural decision records (ADRs):
- Stream ID vs Where Clause comparison
- MartenDB vs Whizbang approaches
- Technology choices and trade-offs

### `/debugging/`
Troubleshooting and debugging guides:
- Performance profiling
- Common issues and solutions
- Monitoring and metrics

## Contributing

When adding new internal documentation:

1. **Choose the right folder** based on content type
2. **Follow the naming convention**: `kebab-case.md`
3. **Include comprehensive examples** with code samples
4. **Document trade-offs** and alternative approaches considered
5. **Keep user-facing docs separate** - this is for internals only

## Building the Library

This documentation is excluded from the public website but is available for:
- Library development and testing
- Architecture reviews
- Internal training materials
- Debugging and troubleshooting

## Important Note

**Do not** include implementation details from this folder in user-facing documentation. Keep the separation clean between:
- **What users need to know**: APIs, patterns, examples
- **What maintainers need to know**: Implementation, architecture, decisions